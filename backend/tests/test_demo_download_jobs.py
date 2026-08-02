import asyncio
import sys
from contextlib import suppress
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.demo_download_jobs import DemoDownloadJobManager


def test_download_job_completes_with_progress_and_result():
    async def scenario():
        manager = DemoDownloadJobManager()

        async def worker(job):
            job.update(stage="downloading", progress=0.5, message="half")
            await asyncio.sleep(0)
            return {"filename": "match.dem"}

        started = manager.start("CSGO-test", True, worker)
        await manager._jobs[started["job_id"]].task
        return manager.get(started["job_id"])

    snapshot = asyncio.run(scenario())
    assert snapshot["status"] == "complete"
    assert snapshot["progress"] == 1
    assert snapshot["result"]["filename"] == "match.dem"


def test_download_job_can_be_cancelled_and_retried():
    async def scenario():
        manager = DemoDownloadJobManager()

        async def blocked(job):
            await asyncio.Event().wait()

        started = manager.start("CSGO-test", True, blocked)
        cancelled = manager.cancel(started["job_id"])
        with suppress(asyncio.CancelledError):
            await manager._jobs[started["job_id"]].task

        async def success(job):
            return {"ok": True}

        retried = manager.retry(started["job_id"], success)
        await manager._jobs[retried["job_id"]].task
        return cancelled, manager.get(started["job_id"]), manager.get(retried["job_id"])

    cancelled, old_job, new_job = asyncio.run(scenario())
    assert cancelled["status"] == "cancelled"
    assert old_job["status"] == "cancelled"
    assert new_job["status"] == "complete"
    assert new_job["job_id"] != old_job["job_id"]


def test_running_job_cannot_be_retried():
    async def scenario():
        manager = DemoDownloadJobManager()

        async def blocked(job):
            await asyncio.Event().wait()

        started = manager.start("CSGO-test", True, blocked)
        with pytest.raises(ValueError, match="失败或已取消"):
            manager.retry(started["job_id"], blocked)
        manager.cancel(started["job_id"])
        with suppress(asyncio.CancelledError):
            await manager._jobs[started["job_id"]].task

    asyncio.run(scenario())
