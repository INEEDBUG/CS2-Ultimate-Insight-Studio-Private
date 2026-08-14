export function leagueOpggModeForGameMode(gameMode) {
  const normalized = String(gameMode || "").toUpperCase();
  if (normalized === "ARAM" || normalized === "KIWI") return "aram";
  if (normalized === "CHERRY") return "arena";
  if (normalized === "NEXUSBLITZ") return "nexus_blitz";
  if (normalized === "URF" || normalized === "ARURF") return "urf";
  return "ranked";
}

export function leagueOpggPositionForAssignedPosition(position, mode = "ranked") {
  if (mode !== "ranked") return "none";
  return ({ top: "top", jungle: "jungle", middle: "mid", bottom: "adc", utility: "support" })[
    String(position || "").toLowerCase()
  ] || "top";
}

export function leagueOpggStats(summary, position) {
  return summary?.positions?.find((row) => String(row?.name).toLowerCase() === String(position).toLowerCase())?.stats
    || summary?.average_stats
    || {};
}

export function leagueOpggItemGroups(data) {
  const groups = [];
  (data?.starter_items || []).slice(0, 3).forEach((row, index) => groups.push({
    title: `出门装 ${index + 1} · ${(Number(row.pick_rate || 0) * 100).toFixed(1)}%`, item_ids: row.ids || [],
  }));
  if (data?.boots?.length) groups.push({ title: "鞋子", item_ids: data.boots.flatMap((row) => row.ids || []) });
  (data?.core_items || []).slice(0, 4).forEach((row, index) => groups.push({
    title: `核心装 ${index + 1} · ${(Number(row.pick_rate || 0) * 100).toFixed(1)}%`, item_ids: row.ids || [],
  }));
  if (data?.last_items?.length) groups.push({ title: "后期可选", item_ids: data.last_items.slice(0, 20).flatMap((row) => row.ids || []) });
  return groups.filter((group) => group.item_ids.length);
}

export function hasLeagueChampionConfig(settings, championId) {
  if (!settings?.auto_champion_config_enabled) return false;
  return (settings.champion_loadouts || []).some((row) => Number(row.champion_id) === Number(championId));
}
