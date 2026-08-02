"""Deterministic CS2 sensitivity recommendations from embedded aim trials."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Literal

from pydantic import BaseModel, Field, field_validator


CS2_YAW = 0.022


class SensitivityTrial(BaseModel):
    kind: Literal["flick", "tracking"]
    multiplier: float = Field(ge=0.5, le=1.5)
    duration_ms: int = Field(ge=3_000, le=180_000)
    hits: int = Field(default=0, ge=0, le=100_000)
    targets: int = Field(default=0, ge=0, le=100_000)
    average_reaction_ms: float = Field(default=0, ge=0, le=30_000)
    path_efficiency: float = Field(default=0, ge=0, le=1)
    overshoots: int = Field(default=0, ge=0, le=100_000)
    on_target_ratio: float = Field(default=0, ge=0, le=1)


class SensitivityRecommendationRequest(BaseModel):
    dpi: int = Field(ge=100, le=32_000)
    current_sensitivity: float = Field(gt=0, le=25)
    game_width: int = Field(ge=320, le=16_384)
    game_height: int = Field(ge=240, le=16_384)
    display_aspect: Literal["16:9", "16:10", "4:3", "5:4", "other"] = "16:9"
    scaling_mode: Literal["stretched", "black_bars", "native"] = "stretched"
    trials: list[SensitivityTrial] = Field(min_length=4, max_length=40)

    @field_validator("trials")
    @classmethod
    def require_both_test_kinds(cls, trials: list[SensitivityTrial]) -> list[SensitivityTrial]:
        kinds = {trial.kind for trial in trials}
        if kinds != {"flick", "tracking"}:
            raise ValueError("至少需要一轮甩枪测试和一轮追踪测试")
        if len({round(trial.multiplier, 3) for trial in trials}) < 2:
            raise ValueError("至少需要测试两个不同的灵敏度倍率")
        return trials


class SensitivityRecommendation(BaseModel):
    recommended_sensitivity: float
    current_sensitivity: float
    multiplier: float
    edpi: float
    cm_per_360: float
    confidence: float
    score: float
    tested_scores: dict[str, float]
    resolution_context: str
    console_command: str


def sensitivity_to_cm360(dpi: int, sensitivity: float) -> float:
    return 360.0 * 2.54 / (float(dpi) * float(sensitivity) * CS2_YAW)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _trial_score(trial: SensitivityTrial) -> float:
    path = _clamp(trial.path_efficiency, 0.0, 1.0)
    if trial.kind == "flick":
        hit_ratio = trial.hits / max(1, trial.targets)
        reaction = 0.0 if trial.average_reaction_ms <= 0 else _clamp(
            (950.0 - trial.average_reaction_ms) / 700.0,
            0.0,
            1.0,
        )
        overshoot = 1.0 - _clamp(trial.overshoots / max(1, trial.targets), 0.0, 1.0)
        return 0.45 * hit_ratio + 0.30 * reaction + 0.15 * path + 0.10 * overshoot
    stability = 1.0 - _clamp(trial.overshoots / max(1, trial.targets), 0.0, 1.0)
    return 0.65 * trial.on_target_ratio + 0.20 * path + 0.15 * stability


def _resolution_context(request: SensitivityRecommendationRequest) -> str:
    game_ratio = request.game_width / request.game_height
    ratio_label = f"{request.game_width}×{request.game_height} ({game_ratio:.3f}:1)"
    if request.scaling_mode == "stretched":
        return (
            f"测试已记录游戏分辨率 {ratio_label}，并按 {request.display_aspect} 拉伸显示理解视觉速度；"
            "CS2 的角度旋转不由分辨率直接改变，因此不对最终 sensitivity 做虚假的固定倍率修正。"
        )
    return (
        f"测试已记录游戏分辨率 {ratio_label}、{request.scaling_mode} 显示；"
        "结果由实际鼠标测试表现决定，分辨率只作为视觉与准星移动背景。"
    )


def recommend_sensitivity(request: SensitivityRecommendationRequest) -> SensitivityRecommendation:
    grouped: dict[float, list[float]] = defaultdict(list)
    kinds_by_multiplier: dict[float, set[str]] = defaultdict(set)
    for trial in request.trials:
        multiplier = round(float(trial.multiplier), 3)
        grouped[multiplier].append(_trial_score(trial))
        kinds_by_multiplier[multiplier].add(trial.kind)

    aggregate: dict[float, float] = {}
    for multiplier, scores in grouped.items():
        kind_coverage = len(kinds_by_multiplier[multiplier]) / 2.0
        aggregate[multiplier] = (sum(scores) / len(scores)) * (0.9 + 0.1 * kind_coverage)

    best_multiplier = max(aggregate, key=lambda value: (aggregate[value], -abs(1.0 - value)))
    best_score = aggregate[best_multiplier]

    # Blend strong neighbouring candidates to avoid snapping to one noisy round.
    eligible = {
        multiplier: score
        for multiplier, score in aggregate.items()
        if score >= best_score - 0.12
    }
    weights = {
        multiplier: math.exp((score - best_score) * 8.0)
        for multiplier, score in eligible.items()
    }
    recommended_multiplier = sum(multiplier * weights[multiplier] for multiplier in eligible) / sum(weights.values())
    recommended_multiplier = _clamp(recommended_multiplier, 0.65, 1.45)
    recommended = round(request.current_sensitivity * recommended_multiplier, 4)
    recommended = _clamp(recommended, 0.01, 25.0)

    sorted_scores = sorted(aggregate.values(), reverse=True)
    separation = sorted_scores[0] - sorted_scores[1] if len(sorted_scores) > 1 else 0.0
    complete_candidates = sum(1 for kinds in kinds_by_multiplier.values() if len(kinds) == 2)
    coverage = min(1.0, len(request.trials) / 10.0) * min(1.0, complete_candidates / 3.0)
    confidence = _clamp(0.35 + 0.45 * coverage + 0.20 * min(1.0, separation / 0.15), 0.0, 0.98)

    return SensitivityRecommendation(
        recommended_sensitivity=recommended,
        current_sensitivity=request.current_sensitivity,
        multiplier=round(recommended / request.current_sensitivity, 4),
        edpi=round(request.dpi * recommended, 1),
        cm_per_360=round(sensitivity_to_cm360(request.dpi, recommended), 2),
        confidence=round(confidence, 3),
        score=round(best_score, 3),
        tested_scores={f"{key:.3f}": round(value, 3) for key, value in sorted(aggregate.items())},
        resolution_context=_resolution_context(request),
        console_command=f'sensitivity "{recommended:g}"',
    )
