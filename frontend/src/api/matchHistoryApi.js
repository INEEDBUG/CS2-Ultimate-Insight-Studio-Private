import API from "./api";

export async function fetchMatchHistory() {
  const { data } = await API.get("/match-history/matches");
  return data;
}

export async function testSteamConnection(steam_api_key, steam_id64, steam_game_auth_code, steam_known_share_code) {
  const { data } = await API.post("/match-history/test-connection", {
    steam_api_key,
    steam_id64,
    steam_game_auth_code,
    steam_known_share_code,
  });
  return data;
}

export async function downloadMatchDemo(demo_url, match_id, filename) {
  const { data } = await API.post("/match-history/download/jobs", { demo_url, match_id, filename });
  return data;
}

export async function fetchDemoDownloadJobs(activeOnly = false) {
  const { data } = await API.get("/match-history/download-jobs", {
    params: { active_only: activeOnly },
  });
  return data.jobs || [];
}

export async function downloadMatchDemoFromShareCode(share_code, accept_gpl_sidecar) {
  const { data } = await API.post("/match-history/download-share-code", {
    share_code,
    accept_gpl_sidecar,
  });
  return data;
}

export async function startShareCodeDownloadJob(share_code, accept_gpl_sidecar) {
  const { data } = await API.post("/match-history/download-share-code/jobs", {
    share_code,
    accept_gpl_sidecar,
  });
  return data;
}

export async function fetchShareCodeDownloadJob(jobId) {
  const { data } = await API.get(`/match-history/download-share-code/jobs/${jobId}`);
  return data;
}

export async function cancelShareCodeDownloadJob(jobId) {
  const { data } = await API.delete(`/match-history/download-share-code/jobs/${jobId}`);
  return data;
}

export async function retryShareCodeDownloadJob(jobId) {
  const { data } = await API.post(`/match-history/download-share-code/jobs/${jobId}/retry`);
  return data;
}

export function saveMatchCredentials(steam_api_key, steam_id64, steam_game_auth_code, steam_known_share_code, match_mode, match_count) {
  return API.put("/config", {
    steam_api_key,
    steam_id64,
    steam_game_auth_code,
    steam_known_share_code,
    match_mode,
    match_count,
  });
}
