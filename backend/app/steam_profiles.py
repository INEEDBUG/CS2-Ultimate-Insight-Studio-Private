"""Small, keyless helpers for public Steam Community profile metadata."""

from __future__ import annotations

import time
from urllib.parse import urlparse
from xml.etree import ElementTree

import httpx

_AVATAR_CACHE_TTL_SECONDS = 6 * 60 * 60
_avatar_cache: dict[str, tuple[float, str | None]] = {}


def normalize_steam_id64(value: str) -> str | None:
    steam_id64 = str(value or "").strip()
    if not steam_id64.isdigit() or len(steam_id64) != 17:
        return None
    return steam_id64


def parse_public_avatar_xml(payload: str) -> str | None:
    try:
        root = ElementTree.fromstring(payload)
    except ElementTree.ParseError:
        return None
    avatar_url = str(root.findtext("avatarFull") or "").strip()
    if not avatar_url:
        return None
    parsed = urlparse(avatar_url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or (hostname != "steamstatic.com" and not hostname.endswith(".steamstatic.com")):
        return None
    return avatar_url


async def get_public_steam_avatar(steam_id64: str) -> str | None:
    normalized = normalize_steam_id64(steam_id64)
    if not normalized:
        return None
    now = time.monotonic()
    cached = _avatar_cache.get(normalized)
    if cached and cached[0] > now:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            response = await client.get(f"https://steamcommunity.com/profiles/{normalized}?xml=1")
            response.raise_for_status()
        avatar_url = parse_public_avatar_xml(response.text)
    except (httpx.HTTPError, ValueError):
        avatar_url = None
    _avatar_cache[normalized] = (now + _AVATAR_CACHE_TTL_SECONDS, avatar_url)
    return avatar_url
