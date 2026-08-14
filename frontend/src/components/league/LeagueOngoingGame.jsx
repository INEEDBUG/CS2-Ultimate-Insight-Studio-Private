import { useEffect, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { fetchLeagueLabStatus, fetchLeagueOngoingGame } from "../../api/leagueLabApi";
import { getLeagueChampionIconUrl, getLeagueProfileIconUrl } from "../../api/api";
import { maskLeagueName } from "../../utils/leagueStreamerMode";

const TAG_TONES = {
  positive: "bg-emerald-400/10 text-emerald-200",
  negative: "bg-rose-400/10 text-rose-200",
  warning: "bg-amber-400/10 text-amber-200",
  info: "bg-cyan-400/10 text-cyan-200",
};

function TeamSection({ team, players, data, privacy, onOpenPlayer }) {
  const samples = players.filter((player) => Number(player.recent?.matches || 0) > 0);
  const teamWinRate = samples.length
    ? samples.reduce((sum, player) => sum + Number(player.recent?.wins || 0) / Number(player.recent.matches), 0) / samples.length
    : null;
  return <section className="rounded-2xl border border-cs2-border bg-cs2-bg-elevated">
    <header className="flex items-center justify-between border-b border-cs2-border px-4 py-3 text-sm font-bold">
      <span>队伍 {team}</span>
      {teamWinRate != null ? <span className={`text-xs ${teamWinRate >= .5 ? "text-emerald-300" : "text-rose-300"}`}>近期平均胜率 {Math.round(teamWinRate * 100)}%</span> : null}
    </header>
    <div className="grid gap-2 p-3 md:grid-cols-2">
      {players.map((player, index) => {
        const recent = player.recent || {};
        const usage = player.champion_usage || {};
        const jungle = player.jungle_analysis || {};
        const match = player.match_stats || {};
        const playerName = privacy.enabled
          ? maskLeagueName(player.summoner?.gameName, index, privacy.aliases, player.puuid)
          : (player.summoner?.gameName || player.champion_name);
        return <button key={player.puuid || index} onClick={() => player.puuid && onOpenPlayer(player.puuid)} className="flex items-start gap-3 rounded-xl border border-cs2-border-subtle p-3 text-left hover:border-emerald-400/30">
          <span className="relative h-11 w-11 shrink-0">
            <img src={getLeagueChampionIconUrl(player.champion_id)} alt={player.champion_name || "英雄"} className="h-11 w-11 rounded-lg bg-emerald-400/10 object-cover"/>
            {player.summoner?.profileIconId != null ? <img src={getLeagueProfileIconUrl(player.summoner.profileIconId)} alt="召唤师头像" className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-cs2-bg-elevated object-cover"/> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2"><b className="truncate">{playerName}</b>{player.position ? <em className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-bold not-italic text-cyan-300">{player.position}</em> : null}{player.premade_group ? <em className="rounded bg-violet-400/15 px-1.5 py-0.5 text-[10px] font-bold not-italic text-violet-300">组排 {String.fromCharCode(64 + player.premade_group)}</em> : null}</span>
            {data?.historical_preview
              ? <span className="mt-1 block text-[11px] text-cs2-text-muted">本局 {match.kills || 0}/{match.deaths || 0}/{match.assists || 0} · KDA {match.kda || 0} · 伤害 {match.damage || 0}</span>
              : <span className="mt-1 block text-[11px] text-cs2-text-muted">近 {recent.matches || 0} 场胜率 {recent.matches ? Math.round(recent.wins / recent.matches * 100) : 0}% · {player.champion_name} {usage.matches || 0} 场 / KDA {usage.average_kda || 0}</span>}
            {(player.performance_tags || []).length ? <span className="mt-2 flex flex-wrap gap-1">{player.performance_tags.map((tag) => <em key={tag.id} className={`rounded px-1.5 py-0.5 text-[9px] font-semibold not-italic ${TAG_TONES[tag.tone] || TAG_TONES.info}`}>{tag.label}</em>)}</span> : null}
            {jungle.games_analyzed > 0 ? <span className="mt-1 block text-[11px] leading-4 text-amber-200">打野画像：{jungle.draft}</span> : null}
            {!privacy.enabled ? <span className="mt-1 block text-xs text-emerald-300">{player.tag?.label || "未添加本地标签"}</span> : null}
          </span>
        </button>;
      })}
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
    <div className="flex items-center justify-between"><div><h2 className="font-bold"><Users className="mr-2 inline h-4 w-4"/>{data?.historical_preview ? `历史对局模拟 · Game ${data.game_id}` : "实时对局检测"}</h2><p className="mt-1 text-xs text-cs2-text-muted">{data?.historical_preview ? "只读重放历史阵容与结算数据，不会向客户端写入任何状态。" : "读取当前 Gameflow 队伍，分析近期表现、当前英雄、组排关系和双方打野路线倾向。"}</p></div>{data?.historical_preview ? <button onClick={onExitPreview} className="rounded-xl border border-cs2-border px-3 py-2 text-xs">退出模拟</button> : <button onClick={load} className="rounded-xl border border-cs2-border px-3 py-2 text-xs"><RefreshCw className={`mr-1 inline h-4 w-4 ${busy ? "animate-spin" : ""}`}/>刷新</button>}</div>
    {!data?.available ? <div className="rounded-2xl border border-dashed border-cs2-border p-12 text-center text-sm text-cs2-text-muted">进入英雄选择或游戏加载阶段后自动显示十名玩家</div> : null}
    {Object.entries(grouped).map(([team, players]) => <TeamSection key={team} team={team} players={players} data={data} privacy={privacy} onOpenPlayer={onOpenPlayer}/>) }
  </div>;
}
