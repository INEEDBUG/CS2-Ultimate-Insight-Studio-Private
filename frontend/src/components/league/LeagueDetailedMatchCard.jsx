import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock3, Coins, Eye, Map as MapIcon, Shield, Swords } from "lucide-react";
import {
  getLeagueChampionIconUrl,
  getLeagueItemIconUrl,
  getLeagueSummonerSpellIconUrl,
} from "../../api/api";
import { fetchLeagueMatchDetails } from "../../api/leagueLabApi";
import { maskLeagueName } from "../../utils/leagueStreamerMode";
import LeagueMatchReplayActions from "./LeagueMatchReplayActions";

const TABS = [
  ["summary", "双方总览"],
  ["details", "详细属性"],
  ["runes", "符文"],
  ["events", "事件"],
  ["builds", "出装过程"],
  ["timeline", "时间线"],
];

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function formatDuration(value) {
  const seconds = Math.max(0, Number(value || 0));
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatPlayedAt(value) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? "比赛时间未知" : date.toLocaleString("zh-CN", { hour12: false });
}

function playerName(player, index, streamerMode, useAliases) {
  const raw = player.game_name || player.champion_name || `玩家 ${index + 1}`;
  if (streamerMode) return maskLeagueName(raw, index, useAliases, player.puuid);
  return `${raw}${player.tag_line ? `#${player.tag_line}` : ""}`;
}

function Icon({ src, title, className = "h-7 w-7" }) {
  return <img src={src} alt="" title={title} className={`${className} rounded-md border border-white/10 bg-black/20 object-cover`} />;
}

function SpellIcons({ player, compact = false }) {
  const spellIds = [player.spell1_id, player.spell2_id].filter((id) => Number(id) > 0);
  if (!spellIds.length) return null;
  return <div className="flex gap-1">
    {spellIds.map((id) => <Icon key={id} src={getLeagueSummonerSpellIconUrl(id)} title={`召唤师技能 ${id}`} className={compact ? "h-6 w-6" : "h-8 w-8"} />)}
  </div>;
}

function Loadout({ player, compact = false }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-1">
    {(player.items || []).slice(0, 7).map((id, index) => <Icon key={`${id}-${index}`} src={getLeagueItemIconUrl(id)} title={`装备 ${id}`} className={compact ? "h-5 w-5" : "h-7 w-7"} />)}
    {!player.items?.length ? <span className="text-[10px] text-cs2-text-muted">无装备记录</span> : null}
  </div>;
}

function TeamTable({ players, targetPuuid, streamerMode, useAliases, onOpenPlayer }) {
  const teamKills = players.reduce((sum, player) => sum + Number(player.kills || 0), 0);
  const teamDamage = players.reduce((sum, player) => sum + Number(player.damage || 0), 0);
  return <div className="overflow-x-auto rounded-xl border border-cs2-border-subtle">
    <div className="grid grid-cols-[minmax(180px,1fr)_100px_72px_72px_88px_minmax(110px,auto)] gap-2 border-b border-cs2-border-subtle bg-white/[.035] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-cs2-text-muted">
      <span>玩家</span><span className="text-center">K / D / A</span><span className="text-right">参团</span><span className="text-right">伤害</span><span className="text-right">补刀 / 金币</span><span>装备</span>
    </div>
    {players.map((player, index) => {
      const highlighted = player.puuid && player.puuid === targetPuuid;
      const kp = teamKills ? Math.round((Number(player.kills || 0) + Number(player.assists || 0)) / teamKills * 100) : 0;
      const damageShare = teamDamage ? Math.round(Number(player.damage || 0) / teamDamage * 100) : 0;
      return <div key={player.puuid || player.participant_id || index} className={`grid grid-cols-[minmax(180px,1fr)_100px_72px_72px_88px_minmax(110px,auto)] items-center gap-2 border-b border-cs2-border-subtle px-3 py-2 text-xs last:border-b-0 ${highlighted ? "bg-cyan-400/[.08]" : ""}`}>
        <button type="button" disabled={!player.puuid} onClick={() => player.puuid && onOpenPlayer?.(player.puuid)} className="flex min-w-0 items-center gap-2 text-left disabled:cursor-default">
          <Icon src={getLeagueChampionIconUrl(player.champion_id)} title={player.champion_name} className="h-8 w-8" />
          <span className="min-w-0"><b className="block truncate">{playerName(player, index, streamerMode, useAliases)}</b><span className="text-[10px] text-cs2-text-muted">{player.position || player.role || player.champion_name}</span></span>
        </button>
        <span className="text-center font-mono font-bold"><span>{player.kills || 0}</span><span className="text-cs2-text-muted"> / </span><span className="text-rose-300">{player.deaths || 0}</span><span className="text-cs2-text-muted"> / </span><span>{player.assists || 0}</span></span>
        <span className="text-right font-mono">{kp}%</span>
        <span className="text-right"><b>{formatNumber(player.damage)}</b><small className="block text-[9px] text-cs2-text-muted">{damageShare}%</small></span>
        <span className="text-right"><b>{formatNumber(player.cs)}</b><small className="block text-[9px] text-cs2-text-muted">{formatNumber(player.gold)}g</small></span>
        <Loadout player={player} compact />
      </div>;
    })}
  </div>;
}

function Stat({ label, value, icon: IconComponent }) {
  return <span className="rounded-xl border border-cs2-border-subtle bg-black/10 p-3 text-xs text-cs2-text-muted">{IconComponent ? <IconComponent className="mr-1 inline h-3.5 w-3.5" /> : null}{label}<b className="mt-1 block text-base text-cs2-text-primary">{value}</b></span>;
}

function participantDisplay(player, index, streamerMode, useAliases) {
  return playerName(player || {}, index, streamerMode, useAliases);
}

function RunesTab({ participants, streamerMode, useAliases }) {
  return <div className="space-y-2">{participants.map((player, index) => <section key={player.puuid || player.participant_id || index} className="flex flex-wrap items-center gap-3 rounded-xl border border-cs2-border-subtle p-3">
    <Icon src={getLeagueChampionIconUrl(player.champion_id)} title={player.champion_name} className="h-9 w-9"/>
    <span className="min-w-[150px] flex-1 text-xs"><b className="block">{participantDisplay(player, index, streamerMode, useAliases)}</b><small className="text-cs2-text-muted">{player.position || player.role || player.champion_name}</small></span>
    <SpellIcons player={player}/>
    <span className="max-w-md text-[11px] text-cs2-text-muted">符文：{(player.perks || []).join(" · ") || "无记录"}{player.augments?.length ? `　强化：${player.augments.join(" · ")}` : ""}</span>
  </section>)}</div>;
}

const EVENT_LABELS = {
  CHAMPION_KILL: "英雄击杀",
  ELITE_MONSTER_KILL: "史诗野怪",
  BUILDING_KILL: "建筑摧毁",
  TURRET_PLATE_DESTROYED: "防御塔镀层",
  ITEM_PURCHASED: "购买装备",
  ITEM_SOLD: "出售装备",
  ITEM_UNDO: "撤销购买",
  SKILL_LEVEL_UP: "技能升级",
};

function eventActorId(event) {
  return Number(event.killerId || event.participantId || event.creatorId || 0);
}

function EventsTab({ details, participants, streamerMode, useAliases }) {
  const majorTypes = ["CHAMPION_KILL", "ELITE_MONSTER_KILL", "BUILDING_KILL", "TURRET_PLATE_DESTROYED"];
  const [selected, setSelected] = useState(majorTypes);
  const byId = new Map(participants.map((player) => [Number(player.participant_id), player]));
  const toggle = (type) => setSelected((current) => current.includes(type) ? current.filter((value) => value !== type) : [...current, type]);
  const rows = (details?.events || []).filter((event) => selected.includes(event.type));
  return <div className="grid gap-3 lg:grid-cols-[1fr_190px]">
    <div className="max-h-[430px] overflow-y-auto rounded-xl border border-cs2-border-subtle p-3">{rows.length ? <ol className="space-y-3">{rows.map((event, index) => { const actor = byId.get(eventActorId(event)); const victim = byId.get(Number(event.victimId || 0)); return <li key={`${event.timestamp}-${event.type}-${index}`} className="relative border-l border-cyan-400/25 pl-4 text-xs before:absolute before:-left-1 before:top-1 before:h-2 before:w-2 before:rounded-full before:bg-cyan-300"><span className="font-mono text-[10px] text-cs2-text-muted">{formatDuration(Number(event.timestamp || 0) / 1000)}</span><b className="ml-2">{EVENT_LABELS[event.type] || event.type}</b><p className="mt-1 text-cs2-text-secondary">{actor ? participantDisplay(actor, eventActorId(event), streamerMode, useAliases) : "系统"}{victim ? ` → ${participantDisplay(victim, Number(event.victimId), streamerMode, useAliases)}` : ""}{event.monsterType ? ` · ${event.monsterType}` : ""}{event.buildingType ? ` · ${event.laneType || ""} ${event.buildingType}` : ""}</p></li>;})}</ol> : <p className="py-8 text-center text-cs2-text-muted">当前筛选下没有事件</p>}</div>
    <aside className="rounded-xl border border-cs2-border-subtle p-3"><h4 className="mb-2 text-xs font-bold">事件筛选</h4>{majorTypes.map((type) => <label key={type} className="flex items-center gap-2 py-1.5 text-xs"><input type="checkbox" checked={selected.includes(type)} onChange={() => toggle(type)} className="accent-cyan-400"/>{EVENT_LABELS[type]}</label>)}</aside>
  </div>;
}

function BuildsTab({ details, participants, streamerMode, useAliases }) {
  const byParticipant = new Map();
  for (const event of details?.events || []) {
    if (!["ITEM_PURCHASED", "ITEM_SOLD", "ITEM_UNDO", "SKILL_LEVEL_UP"].includes(event.type)) continue;
    const id = Number(event.participantId || 0);
    if (!byParticipant.has(id)) byParticipant.set(id, []);
    byParticipant.get(id).push(event);
  }
  return <div className="space-y-2">{participants.map((player, index) => { const events = byParticipant.get(Number(player.participant_id)) || []; const purchases = events.filter((event) => event.type === "ITEM_PURCHASED"); const skills = events.filter((event) => event.type === "SKILL_LEVEL_UP"); return <section key={player.puuid || player.participant_id || index} className="rounded-xl border border-cs2-border-subtle p-3"><div className="mb-3 flex items-center gap-2"><Icon src={getLeagueChampionIconUrl(player.champion_id)} title={player.champion_name} className="h-8 w-8"/><b className="text-xs">{participantDisplay(player, index, streamerMode, useAliases)}</b></div><div className="grid gap-3 md:grid-cols-2"><div><h5 className="mb-2 text-[10px] font-semibold text-cs2-text-muted">技能升级顺序</h5><div className="flex flex-wrap gap-1">{skills.length ? skills.map((event, skillIndex) => <span key={`${event.timestamp}-${skillIndex}`} title={formatDuration(Number(event.timestamp || 0) / 1000)} className="grid h-7 w-7 place-items-center rounded bg-violet-400/10 text-xs font-black text-violet-200">{["?", "Q", "W", "E", "R"][Number(event.skillSlot || 0)] || "?"}</span>) : <span className="text-[10px] text-cs2-text-muted">无数据</span>}</div></div><div><h5 className="mb-2 text-[10px] font-semibold text-cs2-text-muted">购买时间线</h5><div className="flex flex-wrap gap-1">{purchases.length ? purchases.map((event, itemIndex) => <span key={`${event.timestamp}-${itemIndex}`} className="text-center"><Icon src={getLeagueItemIconUrl(event.itemId)} title={`${formatDuration(Number(event.timestamp || 0) / 1000)} · 装备 ${event.itemId}`} className="h-8 w-8"/><small className="block font-mono text-[8px] text-cs2-text-muted">{formatDuration(Number(event.timestamp || 0) / 1000)}</small></span>) : <span className="text-[10px] text-cs2-text-muted">无数据</span>}</div></div></div></section>;})}</div>;
}

function GoldTimeline({ details }) {
  const teamByParticipant = new Map((details?.participants || []).map((player) => [String(player.participant_id), Number(player.team_id)]));
  const teamIds = [...new Set(teamByParticipant.values())].filter(Boolean).slice(0, 4);
  const series = teamIds.map((teamId) => (details?.frames || []).map((frame) => ({
    time: Number(frame.timestamp || 0),
    value: Object.entries(frame.participant_frames || {}).reduce((sum, [participantId, stats]) => teamByParticipant.get(String(participantId)) === teamId ? sum + Number(stats.totalGold || 0) : sum, 0),
  })));
  const maxTime = Math.max(1, ...series.flat().map((point) => point.time));
  const maxValue = Math.max(1, ...series.flat().map((point) => point.value));
  const colors = ["#22d3ee", "#fb7185", "#a78bfa", "#fbbf24"];
  return <div className="rounded-xl border border-cs2-border-subtle p-3"><div className="mb-2 flex flex-wrap gap-3 text-[10px] text-cs2-text-muted">{teamIds.map((teamId, index) => <span key={teamId}><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colors[index] }}/>队伍 {teamId}</span>)}</div>{series.some((rows) => rows.length > 1) ? <svg viewBox="0 0 800 220" className="h-auto w-full" role="img" aria-label="双方经济时间线"><path d="M35 10V190H790" fill="none" stroke="rgba(255,255,255,.15)"/><g stroke="rgba(255,255,255,.06)">{[1,2,3].map((line) => <path key={line} d={`M35 ${10 + line * 45}H790`}/>)}</g>{series.map((rows, index) => <polyline key={teamIds[index]} fill="none" stroke={colors[index]} strokeWidth="3" points={rows.map((point) => `${35 + point.time / maxTime * 755},${190 - point.value / maxValue * 175}`).join(" ")}/>)}</svg> : <p className="py-8 text-center text-xs text-cs2-text-muted">时间线帧不足，无法绘制经济曲线</p>}</div>;
}

export default function LeagueDetailedMatchCard({ match, streamerMode = false, useAliases = false, onOpenPlayer, onError }) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState("summary");
  const [matchDetails, setMatchDetails] = useState(null);
  const [detailsBusy, setDetailsBusy] = useState(false);
  const participants = Array.isArray(match.participants) ? match.participants : [];
  const targetPuuid = match.participant_puuid || participants.find((player) => Number(player.champion_id) === Number(match.champion_id) && Number(player.team_id) === Number(match.team_id))?.puuid;
  const target = participants.find((player) => player.puuid && player.puuid === targetPuuid) || { ...match, puuid: targetPuuid };
  const teams = useMemo(() => [...new Set(participants.map((player) => player.team_id).filter((value) => value != null))].map((teamId) => ({ teamId, players: participants.filter((player) => player.team_id === teamId) })), [participants]);
  const ownTeam = participants.filter((player) => player.team_id === target.team_id);
  const teamKills = ownTeam.reduce((sum, player) => sum + Number(player.kills || 0), 0);
  const teamDamage = ownTeam.reduce((sum, player) => sum + Number(player.damage || 0), 0);
  const kda = (Number(target.kills || 0) + Number(target.assists || 0)) / Math.max(1, Number(target.deaths || 0));
  const kp = teamKills ? (Number(target.kills || 0) + Number(target.assists || 0)) / teamKills * 100 : 0;
  const damageShare = teamDamage ? Number(target.damage || 0) / teamDamage * 100 : 0;

  const selectTab = async (nextTab) => {
    setTab(nextTab);
    if (!["events", "builds", "timeline"].includes(nextTab) || matchDetails || detailsBusy || !match.game_id) return;
    setDetailsBusy(true);
    try { setMatchDetails(await fetchLeagueMatchDetails(match.game_id, match.source || "auto")); }
    catch (error) { onError?.(error?.response?.data?.detail || "对局详情读取失败"); }
    finally { setDetailsBusy(false); }
  };

  return <article className={`overflow-hidden rounded-2xl border ${match.win ? "border-emerald-400/25 bg-emerald-400/[.045]" : "border-rose-400/25 bg-rose-400/[.045]"}`}>
    <div className="flex min-h-[118px] items-stretch">
      <div className="flex min-w-0 flex-1 gap-3 p-3">
        <div className="relative h-14 w-14 shrink-0"><Icon src={getLeagueChampionIconUrl(match.champion_id)} title={match.champion_name} className="h-14 w-14" /><span className={`absolute -bottom-1 -right-1 rounded px-1.5 py-0.5 text-[9px] font-black ${match.win ? "bg-emerald-500 text-black" : "bg-rose-500 text-white"}`}>{match.win ? "胜" : "负"}</span></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><b className="text-sm">{match.champion_name || `英雄 ${match.champion_id}`}</b><span className="ml-2 text-[10px] text-cs2-text-muted">{match.position || match.role || "未知位置"}</span></div><span className="font-mono text-base font-black">{match.kills || 0}<i className="px-1 not-italic text-cs2-text-muted">/</i><span className="text-rose-300">{match.deaths || 0}</span><i className="px-1 not-italic text-cs2-text-muted">/</i>{match.assists || 0}</span></div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-cs2-text-muted"><span>KDA <b className="text-cs2-text-primary">{kda.toFixed(2)}</b></span><span>参团 <b className="text-cs2-text-primary">{kp.toFixed(0)}%</b></span><span>伤害占比 <b className="text-cs2-text-primary">{damageShare.toFixed(0)}%</b></span><span>补刀/分 <b className="text-cs2-text-primary">{match.duration_seconds ? (Number(match.cs || 0) / (Number(match.duration_seconds) / 60)).toFixed(1) : "—"}</b></span></div>
          <div className="mt-2 flex flex-wrap items-center gap-1"><SpellIcons player={match} compact/><Loadout player={match} compact /></div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-cs2-text-muted"><span>{match.game_mode || "未知模式"}</span><span>·</span><Clock3 className="h-3 w-3"/><span>{formatDuration(match.duration_seconds)}</span><span>·</span><span>{formatPlayedAt(match.played_at)}</span><span>·</span><span>Game {match.game_id}</span></div>
        </div>
        {participants.length ? <div className="hidden w-44 shrink-0 grid-cols-2 gap-x-2 lg:grid">{teams.slice(0, 2).map((team) => <div key={team.teamId} className="space-y-0.5">{team.players.slice(0, 5).map((player, index) => <button key={player.puuid || index} type="button" disabled={!player.puuid} onClick={() => player.puuid && onOpenPlayer?.(player.puuid)} className={`flex w-full min-w-0 items-center gap-1 text-left text-[9px] ${player.puuid === targetPuuid ? "font-bold text-cyan-200" : "text-cs2-text-muted"}`}><Icon src={getLeagueChampionIconUrl(player.champion_id)} title={player.champion_name} className="h-4 w-4"/><span className="truncate">{playerName(player, index, streamerMode, useAliases)}</span></button>)}</div>)}</div> : null}
      </div>
      <button type="button" aria-label={expanded ? "收起战绩详情" : "展开战绩详情"} onClick={() => setExpanded((value) => !value)} className="grid w-10 shrink-0 place-items-center border-l border-cs2-border-subtle bg-white/[.025] text-cs2-text-muted hover:bg-white/[.06] hover:text-white">{expanded ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}</button>
    </div>
    {expanded ? <div className="border-t border-cs2-border-subtle p-3">
      <div className="mb-3 flex flex-wrap items-center gap-1"><div className="flex min-w-0 flex-1 flex-wrap gap-1">{TABS.map(([id, label]) => <button key={id} type="button" onClick={() => void selectTab(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === id ? "bg-cyan-400/15 text-cyan-200" : "text-cs2-text-muted hover:bg-white/5"}`}>{label}</button>)}</div><LeagueMatchReplayActions match={match} onError={onError}/></div>
      {tab === "summary" ? <div className="space-y-3">{teams.map((team) => <section key={team.teamId}><h4 className="mb-1.5 text-[11px] font-bold text-cs2-text-muted">队伍 {team.teamId} · {team.players[0]?.win ? "胜利" : "失败"}</h4><TeamTable players={team.players} targetPuuid={targetPuuid} streamerMode={streamerMode} useAliases={useAliases} onOpenPlayer={onOpenPlayer}/></section>)}</div> : null}
      {tab === "details" ? <div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Stat icon={Swords} label="英雄伤害" value={formatNumber(target.damage)}/><Stat icon={Shield} label="承受伤害" value={formatNumber(target.damage_taken)}/><Stat icon={Coins} label="金币 / 消费" value={`${formatNumber(target.gold)} / ${formatNumber(target.gold_spent)}`}/><Stat icon={Eye} label="视野分" value={formatNumber(target.vision_score)}/><Stat label="治疗量" value={formatNumber(target.healing)}/><Stat label="防御塔伤害" value={formatNumber(target.tower_damage)}/><Stat label="控制时长" value={formatNumber(target.time_ccing)}/><Stat label="英雄等级" value={formatNumber(target.level)}/></div> : null}
      {tab === "runes" ? <RunesTab participants={participants} streamerMode={streamerMode} useAliases={useAliases}/> : null}
      {tab === "events" ? detailsBusy ? <p className="rounded-xl border border-cs2-border-subtle p-8 text-center text-xs text-cs2-text-muted">正在读取本局事件…</p> : matchDetails ? <EventsTab details={matchDetails} participants={participants} streamerMode={streamerMode} useAliases={useAliases}/> : <p className="text-xs text-cs2-text-muted">此对局没有可用事件数据。</p> : null}
      {tab === "builds" ? detailsBusy ? <p className="rounded-xl border border-cs2-border-subtle p-8 text-center text-xs text-cs2-text-muted">正在读取出装过程…</p> : matchDetails ? <BuildsTab details={matchDetails} participants={participants} streamerMode={streamerMode} useAliases={useAliases}/> : <p className="text-xs text-cs2-text-muted">此对局没有可用出装过程。</p> : null}
      {tab === "timeline" ? <section className="space-y-3 text-xs">{detailsBusy ? <p className="rounded-xl border border-cs2-border-subtle p-8 text-center text-cs2-text-muted">正在读取本局时间线…</p> : matchDetails ? <><div className="grid gap-2 sm:grid-cols-3"><Stat icon={MapIcon} label="数据源" value={String(matchDetails.source || match.source || "LCU").toUpperCase()}/><Stat label="时间线帧" value={formatNumber(matchDetails.frame_count)}/><Stat label="事件数量" value={formatNumber(matchDetails.event_count)}/></div><GoldTimeline details={matchDetails}/></> : <p className="text-cs2-text-muted">此对局暂时没有可用时间线。</p>}</section> : null}
    </div> : null}
  </article>;
}
