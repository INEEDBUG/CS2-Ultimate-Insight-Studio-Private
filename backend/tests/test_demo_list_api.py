import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main
from app.valve_demo_resolver import ValveRecentMatch, ValveRecentMatches


def _run(coro):
    return asyncio.run(coro)


def _route_kwargs(**overrides):
    values = {
        "limit": 25,
        "offset": 5,
        "q": " match ",
        "map_names": None,
        "map_name": "de_mirage",
        "statuses": None,
        "status": "done",
        "min_kills": 18,
        "max_deaths": 20,
        "min_assists": 3,
        "min_kd": 1.1,
        "player_query": None,
        "steam_query": "7656119",
        "rounds_min": 20,
        "rounds_max": 30,
        "duration_min": 25.0,
        "duration_max": 60.0,
        "date_from": "2026-07-01",
        "date_to": "2026-07-31",
        "sort_key": "match_time",
        "sort_dir": "asc",
    }
    values.update(overrides)
    return values


def test_compact_list_route_uses_compact_query_and_forwards_all_filters(monkeypatch):
    calls = {}

    async def fake_count_demos(**kwargs):
        calls["count"] = kwargs
        return 1

    async def fake_list_demos_compact(**kwargs):
        calls["list"] = kwargs
        return [{"id": 7, "has_result": True, "clip_count": 2}]

    async def forbidden_legacy_list(**_kwargs):
        raise AssertionError("the list route must not load result_json")

    monkeypatch.setattr(main.demo_db, "count_demos", fake_count_demos)
    monkeypatch.setattr(main.demo_db, "list_demos_compact", fake_list_demos_compact)
    monkeypatch.setattr(main.demo_db, "list_demos", forbidden_legacy_list)

    response = _run(main.list_demos_compact_api(**_route_kwargs()))

    assert response["items"] == [{"id": 7, "has_result": True, "clip_count": 2}]
    assert response["total"] == 1
    assert response["q"] == "match"
    assert calls["count"] == {
        "name_query": "match",
        "filters": calls["list"]["filters"],
    }
    assert calls["list"]["limit"] == 25
    assert calls["list"]["offset"] == 5
    assert calls["list"]["name_query"] == "match"
    assert calls["list"]["sort_key"] == "match_time"
    assert calls["list"]["sort_dir"] == "asc"
    assert calls["list"]["filters"] == {
        "map_names": ["de_mirage"],
        "statuses": ["done"],
        "steam_query": "7656119",
        "min_kills": 18,
        "max_deaths": 20,
        "min_assists": 3,
        "min_kd": 1.1,
        "rounds_min": 20,
        "rounds_max": 30,
        "duration_min": 25.0,
        "duration_max": 60.0,
        "date_from": "2026-07-01",
        "date_to": "2026-07-31",
    }


def test_legacy_list_route_preserves_full_result_contract(monkeypatch):
    full_item = {"id": 7, "result": {"clips": [{"id": "clip"}]}}
    list_mock = AsyncMock(return_value=[full_item])
    compact_mock = AsyncMock(side_effect=AssertionError("legacy route must keep full results"))
    monkeypatch.setattr(main.demo_db, "count_demos", AsyncMock(return_value=1))
    monkeypatch.setattr(main.demo_db, "list_demos", list_mock)
    monkeypatch.setattr(main.demo_db, "list_demos_compact", compact_mock)

    response = _run(main.list_demos(**_route_kwargs()))

    assert response["items"] == [full_item]
    assert response["items"][0]["result"]["clips"] == [{"id": "clip"}]
    list_mock.assert_awaited_once()
    compact_mock.assert_not_awaited()


def test_list_demo_ids_returns_only_filtered_ids(monkeypatch):
    calls = []

    async def fake_list_filtered_demo_ids(**kwargs):
        calls.append(kwargs)
        return [11, 9, 3]

    monkeypatch.setattr(main.demo_db, "list_filtered_demo_ids", fake_list_filtered_demo_ids)

    route_kwargs = _route_kwargs(
                limit=1000,
                offset=0,
                q=None,
                map_name=None,
                status=None,
                min_kills=None,
                max_deaths=None,
                min_assists=None,
                min_kd=None,
                steam_query=None,
                rounds_min=None,
                rounds_max=None,
                duration_min=None,
                duration_max=None,
                date_from=None,
                date_to=None,
            )
    route_kwargs.pop("sort_key")
    route_kwargs.pop("sort_dir")
    response = _run(main.list_demo_ids(**route_kwargs))

    assert response == {"ids": [11, 9, 3], "limit": 1000, "offset": 0, "q": None}
    assert calls == [
        {
            "name_query": None,
            "filters": None,
            "limit": 1000,
            "offset": 0,
        }
    ]


def test_match_history_reads_local_gc_and_batches_library_lookup(tmp_path, monkeypatch):
    recent = ValveRecentMatches(
        steam_id64="76561198000000000",
        matches=(
            ValveRecentMatch(
                match_id=2,
                played_at="2026-08-12T12:00:00Z",
                demo_url="https://replay123.valve.net/730/match.dem.bz2",
                map_name="de_dust2",
                duration_sec=1800,
                score_own=13,
                score_opp=8,
                result="win",
                kills=24,
                deaths=13,
                assists=3,
                headshot_kills=7,
                mvp_count=4,
                rounds=(True, False, True),
            ),
        ),
    )

    async def fake_recent(runtime_parent):
        assert runtime_parent == tmp_path / "third_party" / "boiler-writter"
        return recent

    batch_calls: list[list[str]] = []

    async def fake_rows(filenames):
        names = list(filenames)
        batch_calls.append(names)
        return {"match730_2.dem": {"id": 7, "filename": "match730_2.dem", "map_name": "de_dust2"}}

    monkeypatch.setattr(main, "resolve_config_path", lambda: tmp_path / "config.json")
    monkeypatch.setattr(main, "resolve_recent_valve_matches", fake_recent)
    monkeypatch.setattr(main.demo_db, "find_demo_rows_by_filenames", fake_rows)
    update_match_date = AsyncMock(return_value=True)
    notify = AsyncMock()
    async def fake_notify(_self, reason):
        await notify(reason)
    monkeypatch.setattr(main.demo_db, "update_match_date", update_match_date)
    monkeypatch.setattr(type(main.demo_library_hub), "notify", fake_notify)

    response = _run(main.get_match_history(main.RecentValveMatchesBody(accept_gpl_sidecar=True)))

    assert batch_calls == [["match730_2.dem"]]
    assert response["source"] == "steam_game_coordinator"
    assert response["player"]["steam_id64"] == "76561198000000000"
    assert response["matches"][0]["kills"] == 24
    assert response["matches"][0]["headshot_pct"] == 29
    assert response["matches"][0]["adr"] is None
    assert response["matches"][0]["rating"] is None
    assert response["matches"][0]["demo_in_library"] is True
    assert response["matches"][0]["played_at"] == "2026-08-12T12:00:00Z"
    update_match_date.assert_awaited_once_with(7, "2026-08-12T12:00:00Z", source="steam_gc")
    notify.assert_awaited_once_with("match_times")


def test_batch_summary_reports_corrupt_result_as_item_error(monkeypatch):
    monkeypatch.setattr(
        main.demo_db,
        "get_demo_list_items",
        AsyncMock(
            return_value=[{
                "id": 7,
                "path": "broken.dem",
                "filename": "broken.dem",
                "players": [],
                "result": None,
                "result_error": "损坏的解析结果",
            }]
        ),
    )

    response = _run(main.batch_demo_summary(main.BatchSummaryBody(ids=[7])))

    assert response["items"] == []
    assert response["failed"] == [{
        "id": 7,
        "filename": "broken.dem",
        "code": "DEMO_INSPECTION_FAILED",
    }]
