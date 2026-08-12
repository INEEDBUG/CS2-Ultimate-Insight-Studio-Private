"""In-memory lifecycle manager for cancellable demo download jobs."""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


Worker = Callable[["DemoDownloadJob"], Awaitable[dict[str, Any]]]


@dataclass
class DemoDownloadJob:
    id: str
    share_code: str
    accept_gpl_sidecar: bool
    stage: str = "queued"
    progress: float = 0.0
    message: str = "等待开始"
    status: str = "running"
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    task: asyncio.Task | None = field(default=None, repr=False)
    kind: str = "share_code"
    filename: str | None = None
    source_url: str | None = None
    destination_path: str | None = None
    download_bytes: int = 0
    download_total_bytes: int | None = None
    download_speed_bps: float = 0.0
    upload_bytes: int = 0
    upload_speed_bps: float = 0.0

    def update(self, *, stage: str, progress: float, message: str) -> None:
        self.stage = stage
        self.progress = max(0.0, min(1.0, float(progress)))
        self.message = message
        self.updated_at = time.time()

    def snapshot(self) -> dict[str, Any]:
        return {
            "job_id": self.id,
            "share_code": self.share_code,
            "status": self.status,
            "stage": self.stage,
            "progress": round(self.progress, 4),
            "message": self.message,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "kind": self.kind,
            "filename": self.filename,
            "source_url": self.source_url,
            "destination_path": self.destination_path,
            "download_bytes": self.download_bytes,
            "download_total_bytes": self.download_total_bytes,
            "download_speed_bps": round(self.download_speed_bps, 1),
            "upload_bytes": self.upload_bytes,
            "upload_speed_bps": round(self.upload_speed_bps, 1),
        }

    def update_transfer(
        self,
        *,
        downloaded: int,
        total: int | None,
        speed_bps: float,
    ) -> None:
        self.download_bytes = max(0, int(downloaded))
        self.download_total_bytes = None if total is None else max(0, int(total))
        self.download_speed_bps = max(0.0, float(speed_bps))
        self.updated_at = time.time()


class DemoDownloadJobManager:
    def __init__(self, max_jobs: int = 100) -> None:
        self.max_jobs = max(10, int(max_jobs))
        self._jobs: dict[str, DemoDownloadJob] = {}

    def start(
        self,
        share_code: str,
        accept_gpl_sidecar: bool,
        worker: Worker,
        *,
        kind: str = "share_code",
        filename: str | None = None,
        source_url: str | None = None,
        destination_path: str | None = None,
    ) -> dict[str, Any]:
        self._trim()
        job = DemoDownloadJob(
            id=uuid.uuid4().hex,
            share_code=share_code,
            accept_gpl_sidecar=accept_gpl_sidecar,
            kind=kind,
            filename=filename,
            source_url=source_url,
            destination_path=destination_path,
        )
        self._jobs[job.id] = job
        job.task = asyncio.create_task(self._run(job, worker))
        return job.snapshot()

    async def _run(self, job: DemoDownloadJob, worker: Worker) -> None:
        try:
            job.result = await worker(job)
            if job.cancel_event.is_set():
                raise asyncio.CancelledError
            job.status = "complete"
            job.download_speed_bps = 0.0
            job.upload_speed_bps = 0.0
            job.update(stage="complete", progress=1.0, message="Demo 已加入本地库")
        except asyncio.CancelledError:
            job.status = "cancelled"
            job.download_speed_bps = 0.0
            job.upload_speed_bps = 0.0
            job.update(stage="cancelled", progress=job.progress, message="任务已取消")
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc) or exc.__class__.__name__
            job.download_speed_bps = 0.0
            job.upload_speed_bps = 0.0
            job.update(stage="failed", progress=job.progress, message="任务失败")

    def get(self, job_id: str) -> dict[str, Any] | None:
        job = self._jobs.get(job_id)
        return None if job is None else job.snapshot()

    def list(self, *, active_only: bool = False) -> list[dict[str, Any]]:
        jobs = self._jobs.values()
        if active_only:
            jobs = (job for job in jobs if job.status == "running")
        return [job.snapshot() for job in sorted(jobs, key=lambda item: item.created_at, reverse=True)]

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        if job.status == "running":
            job.cancel_event.set()
            job.status = "cancelled"
            job.update(stage="cancelled", progress=job.progress, message="任务已取消")
            if job.task is not None:
                job.task.cancel()
        return job.snapshot()

    def retry(self, job_id: str, worker: Worker) -> dict[str, Any] | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        if job.status not in {"failed", "cancelled"}:
            raise ValueError("只有失败或已取消的任务可以重试")
        return self.start(
            job.share_code,
            job.accept_gpl_sidecar,
            worker,
            kind=job.kind,
            filename=job.filename,
            source_url=job.source_url,
            destination_path=job.destination_path,
        )

    def _trim(self) -> None:
        if len(self._jobs) < self.max_jobs:
            return
        finished = sorted(
            (job for job in self._jobs.values() if job.status != "running"),
            key=lambda item: item.updated_at,
        )
        while len(self._jobs) >= self.max_jobs and finished:
            self._jobs.pop(finished.pop(0).id, None)
