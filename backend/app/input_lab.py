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
    duration_ms: int = Field(ge=3_000, le=86_400_000)
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
    diagnosis: Literal["unstable", "overlap", "inconsistent", "slow", "balanced"]
    diagnosis_label: str
    recommended_actuation_mm: float
    recommended_rt_press_mm: float
    recommended_rt_release_mm: float
    issues: list[str]
    action_plan: list[str]
    safety_notes: list[str]


def _round_or_zero(value: float) -> float:
    return round(value, 2) if math.isfinite(value) else 0.0


def _step_mm(value: float, delta: float, low: float = 0.05) -> float:
    return round(max(low, min(4.0, value + delta)), 2)


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

    recommended_actuation = request.actuation_mm
    recommended_press = request.rapid_trigger_press_mm
    recommended_release = request.rapid_trigger_release_mm
    issues: list[str] = []
    if chatter > 0:
        diagnosis = "unstable"
        diagnosis_label = "检测到误触或重复边沿"
        recommended_actuation = _step_mm(request.actuation_mm, 0.10, 0.1)
        recommended_press = _step_mm(request.rapid_trigger_press_mm, 0.05)
        recommended_release = _step_mm(request.rapid_trigger_release_mm, 0.05)
        issues.append(f"记录到 {chatter} 次重复按下或缺失抬起，当前阈值可能过于激进或键盘需要重新校准。")
        recommendation = "检测到异常重复边沿；先提高触发与 RT 行程来消除误触，再逐步向下寻找稳定下限。"
    elif hold_jitter > 35:
        diagnosis = "inconsistent"
        diagnosis_label = "按键边沿稳定性不足"
        recommended_press = _step_mm(request.rapid_trigger_press_mm, 0.05)
        recommended_release = _step_mm(request.rapid_trigger_release_mm, 0.05)
        issues.append(f"保持时间标准差为 {hold_jitter:.1f} ms，微小手指运动可能被识别为状态变化。")
        recommendation = "将 RT 按下/抬起距离各增加 0.05 mm，稳定后再决定是否回调。"
    elif request.mode == "counter_strafe" and overlap_ratio > 0.25:
        diagnosis = "overlap"
        diagnosis_label = "A/D 同时按下偏多"
        recommended_release = _step_mm(request.rapid_trigger_release_mm, -0.05)
        issues.append(f"反向切换中有 {overlap_ratio * 100:.1f}% 出现 A/D 重叠，松键边沿或手法需要更干净。")
        recommendation = "在没有抖动的前提下，将释放 RT 行程降低 0.05 mm，并练习先松开再反向按下。"
    elif mean_transition is not None and mean_transition > 90:
        diagnosis = "slow"
        diagnosis_label = "方向切换偏慢"
        recommended_actuation = _step_mm(request.actuation_mm, -0.10, 0.2)
        recommended_press = _step_mm(request.rapid_trigger_press_mm, -0.05)
        issues.append(f"平均方向切换为 {mean_transition:.1f} ms；在边沿稳定的前提下仍有提速空间。")
        recommendation = "小幅降低初始触发与 RT 按下行程，每次只改一档并复测误触。"
    else:
        diagnosis = "balanced"
        diagnosis_label = "当前参数稳定"
        issues.append("未检测到明显重复边沿、过量 A/D 重叠或异常切换延迟。")
        recommendation = "保持当前数值；不要仅为追求更小的毫米数牺牲稳定性。"

    action_plan = []
    if (
        recommended_actuation != request.actuation_mm
        or recommended_press != request.rapid_trigger_press_mm
        or recommended_release != request.rapid_trigger_release_mm
    ):
        action_plan.append(
            f"建议起点：触发 {recommended_actuation:g} mm，RT 按下 {recommended_press:g} mm，"
            f"RT 抬起 {recommended_release:g} mm。"
        )
    else:
        action_plan.append("维持当前触发与 Rapid Trigger 数值，不做无依据的激进下调。")
    action_plan.extend([
        "每次只调整 0.05–0.10 mm，并使用同一测试模式复测，便于判断因果。",
        "先用 30 秒测试排除偶然波动，再进入 CS2 验证急停、长按稳定和误触。",
    ])
    safety_notes = [
        "CS2 官匹中请关闭 Snap Tap、Rapid Tap、Snappy Tappy、SOCD/LKP 等自动反向输入功能。",
        "普通 Rapid Trigger 可用于缩短按键复位，但建议只在 WASD 等确有收益的按键启用。",
    ]

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
        diagnosis=diagnosis,
        diagnosis_label=diagnosis_label,
        recommended_actuation_mm=recommended_actuation,
        recommended_rt_press_mm=recommended_press,
        recommended_rt_release_mm=recommended_release,
        issues=issues,
        action_plan=action_plan,
        safety_notes=safety_notes,
    )
