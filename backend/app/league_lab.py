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
import stat
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx
import aiosqlite
import websockets
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from .env_utils import get_data_dir


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/league-lab", tags=["league-lab"])

_PORT_RE = re.compile(r"--app-port=(\d+)")
_TOKEN_RE = re.compile(r"--remoting-auth-token=([\w_-]+)")
_REGION_RE = re.compile(r"--region=([\w_-]+)", re.IGNORECASE)
_PLATFORM_RE = re.compile(r"--rso[_-]platform[_-]id=([\w_-]+)", re.IGNORECASE)
_RIOT_CLIENT_PORT_RE = re.compile(r"--riotclient-app-port=(\d+)")
_RIOT_CLIENT_TOKEN_RE = re.compile(r"--riotclient-auth-token=([\w_-]+)")


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
    auto_set_status_message_enabled: bool = False
    status_message: str = Field(default="", max_length=500)
    auto_set_ranked_status_enabled: bool = False
    ranked_status: "RankedStatusUpdate" = Field(default_factory=lambda: RankedStatusUpdate())
    auto_send_aram_team_side_enabled: bool = False
    auto_send_aram_team_side_visible_to_team: bool = False
    auto_invite_friend_puuids: list[str] = Field(default_factory=list, max_length=20)
    mini_enabled: bool = True
    mini_auto_show: bool = True
    respawn_timer_enabled: bool = False
    cooldown_timer_enabled: bool = False
    cooldown_timer_type: Literal["countdown", "countup"] = "countdown"
    cooldown_timer_reverse_adjustment: bool = False
    streamer_mode_enabled: bool = False
    streamer_mode_use_aliases: bool = False
    streamer_content_protection_enabled: bool = False


class ChampionLoadout(BaseModel):
    champion_id: int = Field(gt=0)
    config_key: str = Field(default="default", pattern=r"^(default|normal|aram|urf|nexusblitz|ultbook|ranked-default|ranked-(top|jungle|middle|bottom|utility))$")
    primary_style_id: int = Field(gt=0)
    sub_style_id: int = Field(gt=0)
    selected_perk_ids: list[int] = Field(default_factory=list)
    spell1_id: int = Field(gt=0)
    spell2_id: int = Field(gt=0)


class ChatPresenceUpdate(BaseModel):
    availability: Literal["chat", "mobile", "away", "offline", "dnd", "spectating", "online"] | None = None
    status_message: str | None = Field(default=None, max_length=500)


class RankedStatusUpdate(BaseModel):
    queue: str = Field(default="RANKED_SOLO_5x5", min_length=1, max_length=80)
    tier: Literal[
        "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"
    ] = "CHALLENGER"
    division: Literal["I", "II", "III", "IV"] = "I"


class ChatMessageSend(BaseModel):
    lines: list[str] = Field(min_length=1, max_length=10)


class InGameTextSend(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class GameSettingsFileModeUpdate(BaseModel):
    mode: Literal["readonly", "writable"]


class LeagueClientWindowResize(BaseModel):
    base_width: int = Field(default=1280, ge=640, le=3840)
    base_height: int = Field(default=720, ge=360, le=2160)


LeagueLabSettings.model_rebuild()


@dataclass(frozen=True)
class LcuCredentials:
    port: int
    token: str
    region: str = ""
    platform_id: str = ""
    riot_client_port: int = 0
    riot_client_token: str = ""

    @property
    def base_url(self) -> str:
        return f"https://127.0.0.1:{self.port}"

    @property
    def auth_header(self) -> str:
        encoded = base64.b64encode(f"riot:{self.token}".encode("utf-8")).decode("ascii")
        return f"Basic {encoded}"

    @property
    def riot_client_base_url(self) -> str:
        return f"https://127.0.0.1:{self.riot_client_port}"

    @property
    def riot_client_auth_header(self) -> str:
        encoded = base64.b64encode(f"riot:{self.riot_client_token}".encode("utf-8")).decode("ascii")
        return f"Basic {encoded}"


def parse_league_client_command_line(command_line: str) -> LcuCredentials | None:
    port_match = _PORT_RE.search(command_line or "")
    token_match = _TOKEN_RE.search(command_line or "")
    if not port_match or not token_match:
        return None
    region_match = _REGION_RE.search(command_line)
    platform_match = _PLATFORM_RE.search(command_line)
    riot_client_port_match = _RIOT_CLIENT_PORT_RE.search(command_line)
    riot_client_token_match = _RIOT_CLIENT_TOKEN_RE.search(command_line)
    return LcuCredentials(
        port=int(port_match.group(1)),
        token=token_match.group(1),
        region=region_match.group(1) if region_match else "",
        platform_id=platform_match.group(1) if platform_match else "",
        riot_client_port=int(riot_client_port_match.group(1)) if riot_client_port_match else 0,
        riot_client_token=riot_client_token_match.group(1) if riot_client_token_match else "",
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


def _terminate_foreground_league_game_client() -> int:
    """Terminate only a foreground League of Legends.exe process."""
    if os.name != "nt":
        raise RuntimeError("游戏进程控制仅支持 Windows")
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.TerminateProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        raise RuntimeError("当前没有前台窗口")
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not pid.value:
        raise RuntimeError("无法识别前台进程")
    process_query_limited_information = 0x1000
    process_terminate = 0x0001
    handle = kernel32.OpenProcess(
        process_query_limited_information | process_terminate,
        False,
        pid.value,
    )
    if not handle:
        raise RuntimeError("无法访问前台进程；若游戏以管理员身份运行，请以相同权限启动本软件")
    try:
        size = wintypes.DWORD(32768)
        image_path = ctypes.create_unicode_buffer(size.value)
        if not kernel32.QueryFullProcessImageNameW(handle, 0, image_path, ctypes.byref(size)):
            raise RuntimeError("无法验证前台进程名称")
        if Path(image_path.value).name.casefold() != "league of legends.exe":
            raise RuntimeError("当前前台窗口不是 League 游戏进程，未执行任何操作")
        if not kernel32.TerminateProcess(handle, 1):
            raise RuntimeError("结束 League 游戏进程失败")
        return int(pid.value)
    finally:
        kernel32.CloseHandle(handle)


def _send_text_to_foreground_league_game(text: str) -> int:
    """Send explicit user-requested chat text only to a foreground League game window."""
    if os.name != "nt":
        raise RuntimeError("游戏内文字发送仅支持 Windows")
    normalized = text.strip()
    if not normalized:
        raise RuntimeError("发送内容不能为空")
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        raise RuntimeError("当前没有前台窗口")
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not pid.value:
        raise RuntimeError("无法识别前台进程")
    handle = kernel32.OpenProcess(0x1000, False, pid.value)
    if not handle:
        raise RuntimeError("无法访问前台进程；若游戏以管理员身份运行，请以相同权限启动本软件")
    try:
        size = wintypes.DWORD(32768)
        image_path = ctypes.create_unicode_buffer(size.value)
        if not kernel32.QueryFullProcessImageNameW(handle, 0, image_path, ctypes.byref(size)):
            raise RuntimeError("无法验证前台进程名称")
        if Path(image_path.value).name.casefold() != "league of legends.exe":
            raise RuntimeError("当前前台窗口不是 League 游戏进程，未发送任何按键")
    finally:
        kernel32.CloseHandle(handle)

    class KeyboardInput(ctypes.Structure):
        _fields_ = [
            ("virtual_key", wintypes.WORD),
            ("scan_code", wintypes.WORD),
            ("flags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("extra_info", ctypes.c_size_t),
        ]

    class InputUnion(ctypes.Union):
        _fields_ = [("keyboard", KeyboardInput)]

    class Input(ctypes.Structure):
        _anonymous_ = ("value",)
        _fields_ = [("input_type", wintypes.DWORD), ("value", InputUnion)]

    user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int]
    user32.SendInput.restype = wintypes.UINT

    def send_key(virtual_key: int = 0, scan_code: int = 0, flags: int = 0) -> None:
        event = Input(input_type=1, keyboard=KeyboardInput(virtual_key, scan_code, flags, 0, 0))
        if user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(Input)) != 1:
            raise RuntimeError("Windows 未接受游戏内键盘输入")

    send_key(0x0D)
    time.sleep(0.02)
    send_key(0x0D, flags=0x0002)
    time.sleep(0.065)
    encoded = normalized.encode("utf-16-le")
    for index in range(0, len(encoded), 2):
        code_unit = int.from_bytes(encoded[index:index + 2], "little")
        send_key(scan_code=code_unit, flags=0x0004)
        send_key(scan_code=code_unit, flags=0x0004 | 0x0002)
    time.sleep(0.065)
    send_key(0x0D)
    time.sleep(0.02)
    send_key(0x0D, flags=0x0002)
    return int(pid.value)


class LeagueLabService:
    def __init__(self) -> None:
        self.settings = self._load_settings()
        self.credentials: LcuCredentials | None = None
        self.phase = ""
        self.game_mode = ""
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
        self._champion_action_due_at: dict[str, float] = {}
        self._handled_trades: set[str] = set()
        self._bench_candidate_since: dict[int, float] = {}
        self._leader_handoff_lobby = ""
        self._configured_champion_id = 0
        self._honored_game_id = ""
        self._matchmaking_due_at: float | None = None
        self._matchmaking_status = "idle"
        self._last_event_at = 0.0
        self._aram_side_sent_context = ""
        self._chat_ready_since: float | None = None
        self._chat_ready_automation_done = False
        self.champ_select: dict = {}
        self.respawn_timer: dict = {"available": False, "dead": False, "time_left": 0.0, "total_time": 0.0}
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
            self._champion_action_due_at.clear()
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
            self.game_mode = ""
            self.summoner_name = ""
            self.current_summoner = {}
            self._acted_phase = ""
            self._phase_action_done = ""
            self._phase_action_due_at = None
            self._accept_due_at = None
            self._champion_action_due_at.clear()
            self._matchmaking_due_at = None
            self._matchmaking_status = "idle"
            self._reset_chat_ready_automation()
            if credentials:
                self._event_task = asyncio.create_task(self._run_event_stream(credentials), name="league-lcu-events")
        return credentials is not None

    def _reset_chat_ready_automation(self) -> None:
        self._chat_ready_since = None
        self._chat_ready_automation_done = False

    def _interrupt_chat_ready_automation(self) -> None:
        self._chat_ready_since = None
        self._chat_ready_automation_done = True

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

        friend_match = re.fullmatch(r"/lol-chat/v1/friends/([^/]+)", uri)
        if friend_match and self.settings.automation_enabled and self.settings.auto_invite_friend_puuids:
            puuid = str(data.get("puuid") or "")
            if puuid in self.settings.auto_invite_friend_puuids and data.get("availability") == "chat":
                try:
                    lobby = await self.request("GET", "/lol-lobby/v2/lobby")
                except RuntimeError:
                    return
                members = (lobby or {}).get("members") or []
                if any(str(member.get("puuid") or "") == puuid for member in members):
                    return
                summoner_id = data.get("summonerId")
                if summoner_id and (lobby or {}).get("localMember", {}).get("allowedInviteOthers", True):
                    await self.request(
                        "POST",
                        "/lol-lobby/v2/lobby/invitations",
                        json_body=[{"toSummonerId": summoner_id}],
                    )
                    self.settings.auto_invite_friend_puuids = [
                        value for value in self.settings.auto_invite_friend_puuids if value != puuid
                    ]
                    self.update_settings(self.settings)
                    self.last_action = f"已自动邀请好友 {data.get('gameName') or puuid}"
                    self.last_action_at = time.time()

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
        except httpx.HTTPStatusError as exc:
            self.last_error = f"LCU 请求失败: {type(exc).__name__}"
            # Optional routes can legitimately be absent on some client builds.
            # A 404 does not invalidate the in-memory LCU credentials.
            if exc.response.status_code in {401, 403}:
                self.credentials = None
                self._reset_chat_ready_automation()
            raise RuntimeError(self.last_error) from exc
        except httpx.RequestError as exc:
            self.last_error = f"LCU 请求失败: {type(exc).__name__}"
            self.credentials = None
            self._reset_chat_ready_automation()
            raise RuntimeError(self.last_error) from exc
        except ValueError as exc:
            self.last_error = f"LCU 请求失败: {type(exc).__name__}"
            raise RuntimeError(self.last_error) from exc

    async def request_bytes(self, path: str) -> tuple[bytes, str]:
        if not await self.refresh_connection():
            raise RuntimeError("未检测到正在运行的英雄联盟客户端")
        assert self.credentials is not None
        try:
            async with httpx.AsyncClient(verify=False, timeout=3.0) as client:
                response = await client.get(
                    f"{self.credentials.base_url}{path}",
                    headers={"Authorization": self.credentials.auth_header},
                )
            response.raise_for_status()
            return response.content, response.headers.get("content-type", "image/png")
        except httpx.HTTPError as exc:
            self.last_error = f"LCU 资源请求失败: {type(exc).__name__}"
            raise RuntimeError(self.last_error) from exc

    async def riot_request(self, method: str, path: str, *, json_body=None, params=None):
        """Call the local Riot Client API without exposing its credentials outside this process."""
        if not await self.refresh_connection():
            raise RuntimeError("未检测到正在运行的英雄联盟客户端")
        credentials = self.credentials
        if not credentials or not credentials.riot_client_port or not credentials.riot_client_token:
            raise RuntimeError("英雄联盟客户端未提供 Riot Client 本地接口")
        try:
            async with httpx.AsyncClient(verify=False, timeout=5.0) as client:
                response = await client.request(
                    method,
                    f"{credentials.riot_client_base_url}{path}",
                    headers={"Authorization": credentials.riot_client_auth_header},
                    json=json_body,
                    params=params,
                )
            response.raise_for_status()
            if response.status_code == 204 or not response.content:
                return None
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise RuntimeError(f"Riot Client 请求失败: {type(exc).__name__}") from exc

    async def snapshot(self) -> dict:
        connected = await self.refresh_connection(force=True)
        if connected:
            await self._refresh_state()
        return self.status()

    def status(self) -> dict:
        credentials = self.credentials
        now_mono = time.monotonic()
        countdowns: list[tuple[str, str, float]] = []
        if self._accept_due_at is not None and self._accept_due_at != float("inf"):
            countdowns.append(("ready-check", "自动接受对局", self._accept_due_at))
        if self._champion_action_due_at:
            countdowns.append(("champion-action", "自动选择 / 禁用英雄", min(self._champion_action_due_at.values())))
        phase_action_enabled = (
            (self.phase == "Reconnect" and self.settings.auto_reconnect_enabled)
            or (self.phase in {"EndOfGame", "WaitingForStats", "PreEndOfGame"} and self.settings.play_again_enabled)
        )
        if self._phase_action_due_at is not None and not self._phase_action_done and phase_action_enabled:
            label = "自动重连" if self.phase == "Reconnect" else "自动返回房间"
            countdowns.append(("phase-action", label, self._phase_action_due_at))
        if self._matchmaking_due_at is not None:
            countdowns.append(("matchmaking", "自动开始匹配", self._matchmaking_due_at))
        next_countdown = min(countdowns, key=lambda item: item[2]) if countdowns else None
        action_countdown = None
        if next_countdown:
            kind, label, due_at = next_countdown
            action_countdown = {
                "kind": kind,
                "label": label,
                "due_at": time.time() + max(0.0, due_at - now_mono),
                "remaining_seconds": round(max(0.0, due_at - now_mono), 2),
            }
        return {
            "connected": credentials is not None,
            "phase": self.phase,
            "game_mode": self.game_mode,
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
            "action_countdown": action_countdown,
            "respawn_timer": self.respawn_timer,
            "cooldown_timer_should_show": self.settings.cooldown_timer_enabled and self.phase == "InProgress" and self.game_mode in {"CLASSIC", "PRACTICETOOL", "ARAM", "URF", "ONEFORALL", "NEXUSBLITZ", "ULTBOOK", "KIWI"},
            "mini_should_show": self.settings.mini_enabled and self.settings.mini_auto_show and self.phase in {"Lobby", "Matchmaking", "ReadyCheck", "ChampSelect"} and not bool(self.champ_select.get("is_spectating")),
            "settings": self.settings.model_dump(),
        }

    async def _refresh_state(self) -> None:
        try:
            phase = await self.request("GET", "/lol-gameflow/v1/gameflow-phase")
            self.phase = str(phase or "")
            if self.phase == "InProgress" and not self.game_mode:
                gameflow = await self.request("GET", "/lol-gameflow/v1/session")
                self.game_mode = str((((gameflow or {}).get("gameData") or {}).get("queue") or {}).get("gameMode") or "").upper()
            elif self.phase != "InProgress":
                self.game_mode = ""
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
                try:
                    skin_info, skin_rows = await asyncio.gather(
                        self.request("GET", "/lol-champ-select/v1/skin-selector-info"),
                        self.request("GET", "/lol-champ-select/v1/skin-carousel-skins"),
                    )
                    self.champ_select["skin_selector"] = _normalize_skin_selector(skin_info, skin_rows)
                except RuntimeError:
                    self.champ_select["skin_selector"] = {"available": False, "skins": []}
            else:
                self.champ_select = {}
        except RuntimeError:
            return

    async def _refresh_respawn_timer(self) -> None:
        """Read the local in-game Live Client Data endpoint without external credentials."""
        if not self.settings.respawn_timer_enabled or self.phase != "InProgress":
            self.respawn_timer = {"available": False, "dead": False, "time_left": 0.0, "total_time": 0.0}
            return
        try:
            async with httpx.AsyncClient(verify=False, timeout=1.5) as client:
                response = await client.get("https://127.0.0.1:2999/liveclientdata/playerlist")
            response.raise_for_status()
            players = response.json()
            own_name = str(self.current_summoner.get("game_name") or "").casefold()
            own_riot_id = f"{self.current_summoner.get('game_name') or ''}#{self.current_summoner.get('tag_line') or ''}".casefold()
            player = next((row for row in players if isinstance(row, dict) and (
                str(row.get("riotId") or "").casefold() == own_riot_id
                or str(row.get("summonerName") or "").casefold() == own_name
            )), None)
            timer = float((player or {}).get("respawnTimer") or 0.0)
            dead = bool((player or {}).get("isDead")) and timer > 0
            previous_total = float(self.respawn_timer.get("total_time") or 0.0)
            self.respawn_timer = {
                "available": player is not None,
                "dead": dead,
                "time_left": round(timer if dead else 0.0, 1),
                "total_time": round(max(previous_total if dead else 0.0, timer), 1),
            }
        except (httpx.HTTPError, TypeError, ValueError):
            self.respawn_timer = {"available": False, "dead": False, "time_left": 0.0, "total_time": 0.0}

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
        local_cell = session.get("localPlayerCellId")
        local_member = next((item for item in (session.get("myTeam") or []) if item.get("cellId") == local_cell), {})
        timer = session.get("timer") or {}
        return {
            "local_player_cell_id": session.get("localPlayerCellId"),
            "current_champion_id": local_member.get("championId") or local_member.get("championPickIntent"),
            "my_team": members,
            "bench_enabled": bool(session.get("benchEnabled")),
            "bench_champions": [int(item.get("championId")) for item in (session.get("benchChampions") or []) if isinstance(item, dict) and item.get("championId")],
            "rerolls_remaining": int(session.get("rerollsRemaining") or 0),
            "allow_rerolling": bool(session.get("allowRerolling")),
            "allow_subset_champion_picks": bool(session.get("allowSubsetChampionPicks")),
            "timer_phase": str(timer.get("phase") or ""),
            "timer_adjusted_time_left_ms": int(timer.get("adjustedTimeLeftInPhase") or timer.get("timeLeftInPhase") or 0),
            "timer_deadline_at": time.time() + max(0, int(timer.get("adjustedTimeLeftInPhase") or timer.get("timeLeftInPhase") or 0)) / 1000,
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
        subset_champion_ids: set[int] = set()
        if session.get("allowSubsetChampionPicks"):
            try:
                subset = await self.request("GET", "/lol-lobby-team-builder/champ-select/v1/subset-champion-list")
                subset_champion_ids = {int(value) for value in (subset or [])}
            except (RuntimeError, TypeError, ValueError):
                subset_champion_ids = set()
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
                available_ids = {int(value) for value in (available or [])}
                if action_type == "pick" and session.get("allowSubsetChampionPicks"):
                    available_ids &= subset_champion_ids
                champion_id = next(
                    (
                        value
                        for value in candidates
                        if value in available_ids or (action_type == "pick" and group == "arena" and value == -3)
                    ),
                    None,
                )
                if champion_id is None:
                    continue
                delay = configured.delay_seconds if configured.enabled else self.settings.champion_action_delay_seconds
                strategy = configured.strategy if configured.enabled else ("show-and-lock-in" if self.settings.champion_lock_in else "just-show")
                due_at = self._champion_action_due_at.get(action_key)
                if due_at is None:
                    if action_type == "pick" and profile.pick.enabled and profile.pick.show_intent and strategy != "lock-in-immediately":
                        await self.request("PATCH", f"/lol-champ-select/v1/session/actions/{action.get('id')}", json_body={"championId": champion_id, "type": action_type, "completed": False})
                    due_at = time.monotonic() + delay
                    self._champion_action_due_at[action_key] = due_at
                if time.monotonic() < due_at:
                    continue
                if strategy != "just-show":
                    await self.request("PATCH", f"/lol-champ-select/v1/session/actions/{action.get('id')}", json_body={"championId": champion_id, "type": action_type, "completed": True})
                self._champion_action_due_at.pop(action_key, None)
                self._handled_champion_actions.add(action_key)
                self.last_action = f"[{group}] 已自动{'选择' if action_type == 'pick' else '禁用'}英雄 {champion_id}"
                self.last_action_at = time.time()

        if profile.pick.enabled and profile.pick.bench_handle_trade_enabled:
            await self._run_trade_handling(session, self._profile_candidates(profile.pick.champions, position))
        if profile.pick.enabled and session.get("benchEnabled"):
            await self._run_bench_swap(session, profile.pick, position, subset_champion_ids)

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

    async def _run_bench_swap(
        self,
        session: dict,
        profile: PickProfile,
        position: str,
        subset_champion_ids: set[int] | None = None,
    ) -> None:
        expected = self._profile_candidates(profile.champions, position)
        bench = [
            int(item.get("championId"))
            for item in (session.get("benchChampions") or [])
            if isinstance(item, dict) and item.get("championId")
        ]
        if session.get("allowSubsetChampionPicks") and str((session.get("timer") or {}).get("phase") or "") == "BAN_PICK":
            bench = [champion_id for champion_id in bench if champion_id in (subset_champion_ids or set())]
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
        session = await self.request("GET", "/lol-champ-select/v1/session")
        try:
            gameflow = await self.request("GET", "/lol-gameflow/v1/session")
        except RuntimeError:
            gameflow = {}
        game_data = (gameflow or {}).get("gameData") or {} if isinstance(gameflow, dict) else {}
        queue = game_data.get("queue") or {}
        game_mode = str(queue.get("gameMode") or "").upper()
        queue_type = str(queue.get("type") or "").upper()
        position = self._position_for_session(session if isinstance(session, dict) else {})
        if game_mode == "CLASSIC" and queue_type.startswith("RANKED_"):
            config_keys = [f"ranked-{position}", "ranked-default", "default"]
        elif game_mode == "CLASSIC":
            config_keys = ["normal", "default"]
        else:
            mapped = {"ARAM": "aram", "KIWI": "aram", "URF": "urf", "NEXUSBLITZ": "nexusblitz", "ULTBOOK": "ultbook"}.get(game_mode)
            config_keys = [mapped, "default"] if mapped else ["default"]
        loadout = next(
            (item for key in config_keys for item in self.settings.champion_loadouts if item.champion_id == champion_id and item.config_key == key),
            None,
        )
        if loadout is None:
            return
        await self.request("PATCH", "/lol-champ-select/v1/session/my-selection", json_body={
            "spell1Id": loadout.spell1_id,
            "spell2Id": loadout.spell2_id,
        })
        pages = await self.request("GET", "/lol-perks/v1/pages")
        editable = next((page for page in (pages or []) if isinstance(page, dict) and page.get("isEditable")), None)
        page_body = {
            "name": f"[Insight] Champion {champion_id} - {loadout.config_key}",
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

    async def apply_status_message(self, message: str, *, automated: bool = False) -> None:
        if not automated:
            self._interrupt_chat_ready_automation()
        await self.request("PUT", "/lol-chat/v1/me", json_body={"statusMessage": message})
        self.last_action = "已自动恢复聊天状态签名" if automated else "已应用聊天状态签名"
        self.last_action_at = time.time()

    async def apply_ranked_status(self, ranked_status: RankedStatusUpdate, *, automated: bool = False) -> None:
        if not automated:
            self._interrupt_chat_ready_automation()
        ranked = ranked_status.model_dump()
        if ranked_status.tier in {"MASTER", "GRANDMASTER", "CHALLENGER"}:
            ranked.pop("division", None)
        await self.request("PUT", "/lol-chat/v1/me", json_body={
            "lol": {
                "rankedLeagueQueue": ranked["queue"],
                "rankedLeagueTier": ranked["tier"],
                **({"rankedLeagueDivision": ranked["division"]} if "division" in ranked else {}),
            }
        })
        self.last_action = "已自动恢复排位展示" if automated else "已应用排位展示"
        self.last_action_at = time.time()

    async def _run_chat_ready_automation(self) -> None:
        """Apply LeagueAkari login automations once, after `/lol-chat/v1/me` settles for two seconds."""
        if self._chat_ready_automation_done:
            return
        try:
            chat_me = await self.request("GET", "/lol-chat/v1/me")
        except RuntimeError:
            self._chat_ready_since = None
            return
        if not isinstance(chat_me, dict) or not chat_me:
            self._chat_ready_since = None
            return
        now = time.monotonic()
        if self._chat_ready_since is None:
            self._chat_ready_since = now
            return
        if now - self._chat_ready_since < 2.0:
            return
        self._chat_ready_automation_done = True
        if not self.settings.automation_enabled:
            return
        results = []
        if self.settings.auto_set_status_message_enabled:
            results.append(self.apply_status_message(self.settings.status_message, automated=True))
        if self.settings.auto_set_ranked_status_enabled:
            results.append(self.apply_ranked_status(self.settings.ranked_status, automated=True))
        if results:
            await asyncio.gather(*results, return_exceptions=True)

    async def _run_automation(self) -> None:
        settings = self.settings
        phase = self.phase
        await self._run_chat_ready_automation()
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
            self._champion_action_due_at.clear()
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
                    await self._refresh_respawn_timer()
                    await self._run_automation()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("League lab background loop failed")
            chat_settling = self.credentials and not self._chat_ready_automation_done and self._chat_ready_since is not None
            timeout = 1.0 if chat_settling or (self.credentials and self.settings.respawn_timer_enabled and self.phase == "InProgress") else 5.0
            try:
                await asyncio.wait_for(self._event_wakeup.wait(), timeout=timeout)
                self._event_wakeup.clear()
            except asyncio.TimeoutError:
                pass


league_lab_service = LeagueLabService()


def _normalize_skin_selector(info, rows) -> dict:
    options = []
    for skin in rows or []:
        if not isinstance(skin, dict) or skin.get("disabled") or not skin.get("unlocked"):
            continue
        options.append({"id": int(skin.get("id") or 0), "name": skin.get("name") or str(skin.get("id")), "preview_path": skin.get("splashPath") or skin.get("tilePath") or "", "is_chroma": False})
        for child in skin.get("childSkins") or []:
            if isinstance(child, dict) and not child.get("disabled") and child.get("unlocked"):
                options.append({"id": int(child.get("id") or 0), "name": child.get("name") or str(child.get("id")), "preview_path": child.get("chromaPreviewPath") or child.get("splashPath") or "", "is_chroma": True})
    return {
        "available": bool(options) and bool((info or {}).get("showSkinSelector", True)),
        "disabled": bool((info or {}).get("skinSelectionDisabled")),
        "selected_skin_id": int((info or {}).get("selectedSkinId") or 0),
        "champion_id": int((info or {}).get("selectedChampionId") or 0),
        "skins": [row for row in options if row["id"] > 0],
    }


# LeagueAkari's built-in SGP routing table, reduced to the match-history hosts used here.
# Tokens are fetched from the local LCU on demand and are never written to disk or returned to the UI.
_SGP_MATCH_HISTORY_HOSTS = {
    "TENCENT_HN1": "https://hn1-k8s-sgp.lol.qq.com:21019",
    "TENCENT_HN10": "https://hn10-k8s-sgp.lol.qq.com:21019",
    "TENCENT_TJ100": "https://tj100-sgp.lol.qq.com:21019",
    "TENCENT_TJ101": "https://tj101-sgp.lol.qq.com:21019",
    "TENCENT_NJ100": "https://nj100-sgp.lol.qq.com:21019",
    "TENCENT_GZ100": "https://gz100-sgp.lol.qq.com:21019",
    "TENCENT_CQ100": "https://cq100-sgp.lol.qq.com:21019",
    "TENCENT_BGP2": "https://bgp2-k8s-sgp.lol.qq.com:21019",
    "TENCENT_PBE": "https://pbe-sgp.lol.qq.com:21019",
    "TENCENT_PREPBE": "https://prepbe-sgp.lol.qq.com:21019",
    "TW2": "https://apse1-red.pp.sgp.pvp.net",
    "SG2": "https://apse1-red.pp.sgp.pvp.net",
    "PH2": "https://apse1-red.pp.sgp.pvp.net",
    "VN2": "https://apse1-red.pp.sgp.pvp.net",
    "PBE": "https://usw2-red.pp.sgp.pvp.net",
    "EUW": "https://euc1-red.pp.sgp.pvp.net",
    "JP": "https://apne1-red.pp.sgp.pvp.net",
    "RU": "https://euc1-red.pp.sgp.pvp.net",
    "BR1": "https://usw2-red.pp.sgp.pvp.net",
    "OC1": "https://apse1-red.pp.sgp.pvp.net",
    "TR1": "https://euc1-red.pp.sgp.pvp.net",
    "LA1": "https://usw2-red.pp.sgp.pvp.net",
    "LA2": "https://usw2-red.pp.sgp.pvp.net",
    "NA1": "https://usw2-red.pp.sgp.pvp.net",
    "TH2": "https://apse1-red.pp.sgp.pvp.net",
    "KR": "https://apne1-red.pp.sgp.pvp.net",
}

_SGP_COMMON_HOSTS = {
    **{key: value for key, value in _SGP_MATCH_HISTORY_HOSTS.items() if key.startswith("TENCENT_")},
    "TW2": "https://tw2-red.lol.sgp.pvp.net",
    "SG2": "https://sg2-red.lol.sgp.pvp.net",
    "PH2": "https://ph2-red.lol.sgp.pvp.net",
    "VN2": "https://vn2-red.lol.sgp.pvp.net",
    "PBE": "https://pbe-red.lol.sgp.pvp.net",
    "EUW": "https://euw-red.lol.sgp.pvp.net",
    "JP": "https://jp-red.lol.sgp.pvp.net",
    "RU": "https://ru-red.lol.sgp.pvp.net",
    "BR1": "https://br-red.lol.sgp.pvp.net",
    "OC1": "https://oce-red.lol.sgp.pvp.net",
    "TR1": "https://tr-red.lol.sgp.pvp.net",
    "LA1": "https://lan-red.lol.sgp.pvp.net",
    "LA2": "https://las-red.lol.sgp.pvp.net",
    "NA1": "https://na-red.lol.sgp.pvp.net",
    "TH2": "https://th2-red.lol.sgp.pvp.net",
    "KR": "https://kr-red.lol.sgp.pvp.net",
}

_SGP_SERVER_LABELS = {
    "TENCENT_HN1": "艾欧尼亚",
    "TENCENT_HN10": "黑色玫瑰",
    "TENCENT_TJ100": "峡谷之巅",
    "TENCENT_TJ101": "联盟一区",
    "TENCENT_NJ100": "联盟二区",
    "TENCENT_GZ100": "联盟三区",
    "TENCENT_CQ100": "联盟四区",
    "TENCENT_BGP2": "男爵领域",
    "TENCENT_PBE": "国服体验服",
    "TENCENT_PREPBE": "国服预发布服",
    "TW2": "中国台湾",
    "SG2": "新加坡",
    "PH2": "菲律宾",
    "VN2": "越南",
    "PBE": "PBE",
    "EUW": "欧洲西部",
    "JP": "日本",
    "RU": "俄罗斯",
    "BR1": "巴西",
    "OC1": "大洋洲",
    "TR1": "土耳其",
    "LA1": "拉丁美洲北部",
    "LA2": "拉丁美洲南部",
    "NA1": "北美",
    "TH2": "泰国",
    "KR": "韩国",
}


def _sgp_server_id(credentials: LcuCredentials | None) -> str:
    if not credentials:
        return ""
    region = credentials.region.upper()
    platform = credentials.platform_id.upper()
    if region in {"CN", "TENCENT"}:
        return f"TENCENT_{platform}" if platform else ""
    aliases = {"NA": "NA1", "BR": "BR1", "TR": "TR1", "LAN": "LA1", "LAS": "LA2", "OCE": "OC1", "EUW1": "EUW", "JP1": "JP"}
    return aliases.get(region, region)


def _normalize_sgp_server_id(server_id: str | None) -> str:
    value = str(server_id or "").strip().upper()
    aliases = {"EUW1": "EUW", "JP1": "JP", "NA": "NA1", "BR": "BR1", "TR": "TR1", "LAN": "LA1", "LAS": "LA2", "OCE": "OC1"}
    value = aliases.get(value, value)
    if value not in _SGP_COMMON_HOSTS or value not in _SGP_MATCH_HISTORY_HOSTS:
        raise RuntimeError(f"不支持的 SGP 区服: {value or '空'}")
    return value


def _sgp_region_path(credentials: LcuCredentials | None = None, server_id: str | None = None) -> str:
    server_id = _normalize_sgp_server_id(server_id) if server_id else _sgp_server_id(credentials)
    if server_id.startswith("TENCENT_"):
        return server_id.split("_", 1)[1]
    aliases = {"PBE": "PBE1", "EUW": "EUW1", "JP": "JP1"}
    return aliases.get(server_id, server_id)


async def _sgp_match_history(puuid: str, beg_index: int, count: int, server_id: str | None = None) -> dict:
    credentials = league_lab_service.credentials
    server_id = _normalize_sgp_server_id(server_id) if server_id else _sgp_server_id(credentials)
    host = _SGP_MATCH_HISTORY_HOSTS.get(server_id)
    if not host:
        raise RuntimeError(f"当前区服不支持 SGP 战绩源: {server_id or '未知区服'}")
    token_payload = await league_lab_service.request("GET", "/entitlements/v1/token")
    token = token_payload.get("accessToken") if isinstance(token_payload, dict) else None
    if not token:
        raise RuntimeError("LCU 未返回 SGP 授权令牌")
    url = f"{host}/match-history-query/v1/products/lol/player/{puuid}/SUMMARY"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
                params={"startIndex": beg_index, "count": count},
            )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RuntimeError(f"SGP 战绩请求失败: {type(exc).__name__}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("SGP 战绩返回格式无效")
    return payload


async def _sgp_game_details(game_id: int, server_id: str | None = None) -> dict:
    credentials = league_lab_service.credentials
    server_id = _normalize_sgp_server_id(server_id) if server_id else _sgp_server_id(credentials)
    host = _SGP_MATCH_HISTORY_HOSTS.get(server_id)
    if not host:
        raise RuntimeError(f"当前区服不支持 SGP 时间线源: {server_id or '未知区服'}")
    token_payload = await league_lab_service.request("GET", "/entitlements/v1/token")
    token = token_payload.get("accessToken") if isinstance(token_payload, dict) else None
    if not token:
        raise RuntimeError("LCU 未返回 SGP 授权令牌")
    region_path = _sgp_region_path(credentials, server_id)
    url = f"{host}/match-history-query/v1/products/lol/{region_path}_{int(game_id)}/DETAILS"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RuntimeError(f"SGP 时间线请求失败: {type(exc).__name__}") from exc
    body = payload.get("json") if isinstance(payload, dict) and isinstance(payload.get("json"), dict) else payload
    if not isinstance(body, dict) or not isinstance(body.get("frames"), list):
        raise RuntimeError("SGP 时间线返回格式无效")
    return body


async def _sgp_common_request(method: str, path: str, *, json_body=None, server_id: str | None = None):
    """Call an SGP common service with an on-demand, memory-only League session token."""
    credentials = league_lab_service.credentials
    server_id = _normalize_sgp_server_id(server_id) if server_id else _sgp_server_id(credentials)
    host = _SGP_COMMON_HOSTS.get(server_id)
    if not host:
        raise RuntimeError(f"当前区服不支持 SGP 通用数据源: {server_id or '未知区服'}")
    token = await league_lab_service.request("GET", "/lol-league-session/v1/league-session-token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("LCU 未返回 League Session 令牌")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.request(
                method,
                f"{host}{path}",
                headers={"Authorization": f"Bearer {token}"},
                json=json_body,
            )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RuntimeError(f"SGP 通用数据请求失败: {type(exc).__name__}") from exc
    return payload


def _normalize_sgp_ranked(payload) -> dict:
    if not isinstance(payload, dict):
        return {}
    queues = []
    for row in payload.get("queues") or []:
        if not isinstance(row, dict):
            continue
        normalized = dict(row)
        normalized["division"] = row.get("division") or row.get("rank") or ""
        queues.append(normalized)
    result = dict(payload)
    result["queues"] = queues
    result["queueMap"] = {str(row.get("queueType")): row for row in queues if row.get("queueType")}
    result["source"] = "sgp"
    return result


async def _sgp_ranked_stats(puuid: str, server_id: str | None = None) -> dict:
    kwargs = {"server_id": server_id} if server_id else {}
    payload = await _sgp_common_request("GET", f"/leagues-ledge/v2/rankedStats/puuid/{puuid}", **kwargs)
    normalized = _normalize_sgp_ranked(payload)
    if not normalized:
        raise RuntimeError("SGP 排位数据返回格式无效")
    return normalized


async def _sgp_player_challenges(puuid: str, server_id: str | None = None) -> dict:
    kwargs = {"server_id": server_id} if server_id else {}
    payload = await _sgp_common_request("POST", f"/challenges-client/v2/all-player-data/?puuid={puuid}", json_body=[], **kwargs)
    if not isinstance(payload, dict):
        raise RuntimeError("SGP 挑战数据返回格式无效")
    return payload


async def _sgp_summoner_by_puuid(puuid: str, server_id: str | None = None) -> dict:
    region_path = _sgp_region_path(league_lab_service.credentials, server_id)
    kwargs = {"server_id": server_id} if server_id else {}
    payload = await _sgp_common_request(
        "POST",
        f"/summoner-ledge/v1/regions/{region_path}/summoners/puuids",
        json_body=[puuid],
        **kwargs,
    )
    row = payload[0] if isinstance(payload, list) and payload else None
    if not isinstance(row, dict):
        raise RuntimeError("SGP 召唤师数据返回格式无效")
    return {
        "puuid": row.get("puuid") or puuid,
        "summonerId": row.get("id"),
        "displayName": row.get("name") or "",
        "gameName": "",
        "tagLine": "",
        "summonerLevel": row.get("level"),
        "profileIconId": row.get("profileIconId"),
        "source": "sgp",
    }


async def _riot_player_account_aliases(game_name: str, tag_line: str) -> list[dict]:
    payload = await league_lab_service.riot_request(
        "GET",
        "/player-account/aliases/v1/lookup",
        params={"gameName": game_name, "tagLine": tag_line},
    )
    return [row for row in (payload or []) if isinstance(row, dict) and row.get("puuid")]


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


def _recent_players_path() -> Path:
    return get_data_dir() / "league-recent-players.json"


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


def _read_recent_players() -> list[dict]:
    try:
        body = json.loads(_recent_players_path().read_text(encoding="utf-8"))
        return body if isinstance(body, list) else []
    except (OSError, ValueError):
        return []


def _write_recent_players(rows: list[dict]) -> None:
    path = _recent_players_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(rows[:200], ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def _remember_recent_players(players: list[dict], game_id=None) -> None:
    existing = {str(row.get("puuid")): row for row in _read_recent_players() if row.get("puuid")}
    now = int(time.time() * 1000)
    for player in players:
        puuid = str(player.get("puuid") or "")
        if not puuid:
            continue
        summoner = player.get("summoner") or {}
        previous = existing.get(puuid) or {}
        existing[puuid] = {
            **previous,
            "puuid": puuid,
            "game_name": summoner.get("gameName") or summoner.get("displayName") or previous.get("game_name") or "",
            "tag_line": summoner.get("tagLine") or previous.get("tag_line") or "",
            "profile_icon_id": summoner.get("profileIconId") or previous.get("profile_icon_id"),
            "last_seen_at": now,
            "last_game_id": game_id or previous.get("last_game_id"),
            "team": player.get("team"),
            "champion_id": player.get("champion_id"),
            "champion_name": player.get("champion_name"),
        }
    _write_recent_players(sorted(existing.values(), key=lambda row: int(row.get("last_seen_at") or 0), reverse=True))


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
                "game_type": game.get("gameType"),
                "queue_id": game.get("queueId"),
                "position": participant.get("teamPosition") or participant.get("timeline", {}).get("lane"),
                "role": participant.get("individualPosition") or participant.get("timeline", {}).get("role"),
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


def _normalize_sgp_match_rows(payload: dict, names: dict[int, str], puuid: str) -> list[dict]:
    normalized = []
    for wrapper in (payload or {}).get("games") or []:
        game = wrapper.get("json") if isinstance(wrapper, dict) and isinstance(wrapper.get("json"), dict) else wrapper
        if not isinstance(game, dict):
            continue
        participant = next(
            (row for row in (game.get("participants") or []) if str(row.get("puuid") or "") == puuid),
            None,
        )
        if not participant:
            continue
        champion_id = int(participant.get("championId") or 0)
        normalized.append(
            {
                "game_id": game.get("gameId"),
                "played_at": game.get("gameCreation") or game.get("gameStartTimestamp"),
                "duration_seconds": game.get("gameDuration"),
                "game_mode": game.get("gameMode"),
                "game_type": game.get("gameType"),
                "queue_id": game.get("queueId"),
                "position": participant.get("teamPosition"),
                "role": participant.get("individualPosition"),
                "champion_id": champion_id,
                "champion_name": names.get(champion_id, participant.get("championName") or str(champion_id)),
                "spell1_id": participant.get("summoner1Id") or participant.get("spell1Id"),
                "spell2_id": participant.get("summoner2Id") or participant.get("spell2Id"),
                "kills": participant.get("kills", 0),
                "deaths": participant.get("deaths", 0),
                "assists": participant.get("assists", 0),
                "win": bool(participant.get("win")),
                "cs": int(participant.get("totalMinionsKilled", 0)) + int(participant.get("neutralMinionsKilled", 0)),
                "gold": participant.get("goldEarned", 0),
                "damage": participant.get("totalDamageDealtToChampions", 0),
                "items": [participant.get(f"item{i}") for i in range(7) if participant.get(f"item{i}")],
                "challenges": participant.get("challenges") or {},
                "source": "sgp",
            }
        )
    return normalized


def _infer_premade_groups(histories: dict[str, dict], active_puuids: set[str], threshold: int = 3) -> dict[str, int]:
    game_teams: dict[str, list[set[str]]] = {}
    for payload in histories.values():
        for game in (((payload or {}).get("games") or {}).get("games") or []):
            game_id = str(game.get("gameId") or "")
            if not game_id or game_id in game_teams:
                continue
            team_members: dict[int, set[str]] = {}
            participants = {row.get("participantId"): row for row in (game.get("participants") or [])}
            for identity in game.get("participantIdentities") or []:
                player = identity.get("player") or {}
                puuid = str(player.get("puuid") or identity.get("puuid") or "")
                participant = participants.get(identity.get("participantId")) or {}
                team_id = int(participant.get("teamId") or 0)
                if puuid and team_id:
                    team_members.setdefault(team_id, set()).add(puuid)
            game_teams[game_id] = list(team_members.values())
    together: dict[tuple[str, str], int] = {}
    for teams in game_teams.values():
        for team in teams:
            visible = sorted(team & active_puuids)
            for index, first in enumerate(visible):
                for second in visible[index + 1:]:
                    together[(first, second)] = together.get((first, second), 0) + 1
    graph = {puuid: set() for puuid in active_puuids}
    for (first, second), count in together.items():
        if count >= threshold:
            graph[first].add(second)
            graph[second].add(first)
    groups: dict[str, int] = {}
    seen: set[str] = set()
    group_id = 0
    for puuid in sorted(active_puuids):
        if puuid in seen or not graph[puuid]:
            continue
        stack, members = [puuid], []
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            members.append(current)
            stack.extend(graph[current] - seen)
        if len(members) > 1:
            group_id += 1
            groups.update({member: group_id for member in members})
    return groups


_JUNGLE_ANALYSIS_MINUTES = 14
_JUNGLE_KILL_WEIGHT = 5
_JUNGLE_CAMPS = (
    {"x": 3830, "y": 7880, "camp": "blue", "side": "blue"},
    {"x": 3800, "y": 6440, "camp": "wolves", "side": "blue"},
    {"x": 7760, "y": 4010, "camp": "red", "side": "blue"},
    {"x": 6970, "y": 5460, "camp": "raptors", "side": "blue"},
    {"x": 10990, "y": 7000, "camp": "blue", "side": "red"},
    {"x": 11020, "y": 8440, "camp": "wolves", "side": "red"},
    {"x": 7060, "y": 10870, "camp": "red", "side": "red"},
    {"x": 7850, "y": 9420, "camp": "raptors", "side": "red"},
)


def _classify_jungle_map_zone(x: float, y: float) -> str:
    if x < 5000 and y > 9000:
        return "top"
    if x > 9000 and y < 5000:
        return "bot"
    if abs(y - x) <= 3500:
        return "mid"
    return "top" if y > x else "bot"


def _classify_jungle_gank_lane(x: float, y: float) -> str | None:
    if x < 5000 and y > 9000:
        return "top"
    if x > 9000 and y < 5000:
        return "bot"
    midpoint = (x + y) / 2
    if abs(y - x) < 4000 and 3000 < midpoint < 12000:
        return "mid"
    return None


def _detect_jungle_start_camp(x: float, y: float) -> dict:
    nearest = min(_JUNGLE_CAMPS, key=lambda camp: (x - camp["x"]) ** 2 + (y - camp["y"]) ** 2)
    return {"camp": nearest["camp"], "side": nearest["side"]}


def _timeline_participant_frame(frame: dict, participant_id: int) -> dict:
    rows = (frame or {}).get("participantFrames") or {}
    if isinstance(rows, dict):
        row = rows.get(str(participant_id), rows.get(participant_id))
        return row if isinstance(row, dict) else {}
    return {}


def _compute_single_jungle_analysis(frames: list[dict], participant_id: int) -> dict:
    zone_weights = {"top": 0, "mid": 0, "bot": 0}
    kill_zone_weights = {"top": 0, "mid": 0, "bot": 0}
    minute_positions = []
    total_frames = 0
    for minute, frame in enumerate(frames[1 : _JUNGLE_ANALYSIS_MINUTES + 1], start=1):
        participant_frame = _timeline_participant_frame(frame, participant_id)
        position = participant_frame.get("position") or {}
        if position.get("x") is None or position.get("y") is None:
            continue
        x, y = float(position["x"]), float(position["y"])
        lane = _classify_jungle_map_zone(x, y)
        zone_weights[lane] += 1
        total_frames += 1
        minute_positions.append({"x": x, "y": y, "lane": lane, "minute": minute})

    ganks = {"top": 0, "mid": 0, "bot": 0}
    gank_positions, level3_positions, level4_positions = [], [], []
    kill_weight_total = 0
    for frame in frames:
        for event in (frame or {}).get("events") or []:
            if not isinstance(event, dict) or event.get("type") != "CHAMPION_KILL":
                continue
            timestamp = int(event.get("timestamp") or 0)
            if timestamp > _JUNGLE_ANALYSIS_MINUTES * 60 * 1000:
                continue
            assists = event.get("assistingParticipantIds") or []
            if event.get("killerId") != participant_id and participant_id not in assists:
                continue
            position = event.get("position") or {}
            if position.get("x") is None or position.get("y") is None:
                continue
            x, y = float(position["x"]), float(position["y"])
            zone = _classify_jungle_map_zone(x, y)
            kill_zone_weights[zone] += _JUNGLE_KILL_WEIGHT
            kill_weight_total += _JUNGLE_KILL_WEIGHT
            lane = _classify_jungle_gank_lane(x, y)
            point = {"x": x, "y": y, "lane": lane or zone, "timestamp": timestamp}
            if lane:
                ganks[lane] += 1
                gank_positions.append(point)
            if timestamp <= 180000:
                level3_positions.append(point)
            elif timestamp <= 240000:
                level4_positions.append(point)

    start_camp = None
    if len(frames) > 1:
        position = _timeline_participant_frame(frames[1], participant_id).get("position") or {}
        if position.get("x") is not None and position.get("y") is not None:
            start_camp = _detect_jungle_start_camp(float(position["x"]), float(position["y"]))

    frame3 = _timeline_participant_frame(frames[3], participant_id) if len(frames) > 3 else {}
    frame4 = _timeline_participant_frame(frames[4], participant_id) if len(frames) > 4 else {}
    damage3 = ((frame3.get("damageStats") or {}).get("totalDamageDoneToChampions"))
    damage4 = ((frame4.get("damageStats") or {}).get("totalDamageDoneToChampions"))
    cs3 = int(frame3.get("minionsKilled") or 0) + int(frame3.get("jungleMinionsKilled") or 0)
    level3_gank = 12 <= cs3 < 20 and int(frame3.get("level") or 0) == 3 and (
        (damage3 is not None and float(damage3) > 0) or bool(level3_positions)
    )
    level4_gank = bool(level4_positions) or (
        damage3 is not None and damage4 is not None and float(damage4) > float(damage3)
    )
    combined = {
        lane: zone_weights[lane] + kill_zone_weights[lane]
        for lane in ("top", "mid", "bot")
    }
    return {
        "zone_weights": combined,
        "total_zone_weight": total_frames + kill_weight_total,
        "ganks": ganks,
        "start_camp": start_camp,
        "level3_gank_detected": level3_gank,
        "level4_gank_detected": level4_gank,
        "level3_kill_positions": level3_positions,
        "level4_kill_positions": level4_positions,
        "gank_positions": gank_positions,
        "minute_positions": minute_positions,
    }


def _aggregate_jungle_analyses(samples: list[dict]) -> dict | None:
    if not samples:
        return None
    total_weight = sum(int(sample.get("total_zone_weight") or 0) for sample in samples)
    zone_weights = {
        lane: sum(int((sample.get("zone_weights") or {}).get(lane) or 0) for sample in samples)
        for lane in ("top", "mid", "bot")
    }
    ganks = {
        lane: sum(int((sample.get("ganks") or {}).get(lane) or 0) for sample in samples)
        for lane in ("top", "mid", "bot")
    }
    camp_counts: dict[str, int] = {}
    for sample in samples:
        start = sample.get("start_camp") or {}
        if start.get("camp") and start.get("side"):
            key = f'{start["side"]}:{start["camp"]}'
            camp_counts[key] = camp_counts.get(key, 0) + 1
    games = len(samples)
    preferred_lane = max(zone_weights, key=zone_weights.get) if total_weight else "unknown"
    preferred_camp = max(camp_counts, key=camp_counts.get) if camp_counts else "unknown"
    zone_percentages = {
        lane: round(zone_weights[lane] / total_weight, 4) if total_weight else 0
        for lane in ("top", "mid", "bot")
    }
    average_ganks = {lane: round(ganks[lane] / games, 2) for lane in ("top", "mid", "bot")}
    level3_rate = round(sum(bool(sample.get("level3_gank_detected")) for sample in samples) / games, 4)
    level4_rate = round(sum(bool(sample.get("level4_gank_detected")) for sample in samples) / games, 4)
    lane_labels = {"top": "上半区", "mid": "中路", "bot": "下半区", "unknown": "未知区域"}
    camp_labels = {"blue": "蓝 BUFF", "red": "红 BUFF", "wolves": "三狼", "raptors": "F6", "unknown": "未知营地"}
    camp_side, _, camp_name = preferred_camp.partition(":")
    side_label = {"blue": "蓝色方野区", "red": "红色方野区"}.get(camp_side, "")
    draft = (
        f"近 {games} 场打野时间线：首开偏好 {side_label}{camp_labels.get(camp_name, camp_name or '未知营地')}；"
        f"前 14 分钟活动更偏 {lane_labels.get(preferred_lane, preferred_lane)}；"
        f"3 分钟内参与击杀率 {level3_rate * 100:.0f}%，4 分钟内新增参与率 {level4_rate * 100:.0f}%。"
    )
    return {
        "games_analyzed": games,
        "zone_percentages": zone_percentages,
        "average_ganks": average_ganks,
        "early_gank": {
            "level3_rate": level3_rate,
            "level4_rate": level4_rate,
        },
        "start_camps": camp_counts,
        "preferred_lane": preferred_lane,
        "preferred_start_camp": preferred_camp,
        "draft": draft,
        "samples": samples,
    }


def _history_games(payload: dict) -> list[dict]:
    rows = (payload or {}).get("games") or []
    if isinstance(rows, dict):
        rows = rows.get("games") or []
    result = []
    for wrapper in rows if isinstance(rows, list) else []:
        game = wrapper.get("json") if isinstance(wrapper, dict) and isinstance(wrapper.get("json"), dict) else wrapper
        if isinstance(game, dict):
            result.append(game)
    return result


def _jungle_game_participant(game: dict, puuid: str) -> dict | None:
    identities = game.get("participantIdentities") or []
    participant_id = next(
        (
            row.get("participantId")
            for row in identities
            if str((row.get("player") or {}).get("puuid") or row.get("puuid") or "") == puuid
        ),
        None,
    )
    participant = next(
        (
            row
            for row in (game.get("participants") or [])
            if str(row.get("puuid") or "") == puuid
            or (participant_id is not None and row.get("participantId") == participant_id)
        ),
        None,
    )
    if not isinstance(participant, dict):
        return None
    position = str(
        participant.get("teamPosition")
        or participant.get("individualPosition")
        or (participant.get("timeline") or {}).get("lane")
        or ""
    ).upper()
    spells = {
        int(value)
        for value in (
            participant.get("spell1Id"),
            participant.get("spell2Id"),
            participant.get("summoner1Id"),
            participant.get("summoner2Id"),
        )
        if value is not None
    }
    if position != "JUNGLE" and 11 not in spells:
        return None
    return participant


async def _load_jungle_analysis(
    puuid: str,
    history: dict,
    *,
    limit: int = 6,
    server_id: str | None = None,
    prefer_sgp: bool = False,
) -> dict:
    candidates = []
    for game in _history_games(history):
        participant = _jungle_game_participant(game, puuid)
        game_id = game.get("gameId") or game.get("game_id")
        if participant and game_id:
            candidates.append((int(game_id), int(participant.get("participantId") or 0), game))
        if len(candidates) >= max(1, min(limit, 10)):
            break

    async def analyze(entry):
        game_id, participant_id, game = entry
        timeline = None
        source = "sgp" if prefer_sgp else "lcu"
        if prefer_sgp:
            try:
                timeline = await _sgp_game_details(game_id, server_id)
            except RuntimeError:
                return None
        else:
            try:
                timeline = await league_lab_service.request(
                    "GET", f"/lol-match-history/v1/game-timelines/{game_id}"
                )
            except RuntimeError:
                try:
                    timeline = await _sgp_game_details(game_id, server_id)
                    source = "sgp"
                except RuntimeError:
                    return None
        if not participant_id:
            participant = next(
                (
                    row
                    for row in (timeline or {}).get("participants") or []
                    if str(row.get("puuid") or "") == puuid
                ),
                None,
            )
            participant_id = int((participant or {}).get("participantId") or 0)
        frames = (timeline or {}).get("frames") or []
        if not participant_id or not isinstance(frames, list) or not frames:
            return None
        sample = _compute_single_jungle_analysis(frames, participant_id)
        sample.update(
            {
                "game_id": game_id,
                "team_id": int((game and (_jungle_game_participant(game, puuid) or {}).get("teamId")) or 0),
                "source": source,
            }
        )
        return sample

    samples = [sample for sample in await asyncio.gather(*(analyze(row) for row in candidates)) if sample]
    aggregate = _aggregate_jungle_analyses(samples)
    return aggregate or {"games_analyzed": 0, "samples": [], "reason": "最近战绩中没有可用的打野时间线"}


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


@router.get("/players/search")
async def search_league_player(game_name: str, tag_line: str, server_id: str = ""):
    if not game_name.strip() or not tag_line.strip():
        raise HTTPException(status_code=422, detail="请输入完整的游戏名称和标签")
    current_server_id = _sgp_server_id(league_lab_service.credentials)
    try:
        target_server_id = _normalize_sgp_server_id(server_id) if server_id.strip() else current_server_id
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    aliases = []
    try:
        aliases = await _riot_player_account_aliases(game_name.strip(), tag_line.strip())
    except RuntimeError:
        try:
            rows = await league_lab_service.request(
                "POST",
                "/lol-summoner/v1/summoners/aliases",
                json_body=[{"gameName": game_name.strip(), "tagLine": tag_line.strip()}],
            )
            aliases = [row for row in (rows or []) if isinstance(row, dict) and row.get("puuid")]
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    alias = aliases[0] if aliases else None
    if not alias:
        raise HTTPException(status_code=404, detail="未找到该 Riot ID")
    puuid = str(alias["puuid"])
    alias_name = alias.get("alias") or {}
    prefer_sgp = bool(target_server_id and target_server_id != current_server_id)
    summoner = alias if not alias_name and (alias.get("gameName") or alias.get("displayName")) else None
    if not prefer_sgp:
        if not isinstance(summoner, dict):
            try:
                summoner = await league_lab_service.request("GET", f"/lol-summoner/v2/summoners/puuid/{puuid}")
            except RuntimeError:
                pass
    if not isinstance(summoner, dict) or not summoner.get("puuid"):
        try:
            summoner = await _sgp_summoner_by_puuid(puuid, target_server_id or None)
        except RuntimeError as exc:
            raise HTTPException(status_code=404, detail=f"该 Riot ID 在所选区服不存在: {exc}") from exc
    summoner = {
        **summoner,
        "gameName": summoner.get("gameName") or alias_name.get("game_name") or game_name.strip(),
        "tagLine": summoner.get("tagLine") or alias_name.get("tag_line") or tag_line.strip(),
    }
    if server_id.strip():
        return await _load_player_bundle(
            summoner,
            sgp_server_id=target_server_id or None,
            prefer_sgp=prefer_sgp,
        )
    return await _load_player_bundle(summoner)


@router.get("/players/search-servers")
async def league_player_search_servers():
    current = _sgp_server_id(league_lab_service.credentials)
    return {
        "current": current,
        "servers": [
            {"id": server_id, "label": _SGP_SERVER_LABELS.get(server_id, server_id), "current": server_id == current}
            for server_id in _SGP_COMMON_HOSTS
            if server_id in _SGP_MATCH_HISTORY_HOSTS
        ],
    }


@router.get("/players/recent")
async def recent_league_players(limit: int = 40):
    rows = _read_recent_players()[: max(1, min(limit, 200))]
    tags = _read_player_tags()
    return {"players": [{**row, "tag": tags.get(str(row.get("puuid"))) or {}} for row in rows], "count": len(rows)}


@router.get("/players/{puuid}")
async def league_player_bundle(puuid: str, match_limit: int = 20, beg_index: int = 0, server_id: str = ""):
    try:
        target_server_id = _normalize_sgp_server_id(server_id) if server_id.strip() else ""
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    prefer_sgp = bool(target_server_id and target_server_id != _sgp_server_id(league_lab_service.credentials))
    lcu_exc = RuntimeError("已选择跨区 SGP 数据源")
    summoner = None
    if not prefer_sgp:
        try:
            summoner = await league_lab_service.request("GET", f"/lol-summoner/v2/summoners/puuid/{puuid}")
        except RuntimeError as exc:
            lcu_exc = exc
    if not isinstance(summoner, dict):
        try:
            summoner = await _sgp_summoner_by_puuid(puuid, target_server_id or None)
        except RuntimeError as sgp_exc:
            raise HTTPException(status_code=409, detail=f"{lcu_exc}; {sgp_exc}") from sgp_exc
    return await _load_player_bundle(
        summoner,
        match_limit=max(1, min(match_limit, 100)),
        beg_index=max(0, beg_index),
        sgp_server_id=target_server_id or None,
        prefer_sgp=prefer_sgp,
    )


async def _load_player_bundle(
    summoner,
    match_limit: int = 20,
    beg_index: int = 0,
    sgp_server_id: str | None = None,
    prefer_sgp: bool = False,
) -> dict:
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
            params={"begIndex": beg_index, "endIndex": beg_index + match_limit - 1},
        ),
        _champion_names(),
    )
    if prefer_sgp:
        ranked, mastery, history = None, None, None
    match_source = "lcu"
    ranked_source = "lcu" if ranked else "none"
    if not ranked:
        try:
            ranked = await (_sgp_ranked_stats(puuid, sgp_server_id) if sgp_server_id else _sgp_ranked_stats(puuid))
            ranked_source = "sgp"
        except RuntimeError:
            pass
    matches = _normalize_match_rows(history or {}, names, puuid)
    if len(matches) < match_limit:
        try:
            sgp_history = await (
                _sgp_match_history(puuid, beg_index, match_limit, sgp_server_id)
                if sgp_server_id
                else _sgp_match_history(puuid, beg_index, match_limit)
            )
            sgp_matches = _normalize_sgp_match_rows(sgp_history, names, puuid)
            if sgp_matches:
                matches = sgp_matches
                match_source = "sgp"
        except RuntimeError:
            pass
    challenges = {}
    try:
        challenges = await (
            _sgp_player_challenges(puuid, sgp_server_id)
            if sgp_server_id
            else _sgp_player_challenges(puuid)
        )
    except RuntimeError:
        pass
    tags = _read_player_tags().get(puuid) or {}
    if match_limit >= 100 and beg_index == 0 and matches:
        await _store_match_collection(puuid, matches)
    collection_count = await _match_collection_count(puuid)
    return {
        "summoner": {
            "puuid": puuid,
            "game_name": summoner.get("gameName") or summoner.get("displayName"),
            "tag_line": summoner.get("tagLine") or "",
            "summoner_level": summoner.get("summonerLevel"),
            "profile_icon_id": summoner.get("profileIconId"),
            "source": summoner.get("source") or "lcu",
        },
        "ranked": ranked or {},
        "ranked_source": ranked_source,
        "mastery": mastery or {},
        "player_challenges": challenges,
        "matches": matches,
        "match_source": match_source,
        "collection_count": collection_count,
        "server_id": sgp_server_id or _sgp_server_id(league_lab_service.credentials),
        "page": {
            "beg_index": beg_index,
            "end_index": beg_index + match_limit - 1,
            "has_more": len(matches) >= match_limit,
        },
        "tag": tags,
    }


def _league_collection_db_path() -> Path:
    return get_data_dir() / "cs2-insight.db"


async def _ensure_league_collection_table(conn: aiosqlite.Connection) -> None:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS league_match_collection (
            puuid TEXT NOT NULL,
            game_id TEXT NOT NULL,
            played_at INTEGER,
            payload_json TEXT NOT NULL,
            collected_at INTEGER NOT NULL,
            PRIMARY KEY (puuid, game_id)
        )
        """
    )


async def _store_match_collection(puuid: str, matches: list[dict]) -> int:
    path = _league_collection_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(path) as conn:
        await _ensure_league_collection_table(conn)
        now = int(time.time())
        for row in matches:
            game_id = str(row.get("game_id") or "")
            if not game_id:
                continue
            await conn.execute(
                """
                INSERT INTO league_match_collection (puuid, game_id, played_at, payload_json, collected_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(puuid, game_id) DO UPDATE SET
                    played_at=excluded.played_at,
                    payload_json=excluded.payload_json,
                    collected_at=excluded.collected_at
                """,
                (puuid, game_id, row.get("played_at"), json.dumps(row, ensure_ascii=False), now),
            )
        await conn.commit()
        cursor = await conn.execute("SELECT COUNT(*) FROM league_match_collection WHERE puuid = ?", (puuid,))
        count = int((await cursor.fetchone())[0])
    return count


async def _match_collection_count(puuid: str) -> int:
    path = _league_collection_db_path()
    if not path.exists():
        return 0
    async with aiosqlite.connect(path) as conn:
        await _ensure_league_collection_table(conn)
        cursor = await conn.execute("SELECT COUNT(*) FROM league_match_collection WHERE puuid = ?", (puuid,))
        row = await cursor.fetchone()
    return int(row[0] if row else 0)


async def _read_match_collection(puuid: str, limit: int = 100) -> list[dict]:
    path = _league_collection_db_path()
    if not path.exists():
        return []
    async with aiosqlite.connect(path) as conn:
        await _ensure_league_collection_table(conn)
        cursor = await conn.execute(
            "SELECT payload_json FROM league_match_collection WHERE puuid = ? ORDER BY COALESCE(played_at, 0) DESC, collected_at DESC LIMIT ?",
            (puuid, max(1, min(limit, 500))),
        )
        rows = await cursor.fetchall()
    result = []
    for row in rows:
        try:
            payload = json.loads(row[0])
        except (TypeError, ValueError):
            continue
        if isinstance(payload, dict):
            result.append(payload)
    return result


@router.get("/players/{puuid}/collection")
async def league_player_collection(puuid: str, limit: int = 100):
    matches = await _read_match_collection(puuid, limit)
    return {"puuid": puuid, "matches": matches, "count": len(matches), "source": "sqlite"}


@router.get("/players/{puuid}/jungle-analysis")
async def league_player_jungle_analysis(puuid: str, limit: int = 6, server_id: str = ""):
    try:
        target_server_id = _normalize_sgp_server_id(server_id) if server_id.strip() else _sgp_server_id(league_lab_service.credentials)
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    prefer_sgp = bool(server_id.strip() and target_server_id != _sgp_server_id(league_lab_service.credentials))
    history = None
    source = "sgp" if prefer_sgp else "lcu"
    if not prefer_sgp:
        try:
            history = await league_lab_service.request(
                "GET",
                f"/lol-match-history/v1/products/lol/{puuid}/matches",
                params={"begIndex": 0, "endIndex": 29},
            )
        except RuntimeError:
            pass
    if not isinstance(history, dict):
        try:
            history = await _sgp_match_history(puuid, 0, 30, target_server_id or None)
            source = "sgp"
            prefer_sgp = True
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    result = await _load_jungle_analysis(
        puuid,
        history,
        limit=max(1, min(limit, 10)),
        server_id=target_server_id or None,
        prefer_sgp=prefer_sgp,
    )
    return {**result, "puuid": puuid, "server_id": target_server_id, "history_source": source}


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


_ongoing_cache: dict = {"key": "", "expires_at": 0.0, "payload": None}


@router.get("/ongoing-game")
async def league_ongoing_game():
    try:
        gameflow = await league_lab_service.request("GET", "/lol-gameflow/v1/session")
        names = await _champion_names()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    game_data = (gameflow or {}).get("gameData") or {}
    team_metadata = {}
    for team_id, key in ((100, "teamOne"), (200, "teamTwo")):
        for member in game_data.get(key) or []:
            if not isinstance(member, dict):
                continue
            puuid = str(member.get("puuid") or member.get("playerPuuid") or "")
            if puuid:
                team_metadata[puuid] = {**member, "team": member.get("team") or member.get("teamId") or team_id}
    selections, seen = [], set()
    for selection in game_data.get("playerChampionSelections") or []:
        if not isinstance(selection, dict):
            continue
        puuid = str(selection.get("puuid") or selection.get("playerPuuid") or "")
        metadata = team_metadata.get(puuid) or {}
        merged = {**metadata, **selection}
        merged["team"] = selection.get("team") or selection.get("teamId") or metadata.get("team")
        merged["selectedPosition"] = selection.get("selectedPosition") or metadata.get("selectedPosition") or ""
        selections.append(merged)
        seen.add(puuid)
    selections.extend(row for puuid, row in team_metadata.items() if puuid not in seen)
    cache_key = json.dumps(
        [
            game_data.get("gameId"),
            [
                [row.get("puuid") or row.get("playerPuuid"), row.get("championId"), row.get("team") or row.get("teamId"), row.get("selectedPosition")]
                for row in selections if isinstance(row, dict)
            ],
        ],
        ensure_ascii=False,
    )
    if _ongoing_cache["key"] == cache_key and time.monotonic() < _ongoing_cache["expires_at"]:
        return _ongoing_cache["payload"]
    async def enrich(row):
        if not isinstance(row, dict):
            return None, None
        puuid = str(row.get("puuid") or row.get("playerPuuid") or "")
        summoner, ranked, history = None, None, None
        if puuid:
            try:
                summoner, ranked, history = await asyncio.gather(
                    league_lab_service.request("GET", f"/lol-summoner/v2/summoners/puuid/{puuid}"),
                    league_lab_service.request("GET", f"/lol-ranked/v1/ranked-stats/{puuid}"),
                    league_lab_service.request(
                        "GET", f"/lol-match-history/v1/products/lol/{puuid}/matches",
                        params={"begIndex": 0, "endIndex": 19},
                    ),
                )
            except RuntimeError:
                pass
        champion_id = int(row.get("championId") or 0)
        matches = _normalize_match_rows(history or {}, names, puuid)
        champion_matches = [match for match in matches if match.get("champion_id") == champion_id]
        selected_position = str(row.get("selectedPosition") or row.get("assignedPosition") or "").upper()
        jungle_analysis = None
        if selected_position == "JUNGLE" and isinstance(history, dict):
            jungle_analysis = await _load_jungle_analysis(puuid, history, limit=4)
        return ({
            "puuid": puuid,
            "team": row.get("team") or row.get("teamId"),
            "champion_id": champion_id,
            "champion_name": names.get(champion_id, str(champion_id)),
            "position": selected_position,
            "summoner": summoner or {},
            "ranked": ranked or {},
            "tag": _read_player_tags().get(puuid) or {},
            "recent": {
                "matches": len(matches),
                "wins": sum(1 for match in matches if match.get("win")),
            },
            "champion_usage": {
                "matches": len(champion_matches),
                "wins": sum(1 for match in champion_matches if match.get("win")),
                "average_kda": round(sum((match.get("kills", 0) + match.get("assists", 0)) / max(1, match.get("deaths", 0)) for match in champion_matches) / max(1, len(champion_matches)), 2),
            },
            "jungle_analysis": jungle_analysis,
        }, history or {})
    enriched = await asyncio.gather(*(enrich(row) for row in selections))
    players = [result[0] for result in enriched if result[0]]
    histories = {result[0]["puuid"]: result[1] for result in enriched if result[0] and result[0].get("puuid")}
    premade_groups = _infer_premade_groups(histories, set(histories))
    for player in players:
        player["premade_group"] = premade_groups.get(player.get("puuid"))
    result = {
        "phase": league_lab_service.phase,
        "queue": game_data.get("queue") or {},
        "game_id": game_data.get("gameId"),
        "players": players,
        "available": bool(players),
    }
    if players:
        _remember_recent_players(players, game_data.get("gameId"))
    _ongoing_cache.update({"key": cache_key, "expires_at": time.monotonic() + 30.0, "payload": result})
    return result


@router.get("/cooldown-timer/state")
async def league_cooldown_timer_state():
    settings = league_lab_service.settings
    if not settings.cooldown_timer_enabled:
        return {"enabled": False, "available": False, "players": [], "game_time": None}
    try:
        gameflow, spells, names = await asyncio.gather(
            league_lab_service.request("GET", "/lol-gameflow/v1/session"),
            league_lab_service.request("GET", "/lol-game-data/assets/v1/summoner-spells.json"),
            _champion_names(),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    game_data = (gameflow or {}).get("gameData") or {}
    queue = game_data.get("queue") or {}
    mode = str(queue.get("gameMode") or "").upper()
    ability_haste = {
        "CLASSIC": 0,
        "PRACTICETOOL": 0,
        "ARAM": 70,
        "URF": 300,
        "ONEFORALL": 0,
        "NEXUSBLITZ": 0,
        "ULTBOOK": 0,
        "KIWI": 70,
    }.get(mode)
    if str((gameflow or {}).get("phase") or league_lab_service.phase) != "InProgress" or ability_haste is None:
        return {"enabled": True, "available": False, "players": [], "game_time": None, "game_mode": mode}
    own_puuid = str(league_lab_service.current_summoner.get("puuid") or "")
    team_one = [row for row in game_data.get("teamOne") or [] if isinstance(row, dict)]
    team_two = [row for row in game_data.get("teamTwo") or [] if isinstance(row, dict)]
    own_team = team_one if any(str(row.get("puuid") or "") == own_puuid for row in team_one) else team_two
    enemies = team_two if own_team is team_one else team_one
    selections = {
        str(row.get("puuid") or row.get("playerPuuid") or ""): row
        for row in game_data.get("playerChampionSelections") or []
        if isinstance(row, dict)
    }
    position_order = {"TOP": 0, "JUNGLE": 1, "MIDDLE": 2, "MID": 2, "BOTTOM": 3, "UTILITY": 4}
    players = []
    for index, member in enumerate(enemies):
        puuid = str(member.get("puuid") or member.get("playerPuuid") or "")
        selection = selections.get(puuid) or {}
        champion_id = int(selection.get("championId") or member.get("championId") or 0)
        players.append({
            "puuid": puuid,
            "champion_id": champion_id,
            "champion_name": names.get(champion_id, str(champion_id)),
            "position": str(member.get("selectedPosition") or selection.get("selectedPosition") or "").upper(),
            "spell1_id": int(selection.get("spell1Id") or member.get("spell1Id") or 0),
            "spell2_id": int(selection.get("spell2Id") or member.get("spell2Id") or 0),
            "source_index": index,
        })
    players.sort(key=lambda row: (position_order.get(row["position"], 99), row["source_index"]))
    spell_rows = spells if isinstance(spells, list) else list(spells.values()) if isinstance(spells, dict) else []
    spell_catalog = {
        int(row["id"]): {
            "id": int(row["id"]),
            "name": str(row.get("name") or row["id"]),
            "cooldown": float(row.get("cooldown") or 0),
        }
        for row in spell_rows
        if isinstance(row, dict) and row.get("id")
    }
    game_time = None
    try:
        async with httpx.AsyncClient(verify=False, timeout=1.5) as client:
            response = await client.get("https://127.0.0.1:2999/liveclientdata/gamestats")
        response.raise_for_status()
        payload = response.json()
        game_time = float(payload.get("gameTime")) if isinstance(payload, dict) and payload.get("gameTime") is not None else None
    except (httpx.HTTPError, TypeError, ValueError):
        pass
    return {
        "enabled": True,
        "available": bool(players),
        "game_mode": mode,
        "ability_haste": ability_haste,
        "timer_type": settings.cooldown_timer_type,
        "reverse_adjustment": settings.cooldown_timer_reverse_adjustment,
        "game_time": game_time,
        "players": players,
        "spells": spell_catalog,
    }


@router.post("/cooldown-timer/send")
async def league_cooldown_timer_send(body: InGameTextSend):
    if not league_lab_service.settings.cooldown_timer_enabled:
        raise HTTPException(status_code=409, detail="请先启用敌方召唤师技能计时器")
    try:
        pid = await asyncio.to_thread(_send_text_to_foreground_league_game, body.text)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"sent": True, "pid": pid}


@router.get("/champions")
async def league_champion_catalog():
    champions = await _champion_catalog()
    return {"champions": champions, "count": len(champions), "source": "lcu" if league_lab_service.credentials else "cache"}


@router.get("/assets/champions/{champion_id}.png")
async def league_champion_icon(champion_id: int):
    if champion_id <= 0:
        raise HTTPException(status_code=404, detail="英雄头像不存在")
    try:
        content, media_type = await league_lab_service.request_bytes(
            f"/lol-game-data/assets/v1/champion-icons/{champion_id}.png"
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=content, media_type=media_type, headers={"Cache-Control": "private, max-age=86400"})


@router.get("/assets/summoner-spells/{spell_id}.png")
async def league_summoner_spell_icon(spell_id: int):
    if spell_id <= 0:
        raise HTTPException(status_code=404, detail="召唤师技能图标不存在")
    try:
        content, media_type = await league_lab_service.request_bytes(
            f"/lol-game-data/assets/v1/summoner-spells/{spell_id}.png"
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=content, media_type=media_type, headers={"Cache-Control": "private, max-age=86400"})


@router.get("/assets/profile-icons/{profile_icon_id}.jpg")
async def league_profile_icon(profile_icon_id: int):
    if profile_icon_id < 0:
        raise HTTPException(status_code=404, detail="召唤师头像不存在")
    last_error = None
    for suffix in ("jpg", "png"):
        try:
            content, media_type = await league_lab_service.request_bytes(
                f"/lol-game-data/assets/v1/profile-icons/{profile_icon_id}.{suffix}"
            )
            return Response(content=content, media_type=media_type, headers={"Cache-Control": "private, max-age=86400"})
        except RuntimeError as exc:
            last_error = exc
    raise HTTPException(status_code=404, detail=str(last_error or "召唤师头像不存在"))


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


@router.get("/toolkit/overview")
async def league_toolkit_overview():
    async def optional(path: str):
        try:
            return await league_lab_service.request("GET", path)
        except RuntimeError:
            return None

    missions, mission_series, rewards, loot, friends, chat_me = await asyncio.gather(
        optional("/lol-missions/v1/missions"),
        optional("/lol-missions/v1/series"),
        optional("/lol-rewards/v1/grants"),
        optional("/lol-loot/v1/player-loot-map"),
        optional("/lol-chat/v1/friends"),
        optional("/lol-chat/v1/me"),
    )
    mission_rows = missions if isinstance(missions, list) else []
    reward_rows = rewards if isinstance(rewards, list) else []
    loot_rows = list(loot.values()) if isinstance(loot, dict) else loot if isinstance(loot, list) else []
    friend_rows = friends if isinstance(friends, list) else []
    return {
        "missions": mission_rows,
        "mission_series": mission_series if isinstance(mission_series, list) else [],
        "unclaimed_rewards": [row for row in reward_rows if not row.get("viewed") or not row.get("selected")],
        "loot": loot_rows,
        "friends": friend_rows,
        "chat_presence": chat_me if isinstance(chat_me, dict) else None,
        "counts": {
            "missions": len(mission_rows),
            "unclaimed_rewards": len([row for row in reward_rows if not row.get("viewed") or not row.get("selected")]),
            "loot": len(loot_rows),
            "friends": len(friend_rows),
        },
        "read_only": True,
    }


async def _league_game_settings_path() -> Path:
    install_root = await league_lab_service.request("GET", "/data-store/v1/install-dir")
    if not isinstance(install_root, str) or not install_root.strip():
        raise RuntimeError("LCU 未返回游戏安装目录")
    root = Path(install_root).expanduser().resolve()
    region = (league_lab_service.credentials.region if league_lab_service.credentials else "").upper()
    config_dir = (root.parent / "Game" / "Config") if region == "TENCENT" else (root / "Config")
    settings_path = (config_dir / "PersistedSettings.json").resolve()
    if not settings_path.is_file():
        raise RuntimeError("未找到 PersistedSettings.json")
    return settings_path


async def _league_game_settings_file_mode() -> str:
    settings_path = await _league_game_settings_path()
    return "writable" if settings_path.stat().st_mode & stat.S_IWRITE else "readonly"


def _league_client_window_handles():
    if os.name != "nt":
        raise RuntimeError("League 客户端窗口调整仅支持 Windows")
    user32 = ctypes.windll.user32
    user32.FindWindowW.restype = wintypes.HWND
    user32.FindWindowExW.restype = wintypes.HWND
    parent = user32.FindWindowW("RCLIENT", "League of Legends")
    child = user32.FindWindowExW(parent, None, None, "CefBrowserWindow") if parent else None
    if not parent or not child:
        raise RuntimeError("未找到 LeagueClientUx 主窗口，请先显示客户端")
    return user32, parent, child


def _league_client_window_info() -> dict:
    user32, parent, _ = _league_client_window_handles()
    rect = wintypes.RECT()
    if not user32.GetWindowRect(parent, ctypes.byref(rect)):
        raise RuntimeError("读取 LeagueClientUx 窗口尺寸失败")
    dpi = int(user32.GetDpiForWindow(parent)) if hasattr(user32, "GetDpiForWindow") else 96
    return {
        "width": int(rect.right - rect.left),
        "height": int(rect.bottom - rect.top),
        "left": int(rect.left),
        "top": int(rect.top),
        "dpi": dpi or 96,
        "scale_factor": round((dpi or 96) / 96, 3),
        "supported": True,
    }


def _resize_league_client_window(base_width: int, base_height: int, zoom: float) -> dict:
    if zoom <= 0:
        raise RuntimeError("LeagueClientUx 返回了无效缩放比例")
    user32, parent, child = _league_client_window_handles()
    width = max(1, round(base_width * zoom))
    height = max(1, round(base_height * zoom))
    screen_width = int(user32.GetSystemMetrics(0))
    screen_height = int(user32.GetSystemMetrics(1))
    x, y = (screen_width - width) // 2, (screen_height - height) // 2
    swp_no_zorder = 0x0004
    if not user32.SetWindowPos(parent, None, x, y, width, height, swp_no_zorder):
        raise RuntimeError("调整 LeagueClientUx 主窗口失败，可能需要管理员权限")
    if not user32.SetWindowPos(child, None, 0, 0, width, height, swp_no_zorder):
        raise RuntimeError("调整 LeagueClientUx 内容窗口失败，可能需要管理员权限")
    return {**_league_client_window_info(), "base_width": base_width, "base_height": base_height, "zoom": zoom}


@router.get("/toolkit/game-settings-file")
async def league_game_settings_file_status():
    try:
        path = await _league_game_settings_path()
        mode = "writable" if path.stat().st_mode & stat.S_IWRITE else "readonly"
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"mode": mode, "file_name": path.name}


@router.put("/toolkit/game-settings-file")
async def league_game_settings_file_update(body: GameSettingsFileModeUpdate):
    try:
        path = await _league_game_settings_path()
        os.chmod(path, stat.S_IREAD if body.mode == "readonly" else stat.S_IREAD | stat.S_IWRITE)
        mode = await _league_game_settings_file_mode()
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=409, detail=f"修改游戏设置文件属性失败: {exc}") from exc
    if mode != body.mode:
        raise HTTPException(status_code=409, detail="游戏设置文件属性未按预期生效")
    return {"mode": mode, "file_name": path.name, "applied": True}


@router.get("/toolkit/client-window")
async def league_client_window_status():
    try:
        info = await asyncio.to_thread(_league_client_window_info)
        zoom = await league_lab_service.request("GET", "/riotclient/zoom-scale")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {**info, "zoom": float(zoom) if isinstance(zoom, (int, float)) else None}


@router.put("/toolkit/client-window")
async def league_client_window_resize(body: LeagueClientWindowResize):
    try:
        zoom = await league_lab_service.request("GET", "/riotclient/zoom-scale")
        if not isinstance(zoom, (int, float)):
            raise RuntimeError("LCU 未返回客户端缩放比例")
        info = await asyncio.to_thread(_resize_league_client_window, body.base_width, body.base_height, float(zoom))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {**info, "applied": True}


@router.put("/toolkit/chat-presence")
async def league_update_chat_presence(body: ChatPresenceUpdate):
    patch: dict[str, str] = {}
    if body.availability is not None:
        patch["availability"] = body.availability
    if body.status_message is not None:
        patch["statusMessage"] = body.status_message
    if not patch:
        raise HTTPException(status_code=422, detail="没有需要应用的聊天状态")
    try:
        if body.status_message is not None:
            league_lab_service._interrupt_chat_ready_automation()
        await league_lab_service.request("PUT", "/lol-chat/v1/me", json_body=patch)
        current = await league_lab_service.request("GET", "/lol-chat/v1/me")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"chat_presence": current if isinstance(current, dict) else patch, "applied": True}


@router.put("/toolkit/ranked-status")
async def league_update_ranked_status(body: RankedStatusUpdate):
    try:
        await league_lab_service.apply_ranked_status(body)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ranked_status": body.model_dump(), "applied": True}


@router.post("/toolkit/terminate-game-client")
async def league_terminate_game_client():
    try:
        pid = await asyncio.to_thread(_terminate_foreground_league_game_client)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"terminated": True, "pid": pid}


@router.post("/toolkit/chat-message")
async def league_send_chat_message(body: ChatMessageSend):
    lines = [line.strip() for line in body.lines if line.strip()]
    if not lines:
        raise HTTPException(status_code=422, detail="消息内容不能为空")
    if any(len(line) > 300 for line in lines):
        raise HTTPException(status_code=422, detail="单行消息不能超过 300 字")
    try:
        conversations = await league_lab_service.request("GET", "/lol-chat/v1/conversations")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    wanted = {"ChampSelect": {"championselect", "champion-select"}, "Lobby": {"customgame", "custom-game"}}.get(
        league_lab_service.phase, set()
    )
    conversation = next(
        (row for row in conversations if isinstance(row, dict) and str(row.get("type") or "").lower() in wanted),
        None,
    ) if isinstance(conversations, list) else None
    if not conversation or not conversation.get("id"):
        raise HTTPException(status_code=409, detail="当前不在可发送消息的房间或英雄选择阶段")
    try:
        await league_lab_service.request(
            "POST",
            f"/lol-chat/v1/conversations/{conversation['id']}/messages",
            json_body={"body": "\n".join(lines), "type": "chat"},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"sent": True, "phase": league_lab_service.phase, "line_count": len(lines)}


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


@router.post("/champ-select/bench/swap/{champion_id}")
async def league_bench_swap(champion_id: int):
    if champion_id <= 0:
        raise HTTPException(status_code=422, detail="无效英雄 ID")
    try:
        await league_lab_service._record_action(
            f"已从备战席换取英雄 {champion_id}",
            "POST",
            f"/lol-champ-select/v1/session/bench/swap/{champion_id}",
        )
        await league_lab_service._refresh_state()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return league_lab_service.status()


@router.post("/champ-select/reroll")
async def league_champ_select_reroll():
    try:
        await league_lab_service._record_action(
            "已使用一次重随",
            "POST",
            "/lol-champ-select/v1/session/my-selection/reroll",
        )
        await league_lab_service._refresh_state()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/champ-select/skin/{skin_id}")
async def league_champ_select_skin(skin_id: int):
    if skin_id <= 0:
        raise HTTPException(status_code=422, detail="无效的皮肤 ID")
    selector = league_lab_service.champ_select.get("skin_selector") or {}
    allowed = {int(row.get("id") or 0) for row in selector.get("skins") or []}
    if skin_id not in allowed:
        raise HTTPException(status_code=409, detail="该皮肤当前不可用或不属于本账号")
    if selector.get("disabled"):
        raise HTTPException(status_code=409, detail="当前阶段不可切换皮肤")
    try:
        await league_lab_service.request(
            "PATCH",
            "/lol-champ-select/v1/session/my-selection",
            json_body={"selectedSkinId": skin_id},
        )
        await league_lab_service._refresh_state()
        return league_lab_service.status()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return league_lab_service.status()
