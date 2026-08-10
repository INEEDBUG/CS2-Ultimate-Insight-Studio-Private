"""Resolve Valve matchmaking demo URLs from CS2 share codes.

The Steam ``rungame`` URL only carries a match share code.  A normal download
manager cannot turn it into the short-lived ``.dem.bz2`` URL because that URL
must be requested from the Steam Game Coordinator while the local Steam
account is signed in.

This module keeps that integration isolated from the main application:

* share-code decoding is a small Python port of the MIT-licensed
  ``akiver/csgo-sharecode`` implementation;
* Game Coordinator communication is delegated to the unmodified GPL-3.0
  ``@akiver/boiler-writter`` executable as a separate process;
* only the few protobuf fields needed to locate the demo URL are decoded, so
  the desktop backend does not need a second protobuf runtime.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tarfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable, Iterator
from urllib.parse import unquote, urlparse

import httpx


_SHARE_CODE_DICTIONARY = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789"
_SHARE_CODE_PATTERN = re.compile(r"^CSGO(?:-?[A-Za-z0-9_]{5}){5}$")
_SHARE_CODE_SEARCH = re.compile(r"CSGO(?:-?[A-Za-z0-9_]{5}){5}", re.IGNORECASE)

BOILER_VERSION = "1.7.0"
BOILER_PACKAGE_URL = (
    "https://registry.npmjs.org/@akiver/boiler-writter/-/"
    f"boiler-writter-{BOILER_VERSION}.tgz"
)
BOILER_PACKAGE_SHA512_BASE64 = (
    "ponBoa6Rd/ZNFQNOdpOLjcbh01d0Gywo4vPCekKCSnlvv6p+"
    "wubXpPCPEJhVHjHV2WR45930YlPnfkcjuUme/A=="
)
_BOILER_ARCHIVE_FILES = {
    "package/dist/bin/win32-x64/boiler-writter.exe": "boiler-writter.exe",
    "package/dist/bin/win32-x64/steam_api64.dll": "steam_api64.dll",
    "package/dist/bin/win32-x64/steam_appid.txt": "steam_appid.txt",
    "package/LICENSE": "LICENSE.boiler-writter.txt",
}


class ValveDemoResolverError(RuntimeError):
    """Base error for the share-code resolver."""


class InvalidShareCodeError(ValveDemoResolverError):
    """Raised when input does not contain a valid Valve match share code."""


class BoilerRuntimeError(ValveDemoResolverError):
    """Raised when the external Game Coordinator helper cannot be prepared."""


class BoilerProcessError(ValveDemoResolverError):
    """Raised when the Game Coordinator helper reports a known failure."""

    def __init__(self, exit_code: int, message: str):
        super().__init__(message)
        self.exit_code = exit_code


class MatchInfoDecodeError(ValveDemoResolverError):
    """Raised when ``matches.info`` is missing the requested match or URL."""


@dataclass(frozen=True)
class MatchShareCode:
    share_code: str
    match_id: int
    reservation_id: int
    tv_port: int


@dataclass(frozen=True)
class ResolvedValveDemo:
    share_code: str
    match_id: int
    reservation_id: int
    tv_port: int
    demo_url: str
    played_at: str | None = None


@dataclass(frozen=True)
class ValveMatchMetadata:
    match_id: int
    played_at: str | None
    demo_url: str | None


def extract_match_share_code(value: str) -> str:
    """Extract and normalize a match code from a code or Steam rungame URL."""

    decoded = unquote(str(value or "").strip())
    match = _SHARE_CODE_SEARCH.search(decoded)
    if match is None:
        raise InvalidShareCodeError("未找到有效的 CSGO 比赛分享码")
    code = match.group(0)
    code = "CSGO" + code[4:]
    if not _SHARE_CODE_PATTERN.fullmatch(code):
        raise InvalidShareCodeError("比赛分享码格式无效")
    compact = code.replace("CSGO", "", 1).replace("-", "")
    if len(compact) != 25 or any(ch not in _SHARE_CODE_DICTIONARY for ch in compact):
        raise InvalidShareCodeError("比赛分享码包含无效字符")
    return f"CSGO-{'-'.join(compact[i:i + 5] for i in range(0, 25, 5))}"


def decode_match_share_code(value: str) -> MatchShareCode:
    """Decode match id, reservation id and TV port from a Valve share code."""

    share_code = extract_match_share_code(value)
    chars = list(share_code.replace("CSGO", "", 1).replace("-", ""))[::-1]
    total = 0
    for char in chars:
        total = total * len(_SHARE_CODE_DICTIONARY) + _SHARE_CODE_DICTIONARY.index(char)
    payload = total.to_bytes(18, byteorder="big")
    return MatchShareCode(
        share_code=share_code,
        match_id=int.from_bytes(payload[0:8], byteorder="little"),
        reservation_id=int.from_bytes(payload[8:16], byteorder="little"),
        tv_port=int.from_bytes(payload[16:18], byteorder="little"),
    )


def _read_varint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(data) and shift < 70:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
    raise MatchInfoDecodeError("matches.info 包含损坏的 protobuf varint")


def _protobuf_fields(data: bytes) -> Iterator[tuple[int, int, int | bytes]]:
    offset = 0
    while offset < len(data):
        key, offset = _read_varint(data, offset)
        field_number = key >> 3
        wire_type = key & 0x07
        if field_number == 0:
            raise MatchInfoDecodeError("matches.info 包含无效字段")
        if wire_type == 0:
            value, offset = _read_varint(data, offset)
            yield field_number, wire_type, value
        elif wire_type == 1:
            end = offset + 8
            if end > len(data):
                raise MatchInfoDecodeError("matches.info 的 fixed64 字段被截断")
            yield field_number, wire_type, data[offset:end]
            offset = end
        elif wire_type == 2:
            length, offset = _read_varint(data, offset)
            end = offset + length
            if end > len(data):
                raise MatchInfoDecodeError("matches.info 的消息字段被截断")
            yield field_number, wire_type, data[offset:end]
            offset = end
        elif wire_type == 5:
            end = offset + 4
            if end > len(data):
                raise MatchInfoDecodeError("matches.info 的 fixed32 字段被截断")
            yield field_number, wire_type, data[offset:end]
            offset = end
        else:
            raise MatchInfoDecodeError(f"matches.info 使用了不支持的 wire type {wire_type}")


def _first_varint(data: bytes, field_number: int) -> int | None:
    for number, wire_type, value in _protobuf_fields(data):
        if number == field_number and wire_type == 0:
            return int(value)
    return None


def _validate_demo_url(value: str) -> str:
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"}:
        raise MatchInfoDecodeError("Game Coordinator 返回了不支持的 Demo URL 协议")
    if hostname != "valve.net" and not hostname.endswith(".valve.net"):
        raise MatchInfoDecodeError("Game Coordinator 返回了非 Valve 域名的 Demo URL")
    try:
        port = parsed.port
    except ValueError as exc:
        raise MatchInfoDecodeError("Game Coordinator 返回了无效端口") from exc
    if parsed.username or parsed.password or port not in {None, 80, 443}:
        raise MatchInfoDecodeError("Game Coordinator 返回了不安全的 Demo URL")
    if not parsed.path.lower().endswith(".dem.bz2"):
        raise MatchInfoDecodeError("Game Coordinator 返回的地址不是 Demo 压缩包")
    return value


def parse_match_list_metadata(payload: bytes, expected_match_id: int) -> ValveMatchMetadata:
    """Read stable match metadata from a CMsg...MatchList payload.

    ``matchtime`` is field 2 of ``CDataGCCStrike15_v2_MatchInfo``.  Unlike a
    local file timestamp it is the server-authored start time, so it is safe to
    label as the actual match time.  The replay URL is optional because Valve
    can retire it while the match metadata remains useful.
    """

    match_messages = [
        bytes(value)
        for number, wire_type, value in _protobuf_fields(payload)
        if number == 4 and wire_type == 2
    ]
    for match_message in match_messages:
        match_id = _first_varint(match_message, 1)
        if match_id != expected_match_id:
            continue
        match_time = _first_varint(match_message, 2)
        played_at = None
        if match_time and match_time > 0:
            try:
                played_at = datetime.fromtimestamp(match_time, tz=timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                )
            except (OverflowError, OSError, ValueError):
                played_at = None
        fields = list(_protobuf_fields(match_message))
        round_messages = [
            bytes(value)
            for number, wire_type, value in fields
            if number == 5 and wire_type == 2
        ]
        if not round_messages:
            round_messages = [
                bytes(value)
                for number, wire_type, value in fields
                if number == 4 and wire_type == 2
            ]
        if not round_messages:
            return ValveMatchMetadata(match_id=match_id, played_at=played_at, demo_url=None)
        for number, wire_type, value in _protobuf_fields(round_messages[-1]):
            if number == 3 and wire_type == 2:
                try:
                    demo_url = _validate_demo_url(bytes(value).decode("utf-8"))
                    return ValveMatchMetadata(match_id=match_id, played_at=played_at, demo_url=demo_url)
                except UnicodeDecodeError as exc:
                    raise MatchInfoDecodeError("Demo URL 不是有效 UTF-8") from exc
        return ValveMatchMetadata(match_id=match_id, played_at=played_at, demo_url=None)
    raise MatchInfoDecodeError("Game Coordinator 未返回对应比赛，Demo 可能已经过期")


def parse_match_list_demo_url(payload: bytes, expected_match_id: int) -> str:
    """Read the requested match's active demo URL from a match-list payload."""

    metadata = parse_match_list_metadata(payload, expected_match_id)
    if not metadata.demo_url:
        raise MatchInfoDecodeError("比赛信息中没有 Demo 下载地址，可能已经过期")
    return metadata.demo_url


def _boiler_runtime_is_ready(runtime_dir: Path) -> bool:
    manifest = runtime_dir / "runtime.json"
    required = [runtime_dir / name for name in _BOILER_ARCHIVE_FILES.values()]
    if not manifest.is_file() or not all(path.is_file() for path in required):
        return False
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False
    return (
        data.get("version") == BOILER_VERSION
        and data.get("package_sha512") == BOILER_PACKAGE_SHA512_BASE64
    )


def _install_boiler_archive(archive: bytes, runtime_parent: Path) -> Path:
    digest = base64.b64encode(hashlib.sha512(archive).digest()).decode("ascii")
    if digest != BOILER_PACKAGE_SHA512_BASE64:
        raise BoilerRuntimeError("Game Coordinator 组件完整性校验失败")

    runtime_parent.mkdir(parents=True, exist_ok=True)
    target = runtime_parent / BOILER_VERSION
    if _boiler_runtime_is_ready(target):
        return target / "boiler-writter.exe"

    staging = runtime_parent / f".{BOILER_VERSION}.{uuid.uuid4().hex}.partial"
    staging.mkdir(parents=True)
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
            for source_name, destination_name in _BOILER_ARCHIVE_FILES.items():
                try:
                    member = package.getmember(source_name)
                except KeyError as exc:
                    raise BoilerRuntimeError(
                        f"Game Coordinator 组件缺少 {source_name}"
                    ) from exc
                source = package.extractfile(member)
                if source is None:
                    raise BoilerRuntimeError(f"Game Coordinator 组件缺少 {source_name}")
                destination = staging / destination_name
                with source, destination.open("wb") as writer:
                    shutil.copyfileobj(source, writer)
        (staging / "runtime.json").write_text(
            json.dumps(
                {
                    "name": "@akiver/boiler-writter",
                    "version": BOILER_VERSION,
                    "license": "GPL-3.0",
                    "package_url": BOILER_PACKAGE_URL,
                    "package_sha512": BOILER_PACKAGE_SHA512_BASE64,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        if target.exists():
            if _boiler_runtime_is_ready(target):
                shutil.rmtree(staging, ignore_errors=True)
                return target / "boiler-writter.exe"
            raise BoilerRuntimeError(f"Game Coordinator 组件目录不完整：{target}")
        os.replace(staging, target)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return target / "boiler-writter.exe"


async def ensure_boiler_runtime(runtime_parent: Path) -> Path:
    """Download and verify the optional, version-pinned GC helper on demand."""

    target = runtime_parent / BOILER_VERSION
    if _boiler_runtime_is_ready(target):
        return target / "boiler-writter.exe"
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            response = await client.get(BOILER_PACKAGE_URL)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise BoilerRuntimeError(f"无法下载 Game Coordinator 组件：{exc}") from exc
    return await asyncio.to_thread(_install_boiler_archive, response.content, runtime_parent)


_BOILER_EXIT_MESSAGES = {
    1: "Game Coordinator 组件发生未知错误",
    2: "传给 Game Coordinator 组件的比赛参数无效",
    3: "无法与 Steam Game Coordinator 通信，请稍后重试",
    4: "CS2 正在占用 Game Coordinator，请关闭游戏后重试",
    5: "Steam 需要重新启动后才能读取比赛信息",
    6: "Steam 未运行或当前账号尚未登录",
    7: "当前 Steam 用户未登录",
    8: "未找到比赛，Demo 可能已经过期",
    9: "无法写入临时比赛信息文件",
}


async def run_boiler_runtime(
    executable: Path,
    output_path: Path,
    share_code: MatchShareCode,
    timeout_seconds: float = 90.0,
) -> bytes:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.unlink(missing_ok=True)
    try:
        process = await asyncio.create_subprocess_exec(
            str(executable),
            str(output_path),
            str(share_code.match_id),
            str(share_code.reservation_id),
            str(share_code.tv_port),
            cwd=str(executable.parent),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except NotImplementedError:
        # The portable Windows server deliberately uses SelectorEventLoop to
        # avoid an IOCP accept-loop crash. SelectorEventLoop cannot create
        # asyncio subprocesses, so run the isolated helper on a worker thread.
        return await asyncio.to_thread(
            _run_boiler_runtime_sync,
            executable,
            output_path,
            share_code,
            timeout_seconds,
        )
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except TimeoutError as exc:
        process.kill()
        await process.wait()
        raise BoilerProcessError(-1, "连接 Steam Game Coordinator 超时") from exc
    if process.returncode != 0:
        message = _BOILER_EXIT_MESSAGES.get(
            int(process.returncode or 1),
            f"Game Coordinator 组件退出，代码 {process.returncode}",
        )
        detail = stderr.decode("utf-8", errors="replace").strip()
        if detail:
            message = f"{message}：{detail[:300]}"
        raise BoilerProcessError(int(process.returncode or 1), message)
    try:
        return output_path.read_bytes()
    except OSError as exc:
        raise BoilerProcessError(9, "Game Coordinator 未生成比赛信息文件") from exc
    finally:
        output_path.unlink(missing_ok=True)


def _run_boiler_runtime_sync(
    executable: Path,
    output_path: Path,
    share_code: MatchShareCode,
    timeout_seconds: float,
) -> bytes:
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        [
            str(executable),
            str(output_path),
            str(share_code.match_id),
            str(share_code.reservation_id),
            str(share_code.tv_port),
        ],
        cwd=str(executable.parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=creation_flags,
    )
    try:
        try:
            _, stderr = process.communicate(timeout=timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            process.kill()
            process.communicate()
            raise BoilerProcessError(-1, "连接 Steam Game Coordinator 超时") from exc
        if process.returncode != 0:
            message = _BOILER_EXIT_MESSAGES.get(
                int(process.returncode or 1),
                f"Game Coordinator 组件退出，代码 {process.returncode}",
            )
            detail = stderr.decode("utf-8", errors="replace").strip()
            if detail:
                message = f"{message}：{detail[:300]}"
            raise BoilerProcessError(int(process.returncode or 1), message)
        try:
            return output_path.read_bytes()
        except OSError as exc:
            raise BoilerProcessError(9, "Game Coordinator 未生成比赛信息文件") from exc
    finally:
        output_path.unlink(missing_ok=True)


async def resolve_valve_demo(
    value: str,
    runtime_parent: Path,
    *,
    runtime_installer: Callable[[Path], Awaitable[Path]] = ensure_boiler_runtime,
    process_runner: Callable[[Path, Path, MatchShareCode], Awaitable[bytes]] = run_boiler_runtime,
) -> ResolvedValveDemo:
    share_code = decode_match_share_code(value)
    executable = await runtime_installer(runtime_parent)
    output_path = runtime_parent / "work" / f"matches-{uuid.uuid4().hex}.info"
    payload = await process_runner(executable, output_path, share_code)
    metadata = parse_match_list_metadata(payload, share_code.match_id)
    if not metadata.demo_url:
        raise MatchInfoDecodeError("比赛信息中没有 Demo 下载地址，可能已经过期")
    return ResolvedValveDemo(
        share_code=share_code.share_code,
        match_id=share_code.match_id,
        reservation_id=share_code.reservation_id,
        tv_port=share_code.tv_port,
        demo_url=metadata.demo_url,
        played_at=metadata.played_at,
    )


async def resolve_valve_match_metadata(
    value: str,
    runtime_parent: Path,
    *,
    runtime_installer: Callable[[Path], Awaitable[Path]] = ensure_boiler_runtime,
    process_runner: Callable[[Path, Path, MatchShareCode], Awaitable[bytes]] = run_boiler_runtime,
) -> ValveMatchMetadata:
    """Resolve match time even when the downloadable replay has expired."""

    share_code = decode_match_share_code(value)
    executable = await runtime_installer(runtime_parent)
    output_path = runtime_parent / "work" / f"matches-{uuid.uuid4().hex}.info"
    payload = await process_runner(executable, output_path, share_code)
    return parse_match_list_metadata(payload, share_code.match_id)
