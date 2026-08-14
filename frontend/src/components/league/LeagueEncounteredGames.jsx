import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, History, Trash2 } from "lucide-react";
import { deleteLeaguePlayerEncounter, fetchLeaguePlayerEncounters } from "../../api/leagueLabApi";
import { getLeagueChampionIconUrl } from "../../api/api";

function PlayerLine({ label, player = {} }) {
  return <div className="flex min-w-0 items-center gap-2">
    {player.champion_id ? <img src={getLeagueChampionIconUrl(player.champion_id)} alt="" className="h-8 w-8 rounded-lg object-cover"/> : <span className="h-8 w-8 rounded-lg bg-white/5"/>}
    <span className="min-w-0 text-xs"><b className="block">{label} · {player.champion_name || `英雄 ${player.champion_id || "—"}`}</b><span className="font-mono text-cs2-text-muted">{player.kills ?? "—"}/{player.deaths ?? "—"}/{player.assists ?? "—"}</span></span>
  </div>;
}

export default function LeagueEncounteredGames({ puuid, selfPuuid, onError }) {
  const [payload, setPayload] = useState(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (nextPage = 1) => {
    if (!puuid || !selfPuuid || puuid === selfPuuid) { setPayload(null); return; }
    setBusy(true);
    try {
      setPayload(await fetchLeaguePlayerEncounters(puuid, nextPage, 10));
      setPage(nextPage);
    } catch (error) {
      onError?.(error?.response?.data?.detail || "共同对局读取失败");
    } finally {
      setBusy(false);
    }
  }, [onError, puuid, selfPuuid]);
  useEffect(() => { setPage(1); void load(1); }, [load]);

  if (!payload?.total) return null;
  const totalPages = Math.max(1, Math.ceil(payload.total / payload.page_size));
  return <section className="rounded-2xl border border-cyan-400/20 bg-cs2-bg-elevated p-4">
    <div className="flex items-center gap-2"><History className="h-4 w-4 text-cyan-300"/><h3 className="mr-auto text-sm font-bold">共同对局（{payload.total}）</h3><button disabled={page <= 1 || busy} onClick={() => load(page - 1)} className="rounded-lg border border-cs2-border p-1.5 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5"/></button><span className="text-[11px] text-cs2-text-muted">{page}/{totalPages}</span><button disabled={page >= totalPages || busy} onClick={() => load(page + 1)} className="rounded-lg border border-cs2-border p-1.5 disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5"/></button></div>
    <div className="mt-3 grid gap-2 md:grid-cols-2">
      {(payload.games || []).map((game) => <article key={`${game.self_puuid}:${game.game_id}`} className={`rounded-xl border p-3 ${game.target?.win === true ? "border-emerald-400/20 bg-emerald-400/[.05]" : game.target?.win === false ? "border-rose-400/20 bg-rose-400/[.05]" : "border-cs2-border-subtle"}`}>
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-cs2-text-muted"><span>{game.game_mode || "未知模式"} · {game.played_at ? new Date(Number(game.played_at)).toLocaleString() : "时间未知"}</span><button aria-label={`移除共同对局 ${game.game_id}`} onClick={async () => { await deleteLeaguePlayerEncounter(puuid, game.game_id); await load(page); }} className="rounded p-1 text-rose-300 hover:bg-rose-400/10"><Trash2 className="h-3.5 w-3.5"/></button></div>
        <div className="grid gap-2 sm:grid-cols-2"><PlayerLine label="该玩家" player={game.target}/><PlayerLine label="我" player={game.self}/></div>
      </article>)}
    </div>
  </section>;
}
