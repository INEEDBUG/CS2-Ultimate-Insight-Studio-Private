import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main
from app.valve_demo_resolver import ResolvedValveDemo


def test_share_code_download_requires_sidecar_consent():
    body = main.MatchShareCodeDownloadBody(
        share_code="CSGO-88Xwc-WZWzc-Z2bjd-5apou-yqk2H",
        accept_gpl_sidecar=False,
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(main.download_match_demo_from_share_code(body))

    assert exc_info.value.status_code == 400


def test_share_code_download_resolves_downloads_and_enqueues(tmp_path: Path, monkeypatch):
    library = tmp_path / "library"
    config_file = tmp_path / "config" / "config.json"
    downloaded = library / "match730_3833252925791010941.dem"
    calls = {}

    monkeypatch.setattr(
        main,
        "load_config",
        lambda: SimpleNamespace(demo_watch_paths=[str(library)]),
    )
    monkeypatch.setattr(main, "resolve_config_path", lambda: config_file)

    async def resolve(value, runtime_parent):
        calls["resolve"] = (value, runtime_parent)
        return ResolvedValveDemo(
            share_code="CSGO-88Xwc-WZWzc-Z2bjd-5apou-yqk2H",
            match_id=3833252925791010941,
            reservation_id=3833257807021343320,
            tv_port=52348,
            demo_url="https://replay131.valve.net/730/example.dem.bz2",
        )

    async def download(url, dest_dir, filename):
        calls["download"] = (url, dest_dir, filename)
        return downloaded

    async def enqueue(path):
        calls["enqueue"] = path

    monkeypatch.setattr(main, "resolve_valve_demo", resolve)
    monkeypatch.setattr(main, "download_demo", download)
    monkeypatch.setattr(main, "_enqueue_demo_path", enqueue)

    body = main.MatchShareCodeDownloadBody(
        share_code="steam://rungame/example",
        accept_gpl_sidecar=True,
    )
    result = asyncio.run(main.download_match_demo_from_share_code(body))

    assert calls["resolve"] == (
        "steam://rungame/example",
        config_file.parent / "third_party" / "boiler-writter",
    )
    assert calls["download"][1:] == (library, downloaded.name)
    assert calls["enqueue"] == downloaded
    assert result["match_id"] == "3833252925791010941"
    assert result["filename"] == downloaded.name
