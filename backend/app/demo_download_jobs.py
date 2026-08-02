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
        }


class DemoDownloadJobManager:
    def __init__(self, max_jobs: int = 100) -> None:
        self.max_jobs = max(10, int(max_jobs))
        self._jobs: dict[str, DemoDownloadJob] = {}

    def start(self, share_code: str, accept_gpl_sidecar: bool, worker: Worker) -> dict[str, Any]:
        self._trim()
        job = DemoDownloadJob(
            id=uuid.uuid4().hex,
            share_code=share_code,
            accept_gpl_sidecar=accept_gpl_sidecar,
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
            job.update(stage="complete", progress=1.0, message="Demo 已加入本地库")
        except asyncio.CancelledError:
            job.status = "cancelled"
            job.update(stage="cancelled", progress=job.progress, message="任务已取消")
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc) or exc.__class__.__name__
            job.update(stage="failed", progress=job.progress, message="任务失败")

    def get(self, job_id: str) -> dict[str, Any] | None:
        job = self._jobs.get(job_id)
        return None if job is None else job.snapshot()

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
        return self.start(job.share_code, job.accept_gpl_sidecar, worker)

    def _trim(self) -> None:
        if len(self._jobs) < self.max_jobs:
            return
        finished = sorted(
            (job for job in self._jobs.values() if job.status != "running"),
            key=lambda item: item.updated_at,
        )
        while len(self._jobs) >= self.max_jobs and finished:
            self._jobs.pop(finished.pop(0).id, None)
