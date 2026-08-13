import { useCallback, useEffect, useState } from "react";
import { Pin, RefreshCw, Shield, Swords } from "lucide-react";
import { fetchLeagueLabStatus, rerollLeagueChampion, runLeagueLabAction, saveLeagueLabSettings, selectLeagueChampionSkin, swapLeagueBenchChampion } from "../api/leagueLabApi";
import { getLeagueChampionIconUrl } from "../api/api";

function MiniSwitch({ label, checked, onChange }) {
  return <div className="flex items-center justify-between gap-3 py-1.5 text-xs text-zinc-300"><span>{label}</span><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-5 w-9 appearance-none rounded-full p-0 transition-colors duration-150 active:scale-[.97] ${checked ? "bg-emerald-500" : "bg-zinc-700"}`}><span className={`absolute left-1 top-1 h-3 w-3 rounded-full bg-white transition-transform duration-150 ${checked ? "translate-x-4" : "translate-x-0"}`} /></button></div>;
}

export default function LeagueMiniPanel() {
  const [status, setStatus] = useState(null);
  const load = useCallback(async () => { try { setStatus(await fetchLeagueLabStatus()); } catch { setStatus(null); } }, []);
  useEffect(() => { load(); const id = setInterval(load, 1500); return () => clearInterval(id); }, [load]);
  const update = async (patch) => setStatus(await saveLeagueLabSettings({ ...(status?.settings || {}), ...patch }));
  const team = status?.champ_select?.my_team || [];
  const bench = status?.champ_select?.bench_champions || [];
  const respawn = status?.respawn_timer || {};
  const skinSelector = status?.champ_select?.skin_selector || {};
  return <div className="h-screen overflow-hidden bg-[#111214] p-3 text-white">
    <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2 text-[11px] text-zinc-400"><span>Insight · League Mini</span><span className="flex items-center gap-2"><Pin className="h-3 w-3 text-emerald-400" /><RefreshCw onClick={load} className="h-3.5 w-3.5 cursor-pointer" /></span></div>
    <div className="mb-3 rounded-xl border border-white/10 bg-white/[.025] p-3 text-center">
      <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300">{status?.phase === "ChampSelect" ? <Swords /> : <Shield />}</div>
      <div className="text-sm font-bold">{status?.connected ? (status.phase || "已连接英雄联盟") : "等待英雄联盟客户端"}</div>
      <div className="mt-1 text-[11px] text-zinc-500">{status?.summoner_name || "启动并登录客户端后自动连接"}</div>
    </div>
    {team.length > 0 && <div className="mb-3 grid grid-cols-5 gap-1 rounded-xl border border-white/10 p-2">{team.map((member) => member.champion_id ? <img key={member.cell_id} src={getLeagueChampionIconUrl(member.champion_id)} alt={String(member.champion_id)} title={String(member.champion_id)} className="aspect-square w-full rounded-lg bg-white/5 object-cover"/> : <div key={member.cell_id} className="grid aspect-square place-items-center rounded-lg bg-white/5 text-xs font-bold text-emerald-300">?</div>)}</div>}
    {status?.champ_select?.bench_enabled && <div className="mb-3 rounded-xl border border-white/10 bg-white/[.025] p-2"><div className="mb-2 flex items-center justify-between text-[10px] text-zinc-500"><span>备战席 · 点击换取</span><button disabled={!status?.champ_select?.rerolls_remaining} onClick={async()=>setStatus(await rerollLeagueChampion())} className="rounded border border-white/10 px-2 py-1 text-zinc-300 disabled:opacity-30">重随 {status?.champ_select?.rerolls_remaining||0}</button></div><div className="grid grid-cols-5 gap-1">{bench.slice(0,10).map((id)=><button key={id} onClick={async()=>setStatus(await swapLeagueBenchChampion(id))} className="aspect-square overflow-hidden rounded-md bg-white/5 active:scale-[.94]" title={`换取英雄 ${id}`}><img src={getLeagueChampionIconUrl(id)} alt={String(id)} className="h-full w-full object-cover"/></button>)}</div></div>}
    {skinSelector.available&&<div className="mb-3 rounded-xl border border-white/10 bg-white/[.025] p-2"><div className="mb-2 text-[10px] text-zinc-500">已拥有皮肤</div><select value={skinSelector.selected_skin_id||""} disabled={skinSelector.disabled} onChange={async(e)=>setStatus(await selectLeagueChampionSkin(Number(e.target.value)))} className="w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-xs text-zinc-200 disabled:opacity-40"><option value="" disabled>选择皮肤</option>{(skinSelector.skins||[]).map((skin)=><option key={skin.id} value={skin.id}>{skin.name}{skin.is_chroma?" · 炫彩":""}</option>)}</select></div>}
    {respawn.dead && <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-center"><div className="text-[10px] uppercase tracking-[.18em] text-rose-300">复活倒计时</div><div className="mt-1 text-3xl font-black tabular-nums text-white">{Number(respawn.time_left || 0).toFixed(1)}s</div></div>}
    <div className="rounded-xl border border-white/10 bg-white/[.025] px-3 py-2">
      <MiniSwitch label="自动接受" checked={Boolean(status?.settings?.auto_accept_enabled)} onChange={(value) => update({ auto_accept_enabled: value })} />
      <MiniSwitch label="自动选择英雄" checked={Boolean(status?.settings?.auto_select_enabled)} onChange={(value) => update({ auto_select_enabled: value })} />
      <MiniSwitch label="自动符文与技能" checked={Boolean(status?.settings?.auto_champion_config_enabled)} onChange={(value) => update({ auto_champion_config_enabled: value })} />
      <MiniSwitch label="复活计时器" checked={Boolean(status?.settings?.respawn_timer_enabled)} onChange={(value) => update({ respawn_timer_enabled: value })} />
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => runLeagueLabAction("accept")} className="rounded-lg bg-emerald-500/15 px-2 py-2 text-xs font-semibold text-emerald-300 active:scale-[.97]">立即接受</button><button onClick={() => update({ automation_enabled: !status?.settings?.automation_enabled })} className="rounded-lg border border-white/10 px-2 py-2 text-xs font-semibold text-zinc-300 active:scale-[.97]">{status?.settings?.automation_enabled ? "暂停自动化" : "启用自动化"}</button></div>
  </div>;
}
