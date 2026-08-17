import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, Users } from "lucide-react";
import { fetchLeagueLabStatus, fetchLeagueOngoingGame } from "../../api/leagueLabApi";
import { getLeagueChampionIconUrl, getLeagueProfileIconUrl } from "../../api/api";
import { maskLeagueName } from "../../utils/leagueStreamerMode";
import LeagueDetailedMatchCard from "./LeagueDetailedMatchCard";

const TAG_TONES = {
  positive: "bg-emerald-400/10 text-emerald-200",
  negative: "bg-rose-400/10 text-rose-200",
  warning: "bg-amber-400/10 text-amber-200",
  info: "bg-cyan-400/10 text-cyan-200",
};

const QUEUE_LABELS = {
  RANKED_SOLO_5x5: "单双排",
  RANKED_FLEX_SR: "灵活组排",
  RANKED_TFT: "云顶之弈",
  RANKED_TFT_DOUBLE_UP: "双人作战",
};

function objectValue(value) {
  return value && typeof value === "object" ? value : {};
}

function boolValue(value) {
  return value === true || value === 1 || value === "true";
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMetric(value, digits = 0) {
  if (value == null || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  return digits > 0 ? parsed.toFixed(digits) : parsed.toLocaleString("zh-CN");
}

function formatWinRate(wins, matches) {
  const total = numberValue(matches);
  return total > 0 ? `${Math.round(numberValue(wins) / total * 100)}%` : "—";
}

function historyRows(player) {
  const candidates = [
    player?.recent_matches,
    player?.match_history,
    player?.matches,
    player?.games?.games,
    player?.games,
  ];
  return candidates.find((value) => Array.isArray(value)) || [];
}

function unwrapHistoryGame(value) {
  const row = objectValue(value);
  if (row.json && typeof row.json === "object") return row.json;
  if (row.game && typeof row.game === "object") return row.game;
  return row;
}

function statValue(row, key, fallback = 0) {
  const stats = objectValue(row?.stats);
  return stats[key] ?? row?.[key] ?? fallback;
}

function normalizeHistoryMatches(player) {
  const puuid = String(player?.puuid || "");
  return historyRows(player).map((entry, index) => {
    const game = unwrapHistoryGame(entry);
    if (game.game_id != null || game.gameId == null && !Array.isArray(game.participants)) {
      if (game.game_id == null) return null;
      return { ...game, participant_puuid: game.participant_puuid || puuid, _history_index: index };
    }
    const rows = Array.isArray(game.participants) ? game.participants : [];
    if (!rows.length) return null;
    const identities = Array.isArray(game.participantIdentities) ? game.participantIdentities : [];
    const identityById = new Map(identities.map((identity) => [String(identity?.participantId), objectValue(identity)]));
    const targetIdentity = identities.find((identity) => String(identity?.player?.puuid || identity?.puuid || "") === puuid);
    const targetId = targetIdentity?.participantId;
    const target = rows.find((row) => String(row?.puuid || "") === puuid || targetId != null && String(row?.participantId) === String(targetId));
    if (!target) return null;
    const normalizeParticipant = (row) => {
      const identity = identityById.get(String(row?.participantId)) || {};
      const identityPlayer = objectValue(identity.player);
      const championId = numberValue(row?.championId);
      return {
        participant_id: row?.participantId,
        puuid: row?.puuid || identityPlayer.puuid || identity.puuid,
        game_name: row?.riotIdGameName || row?.gameName || row?.summonerName || identityPlayer.gameName || identityPlayer.displayName || "",
        tag_line: row?.riotIdTagline || row?.tagLine || identityPlayer.tagLine || "",
        profile_icon_id: row?.profileIcon || row?.profileIconId || identityPlayer.profileIcon,
        team_id: row?.teamId,
        champion_id: championId,
        champion_name: row?.championName || row?.champion_name || (championId ? `英雄 ${championId}` : "未知英雄"),
        position: row?.teamPosition || row?.timeline?.lane || "",
        role: row?.individualPosition || row?.timeline?.role || "",
        spell1_id: row?.spell1Id ?? row?.summoner1Id,
        spell2_id: row?.spell2Id ?? row?.summoner2Id,
        kills: statValue(row, "kills"),
        deaths: statValue(row, "deaths"),
        assists: statValue(row, "assists"),
        win: boolValue(statValue(row, "win", row?.win)),
        gold: statValue(row, "goldEarned", row?.gold),
        level: statValue(row, "champLevel", row?.level),
        gold_spent: statValue(row, "goldSpent", row?.gold_spent),
        cs: numberValue(statValue(row, "totalMinionsKilled")) + numberValue(statValue(row, "neutralMinionsKilled")),
        damage: statValue(row, "totalDamageDealtToChampions", row?.damage),
        damage_taken: statValue(row, "totalDamageTaken", row?.damage_taken),
        healing: statValue(row, "totalHeal", row?.healing),
        time_ccing: statValue(row, "totalTimeCCDealt", row?.time_ccing),
        tower_damage: statValue(row, "damageDealtToTurrets", row?.tower_damage),
        vision_score: statValue(row, "visionScore", row?.vision_score),
        items: row?.items || Array.from({ length: 7 }, (_, itemIndex) => statValue(row, `item${itemIndex}`, null)).filter((value) => value != null && numberValue(value) > 0),
        perks: row?.perks || Array.from({ length: 6 }, (_, perkIndex) => statValue(row, `perk${perkIndex}`, null)).filter((value) => value != null && numberValue(value) > 0),
        augments: row?.augments || Array.from({ length: 6 }, (_, augmentIndex) => statValue(row, `playerAugment${augmentIndex + 1}`, null)).filter((value) => value != null && numberValue(value) > 0),
        challenges: row?.challenges || objectValue(row?.stats).challenges || {},
        raw_stats: row?.raw_stats || {},
      };
    };
    const participants = rows.map(normalizeParticipant);
    const targetParticipant = participants.find((row) => String(row.puuid || "") === puuid) || normalizeParticipant(target);
    return {
      game_id: game.gameId ?? game.game_id,
      played_at: game.gameCreationDate ?? game.gameCreation ?? game.gameStartTimestamp ?? game.played_at,
      duration_seconds: game.gameDuration ?? game.duration_seconds,
      game_mode: game.gameMode ?? game.game_mode,
      game_type: game.gameType ?? game.game_type,
      game_version: game.gameVersion ?? game.game_version,
      map_id: game.mapId ?? game.map_id,
      queue_id: game.queueId ?? game.queue_id,
      participant_puuid: puuid || targetParticipant.puuid,
      team_id: targetParticipant.team_id,
      participants,
      ...targetParticipant,
      _history_index: index,
    };
  }).filter(Boolean);
}

function rankedRows(ranked) {
  const value = objectValue(ranked);
  let rows = [];
  if (Array.isArray(value.queues)) rows = value.queues;
  else if (value.queueMap && typeof value.queueMap === "object") rows = Object.entries(value.queueMap).map(([queueType, row]) => ({ ...objectValue(row), queueType }));
  else if (Array.isArray(value.rankedStats)) rows = value.rankedStats;
  else if (value.tier || value.rank || value.division || value.leaguePoints != null) rows = [value];
  return rows.map((row) => {
    const queueType = row.queueType || row.queue || row.queueId || row.queue_type;
    const tier = row.tier || row.rankTier || row.division;
    const rank = row.rank || row.divisionRank || row.subTier;
    const wins = row.wins ?? row.win;
    const losses = row.losses ?? row.lose;
    const leaguePoints = row.leaguePoints ?? row.lp;
    if (!queueType && !tier && wins == null && losses == null && leaguePoints == null) return null;
    return { queueType, tier, rank, wins, losses, leaguePoints };
  }).filter(Boolean).slice(0, 4);
}

function Metric({ label, value, title }) {
  return <span title={title} className="rounded-lg bg-black/10 px-2 py-1.5 text-[10px] text-cs2-text-muted"><span className="block">{label}</span><b className="mt-0.5 block text-sm text-cs2-text-primary">{value}</b></span>;
}

function PlayerDetails({ player, privacy, recentMatches, onOpenPlayer, onError }) {
  const recent = player.recent || {};
  const usage = player.champion_usage || {};
  const ranks = rankedRows(player.ranked);
  const tags = Array.isArray(player.performance_tags) ? player.performance_tags : [];
  return <div data-testid="player-details" className="border-t border-cs2-border-subtle px-3 pb-3 pt-3">
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="近期样本" value={`${formatMetric(recent.matches)} 场`} title="客户端返回的近期战绩样本数。"/>
      <Metric label="近期胜率" value={formatWinRate(recent.wins, recent.matches)} title="近期样本中的胜场占比。"/>
      <Metric label="平均 KDA" value={formatMetric(recent.average_kda, 2)} title="近期样本的平均 (击杀+助攻)/死亡。"/>
      <Metric label="Akari Score" value={formatMetric(recent.akari_score, 2)} title="后端根据已分析样本计算的 Akari 聚合分。"/>
      <Metric label="已分析详情" value={`${formatMetric(recent.details_analyzed)} 场`} title="参与标签和评分计算的近期对局数量。"/>
      <Metric label="当前分路" value={player.position || "—"} title="客户端当前返回的分路。"/>
    </div>
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <section className="rounded-xl border border-cs2-border-subtle bg-white/[.02] p-3">
        <h4 className="text-[11px] font-bold text-cs2-text-secondary">当前英雄使用</h4>
        {usage.mode === "mastery" ? <div className="mt-2 grid grid-cols-2 gap-2 text-xs"><Metric label="熟练度等级" value={formatMetric(usage.mastery_level)} title="客户端返回的英雄熟练度等级。"/><Metric label="熟练度点数" value={formatMetric(usage.mastery_points)} title="客户端返回的英雄熟练度点数。"/></div> : usage.mode === "recent" ? <div className="mt-2 grid grid-cols-3 gap-2 text-xs"><Metric label="使用场次" value={formatMetric(usage.matches)} title="近期样本中使用当前英雄的场次。"/><Metric label="胜率" value={formatWinRate(usage.wins, usage.matches)} title="近期样本中使用当前英雄的胜率。"/><Metric label="平均 KDA" value={formatMetric(usage.average_kda, 2)} title="近期样本中使用当前英雄的平均 KDA。"/></div> : <p className="mt-2 text-[11px] text-cs2-text-muted">当前设置未返回英雄使用样本。</p>}
      </section>
      <section className="rounded-xl border border-cs2-border-subtle bg-white/[.02] p-3">
        <h4 className="text-[11px] font-bold text-cs2-text-secondary">排位信息</h4>
        {ranks.length ? <div className="mt-2 space-y-1.5">{ranks.map((rank, index) => <div key={`${rank.queueType || "rank"}-${index}`} className="flex items-center justify-between gap-2 text-[11px]"><span className="text-cs2-text-muted">{QUEUE_LABELS[rank.queueType] || rank.queueType || "排位"}</span><span className="text-right"><b>{[rank.tier, rank.rank].filter(Boolean).join(" ") || "未定级"}</b>{rank.leaguePoints != null ? <span className="ml-2 text-cyan-200">{formatMetric(rank.leaguePoints)} LP</span> : null}{rank.wins != null || rank.losses != null ? <small className="ml-2 text-cs2-text-muted">{formatMetric(rank.wins)}胜 / {formatMetric(rank.losses)}负</small> : null}</span></div>)}</div> : <p className="mt-2 text-[11px] text-cs2-text-muted">当前 payload 没有排位明细。</p>}
      </section>
    </div>
    <section className="mt-3 rounded-xl border border-cs2-border-subtle bg-white/[.02] p-3">
      <h4 className="text-[11px] font-bold text-cs2-text-secondary">标签解释</h4>
      {tags.length ? <div data-testid="player-tag-explanations" className="mt-2 space-y-1.5">{tags.map((tag) => <div key={tag.id || tag.label} title={tag.title || tag.label} className="flex items-start gap-2 text-[11px]"><span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${TAG_TONES[tag.tone] || TAG_TONES.info}`}>{tag.label}</span><span className="text-cs2-text-muted">{tag.title || "客户端没有返回标签解释。"}</span></div>)}</div> : <p className="mt-2 text-[11px] text-cs2-text-muted">当前没有可解释的标签。</p>}
    </section>
    <section className="mt-3">
      <div className="mb-2 flex items-center justify-between gap-2"><h4 className="text-[11px] font-bold text-cs2-text-secondary">近期对局</h4><span className="text-[10px] text-cs2-text-muted">展开单局卡片后，事件/出装/时间线才会按需读取详情</span></div>
      {recentMatches.length ? <div data-testid="player-recent-matches" className="space-y-2">{recentMatches.map((match, index) => <LeagueDetailedMatchCard key={match.game_id || match._history_index || index} match={match} streamerMode={privacy.enabled} useAliases={privacy.aliases} onOpenPlayer={onOpenPlayer} onError={onError}/>)}</div> : <p className="rounded-xl border border-dashed border-cs2-border-subtle p-5 text-center text-[11px] text-cs2-text-muted">暂无可展示的近期对局；当前卡片只显示客户端已返回的聚合指标。</p>}
    </section>
  </div>;
}

function PlayerCard({ player, index, data, privacy, onOpenPlayer, onError }) {
  const [expanded, setExpanded] = useState(false);
  const recent = player.recent || {};
  const usage = player.champion_usage || {};
  const jungle = player.jungle_analysis || {};
  const match = player.match_stats || {};
  const recentMatches = normalizeHistoryMatches(player);
  const playerName = privacy.enabled
    ? maskLeagueName(player.summoner?.gameName, index, privacy.aliases, player.puuid)
    : (player.summoner?.gameName || player.champion_name || `玩家 ${index + 1}`);
  const cardBorder = data?.show_match_history_item_border ? "border-cyan-400/30" : "border-cs2-border-subtle";
  const usageLine = usage.mode === "mastery"
    ? `${player.champion_name || "当前英雄"} · 熟练度 ${usage.mastery_level || 0} / ${numberValue(usage.mastery_points).toLocaleString()} 点`
    : usage.mode === "none"
      ? `近 ${recent.matches || 0} 场胜率 ${recent.matches ? Math.round(recent.wins / recent.matches * 100) : 0}% · KDA ${recent.average_kda || 0}`
      : `近 ${recent.matches || 0} 场胜率 ${recent.matches ? Math.round(recent.wins / recent.matches * 100) : 0}% · ${player.champion_name || "当前英雄"} ${usage.matches || 0} 场 / KDA ${usage.average_kda || 0}`;
  return <article className={`overflow-hidden rounded-xl border ${cardBorder}`}>
    <div className="flex items-start gap-3 p-3">
      <span className="relative h-11 w-11 shrink-0">
        {player.champion_id ? <img src={getLeagueChampionIconUrl(player.champion_id)} alt={player.champion_name || "英雄"} className="h-11 w-11 rounded-lg bg-emerald-400/10 object-cover"/> : player.summoner?.profileIconId != null ? <img src={getLeagueProfileIconUrl(player.summoner.profileIconId)} alt="召唤师头像" className="h-11 w-11 rounded-lg bg-emerald-400/10 object-cover"/> : <span className="grid h-11 w-11 place-items-center rounded-lg bg-emerald-400/10 text-xs text-emerald-300">?</span>}
        {player.champion_id && player.summoner?.profileIconId != null ? <img src={getLeagueProfileIconUrl(player.summoner.profileIconId)} alt="召唤师头像" className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-cs2-bg-elevated object-cover"/> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><button type="button" disabled={!player.puuid} aria-label={`打开 ${playerName} 玩家中心`} title="打开玩家中心" onClick={() => player.puuid && onOpenPlayer(player.puuid)} className="truncate text-left hover:text-emerald-200 disabled:cursor-default"><b>{playerName}</b></button>{player.position ? <em className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-bold not-italic text-cyan-300">{player.position}</em> : null}{player.premade_group ? <em className="rounded bg-violet-400/15 px-1.5 py-0.5 text-[10px] font-bold not-italic text-violet-300">组排 {String.fromCharCode(64 + player.premade_group)}</em> : null}</span>
        {data?.historical_preview
          ? <span className="mt-1 block text-[11px] text-cs2-text-muted">本局 {match.kills || 0}/{match.deaths || 0}/{match.assists || 0} · KDA {match.kda || 0} · 伤害 {match.damage || 0}</span>
          : <span className="mt-1 block text-[11px] text-cs2-text-muted">{usageLine} · Akari {recent.akari_score || 0}</span>}
        {(player.performance_tags || []).length ? <span className="mt-2 flex flex-wrap gap-1">{player.performance_tags.map((tag) => <em key={tag.id} title={tag.title || tag.label} className={`rounded px-1.5 py-0.5 text-[9px] font-semibold not-italic ${TAG_TONES[tag.tone] || TAG_TONES.info}`}>{tag.label}</em>)}</span> : null}
        {jungle.games_analyzed > 0 ? <span className="mt-1 block text-[11px] leading-4 text-amber-200">打野画像：{jungle.draft}</span> : null}
        {!privacy.enabled ? <span className="mt-1 block text-xs text-emerald-300">{player.tag?.label || "未添加本地标签"}</span> : null}
      </span>
      <button type="button" aria-label={expanded ? `收起 ${playerName} 详情` : `展开 ${playerName} 详情`} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-cs2-border-subtle text-cs2-text-muted hover:bg-white/5 hover:text-white">{expanded ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}</button>
    </div>
    {expanded ? <PlayerDetails player={player} privacy={privacy} recentMatches={recentMatches} onOpenPlayer={onOpenPlayer} onError={onError}/> : null}
  </article>;
}

function TeamSection({ team, players, data, privacy, onOpenPlayer, onError }) {
  const samples = players.filter((player) => Number(player.recent?.matches || 0) > 0);
  const teamWinRate = samples.length
    ? samples.reduce((sum, player) => sum + Number(player.recent?.wins || 0) / Number(player.recent.matches), 0) / samples.length
    : null;
  return <section className="rounded-2xl border border-cs2-border bg-cs2-bg-elevated">
    <header className="flex items-center justify-between border-b border-cs2-border px-4 py-3 text-sm font-bold">
      <span>{team === "LOBBY" ? "当前房间" : `队伍 ${team}`}</span>
      {teamWinRate != null ? <span className={`text-xs ${teamWinRate >= .5 ? "text-emerald-300" : "text-rose-300"}`}>近期平均胜率 {Math.round(teamWinRate * 100)}%</span> : null}
    </header>
    <div className="grid gap-2 p-3 md:grid-cols-2">
      {players.map((player, index) => <PlayerCard key={player.puuid || index} player={player} index={index} data={data} privacy={privacy} onOpenPlayer={onOpenPlayer} onError={onError}/>) }
    </div>
  </section>;
}

export default function LeagueOngoingGame({ streamerMode, useAliases, previewData = null, onExitPreview = () => {}, onOpenPlayer = () => {}, onError = () => {} }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [privacy, setPrivacy] = useState({ enabled: Boolean(streamerMode), aliases: Boolean(useAliases) });
  const load = async () => {
    setBusy(true);
    try {
      const [game, status] = await Promise.all([fetchLeagueOngoingGame(), fetchLeagueLabStatus()]);
      setData(game);
      setPrivacy({ enabled: streamerMode ?? Boolean(status?.settings?.streamer_mode_enabled), aliases: useAliases ?? Boolean(status?.settings?.streamer_mode_use_aliases) });
    } catch (error) {
      onError(error?.response?.data?.detail || "实时对局读取失败");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (previewData) { setData(previewData); return undefined; }
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [streamerMode, useAliases, previewData]);
  const grouped = (data?.players || []).reduce((out, row) => {
    const key = String(row.team || "未知队伍");
    (out[key] ??= []).push(row);
    return out;
  }, {});
  return <div className="space-y-4">
    <div className="flex items-center justify-between"><div><h2 className="font-bold"><Users className="mr-2 inline h-4 w-4"/>{data?.historical_preview ? `历史对局模拟 · Game ${data.game_id}` : "实时对局检测"}</h2><p className="mt-1 text-xs text-cs2-text-muted">{data?.historical_preview ? "只读重放历史阵容与结算数据，不会向客户端写入任何状态。" : data?.query_stage === "lobby" ? "房间阶段已开始分析当前队伍；进入英雄选择后会自动补全对手、英雄与分路。" : "读取当前 Gameflow 队伍，分析近期表现、当前英雄、组排关系和双方打野路线倾向。"}</p></div>{data?.historical_preview ? <button onClick={onExitPreview} className="rounded-xl border border-cs2-border px-3 py-2 text-xs">退出模拟</button> : <button onClick={load} className="rounded-xl border border-cs2-border px-3 py-2 text-xs"><RefreshCw className={`mr-1 inline h-4 w-4 ${busy ? "animate-spin" : ""}`}/>刷新</button>}</div>
    {!data?.available ? <div className="rounded-2xl border border-dashed border-cs2-border p-12 text-center text-sm text-cs2-text-muted">进入房间、英雄选择或游戏加载阶段后自动显示玩家</div> : null}
    {Object.entries(grouped).map(([team, players]) => <TeamSection key={team} team={team} players={players} data={data} privacy={privacy} onOpenPlayer={onOpenPlayer} onError={onError}/>) }
  </div>;
}
