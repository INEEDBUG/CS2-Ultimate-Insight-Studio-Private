import { useCallback, useEffect, useState } from "react";
import { Pin, RefreshCw, Shield, Swords } from "lucide-react";
import { fetchLeagueLabStatus, runLeagueLabAction, saveLeagueLabSettings } from "../api/leagueLabApi";

function MiniSwitch({ label, checked, onChange }) {
  return <div className="flex items-center justify-between gap-3 py-1.5 text-xs text-zinc-300"><span>{label}</span><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-5 w-9 appearance-none rounded-full p-0 transition-colors duration-150 active:scale-[.97] ${checked ? "bg-emerald-500" : "bg-zinc-700"}`}><span className={`absolute left-1 top-1 h-3 w-3 rounded-full bg-white transition-transform duration-150 ${checked ? "translate-x-4" : "translate-x-0"}`} /></button></div>;
}

export default function LeagueMiniPanel() {
  const [status, setStatus] = useState(null);
  const load = useCallback(async () => { try { setStatus(await fetchLeagueLabStatus()); } catch { setStatus(null); } }, []);
  useEffect(() => { load(); const id = setInterval(load, 1500); return () => clearInterval(id); }, [load]);
  const update = async (patch) => setStatus(await saveLeagueLabSettings({ ...(status?.settings || {}), ...patch }));
  const team = status?.champ_select?.my_team || [];
  return <div className="h-screen overflow-hidden bg-[#111214] p-3 text-white">
    <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2 text-[11px] text-zinc-400"><span>Insight · League Mini</span><span className="flex items-center gap-2"><Pin className="h-3 w-3 text-emerald-400" /><RefreshCw onClick={load} className="h-3.5 w-3.5 cursor-pointer" /></span></div>
    <div className="mb-3 rounded-xl border border-white/10 bg-white/[.025] p-3 text-center">
      <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300">{status?.phase === "ChampSelect" ? <Swords /> : <Shield />}</div>
      <div className="text-sm font-bold">{status?.connected ? (status.phase || "已连接英雄联盟") : "等待英雄联盟客户端"}</div>
      <div className="mt-1 text-[11px] text-zinc-500">{status?.summoner_name || "启动并登录客户端后自动连接"}</div>
    </div>
    {team.length > 0 && <div className="mb-3 grid grid-cols-5 gap-1 rounded-xl border border-white/10 p-2">{team.map((member) => <div key={member.cell_id} className="grid aspect-square place-items-center rounded-lg bg-white/5 text-xs font-bold text-emerald-300">{member.champion_id || "?"}</div>)}</div>}
    <div className="rounded-xl border border-white/10 bg-white/[.025] px-3 py-2">
      <MiniSwitch label="自动接受" checked={Boolean(status?.settings?.auto_accept_enabled)} onChange={(value) => update({ auto_accept_enabled: value })} />
      <MiniSwitch label="自动选择英雄" checked={Boolean(status?.settings?.auto_select_enabled)} onChange={(value) => update({ auto_select_enabled: value })} />
      <MiniSwitch label="自动符文与技能" checked={Boolean(status?.settings?.auto_champion_config_enabled)} onChange={(value) => update({ auto_champion_config_enabled: value })} />
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => runLeagueLabAction("accept")} className="rounded-lg bg-emerald-500/15 px-2 py-2 text-xs font-semibold text-emerald-300 active:scale-[.97]">立即接受</button><button onClick={() => update({ automation_enabled: !status?.settings?.automation_enabled })} className="rounded-lg border border-white/10 px-2 py-2 text-xs font-semibold text-zinc-300 active:scale-[.97]">{status?.settings?.automation_enabled ? "暂停自动化" : "启用自动化"}</button></div>
  </div>;
}
