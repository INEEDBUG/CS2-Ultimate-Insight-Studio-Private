"""Local League Client (LCU) automation for the integrated League lab.

The authentication token is discovered from the running LeagueClientUx process,
kept in memory only, and never written to config or logs.
"""

from __future__ import annotations

import asyncio
import base64
import ctypes
import ctypes.wintypes as wintypes
import json
import logging
import os
import random
import re
import ssl
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx
import websockets
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .env_utils import get_data_dir


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/league-lab", tags=["league-lab"])

_PORT_RE = re.compile(r"--app-port=(\d+)")
_TOKEN_RE = re.compile(r"--remoting-auth-token=([\w_-]+)")
_REGION_RE = re.compile(r"--region=([\w_-]+)", re.IGNORECASE)
_PLATFORM_RE = re.compile(r"--rso[_-]platform[_-]id=([\w_-]+)", re.IGNORECASE)


PositionKey = Literal["default", "top", "jungle", "middle", "bottom", "utility"]
PickStrategy = Literal["just-show", "show-and-lock-in", "lock-in-immediately"]


def _empty_position_pool() -> dict[str, list[int]]:
    return {key: [] for key in ("default", "top", "jungle", "middle", "bottom", "utility")}


class PickProfile(BaseModel):
    enabled: bool = False
    champions: dict[str, list[int]] = Field(default_factory=_empty_position_pool)
    delay_seconds: float = Field(default=3.0, ge=0.0, le=15.0)
    ignore_intent: bool = False
    strategy: PickStrategy = "show-and-lock-in"
    show_intent: bool = True
    bench_select_first_available_champion: bool = True
    bench_swap_accumulated_delay_seconds: float = Field(default=2.5, ge=0.0, le=15.0)
    bench_handle_trade_enabled: bool = True


class BanProfile(BaseModel):
    enabled: bool = False
    champions: dict[str, list[int]] = Field(default_factory=_empty_position_pool)
    delay_seconds: float = Field(default=3.0, ge=0.0, le=15.0)
    strategy: PickStrategy = "show-and-lock-in"


class AutoSelectProfile(BaseModel):
    pick: PickProfile = Field(default_factory=PickProfile)
    ban: BanProfile = Field(default_factory=BanProfile)


def _default_auto_select_profiles() -> dict[str, AutoSelectProfile]:
    return {key: AutoSelectProfile() for key in ("ranked", "aram", "arena", "urf", "clash", "doom-bots", "custom", "default")}


class LeagueLabSettings(BaseModel):
    automation_enabled: bool = False
    auto_accept_enabled: bool = False
    auto_accept_delay_seconds: float = Field(default=1.0, ge=0.0, le=10.0)
    play_again_enabled: bool = False
    auto_reconnect_enabled: bool = False
    invitation_strategy: Literal["ignore", "accept", "decline"] = "ignore"
    auto_handle_invitations_enabled: bool = False
    reject_invitation_when_away: bool = False
    invitation_handling_strategies: dict[str, Literal["ignore", "accept", "decline"]] = Field(default_factory=dict)
    auto_skip_leader_enabled: bool = False
    auto_select_enabled: bool = False
    auto_pick_champion_ids: list[int] = Field(default_factory=list)
    auto_ban_champion_ids: list[int] = Field(default_factory=list)
    champion_action_delay_seconds: float = Field(default=1.0, ge=0.0, le=10.0)
    champion_lock_in: bool = True
    auto_select_profiles: dict[str, AutoSelectProfile] = Field(default_factory=_default_auto_select_profiles)
    auto_champion_config_enabled: bool = False
    champion_loadouts: list["ChampionLoadout"] = Field(default_factory=list)
    auto_honor_enabled: bool = False
    auto_honor_strategy: Literal[
        "prefer-lobby-member", "only-lobby-member", "all-member", "opt-out", "all-member-including-opponent"
    ] = "prefer-lobby-member"
    auto_matchmaking_enabled: bool = False
    auto_matchmaking_delay_seconds: float = Field(default=5.0, ge=0.0, le=60.0)
    auto_matchmaking_minimum_members: int = Field(default=1, ge=1, le=5)
    auto_matchmaking_wait_for_invitees: bool = True
    auto_matchmaking_rematch_strategy: Literal["never", "fixed-duration", "estimated-duration"] = "never"
    auto_matchmaking_rematch_fixed_duration: float = Field(default=120.0, ge=10.0, le=3600.0)
    auto_reply_enabled: bool = False
    auto_reply_only_away: bool = False
    auto_reply_text: str = Field(default="", max_length=500)
    lock_offline_status: bool = False
    auto_send_aram_team_side_enabled: bool = False
    auto_send_aram_team_side_visible_to_team: bool = False
    mini_enabled: bool = True
    mini_auto_show: bool = True


class ChampionLoadout(BaseModel):
    champion_id: int = Field(gt=0)
    primary_style_id: int = Field(gt=0)
    sub_style_id: int = Field(gt=0)
    selected_perk_ids: list[int] = Field(default_factory=list)
    spell1_id: int = Field(gt=0)
    spell2_id: int = Field(gt=0)


LeagueLabSettings.model_rebuild()


@dataclass(frozen=True)
class LcuCredentials:
    port: int
    token: str
    region: str = ""
    platform_id: str = ""

    @property
    def base_url(self) -> str:
        return f"https://127.0.0.1:{self.port}"

    @property
    def auth_header(self) -> str:
        encoded = base64.b64encode(f"riot:{self.token}".encode("utf-8")).decode("ascii")
        return f"Basic {encoded}"


def parse_league_client_command_line(command_line: str) -> LcuCredentials | None:
    port_match = _PORT_RE.search(command_line or "")
    token_match = _TOKEN_RE.search(command_line or "")
    if not port_match or not token_match:
        return None
    region_match = _REGION_RE.search(command_line)
    platform_match = _PLATFORM_RE.search(command_line)
    return LcuCredentials(
        port=int(port_match.group(1)),
        token=token_match.group(1),
        region=region_match.group(1) if region_match else "",
        platform_id=platform_match.group(1) if platform_match else "",
    )


async def discover_lcu_credentials() -> LcuCredentials | None:
    if os.name != "nt":
        return None
    script = "(Get-Process LeagueClientUx -ErrorAction SilentlyContinue | Select-Object -First 1).Id"
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    def read_command_line() -> str:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5.0,
            check=False,
            creationflags=creation_flags,
        )
        try:
            pid = int(completed.stdout.decode("ascii", errors="ignore").strip())
        except ValueError:
            return ""
        return _read_windows_process_command_line(pid)

    try:
        command_line = await asyncio.to_thread(read_command_line)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return parse_league_client_command_line(command_line)


def _read_windows_process_command_line(pid: int) -> str:
    """Read ProcessCommandLineInformation exactly as LeagueAkari's native addon does."""
    if os.name != "nt" or pid <= 0:
        return ""
    process_query_limited_information = 0x1000
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    ntdll = ctypes.WinDLL("ntdll")
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
    if not handle:
        return ""
    try:
        query = ntdll.NtQueryInformationProcess
        query.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.ULONG, ctypes.POINTER(wintypes.ULONG)]
        query.restype = ctypes.c_long
        needed = wintypes.ULONG()
        query(handle, 60, None, 0, ctypes.byref(needed))
        if not needed.value:
            return ""
        buffer = ctypes.create_string_buffer(needed.value)
        status = query(handle, 60, buffer, needed.value, ctypes.byref(needed))
        if status < 0:
            return ""

        class UnicodeString(ctypes.Structure):
            _fields_ = [("Length", wintypes.USHORT), ("MaximumLength", wintypes.USHORT), ("Buffer", ctypes.c_void_p)]

        value = UnicodeString.from_buffer(buffer)
        return ctypes.wstring_at(value.Buffer, value.Length // ctypes.sizeof(ctypes.c_wchar)) if value.Buffer else ""
    finally:
        kernel32.CloseHandle(handle)


class LeagueLabService:
    def __init__(self) -> None:
        self.settings = self._load_settings()
        self.credentials: LcuCredentials | None = None
        self.phase = ""
        self.summoner_name = ""
        self.current_summoner: dict = {}
        self.last_error = ""
        self.last_action = ""
        self.last_action_at = 0.0
        self._task: asyncio.Task | None = None
        self._event_task: asyncio.Task | None = None
        self._event_wakeup = asyncio.Event()
        self._event_connected = False
        self._accept_due_at: float | None = None
        self._acted_phase = ""
        self._phase_action_done = ""
        self._phase_action_due_at: float | None = None
        self._handled_invitations: set[str] = set()
        self._handled_champion_actions: set[str] = set()
        self._handled_trades: set[str] = set()
        self._bench_candidate_since: dict[int, float] = {}
        self._leader_handoff_lobby = ""
        self._configured_champion_id = 0
        self._honored_game_id = ""
        self._matchmaking_due_at: float | None = None
        self._matchmaking_status = "idle"
        self._last_event_at = 0.0
        self._aram_side_sent_context = ""
        self.champ_select: dict = {}
        self._last_discovery_at = 0.0

    @staticmethod
    def _settings_path() -> Path:
        return get_data_dir() / "league-lab.json"

    def _load_settings(self) -> LeagueLabSettings:
        try:
            return LeagueLabSettings.model_validate_json(self._settings_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return LeagueLabSettings()

    def update_settings(self, settings: LeagueLabSettings) -> LeagueLabSettings:
        path = self._settings_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(settings.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(path)
        self.settings = settings
        if not settings.auto_select_enabled:
            self._accept_due_at = None
            self._handled_champion_actions.clear()
            self._configured_champion_id = 0
            self.champ_select = {}
        return settings

    async def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="league-lab")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
        if self._event_task:
            self._event_task.cancel()
            try:
                await self._event_task
            except asyncio.CancelledError:
                pass
            self._event_task = None

    async def refresh_connection(self, *, force: bool = False) -> bool:
        now = time.monotonic()
        if not force and self.credentials and now - self._last_discovery_at < 5.0:
            return True
        if not force and now - self._last_discovery_at < 5.0:
            return False
        self._last_discovery_at = now
        credentials = await discover_lcu_credentials()
        if credentials != self.credentials:
            if self._event_task:
                self._event_task.cancel()
                self._event_task = None
            self.credentials = credentials
            self.phase = ""
            self.summoner_name = ""
            self.current_summoner = {}
            self._acted_phase = ""
            self._phase_action_done = ""
            self._phase_action_due_at = None
            self._accept_due_at = None
            self._matchmaking_due_at = None
            self._matchmaking_status = "idle"
            if credentials:
                self._event_task = asyncio.create_task(self._run_event_stream(credentials), name="league-lcu-events")
        return credentials is not None

    async def _run_event_stream(self, credentials: LcuCredentials) -> None:
        """Subscribe to LCU JsonApi events; the polling loop remains a recovery fallback."""
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        try:
            async with websockets.connect(
                f"wss://127.0.0.1:{credentials.port}",
                additional_headers={"Authorization": credentials.auth_header},
                ssl=context,
                open_timeout=3,
                close_timeout=1,
                ping_interval=20,
            ) as socket:
                self._event_connected = True
                await socket.send(json.dumps([5, "OnJsonApiEvent"]))
                async for raw in socket:
                    try:
                        event = json.loads(raw)
                    except (TypeError, ValueError):
                        continue
                    if isinstance(event, list) and len(event) >= 3 and event[0] == 8:
                        self._last_event_at = time.time()
                        await self._handle_lcu_event(event[2] if isinstance(event[2], dict) else {})
                        self._event_wakeup.set()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.info("League LCU event stream unavailable; polling fallback remains active: %s", type(exc).__name__)
        finally:
            self._event_connected = False

    async def _handle_lcu_event(self, event: dict) -> None:
        uri = str(event.get("uri") or "")
        data = event.get("data") or {}
        message_match = re.fullmatch(r"/lol-chat/v1/conversations/([^/]+)/messages/([^/]+)", uri)
        if (
            message_match
            and self.settings.automation_enabled
            and self.settings.auto_reply_enabled
            and self.settings.auto_reply_text
        ):
            own_id = self.current_summoner.get("summoner_id")
            if (
                event.get("eventType") in {"Create", "Update"}
                and data.get("type") == "chat"
                and data.get("fromSummonerId") != own_id
                and not data.get("isHistorical")
            ):
                if self.settings.auto_reply_only_away:
                    try:
                        chat_me = await self.request("GET", "/lol-chat/v1/me")
                    except RuntimeError:
                        return
                    if not isinstance(chat_me, dict) or chat_me.get("availability") != "away":
                        return
                conversation_id = message_match.group(1)
                await self.request(
                    "POST",
                    f"/lol-chat/v1/conversations/{conversation_id}/messages",
                    json_body={"body": self.settings.auto_reply_text, "type": "chat"},
                )
                self.last_action = "已自动回复一条私聊"
                self.last_action_at = time.time()

        if uri == "/lol-chat/v1/me" and self.settings.automation_enabled and self.settings.lock_offline_status:
            availability = str(data.get("availability") or "")
            if availability in {"away", "chat", "online"}:
                await self.request("PUT", "/lol-chat/v1/me", json_body={"availability": "offline"})

    async def request(self, method: str, path: str, *, json_body=None, params=None):
        if not await self.refresh_connection():
            raise RuntimeError("未检测到正在运行的英雄联盟客户端")
        assert self.credentials is not None
        try:
            async with httpx.AsyncClient(verify=False, timeout=3.0) as client:
                response = await client.request(
                    method,
                    f"{self.credentials.base_url}{path}",
                    headers={"Authorization": self.credentials.auth_header},
                    json=json_body,
                    params=params,
                )
            response.raise_for_status()
            if response.status_code == 204 or not response.content:
                return None
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            self.last_error = f"LCU 请求失败: {type(exc).__name__}"
            self.credentials = None
            raise RuntimeError(self.last_error) from exc

    async def snapshot(self) -> dict:
        connected = await self.refresh_connection(force=True)
        if connected:
            await self._refresh_state()
        return self.status()

    def status(self) -> dict:
        credentials = self.credentials
        return {
            "connected": credentials is not None,
            "phase": self.phase,
            "summoner_name": self.summoner_name,
            "current_summoner": self.current_summoner,
            "region": credentials.region if credentials else "",
            "platform_id": credentials.platform_id if credentials else "",
            "last_error": self.last_error,
            "last_action": self.last_action,
            "last_action_at": self.last_action_at or None,
            "champ_select": self.champ_select,
            "event_stream_connected": self._event_connected,
            "last_event_at": self._last_event_at or None,
            "matchmaking_status": self._matchmaking_status,
            "matchmaking_due_at": (time.time() + max(0.0, self._matchmaking_due_at - time.monotonic())) if self._matchmaking_due_at else None,
            "mini_should_show": self.settings.mini_enabled and self.settings.mini_auto_show and self.phase in {"Lobby", "Matchmaking", "ReadyCheck", "ChampSelect"} and not bool(self.champ_select.get("is_spectating")),
            "settings": self.settings.model_dump(),
        }

    async def _refresh_state(self) -> None:
        try:
            phase = await self.request("GET", "/lol-gameflow/v1/gameflow-phase")
            self.phase = str(phase or "")
            summoner = await self.request("GET", "/lol-summoner/v1/current-summoner")
            if isinstance(summoner, dict):
                self.summoner_name = str(summoner.get("gameName") or summoner.get("displayName") or "")
                self.current_summoner = {
                    "puuid": summoner.get("puuid"),
                    "game_name": summoner.get("gameName") or summoner.get("displayName"),
                    "tag_line": summoner.get("tagLine") or "",
                    "summoner_level": summoner.get("summonerLevel"),
                    "profile_icon_id": summoner.get("profileIconId"),
                    "summoner_id": summoner.get("summonerId"),
                }
            self.last_error = ""
            if self.phase == "ChampSelect":
                session = await self.request("GET", "/lol-champ-select/v1/session")
                self.champ_select = self._normalize_champ_select(session)
            else:
                self.champ_select = {}
        except RuntimeError:
            return

    async def _record_action(self, label: str, method: str, path: str) -> None:
        await self.request(method, path)
        self.last_action = label
        self.last_action_at = time.time()

    @staticmethod
    def _normalize_champ_select(session) -> dict:
        if not isinstance(session, dict):
            return {}
        members = []
        for member in session.get("myTeam") or []:
            if isinstance(member, dict):
                members.append({
                    "cell_id": member.get("cellId"),
                    "champion_id": member.get("championId") or member.get("championPickIntent"),
                    "assigned_position": member.get("assignedPosition") or "",
                    "summoner_id": member.get("summonerId"),
                })
        return {
            "local_player_cell_id": session.get("localPlayerCellId"),
            "my_team": members,
            "bench_enabled": bool(session.get("benchEnabled")),
            "bench_champions": [int(item.get("championId")) for item in (session.get("benchChampions") or []) if isinstance(item, dict) and item.get("championId")],
            "is_spectating": bool(session.get("isSpectating")),
        }

    @staticmethod
    def _mode_group(gameflow: dict | None, session: dict | None = None) -> str:
        game_data = (gameflow or {}).get("gameData") or {}
        queue = game_data.get("queue") or {}
        queue_id = int(queue.get("id") or game_data.get("queueId") or 0)
        mode = str(queue.get("gameMode") or game_data.get("gameMode") or "").upper()
        queue_type = str(queue.get("type") or "").upper()
        if bool(game_data.get("isCustomGame")) or bool((session or {}).get("isCustomGame")):
            return "custom"
        if bool((session or {}).get("benchEnabled")) or queue_id == 450 or mode in {"ARAM", "KIWI"}:
            return "aram"
        if queue_id in {420, 440} or "RANKED" in queue_type:
            return "ranked"
        if queue_id == 700 or "CLASH" in queue_type:
            return "clash"
        if queue_id in {1700, 1710} or mode == "CHERRY":
            return "arena"
        if "URF" in mode or "URF" in queue_type:
            return "urf"
        if queue_id in {950, 960} or "DOOMBOT" in mode.replace("_", ""):
            return "doom-bots"
        return "default"

    @staticmethod
    def _position_for_session(session: dict) -> str:
        local_cell = session.get("localPlayerCellId")
        member = next((item for item in (session.get("myTeam") or []) if item.get("cellId") == local_cell), {})
        value = str(member.get("assignedPosition") or "default").lower()
        aliases = {"mid": "middle", "adc": "bottom", "support": "utility"}
        value = aliases.get(value, value)
        return value if value in {"top", "jungle", "middle", "bottom", "utility"} else "default"

    @staticmethod
    def _profile_candidates(pool: dict[str, list[int]], position: str) -> list[int]:
        positioned = list(pool.get(position) or [])
        fallback = list(pool.get("default") or [])
        return list(dict.fromkeys(positioned + fallback))

    async def _active_auto_select_profile(self, session: dict) -> tuple[str, AutoSelectProfile]:
        try:
            gameflow = await self.request("GET", "/lol-gameflow/v1/session")
        except RuntimeError:
            gameflow = {}
        group = self._mode_group(gameflow if isinstance(gameflow, dict) else {}, session)
        return group, self.settings.auto_select_profiles.get(group) or self.settings.auto_select_profiles.get("default") or AutoSelectProfile()

    async def _run_auto_select(self) -> None:
        session = await self.request("GET", "/lol-champ-select/v1/session")
        if not isinstance(session, dict):
            return
        local_cell = session.get("localPlayerCellId")
        group, profile = await self._active_auto_select_profile(session)
        position = self._position_for_session(session)
        teammate_intents = {
            int(member.get("championPickIntent"))
            for member in (session.get("myTeam") or [])
            if member.get("cellId") != local_cell and int(member.get("championPickIntent") or 0) > 0
        }
        for action_group in session.get("actions") or []:
            for action in action_group or []:
                if not isinstance(action, dict) or action.get("actorCellId") != local_cell or not action.get("isInProgress"):
                    continue
                action_type = action.get("type")
                configured = profile.pick if action_type == "pick" else profile.ban
                legacy_candidates = self.settings.auto_pick_champion_ids if action_type == "pick" else self.settings.auto_ban_champion_ids
                candidates = self._profile_candidates(configured.champions, position) if configured.enabled else list(legacy_candidates)
                action_key = f"{action_type}:{action.get('id')}"
                if action_type not in {"pick", "ban"} or not candidates or action_key in self._handled_champion_actions:
                    continue
                available_path = "/lol-champ-select/v1/pickable-champion-ids" if action_type == "pick" else "/lol-champ-select/v1/bannable-champion-ids"
                available = await self.request("GET", available_path)
                if action_type == "pick" and profile.pick.enabled and not profile.pick.ignore_intent:
                    candidates = [value for value in candidates if value not in teammate_intents]
                champion_id = next((value for value in candidates if value in (available or [])), None)
                if champion_id is None:
                    continue
                delay = configured.delay_seconds if configured.enabled else self.settings.champion_action_delay_seconds
                strategy = configured.strategy if configured.enabled else ("show-and-lock-in" if self.settings.champion_lock_in else "just-show")
                if action_type == "pick" and profile.pick.enabled and profile.pick.show_intent and strategy != "lock-in-immediately":
                    await self.request("PATCH", f"/lol-champ-select/v1/session/actions/{action.get('id')}", json_body={"championId": champion_id, "type": action_type, "completed": False})
                await asyncio.sleep(delay)
                if strategy != "just-show":
                    await self.request("PATCH", f"/lol-champ-select/v1/session/actions/{action.get('id')}", json_body={"championId": champion_id, "type": action_type, "completed": True})
                self._handled_champion_actions.add(action_key)
                self.last_action = f"[{group}] 已自动{'选择' if action_type == 'pick' else '禁用'}英雄 {champion_id}"
                self.last_action_at = time.time()

        if profile.pick.enabled and profile.pick.bench_handle_trade_enabled:
            await self._run_trade_handling(session, self._profile_candidates(profile.pick.champions, position))
        if profile.pick.enabled and session.get("benchEnabled"):
            await self._run_bench_swap(session, profile.pick, position)

    async def _run_trade_handling(self, session: dict, expected: list[int]) -> None:
        for trade in session.get("trades") or []:
            trade_id = str(trade.get("id") or "") if isinstance(trade, dict) else ""
            if not trade_id or trade_id in self._handled_trades or trade.get("state") not in {"AVAILABLE", "PENDING", "RECEIVED"}:
                continue
            requester_cell = trade.get("requesterCellId")
            requester = next((item for item in (session.get("myTeam") or []) if item.get("cellId") == requester_cell), {})
            requester_champion = int(requester.get("championId") or 0)
            if requester_champion not in expected:
                continue
            await self.request("POST", f"/lol-champ-select/v1/session/trades/{trade_id}/accept")
            self._handled_trades.add(trade_id)
            self.last_action = f"已接受英雄交换：{requester_champion}"
            self.last_action_at = time.time()

    async def _run_bench_swap(self, session: dict, profile: PickProfile, position: str) -> None:
        expected = self._profile_candidates(profile.champions, position)
        bench = [int(item.get("championId")) for item in (session.get("benchChampions") or []) if isinstance(item, dict) and item.get("championId")]
        candidate = next((champion_id for champion_id in expected if champion_id in bench), None)
        if candidate is None and profile.bench_select_first_available_champion and bench:
            candidate = bench[0]
        if candidate is None:
            self._bench_candidate_since.clear()
            return
        started = self._bench_candidate_since.setdefault(candidate, time.monotonic())
        if time.monotonic() - started < profile.bench_swap_accumulated_delay_seconds:
            return
        await self.request("POST", f"/lol-champ-select/v1/session/bench/swap/{candidate}")
        self._bench_candidate_since.clear()
        self.last_action = f"已从备战席换取英雄 {candidate}"
        self.last_action_at = time.time()

    async def _run_champion_config(self) -> None:
        champion_id = await self.request("GET", "/lol-champ-select/v1/current-champion")
        if not isinstance(champion_id, int) or champion_id <= 0 or champion_id == self._configured_champion_id:
            return
        loadout = next((item for item in self.settings.champion_loadouts if item.champion_id == champion_id), None)
        if loadout is None:
            return
        await self.request("PATCH", "/lol-champ-select/v1/session/my-selection", json_body={
            "spell1Id": loadout.spell1_id,
            "spell2Id": loadout.spell2_id,
        })
        pages = await self.request("GET", "/lol-perks/v1/pages")
        editable = next((page for page in (pages or []) if isinstance(page, dict) and page.get("isEditable")), None)
        page_body = {
            "name": f"[Insight] Champion {champion_id}",
            "primaryStyleId": loadout.primary_style_id,
            "subStyleId": loadout.sub_style_id,
            "selectedPerkIds": loadout.selected_perk_ids,
            "current": True,
        }
        if editable and editable.get("id") is not None:
            page_id = editable["id"]
            await self.request("PUT", f"/lol-perks/v1/pages/{page_id}", json_body=page_body)
        else:
            created = await self.request("POST", "/lol-perks/v1/pages", json_body=page_body)
            page_id = created.get("id") if isinstance(created, dict) else None
        if page_id is not None:
            await self.request("PUT", "/lol-perks/v1/currentpage", json_body=page_id)
        self._configured_champion_id = champion_id
        self.last_action = f"已应用英雄 {champion_id} 的符文与召唤师技能"
        self.last_action_at = time.time()

    async def _run_auto_honor(self) -> None:
        ballot = await self.request("GET", "/lol-honor-v2/v1/ballot/")
        if not isinstance(ballot, dict):
            return
        game_id = str(ballot.get("gameId") or "")
        if not game_id or game_id == self._honored_game_id:
            return
        votes = int((ballot.get("votePool") or {}).get("votes") or 0)
        strategy = self.settings.auto_honor_strategy
        if strategy == "opt-out":
            await self.request("POST", "/lol-honor/v1/ballot")
            self._honored_game_id = game_id
            self.last_action = "已按设置跳过点赞"
            self.last_action_at = time.time()
            return
        allies = [item for item in (ballot.get("eligibleAllies") or []) if isinstance(item, dict) and not item.get("botPlayer") and item.get("puuid")]
        opponents = [item for item in (ballot.get("eligibleOpponents") or []) if isinstance(item, dict) and not item.get("botPlayer") and item.get("puuid")]
        lobby_puuids: set[str] = set()
        try:
            eog = await self.request("GET", "/lol-lobby/v2/eog-status")
            for key in ("eogPlayers", "leftPlayers", "readyPlayers"):
                lobby_puuids.update(str(value) for value in ((eog or {}).get(key) or []))
        except RuntimeError:
            pass
        lobby_allies = [item for item in allies if str(item.get("puuid")) in lobby_puuids]
        other_allies = [item for item in allies if str(item.get("puuid")) not in lobby_puuids]
        if strategy == "only-lobby-member":
            eligible = lobby_allies
        elif strategy == "all-member":
            eligible = allies
        elif strategy == "all-member-including-opponent":
            eligible = allies + opponents
        else:
            eligible = lobby_allies + other_allies + opponents
        candidates = random.sample(eligible, min(votes, len(eligible))) if eligible else []
        if not candidates:
            self._honored_game_id = game_id
            return
        categories = ("COOL", "HEART", "SHOTCALLER")
        for index, player in enumerate(candidates):
            await self.request("POST", "/lol-honor/v1/honor", json_body={
                "honorType": categories[index % len(categories)], "recipientPuuid": player.get("puuid"),
            })
        await self.request("POST", "/lol-honor/v1/ballot")
        self._honored_game_id = game_id
        self.last_action = "已自动点赞队友"
        self.last_action_at = time.time()

    async def _run_auto_matchmaking(self) -> None:
        settings = self.settings
        if not settings.auto_matchmaking_enabled or self.phase not in {"Lobby", "Matchmaking"}:
            self._matchmaking_due_at = None
            self._matchmaking_status = "idle"
            return
        try:
            lobby = await self.request("GET", "/lol-lobby/v2/lobby")
        except RuntimeError:
            self._matchmaking_status = "lobby-unavailable"
            return
        if not isinstance(lobby, dict) or (lobby.get("gameConfig") or {}).get("isCustom"):
            self._matchmaking_status = "unsupported-lobby"
            self._matchmaking_due_at = None
            return
        local = lobby.get("localMember") or {}
        members = lobby.get("members") or []
        if not local.get("isLeader"):
            self._matchmaking_status = "not-leader"
            self._matchmaking_due_at = None
            return
        if len(members) < settings.auto_matchmaking_minimum_members:
            self._matchmaking_status = "insufficient-members"
            self._matchmaking_due_at = None
            return
        if settings.auto_matchmaking_wait_for_invitees and any(item.get("state") == "Pending" for item in (lobby.get("invitations") or [])):
            self._matchmaking_status = "waiting-for-invitees"
            self._matchmaking_due_at = None
            return
        try:
            search = await self.request("GET", "/lol-matchmaking/v1/search")
        except RuntimeError:
            search = None
        if isinstance(search, dict) and (search.get("isCurrentlyInQueue") or search.get("searchState") == "Searching"):
            self._matchmaking_status = "searching"
            penalty = float(((search.get("lowPriorityData") or {}).get("penaltyTime")) or 0)
            elapsed = max(0.0, float(search.get("timeInQueue") or 0) - penalty)
            limit = settings.auto_matchmaking_rematch_fixed_duration
            if settings.auto_matchmaking_rematch_strategy == "estimated-duration":
                limit = float(search.get("estimatedQueueTime") or 0)
            if settings.auto_matchmaking_rematch_strategy != "never" and limit > 0 and elapsed >= limit:
                await self._record_action("已按重排策略取消匹配", "DELETE", "/lol-lobby/v2/lobby/matchmaking/search")
                self._matchmaking_status = "rematch-cancelled"
            return
        errors = ((search or {}).get("errors") or []) if isinstance(search, dict) else []
        if any(float(item.get("penaltyTimeRemaining") or 0) > 0 for item in errors if isinstance(item, dict)):
            self._matchmaking_status = "waiting-for-penalty"
            self._matchmaking_due_at = None
            return
        if not lobby.get("canStartActivity", True):
            self._matchmaking_status = "cannot-start"
            self._matchmaking_due_at = None
            return
        if self._matchmaking_due_at is None:
            self._matchmaking_due_at = time.monotonic() + settings.auto_matchmaking_delay_seconds
            self._matchmaking_status = "countdown"
        if time.monotonic() >= self._matchmaking_due_at:
            await self._record_action("已自动开始匹配", "POST", "/lol-lobby/v2/lobby/matchmaking/search")
            self._matchmaking_due_at = None
            self._matchmaking_status = "searching"

    async def _run_aram_team_side(self) -> None:
        if not self.settings.auto_send_aram_team_side_enabled or self.phase != "ChampSelect":
            if self.phase != "ChampSelect":
                self._aram_side_sent_context = ""
            return
        try:
            session = await self.request("GET", "/lol-champ-select/v1/session")
            gameflow = await self.request("GET", "/lol-gameflow/v1/session")
            conversations = await self.request("GET", "/lol-chat/v1/conversations")
        except RuntimeError:
            return
        if not isinstance(session, dict) or not session.get("benchEnabled"):
            return
        game_mode = str(((gameflow or {}).get("map") or {}).get("gameMode") or "").upper()
        if game_mode not in {"ARAM", "KIWI"}:
            return
        local_cell = session.get("localPlayerCellId")
        member = next((row for row in (session.get("myTeam") or []) if row.get("cellId") == local_cell), {})
        team = int(member.get("team") or 0)
        if team not in {1, 2}:
            return
        conversation_rows = conversations if isinstance(conversations, list) else []
        conversation = next(
            (
                row
                for row in conversation_rows
                if isinstance(row, dict) and str(row.get("type") or "").lower() in {"championselect", "champion-select"}
            ),
            None,
        )
        if not conversation or not conversation.get("id"):
            return
        context = f"{conversation['id']}:{team}"
        if context == self._aram_side_sent_context:
            return
        labels = {1: "本局位于左侧（蓝方）", 2: "本局位于右侧（红方）"}
        body = labels[team]
        await self.request(
            "POST",
            f"/lol-chat/v1/conversations/{conversation['id']}/messages",
            json_body={
                "body": body if self.settings.auto_send_aram_team_side_visible_to_team else f"[Insight] {body}",
                "type": "chat" if self.settings.auto_send_aram_team_side_visible_to_team else "celebration",
            },
        )
        self._aram_side_sent_context = context
        self.last_action = f"已发送大乱斗阵营：{labels[team]}"
        self.last_action_at = time.time()

    async def _run_lobby_automation(self) -> None:
        settings = self.settings
        if settings.auto_skip_leader_enabled and self.phase == "Lobby":
            try:
                lobby = await self.request("GET", "/lol-lobby/v2/lobby")
            except RuntimeError:
                lobby = None
            if isinstance(lobby, dict):
                local_member = lobby.get("localMember") or {}
                lobby_id = str(lobby.get("partyId") or lobby.get("gameConfig", {}).get("gameId") or "lobby")
                if local_member.get("isLeader") and self._leader_handoff_lobby != lobby_id:
                    others = [member for member in (lobby.get("members") or []) if member.get("summonerId") != local_member.get("summonerId") and not member.get("isSpectator")]
                    ready = [member for member in others if member.get("ready")]
                    candidate = (ready or others or [None])[0]
                    if candidate and candidate.get("summonerId"):
                        await self._record_action("已自动转交房主", "POST", f"/lol-lobby/v2/lobby/members/{candidate['summonerId']}/promote")
                        self._leader_handoff_lobby = lobby_id

        if not settings.auto_handle_invitations_enabled and settings.invitation_strategy == "ignore":
            return
        if settings.reject_invitation_when_away:
            try:
                chat_me = await self.request("GET", "/lol-chat/v1/me")
            except RuntimeError:
                chat_me = {}
            if isinstance(chat_me, dict) and chat_me.get("availability") == "away":
                return
        invitations = await self.request("GET", "/lol-lobby/v2/received-invitations")
        candidates = []
        for invitation in invitations if isinstance(invitations, list) else []:
            if not isinstance(invitation, dict) or invitation.get("state") not in {None, "Pending"} or invitation.get("canAcceptInvitation") is False:
                continue
            invite_id = str(invitation.get("invitationId") or "")
            if not invite_id or invite_id in self._handled_invitations:
                continue
            invite_type = str((invitation.get("gameConfig") or {}).get("inviteGameType") or "<DEFAULT>")
            strategies = settings.invitation_handling_strategies
            action = strategies.get(invite_type) or strategies.get("<DEFAULT>") or settings.invitation_strategy
            candidates.append((0 if action == "accept" else 1 if action == "decline" else 2, invite_id, action, invite_type))
        if not candidates:
            return
        _, invite_id, action, invite_type = sorted(candidates)[0]
        if action == "ignore":
            return
        await self._record_action(
            f"已自动{'接受' if action == 'accept' else '拒绝'} {invite_type} 房间邀请",
            "POST", f"/lol-lobby/v2/received-invitations/{invite_id}/{action}",
        )
        self._handled_invitations.add(invite_id)

    async def _run_automation(self) -> None:
        settings = self.settings
        phase = self.phase
        if not settings.automation_enabled:
            self._accept_due_at = None
            return

        if phase != self._acted_phase:
            self._acted_phase = phase
            self._phase_action_done = ""
            self._accept_due_at = None
            delay_by_phase = {
                "WaitingForStats": 10.0,
                "PreEndOfGame": 3.25,
                "EndOfGame": 1.575,
                "Reconnect": 10.0,
            }
            delay = delay_by_phase.get(phase)
            self._phase_action_due_at = time.monotonic() + delay if delay is not None else None

        if phase == "ReadyCheck" and settings.auto_accept_enabled:
            if self._accept_due_at is None:
                self._accept_due_at = time.monotonic() + settings.auto_accept_delay_seconds
            if time.monotonic() >= self._accept_due_at:
                await self._record_action("已自动接受对局", "POST", "/lol-matchmaking/v1/ready-check/accept")
                self._accept_due_at = float("inf")
        else:
            self._accept_due_at = None

        if phase == "ChampSelect":
            if settings.auto_select_enabled:
                await self._run_auto_select()
            if settings.auto_champion_config_enabled:
                await self._run_champion_config()
        else:
            self._handled_champion_actions.clear()
            self._handled_trades.clear()
            self._bench_candidate_since.clear()
            self._configured_champion_id = 0

        if phase in {"EndOfGame", "WaitingForStats", "PreEndOfGame"} and settings.play_again_enabled:
            if self._phase_action_done != "play-again" and time.monotonic() >= (self._phase_action_due_at or 0):
                await self._record_action("已自动返回房间", "POST", "/lol-lobby/v2/play-again")
                self._phase_action_done = "play-again"
        elif phase == "Reconnect" and settings.auto_reconnect_enabled:
            if self._phase_action_done != "reconnect" and time.monotonic() >= (self._phase_action_due_at or 0):
                await self._record_action("已自动重新连接", "POST", "/lol-gameflow/v1/reconnect")
                self._phase_action_done = "reconnect"

        if phase in {"PreEndOfGame", "EndOfGame"} and settings.auto_honor_enabled:
            await self._run_auto_honor()

        await self._run_auto_matchmaking()
        await self._run_aram_team_side()
        await self._run_lobby_automation()

    async def _run(self) -> None:
        while True:
            try:
                if await self.refresh_connection():
                    await self._refresh_state()
                    await self._run_automation()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("League lab background loop failed")
            timeout = 5.0 if self.credentials else 5.0
            try:
                await asyncio.wait_for(self._event_wakeup.wait(), timeout=timeout)
                self._event_wakeup.clear()
            except asyncio.TimeoutError:
                pass


league_lab_service = LeagueLabService()


async def _champion_names() -> dict[int, str]:
    try:
        rows = await league_lab_service.request("GET", "/lol-game-data/assets/v1/champion-summary.json")
    except RuntimeError:
        return {}
    return {int(row.get("id")): str(row.get("name") or row.get("alias") or row.get("id")) for row in (rows or []) if isinstance(row, dict) and row.get("id")}


def _champion_catalog_path() -> Path:
    return get_data_dir() / "league-champion-catalog.json"


async def _champion_catalog() -> list[dict]:
    rows = None
    try:
        rows = await league_lab_service.request("GET", "/lol-game-data/assets/v1/champion-summary.json")
    except RuntimeError:
        try:
            rows = json.loads(_champion_catalog_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            rows = []
    normalized = [
        {
            "id": int(row.get("id")),
            "name": str(row.get("name") or row.get("alias") or row.get("id")),
            "alias": str(row.get("alias") or ""),
            "roles": [str(role).lower() for role in (row.get("roles") or [])],
        }
        for row in (rows or []) if isinstance(row, dict) and int(row.get("id") or 0) > 0
    ]
    if normalized and league_lab_service.credentials:
        path = _champion_catalog_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(normalized, ensure_ascii=False), encoding="utf-8")
    return normalized


def _player_tags_path() -> Path:
    return get_data_dir() / "league-player-tags.json"


def _read_player_tags() -> dict[str, dict]:
    try:
        body = json.loads(_player_tags_path().read_text(encoding="utf-8"))
        return body if isinstance(body, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_player_tags(body: dict[str, dict]) -> None:
    path = _player_tags_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def _normalize_match_rows(payload: dict, names: dict[int, str], puuid: str = "") -> list[dict]:
    games = ((payload or {}).get("games") or {}).get("games") or []
    normalized = []
    for game in games:
        identities = game.get("participantIdentities") or []
        identity = next(
            (
                row
                for row in identities
                if not puuid or str((row.get("player") or {}).get("puuid") or row.get("puuid") or "") == puuid
            ),
            identities[0] if identities else None,
        )
        participant_id = identity.get("participantId") if identity else None
        participant = next(
            (p for p in (game.get("participants") or []) if p.get("participantId") == participant_id), None
        )
        if not participant:
            continue
        stats = participant.get("stats") or {}
        champion_id = int(participant.get("championId") or 0)
        normalized.append(
            {
                "game_id": game.get("gameId"),
                "played_at": game.get("gameCreationDate") or game.get("gameCreation"),
                "duration_seconds": game.get("gameDuration"),
                "game_mode": game.get("gameMode"),
                "queue_id": game.get("queueId"),
                "champion_id": champion_id,
                "champion_name": names.get(champion_id, str(champion_id)),
                "spell1_id": participant.get("spell1Id"),
                "spell2_id": participant.get("spell2Id"),
                "kills": stats.get("kills", 0),
                "deaths": stats.get("deaths", 0),
                "assists": stats.get("assists", 0),
                "win": bool(stats.get("win")),
                "cs": int(stats.get("totalMinionsKilled", 0)) + int(stats.get("neutralMinionsKilled", 0)),
                "gold": stats.get("goldEarned", 0),
                "damage": stats.get("totalDamageDealtToChampions", 0),
                "items": [stats.get(f"item{i}") for i in range(7) if stats.get(f"item{i}")],
            }
        )
    return normalized


@router.get("/status")
async def league_lab_status():
    return await league_lab_service.snapshot()


@router.put("/settings")
async def update_league_lab_settings(body: LeagueLabSettings):
    league_lab_service.update_settings(body)
    return league_lab_service.status()


@router.get("/matches")
async def league_match_history(limit: int = 20):
    try:
        payload = await league_lab_service.request(
            "GET", "/lol-match-history/v1/products/lol/current-summoner/matches",
            params={"begIndex": 0, "endIndex": max(0, min(limit, 40) - 1)},
        )
        names = await _champion_names()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    normalized = _normalize_match_rows(payload, names)
    return {"matches": normalized, "count": len(normalized)}


@router.get("/players/current")
async def current_league_player():
    try:
        summoner = await league_lab_service.request("GET", "/lol-summoner/v1/current-summoner")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return await _load_player_bundle(summoner)


@router.get("/players/{puuid}")
async def league_player_bundle(puuid: str, match_limit: int = 20):
    try:
        summoner = await league_lab_service.request("GET", f"/lol-summoner/v2/summoners/puuid/{puuid}")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return await _load_player_bundle(summoner, match_limit=max(1, min(match_limit, 40)))


async def _load_player_bundle(summoner, match_limit: int = 20) -> dict:
    if not isinstance(summoner, dict) or not summoner.get("puuid"):
        raise HTTPException(status_code=404, detail="未找到召唤师")
    puuid = str(summoner["puuid"])

    async def optional(method: str, path: str, **kwargs):
        try:
            return await league_lab_service.request(method, path, **kwargs)
        except RuntimeError:
            return None

    ranked, mastery, history, names = await asyncio.gather(
        optional("GET", f"/lol-ranked/v1/ranked-stats/{puuid}"),
        optional("POST", f"/lol-champion-mastery/v1/{puuid}/champion-mastery/top", json_body={"skipCache": True}, params={"count": 10}),
        optional(
            "GET",
            f"/lol-match-history/v1/products/lol/{puuid}/matches",
            params={"begIndex": 0, "endIndex": match_limit - 1},
        ),
        _champion_names(),
    )
    tags = _read_player_tags().get(puuid) or {}
    return {
        "summoner": {
            "puuid": puuid,
            "game_name": summoner.get("gameName") or summoner.get("displayName"),
            "tag_line": summoner.get("tagLine") or "",
            "summoner_level": summoner.get("summonerLevel"),
            "profile_icon_id": summoner.get("profileIconId"),
        },
        "ranked": ranked or {},
        "mastery": mastery or {},
        "matches": _normalize_match_rows(history or {}, names, puuid),
        "tag": tags,
    }


class PlayerTagBody(BaseModel):
    label: str = Field(default="", max_length=40)
    note: str = Field(default="", max_length=500)
    color: str = Field(default="emerald", max_length=24)


@router.put("/players/{puuid}/tag")
async def save_league_player_tag(puuid: str, body: PlayerTagBody):
    tags = _read_player_tags()
    if body.label or body.note:
        tags[puuid] = body.model_dump()
    else:
        tags.pop(puuid, None)
    _write_player_tags(tags)
    return {"puuid": puuid, "tag": tags.get(puuid)}


@router.get("/ongoing-game")
async def league_ongoing_game():
    try:
        gameflow = await league_lab_service.request("GET", "/lol-gameflow/v1/session")
        names = await _champion_names()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    game_data = (gameflow or {}).get("gameData") or {}
    selections = game_data.get("playerChampionSelections") or []
    players = []
    for row in selections:
        if not isinstance(row, dict):
            continue
        puuid = str(row.get("puuid") or row.get("playerPuuid") or "")
        summoner = None
        ranked = None
        if puuid:
            try:
                summoner, ranked = await asyncio.gather(
                    league_lab_service.request("GET", f"/lol-summoner/v2/summoners/puuid/{puuid}"),
                    league_lab_service.request("GET", f"/lol-ranked/v1/ranked-stats/{puuid}"),
                )
            except RuntimeError:
                pass
        champion_id = int(row.get("championId") or 0)
        players.append(
            {
                "puuid": puuid,
                "team": row.get("team") or row.get("teamId"),
                "champion_id": champion_id,
                "champion_name": names.get(champion_id, str(champion_id)),
                "summoner": summoner or {},
                "ranked": ranked or {},
                "tag": _read_player_tags().get(puuid) or {},
            }
        )
    return {
        "phase": league_lab_service.phase,
        "queue": game_data.get("queue") or {},
        "game_id": game_data.get("gameId"),
        "players": players,
        "available": bool(players),
    }


@router.get("/champions")
async def league_champion_catalog():
    champions = await _champion_catalog()
    return {"champions": champions, "count": len(champions), "source": "lcu" if league_lab_service.credentials else "cache"}


@router.get("/loadout-catalog")
async def league_loadout_catalog():
    try:
        styles, spells = await asyncio.gather(
            league_lab_service.request("GET", "/lol-game-data/assets/v1/perkstyles.json"),
            league_lab_service.request("GET", "/lol-game-data/assets/v1/summoner-spells.json"),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    normalized_styles = []
    for style in styles if isinstance(styles, list) else []:
        if not isinstance(style, dict) or not style.get("id"):
            continue
        perks = []
        for slot in style.get("slots") or []:
            perks.extend(
                {
                    "id": int(perk.get("id")),
                    "name": str(perk.get("name") or perk.get("id")),
                    "icon_path": perk.get("iconPath") or "",
                }
                for perk in (slot.get("perks") or [])
                if isinstance(perk, dict) and perk.get("id")
            )
        normalized_styles.append(
            {
                "id": int(style["id"]),
                "name": str(style.get("name") or style["id"]),
                "icon_path": style.get("iconPath") or "",
                "perks": perks,
            }
        )
    spell_rows = spells if isinstance(spells, list) else list(spells.values()) if isinstance(spells, dict) else []
    normalized_spells = [
        {
            "id": int(spell.get("id")),
            "name": str(spell.get("name") or spell.get("id")),
            "description": str(spell.get("description") or ""),
            "icon_path": spell.get("iconPath") or "",
        }
        for spell in spell_rows
        if isinstance(spell, dict) and spell.get("id")
    ]
    return {"styles": normalized_styles, "spells": normalized_spells}


@router.post("/actions/{action}")
async def run_league_lab_action(action: Literal["accept", "play-again", "reconnect", "start-matchmaking", "stop-matchmaking"]):
    endpoints = {
        "accept": ("接受对局", "/lol-matchmaking/v1/ready-check/accept"),
        "play-again": ("返回房间", "/lol-lobby/v2/play-again"),
        "reconnect": ("重新连接", "/lol-gameflow/v1/reconnect"),
        "start-matchmaking": ("开始匹配", "/lol-lobby/v2/lobby/matchmaking/search"),
        "stop-matchmaking": ("停止匹配", "/lol-lobby/v2/lobby/matchmaking/search"),
    }
    label, path = endpoints[action]
    try:
        method = "DELETE" if action == "stop-matchmaking" else "POST"
        await league_lab_service._record_action(label, method, path)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return league_lab_service.status()
