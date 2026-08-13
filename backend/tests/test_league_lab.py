import asyncio
import subprocess
import time

import httpx

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


def test_respawn_timer_reads_local_live_client_data(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(respawn_timer_enabled=True)
    service.phase = "InProgress"
    service.current_summoner = {"game_name": "Tester", "tag_line": "CN1"}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return [{"riotId": "Tester#CN1", "isDead": True, "respawnTimer": 12.4}]

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url):
            assert url == "https://127.0.0.1:2999/liveclientdata/playerlist"
            return FakeResponse()

    monkeypatch.setattr(league_lab.httpx, "AsyncClient", FakeClient)
    asyncio.run(service._refresh_respawn_timer())

    assert service.respawn_timer == {"available": True, "dead": True, "time_left": 12.4, "total_time": 12.4}


def test_respawn_timer_is_off_by_default():
    service = LeagueLabService()
    service.phase = "InProgress"
    asyncio.run(service._refresh_respawn_timer())
    assert service.respawn_timer["available"] is False


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


def test_ready_check_exposes_mini_action_countdown():
    service = LeagueLabService()
    service.settings = LeagueLabSettings(
        automation_enabled=True,
        auto_accept_enabled=True,
        auto_accept_delay_seconds=3,
    )
    service.phase = "ReadyCheck"

    asyncio.run(service._run_automation())
    countdown = service.status()["action_countdown"]

    assert countdown["kind"] == "ready-check"
    assert countdown["label"] == "自动接受对局"
    assert 0 < countdown["remaining_seconds"] <= 3


def test_optional_lcu_404_preserves_discovered_credentials(monkeypatch):
    service = LeagueLabService()
    service.credentials = league_lab.LcuCredentials(port=54321, token="memory-only")
    service._last_discovery_at = time.monotonic()

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def request(self, method, url, **kwargs):
            return httpx.Response(404, request=httpx.Request(method, url))

    monkeypatch.setattr(league_lab.httpx, "AsyncClient", FakeClient)

    try:
        asyncio.run(service.request("GET", "/optional-route"))
    except RuntimeError:
        pass
    else:
        raise AssertionError("404 must still surface to the optional-route caller")

    assert service.credentials is not None
    assert service.credentials.token == "memory-only"


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
        if path == "/lol-gameflow/v1/session":
            return {}
        calls.append((method, path, json_body))

    monkeypatch.setattr(service, "request", request)
    asyncio.run(service._run_auto_select())
    asyncio.run(service._run_auto_select())

    assert calls == [("PATCH", "/lol-champ-select/v1/session/actions/8", {"championId": 103, "type": "pick", "completed": True})]


def test_mode_group_matches_league_queue_families():
    assert LeagueLabService._mode_group({"gameData": {"queue": {"id": 420, "gameMode": "CLASSIC", "type": "RANKED_SOLO_5x5"}}}) == "ranked"
    assert LeagueLabService._mode_group({"gameData": {"queue": {"id": 450, "gameMode": "ARAM"}}}) == "aram"
    assert LeagueLabService._mode_group({"gameData": {"queue": {"id": 1700, "gameMode": "CHERRY"}}}) == "arena"
    assert LeagueLabService._mode_group({"gameData": {"isCustomGame": True}}) == "custom"


def test_normalized_champ_select_exposes_mini_bench_state():
    normalized = LeagueLabService._normalize_champ_select({
        "localPlayerCellId": 2,
        "myTeam": [{"cellId": 2, "championId": 22}],
        "benchEnabled": True,
        "benchChampions": [{"championId": 12}, {"championId": 34}],
        "rerollsRemaining": 1,
        "allowRerolling": True,
        "timer": {"phase": "FINALIZATION", "adjustedTimeLeftInPhase": 9000},
    })
    assert normalized["current_champion_id"] == 22
    assert normalized["bench_champions"] == [12, 34]
    assert normalized["rerolls_remaining"] == 1
    assert normalized["timer_phase"] == "FINALIZATION"
    assert normalized["timer_deadline_at"] > 0


def test_auto_select_delay_is_non_blocking_and_visible(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(
        automation_enabled=True,
        auto_select_enabled=True,
        auto_pick_champion_ids=[103],
        champion_action_delay_seconds=3,
    )

    async def request(method, path, *, json_body=None, params=None):
        if path == "/lol-champ-select/v1/session":
            return {"localPlayerCellId": 2, "actions": [[{"id": 8, "actorCellId": 2, "type": "pick", "isInProgress": True}]]}
        if path == "/lol-champ-select/v1/pickable-champion-ids":
            return [103]
        if path == "/lol-gameflow/v1/session":
            return {}
        raise AssertionError("the delayed lock-in must not run yet")

    monkeypatch.setattr(service, "request", request)
    asyncio.run(service._run_auto_select())

    countdown = service.status()["action_countdown"]
    assert countdown["kind"] == "champion-action"
    assert 0 < countdown["remaining_seconds"] <= 3


def test_invitation_strategy_prefers_accept_and_respects_game_type(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(
        automation_enabled=True,
        auto_handle_invitations_enabled=True,
        invitation_handling_strategies={"<DEFAULT>": "decline", "NORMAL_GAME": "accept"},
    )
    calls = []

    async def request(method, path, *, json_body=None, params=None):
        if method == "GET":
            return [
                {"invitationId": "custom", "state": "Pending", "canAcceptInvitation": True, "gameConfig": {"inviteGameType": "CUSTOM_GAME"}},
                {"invitationId": "normal", "state": "Pending", "canAcceptInvitation": True, "gameConfig": {"inviteGameType": "NORMAL_GAME"}},
            ]
        calls.append((method, path))

    monkeypatch.setattr(service, "request", request)
    asyncio.run(service._run_lobby_automation())
    assert calls == [("POST", "/lol-lobby/v2/received-invitations/normal/accept")]


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


def test_auto_matchmaking_waits_for_invitees(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(
        automation_enabled=True,
        auto_matchmaking_enabled=True,
        auto_matchmaking_delay_seconds=0,
        auto_matchmaking_wait_for_invitees=True,
    )
    service.phase = "Lobby"
    calls = []

    async def request(method, path, *, json_body=None, params=None):
        if path == "/lol-lobby/v2/lobby":
            return {
                "localMember": {"isLeader": True},
                "members": [{}],
                "invitations": [{"state": "Pending"}],
                "canStartActivity": True,
            }
        calls.append((method, path))
        return None

    monkeypatch.setattr(service, "request", request)
    asyncio.run(service._run_auto_matchmaking())

    assert service._matchmaking_status == "waiting-for-invitees"
    assert calls == []


def test_auto_matchmaking_starts_when_lobby_is_ready(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(
        automation_enabled=True,
        auto_matchmaking_enabled=True,
        auto_matchmaking_delay_seconds=0,
    )
    service.phase = "Lobby"
    calls = []

    async def request(method, path, *, json_body=None, params=None):
        if path == "/lol-lobby/v2/lobby":
            return {
                "localMember": {"isLeader": True},
                "members": [{}],
                "invitations": [],
                "canStartActivity": True,
            }
        if path == "/lol-matchmaking/v1/search":
            return None
        calls.append((method, path))

    monkeypatch.setattr(service, "request", request)
    asyncio.run(service._run_auto_matchmaking())

    assert calls == [("POST", "/lol-lobby/v2/lobby/matchmaking/search")]
    assert service._matchmaking_status == "searching"


def test_auto_honor_opt_out_finishes_without_voting(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(auto_honor_strategy="opt-out")
    calls = []

    async def request(method, path, *, json_body=None, params=None):
        if method == "GET":
            return {"gameId": 88, "votePool": {"votes": 1}, "eligibleAllies": [{"puuid": "ally"}]}
        calls.append((method, path, json_body))

    monkeypatch.setattr(service, "request", request)
    asyncio.run(service._run_auto_honor())

    assert calls == [("POST", "/lol-honor/v1/ballot", None)]


def test_auto_reply_uses_event_conversation_and_ignores_history(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(
        automation_enabled=True,
        auto_reply_enabled=True,
        auto_reply_text="稍后回复",
    )
    service.current_summoner = {"summoner_id": 7}
    calls = []

    async def request(method, path, *, json_body=None, params=None):
        calls.append((method, path, json_body))

    monkeypatch.setattr(service, "request", request)
    asyncio.run(
        service._handle_lcu_event(
            {
                "uri": "/lol-chat/v1/conversations/friend/messages/message-1",
                "eventType": "Create",
                "data": {"type": "chat", "fromSummonerId": 8, "isHistorical": False},
            }
        )
    )

    assert calls == [
        (
            "POST",
            "/lol-chat/v1/conversations/friend/messages",
            {"body": "稍后回复", "type": "chat"},
        )
    ]


def test_aram_team_side_sends_once(monkeypatch):
    service = LeagueLabService()
    service.settings = LeagueLabSettings(
        automation_enabled=True,
        auto_send_aram_team_side_enabled=True,
        auto_send_aram_team_side_visible_to_team=True,
    )
    service.phase = "ChampSelect"
    calls = []

    async def request(method, path, *, json_body=None, params=None):
        if path == "/lol-champ-select/v1/session":
            return {"benchEnabled": True, "localPlayerCellId": 3, "myTeam": [{"cellId": 3, "team": 1}]}
        if path == "/lol-gameflow/v1/session":
            return {"map": {"gameMode": "ARAM"}}
        if path == "/lol-chat/v1/conversations":
            return [{"id": "champ", "type": "championSelect"}]
        calls.append((method, path, json_body))

    monkeypatch.setattr(service, "request", request)
    asyncio.run(service._run_aram_team_side())
    asyncio.run(service._run_aram_team_side())

    assert calls == [
        (
            "POST",
            "/lol-chat/v1/conversations/champ/messages",
            {"body": "本局位于左侧（蓝方）", "type": "chat"},
        )
    ]


def test_auto_invite_online_friend_removes_completed_target(monkeypatch, tmp_path):
    monkeypatch.setattr(LeagueLabService, "_settings_path", staticmethod(lambda: tmp_path / "league-lab.json"))
    service = LeagueLabService()
    service.settings = LeagueLabSettings(
        automation_enabled=True,
        auto_invite_friend_puuids=["friend-puuid"],
    )
    calls = []

    async def request(method, path, *, json_body=None, params=None):
        if method == "GET":
            return {"members": [], "localMember": {"allowedInviteOthers": True}}
        calls.append((method, path, json_body))

    monkeypatch.setattr(service, "request", request)
    asyncio.run(
        service._handle_lcu_event(
            {
                "uri": "/lol-chat/v1/friends/friend-puuid",
                "data": {
                    "puuid": "friend-puuid",
                    "availability": "chat",
                    "summonerId": 42,
                    "gameName": "Friend",
                },
            }
        )
    )

    assert calls == [("POST", "/lol-lobby/v2/lobby/invitations", [{"toSummonerId": 42}])]
    assert service.settings.auto_invite_friend_puuids == []


def test_player_search_uses_lcu_riot_id_alias(monkeypatch):
    calls = []

    async def request(method, path, *, json_body=None, params=None):
        calls.append((method, path, json_body, params))
        if path.endswith("/aliases"):
            return [{"puuid": "player-1", "gameName": "Player", "tagLine": "CN1"}]
        return {}

    async def bundle(summoner, match_limit=20, beg_index=0):
        return {"summoner": summoner, "matches": []}

    monkeypatch.setattr(league_lab.league_lab_service, "request", request)
    monkeypatch.setattr(league_lab, "_load_player_bundle", bundle)
    result = asyncio.run(league_lab.search_league_player(" Player ", " CN1 "))

    assert result["summoner"]["puuid"] == "player-1"
    assert calls == [
        (
            "POST",
            "/lol-summoner/v1/summoners/aliases",
            [{"gameName": "Player", "tagLine": "CN1"}],
            None,
        )
    ]


def test_recent_players_are_deduplicated_and_sorted(monkeypatch, tmp_path):
    monkeypatch.setattr(league_lab, "_recent_players_path", lambda: tmp_path / "recent.json")
    monkeypatch.setattr(league_lab.time, "time", lambda: 10)
    league_lab._remember_recent_players(
        [{"puuid": "one", "summoner": {"gameName": "One"}, "champion_id": 1}],
        100,
    )
    monkeypatch.setattr(league_lab.time, "time", lambda: 20)
    league_lab._remember_recent_players(
        [
            {"puuid": "one", "summoner": {"gameName": "One Renamed"}, "champion_id": 2},
            {"puuid": "two", "summoner": {"gameName": "Two"}, "champion_id": 3},
        ],
        200,
    )

    rows = league_lab._read_recent_players()
    assert [row["puuid"] for row in rows] == ["one", "two"]
    assert rows[0]["game_name"] == "One Renamed"
    assert rows[0]["last_game_id"] == 200


def test_premade_groups_require_repeated_same_team_matches():
    def match(game_id, teammates):
        identities = [
            {"participantId": index + 1, "player": {"puuid": puuid}}
            for index, puuid in enumerate(teammates)
        ]
        participants = [
            {"participantId": index + 1, "teamId": 100}
            for index in range(len(teammates))
        ]
        return {"gameId": game_id, "participantIdentities": identities, "participants": participants}

    histories = {
        "a": {"games": {"games": [match(1, ["a", "b"]), match(2, ["a", "b"]), match(3, ["a", "b"])]}},
        "c": {"games": {"games": [match(4, ["b", "c"])]}},
    }
    groups = league_lab._infer_premade_groups(histories, {"a", "b", "c"}, threshold=3)

    assert groups["a"] == groups["b"]
    assert "c" not in groups


def test_toolkit_overview_is_read_only(monkeypatch):
    async def request(method, path, *, json_body=None, params=None):
        assert method == "GET"
        payloads = {
            "/lol-missions/v1/missions": [{"id": "mission"}],
            "/lol-missions/v1/series": [{"id": "series"}],
            "/lol-rewards/v1/grants": [{"id": "reward", "viewed": False}],
            "/lol-loot/v1/player-loot-map": {"loot": {"lootId": "loot"}},
            "/lol-chat/v1/friends": [{"puuid": "friend"}],
        }
        return payloads[path]

    monkeypatch.setattr(league_lab.league_lab_service, "request", request)
    result = asyncio.run(league_lab.league_toolkit_overview())

    assert result["read_only"] is True
    assert result["counts"] == {"missions": 1, "unclaimed_rewards": 1, "loot": 1, "friends": 1}


def test_champion_icon_is_proxied_without_exposing_lcu_credentials(monkeypatch):
    async def request_bytes(path):
        assert path == "/lol-game-data/assets/v1/champion-icons/22.png"
        return b"png-bytes", "image/png"

    monkeypatch.setattr(league_lab.league_lab_service, "request_bytes", request_bytes)
    response = asyncio.run(league_lab.league_champion_icon(22))

    assert response.body == b"png-bytes"
    assert response.media_type == "image/png"
    assert response.headers["cache-control"] == "private, max-age=86400"


def test_profile_icon_falls_back_to_png(monkeypatch):
    calls = []

    async def request_bytes(path):
        calls.append(path)
        if path.endswith(".jpg"):
            raise RuntimeError("missing jpg")
        return b"profile-png", "image/png"

    monkeypatch.setattr(league_lab.league_lab_service, "request_bytes", request_bytes)
    response = asyncio.run(league_lab.league_profile_icon(29))

    assert calls == [
        "/lol-game-data/assets/v1/profile-icons/29.jpg",
        "/lol-game-data/assets/v1/profile-icons/29.png",
    ]
    assert response.body == b"profile-png"
    assert response.media_type == "image/png"


def test_sgp_server_routing_matches_tencent_and_global_clients():
    assert league_lab._sgp_server_id(league_lab.LcuCredentials(1, "x", "CN", "HN1")) == "TENCENT_HN1"
    assert league_lab._sgp_server_id(league_lab.LcuCredentials(1, "x", "TENCENT", "HN10")) == "TENCENT_HN10"
    assert league_lab._sgp_server_id(league_lab.LcuCredentials(1, "x", "NA", "NA1")) == "NA1"
    assert league_lab._sgp_server_id(league_lab.LcuCredentials(1, "x", "EUW1", "EUW1")) == "EUW"


def test_sgp_match_rows_normalize_wrapped_summary():
    payload = {
        "games": [{
            "metadata": {"match_id": "HN1_9"},
            "json": {
                "gameId": 9,
                "gameCreation": 123456,
                "gameDuration": 1800,
                "gameMode": "CLASSIC",
                "gameType": "MATCHED_GAME",
                "queueId": 420,
                "participants": [{
                    "puuid": "player-1", "championId": 22, "championName": "Ashe",
                    "teamPosition": "BOTTOM", "individualPosition": "BOTTOM",
                    "summoner1Id": 4, "summoner2Id": 7, "kills": 10, "deaths": 2,
                    "assists": 8, "win": True, "totalMinionsKilled": 180,
                    "neutralMinionsKilled": 10, "goldEarned": 14000,
                    "totalDamageDealtToChampions": 25000, "item0": 3006,
                    "challenges": {"kda": 9.0},
                }],
            },
        }],
    }
    rows = league_lab._normalize_sgp_match_rows(payload, {22: "寒冰射手"}, "player-1")

    assert rows == [{
        "game_id": 9, "played_at": 123456, "duration_seconds": 1800,
        "game_mode": "CLASSIC", "game_type": "MATCHED_GAME", "queue_id": 420,
        "position": "BOTTOM", "role": "BOTTOM", "champion_id": 22,
        "champion_name": "寒冰射手", "spell1_id": 4, "spell2_id": 7,
        "kills": 10, "deaths": 2, "assists": 8, "win": True, "cs": 190,
        "gold": 14000, "damage": 25000, "items": [3006],
        "challenges": {"kda": 9.0}, "source": "sgp",
    }]


def test_player_bundle_falls_back_to_sgp_history(monkeypatch):
    async def request(method, path, *, json_body=None, params=None):
        if path.startswith("/lol-ranked/"):
            return {}
        if path.startswith("/lol-champion-mastery/"):
            return []
        if path.startswith("/lol-match-history/"):
            return {"games": {"games": []}}
        raise AssertionError(path)

    async def sgp(puuid, beg_index, count):
        assert (puuid, beg_index, count) == ("player-1", 0, 20)
        return {"games": [{"json": {"gameId": 1, "participants": [{"puuid": "player-1", "championId": 22}]}}]}

    async def names():
        return {22: "Ashe"}

    monkeypatch.setattr(league_lab.league_lab_service, "request", request)
    monkeypatch.setattr(league_lab, "_sgp_match_history", sgp)
    monkeypatch.setattr(league_lab, "_champion_names", names)
    result = asyncio.run(league_lab._load_player_bundle({"puuid": "player-1"}))

    assert result["match_source"] == "sgp"
    assert result["matches"][0]["game_id"] == 1


def test_skin_selector_only_exposes_owned_enabled_skins():
    result = league_lab._normalize_skin_selector(
        {"showSkinSelector": True, "selectedSkinId": 22001, "selectedChampionId": 22},
        [
            {"id": 22000, "name": "Base", "unlocked": True, "disabled": False, "splashPath": "/base", "childSkins": []},
            {"id": 22001, "name": "Owned", "unlocked": True, "disabled": False, "splashPath": "/owned", "childSkins": [
                {"id": 22002, "name": "Chroma", "unlocked": True, "disabled": False, "chromaPreviewPath": "/chroma"},
                {"id": 22003, "name": "Locked chroma", "unlocked": False, "disabled": False},
            ]},
            {"id": 22004, "name": "Locked", "unlocked": False, "disabled": False, "childSkins": []},
        ],
    )

    assert result["available"] is True
    assert result["selected_skin_id"] == 22001
    assert [row["id"] for row in result["skins"]] == [22000, 22001, 22002]
    assert result["skins"][-1]["is_chroma"] is True


def test_skin_change_rejects_skin_outside_owned_snapshot(monkeypatch):
    league_lab.league_lab_service.champ_select = {
        "skin_selector": {"skins": [{"id": 22001}], "disabled": False}
    }
    try:
        asyncio.run(league_lab.league_champ_select_skin(99999))
    except league_lab.HTTPException as exc:
        assert exc.status_code == 409
    else:
        raise AssertionError("unowned skin should be rejected")
