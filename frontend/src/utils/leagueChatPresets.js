function displayName(player, index) {
  return player?.summoner?.gameName || player?.champion_name || `玩家${index + 1}`;
}

export function buildLeagueFormPreset(players = []) {
  return players.map((player, index) => {
    const recent = player?.recent || {};
    const matches = Number(recent.matches || 0);
    const winRate = matches ? Math.round(Number(recent.wins || 0) / matches * 100) : 0;
    const usage = player?.champion_usage || {};
    return `${displayName(player, index)}：近${matches}场 ${winRate}%胜率，${player?.champion_name || "当前英雄"} ${Number(usage.matches || 0)}场 / KDA ${Number(usage.average_kda || 0).toFixed(2)}`;
  });
}

export function buildLeaguePremadePreset(players = []) {
  const groups = new Map();
  players.forEach((player, index) => {
    if (!player?.premade_group) return;
    const key = Number(player.premade_group);
    const names = groups.get(key) || [];
    names.push(displayName(player, index));
    groups.set(key, names);
  });
  return [...groups.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([group, names]) => `组排 ${String.fromCharCode(64 + group)}：${names.join("、")}`);
}

export function buildLeagueJunglePreset(players = []) {
  return players
    .map((player, index) => {
      const analysis = player?.jungle_analysis || {};
      if (!analysis.games_analyzed || !analysis.draft) return null;
      return `${displayName(player, index)}：${analysis.draft}`;
    })
    .filter(Boolean);
}
