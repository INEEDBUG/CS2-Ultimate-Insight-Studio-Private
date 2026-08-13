import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Gamepad2,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Users,
  WifiOff,
} from "lucide-react";
import { fetchLeagueLabStatus, runLeagueLabAction, saveLeagueLabSettings } from "../api/leagueLabApi";

const DEFAULT_SETTINGS = {
  automation_enabled: false,
  auto_accept_enabled: false,
  auto_accept_delay_seconds: 1,
  play_again_enabled: false,
  auto_reconnect_enabled: false,
  invitation_strategy: "ignore",
};

function ToggleRow({ title, description, checked, onChange, children }) {
  return (
    <div className="flex min-h-[68px] items-center gap-4 border-b border-cs2-border-subtle px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-cs2-text-primary">{title}</div>
        <div className="mt-1 text-xs leading-5 text-cs2-text-muted">{description}</div>
      </div>
      {children}
      <button
        type="button"
        role="switch"
        aria-label={title}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 ${checked ? "bg-emerald-500" : "bg-cs2-bg-input"}`}
      >
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${checked ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

export default function LeagueAutomationLabPage() {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await fetchLeagueLabStatus();
      setStatus(next);
      setSettings({ ...DEFAULT_SETTINGS, ...(next.settings || {}) });
      setError("");
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "无法读取英雄联盟客户端状态");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 4_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const update = async (patch) => {
    const nextSettings = { ...settings, ...patch };
    setSettings(nextSettings);
    setBusy(true);
    try {
      const next = await saveLeagueLabSettings(nextSettings);
      setStatus(next);
      setError("");
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "设置保存失败");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action) => {
    setBusy(true);
    try {
      setStatus(await runLeagueLabAction(action));
      setError("");
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "LCU 操作失败");
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(status?.connected);
  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-5 px-7 py-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-300">
            <Gamepad2 className="h-3.5 w-3.5" /> League Automation Lab
          </div>
          <h1 className="text-2xl font-bold tracking-[-0.03em] text-cs2-text-primary">英雄联盟自动化实验室</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-cs2-text-secondary">无需切换软件。本页直接连接本机 LeagueClientUx 的 LCU 接口，令牌仅保存在内存中，不会写入磁盘或上传。</p>
        </div>
        <button type="button" onClick={load} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-cs2-border px-3 py-2 text-xs font-semibold text-cs2-text-secondary transition hover:bg-cs2-bg-hover disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> 重新检测
        </button>
      </header>

      <section className={`rounded-2xl border p-4 ${connected ? "border-emerald-400/30 bg-emerald-400/[0.07]" : "border-amber-400/30 bg-amber-400/[0.06]"}`}>
        <div className="flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${connected ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"}`}>
            {connected ? <CheckCircle2 className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-cs2-text-primary">{connected ? `已连接：${status?.summoner_name || "League Client"}` : "尚未检测到英雄联盟客户端"}</div>
            <div className="mt-1 text-xs text-cs2-text-muted">{connected ? `阶段：${status?.phase || "Unknown"} · ${status?.platform_id || status?.region || "本地区服"}` : "请先启动并登录英雄联盟客户端；连接成功后自动化才会执行。"}</div>
          </div>
          {busy && <Loader2 className="h-4 w-4 animate-spin text-cs2-accent" />}
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="overflow-hidden rounded-2xl border border-cs2-border bg-cs2-bg-elevated">
        <ToggleRow title="启用英雄联盟自动化" description="总开关。关闭后仅显示客户端状态，不会执行任何 LCU 写入操作。" checked={settings.automation_enabled} onChange={(value) => update({ automation_enabled: value })} />
        <ToggleRow title="自动接受对局" description="进入 ReadyCheck 后按设定延迟自动接受。" checked={settings.auto_accept_enabled} onChange={(value) => update({ auto_accept_enabled: value })}>
          <label className="flex items-center gap-2 text-xs text-cs2-text-muted">
            延迟
            <input type="number" min="0" max="10" step="0.5" value={settings.auto_accept_delay_seconds} onChange={(event) => update({ auto_accept_delay_seconds: Number(event.target.value) })} className="w-16 rounded-lg border border-cs2-border bg-cs2-bg-input px-2 py-1.5 font-mono text-cs2-text-primary outline-none" /> 秒
          </label>
        </ToggleRow>
        <ToggleRow title="自动返回房间" description="结算阶段结束后调用 LCU 返回房间，不依赖鼠标模拟点击。" checked={settings.play_again_enabled} onChange={(value) => update({ play_again_enabled: value })} />
        <ToggleRow title="自动重新连接" description="客户端进入 Reconnect 阶段时尝试重新连接游戏。" checked={settings.auto_reconnect_enabled} onChange={(value) => update({ auto_reconnect_enabled: value })} />
        <div className="flex min-h-[76px] items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-cs2-text-primary">房间邀请策略</div>
            <div className="mt-1 text-xs leading-5 text-cs2-text-muted">收到邀请时自动接受、拒绝或保持不处理。</div>
          </div>
          <select value={settings.invitation_strategy} onChange={(event) => update({ invitation_strategy: event.target.value })} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs font-semibold text-cs2-text-primary outline-none">
            <option value="ignore">不处理</option>
            <option value="accept">自动接受</option>
            <option value="decline">自动拒绝</option>
          </select>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <button type="button" disabled={!connected || busy} onClick={() => runAction("accept")} className="flex items-center gap-3 rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-400/30 disabled:pointer-events-none disabled:opacity-40"><Play className="h-5 w-5 text-emerald-300" /><span><span className="block text-sm font-semibold text-cs2-text-primary">立即接受</span><span className="mt-1 block text-xs text-cs2-text-muted">用于 ReadyCheck 阶段</span></span></button>
        <button type="button" disabled={!connected || busy} onClick={() => runAction("play-again")} className="flex items-center gap-3 rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-400/30 disabled:pointer-events-none disabled:opacity-40"><Users className="h-5 w-5 text-sky-300" /><span><span className="block text-sm font-semibold text-cs2-text-primary">返回房间</span><span className="mt-1 block text-xs text-cs2-text-muted">跳过结算后的等待</span></span></button>
        <button type="button" disabled={!connected || busy} onClick={() => runAction("reconnect")} className="flex items-center gap-3 rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-400/30 disabled:pointer-events-none disabled:opacity-40"><RotateCcw className="h-5 w-5 text-violet-300" /><span><span className="block text-sm font-semibold text-cs2-text-primary">立即重连</span><span className="mt-1 block text-xs text-cs2-text-muted">用于 Reconnect 阶段</span></span></button>
      </section>

      <div className="flex items-start gap-3 rounded-2xl border border-cs2-border-subtle bg-cs2-bg-elevated/60 p-4 text-xs leading-5 text-cs2-text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
        <p>首批迁移的是低风险游戏流程功能。自动英雄选择、符文/召唤师技能配置与自动点赞会在确认不同区服 LCU 数据结构后继续加入，避免先放出无效开关。</p>
      </div>
    </div>
  );
}
