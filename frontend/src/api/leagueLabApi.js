import API from "./api";

export async function fetchLeagueLabStatus() {
  const { data } = await API.get("/league-lab/status");
  return data;
}

export async function saveLeagueLabSettings(settings) {
  const { data } = await API.put("/league-lab/settings", settings);
  return data;
}

export async function runLeagueLabAction(action) {
  const { data } = await API.post(`/league-lab/actions/${action}`);
  return data;
}

export async function fetchLeagueMatches(limit = 20) {
  const { data } = await API.get("/league-lab/matches", { params: { limit } });
  return data;
}

export async function fetchLeagueChampions() {
  const { data } = await API.get("/league-lab/champions");
  return data;
}

export async function fetchLeagueLoadoutCatalog() {
  const { data } = await API.get("/league-lab/loadout-catalog");
  return data;
}

export async function fetchCurrentLeaguePlayer() {
  const { data } = await API.get("/league-lab/players/current");
  return data;
}

export async function fetchLeaguePlayer(puuid, matchLimit = 20) {
  const { data } = await API.get(`/league-lab/players/${encodeURIComponent(puuid)}`, { params: { match_limit: matchLimit } });
  return data;
}

export async function saveLeaguePlayerTag(puuid, tag) {
  const { data } = await API.put(`/league-lab/players/${encodeURIComponent(puuid)}/tag`, tag);
  return data;
}

export async function fetchLeagueOngoingGame() {
  const { data } = await API.get("/league-lab/ongoing-game");
  return data;
}
