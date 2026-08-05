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
    duration_ms: int = Field(ge=3_000, le=86_400_000)
    hits: int = Field(default=0, ge=0, le=100_000)
    targets: int = Field(default=0, ge=0, le=100_000)
    average_reaction_ms: float = Field(default=0, ge=0, le=30_000)
    path_efficiency: float = Field(default=0, ge=0, le=1)
    overshoots: int = Field(default=0, ge=0, le=100_000)
    on_target_ratio: float = Field(default=0, ge=0, le=1)


class SensitivityRecommendationRequest(BaseModel):
    dpi: int = Field(ge=100, le=32_000)
    current_sensitivity: float = Field(gt=0, le=25)
    m_yaw: float = Field(default=CS2_YAW, gt=0, le=1)
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
    current_cm_per_360: float
    m_yaw: float
    confidence: float
    score: float
    tested_scores: dict[str, float]
    resolution_context: str
    console_command: str
    diagnosis: Literal["too_fast", "too_slow", "balanced", "mixed"]
    diagnosis_label: str
    adjustment_percent: float
    suggested_min: float
    suggested_max: float
    insights: list[str]
    action_plan: list[str]
    methodology_note: str


def sensitivity_to_cm360(dpi: int, sensitivity: float, m_yaw: float = CS2_YAW) -> float:
    return 360.0 * 2.54 / (float(dpi) * float(sensitivity) * float(m_yaw))


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
    yaw_label = f"m_yaw {request.m_yaw:g}"
    if request.scaling_mode == "stretched":
        return (
            f"测试已记录游戏分辨率 {ratio_label}，并按 {request.display_aspect} 拉伸显示理解视觉速度；"
            f"角度与 cm/360 按 {yaw_label} 计算。分辨率不直接改变 CS2 转角，因此不会套用虚假的固定倍率修正。"
        )
    return (
        f"测试已记录游戏分辨率 {ratio_label}、{request.scaling_mode} 显示，并按 {yaw_label} 计算；"
        "结果由实际鼠标测试表现决定，分辨率只作为视觉与准星移动背景。"
    )


def recommend_sensitivity(request: SensitivityRecommendationRequest) -> SensitivityRecommendation:
    grouped: dict[float, list[float]] = defaultdict(list)
    kinds_by_multiplier: dict[float, set[str]] = defaultdict(set)
    scores_by_kind: dict[float, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for trial in request.trials:
        multiplier = round(float(trial.multiplier), 3)
        score = _trial_score(trial)
        grouped[multiplier].append(score)
        scores_by_kind[multiplier][trial.kind].append(score)
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

    kind_scores = {
        multiplier: {
            kind: sum(values) / len(values)
            for kind, values in grouped_kinds.items()
            if values
        }
        for multiplier, grouped_kinds in scores_by_kind.items()
    }
    best_flick = max(
        (multiplier for multiplier in kind_scores if "flick" in kind_scores[multiplier]),
        key=lambda multiplier: (kind_scores[multiplier]["flick"], -abs(1.0 - multiplier)),
    )
    best_tracking = max(
        (multiplier for multiplier in kind_scores if "tracking" in kind_scores[multiplier]),
        key=lambda multiplier: (kind_scores[multiplier]["tracking"], -abs(1.0 - multiplier)),
    )
    recommended_ratio = recommended / request.current_sensitivity
    split_preference = abs(best_flick - best_tracking) >= 0.25
    if split_preference:
        diagnosis = "mixed"
        diagnosis_label = "甩枪与追踪偏好不一致"
    elif recommended_ratio < 0.94:
        diagnosis = "too_fast"
        diagnosis_label = "当前灵敏度偏快"
    elif recommended_ratio > 1.06:
        diagnosis = "too_slow"
        diagnosis_label = "当前灵敏度偏慢"
    else:
        diagnosis = "balanced"
        diagnosis_label = "当前灵敏度接近平衡区"

    current_multiplier = min(aggregate, key=lambda value: abs(value - 1.0))
    current_trials = [trial for trial in request.trials if round(float(trial.multiplier), 3) == current_multiplier]
    current_targets = sum(trial.targets for trial in current_trials)
    current_overshoots = sum(trial.overshoots for trial in current_trials)
    overshoot_rate = current_overshoots / max(1, current_targets)
    adjustment_percent = (recommended_ratio - 1.0) * 100.0
    insights = [
        f"当前倍率附近记录到 {overshoot_rate * 100:.1f}% 的过冲事件。",
        f"甩枪最佳测试倍率为 ×{best_flick:g}，追踪最佳测试倍率为 ×{best_tracking:g}。",
    ]
    if diagnosis == "too_fast":
        insights.append("较低倍率在命中、路径控制与过冲惩罚后的综合表现更好，建议先降速。")
    elif diagnosis == "too_slow":
        insights.append("较高倍率在没有明显牺牲控制的情况下完成目标更快，建议小幅提速。")
    elif diagnosis == "mixed":
        insights.append("不要一次大幅改动；先使用折中值，并用更长测试确认你更重视甩枪还是连续追踪。")
    else:
        insights.append("当前值已经落在实测平衡区，继续追求大幅变化的收益有限。")
    if confidence < 0.65:
        insights.append("候选成绩接近或样本较少，本次结论置信度有限。")

    suggested_min = round(_clamp(recommended * 0.96, 0.01, 25.0), 4)
    suggested_max = round(_clamp(recommended * 1.04, 0.01, 25.0), 4)
    action_plan = [
        f"先在 CS2 输入 sensitivity \"{recommended:g}\"，只修改这一项。",
        f"在 {suggested_min:g}–{suggested_max:g} 范围内各复测一轮；每轮建议至少 30 秒。",
        "若仍频繁越过目标，向区间下沿调；若总是停在目标前，向区间上沿调。",
        "保留 DPI 不变，连续使用两到三局后再决定是否固化设置。",
    ]

    return SensitivityRecommendation(
        recommended_sensitivity=recommended,
        current_sensitivity=request.current_sensitivity,
        multiplier=round(recommended / request.current_sensitivity, 4),
        edpi=round(request.dpi * recommended, 1),
        cm_per_360=round(sensitivity_to_cm360(request.dpi, recommended, request.m_yaw), 2),
        current_cm_per_360=round(
            sensitivity_to_cm360(request.dpi, request.current_sensitivity, request.m_yaw),
            2,
        ),
        m_yaw=round(request.m_yaw, 6),
        confidence=round(confidence, 3),
        score=round(best_score, 3),
        tested_scores={f"{key:.3f}": round(value, 3) for key, value in sorted(aggregate.items())},
        resolution_context=_resolution_context(request),
        console_command=f'sensitivity "{recommended:g}"',
        diagnosis=diagnosis,
        diagnosis_label=diagnosis_label,
        adjustment_percent=round(adjustment_percent, 1),
        suggested_min=suggested_min,
        suggested_max=suggested_max,
        insights=insights,
        action_plan=action_plan,
        methodology_note=(
            "建议来自本次甩枪与追踪的速度—精度权衡；测试场按当前 sensitivity 与 m_yaw 生成候选增益，"
            "DPI、sensitivity 和 m_yaw 用于 eDPI 与 cm/360。浏览器指针锁定仍是相对模拟，最终请在 CS2 内复测确认。"
        ),
    )
