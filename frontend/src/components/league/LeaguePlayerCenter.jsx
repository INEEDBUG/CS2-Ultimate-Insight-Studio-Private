import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, MapPinned, RefreshCw, Search, Tag, Trophy } from "lucide-react";
import { fetchCurrentLeaguePlayer, fetchLeaguePlayer, fetchLeaguePlayerCollection, fetchLeaguePlayerJungleAnalysis, fetchLeaguePlayerSearchServers, fetchRecentLeaguePlayers, saveLeaguePlayerTag, searchLeaguePlayer } from "../../api/leagueLabApi";
import LeagueMatchFilterPresets from "./LeagueMatchFilterPresets";
import LeagueAdvancedMatchFilters from "./LeagueAdvancedMatchFilters";
import LeagueMasteryCatalog from "./LeagueMasteryCatalog";
import LeagueEncounteredGames from "./LeagueEncounteredGames";
import LeagueDetailedMatchCard from "./LeagueDetailedMatchCard";
import LeagueChampionAnalysis from "./LeagueChampionAnalysis";
import { matchesLeagueRuleTree } from "../../utils/leagueMatchFilter";
import { leaguePrivacyText, maskLeagueName } from "../../utils/leagueStreamerMode";

function queueRows(ranked) {
  if (Array.isArray(ranked?.queues)) return ranked.queues;
  return Object.values(ranked || {}).filter((row) => row && typeof row === "object" && (row.tier || row.division));
}

export default function LeaguePlayerCenter({ currentPuuid = "", streamerMode = false, useAliases = false, onError }) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [jungle, setJungle] = useState(null);
  const [jungleBusy, setJungleBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState({ result: "all", mode: "all", position: "all", text: "", minKills: "", maxDeaths: "", minKda: "", advancedTree:{type:"group",logic:"and",negate:false,children:[]} });
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState({ label: "", note: "", color: "emerald" });
  const load = async (target = currentPuuid, nextPage = 0, collect = false, serverOverride) => {
    setBusy(true);
    try {
      let body;
      const trimmed = String(target || "").trim();
      const routeServer = serverOverride ?? selectedServer;
      if (trimmed.includes("#")) {
        const splitAt = trimmed.lastIndexOf("#");
        body = await searchLeaguePlayer(trimmed.slice(0, splitAt), trimmed.slice(splitAt + 1), routeServer);
      } else if (trimmed) body = await fetchLeaguePlayer(trimmed, collect ? 100 : 20, collect ? 0 : nextPage * 20, routeServer);
      else body = await fetchCurrentLeaguePlayer();
      setData(body); setQuery(`${body?.summoner?.game_name || ""}#${body?.summoner?.tag_line || ""}`); setPage(nextPage); setTag({ label: "", note: "", color: "emerald", ...(body?.tag || {}) });
      if (body?.server_id) setSelectedServer(body.server_id);
    } catch (error) { onError(error?.response?.data?.detail || "玩家资料读取失败"); }
    finally { setBusy(false); }
  };
  const refreshRecent = async () => { try { setRecent((await fetchRecentLeaguePlayers()).players || []); } catch { setRecent([]); } };
  const refreshServers = async () => { try { const body = await fetchLeaguePlayerSearchServers(); setServers(body.servers || []); setSelectedServer((value) => value || body.current || ""); } catch { setServers([]); } };
  const loadJungle = async (puuid, serverId = "") => { if(!puuid)return;setJungleBusy(true);try{setJungle(await fetchLeaguePlayerJungleAnalysis(puuid,6,serverId));}catch{setJungle(null);}finally{setJungleBusy(false);} };
  const openCollection = async () => { if (!data?.summoner?.puuid) return; setBusy(true); try { const body=await fetchLeaguePlayerCollection(data.summoner.puuid); setData({...data,matches:body.matches||[],match_source:"sqlite",collection_count:body.count||0,page:{beg_index:0,end_index:Math.max(0,(body.count||0)-1),has_more:false}}); setPage(0); } catch(error) { onError(error?.response?.data?.detail||"本地收集读取失败"); } finally { setBusy(false); } };
  useEffect(() => { load(currentPuuid); refreshRecent(); refreshServers(); }, [currentPuuid]);
  useEffect(() => { const puuid=data?.summoner?.puuid;if(puuid)loadJungle(puuid,data?.server_id||selectedServer);else setJungle(null); }, [data?.summoner?.puuid,data?.server_id]);
  const rankedRows = useMemo(() => queueRows(data?.ranked), [data]);
  const masteryRows = useMemo(() => Array.isArray(data?.mastery) ? data.mastery : (data?.mastery?.championMasteries || []), [data]);
  const modes = useMemo(() => [...new Set((data?.matches || []).map((match) => match.game_mode).filter(Boolean))], [data]);
  const filteredMatches = useMemo(() => (data?.matches || []).filter((match) => {
    if (filter.result === "win" && !match.win) return false;
    if (filter.result === "loss" && match.win) return false;
    if (filter.mode !== "all" && match.game_mode !== filter.mode) return false;
    if (filter.position !== "all" && String(match.position || "").toLowerCase() !== filter.position) return false;
    if (filter.minKills !== "" && Number(match.kills || 0) < Number(filter.minKills)) return false;
    if (filter.maxDeaths !== "" && Number(match.deaths || 0) > Number(filter.maxDeaths)) return false;
    const kda = (Number(match.kills || 0) + Number(match.assists || 0)) / Math.max(1, Number(match.deaths || 0));
    if (filter.minKda !== "" && kda < Number(filter.minKda)) return false;
    if (!matchesLeagueRuleTree(match, filter.advancedTree)) return false;
    const text = filter.text.trim().toLowerCase();
    return !text || String(match.champion_name || "").toLowerCase().includes(text) || String(match.queue_id || "").includes(text);
  }), [data, filter]);
  const challengeSummary = useMemo(() => {
    const rows = data?.matches || [];
    const values = (key) => rows.map((row) => Number(row.challenges?.[key])).filter(Number.isFinite);
    const average = (key) => { const list = values(key); return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null; };
    return { kda: average("kda"), killParticipation: average("killParticipation"), visionScorePerMinute: average("visionScorePerMinute"), damagePerMinute: average("damagePerMinute") };
  }, [data]);
  const collectionChallenges = useMemo(() => {
    const labels = { 505001:"已拥有英雄", 510001:"英雄皮肤", 510011:"炫彩皮肤", 504003:"守卫皮肤", 504002:"召唤师图标", 504004:"表情" };
    return (data?.player_challenges?.playerChallenges || []).filter((row)=>labels[row.id]).map((row)=>({...row,label:labels[row.id]}));
  }, [data]);
  const summoner = data?.summoner || {};
  const visibleName = streamerMode ? maskLeagueName(summoner.game_name, 0, useAliases, summoner.puuid) : summoner.game_name;
  const applyFilterPreset = (next) => setFilter({
    ...next,
    advancedTree: next?.advancedTree || {type:"group",logic:next?.advancedLogic||"and",negate:false,children:(next?.advancedRules||[]).map((rule)=>({type:"rule",scope:"self",...rule}))},
  });
  return <div className="space-y-4">
    <LeagueMatchFilterPresets filter={filter} onApply={applyFilterPreset} />
    <LeagueAdvancedMatchFilters tree={filter.advancedTree} onChange={(advancedTree)=>setFilter({...filter,advancedTree})}/>
    {collectionChallenges.length>0&&<section className="rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4"><h3 className="mb-3 text-sm font-bold">藏品挑战</h3><div className="grid grid-cols-2 gap-2 md:grid-cols-3">{collectionChallenges.map((row)=><span key={row.id} className="rounded-lg bg-white/[.04] p-3 text-xs">{row.label}<br/><b className="text-base">{Number(row.currentValue||0).toLocaleString()}</b><span className="ml-2 text-[10px] text-cs2-text-muted">{row.currentLevel||""}</span></span>)}</div></section>}
    <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px_auto_auto_auto]"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-cs2-text-muted"/><input value={streamerMode?"":query} disabled={streamerMode} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&load(query,0)} placeholder={streamerMode?"直播隐私模式已隐藏 Riot ID 搜索框":"搜索 Riot ID，例如：玩家名#标签"} className="w-full rounded-xl border border-cs2-border bg-cs2-bg-input py-2 pl-9 pr-3 text-sm disabled:opacity-60"/></div><select aria-label="搜索区服" value={selectedServer} disabled={streamerMode} onChange={(e)=>setSelectedServer(e.target.value)} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs disabled:opacity-60"><option value="">当前客户端区服</option>{servers.map((server)=><option key={server.id} value={server.id}>{server.label}{server.current?"（当前）":""}</option>)}</select><button disabled={streamerMode} onClick={()=>load(query,0)} className="rounded-xl border border-cs2-border px-4 text-xs font-semibold disabled:opacity-40"><RefreshCw className={`inline h-4 w-4 ${busy?"animate-spin":""}`}/> 读取</button><button disabled={!data?.summoner?.puuid||busy} onClick={()=>load(data.summoner.puuid,0,true,data.server_id||selectedServer)} className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 text-xs font-semibold text-cyan-200 disabled:opacity-40">收集 100 场</button><button disabled={!data?.collection_count||busy} onClick={openCollection} className="rounded-xl border border-violet-400/30 bg-violet-400/10 px-4 text-xs font-semibold text-violet-200 disabled:opacity-40">本地 {data?.collection_count||0} 场</button></div>
    {recent.length>0&&<section className="rounded-xl border border-cs2-border bg-cs2-bg-elevated p-3"><div className="mb-2 text-xs font-semibold text-cs2-text-secondary"><Clock3 className="mr-1 inline h-3.5 w-3.5"/>最近遇见</div><div className="flex flex-wrap gap-2">{recent.slice(0,12).map((row,index)=><button key={row.puuid} onClick={()=>load(row.puuid,0)} className="rounded-lg border border-cs2-border-subtle px-3 py-2 text-left text-xs hover:border-emerald-400/30"><b>{streamerMode?maskLeagueName(row.game_name,index,useAliases,row.puuid):(row.game_name||"未知玩家")}</b>{!streamerMode&&<span className="text-cs2-text-muted">#{row.tag_line}</span>}{!streamerMode&&row.tag?.label&&<span className="ml-2 text-emerald-300">{row.tag.label}</span>}</button>)}</div></section>}
    {data&&<><section className="grid gap-4 rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-5 md:grid-cols-[1fr_auto]"><div><div className="text-xl font-bold">{visibleName}{!streamerMode&&<span className="ml-1 text-sm text-cs2-text-muted">#{summoner.tag_line}</span>}</div><div className="mt-1 text-xs text-cs2-text-muted">等级 {summoner.summoner_level||"—"} · {leaguePrivacyText(summoner.puuid,streamerMode)}</div><div className="mt-4 flex flex-wrap gap-2">{rankedRows.length?rankedRows.map((row,index)=><span key={row.queueType||index} className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200"><Trophy className="mr-1 inline h-3.5 w-3.5"/>{row.queueType||"排位"} · {row.tier||"UNRANKED"} {row.division||""} · {row.leaguePoints??0} LP</span>):<span className="text-xs text-cs2-text-muted">暂无排位数据</span>}</div></div>{!streamerMode&&<div className="min-w-[260px] rounded-xl border border-cs2-border-subtle p-3"><div className="mb-2 text-xs font-semibold"><Tag className="mr-1 inline h-3.5 w-3.5"/>本地玩家标签</div><input value={tag.label} onChange={(e)=>setTag({...tag,label:e.target.value})} placeholder="例如：擅长打野 / 可靠队友" className="mb-2 w-full rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><textarea value={tag.note} onChange={(e)=>setTag({...tag,note:e.target.value})} placeholder="备注只保存在本机" className="h-16 w-full resize-none rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><button onClick={async()=>{await saveLeaguePlayerTag(summoner.puuid,tag);}} className="mt-2 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-black">保存标签</button></div>}</section>
    {(jungleBusy||jungle)&&<section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[.05] p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-bold"><MapPinned className="mr-1 inline h-4 w-4 text-emerald-300"/>打野路线画像</h3><button disabled={jungleBusy} onClick={()=>loadJungle(summoner.puuid,data.server_id||selectedServer)} className="rounded-lg border border-emerald-400/20 px-2 py-1 text-[10px] disabled:opacity-50"><RefreshCw className={`mr-1 inline h-3 w-3 ${jungleBusy?"animate-spin":""}`}/>重算</button></div>{jungleBusy&&!jungle?<p className="mt-3 text-xs text-cs2-text-muted">正在读取最近时间线…</p>:jungle?.games_analyzed?<><div className="mt-3 grid gap-2 sm:grid-cols-3"><span className="rounded-lg bg-black/10 p-3 text-xs">上半区活动<br/><b className="text-base">{Math.round((jungle.zone_percentages?.top||0)*100)}%</b></span><span className="rounded-lg bg-black/10 p-3 text-xs">中路活动<br/><b className="text-base">{Math.round((jungle.zone_percentages?.mid||0)*100)}%</b></span><span className="rounded-lg bg-black/10 p-3 text-xs">下半区活动<br/><b className="text-base">{Math.round((jungle.zone_percentages?.bot||0)*100)}%</b></span></div><p className="mt-3 rounded-lg border border-emerald-400/15 bg-black/10 p-3 text-xs leading-5 text-emerald-100">{jungle.draft}</p><p className="mt-2 text-[10px] text-cs2-text-muted">基于最近 {jungle.games_analyzed} 场可用打野时间线 · {String(jungle.history_source||"lcu").toUpperCase()} 数据源 · 仅生成草稿，不自动发送</p></>:<p className="mt-3 text-xs text-cs2-text-muted">{jungle?.reason||"最近战绩中没有可用的打野时间线"}</p>}</section>}
    <LeagueMasteryCatalog puuid={summoner.puuid} initialRows={masteryRows} onError={onError}/>
    <LeagueChampionAnalysis matches={data?.matches || []}/>
    <LeagueEncounteredGames puuid={summoner.puuid} selfPuuid={currentPuuid} onError={onError}/>
    {Object.values(challengeSummary).some((value)=>value!=null)&&<section className="rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4"><h3 className="mb-3 text-sm font-bold">SGP 挑战指标</h3><div className="grid grid-cols-2 gap-2 md:grid-cols-4">{challengeSummary.kda!=null&&<span className="rounded-lg bg-white/[.04] p-3 text-xs">平均 KDA<br/><b className="text-base">{challengeSummary.kda.toFixed(2)}</b></span>}{challengeSummary.killParticipation!=null&&<span className="rounded-lg bg-white/[.04] p-3 text-xs">参团率<br/><b className="text-base">{(challengeSummary.killParticipation*100).toFixed(0)}%</b></span>}{challengeSummary.visionScorePerMinute!=null&&<span className="rounded-lg bg-white/[.04] p-3 text-xs">每分钟视野<br/><b className="text-base">{challengeSummary.visionScorePerMinute.toFixed(2)}</b></span>}{challengeSummary.damagePerMinute!=null&&<span className="rounded-lg bg-white/[.04] p-3 text-xs">每分钟伤害<br/><b className="text-base">{challengeSummary.damagePerMinute.toFixed(0)}</b></span>}</div></section>}
    <div className="grid gap-2 md:grid-cols-4"><select value={filter.position} onChange={(e)=>setFilter({...filter,position:e.target.value})} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"><option value="all">全部位置</option><option value="top">上路</option><option value="jungle">打野</option><option value="middle">中路</option><option value="bottom">下路</option><option value="utility">辅助</option></select><input type="number" min="0" value={filter.minKills} onChange={(e)=>setFilter({...filter,minKills:e.target.value})} placeholder="最少击杀" className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><input type="number" min="0" value={filter.maxDeaths} onChange={(e)=>setFilter({...filter,maxDeaths:e.target.value})} placeholder="最多死亡" className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><div className="flex gap-2"><input type="number" min="0" step="0.1" value={filter.minKda} onChange={(e)=>setFilter({...filter,minKda:e.target.value})} placeholder="最低 KDA" className="min-w-0 flex-1 rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><button type="button" onClick={()=>setFilter({result:"all",mode:"all",position:"all",text:"",minKills:"",maxDeaths:"",minKda:""})} className="rounded-xl border border-cs2-border px-3 py-2 text-xs">清空</button></div></div>
    <section className="space-y-3"><div className="grid gap-2 md:grid-cols-[1fr_auto_auto]"><input value={filter.text} onChange={(e)=>setFilter({...filter,text:e.target.value})} placeholder="筛选英雄或队列 ID" className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><select value={filter.result} onChange={(e)=>setFilter({...filter,result:e.target.value})} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"><option value="all">全部结果</option><option value="win">仅胜利</option><option value="loss">仅失败</option></select><select value={filter.mode} onChange={(e)=>setFilter({...filter,mode:e.target.value})} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"><option value="all">全部模式</option>{modes.map((mode)=><option key={mode} value={mode}>{mode}</option>)}</select></div><div className="space-y-3">{filteredMatches.map((m)=><LeagueDetailedMatchCard key={m.game_id} match={m} streamerMode={streamerMode} useAliases={useAliases} onOpenPlayer={(puuid)=>load(puuid,0,false,data.server_id||selectedServer)} onError={onError}/>)}{!filteredMatches.length&&<div className="text-sm text-cs2-text-muted">当前筛选条件下没有战绩</div>}</div></section><div className="flex justify-end gap-2"><button disabled={page===0||busy} onClick={()=>load(summoner.puuid,page-1,false,data.server_id||selectedServer)} className="rounded-lg border border-cs2-border px-3 py-2 text-xs disabled:opacity-40"><ChevronLeft className="inline h-3.5 w-3.5"/> 上一页</button><span className="px-2 py-2 text-xs text-cs2-text-muted">第 {page+1} 页</span><button disabled={!data.page?.has_more||busy} onClick={()=>load(summoner.puuid,page+1,false,data.server_id||selectedServer)} className="rounded-lg border border-cs2-border px-3 py-2 text-xs disabled:opacity-40">下一页 <ChevronRight className="inline h-3.5 w-3.5"/></button></div></>}
    {data&&<div className="flex justify-end gap-2"><span className="rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold text-amber-200">排位源：{String(data.ranked_source||"none").toUpperCase()}</span><span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-200">战绩源：{String(data.match_source||"lcu").toUpperCase()}</span></div>}
  </div>;
}
