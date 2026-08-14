import { useEffect, useMemo, useState } from "react";
import { Crown, DoorOpen, Gamepad2, Palette, RefreshCw, Search, Sparkles } from "lucide-react";
import {
  createLeagueQueueLobby,
  fetchLeagueChampions,
  fetchLeagueGamePreview,
  fetchLeagueLobbyOptions,
  fetchLeagueProfileSkins,
  leaveLeagueLobby,
  runLeagueProfileUtilityAction,
  updateLeagueProfileBackground,
  updateLeagueStrawberryDifficulty,
  updateLeagueStrawberryMap,
  updateLeagueStrawberryPlayer,
} from "../../api/leagueLabApi";

const MODIFY_PHRASE = "我确认修改";

export default function LeagueAdvancedToolkit({ enabled, busy, onBusyChange, onError, onDryRunGame = () => {} }) {
  const [options,setOptions]=useState(null);
  const [champions,setChampions]=useState([]);
  const [queueId,setQueueId]=useState("");
  const [championId,setChampionId]=useState("");
  const [mapKey,setMapKey]=useState("");
  const [difficulty,setDifficulty]=useState(1);
  const [profileChampionId,setProfileChampionId]=useState("");
  const [skinCatalog,setSkinCatalog]=useState([]);
  const [skinId,setSkinId]=useState("");
  const [augmentId,setAugmentId]=useState("");
  const [gameId,setGameId]=useState("");
  const [gameSource,setGameSource]=useState("auto");
  const [gamePreview,setGamePreview]=useState(null);

  const load=async()=>{onBusyChange(true);try{const [lobby,catalog]=await Promise.all([fetchLeagueLobbyOptions(),fetchLeagueChampions()]);setOptions(lobby);setChampions(catalog.champions||[]);}catch(error){onError(error?.response?.data?.detail||"高级工具读取失败");}finally{onBusyChange(false);}};
  useEffect(()=>{load();},[]);
  useEffect(()=>{if(!profileChampionId){setSkinCatalog([]);setSkinId("");setAugmentId("");return;}fetchLeagueProfileSkins(Number(profileChampionId)).then((data)=>{setSkinCatalog(data.skins||[]);setSkinId("");setAugmentId("");}).catch((error)=>onError(error?.response?.data?.detail||"皮肤目录读取失败"));},[profileChampionId]);
  const selectedSkin=useMemo(()=>skinCatalog.find((skin)=>String(skin.id)===String(skinId)),[skinCatalog,skinId]);
  const selectedMap=useMemo(()=>options?.strawberry?.maps?.find((map)=>`${map.content_id}:${map.item_id}`===mapKey),[options,mapKey]);
  const promptPhrase=(phrase,message)=>window.prompt(`${message}\n请输入“${phrase}”继续：`)===phrase;
  const run=async(task)=>{onBusyChange(true);try{await task();await load();}catch(error){onError(error?.response?.data?.detail||error?.message||"操作失败");}finally{onBusyChange(false);}};
  const inspectGame=async()=>{const parsed=Number(gameId);if(!Number.isSafeInteger(parsed)||parsed<=0){onError("Game ID 必须是正整数");return;}onBusyChange(true);try{setGamePreview(await fetchLeagueGamePreview(parsed,gameSource,true));}catch(error){setGamePreview(null);onError(error?.response?.data?.detail||"对局预览读取失败");}finally{onBusyChange(false);}};

  return <div className="space-y-4">
    <section className="rounded-2xl border border-emerald-400/20 bg-cs2-bg-elevated p-4">
      <div className="flex items-center gap-2"><Search className="h-4 w-4 text-emerald-300"/><h3 className="text-sm font-bold">任意 Game ID 对局预览</h3></div>
      <p className="mt-1 text-xs text-cs2-text-muted">按 LeagueAkari 的 Game View 读取完整比分与时间线摘要，并可把历史阵容载入实时对局面板进行只读模拟。</p>
      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_150px_auto]"><input aria-label="Game ID" inputMode="numeric" value={gameId} onChange={(event)=>setGameId(event.target.value.replace(/\D/g,""))} placeholder="输入 Game ID" className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-sm"/><select aria-label="对局数据源" value={gameSource} onChange={(event)=>setGameSource(event.target.value)} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-sm"><option value="auto">自动选择来源</option><option value="lcu">仅 LCU</option><option value="sgp">仅 SGP</option></select><button disabled={busy||!gameId} onClick={inspectGame} className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-200 disabled:opacity-40">查看对局</button></div>
      {gamePreview&&<div className="mt-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cs2-border-subtle px-3 py-2 text-xs"><span>Game {gamePreview.metadata?.game_id} · {gamePreview.metadata?.game_mode||"未知模式"} · {gamePreview.source?.toUpperCase()}</span><span className="text-cs2-text-muted">时间线 {gamePreview.timeline?.loaded?`${gamePreview.timeline.frame_count} 帧 / ${gamePreview.timeline.event_count} 事件`:"不可用"}</span><button onClick={()=>onDryRunGame(gamePreview.ongoing_preview)} className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 font-semibold text-cyan-200">载入实时面板模拟</button></div><div className="grid gap-3 lg:grid-cols-2">{(gamePreview.teams||[]).map((team)=><article key={team.team_id} className="overflow-hidden rounded-xl border border-cs2-border-subtle"><header className={`flex justify-between px-3 py-2 text-xs font-bold ${team.win===true?"bg-emerald-400/10 text-emerald-200":team.win===false?"bg-rose-400/10 text-rose-200":"bg-white/5"}`}><span>队伍 {team.team_id}</span><span>{team.win===true?"胜利":team.win===false?"失败":"结果未知"}</span></header><div className="divide-y divide-cs2-border-subtle">{team.players.map((player)=><div key={player.participant_id} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-xs"><span className="truncate"><b>{player.summoner?.gameName||player.champion_name}</b><em className="ml-2 not-italic text-cs2-text-muted">{player.champion_name}</em></span><span className="font-mono">{player.match_stats?.kills}/{player.match_stats?.deaths}/{player.match_stats?.assists}</span><span className="w-14 text-right text-cs2-text-muted">{player.match_stats?.damage||0}</span></div>)}</div></article>)}</div></div>}
    </section>
    <section className="rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4">
      <div className="flex items-center gap-2"><Gamepad2 className="h-4 w-4 text-cyan-300"/><h3 className="mr-auto text-sm font-bold">房间工具</h3><button onClick={load} disabled={busy} className="rounded-lg border border-cs2-border px-2.5 py-1.5 text-xs"><RefreshCw className={`h-3.5 w-3.5 ${busy?"animate-spin":""}`}/></button></div>
      <p className="mt-1 text-xs text-cs2-text-muted">按 LeagueAkari 的队伍与个人资格结果标记队列；创建前再次校验资格。</p>
      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]"><select aria-label="房间队列" value={queueId} onChange={(event)=>setQueueId(event.target.value)} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-sm"><option value="">选择队列</option>{(options?.queues||[]).map((queue)=><option key={queue.id} value={queue.id} disabled={!queue.eligible}>{queue.name} ({queue.id}){queue.eligible?"":" · 当前不可用"}</option>)}</select><button disabled={!enabled||busy||!queueId} onClick={()=>{if(promptPhrase("我确认创建",`创建队列 ${queueId} 的房间？`))run(()=>createLeagueQueueLobby(Number(queueId),"我确认创建"));}} className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40">创建房间</button><button disabled={!enabled||busy||!options?.lobby} onClick={()=>{if(promptPhrase("我确认离开","离开当前房间？"))run(()=>leaveLeagueLobby("我确认离开"));}} className="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-200 disabled:opacity-40"><DoorOpen className="h-3.5 w-3.5"/>离开房间</button></div>
    </section>

    <section className={`rounded-2xl border p-4 ${options?.strawberry?.active?"border-violet-400/30 bg-violet-400/[.05]":"border-cs2-border bg-cs2-bg-elevated"}`}>
      <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-300"/><h3 className="text-sm font-bold">无尽狂潮工具</h3></div><p className="mt-1 text-xs text-cs2-text-muted">{options?.strawberry?.active?"已检测到 STRAWBERRY 房间，可设置英雄、地图与难度。":"仅在无尽狂潮房间中可用。"}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-3"><select value={championId} onChange={(event)=>setChampionId(event.target.value)} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-sm"><option value="">选择英雄</option>{champions.filter((row)=>row.id>0).map((row)=><option key={row.id} value={row.id}>{row.name}</option>)}</select><select value={mapKey} onChange={(event)=>setMapKey(event.target.value)} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-sm"><option value="">选择地图</option>{(options?.strawberry?.maps||[]).map((map)=><option key={`${map.content_id}:${map.item_id}`} value={`${map.content_id}:${map.item_id}`}>{map.name}</option>)}</select><select value={difficulty} onChange={(event)=>setDifficulty(Number(event.target.value))} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-sm">{[1,2,3].map((value)=><option key={value} value={value}>难度 {value}{value===1?" 🐰":value===2?" ★★":" ★★★"}</option>)}</select></div>
      <div className="mt-2 flex flex-wrap justify-end gap-2"><button disabled={!enabled||busy||!options?.strawberry?.active||!championId} onClick={()=>{if(promptPhrase(MODIFY_PHRASE,"发送英雄/地图/难度槽位设置？"))run(()=>updateLeagueStrawberryPlayer(Number(championId),selectedMap?.item_id||1,difficulty,MODIFY_PHRASE));}} className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs text-violet-200 disabled:opacity-40">设置英雄槽位</button><button disabled={!enabled||busy||!options?.strawberry?.active||!selectedMap} onClick={()=>{if(promptPhrase(MODIFY_PHRASE,"修改当前无尽狂潮地图？"))run(()=>updateLeagueStrawberryMap(selectedMap.content_id,selectedMap.item_id,MODIFY_PHRASE));}} className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs text-violet-200 disabled:opacity-40">设置地图</button><button disabled={!enabled||busy||!options?.strawberry?.active||!options?.strawberry?.loadout_available} onClick={()=>{if(promptPhrase(MODIFY_PHRASE,"修改账号级无尽狂潮难度？"))run(()=>updateLeagueStrawberryDifficulty(difficulty,MODIFY_PHRASE));}} className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs text-violet-200 disabled:opacity-40">设置难度</button></div>
    </section>

    <section className="rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4"><div className="flex items-center gap-2"><Palette className="h-4 w-4 text-pink-300"/><h3 className="text-sm font-bold">召唤师资料背景</h3></div><p className="mt-1 text-xs text-cs2-text-muted">从当前客户端英雄/皮肤目录选择背景及可选挂件；应用前再次验证从属关系。</p><div className="mt-3 grid gap-2 md:grid-cols-3"><select value={profileChampionId} onChange={(event)=>setProfileChampionId(event.target.value)} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-sm"><option value="">选择英雄</option>{champions.filter((row)=>row.id>0).map((row)=><option key={row.id} value={row.id}>{row.name}</option>)}</select><select value={skinId} onChange={(event)=>{setSkinId(event.target.value);setAugmentId("");}} disabled={!skinCatalog.length} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-sm disabled:opacity-40"><option value="">选择皮肤</option>{skinCatalog.map((skin)=><option key={skin.id} value={skin.id}>{skin.name}</option>)}</select><select value={augmentId} onChange={(event)=>setAugmentId(event.target.value)} disabled={!selectedSkin?.augments?.length} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-sm disabled:opacity-40"><option value="">不使用挂件</option>{(selectedSkin?.augments||[]).map((augment)=><option key={augment.content_id} value={augment.content_id}>挂件 {augment.content_id}</option>)}</select></div><div className="mt-2 flex justify-end"><button disabled={!enabled||busy||!profileChampionId||!skinId} onClick={()=>{if(promptPhrase(MODIFY_PHRASE,"修改当前账号资料背景？"))run(()=>updateLeagueProfileBackground(Number(profileChampionId),Number(skinId),augmentId||null,MODIFY_PHRASE));}} className="rounded-lg border border-pink-400/30 bg-pink-400/10 px-3 py-1.5 text-xs font-semibold text-pink-200 disabled:opacity-40">应用资料背景</button></div></section>

    <section className="rounded-2xl border border-amber-400/20 bg-cs2-bg-elevated p-4"><div className="flex items-center gap-2"><Crown className="h-4 w-4 text-amber-300"/><h3 className="text-sm font-bold">资料外观快捷操作</h3></div><p className="mt-1 text-xs text-cs2-text-muted">与上游工具一致。这些操作会修改账号资料或账号级表情配置，默认关闭且每次需要确认。</p><div className="mt-3 grid gap-2 md:grid-cols-2">{[["banner-accent","更新旗帜强调色"],["remove-prestige-crest","移除巅峰徽章"],["clear-challenge-tokens","清空挑战代币"],["clear-emotes","清空全部表情槽位"]].map(([action,label])=><button key={action} disabled={!enabled||busy} onClick={()=>{if(promptPhrase(MODIFY_PHRASE,`${label}？`))run(()=>runLeagueProfileUtilityAction(action,MODIFY_PHRASE));}} className="rounded-xl border border-amber-400/20 bg-amber-400/[.06] px-3 py-2 text-left text-xs font-semibold text-amber-100 disabled:opacity-40">{label}</button>)}</div></section>
  </div>;
}
