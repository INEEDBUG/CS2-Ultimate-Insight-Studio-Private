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
