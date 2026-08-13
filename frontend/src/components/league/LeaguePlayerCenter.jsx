import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Tag, Trophy } from "lucide-react";
import { fetchCurrentLeaguePlayer, fetchLeaguePlayer, saveLeaguePlayerTag } from "../../api/leagueLabApi";

function queueRows(ranked) {
  if (Array.isArray(ranked?.queues)) return ranked.queues;
  return Object.values(ranked || {}).filter((row) => row && typeof row === "object" && (row.tier || row.division));
}

export default function LeaguePlayerCenter({ currentPuuid = "", onError }) {
  const [puuid, setPuuid] = useState(currentPuuid);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState({ label: "", note: "", color: "emerald" });
  const load = async (target = puuid) => {
    setBusy(true);
    try {
      const body = target ? await fetchLeaguePlayer(target, 20) : await fetchCurrentLeaguePlayer();
      setData(body); setPuuid(body?.summoner?.puuid || target); setTag({ label: "", note: "", color: "emerald", ...(body?.tag || {}) });
    } catch (error) { onError(error?.response?.data?.detail || "玩家资料读取失败"); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(currentPuuid); }, [currentPuuid]);
  const rankedRows = useMemo(() => queueRows(data?.ranked), [data]);
  const summoner = data?.summoner || {};
  return <div className="space-y-4">
    <div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-cs2-text-muted"/><input value={puuid} onChange={(e)=>setPuuid(e.target.value)} placeholder="玩家 PUUID（可从实时对局卡片打开）" className="w-full rounded-xl border border-cs2-border bg-cs2-bg-input py-2 pl-9 pr-3 text-sm"/></div><button onClick={()=>load()} className="rounded-xl border border-cs2-border px-4 text-xs font-semibold"><RefreshCw className={`inline h-4 w-4 ${busy?"animate-spin":""}`}/> 读取</button></div>
    {data&&<><section className="grid gap-4 rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-5 md:grid-cols-[1fr_auto]"><div><div className="text-xl font-bold">{summoner.game_name}<span className="ml-1 text-sm text-cs2-text-muted">#{summoner.tag_line}</span></div><div className="mt-1 text-xs text-cs2-text-muted">等级 {summoner.summoner_level||"—"} · {summoner.puuid}</div><div className="mt-4 flex flex-wrap gap-2">{rankedRows.length?rankedRows.map((row,index)=><span key={row.queueType||index} className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200"><Trophy className="mr-1 inline h-3.5 w-3.5"/>{row.queueType||"排位"} · {row.tier||"UNRANKED"} {row.division||""} · {row.leaguePoints??0} LP</span>):<span className="text-xs text-cs2-text-muted">暂无排位数据</span>}</div></div><div className="min-w-[260px] rounded-xl border border-cs2-border-subtle p-3"><div className="mb-2 text-xs font-semibold"><Tag className="mr-1 inline h-3.5 w-3.5"/>本地玩家标签</div><input value={tag.label} onChange={(e)=>setTag({...tag,label:e.target.value})} placeholder="例如：擅长打野 / 可靠队友" className="mb-2 w-full rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><textarea value={tag.note} onChange={(e)=>setTag({...tag,note:e.target.value})} placeholder="备注只保存在本机" className="h-16 w-full resize-none rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><button onClick={async()=>{await saveLeaguePlayerTag(summoner.puuid,tag);}} className="mt-2 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-black">保存标签</button></div></section>
    <section className="grid gap-3 md:grid-cols-2">{(data.matches||[]).map((m)=><article key={m.game_id} className={`rounded-xl border p-3 ${m.win?"border-emerald-400/25 bg-emerald-400/[.05]":"border-rose-400/25 bg-rose-400/[.05]"}`}><div className="flex justify-between"><b>{m.champion_name} · {m.win?"胜利":"失败"}</b><span className="font-mono">{m.kills}/{m.deaths}/{m.assists}</span></div><div className="mt-2 text-xs text-cs2-text-muted">{m.game_mode} · 伤害 {m.damage} · 补刀 {m.cs}</div></article>)}{!data.matches?.length&&<div className="text-sm text-cs2-text-muted">暂无可用战绩</div>}</section></>}
  </div>;
}
