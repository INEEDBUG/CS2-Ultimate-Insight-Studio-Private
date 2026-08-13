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
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .env_utils import get_data_dir


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/league-lab", tags=["league-lab"])

_PORT_RE = re.compile(r"--app-port=(\d+)")
_TOKEN_RE = re.compile(r"--remoting-auth-token=([\w_-]+)")
_REGION_RE = re.compile(r"--region=([\w_-]+)", re.IGNORECASE)
_PLATFORM_RE = re.compile(r"--rso[_-]platform[_-]id=([\w_-]+)", re.IGNORECASE)


class LeagueLabSettings(BaseModel):
    automation_enabled: bool = False
    auto_accept_enabled: bool = False
    auto_accept_delay_seconds: float = Field(default=1.0, ge=0.0, le=10.0)
    play_again_enabled: bool = False
    auto_reconnect_enabled: bool = False
    invitation_strategy: Literal["ignore", "accept", "decline"] = "ignore"
    auto_select_enabled: bool = False
    auto_pick_champion_ids: list[int] = Field(default_factory=list)
    auto_ban_champion_ids: list[int] = Field(default_factory=list)
    champion_action_delay_seconds: float = Field(default=1.0, ge=0.0, le=10.0)
    champion_lock_in: bool = True
    auto_champion_config_enabled: bool = False
    champion_loadouts: list["ChampionLoadout"] = Field(default_factory=list)
    auto_honor_enabled: bool = False


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
        self.last_error = ""
        self.last_action = ""
        self.last_action_at = 0.0
        self._task: asyncio.Task | None = None
        self._accept_due_at: float | None = None
        self._acted_phase = ""
        self._phase_action_done = ""
        self._phase_action_due_at: float | None = None
        self._handled_invitations: set[str] = set()
        self._handled_champion_actions: set[str] = set()
        self._configured_champion_id = 0
        self._honored_game_id = ""
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
        if not settings.auto_accept_enabled:
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

    async def refresh_connection(self, *, force: bool = False) -> bool:
        now = time.monotonic()
        if not force and self.credentials and now - self._last_discovery_at < 5.0:
            return True
        if not force and now - self._last_discovery_at < 5.0:
            return False
        self._last_discovery_at = now
        credentials = await discover_lcu_credentials()
        if credentials != self.credentials:
            self.credentials = credentials
            self.phase = ""
            self.summoner_name = ""
            self._acted_phase = ""
            self._phase_action_done = ""
            self._phase_action_due_at = None
            self._accept_due_at = None
        return credentials is not None

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
            "region": credentials.region if credentials else "",
            "platform_id": credentials.platform_id if credentials else "",
            "last_error": self.last_error,
            "last_action": self.last_action,
            "last_action_at": self.last_action_at or None,
            "champ_select": self.champ_select,
            "settings": self.settings.model_dump(),
        }

    async def _refresh_state(self) -> None:
        try:
            phase = await self.request("GET", "/lol-gameflow/v1/gameflow-phase")
            self.phase = str(phase or "")
            summoner = await self.request("GET", "/lol-summoner/v1/current-summoner")
            if isinstance(summoner, dict):
                self.summoner_name = str(summoner.get("gameName") or summoner.get("displayName") or "")
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
        return {"local_player_cell_id": session.get("localPlayerCellId"), "my_team": members}

    async def _run_auto_select(self) -> None:
        session = await self.request("GET", "/lol-champ-select/v1/session")
        if not isinstance(session, dict):
            return
        local_cell = session.get("localPlayerCellId")
        for action_group in session.get("actions") or []:
            for action in action_group or []:
                if not isinstance(action, dict) or action.get("actorCellId") != local_cell or not action.get("isInProgress"):
                    continue
                action_type = action.get("type")
                candidates = self.settings.auto_pick_champion_ids if action_type == "pick" else self.settings.auto_ban_champion_ids
                action_key = f"{action_type}:{action.get('id')}"
                if action_type not in {"pick", "ban"} or not candidates or action_key in self._handled_champion_actions:
                    continue
                available_path = "/lol-champ-select/v1/pickable-champion-ids" if action_type == "pick" else "/lol-champ-select/v1/bannable-champion-ids"
                available = await self.request("GET", available_path)
                champion_id = next((value for value in candidates if value in (available or [])), None)
                if champion_id is None:
                    continue
                await asyncio.sleep(self.settings.champion_action_delay_seconds)
                await self.request("PATCH", f"/lol-champ-select/v1/session/actions/{action.get('id')}", json_body={
                    "championId": champion_id,
                    "type": action_type,
                    "completed": self.settings.champion_lock_in,
                })
                self._handled_champion_actions.add(action_key)
                self.last_action = f"已自动{'选择' if action_type == 'pick' else '禁用'}英雄 {champion_id}"
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
        eligible = list(ballot.get("eligibleAllies") or []) + list(ballot.get("eligibleOpponents") or [])
        candidates = [item for item in eligible if isinstance(item, dict) and not item.get("botPlayer") and item.get("puuid")][:votes]
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

        if settings.invitation_strategy != "ignore":
            invitations = await self.request("GET", "/lol-lobby/v2/received-invitations")
            if isinstance(invitations, list):
                for invitation in invitations:
                    invite_id = str(invitation.get("invitationId") or "") if isinstance(invitation, dict) else ""
                    if not invite_id or invite_id in self._handled_invitations:
                        continue
                    action = settings.invitation_strategy
                    await self._record_action(
                        "已自动接受房间邀请" if action == "accept" else "已自动拒绝房间邀请",
                        "POST",
                        f"/lol-lobby/v2/received-invitations/{invite_id}/{action}",
                    )
                    self._handled_invitations.add(invite_id)

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
            await asyncio.sleep(1.0 if self.credentials else 5.0)


league_lab_service = LeagueLabService()


async def _champion_names() -> dict[int, str]:
    try:
        rows = await league_lab_service.request("GET", "/lol-game-data/assets/v1/champion-summary.json")
    except RuntimeError:
        return {}
    return {int(row.get("id")): str(row.get("name") or row.get("alias") or row.get("id")) for row in (rows or []) if isinstance(row, dict) and row.get("id")}


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
    games = ((payload or {}).get("games") or {}).get("games") or []
    normalized = []
    for game in games:
        identities = game.get("participantIdentities") or []
        participant_id = identities[0].get("participantId") if identities else None
        participant = next((p for p in (game.get("participants") or []) if p.get("participantId") == participant_id), None)
        if not participant:
            continue
        stats = participant.get("stats") or {}
        champion_id = int(participant.get("championId") or 0)
        normalized.append({
            "game_id": game.get("gameId"), "played_at": game.get("gameCreationDate") or game.get("gameCreation"),
            "duration_seconds": game.get("gameDuration"), "game_mode": game.get("gameMode"), "queue_id": game.get("queueId"),
            "champion_id": champion_id, "champion_name": names.get(champion_id, str(champion_id)),
            "spell1_id": participant.get("spell1Id"), "spell2_id": participant.get("spell2Id"),
            "kills": stats.get("kills", 0), "deaths": stats.get("deaths", 0), "assists": stats.get("assists", 0),
            "win": bool(stats.get("win")), "cs": int(stats.get("totalMinionsKilled", 0)) + int(stats.get("neutralMinionsKilled", 0)),
            "gold": stats.get("goldEarned", 0), "damage": stats.get("totalDamageDealtToChampions", 0),
            "items": [stats.get(f"item{i}") for i in range(7) if stats.get(f"item{i}")],
        })
    return {"matches": normalized, "count": len(normalized)}


@router.post("/actions/{action}")
async def run_league_lab_action(action: Literal["accept", "play-again", "reconnect"]):
    endpoints = {
        "accept": ("接受对局", "/lol-matchmaking/v1/ready-check/accept"),
        "play-again": ("返回房间", "/lol-lobby/v2/play-again"),
        "reconnect": ("重新连接", "/lol-gameflow/v1/reconnect"),
    }
    label, path = endpoints[action]
    try:
        await league_lab_service._record_action(label, "POST", path)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return league_lab_service.status()
