import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.input_lab import InputLabRequest, analyze_input_session
from app.training_db import TrainingDB


def _request(events, mode="counter_strafe", duration_ms=10_000):
    return InputLabRequest(
        keyboard_name="Test HE Keyboard",
        mode=mode,
        actuation_mm=1.0,
        rapid_trigger_press_mm=0.2,
        rapid_trigger_release_mm=0.2,
        duration_ms=duration_ms,
        events=events,
    )


def test_analyze_counter_strafe_measures_gap_and_overlap():
    result = analyze_input_session(_request([
        {"code": "KeyA", "event_type": "down", "timestamp_ms": 100},
        {"code": "KeyA", "event_type": "up", "timestamp_ms": 200},
        {"code": "KeyD", "event_type": "down", "timestamp_ms": 220},
        {"code": "KeyA", "event_type": "down", "timestamp_ms": 300},
        {"code": "KeyD", "event_type": "up", "timestamp_ms": 310},
        {"code": "KeyA", "event_type": "up", "timestamp_ms": 390},
    ]))

    assert result.total_presses == 3
    assert result.mean_transition_ms == 50
    assert result.overlap_ratio == 0.5
    assert result.per_key["KeyA"]["presses"] == 2


def test_analyze_detects_duplicate_edges_as_chatter():
    result = analyze_input_session(_request([
        {"code": "KeyA", "event_type": "down", "timestamp_ms": 100},
        {"code": "KeyA", "event_type": "down", "timestamp_ms": 101},
        {"code": "KeyA", "event_type": "up", "timestamp_ms": 180},
        {"code": "KeyA", "event_type": "up", "timestamp_ms": 181},
    ], mode="rapid_tap"))

    assert result.chatter_count == 2
    assert "异常重复" in result.recommendation


def test_input_session_is_stored_in_shared_sqlite(tmp_path: Path):
    request = _request([
        {"code": "KeyA", "event_type": "down", "timestamp_ms": 100},
        {"code": "KeyA", "event_type": "up", "timestamp_ms": 180},
    ], mode="rapid_tap")
    result = analyze_input_session(request)

    async def scenario():
        database = TrainingDB(tmp_path / "training.db")
        await database.init_tables()
        saved = await database.save_input_session(
            request.model_dump(mode="json"),
            result.model_dump(mode="json"),
        )
        return saved, await database.list_input_sessions()

    saved, history = asyncio.run(scenario())
    assert saved["id"] == 1
    assert history[0]["keyboard_name"] == "Test HE Keyboard"
    assert history[0]["total_presses"] == 1


def test_manual_unlimited_session_accepts_duration_over_three_minutes():
    request = _request([
        {"code": "KeyA", "event_type": "down", "timestamp_ms": 190_000},
        {"code": "KeyA", "event_type": "up", "timestamp_ms": 190_080},
    ], duration_ms=190_080)

    result = analyze_input_session(request)

    assert result.total_presses == 1
