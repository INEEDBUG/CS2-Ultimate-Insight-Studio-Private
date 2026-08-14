import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock3, Map as MapIcon } from "lucide-react";
import {
  getLeagueChampionIconUrl,
  getLeagueItemIconUrl,
  getLeaguePerkIconUrl,
  getLeagueSummonerSpellIconUrl,
} from "../../api/api";
import { fetchLeagueLoadoutCatalog, fetchLeagueMatchDetails } from "../../api/leagueLabApi";
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

const RAW_STAT_LABELS = {
  kills: "击杀", deaths: "死亡", assists: "助攻", win: "胜利", champLevel: "英雄等级",
  goldEarned: "获得金币", goldSpent: "消费金币", totalMinionsKilled: "线上补刀",
  neutralMinionsKilled: "野怪补刀", totalDamageDealtToChampions: "对英雄伤害",
  totalDamageTaken: "承受伤害", totalHeal: "治疗量", totalTimeCCDealt: "控制时长",
  damageDealtToTurrets: "防御塔伤害", visionScore: "视野得分", wardsPlaced: "插眼",
  wardsKilled: "排眼", largestKillingSpree: "最大连杀", doubleKills: "双杀",
  tripleKills: "三杀", quadraKills: "四杀", pentaKills: "五杀",
};

function rawValue(value) {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isInteger(value) ? formatNumber(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return value == null || value === "" ? "—" : String(value);
}

function RawDetailsTab({ match, participants, streamerMode, useAliases }) {
  const [filter, setFilter] = useState("");
  const keys = useMemo(() => {
    const all = new Set();
    participants.forEach((player) => Object.keys(player.raw_stats || {}).forEach((key) => all.add(key)));
    const needle = filter.trim().toLowerCase();
    return [...all].filter((key) => !needle || key.toLowerCase().includes(needle) || String(RAW_STAT_LABELS[key] || "").includes(needle));
  }, [filter, participants]);
  return <section className="space-y-2">
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-cs2-border-subtle bg-white/[.025] p-2 text-[10px] text-cs2-text-muted">
      <span>Game ID <b className="select-text text-cs2-text-primary">{match.game_id || "—"}</b></span>
      <span>数据源 <b className="text-cs2-text-primary">{String(match.source || "LCU").toUpperCase()}</b></span>
      <span>版本 <b className="text-cs2-text-primary">{match.game_version || "—"}</b></span>
      <span>地图 <b className="text-cs2-text-primary">{match.map_id || "—"}</b></span>
      <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选属性名称…" className="ml-auto min-w-52 rounded-lg border border-cs2-border bg-cs2-bg-input px-2.5 py-1.5 text-xs text-cs2-text-primary outline-none focus:border-cyan-400/60"/>
    </div>
    <div className="max-h-[430px] overflow-auto rounded-xl border border-cs2-border-subtle">
      {keys.length ? <table className="min-w-max border-collapse text-[10px]"><thead className="sticky top-0 z-20 bg-cs2-bg-elevated"><tr><th className="sticky left-0 z-30 min-w-40 border-b border-r border-cs2-border-subtle bg-cs2-bg-elevated p-2 text-left">属性</th>{participants.map((player, index) => <th key={player.puuid || player.participant_id || index} className="min-w-24 border-b border-cs2-border-subtle p-2"><Icon src={getLeagueChampionIconUrl(player.champion_id)} title={player.champion_name} className="mx-auto h-7 w-7"/><span className="mt-1 block max-w-24 truncate">{participantDisplay(player, index, streamerMode, useAliases)}</span></th>)}</tr></thead><tbody>{keys.map((key) => <tr key={key} className="odd:bg-white/[.018]"><th title={key} className="sticky left-0 z-10 max-w-48 border-r border-t border-cs2-border-subtle bg-cs2-bg-elevated p-2 text-left"><span className="block truncate">{RAW_STAT_LABELS[key] || key}</span>{RAW_STAT_LABELS[key] ? <small className="block truncate font-normal text-cs2-text-muted">{key}</small> : null}</th>{participants.map((player, index) => <td key={player.puuid || player.participant_id || index} className="max-w-32 truncate border-t border-cs2-border-subtle p-2 text-center font-mono" title={rawValue(player.raw_stats?.[key])}>{rawValue(player.raw_stats?.[key])}</td>)}</tr>)}</tbody></table> : <p className="py-12 text-center text-xs text-cs2-text-muted">没有匹配的属性</p>}
    </div>
  </section>;
}

function plainDescription(value) {
  return String(value || "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

function RunesTab({ participants, perkMap, streamerMode, useAliases }) {
  return <div className="space-y-2">{participants.map((player, index) => <section key={player.puuid || player.participant_id || index} className="flex flex-wrap items-center gap-3 rounded-xl border border-cs2-border-subtle p-3">
    <Icon src={getLeagueChampionIconUrl(player.champion_id)} title={player.champion_name} className="h-9 w-9"/>
    <span className="min-w-[150px] flex-1 text-xs"><b className="block">{participantDisplay(player, index, streamerMode, useAliases)}</b><small className="text-cs2-text-muted">{player.position || player.role || player.champion_name}</small></span>
    <SpellIcons player={player}/>
    <div className="flex max-w-xl flex-1 flex-wrap gap-2">{(player.perks || []).length ? player.perks.map((perkId) => { const perk = perkMap.get(Number(perkId)); const description = plainDescription(perk?.long_description || perk?.short_description); return <span key={perkId} className="flex max-w-56 items-center gap-1.5 rounded-lg bg-white/[.035] px-2 py-1"><Icon src={getLeaguePerkIconUrl(perkId)} title={perk?.name || `符文 ${perkId}`} className="h-7 w-7"/><span className="min-w-0 text-[10px]"><b className="block truncate text-cs2-text-primary">{perk?.name || `符文 ${perkId}`}</b>{description ? <small className="block max-w-44 truncate text-cs2-text-muted" title={description}>{description}</small> : null}</span></span>; }) : <span className="text-[11px] text-cs2-text-muted">无符文记录</span>}{player.augments?.length ? <span className="w-full text-[10px] text-violet-200">强化：{player.augments.join(" · ")}</span> : null}</div>
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

const MAP_DOMAINS = {
  11: { minX: 0, minY: 0, maxX: 14820, maxY: 14881 },
  12: { minX: -28, minY: -19, maxX: 12849, maxY: 12858 },
  21: { minX: 0, minY: 0, maxX: 15000, maxY: 15000 },
};

function MapPositionPreview({ mapId, position }) {
  const domain = MAP_DOMAINS[Number(mapId)];
  if (!domain || !position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.y))) return null;
  const left = Math.max(0, Math.min(100, (Number(position.x) - domain.minX) / (domain.maxX - domain.minX) * 100));
  const top = Math.max(0, Math.min(100, (domain.maxY - Number(position.y)) / (domain.maxY - domain.minY) * 100));
  return <details className="mt-1 w-fit"><summary className="cursor-pointer text-[10px] font-semibold text-cyan-300">查看地图位置</summary><div className="relative mt-1 h-40 w-40 overflow-hidden rounded-lg border border-cs2-border-subtle bg-[linear-gradient(45deg,rgba(34,211,238,.035)_25%,transparent_25%,transparent_75%,rgba(34,211,238,.035)_75%),linear-gradient(45deg,rgba(34,211,238,.035)_25%,transparent_25%,transparent_75%,rgba(34,211,238,.035)_75%)] bg-[length:24px_24px] bg-[position:0_0,12px_12px]"><span className="absolute left-2 top-2 text-[9px] font-bold text-cs2-text-muted">MAP {mapId}</span><i className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,.9)]" style={{ left: `${left}%`, top: `${top}%` }}/></div></details>;
}

function eventActorId(event) {
  return Number(event.killerId || event.participantId || event.creatorId || 0);
}

function EventsTab({ details, participants, mapId, streamerMode, useAliases }) {
  const majorTypes = ["CHAMPION_KILL", "ELITE_MONSTER_KILL", "BUILDING_KILL", "TURRET_PLATE_DESTROYED"];
  const [selected, setSelected] = useState(majorTypes);
  const participantIds = participants.map((player) => Number(player.participant_id)).filter(Boolean);
  const [selectedParticipants, setSelectedParticipants] = useState(participantIds);
  const byId = new Map(participants.map((player) => [Number(player.participant_id), player]));
  const toggle = (type) => setSelected((current) => current.includes(type) ? current.filter((value) => value !== type) : [...current, type]);
  const toggleParticipant = (id) => setSelectedParticipants((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const rows = (details?.events || []).filter((event) => {
    if (!selected.includes(event.type)) return false;
    const assists = Array.isArray(event.assistingParticipantIds) ? event.assistingParticipantIds.map(Number) : [];
    const involved = [eventActorId(event), Number(event.victimId || 0), ...assists].filter(Boolean);
    return !involved.length || involved.some((id) => selectedParticipants.includes(id));
  });
  const plateCounts = (details?.events || []).filter((event) => event.type === "TURRET_PLATE_DESTROYED").reduce((counts, event) => {
    const id = eventActorId(event);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
    return counts;
  }, new Map());
  return <div className="grid gap-3 lg:grid-cols-[1fr_190px]">
    <div className="max-h-[430px] overflow-y-auto rounded-xl border border-cs2-border-subtle p-3">{rows.length ? <ol className="space-y-3">{rows.map((event, index) => { const actor = byId.get(eventActorId(event)); const victim = byId.get(Number(event.victimId || 0)); return <li key={`${event.timestamp}-${event.type}-${index}`} className="relative border-l border-cyan-400/25 pl-4 text-xs before:absolute before:-left-1 before:top-1 before:h-2 before:w-2 before:rounded-full before:bg-cyan-300"><span className="font-mono text-[10px] text-cs2-text-muted">{formatDuration(Number(event.timestamp || 0) / 1000)}</span><b className="ml-2">{EVENT_LABELS[event.type] || event.type}</b><p className="mt-1 text-cs2-text-secondary">{actor ? participantDisplay(actor, eventActorId(event), streamerMode, useAliases) : "系统"}{victim ? ` → ${participantDisplay(victim, Number(event.victimId), streamerMode, useAliases)}` : ""}{event.monsterType ? ` · ${event.monsterType}` : ""}{event.buildingType ? ` · ${event.laneType || ""} ${event.buildingType}` : ""}</p><MapPositionPreview mapId={mapId} position={event.position}/></li>;})}</ol> : <p className="py-8 text-center text-cs2-text-muted">当前筛选下没有事件</p>}</div>
    <aside className="max-h-[430px] overflow-y-auto rounded-xl border border-cs2-border-subtle p-3"><h4 className="mb-2 text-xs font-bold">事件筛选</h4>{majorTypes.map((type) => <label key={type} className="flex items-center gap-2 py-1.5 text-xs"><input type="checkbox" checked={selected.includes(type)} onChange={() => toggle(type)} className="accent-cyan-400"/>{EVENT_LABELS[type]}</label>)}<div className="my-2 border-t border-cs2-border-subtle"/><h4 className="mb-1 text-xs font-bold">按英雄筛选</h4>{participants.map((player, index) => { const id = Number(player.participant_id); return <label key={id || index} className="flex items-center gap-2 py-1 text-[10px]"><input type="checkbox" checked={selectedParticipants.includes(id)} onChange={() => toggleParticipant(id)} className="accent-cyan-400"/><Icon src={getLeagueChampionIconUrl(player.champion_id)} title={player.champion_name} className="h-5 w-5"/><span className="min-w-0 flex-1 truncate">{participantDisplay(player, index, streamerMode, useAliases)}</span>{plateCounts.get(id) ? <b title="镀层数" className="text-amber-300">{plateCounts.get(id)}</b> : null}</label>;})}</aside>
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

function TeamGoldTimeline({ details }) {
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

function DifferenceTimeline({ details }) {
  const teamByParticipant = new Map((details?.participants || []).map((player) => [String(player.participant_id), Number(player.team_id)]));
  const teamIds = [...new Set(teamByParticipant.values())].filter(Boolean).slice(0, 2);
  const points = (details?.frames || []).map((frame) => {
    const totals = teamIds.map((teamId) => Object.entries(frame.participant_frames || {}).reduce((sum, [participantId, stats]) => teamByParticipant.get(String(participantId)) === teamId ? sum + Number(stats.totalGold || 0) : sum, 0));
    return { time: Number(frame.timestamp || 0), value: Number(totals[0] || 0) - Number(totals[1] || 0) };
  });
  const maxTime = Math.max(1, ...points.map((point) => point.time));
  const maxAbs = Math.max(1, ...points.map((point) => Math.abs(point.value)));
  return <div className="rounded-xl border border-cs2-border-subtle p-3"><div className="mb-2 text-[10px] text-cs2-text-muted">经济差：队伍 {teamIds[0] || "A"} − 队伍 {teamIds[1] || "B"}</div>{points.length > 1 ? <svg viewBox="0 0 800 220" className="h-auto w-full" role="img" aria-label="双方经济差时间线"><path d="M35 100H790" fill="none" stroke="rgba(255,255,255,.2)"/><path d="M35 10V190" fill="none" stroke="rgba(255,255,255,.12)"/><polyline fill="none" stroke="#22d3ee" strokeWidth="3" points={points.map((point) => `${35 + point.time / maxTime * 755},${100 - point.value / maxAbs * 85}`).join(" ")}/></svg> : <p className="py-8 text-center text-xs text-cs2-text-muted">时间线帧不足，无法绘制经济差</p>}</div>;
}

const TIMELINE_METRICS = [
  ["totalGold", "总金币"], ["currentGold", "当前金币"], ["level", "等级"], ["xp", "经验"],
  ["cs", "补刀"], ["damageDealt", "造成伤害"], ["damageTaken", "承受伤害"],
];

function participantTimelineValue(stats, metric) {
  if (metric === "cs") return Number(stats.minionsKilled || 0) + Number(stats.jungleMinionsKilled || 0);
  if (metric === "damageDealt") return Number(stats.damageStats?.totalDamageDealt || 0);
  if (metric === "damageTaken") return Number(stats.damageStats?.totalDamageTaken || 0);
  return Number(stats[metric] || 0);
}

function PlayerStatsTimeline({ details, participants, streamerMode, useAliases }) {
  const ids = (details?.participants || []).map((player) => Number(player.participant_id)).filter(Boolean);
  const [participantId, setParticipantId] = useState(ids[0] || 1);
  const [metric, setMetric] = useState("totalGold");
  const rows = (details?.frames || []).map((frame) => ({ time: Number(frame.timestamp || 0), value: participantTimelineValue(frame.participant_frames?.[String(participantId)] || {}, metric) }));
  const maxTime = Math.max(1, ...rows.map((point) => point.time));
  const maxValue = Math.max(1, ...rows.map((point) => point.value));
  return <div className="rounded-xl border border-cs2-border-subtle p-3"><div className="mb-3 flex flex-wrap gap-2"><select value={participantId} onChange={(event) => setParticipantId(Number(event.target.value))} className="rounded-lg border border-cs2-border bg-cs2-bg-input px-2 py-1.5 text-xs">{ids.map((id, index) => { const player = participants.find((row) => Number(row.participant_id) === id) || details.participants.find((row) => Number(row.participant_id) === id); return <option key={id} value={id}>{participantDisplay(player, index, streamerMode, useAliases)}</option>; })}</select><select value={metric} onChange={(event) => setMetric(event.target.value)} className="rounded-lg border border-cs2-border bg-cs2-bg-input px-2 py-1.5 text-xs">{TIMELINE_METRICS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>{rows.length > 1 ? <svg viewBox="0 0 800 220" className="h-auto w-full" role="img" aria-label="玩家属性时间线"><path d="M35 10V190H790" fill="none" stroke="rgba(255,255,255,.15)"/><g stroke="rgba(255,255,255,.06)">{[1,2,3].map((line) => <path key={line} d={`M35 ${10 + line * 45}H790`}/>)}</g><polyline fill="none" stroke="#a78bfa" strokeWidth="3" points={rows.map((point) => `${35 + point.time / maxTime * 755},${190 - point.value / maxValue * 175}`).join(" ")}/></svg> : <p className="py-8 text-center text-xs text-cs2-text-muted">该玩家没有足够的时间线数据</p>}</div>;
}

function TimelineTab({ details, participants, streamerMode, useAliases, hideStats = false }) {
  const [section, setSection] = useState("difference");
  return <section className="space-y-3 text-xs">{hideStats ? null : <div className="grid gap-2 sm:grid-cols-3"><Stat icon={MapIcon} label="数据源" value={String(details.source || "LCU").toUpperCase()}/><Stat label="时间线帧" value={formatNumber(details.frame_count)}/><Stat label="事件数量" value={formatNumber(details.event_count)}/></div>}<div className="flex flex-wrap gap-1">{[["difference", "经济差"], ["teams", "队伍经济"], ["player", "玩家属性"]].map(([id, label]) => <button key={id} type="button" onClick={() => setSection(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${section === id ? "bg-violet-400/15 text-violet-200" : "text-cs2-text-muted hover:bg-white/5"}`}>{label}</button>)}</div>{section === "difference" ? <DifferenceTimeline details={details}/> : null}{section === "teams" ? <TeamGoldTimeline details={details}/> : null}{section === "player" ? <PlayerStatsTimeline details={details} participants={participants} streamerMode={streamerMode} useAliases={useAliases}/> : null}</section>;
}

export default function LeagueDetailedMatchCard({ match, streamerMode = false, useAliases = false, onOpenPlayer, onError }) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState("summary");
  const [matchDetails, setMatchDetails] = useState(null);
  const [perkMap, setPerkMap] = useState(new Map());
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
    if (nextTab === "runes" && !perkMap.size) {
      try {
        const catalog = await fetchLeagueLoadoutCatalog();
        setPerkMap(new Map((catalog.perks || catalog.styles?.flatMap((style) => style.perks || []) || []).map((perk) => [Number(perk.id), perk])));
      } catch (error) {
        onError?.(error?.response?.data?.detail || "符文目录读取失败");
      }
    }
    if (!["events", "builds", "timeline"].includes(nextTab) || matchDetails || detailsBusy || !match.game_id) return;
    setDetailsBusy(true);
    try { setMatchDetails(await fetchLeagueMatchDetails(match.game_id, match.source || "auto")); }
    catch (error) { onError?.(error?.response?.data?.detail || "对局详情读取失败"); }
    finally { setDetailsBusy(false); }
  };

  const GoldTimeline = ({ details }) => <TimelineTab details={details} participants={participants} streamerMode={streamerMode} useAliases={useAliases} hideStats/>;

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
      {tab === "details" ? <RawDetailsTab match={match} participants={participants} streamerMode={streamerMode} useAliases={useAliases}/> : null}
      {tab === "runes" ? <RunesTab participants={participants} perkMap={perkMap} streamerMode={streamerMode} useAliases={useAliases}/> : null}
      {tab === "events" ? detailsBusy ? <p className="rounded-xl border border-cs2-border-subtle p-8 text-center text-xs text-cs2-text-muted">正在读取本局事件…</p> : matchDetails ? <EventsTab details={matchDetails} participants={participants} mapId={match.map_id} streamerMode={streamerMode} useAliases={useAliases}/> : <p className="text-xs text-cs2-text-muted">此对局没有可用事件数据。</p> : null}
      {tab === "builds" ? detailsBusy ? <p className="rounded-xl border border-cs2-border-subtle p-8 text-center text-xs text-cs2-text-muted">正在读取出装过程…</p> : matchDetails ? <BuildsTab details={matchDetails} participants={participants} streamerMode={streamerMode} useAliases={useAliases}/> : <p className="text-xs text-cs2-text-muted">此对局没有可用出装过程。</p> : null}
      {tab === "timeline" ? <section className="space-y-3 text-xs">{detailsBusy ? <p className="rounded-xl border border-cs2-border-subtle p-8 text-center text-cs2-text-muted">正在读取本局时间线…</p> : matchDetails ? <><div className="grid gap-2 sm:grid-cols-3"><Stat icon={MapIcon} label="数据源" value={String(matchDetails.source || match.source || "LCU").toUpperCase()}/><Stat label="时间线帧" value={formatNumber(matchDetails.frame_count)}/><Stat label="事件数量" value={formatNumber(matchDetails.event_count)}/></div><GoldTimeline details={matchDetails}/></> : <p className="text-cs2-text-muted">此对局暂时没有可用时间线。</p>}</section> : null}
    </div> : null}
  </article>;
}
