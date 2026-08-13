import asyncio
import subprocess

from app import league_lab
from app.league_lab import LeagueLabService, LeagueLabSettings, parse_league_client_command_line


def test_parse_league_client_command_line_extracts_lcu_credentials():
    parsed = parse_league_client_command_line(
        '"LeagueClientUx.exe" --app-port=54321 --remoting-auth-token=secret_token '
        '--region=CN --rso_platform_id=HN1 --app-pid=1234'
    )

    assert parsed is not None
    assert parsed.port == 54321
    assert parsed.token == "secret_token"
    assert parsed.region == "CN"
    assert parsed.platform_id == "HN1"
    assert "secret_token" not in parsed.base_url


def test_parse_league_client_command_line_rejects_incomplete_input():
    assert parse_league_client_command_line("--app-port=54321") is None


def test_discovery_uses_thread_compatible_subprocess(monkeypatch):
    command = b"1234\r\n"

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 0, stdout=command)

    monkeypatch.setattr(league_lab.os, "name", "nt")
    monkeypatch.setattr(league_lab.subprocess, "run", fake_run)
    monkeypatch.setattr(
        league_lab,
        "_read_windows_process_command_line",
        lambda pid: 'LeagueClientUx.exe --app-port=54321 --remoting-auth-token=memory_only' if pid == 1234 else "",
    )
    parsed = asyncio.run(league_lab.discover_lcu_credentials())
    assert parsed is not None
    assert parsed.port == 54321
    assert parsed.token == "memory_only"


def test_settings_are_persisted_without_lcu_credentials(tmp_path, monkeypatch):
    monkeypatch.setattr(LeagueLabService, "_settings_path", staticmethod(lambda: tmp_path / "league-lab.json"))
    service = LeagueLabService()
    service.credentials = None
    updated = service.update_settings(
        LeagueLabSettings(automation_enabled=True, auto_accept_enabled=True, invitation_strategy="accept")
    )

    content = (tmp_path / "league-lab.json").read_text(encoding="utf-8")
    assert updated.auto_accept_enabled is True
    assert "secret" not in content.lower()
    assert LeagueLabService().settings.invitation_strategy == "accept"


def test_ready_check_runs_auto_accept_once(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(
        automation_enabled=True,
        auto_accept_enabled=True,
        auto_accept_delay_seconds=0,
    )
    service.phase = "ReadyCheck"
    calls = []

    async def record(label, method, path):
        calls.append((label, method, path))

    monkeypatch.setattr(service, "_record_action", record)
    asyncio.run(service._run_automation())
    asyncio.run(service._run_automation())

    assert calls == [("已自动接受对局", "POST", "/lol-matchmaking/v1/ready-check/accept")]


def test_play_again_waits_for_phase_buffer(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(automation_enabled=True, play_again_enabled=True)
    service.phase = "EndOfGame"
    calls = []

    async def record(label, method, path):
        calls.append((label, method, path))

    monkeypatch.setattr(service, "_record_action", record)
    asyncio.run(service._run_automation())
    assert calls == []

    service._phase_action_due_at = 0
    asyncio.run(service._run_automation())
    assert calls == [("已自动返回房间", "POST", "/lol-lobby/v2/play-again")]


def test_auto_select_uses_the_first_available_preference(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(
        automation_enabled=True,
        auto_select_enabled=True,
        auto_pick_champion_ids=[157, 103],
        champion_action_delay_seconds=0,
    )
    calls = []

    async def request(method, path, *, json_body=None, params=None):
        if path == "/lol-champ-select/v1/session":
            return {"localPlayerCellId": 2, "actions": [[{"id": 8, "actorCellId": 2, "type": "pick", "isInProgress": True}]]}
        if path == "/lol-champ-select/v1/pickable-champion-ids":
            return [103]
        calls.append((method, path, json_body))

    monkeypatch.setattr(service, "request", request)
    asyncio.run(service._run_auto_select())
    asyncio.run(service._run_auto_select())

    assert calls == [("PATCH", "/lol-champ-select/v1/session/actions/8", {"championId": 103, "type": "pick", "completed": True})]


def test_auto_honor_submits_votes_and_finishes_ballot(monkeypatch):
    service = LeagueLabService()
    calls = []

    async def request(method, path, *, json_body=None, params=None):
        if method == "GET":
            return {"gameId": 77, "votePool": {"votes": 1}, "eligibleAllies": [{"puuid": "ally", "botPlayer": False}], "eligibleOpponents": []}
        calls.append((method, path, json_body))

    monkeypatch.setattr(service, "request", request)
    asyncio.run(service._run_auto_honor())
    asyncio.run(service._run_auto_honor())

    assert calls == [
        ("POST", "/lol-honor/v1/honor", {"honorType": "COOL", "recipientPuuid": "ally"}),
        ("POST", "/lol-honor/v1/ballot", None),
    ]
