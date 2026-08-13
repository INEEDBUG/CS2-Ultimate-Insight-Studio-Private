import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, RefreshCw, Search, Shield, Tag, Trophy } from "lucide-react";
import { fetchCurrentLeaguePlayer, fetchLeaguePlayer, fetchRecentLeaguePlayers, saveLeaguePlayerTag, searchLeaguePlayer } from "../../api/leagueLabApi";

function queueRows(ranked) {
  if (Array.isArray(ranked?.queues)) return ranked.queues;
  return Object.values(ranked || {}).filter((row) => row && typeof row === "object" && (row.tier || row.division));
}

export default function LeaguePlayerCenter({ currentPuuid = "", onError }) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState({ result: "all", mode: "all", text: "" });
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState({ label: "", note: "", color: "emerald" });
  const load = async (target = currentPuuid, nextPage = 0) => {
    setBusy(true);
    try {
      let body;
      const trimmed = String(target || "").trim();
      if (trimmed.includes("#")) {
        const splitAt = trimmed.lastIndexOf("#");
        body = await searchLeaguePlayer(trimmed.slice(0, splitAt), trimmed.slice(splitAt + 1));
      } else if (trimmed) body = await fetchLeaguePlayer(trimmed, 20, nextPage * 20);
      else body = await fetchCurrentLeaguePlayer();
      setData(body); setQuery(`${body?.summoner?.game_name || ""}#${body?.summoner?.tag_line || ""}`); setPage(nextPage); setTag({ label: "", note: "", color: "emerald", ...(body?.tag || {}) });
    } catch (error) { onError(error?.response?.data?.detail || "玩家资料读取失败"); }
    finally { setBusy(false); }
  };
  const refreshRecent = async () => { try { setRecent((await fetchRecentLeaguePlayers()).players || []); } catch { setRecent([]); } };
  useEffect(() => { load(currentPuuid); refreshRecent(); }, [currentPuuid]);
  const rankedRows = useMemo(() => queueRows(data?.ranked), [data]);
  const masteryRows = useMemo(() => Array.isArray(data?.mastery) ? data.mastery : (data?.mastery?.championMasteries || []), [data]);
  const modes = useMemo(() => [...new Set((data?.matches || []).map((match) => match.game_mode).filter(Boolean))], [data]);
  const filteredMatches = useMemo(() => (data?.matches || []).filter((match) => {
    if (filter.result === "win" && !match.win) return false;
    if (filter.result === "loss" && match.win) return false;
    if (filter.mode !== "all" && match.game_mode !== filter.mode) return false;
    const text = filter.text.trim().toLowerCase();
    return !text || String(match.champion_name || "").toLowerCase().includes(text) || String(match.queue_id || "").includes(text);
  }), [data, filter]);
  const summoner = data?.summoner || {};
  return <div className="space-y-4">
    <div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-cs2-text-muted"/><input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&load(query,0)} placeholder="搜索 Riot ID，例如：玩家名#标签" className="w-full rounded-xl border border-cs2-border bg-cs2-bg-input py-2 pl-9 pr-3 text-sm"/></div><button onClick={()=>load(query,0)} className="rounded-xl border border-cs2-border px-4 text-xs font-semibold"><RefreshCw className={`inline h-4 w-4 ${busy?"animate-spin":""}`}/> 读取</button></div>
    {recent.length>0&&<section className="rounded-xl border border-cs2-border bg-cs2-bg-elevated p-3"><div className="mb-2 text-xs font-semibold text-cs2-text-secondary"><Clock3 className="mr-1 inline h-3.5 w-3.5"/>最近遇见</div><div className="flex flex-wrap gap-2">{recent.slice(0,12).map((row)=><button key={row.puuid} onClick={()=>load(row.puuid,0)} className="rounded-lg border border-cs2-border-subtle px-3 py-2 text-left text-xs hover:border-emerald-400/30"><b>{row.game_name||"未知玩家"}</b><span className="text-cs2-text-muted">#{row.tag_line}</span>{row.tag?.label&&<span className="ml-2 text-emerald-300">{row.tag.label}</span>}</button>)}</div></section>}
    {data&&<><section className="grid gap-4 rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-5 md:grid-cols-[1fr_auto]"><div><div className="text-xl font-bold">{summoner.game_name}<span className="ml-1 text-sm text-cs2-text-muted">#{summoner.tag_line}</span></div><div className="mt-1 text-xs text-cs2-text-muted">等级 {summoner.summoner_level||"—"} · {summoner.puuid}</div><div className="mt-4 flex flex-wrap gap-2">{rankedRows.length?rankedRows.map((row,index)=><span key={row.queueType||index} className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200"><Trophy className="mr-1 inline h-3.5 w-3.5"/>{row.queueType||"排位"} · {row.tier||"UNRANKED"} {row.division||""} · {row.leaguePoints??0} LP</span>):<span className="text-xs text-cs2-text-muted">暂无排位数据</span>}</div></div><div className="min-w-[260px] rounded-xl border border-cs2-border-subtle p-3"><div className="mb-2 text-xs font-semibold"><Tag className="mr-1 inline h-3.5 w-3.5"/>本地玩家标签</div><input value={tag.label} onChange={(e)=>setTag({...tag,label:e.target.value})} placeholder="例如：擅长打野 / 可靠队友" className="mb-2 w-full rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><textarea value={tag.note} onChange={(e)=>setTag({...tag,note:e.target.value})} placeholder="备注只保存在本机" className="h-16 w-full resize-none rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><button onClick={async()=>{await saveLeaguePlayerTag(summoner.puuid,tag);}} className="mt-2 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-black">保存标签</button></div></section>
    {masteryRows.length>0&&<section className="rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4"><h3 className="mb-3 text-sm font-bold"><Shield className="mr-1 inline h-4 w-4 text-violet-300"/>英雄熟练度</h3><div className="flex flex-wrap gap-2">{masteryRows.slice(0,10).map((row,index)=><span key={row.championId||index} className="rounded-lg border border-violet-400/20 bg-violet-400/[.07] px-3 py-2 text-xs"><b>英雄 {row.championId}</b> · {Number(row.championPoints||0).toLocaleString()} 点 · {row.championLevel||0} 级</span>)}</div></section>}
    <section className="space-y-3"><div className="grid gap-2 md:grid-cols-[1fr_auto_auto]"><input value={filter.text} onChange={(e)=>setFilter({...filter,text:e.target.value})} placeholder="筛选英雄或队列 ID" className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><select value={filter.result} onChange={(e)=>setFilter({...filter,result:e.target.value})} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"><option value="all">全部结果</option><option value="win">仅胜利</option><option value="loss">仅失败</option></select><select value={filter.mode} onChange={(e)=>setFilter({...filter,mode:e.target.value})} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"><option value="all">全部模式</option>{modes.map((mode)=><option key={mode} value={mode}>{mode}</option>)}</select></div><div className="grid gap-3 md:grid-cols-2">{filteredMatches.map((m)=><article key={m.game_id} className={`rounded-xl border p-3 ${m.win?"border-emerald-400/25 bg-emerald-400/[.05]":"border-rose-400/25 bg-rose-400/[.05]"}`}><div className="flex justify-between"><b>{m.champion_name} · {m.win?"胜利":"失败"}</b><span className="font-mono">{m.kills}/{m.deaths}/{m.assists}</span></div><div className="mt-2 text-xs text-cs2-text-muted">{m.game_mode}{m.position?` · ${m.position}`:""} · 伤害 {m.damage} · 补刀 {m.cs} · 金币 {m.gold}</div><div className="mt-1 text-[10px] text-cs2-text-muted">{m.played_at||"比赛时间未知"} · 游戏 {m.game_id}</div></article>)}{!filteredMatches.length&&<div className="text-sm text-cs2-text-muted">当前筛选条件下没有战绩</div>}</div></section><div className="flex justify-end gap-2"><button disabled={page===0||busy} onClick={()=>load(summoner.puuid,page-1)} className="rounded-lg border border-cs2-border px-3 py-2 text-xs disabled:opacity-40"><ChevronLeft className="inline h-3.5 w-3.5"/> 上一页</button><span className="px-2 py-2 text-xs text-cs2-text-muted">第 {page+1} 页</span><button disabled={!data.page?.has_more||busy} onClick={()=>load(summoner.puuid,page+1)} className="rounded-lg border border-cs2-border px-3 py-2 text-xs disabled:opacity-40">下一页 <ChevronRight className="inline h-3.5 w-3.5"/></button></div></>}
  </div>;
}
