"""Local League Client (LCU) automation for the integrated League lab.

The authentication token is discovered from the running LeagueClientUx process,
kept in memory only, and never written to config or logs.
"""

from __future__ import annotations

import asyncio
import base64
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
    script = (
        "$p=Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" "
        "| Select-Object -First 1 -ExpandProperty CommandLine; if($p){[Console]::Out.Write($p)}"
    )
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    def read_command_line() -> bytes:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5.0,
            check=False,
            creationflags=creation_flags,
        )
        return completed.stdout

    try:
        stdout = await asyncio.to_thread(read_command_line)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return parse_league_client_command_line(stdout.decode("utf-8", errors="ignore"))


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

    async def request(self, method: str, path: str, *, json_body=None):
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
        except RuntimeError:
            return

    async def _record_action(self, label: str, method: str, path: str) -> None:
        await self.request(method, path)
        self.last_action = label
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

        if phase in {"EndOfGame", "WaitingForStats", "PreEndOfGame"} and settings.play_again_enabled:
            if self._phase_action_done != "play-again" and time.monotonic() >= (self._phase_action_due_at or 0):
                await self._record_action("已自动返回房间", "POST", "/lol-lobby/v2/play-again")
                self._phase_action_done = "play-again"
        elif phase == "Reconnect" and settings.auto_reconnect_enabled:
            if self._phase_action_done != "reconnect" and time.monotonic() >= (self._phase_action_due_at or 0):
                await self._record_action("已自动重新连接", "POST", "/lol-gameflow/v1/reconnect")
                self._phase_action_done = "reconnect"

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


@router.get("/status")
async def league_lab_status():
    return await league_lab_service.snapshot()


@router.put("/settings")
async def update_league_lab_settings(body: LeagueLabSettings):
    league_lab_service.update_settings(body)
    return league_lab_service.status()


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
