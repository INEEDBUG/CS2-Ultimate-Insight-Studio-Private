import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, ExternalLink, FolderCog, FolderOpen, Loader2, Play, RefreshCw, Video } from "lucide-react";
import API, { getRecordedClipStreamUrl } from "../api/api.js";
import { desktopBridge } from "../desktop/desktopBridge.js";

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function fileName(path) {
  return String(path || "").split(/[\\/]/).pop() || "未命名视频";
}

export default function RecordedVideosPage() {
  const [items, setItems] = useState([]);
  const [storage, setStorage] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [clipsResponse, storageResponse] = await Promise.all([
        API.get("/recorded-clips", { params: { limit: 500 } }),
        API.get("/recorded-clips/storage"),
      ]);
      const nextItems = clipsResponse.data?.items || [];
      setItems(nextItems);
      setStorage(storageResponse.data || null);
      setSelectedId((current) => nextItems.some((item) => item.id === current) ? current : nextItems[0]?.id ?? null);
    } catch (error) {
      setMessage(error.response?.data?.detail || error.message || "无法读取已录制视频");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);
  const activeStoragePath = storage?.configured_path || storage?.recent_path || "";

  const chooseStorage = async () => {
    const chosen = await desktopBridge?.chooseDirectory?.(activeStoragePath, "选择后续录制视频的存放目录");
    if (!chosen) return;
    setSaving(true);
    setMessage("");
    try {
      const { data } = await API.patch("/recorded-clips/storage", { path: chosen });
      setStorage((current) => ({ ...(current || {}), configured_path: data.path, obs_connected: true }));
      setMessage("后续录制视频将保存到新目录；已有视频不会被移动。");
    } catch (error) {
      setMessage(error.response?.data?.detail || error.message || "修改录制目录失败");
    } finally {
      setSaving(false);
    }
  };

  const reveal = (path) => { if (path) void API.post("/reveal-file-in-explorer", { path }); };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-cs2-bg-dark px-7 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-cs2-border-subtle pb-4">
        <div><div className="flex items-center gap-2"><Video className="h-5 w-5 text-cs2-accent" /><h1 className="text-xl font-black text-cs2-text-primary">已录制视频</h1></div><p className="mt-1 text-[11px] text-cs2-text-muted">在软件内回看 OBS 成片，并管理后续录制的存放位置。</p></div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-cs2-border bg-cs2-bg-card px-3 py-2 text-[11px] font-bold text-cs2-text-secondary transition-[border-color,transform] duration-150 hover:border-cs2-accent/40 active:scale-[0.98] disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />刷新</button>
      </header>

      <section className="mt-4 flex items-center gap-3 rounded-xl border border-cs2-border bg-cs2-bg-card/75 p-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-cs2-accent-soft text-cs2-accent"><FolderCog className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><p className="text-[10px] font-bold text-cs2-text-primary">后续录制存放目录</p><p className="mt-1 truncate font-mono text-[10px] text-cs2-text-muted">{activeStoragePath || "尚未从 OBS 读取到目录"}</p><p className="mt-1 text-[9px] text-cs2-text-muted">修改的是 OBS 当前 Profile 的录制目录，不会移动已有文件。</p></div>
        <button type="button" onClick={() => activeStoragePath && API.post("/open-folder", { path: activeStoragePath })} disabled={!activeStoragePath} className="rounded-lg border border-cs2-border p-2 text-cs2-text-secondary transition-colors duration-150 hover:text-cs2-accent disabled:opacity-40" title="打开目录"><FolderOpen className="h-4 w-4" /></button>
        <button type="button" onClick={chooseStorage} disabled={saving || !desktopBridge} className="inline-flex items-center gap-2 rounded-lg bg-cs2-accent px-3 py-2 text-[10px] font-bold text-cs2-text-on-accent transition-transform duration-150 active:scale-[0.98] disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderCog className="h-3.5 w-3.5" />}修改目录</button>
      </section>
      {message ? <p role="status" className="mt-2 rounded-lg border border-cs2-border bg-cs2-bg-card px-3 py-2 text-[10px] text-cs2-text-secondary">{message}</p> : null}

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-[330px_minmax(0,1fr)] overflow-hidden rounded-xl border border-cs2-border bg-cs2-bg-card/55">
        <aside className="min-h-0 overflow-y-auto border-r border-cs2-border p-2 custom-scrollbar">
          {loading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-cs2-accent" /></div> : items.length === 0 ? <div className="flex h-40 flex-col items-center justify-center text-center"><Video className="h-7 w-7 text-cs2-text-muted" /><p className="mt-2 text-[11px] font-bold text-cs2-text-primary">还没有已录制视频</p><p className="mt-1 text-[9px] text-cs2-text-muted">录制队列完成后会自动出现在这里。</p></div> : items.map((item) => (
            <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`mb-1.5 w-full rounded-lg border p-3 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.99] ${selectedId === item.id ? "border-cs2-accent/50 bg-cs2-accent-soft" : "border-transparent bg-cs2-bg-input/35 hover:border-cs2-border hover:bg-cs2-bg-hover"}`}>
              <p className="truncate text-[11px] font-bold text-cs2-text-primary">{fileName(item.output_path)}</p><p className="mt-1 truncate text-[9px] text-cs2-text-muted">{item.player_name || item.demo_filename || "CS2 录制"}</p><div className="mt-2 flex items-center gap-1 text-[9px] text-cs2-text-muted"><Clock3 className="h-3 w-3" />{formatDuration(item.duration_sec)}</div>
            </button>
          ))}
        </aside>
        <main className="flex min-h-0 flex-col p-4">
          {selected ? <><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black text-cs2-text-primary">{fileName(selected.output_path)}</p><p className="mt-1 truncate font-mono text-[9px] text-cs2-text-muted">{selected.output_path}</p></div><button type="button" onClick={() => reveal(selected.output_path)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cs2-border px-2.5 py-1.5 text-[10px] font-bold text-cs2-text-secondary transition-colors duration-150 hover:text-cs2-accent"><ExternalLink className="h-3.5 w-3.5" />定位文件</button></div><div className="mt-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black"><video key={selected.id} controls preload="metadata" src={getRecordedClipStreamUrl(selected.id)} className="max-h-full max-w-full" aria-label={`播放 ${fileName(selected.output_path)}`} /></div></> : <div className="flex h-full flex-col items-center justify-center text-cs2-text-muted"><Play className="h-8 w-8" /><p className="mt-2 text-[11px]">选择左侧视频开始播放</p></div>}
        </main>
      </div>
    </div>
  );
}
