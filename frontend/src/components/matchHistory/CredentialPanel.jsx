import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MonitorCheck, ShieldCheck, Unplug } from "lucide-react";
import { fetchLocalCs2Settings } from "../../api/trainingApi.js";

export default function CredentialPanel({ connected, player, loading, onConnect }) {
  const [localAccount, setLocalAccount] = useState(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let active = true;
    fetchLocalCs2Settings().then((result) => {
      if (!active) return;
      const accounts = result?.accounts || [];
      const current = accounts.find((item) => item.steam_id64 === player?.steam_id64)
        || accounts.find((item) => item.account_id === result?.active_account_id)
        || accounts[0];
      setLocalAccount(current || null);
    }).catch(() => {});
    return () => { active = false; };
  }, [player?.steam_id64]);

  const displayName = localAccount?.persona_name || localAccount?.account_name || "当前 Steam 账号";
  const displayId = player?.steam_id64 || localAccount?.steam_id64 || "等待 Steam 返回账号";

  if (connected) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-emerald-400/25 bg-emerald-400/[0.07] px-5 py-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-cs2-text-primary">已连接本机 Steam：{displayName}</p>
          <p className="mt-0.5 font-mono text-[10px] text-cs2-text-muted">{displayId} · 最近 8 场来自 Steam Game Coordinator</p>
        </div>
        <button type="button" onClick={() => onConnect?.(false)} disabled={loading} className="flex items-center gap-1.5 rounded-[7px] border border-emerald-300/30 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 transition-[transform,border-color] duration-150 ease-out hover:border-emerald-300/55 active:scale-[0.97] disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MonitorCheck className="h-3.5 w-3.5" />}
          {loading ? "正在刷新" : "刷新最近战绩"}
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-[12px] border border-[#66c0f4]/25 bg-gradient-to-br from-[#66c0f4]/[0.09] to-cs2-bg-card p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-[#66c0f4]/25 bg-[#66c0f4]/10">
          <MonitorCheck className="h-5 w-5 text-[#66c0f4]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-cs2-text-primary">连接本机 Steam，直接读取最近战绩</h2>
            <span className="rounded-full border border-emerald-300/25 bg-emerald-300/[0.08] px-2 py-0.5 text-[9px] font-bold text-emerald-200">不需要 Web API Key</span>
          </div>
          <p className="mt-1.5 max-w-4xl text-[11.5px] leading-5 text-cs2-text-secondary">
            软件直接向当前登录的 Steam Game Coordinator 请求“你的比赛”，可显示最近 8 场的日期、地图、比分与 K/D/A；只有点击下载时才保存 Demo。Steam 需要保持运行并登录，CS2 请先关闭。
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="flex items-center gap-3 rounded-[9px] border border-cs2-border bg-black/15 px-4 py-3">
          {localAccount ? <ShieldCheck className="h-5 w-5 text-sky-300" /> : <Unplug className="h-5 w-5 text-cs2-text-muted" />}
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-cs2-text-primary">{localAccount ? `检测到：${displayName}` : "等待连接当前 Steam 账号"}</p>
            <p className="mt-0.5 truncate font-mono text-[9.5px] text-cs2-text-muted">{localAccount?.steam_id64 || "不会读取 Steam 密码、Cookie 或个人 Web API Key"}</p>
          </div>
        </div>
        <button type="button" onClick={() => onConnect?.(accepted)} disabled={loading} className="flex min-h-12 items-center justify-center gap-2 rounded-[9px] bg-[#66c0f4] px-5 text-[12px] font-bold text-[#101820] shadow-[0_8px_24px_rgba(102,192,244,0.16)] transition-[transform,filter] duration-150 ease-out hover:brightness-105 active:scale-[0.97] disabled:cursor-wait disabled:opacity-55">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorCheck className="h-4 w-4" />}
          {loading ? "正在读取 Steam 战绩" : "连接并显示最近 8 场"}
        </button>
      </div>

      <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[10.5px] leading-4 text-cs2-text-muted">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-0.5 accent-[#66c0f4]" />
        <span>若本机尚未安装辅助组件，我同意首次下载并运行独立的 @akiver/boiler-writter 1.7.0；它只与本机 Steam Game Coordinator 通信。已安装时无需重复确认。</span>
      </label>
    </section>
  );
}
