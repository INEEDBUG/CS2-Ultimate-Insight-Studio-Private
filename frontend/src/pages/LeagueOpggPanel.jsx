import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw, Search, Settings2, ShieldCheck } from "lucide-react";
import {
  applyLeagueOpggItems,
  applyLeagueOpggRunes,
  applyLeagueOpggSpells,
  clearLeagueOpggItems,
  fetchLeagueChampions,
  fetchLeagueLabStatus,
  fetchLeagueOpggChampion,
  fetchLeagueOpggChampions,
  fetchLeagueOpggVersions,
  saveLeagueLabSettings,
} from "../api/leagueLabApi";
import {
  getLeagueChampionIconUrl,
  getLeagueItemIconUrl,
  getLeagueSummonerSpellIconUrl,
} from "../api/api";
import {
  hasLeagueChampionConfig,
  leagueOpggItemGroups,
  leagueOpggModeForGameMode,
  leagueOpggPositionForAssignedPosition,
  leagueOpggStats,
} from "../utils/leagueOpgg";

const MODES = [["ranked", "排位"], ["aram", "极地大乱斗"], ["arena", "斗魂竞技场"], ["nexus_blitz", "极限闪击"], ["urf", "无限火力"]];
const POSITIONS = [["top", "上路"], ["jungle", "打野"], ["mid", "中路"], ["adc", "下路"], ["support", "辅助"]];
const TIERS = [["all", "全部分段"], ["emerald_plus", "翡翠+"], ["diamond_plus", "钻石+"], ["master_plus", "大师+"], ["challenger", "王者"]];
const REGIONS = [["global", "全球"], ["kr", "韩服"], ["euw", "西欧"], ["na", "北美"], ["tw", "台服"], ["vn", "越南"], ["sg", "新马"], ["jp", "日服"]];

function Select({ value, onChange, options, disabled }) {
  return <select value={value} onChange={(event)=>onChange(event.target.value)} disabled={disabled} className="min-w-0 rounded-lg border border-white/10 bg-white/[.06] px-2 py-1.5 text-[11px] text-zinc-200 outline-none disabled:opacity-40">{options.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>;
}

function Rate({ value }) {
  return <span>{value == null ? "—" : `${(Number(value) * 100).toFixed(1)}%`}</span>;
}

function ItemRow({ title, rows, limit = 4 }) {
  if (!rows?.length) return null;
  return <section className="rounded-xl border border-white/8 bg-white/[.025] p-3"><h3 className="mb-2 text-xs font-bold text-zinc-200">{title}</h3><div className="space-y-2">{rows.slice(0,limit).map((row,index)=><div key={`${title}-${index}`} className="flex items-center gap-2"><div className="flex min-w-0 flex-1 gap-1">{(row.ids||[]).map((id,itemIndex)=><img key={`${id}-${itemIndex}`} src={getLeagueItemIconUrl(id)} alt={String(id)} title={String(id)} className="h-8 w-8 rounded-md border border-white/10 bg-black/30 object-cover"/>)}</div><span className="text-[10px] text-zinc-500">{row.pick_rate!=null?`${(Number(row.pick_rate)*100).toFixed(1)}%`:row.play?`${row.play} 场`:""}</span></div>)}</div></section>;
}

function Switch({ label, checked, onChange, disabled }) {
  return <label className="flex items-center justify-between gap-4 border-b border-white/8 py-2 text-xs last:border-0"><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event)=>onChange(event.target.checked)} className="h-4 w-4 accent-cyan-400"/></label>;
}

export default function LeagueOpggPanel() {
  const [status,setStatus]=useState(null),[catalog,setCatalog]=useState([]),[versions,setVersions]=useState([]),[champions,setChampions]=useState([]);
  const [mode,setMode]=useState("ranked"),[region,setRegion]=useState("global"),[tier,setTier]=useState("all"),[position,setPosition]=useState("top"),[version,setVersion]=useState("");
  const [selected,setSelected]=useState(null),[detail,setDetail]=useState(null),[filter,setFilter]=useState(""),[loading,setLoading]=useState(false),[message,setMessage]=useState(""),[showSettings,setShowSettings]=useState(false);
  const listRequest=useRef(0),detailRequest=useRef(0),autoApplied=useRef(new Set()),previousPhase=useRef("");
  const names=useMemo(()=>new Map(catalog.map((row)=>[Number(row.id),row.name||`英雄 ${row.id}`])),[catalog]);
  const settings=status?.settings||{};

  const refreshList=useCallback(async()=>{
    const request=++listRequest.current;setLoading(true);setMessage("");
    try{
      const versionPayload=await fetchLeagueOpggVersions({region,mode});
      const nextVersions=versionPayload?.data||[];
      const targetVersion=nextVersions.includes(version)?version:(nextVersions[0]||"");
      const payload=await fetchLeagueOpggChampions({region,mode,tier,version:targetVersion||undefined});
      if(request!==listRequest.current)return;
      setVersions(nextVersions);setVersion(targetVersion);setChampions(payload?.data||[]);
    }catch(error){if(request===listRequest.current)setMessage(error?.response?.data?.detail||"无法读取 OP.GG 英雄榜");}
    finally{if(request===listRequest.current)setLoading(false);}
  },[mode,region,tier,version]);

  const loadChampion=useCallback(async(championId, override={})=>{
    if(!championId)return;const request=++detailRequest.current;setLoading(true);setMessage("");
    const target={region:override.region||region,mode:override.mode||mode,tier:override.tier||tier,version:override.version||version,position:override.position||position};
    try{const payload=await fetchLeagueOpggChampion(championId,target);if(request!==detailRequest.current)return;setSelected(Number(championId));setDetail(payload);}
    catch(error){if(request===detailRequest.current)setMessage(error?.response?.data?.detail||"无法读取英雄出装数据");}
    finally{if(request===detailRequest.current)setLoading(false);}
  },[mode,position,region,tier,version]);

  useEffect(()=>{fetchLeagueChampions().then((payload)=>setCatalog(payload?.champions||[])).catch(()=>setCatalog([]));},[]);
  useEffect(()=>{refreshList();},[mode,region,tier,version]);
  useEffect(()=>{let disposed=false;const poll=async()=>{try{const next=await fetchLeagueLabStatus();if(!disposed)setStatus(next);}catch{}};poll();const timer=setInterval(poll,1500);return()=>{disposed=true;clearInterval(timer);};},[]);
  useEffect(()=>{const phase=status?.phase||"";if(phase==="EndOfGame"&&previousPhase.current&&previousPhase.current!=="EndOfGame")clearLeagueOpggItems().catch(()=>{});previousPhase.current=phase;},[status?.phase]);

  useEffect(()=>{
    if(status?.phase!=="ChampSelect"){autoApplied.current.clear();return;}
    const championId=Number(status?.champ_select?.current_champion_id||0);if(!championId||championId===-3)return;
    const targetMode=leagueOpggModeForGameMode(status?.game_mode);
    const own=status?.champ_select?.my_team?.find((row)=>row.cell_id===status?.champ_select?.local_player_cell_id);
    const targetPosition=leagueOpggPositionForAssignedPosition(own?.assigned_position,targetMode);
    setMode(targetMode);setPosition(targetPosition);loadChampion(championId,{mode:targetMode,position:targetPosition});
  },[status?.phase,status?.champ_select?.current_champion_id,status?.game_mode]);

  const championData=detail?.data,summary=championData?.summary,stats=leagueOpggStats(summary,position);
  const championName=names.get(Number(summary?.id||selected))||`英雄 ${summary?.id||selected||""}`;
  const winRate=stats?.win_rate??(stats?.play?Number(stats.win||0)/Number(stats.play):null);
  const itemGroups=useMemo(()=>leagueOpggItemGroups(championData),[championData]);
  const runes=championData?.runes||[],spells=championData?.summoner_spells||[];

  const applyRunes=async(row=runes[0])=>{if(!row)return;try{await applyLeagueOpggRunes({champion_id:Number(summary.id),champion_name:championName,position,primary_page_id:row.primary_page_id,secondary_page_id:row.secondary_page_id,primary_rune_ids:row.primary_rune_ids||[],secondary_rune_ids:row.secondary_rune_ids||[],stat_mod_ids:row.stat_mod_ids||[]});setMessage("符文已应用到当前客户端");}catch(error){setMessage(error?.response?.data?.detail||"应用符文失败");}};
  const applySpells=async(row=spells[0])=>{if(!row)return;try{await applyLeagueOpggSpells({spell_ids:row.ids,flash_position:settings.opgg_flash_position||"auto"});setMessage("召唤师技能已应用");}catch(error){setMessage(error?.response?.data?.detail||"应用召唤师技能失败");}};
  const applyItems=async()=>{if(!itemGroups.length)return;try{const result=await applyLeagueOpggItems({champion_id:Number(summary.id),champion_name:championName,mode,position,region,tier,version:detail?.meta?.version||version,groups:itemGroups});setMessage(`推荐装备已写入：${result.path}`);}catch(error){setMessage(error?.response?.data?.detail||"写入推荐装备失败");}};

  useEffect(()=>{
    const championId=Number(summary?.id||0);if(status?.phase!=="ChampSelect"||championId!==Number(status?.champ_select?.current_champion_id||0))return;
    const conflict=hasLeagueChampionConfig(settings,championId),signature=`${championId}:${mode}:${position}:${detail?.meta?.version||version}`;
    if(autoApplied.current.has(signature))return;
    const jobs=[];
    if(settings.opgg_auto_apply_spells&&!conflict&&spells[0])jobs.push(()=>applySpells(spells[0]));
    if(settings.opgg_auto_apply_runes&&!conflict&&runes[0])jobs.push(()=>applyRunes(runes[0]));
    if(settings.opgg_auto_apply_items&&itemGroups.length)jobs.push(applyItems);
    if(!jobs.length)return;autoApplied.current.add(signature);(async()=>{for(const job of jobs)await job();})();
  },[detail,status?.phase,status?.champ_select?.current_champion_id,settings.opgg_auto_apply_spells,settings.opgg_auto_apply_runes,settings.opgg_auto_apply_items]);

  const updateSettings=async(patch)=>{try{const saved=await saveLeagueLabSettings({...settings,...patch});setStatus((current)=>({...current,settings:saved}));}catch(error){setMessage(error?.response?.data?.detail||"保存设置失败");}};
  const visibleChampions=champions.filter((row)=>{const text=`${names.get(Number(row.id))||""} ${row.id}`.toLowerCase();return text.includes(filter.trim().toLowerCase());}).sort((a,b)=>Number(a.average_stats?.rank||999)-Number(b.average_stats?.rank||999));

  return <main className="flex h-screen min-h-[530px] flex-col overflow-hidden bg-[#101114] text-zinc-100">
    <header className="border-b border-white/10 bg-[#15171b] px-3 py-2"><div className="flex items-center gap-2"><a href="https://op.gg" target="_blank" rel="noreferrer" className="grid h-8 w-8 place-items-center rounded-lg bg-[#5383e8] text-xs font-black">OP</a><button onClick={refreshList} className="rounded-lg border border-white/10 p-2" title="刷新"><RefreshCw className={`h-4 w-4 ${loading?"animate-spin":""}`}/></button><button onClick={()=>setShowSettings((value)=>!value)} className="rounded-lg border border-white/10 p-2" title="设置"><Settings2 className="h-4 w-4"/></button><div className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400"/>OP.GG API · LeagueAkari 工作流</div></div>
      <div className="mt-2 flex flex-wrap gap-1"><Select value={mode} onChange={(value)=>{setMode(value);setPosition(value==="ranked"?"top":"none");setSelected(null);setDetail(null);}} options={MODES}/><Select value={region} onChange={setRegion} options={REGIONS}/><Select value={tier} onChange={setTier} options={TIERS} disabled={mode==="arena"}/>{mode==="ranked"&&<Select value={position} onChange={(value)=>{setPosition(value);if(selected)loadChampion(selected,{position:value});}} options={POSITIONS}/>}<Select value={version} onChange={setVersion} options={versions.map((value)=>[value,value])} disabled={!versions.length}/></div>
    </header>
    {showSettings&&<section className="border-b border-white/10 bg-[#181a1f] px-4 py-2"><Switch label="启用 OP.GG 辅助窗口" checked={settings.opgg_window_enabled!==false} onChange={(value)=>updateSettings({opgg_window_enabled:value})}/><Switch label="英雄选择时自动显示" checked={Boolean(settings.opgg_auto_show)} onChange={(value)=>updateSettings({opgg_auto_show:value})}/><Switch label="自动应用符文（默认关闭）" checked={Boolean(settings.opgg_auto_apply_runes)} onChange={(value)=>updateSettings({opgg_auto_apply_runes:value})}/><Switch label="自动应用召唤师技能（默认关闭）" checked={Boolean(settings.opgg_auto_apply_spells)} onChange={(value)=>updateSettings({opgg_auto_apply_spells:value})}/><Switch label="自动写入推荐装备（默认关闭）" checked={Boolean(settings.opgg_auto_apply_items)} onChange={(value)=>updateSettings({opgg_auto_apply_items:value})}/><div className="flex items-center justify-between py-2 text-xs"><span>闪现位置</span><Select value={settings.opgg_flash_position||"auto"} onChange={(value)=>updateSettings({opgg_flash_position:value})} options={[["auto","保持当前"],["d","D 键"],["f","F 键"]]}/></div></section>}
    {message&&<div className="border-b border-amber-300/20 bg-amber-300/8 px-3 py-2 text-[11px] text-amber-100">{message}</div>}
    {!selected?<section className="flex min-h-0 flex-1 flex-col p-2"><label className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.04] px-3"><Search className="h-4 w-4 text-zinc-500"/><input value={filter} onChange={(event)=>setFilter(event.target.value)} placeholder="搜索英雄" className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"/></label><div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/8"><div className="grid grid-cols-[42px_1fr_50px_65px_65px] border-b border-white/8 px-2 py-2 text-center text-[10px] text-zinc-500"><span>#</span><span className="text-left">英雄</span><span>梯级</span><span>胜率</span><span>选取率</span></div>{visibleChampions.map((row,index)=>{const rowStats=mode==="ranked"?leagueOpggStats(row,position):row.average_stats||{};return <button key={row.id} onClick={()=>loadChampion(row.id)} className="grid w-full grid-cols-[42px_1fr_50px_65px_65px] items-center border-b border-white/[.06] px-2 py-1.5 text-center text-xs hover:bg-cyan-400/[.06]"><span className="text-zinc-500">{rowStats?.tier_data?.rank||row.average_stats?.rank||index+1}</span><span className="flex min-w-0 items-center gap-2 text-left"><img src={getLeagueChampionIconUrl(row.id)} alt="" className="h-8 w-8 rounded-lg object-cover"/><b className="truncate">{names.get(Number(row.id))||`英雄 ${row.id}`}</b></span><span className="font-bold text-cyan-300">{rowStats?.tier_data?.tier===0?"OP":rowStats?.tier_data?.tier||row.average_stats?.tier||"—"}</span><Rate value={rowStats?.win_rate}/><Rate value={rowStats?.pick_rate}/></button>;})}</div></section>:
      <section className="min-h-0 flex-1 overflow-auto p-3"><button onClick={()=>{setSelected(null);setDetail(null);}} className="mb-3 inline-flex items-center gap-1 text-xs text-zinc-400"><ArrowLeft className="h-4 w-4"/>返回英雄榜</button>{championData&&<div className="space-y-3"><div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[.03] p-3"><img src={getLeagueChampionIconUrl(summary.id)} alt="" className="h-14 w-14 rounded-full border-2 border-cyan-300/40 object-cover"/><div className="min-w-0 flex-1"><h2 className="truncate text-lg font-black">{championName}</h2><p className="text-xs text-zinc-500">{position!=="none"?position:"全位置"} · T{stats?.tier_data?.tier??stats?.tier??"—"} · 第 {stats?.tier_data?.rank??stats?.rank??"—"} 名</p></div><div className="grid grid-cols-3 gap-3 text-center text-[10px] text-zinc-500"><span>胜率<b className="block text-sm text-white"><Rate value={winRate}/></b></span><span>选取<b className="block text-sm text-white"><Rate value={stats?.pick_rate}/></b></span><span>{stats?.total_place&&stats?.play?"平均名次":"禁用"}<b className="block text-sm text-white">{stats?.total_place&&stats?.play?(Number(stats.total_place)/Number(stats.play)).toFixed(2):<Rate value={stats?.ban_rate}/>}</b></span></div></div>
        {spells.length>0&&<section className="rounded-xl border border-white/8 bg-white/[.025] p-3"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold">召唤师技能</h3><button onClick={()=>applySpells()} className="rounded-lg bg-cyan-400/15 px-2 py-1 text-[11px] font-bold text-cyan-200">应用首选</button></div>{spells.slice(0,3).map((row,index)=><button key={index} onClick={()=>applySpells(row)} className="mr-2 inline-flex items-center gap-1 rounded-lg border border-white/8 p-1.5"><span className="flex">{(row.ids||[]).map((id)=><img key={id} src={getLeagueSummonerSpellIconUrl(id)} alt="" className="h-8 w-8 rounded object-cover"/>)}</span><small className="text-zinc-500"><Rate value={row.pick_rate}/></small></button>)}</section>}
        {runes.length>0&&<section className="rounded-xl border border-white/8 bg-white/[.025] p-3"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold">符文配置</h3><button onClick={()=>applyRunes()} className="rounded-lg bg-cyan-400/15 px-2 py-1 text-[11px] font-bold text-cyan-200">应用首选</button></div>{runes.slice(0,3).map((row,index)=><button key={index} onClick={()=>applyRunes(row)} className="mb-1 flex w-full items-center justify-between rounded-lg border border-white/8 px-2 py-2 text-left text-[11px]"><span><b>{row.primary_page_id} / {row.secondary_page_id}</b><small className="ml-2 text-zinc-500">{[...(row.primary_rune_ids||[]),...(row.secondary_rune_ids||[])].join(" · ")}</small></span><Rate value={row.pick_rate}/></button>)}</section>}
        {itemGroups.length>0&&<div className="flex justify-end"><button onClick={applyItems} className="rounded-lg bg-emerald-400/15 px-3 py-2 text-xs font-bold text-emerald-200">写入推荐装备</button></div>}
        <div className="grid gap-2 lg:grid-cols-2"><ItemRow title="出门装" rows={championData.starter_items}/><ItemRow title="鞋子" rows={championData.boots}/><ItemRow title="核心装备" rows={championData.core_items}/><ItemRow title="后期装备" rows={championData.last_items}/><ItemRow title="棱彩装备" rows={championData.prism_items}/></div>
        {championData.skills?.length>0&&<section className="rounded-xl border border-white/8 bg-white/[.025] p-3"><h3 className="mb-2 text-xs font-bold">技能加点顺序</h3>{championData.skills.slice(0,3).map((row,index)=><div key={index} className="mb-1 flex items-center justify-between rounded-lg border border-white/8 px-2 py-2 text-[11px]"><span className="flex min-w-0 flex-wrap gap-1">{(row.order||[]).map((skill,step)=><b key={step} className={`grid h-5 w-5 place-items-center rounded ${skill==="R"?"bg-amber-400/20 text-amber-200":"bg-cyan-400/12 text-cyan-200"}`}>{skill}</b>)}</span><Rate value={row.pick_rate}/></div>)}</section>}
        {championData.augment_group?.length>0&&<section className="rounded-xl border border-white/8 bg-white/[.025] p-3"><h3 className="mb-2 text-xs font-bold">强化符文</h3><div className="space-y-2">{championData.augment_group.map((group)=><div key={group.rarity} className="flex flex-wrap items-center gap-1"><span className="mr-1 w-12 text-[10px] text-zinc-500">稀有度 {group.rarity}</span>{(group.augments||[]).slice(0,12).map((row)=><span key={row.id} title={`选取率 ${(Number(row.pick_rate||0)*100).toFixed(1)}%`} className="rounded-md border border-violet-300/15 bg-violet-300/[.07] px-2 py-1 text-[10px] text-violet-200">#{row.id} · {(Number(row.win_rate||0)*100).toFixed(0)}%</span>)}</div>)}</div></section>}
        {(championData.counters?.length||championData.synergies?.length)>0&&<section className="grid gap-2 rounded-xl border border-white/8 bg-white/[.025] p-3 sm:grid-cols-2"><div><h3 className="mb-2 text-xs font-bold text-rose-200">克制关系</h3><div className="flex flex-wrap gap-1">{(championData.counters||[]).slice(0,8).map((row)=><img key={row.champion_id} src={getLeagueChampionIconUrl(row.champion_id)} alt="" title={names.get(Number(row.champion_id))||String(row.champion_id)} className="h-9 w-9 rounded-lg object-cover"/>)}</div></div><div><h3 className="mb-2 text-xs font-bold text-emerald-200">最佳搭档</h3><div className="flex flex-wrap gap-1">{(championData.synergies||[]).slice(0,8).map((row)=><img key={row.champion_id} src={getLeagueChampionIconUrl(row.champion_id)} alt="" title={names.get(Number(row.champion_id))||String(row.champion_id)} className="h-9 w-9 rounded-lg object-cover"/>)}</div></div></section>}
        <a href={`https://op.gg/lol/champions/${summary.id}/build`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-blue-300">在 OP.GG 查看原始数据<ExternalLink className="h-3 w-3"/></a>
      </div>}</section>}
  </main>;
}
