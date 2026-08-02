"""Analyze browser-observable keyboard timing for magnetic-keyboard tuning."""

from __future__ import annotations

import math
from collections import defaultdict
from statistics import fmean, pstdev
from typing import Literal

from pydantic import BaseModel, Field, field_validator


TRACKED_KEYS = {"KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ControlLeft", "Space"}


class InputEvent(BaseModel):
    code: str
    event_type: Literal["down", "up"]
    timestamp_ms: float = Field(ge=0, le=86_400_000)

    @field_validator("code")
    @classmethod
    def tracked_key_only(cls, value: str) -> str:
        if value not in TRACKED_KEYS:
            raise ValueError("包含不支持的按键")
        return value


class InputLabRequest(BaseModel):
    keyboard_name: str = Field(default="Magnetic keyboard", min_length=1, max_length=100)
    mode: Literal["rapid_tap", "counter_strafe", "gameplay"]
    actuation_mm: float = Field(ge=0.1, le=4.0)
    rapid_trigger_press_mm: float = Field(ge=0.05, le=4.0)
    rapid_trigger_release_mm: float = Field(ge=0.05, le=4.0)
    duration_ms: int = Field(ge=3_000, le=180_000)
    events: list[InputEvent] = Field(min_length=2, max_length=20_000)

    @field_validator("events")
    @classmethod
    def chronological_events(cls, events: list[InputEvent]) -> list[InputEvent]:
        if any(current.timestamp_ms < previous.timestamp_ms for previous, current in zip(events, events[1:])):
            raise ValueError("按键事件时间必须递增")
        return events


class InputLabResult(BaseModel):
    total_presses: int
    presses_per_second: float
    mean_hold_ms: float
    hold_jitter_ms: float
    mean_transition_ms: float | None
    overlap_ratio: float
    chatter_count: int
    stability_score: float
    recommendation: str
    per_key: dict[str, dict[str, float | int]]


def _round_or_zero(value: float) -> float:
    return round(value, 2) if math.isfinite(value) else 0.0


def analyze_input_session(request: InputLabRequest) -> InputLabResult:
    active: dict[str, float] = {}
    last_up: dict[str, float] = {}
    holds: list[float] = []
    per_key_holds: dict[str, list[float]] = defaultdict(list)
    per_key_presses: dict[str, int] = defaultdict(int)
    chatter = 0
    transitions: list[float] = []
    overlaps = 0
    transition_count = 0

    for event in request.events:
        code = event.code
        timestamp = event.timestamp_ms
        if event.event_type == "down":
            if code in active:
                chatter += 1
                continue
            per_key_presses[code] += 1
            active[code] = timestamp
            if code in {"KeyA", "KeyD"}:
                opposite = "KeyD" if code == "KeyA" else "KeyA"
                if opposite in active:
                    overlaps += 1
                    transition_count += 1
                    transitions.append(-(timestamp - active[opposite]))
                elif opposite in last_up:
                    transition_count += 1
                    transitions.append(timestamp - last_up[opposite])
        else:
            started = active.pop(code, None)
            if started is None:
                chatter += 1
                continue
            duration = max(0.0, timestamp - started)
            holds.append(duration)
            per_key_holds[code].append(duration)
            last_up[code] = timestamp

    # Close keys still held at the end without treating them as chatter.
    for code, started in active.items():
        duration = max(0.0, request.duration_ms - started)
        holds.append(duration)
        per_key_holds[code].append(duration)

    total_presses = sum(per_key_presses.values())
    mean_hold = fmean(holds) if holds else 0.0
    hold_jitter = pstdev(holds) if len(holds) > 1 else 0.0
    mean_transition = fmean(abs(value) for value in transitions) if transitions else None
    overlap_ratio = overlaps / transition_count if transition_count else 0.0
    jitter_penalty = min(45.0, hold_jitter / 3.0)
    chatter_penalty = min(30.0, chatter * 5.0)
    overlap_penalty = min(25.0, overlap_ratio * 35.0)
    stability = max(0.0, 100.0 - jitter_penalty - chatter_penalty - overlap_penalty)

    if chatter > 0:
        recommendation = "检测到异常重复/缺失边沿；先提高触发或释放行程，再重新校准键盘。"
    elif request.mode == "counter_strafe" and overlap_ratio > 0.25:
        recommendation = "A/D 重叠偏高；可略增释放 Rapid Trigger 行程，并练习先释放再反向按下。"
    elif hold_jitter > 35:
        recommendation = "按键保持时间波动较大；当前设置可能过敏，建议每次只增加 0.05–0.10 mm 后复测。"
    else:
        recommendation = "当前事件边沿稳定。不要仅为追求更小数值继续降低行程；建议进 CS2 验证急停与误触。"

    per_key = {}
    for code in sorted(per_key_presses):
        key_holds = per_key_holds.get(code, [])
        per_key[code] = {
            "presses": per_key_presses[code],
            "mean_hold_ms": _round_or_zero(fmean(key_holds)) if key_holds else 0.0,
            "jitter_ms": _round_or_zero(pstdev(key_holds)) if len(key_holds) > 1 else 0.0,
        }

    return InputLabResult(
        total_presses=total_presses,
        presses_per_second=round(total_presses / max(0.001, request.duration_ms / 1000.0), 2),
        mean_hold_ms=_round_or_zero(mean_hold),
        hold_jitter_ms=_round_or_zero(hold_jitter),
        mean_transition_ms=None if mean_transition is None else _round_or_zero(mean_transition),
        overlap_ratio=round(overlap_ratio, 3),
        chatter_count=chatter,
        stability_score=round(stability, 1),
        recommendation=recommendation,
        per_key=per_key,
    )
