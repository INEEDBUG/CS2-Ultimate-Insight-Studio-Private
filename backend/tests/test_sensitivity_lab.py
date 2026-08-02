import asyncio
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.sensitivity_lab import (
    SensitivityRecommendationRequest,
    recommend_sensitivity,
    sensitivity_to_cm360,
)
from app.training_db import TrainingDB


def _trial(kind: str, multiplier: float, quality: float) -> dict:
    if kind == "flick":
        return {
            "kind": kind,
            "multiplier": multiplier,
            "duration_ms": 15_000,
            "hits": round(20 * quality),
            "targets": 20,
            "average_reaction_ms": 900 - 500 * quality,
            "path_efficiency": quality,
            "overshoots": round(8 * (1 - quality)),
        }
    return {
        "kind": kind,
        "multiplier": multiplier,
        "duration_ms": 15_000,
        "targets": 60,
        "on_target_ratio": quality,
        "path_efficiency": quality,
        "overshoots": round(12 * (1 - quality)),
    }


def _request() -> SensitivityRecommendationRequest:
    return SensitivityRecommendationRequest(
        dpi=800,
        current_sensitivity=1.0,
        game_width=1024,
        game_height=1080,
        display_aspect="16:9",
        scaling_mode="stretched",
        trials=[
            _trial("flick", 0.8, 0.45),
            _trial("tracking", 0.8, 0.50),
            _trial("flick", 1.0, 0.62),
            _trial("tracking", 1.0, 0.60),
            _trial("flick", 1.2, 0.94),
            _trial("tracking", 1.2, 0.92),
        ],
    )


def test_cm360_uses_cs2_yaw_formula():
    assert sensitivity_to_cm360(800, 1.0) == pytest.approx(51.9545, rel=1e-4)


def test_recommendation_follows_strongest_measured_multiplier():
    result = recommend_sensitivity(_request())

    assert result.recommended_sensitivity > 1.1
    assert result.edpi == pytest.approx(800 * result.recommended_sensitivity)
    assert result.console_command.startswith('sensitivity "')
    assert "1024×1080" in result.resolution_context
    assert "不对最终 sensitivity" in result.resolution_context


def test_recommendation_requires_flick_and_tracking_trials():
    payload = _request().model_dump()
    payload["trials"] = [_trial("flick", 0.8, 0.8)] * 4

    with pytest.raises(ValidationError, match="甩枪测试和一轮追踪测试"):
        SensitivityRecommendationRequest.model_validate(payload)


def test_manual_unlimited_round_accepts_duration_over_three_minutes():
    payload = _request().model_dump()
    for trial in payload["trials"]:
        trial["duration_ms"] = 190_000

    request = SensitivityRecommendationRequest.model_validate(payload)

    assert all(trial.duration_ms == 190_000 for trial in request.trials)


def test_training_db_persists_and_lists_session(tmp_path: Path):
    async def scenario():
        database = TrainingDB(tmp_path / "training.db")
        await database.init_tables()
        request = _request()
        result = recommend_sensitivity(request)
        saved = await database.save_sensitivity_session(
            request.model_dump(mode="json"),
            result.model_dump(mode="json"),
        )
        rows = await database.list_sensitivity_sessions()
        return saved, rows

    saved, rows = asyncio.run(scenario())

    assert saved["id"] == 1
    assert len(rows) == 1
    assert rows[0]["recommended_sensitivity"] == saved["recommended_sensitivity"]
    assert rows[0]["game_width"] == 1024
    assert rows[0]["game_height"] == 1080
