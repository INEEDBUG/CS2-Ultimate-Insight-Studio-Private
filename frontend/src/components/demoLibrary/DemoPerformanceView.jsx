import { useState } from "react";
import { AlertTriangle, CalendarClock, ChevronRight, Crosshair, ExternalLink, Loader2, RefreshCw, Trophy } from "lucide-react";
import { getSteamPlayerAvatarUrl } from "../../api/api.js";
import { desktopBridge } from "../../desktop/desktopBridge.js";
import { buildMatchRatingPro } from "../../utils/playerRatings.js";

function steamProfileUrl(steamId64) {
  const value = String(steamId64 || "").trim();
  return /^\d{17}$/.test(value) ? `https://steamcommunity.com/profiles/${value}` : "";
}

function SteamPlayerAvatar({ player, teamKey }) {
  const [failed, setFailed] = useState(false);
  const steamId64 = player.steam_id64 || player.steamid64;
  const tone = teamKey === "a" ? "bg-sky-400/15 text-sky-300" : "bg-emerald-400/15 text-emerald-300";
  return (
    <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-[10px] font-black ${tone}`}>
      {String(player.name || "?").slice(0, 1).toUpperCase()}
      {steamId64 && !failed ? <img src={getSteamPlayerAvatarUrl(steamId64)} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" alt={`${player.name} 的 Steam 头像`} /> : null}
    </span>
  );
}

function formatDate(value, withTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date);
}

function representativePlayer(row, expectedPlayers) {
  const players = row.players || [];
  const wanted = (expectedPlayers || []).map((value) => String(value).trim().toLowerCase()).filter(Boolean);
  return players.find((player) => wanted.some((name) => String(player.name || "").toLowerCase().includes(name)))
    || players.find((player) => player.name === row.primary_target)
    || [...players].sort((a, b) => Number(b.kills || 0) - Number(a.kills || 0))[0]
    || null;
}

function resultFor(row, player) {
  if (!player) return { label: "完赛", tone: "text-cs2-text-secondary", bg: "bg-cs2-bg-input" };
  const scoreA = Number(row.team_a_score || 0);
  const scoreB = Number(row.team_b_score || 0);
  if (scoreA === scoreB) return { label: "平局", tone: "text-amber-300", bg: "bg-amber-500/10" };
  const playerOnA = Number(player.team_number ?? player.team) === 2;
  const won = playerOnA ? scoreA > scoreB : scoreB > scoreA;
  return won
    ? { label: "胜利", tone: "text-emerald-300", bg: "bg-emerald-500/10" }
    : { label: "失败", tone: "text-rose-300", bg: "bg-rose-500/10" };
}

function RoundStrip({ rounds }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1" aria-label="回合胜负">
      {(rounds || []).map((round) => (
        <span
          key={round.round_number}
          title={`第 ${round.round_number} 回合 · ${round.winner_team_key === "a" ? "队伍 A" : "队伍 B"} 获胜`}
          className={`flex h-6 w-6 items-center justify-center rounded border font-mono text-[9px] font-bold ${
            round.winner_team_key === "a"
              ? "border-sky-400/25 bg-sky-400/12 text-sky-300"
              : "border-amber-400/25 bg-amber-400/12 text-amber-300"
          }`}
        >
          {round.round_number}
        </span>
      ))}
    </div>
  );
}

function TeamTable({ name, score, teamKey, players, ratings, heroName, culpritName }) {
  const tone = teamKey === "a" ? "sky" : "emerald";
  return (
    <section className="overflow-hidden rounded-xl border border-cs2-border bg-cs2-bg-card/70">
      <div className={`flex items-center justify-between border-b px-4 py-2.5 ${tone === "sky" ? "border-sky-400/20 bg-sky-400/10" : "border-emerald-400/20 bg-emerald-400/10"}`}>
        <div>
          <p className={`text-[10px] font-black uppercase tracking-[0.16em] ${tone === "sky" ? "text-sky-300" : "text-emerald-300"}`}>{name || `队伍 ${teamKey.toUpperCase()}`}</p>
          <p className="mt-0.5 text-[9px] text-cs2-text-muted">{players.length} 名玩家 · 解析记分板</p>
        </div>
        <span className="font-mono text-2xl font-black text-cs2-text-primary">{score ?? 0}</span>
      </div>
      <div className="grid grid-cols-[minmax(150px,1.5fr)_74px_58px_58px_66px_66px] border-b border-cs2-border/70 px-3 py-2 text-[8px] font-black uppercase tracking-wider text-cs2-text-muted">
        <span>玩家</span><span className="text-center">K / D / A</span><span className="text-center">ADR</span><span className="text-center">KAST</span><span className="text-center">RP 2.0</span><span className="text-center">RP 3.0</span>
      </div>
      <div className="divide-y divide-cs2-border/65">
        {players.map((player) => {
          const rating = ratings.get(player.name) || {};
          const hero = player.name === heroName;
          const culprit = player.name === culpritName;
          const profileUrl = steamProfileUrl(player.steam_id64 || player.steamid64);
          const openProfile = () => {
            if (!profileUrl) return;
            if (desktopBridge?.openExternal) void desktopBridge.openExternal(profileUrl);
            else window.open(profileUrl, "_blank", "noopener,noreferrer");
          };
          return (
            <div key={player.name} className={`grid grid-cols-[minmax(150px,1.5fr)_74px_58px_58px_66px_66px] items-center px-3 py-2.5 ${hero ? "bg-emerald-400/[0.08]" : culprit ? "bg-rose-400/[0.08]" : ""}`}>
              <div className="flex min-w-0 items-center gap-2">
                <SteamPlayerAvatar player={player} teamKey={teamKey} />
                <div className="min-w-0">
                  {profileUrl ? (
                    <button type="button" onClick={openProfile} aria-label={`打开 ${player.name} 的 Steam 主页`} title={`打开 ${player.name} 的 Steam 主页`} className="group/profile flex max-w-full items-center gap-1 text-left text-[10px] font-bold text-cs2-text-primary transition-colors duration-150 hover:text-cs2-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs2-accent/50">
                      <span className="truncate">{player.name}</span><ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity duration-150 group-hover/profile:opacity-100" />
                    </button>
                  ) : <p className="truncate text-[10px] font-bold text-cs2-text-primary">{player.name}</p>}
                  {hero ? <p className="flex items-center gap-1 text-[8px] font-bold text-emerald-300"><Trophy className="h-2.5 w-2.5" />队内英雄</p> : null}
                  {culprit ? <p className="flex items-center gap-1 text-[8px] font-bold text-rose-300"><AlertTriangle className="h-2.5 w-2.5" />队内战犯</p> : null}
                </div>
              </div>
              <span className="text-center font-mono text-[10px] font-bold text-cs2-text-primary">{player.kills}/{player.deaths}/{player.assists}</span>
              <span className="text-center font-mono text-[10px] text-cs2-text-secondary">{Number(player.adr || 0).toFixed(1)}</span>
              <span className="text-center font-mono text-[10px] text-cs2-text-secondary">{Number(player.kast || 0).toFixed(0)}%</span>
              <span className="text-center font-mono text-[11px] font-bold text-sky-300">{Number(rating.rating_pro_2 || 0).toFixed(2)}</span>
              <span className="text-center font-mono text-[11px] font-black text-emerald-300">{Number(rating.rating_pro_3 || 0).toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function DemoPerformanceView({
  rows,
  selectedId,
  onSelect,
  detail,
  detailLoading,
  expectedPlayers,
  onOpenAnalysis,
  onSyncMatchTimes,
  syncingMatchTimes,
}) {
  const workspace = detail?.result?.analysis_workspace || null;
  const ratingModel = workspace?.players?.length ? buildMatchRatingPro(workspace) : { players: [], hero: null, culprit: null, team_verdicts: {} };
  const ratings = new Map((ratingModel.players || []).map((item) => [item.name, item]));
  const teamA = (workspace?.players || []).filter((player) => player.team_key === "a");
  const teamB = (workspace?.players || []).filter((player) => player.team_key === "b");

  return (
    <div className="grid h-full min-h-[520px] grid-cols-[270px_minmax(0,1fr)] overflow-hidden">
      <aside className="flex min-h-0 flex-col border-r border-cs2-border bg-cs2-bg-input/20">
        <div className="border-b border-cs2-border px-3 py-3">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-cs2-accent">Recent matches</p>
          <div className="mt-1 flex items-center justify-between"><h2 className="text-sm font-black text-cs2-text-primary">近期战绩</h2><span className="font-mono text-[9px] text-cs2-text-muted">{rows.length} 场</span></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
          {rows.map((row) => {
            const player = representativePlayer(row, expectedPlayers);
            const result = resultFor(row, player);
            const active = Number(row.id) === Number(selectedId);
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelect(row.id)}
                className={`group mb-1.5 w-full overflow-hidden rounded-lg border text-left transition-[border-color,background-color,transform] duration-150 ease-out active:scale-[0.985] ${active ? "border-cs2-accent/50 bg-cs2-accent/[0.09]" : "border-transparent bg-cs2-bg-card/55 hover:border-cs2-border hover:bg-cs2-bg-hover"}`}
              >
                <div className="relative px-3 py-2.5">
                  <img src={`/images/maps/${row.map_name || "unknown"}.webp`} onError={(event) => { event.currentTarget.src = "/images/maps/thumbnail_unknown.webp"; }} className="absolute inset-0 h-full w-full object-cover opacity-[0.12]" alt="" />
                  <div className="relative">
                    <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-black uppercase text-cs2-text-primary">{String(row.map_name || "unknown").replace("de_", "")}</p><p className="mt-0.5 text-[8px] uppercase tracking-wider text-cs2-text-muted">{row.source || "Local Demo"}</p></div><div className="text-right"><p className={`text-[10px] font-black ${result.tone}`}>{result.label}</p><p className="mt-0.5 font-mono text-[9px] text-cs2-text-secondary">{row.team_a_score ?? 0} : {row.team_b_score ?? 0}</p></div></div>
                    <div className="mt-2 flex items-end justify-between gap-2"><div>{player ? <><p className="max-w-[140px] truncate text-[9px] font-semibold text-cs2-text-secondary">{player.name}</p><p className="font-mono text-[10px] font-bold text-cs2-text-primary">{player.kills}/{player.deaths}/{player.assists}</p></> : <p className="text-[9px] text-cs2-text-muted">等待玩家索引</p>}</div><div className="text-right">{row.match_date ? <><p className="font-mono text-[10px] font-bold text-cs2-text-primary">{formatDate(row.match_date)}</p><p className="text-[7px] font-bold text-emerald-300">Steam 比赛时间</p></> : <><p className="text-[9px] font-bold text-amber-300">比赛时间未知</p><p className="text-[7px] text-cs2-text-muted">入库 {formatDate(row.added_at)}</p></>}</div></div>
                    {active ? <ChevronRight className="absolute -right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-cs2-accent" /> : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="min-h-0 overflow-y-auto p-4 custom-scrollbar">
        {detailLoading ? <div className="flex h-full min-h-[420px] items-center justify-center gap-2 text-sm text-cs2-text-muted"><Loader2 className="h-5 w-5 animate-spin text-cs2-accent" />正在载入比赛记分板</div> : !detail ? <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-cs2-text-muted">选择左侧比赛查看完整战绩</div> : !workspace?.players?.length ? <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-center"><Crosshair className="h-8 w-8 text-cs2-text-muted" /><div><p className="text-sm font-bold text-cs2-text-primary">这场 Demo 还没有完整比赛数据</p><p className="mt-1 text-[10px] text-cs2-text-muted">完成一次解析后即可显示双方记分板、Rating Pro 和回合胜负。</p></div><button type="button" onClick={() => onOpenAnalysis(detail.id)} className="rounded-md bg-cs2-accent px-3 py-2 text-[10px] font-bold text-cs2-text-on-accent transition-transform duration-150 ease-out active:scale-[0.97]">前往解析分析</button></div> : <div className="space-y-3">
          <header className="rounded-xl border border-cs2-border bg-cs2-bg-card/75 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-cs2-accent">Match scoreboard</p><h2 className="mt-1 text-xl font-black uppercase text-cs2-text-primary">{String(workspace.map_name || detail.map_name || "unknown").replace("de_", "")}</h2><div className="mt-1.5 flex flex-wrap items-center gap-3 text-[9px] text-cs2-text-muted"><span>{detail.source || "Local Demo"}</span><span>·</span><span>{workspace.rounds?.length || detail.total_rounds || 0} 回合</span><span>·</span>{detail.match_date ? <span className="flex items-center gap-1 text-emerald-300"><CalendarClock className="h-3 w-3" />{formatDate(detail.match_date, true)} · Steam GC</span> : <span className="flex items-center gap-1 text-amber-300"><CalendarClock className="h-3 w-3" />真实比赛时间未知（入库 {formatDate(detail.added_at, true)}）</span>}</div></div><div className="flex items-center gap-2"><button type="button" disabled={syncingMatchTimes} onClick={onSyncMatchTimes} className="inline-flex items-center gap-1.5 rounded-md border border-cs2-border bg-cs2-bg-hover px-2.5 py-1.5 text-[9px] font-bold text-cs2-text-secondary transition-[border-color,transform] duration-150 ease-out hover:border-cs2-accent/40 active:scale-[0.97] disabled:opacity-50">{syncingMatchTimes ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}同步真实比赛时间</button><button type="button" onClick={() => onOpenAnalysis(detail.id)} className="rounded-md bg-cs2-accent px-2.5 py-1.5 text-[9px] font-bold text-cs2-text-on-accent transition-transform duration-150 ease-out active:scale-[0.97]">打开完整分析</button></div></div>
            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-lg border border-cs2-border bg-cs2-bg-input/25 p-3"><div className="text-right"><p className="text-[9px] font-bold text-sky-300">{workspace.team_a_name || "队伍 A"}</p></div><div className="font-mono text-3xl font-black"><span className="text-sky-300">{workspace.team_a_score ?? detail.team_a_score ?? 0}</span><span className="mx-2 text-cs2-text-muted">:</span><span className="text-emerald-300">{workspace.team_b_score ?? detail.team_b_score ?? 0}</span></div><div><p className="text-[9px] font-bold text-emerald-300">{workspace.team_b_name || "队伍 B"}</p></div></div>
            <div className="mt-3"><RoundStrip rounds={workspace.rounds} /></div>
          </header>
          <TeamTable name={workspace.team_a_name} score={workspace.team_a_score} teamKey="a" players={teamA} ratings={ratings} heroName={ratingModel.team_verdicts?.a?.hero?.name} culpritName={ratingModel.team_verdicts?.a?.culprit?.name} />
          <TeamTable name={workspace.team_b_name} score={workspace.team_b_score} teamKey="b" players={teamB} ratings={ratings} heroName={ratingModel.team_verdicts?.b?.hero?.name} culpritName={ratingModel.team_verdicts?.b?.culprit?.name} />
          <p className="px-1 text-[8px] leading-4 text-cs2-text-muted">Est. R2 使用公开社区 Estimated HLTV Rating 2.0 估算式（通常约 ±0.01），RP3 为本地透明模型；均不是 HLTV 官方评分。比赛日期仅在 Steam Game Coordinator 返回 `matchtime` 时标记为真实比赛时间。</p>
        </div>}
      </main>
    </div>
  );
}
