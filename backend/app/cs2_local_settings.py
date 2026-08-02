"""Read-only discovery of per-account CS2 settings stored by Steam."""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STEAM_ID64_ACCOUNT_BASE = 76561197960265728
_KV_LINE = re.compile(r'^\s*"([^"]+)"\s+"([^"]*)"', re.MULTILINE)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _parse_flat_keyvalues(path: Path) -> dict[str, str]:
    return {key: value for key, value in _KV_LINE.findall(_read_text(path))}


def _as_int(value: str | None) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _as_float(value: str | None) -> float | None:
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return None


def _aspect_label(mode: str | None, width: int | None, height: int | None) -> str:
    mapped = {"0": "4:3", "1": "16:10", "2": "16:9"}.get(str(mode))
    if mapped:
        return mapped
    if not width or not height:
        return "other"
    ratio = width / height
    candidates = (("16:9", 16 / 9), ("16:10", 16 / 10), ("4:3", 4 / 3), ("5:4", 5 / 4))
    label, expected = min(candidates, key=lambda item: abs(ratio - item[1]))
    return label if abs(ratio - expected) <= 0.04 else "other"


def _window_mode(video: dict[str, str]) -> str:
    if video.get("setting.fullscreen") == "1":
        return "fullscreen"
    if video.get("setting.nowindowborder") == "1":
        return "borderless"
    return "windowed"


def _steam_root_from_registry() -> Path | None:
    if sys.platform != "win32":
        return None
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            value, _ = winreg.QueryValueEx(key, "SteamPath")
            if value:
                return Path(str(value))
    except (OSError, ImportError):
        return None
    return None


def find_steam_root() -> Path | None:
    configured = (os.environ.get("CS2_INSIGHT_STEAM_PATH") or "").strip()
    candidates = [
        Path(configured) if configured else None,
        _steam_root_from_registry(),
        Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Steam" if os.environ.get("PROGRAMFILES(X86)") else None,
        Path.home() / ".steam" / "steam",
    ]
    for candidate in candidates:
        if candidate and (candidate / "userdata").is_dir():
            return candidate.resolve()
    return None


def _login_user_metadata(steam_root: Path) -> dict[str, dict[str, Any]]:
    """Parse only the shallow account records needed from loginusers.vdf."""
    text = _read_text(steam_root / "config" / "loginusers.vdf")
    result: dict[str, dict[str, Any]] = {}
    for match in re.finditer(r'"(7656119\d{10})"\s*\{', text):
        steam_id64 = match.group(1)
        start = match.end() - 1
        depth = 0
        end = start
        for index in range(start, len(text)):
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
                if depth == 0:
                    end = index
                    break
        values = {key: value for key, value in _KV_LINE.findall(text[start + 1 : end])}
        account_id = str(int(steam_id64) - STEAM_ID64_ACCOUNT_BASE)
        result[account_id] = {
            "steam_id64": steam_id64,
            "account_name": values.get("AccountName") or "",
            "persona_name": values.get("PersonaName") or "",
            "most_recent": values.get("MostRecent") == "1",
            "login_timestamp": _as_int(values.get("Timestamp")) or 0,
        }
    return result


def _read_account(account_dir: Path, login_meta: dict[str, Any]) -> dict[str, Any] | None:
    cfg_dir = account_dir / "730" / "local" / "cfg"
    video_path = cfg_dir / "cs2_video.txt"
    convars_path = cfg_dir / "cs2_user_convars_0_slot0.vcfg"
    if not video_path.is_file() and not convars_path.is_file():
        return None

    video = _parse_flat_keyvalues(video_path)
    convars = _parse_flat_keyvalues(convars_path)
    width = _as_int(video.get("setting.defaultres"))
    height = _as_int(video.get("setting.defaultresheight"))
    sensitivity = _as_float(convars.get("sensitivity"))
    mtimes = [path.stat().st_mtime for path in (video_path, convars_path) if path.is_file()]
    updated_ts = max(mtimes, default=0)

    account_id = account_dir.name
    steam_id64 = login_meta.get("steam_id64") or str(STEAM_ID64_ACCOUNT_BASE + int(account_id))
    return {
        "account_id": account_id,
        "steam_id64": steam_id64,
        "account_name": login_meta.get("account_name") or "",
        "persona_name": login_meta.get("persona_name") or "",
        "most_recent": bool(login_meta.get("most_recent")),
        "updated_at": datetime.fromtimestamp(updated_ts, timezone.utc).isoformat() if updated_ts else None,
        "settings": {
            "game_width": width,
            "game_height": height,
            "display_aspect": _aspect_label(video.get("setting.aspectratiomode"), width, height),
            "window_mode": _window_mode(video),
            "current_sensitivity": sensitivity,
            "m_yaw": _as_float(convars.get("m_yaw")),
            "zoom_sensitivity_ratio": _as_float(convars.get("zoom_sensitivity_ratio")),
            # DPI and GPU scaling are not stored in CS2's per-account cfg.
            "dpi": None,
            "scaling_mode": None,
        },
    }


def discover_cs2_settings(steam_root: Path | None = None) -> dict[str, Any]:
    root = steam_root.resolve() if steam_root else find_steam_root()
    if root is None:
        return {"found": False, "steam_root": None, "active_account_id": None, "accounts": []}

    login_users = _login_user_metadata(root)
    accounts: list[dict[str, Any]] = []
    userdata = root / "userdata"
    for account_dir in userdata.iterdir() if userdata.is_dir() else ():
        if not account_dir.is_dir() or not account_dir.name.isdigit():
            continue
        account = _read_account(account_dir, login_users.get(account_dir.name, {}))
        if account:
            accounts.append(account)

    accounts.sort(
        key=lambda item: (
            bool(item["most_recent"]),
            int(login_users.get(item["account_id"], {}).get("login_timestamp") or 0),
            item.get("updated_at") or "",
        ),
        reverse=True,
    )
    return {
        "found": bool(accounts),
        "steam_root": str(root),
        "active_account_id": accounts[0]["account_id"] if accounts else None,
        "accounts": accounts,
        "limitations": ["dpi_not_in_cs2_cfg", "gpu_scaling_not_in_cs2_cfg"],
    }
