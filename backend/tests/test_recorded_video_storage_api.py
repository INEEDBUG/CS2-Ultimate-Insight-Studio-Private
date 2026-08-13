import asyncio

from app import main


def _run(coro):
    return asyncio.run(coro)


def test_recorded_video_storage_prefers_obs_and_keeps_recent_fallback(monkeypatch):
    async def fake_rows(*, limit, offset):
        assert (limit, offset) == (1, 0)
        return [{"output_path": r"D:\Recordings\old.mp4"}]

    monkeypatch.setattr(main.montage_db, "list_recorded_clips", fake_rows)
    monkeypatch.setattr(main.obs_config_center, "get_status_payload", lambda _cfg: {
        "obs_connected": True,
        "recording": {"output_path": r"E:\OBS"},
    })

    result = _run(main.get_recorded_clips_storage())

    assert result == {
        "configured_path": r"E:\OBS",
        "recent_path": r"D:\Recordings",
        "obs_connected": True,
    }


def test_recorded_video_storage_patch_delegates_to_obs(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(main.obs_config_center, "set_recording_output_path", lambda cfg, path: calls.append((cfg, path)) or {"ok": True, "path": path})

    result = _run(main.patch_recorded_clips_storage(main.RecordedClipsStoragePatch(path=str(tmp_path))))

    assert result == {"ok": True, "path": str(tmp_path)}
    assert calls[0][1] == str(tmp_path)
