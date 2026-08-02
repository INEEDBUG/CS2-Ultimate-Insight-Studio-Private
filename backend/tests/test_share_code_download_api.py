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


def test_share_code_download_resolves_downloads_and_ingests(tmp_path: Path, monkeypatch):
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

    async def ingest(path):
        calls["ingest"] = path
        return 73

    monkeypatch.setattr(main, "resolve_valve_demo", resolve)
    monkeypatch.setattr(main, "download_demo", download)
    monkeypatch.setattr(main, "_enqueue_and_ingest_demo_path", ingest)

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
    assert calls["ingest"] == downloaded
    assert result["match_id"] == "3833252925791010941"
    assert result["filename"] == downloaded.name


def test_downloaded_demo_runs_shared_pending_ingest_pipeline(tmp_path: Path, monkeypatch):
    demo_path = tmp_path / "match730_42.dem"
    demo_path.write_bytes(b"demo")
    calls = {}

    async def enqueue(path):
        calls["enqueue"] = path

    async def get_by_path(path):
        calls["lookup"] = path
        return {"id": 42, "status": "pending"}

    async def ingest(demo_ids):
        calls["ingest"] = demo_ids
        return {"ingested": 1, "failed": []}

    monkeypatch.setattr(main, "_enqueue_demo_path", enqueue)
    monkeypatch.setattr(main, "demo_db", SimpleNamespace(get_demo_by_path=get_by_path))
    monkeypatch.setattr(main, "_ingest_pending_demo_ids", ingest)

    demo_id = asyncio.run(main._enqueue_and_ingest_demo_path(demo_path))

    assert demo_id == 42
    assert calls == {
        "enqueue": demo_path,
        "lookup": str(demo_path.resolve()),
        "ingest": [42],
    }


def test_downloaded_demo_reports_metadata_ingest_failure(tmp_path: Path, monkeypatch):
    demo_path = tmp_path / "match730_42.dem"
    demo_path.write_bytes(b"demo")

    async def enqueue(_path):
        return None

    async def get_by_path(_path):
        return {"id": 42, "status": "pending"}

    async def ingest(_demo_ids):
        return {"ingested": 0, "failed": [{"demo_id": 42, "error": "bad header"}]}

    monkeypatch.setattr(main, "_enqueue_demo_path", enqueue)
    monkeypatch.setattr(main, "demo_db", SimpleNamespace(get_demo_by_path=get_by_path))
    monkeypatch.setattr(main, "_ingest_pending_demo_ids", ingest)

    with pytest.raises(RuntimeError, match="自动入库失败：bad header"):
        asyncio.run(main._enqueue_and_ingest_demo_path(demo_path))


def test_share_code_download_job_endpoint_completes(monkeypatch):
    async def scenario():
        manager = main.DemoDownloadJobManager()
        monkeypatch.setattr(main, "demo_download_jobs", manager)
        monkeypatch.setattr(
            main,
            "load_config",
            lambda: SimpleNamespace(demo_watch_paths=["D:/demo-library"]),
        )

        async def worker(job):
            job.update(stage="downloading", progress=0.5, message="halfway")
            await asyncio.sleep(0)
            return {"match_id": "42", "filename": "match730_42.dem"}

        monkeypatch.setattr(main, "_run_share_code_download_job", worker)
        body = main.MatchShareCodeDownloadBody(
            share_code="CSGO-88Xwc-WZWzc-Z2bjd-5apou-yqk2H",
            accept_gpl_sidecar=True,
        )

        started = await main.start_share_code_download_job(body)
        await manager._jobs[started["job_id"]].task
        completed = await main.get_share_code_download_job(started["job_id"])

        assert started["status"] == "running"
        assert completed["status"] == "complete"
        assert completed["stage"] == "complete"
        assert completed["progress"] == 1.0
        assert completed["result"]["filename"] == "match730_42.dem"

    asyncio.run(scenario())


def test_share_code_download_job_endpoint_rejects_missing_consent():
    body = main.MatchShareCodeDownloadBody(
        share_code="CSGO-88Xwc-WZWzc-Z2bjd-5apou-yqk2H",
        accept_gpl_sidecar=False,
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(main.start_share_code_download_job(body))

    assert exc_info.value.status_code == 400


@pytest.mark.parametrize("status_code", [403, 404, 410])
def test_valve_expired_download_status_has_actionable_diagnosis(status_code):
    status, message = main._valve_demo_download_http_error(status_code)

    assert status == 410
    assert "可能已经过期" in message


@pytest.mark.parametrize("status_code", [429, 500, 503])
def test_valve_busy_download_status_is_retryable(status_code):
    status, message = main._valve_demo_download_http_error(status_code)

    assert status == 503
    assert "稍后重试" in message
