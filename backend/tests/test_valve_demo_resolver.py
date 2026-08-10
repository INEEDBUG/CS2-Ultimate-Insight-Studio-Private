import base64
import asyncio
import hashlib
import io
import json
import sys
import tarfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import valve_demo_resolver as resolver


USER_SHARE_CODE = "CSGO-88Xwc-WZWzc-Z2bjd-5apou-yqk2H"
USER_STEAM_LINK = (
    "steam://rungame/730/76561202255233023/"
    "+csgo_download_match%20CSGO-88Xwc-WZWzc-Z2bjd-5apou-yqk2H"
)


def _varint(value: int) -> bytes:
    result = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        result.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(result)


def _field_varint(number: int, value: int) -> bytes:
    return _varint(number << 3) + _varint(value)


def _field_bytes(number: int, value: bytes) -> bytes:
    return _varint((number << 3) | 2) + _varint(len(value)) + value


def _match_list(match_id: int, demo_url: str | None, match_time: int = 0) -> bytes:
    round_stats = _field_bytes(3, demo_url.encode("utf-8")) if demo_url else b""
    match_info = _field_varint(1, match_id)
    if match_time:
        match_info += _field_varint(2, match_time)
    if round_stats:
        match_info += _field_bytes(5, round_stats)
    return _field_bytes(4, match_info)


def test_extract_match_share_code_accepts_steam_link():
    assert resolver.extract_match_share_code(USER_STEAM_LINK) == USER_SHARE_CODE


def test_decode_match_share_code_matches_reference_values():
    decoded = resolver.decode_match_share_code(USER_SHARE_CODE)

    assert decoded.match_id == 3833252925791010941
    assert decoded.reservation_id == 3833257807021343320
    assert decoded.tv_port == 52348


@pytest.mark.parametrize(
    "value",
    ["", "CSGO-not-a-code", "CSGO-00000-00000-00000-00000-00000"],
)
def test_invalid_share_codes_are_rejected(value: str):
    with pytest.raises(resolver.InvalidShareCodeError):
        resolver.decode_match_share_code(value)


def test_parse_match_list_demo_url_reads_requested_match():
    decoded = resolver.decode_match_share_code(USER_SHARE_CODE)
    url = "http://replay131.valve.net/730/example.dem.bz2"
    payload = _match_list(123, "http://replay132.valve.net/730/other.dem.bz2")
    payload += _match_list(decoded.match_id, url)

    assert resolver.parse_match_list_demo_url(payload, decoded.match_id) == url


def test_parse_match_list_metadata_keeps_server_match_time_without_replay_url():
    decoded = resolver.decode_match_share_code(USER_SHARE_CODE)
    payload = _match_list(decoded.match_id, None, 1_725_900_000)

    metadata = resolver.parse_match_list_metadata(payload, decoded.match_id)

    assert metadata.demo_url is None
    assert metadata.played_at == "2024-09-09T16:40:00Z"


def test_parse_match_list_demo_url_rejects_non_valve_host():
    decoded = resolver.decode_match_share_code(USER_SHARE_CODE)
    payload = _match_list(decoded.match_id, "https://example.com/demo.dem.bz2")

    with pytest.raises(resolver.MatchInfoDecodeError, match="非 Valve"):
        resolver.parse_match_list_demo_url(payload, decoded.match_id)


def test_missing_match_has_expired_diagnosis():
    decoded = resolver.decode_match_share_code(USER_SHARE_CODE)

    with pytest.raises(resolver.MatchInfoDecodeError, match="可能已经过期"):
        resolver.parse_match_list_demo_url(b"", decoded.match_id)


@pytest.mark.parametrize(
    ("exit_code", "diagnosis"),
    [
        (3, "稍后重试"),
        (4, "关闭游戏后重试"),
        (6, "Steam 未运行"),
        (8, "可能已经过期"),
    ],
)
def test_boiler_exit_codes_have_actionable_diagnoses(tmp_path: Path, monkeypatch, exit_code, diagnosis):
    class FailedProcess:
        returncode = exit_code

        async def communicate(self):
            return b"", b""

        def kill(self):
            raise AssertionError("process should not time out")

        async def wait(self):
            return exit_code

    async def create_process(*args, **kwargs):
        return FailedProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    decoded = resolver.decode_match_share_code(USER_SHARE_CODE)

    with pytest.raises(resolver.BoilerProcessError, match=diagnosis):
        asyncio.run(
            resolver.run_boiler_runtime(
                tmp_path / "boiler-writter.exe",
                tmp_path / "matches.info",
                decoded,
            )
        )


def test_boiler_runtime_falls_back_for_windows_selector_loop(tmp_path: Path, monkeypatch):
    output_path = tmp_path / "matches.info"

    async def unsupported_subprocess(*args, **kwargs):
        raise NotImplementedError

    class SuccessfulProcess:
        returncode = 0

        def communicate(self, timeout=None):
            output_path.write_bytes(b"match-payload")
            return b"", b""

        def kill(self):
            raise AssertionError("process should not time out")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", unsupported_subprocess)
    monkeypatch.setattr(resolver.subprocess, "Popen", lambda *args, **kwargs: SuccessfulProcess())
    decoded = resolver.decode_match_share_code(USER_SHARE_CODE)

    payload = asyncio.run(
        resolver.run_boiler_runtime(
            tmp_path / "boiler-writter.exe",
            output_path,
            decoded,
        )
    )

    assert payload == b"match-payload"
    assert not output_path.exists()


def _runtime_archive() -> bytes:
    files = {
        source: (b"exe" if target.endswith(".exe") else target.encode("utf-8"))
        for source, target in resolver._BOILER_ARCHIVE_FILES.items()
    }
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, content in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
    return output.getvalue()


def test_install_boiler_archive_verifies_and_stages_files(tmp_path: Path, monkeypatch):
    archive = _runtime_archive()
    digest = base64.b64encode(hashlib.sha512(archive).digest()).decode("ascii")
    monkeypatch.setattr(resolver, "BOILER_PACKAGE_SHA512_BASE64", digest)

    executable = resolver._install_boiler_archive(archive, tmp_path)

    assert executable.read_bytes() == b"exe"
    manifest = json.loads((executable.parent / "runtime.json").read_text(encoding="utf-8"))
    assert manifest["version"] == resolver.BOILER_VERSION
    assert manifest["license"] == "GPL-3.0"


def test_install_boiler_archive_rejects_wrong_digest(tmp_path: Path):
    with pytest.raises(resolver.BoilerRuntimeError, match="完整性"):
        resolver._install_boiler_archive(_runtime_archive(), tmp_path)


def test_resolve_valve_demo_composes_runtime_and_parser(tmp_path: Path):
    decoded = resolver.decode_match_share_code(USER_SHARE_CODE)
    expected_url = "https://replay140.valve.net/730/example.dem.bz2"

    async def install(runtime_parent: Path) -> Path:
        assert runtime_parent == tmp_path
        return tmp_path / "boiler-writter.exe"

    async def run(executable: Path, output: Path, share_code: resolver.MatchShareCode) -> bytes:
        assert executable.name == "boiler-writter.exe"
        assert output.parent == tmp_path / "work"
        assert share_code == decoded
        return _match_list(decoded.match_id, expected_url, 1_725_900_000)

    result = asyncio.run(
        resolver.resolve_valve_demo(
            USER_STEAM_LINK,
            tmp_path,
            runtime_installer=install,
            process_runner=run,
        )
    )

    assert result.demo_url == expected_url
    assert result.share_code == USER_SHARE_CODE
    assert result.played_at == "2024-09-09T16:40:00Z"
