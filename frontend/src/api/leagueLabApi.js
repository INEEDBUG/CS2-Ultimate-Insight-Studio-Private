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

export async function fetchLeaguePlayer(puuid, matchLimit = 20, begIndex = 0, serverId = "") {
  const { data } = await API.get(`/league-lab/players/${encodeURIComponent(puuid)}`, { params: { match_limit: matchLimit, beg_index: begIndex, server_id: serverId || undefined } });
  return data;
}

export async function fetchLeaguePlayerCollection(puuid, limit = 100) {
  const { data } = await API.get(`/league-lab/players/${encodeURIComponent(puuid)}/collection`, { params: { limit } });
  return data;
}

export async function fetchLeaguePlayerJungleAnalysis(puuid, limit = 6, serverId = "") {
  const { data } = await API.get(`/league-lab/players/${encodeURIComponent(puuid)}/jungle-analysis`, { params: { limit, server_id: serverId || undefined } });
  return data;
}

export async function searchLeaguePlayer(gameName, tagLine, serverId = "") {
  const { data } = await API.get("/league-lab/players/search", { params: { game_name: gameName, tag_line: tagLine, server_id: serverId || undefined } });
  return data;
}

export async function fetchLeaguePlayerSearchServers() {
  const { data } = await API.get("/league-lab/players/search-servers");
  return data;
}

export async function fetchRecentLeaguePlayers(limit = 40) {
  const { data } = await API.get("/league-lab/players/recent", { params: { limit } });
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

export async function fetchLeagueCooldownTimerState() {
  const { data } = await API.get("/league-lab/cooldown-timer/state");
  return data;
}

export async function sendLeagueCooldownTimerText(text) {
  const { data } = await API.post("/league-lab/cooldown-timer/send", { text });
  return data;
}

export async function fetchLeagueOpggVersions(params) {
  const { data } = await API.get("/league-lab/opgg/versions", { params });
  return data;
}

export async function fetchLeagueOpggChampions(params) {
  const { data } = await API.get("/league-lab/opgg/champions", { params });
  return data;
}

export async function fetchLeagueOpggChampion(championId, params) {
  const { data } = await API.get(`/league-lab/opgg/champions/${encodeURIComponent(championId)}`, { params });
  return data;
}

export async function applyLeagueOpggSpells(body) {
  const { data } = await API.post("/league-lab/opgg/apply-spells", body);
  return data;
}

export async function applyLeagueOpggRunes(body) {
  const { data } = await API.post("/league-lab/opgg/apply-runes", body);
  return data;
}

export async function applyLeagueOpggItems(body) {
  const { data } = await API.post("/league-lab/opgg/apply-items", body);
  return data;
}

export async function clearLeagueOpggItems() {
  const { data } = await API.delete("/league-lab/opgg/item-sets");
  return data;
}

export async function fetchLeagueToolkitOverview() {
  const { data } = await API.get("/league-lab/toolkit/overview");
  return data;
}

export async function claimLeagueMissionReward(missionId, rewardGroupIds, confirmation) {
  const { data } = await API.post("/league-lab/toolkit/claims/mission", {
    mission_id: missionId,
    reward_group_ids: rewardGroupIds,
    confirmation,
  });
  return data;
}

export async function claimLeagueRewardGrant(grantId, rewardGroupId, selectionIds, confirmation) {
  const { data } = await API.post("/league-lab/toolkit/claims/reward", {
    grant_id: grantId,
    reward_group_id: rewardGroupId,
    selection_ids: selectionIds,
    confirmation,
  });
  return data;
}

export async function claimLeagueEventRewards(eventId, confirmation) {
  const { data } = await API.post("/league-lab/toolkit/claims/event", {
    event_id: eventId,
    confirmation,
  });
  return data;
}

export async function deleteLeagueFriends(friendIds, confirmation) {
  const { data } = await API.post("/league-lab/toolkit/friends/delete", {
    friend_ids: friendIds,
    confirmation,
  });
  return data;
}

export async function fetchLeagueLobbyOptions() {
  const { data } = await API.get("/league-lab/toolkit/lobby-options");
  return data;
}

export async function createLeagueQueueLobby(queueId, confirmation) {
  const { data } = await API.post("/league-lab/toolkit/lobby/create", { queue_id: queueId, confirmation });
  return data;
}

export async function leaveLeagueLobby(confirmation) {
  const { data } = await API.post("/league-lab/toolkit/lobby/leave", { confirmation });
  return data;
}

export async function updateLeagueStrawberryPlayer(championId, mapItemId, difficulty, confirmation) {
  const { data } = await API.put("/league-lab/toolkit/strawberry/player", {
    champion_id: championId, map_item_id: mapItemId, difficulty, confirmation,
  });
  return data;
}

export async function updateLeagueStrawberryMap(contentId, itemId, confirmation) {
  const { data } = await API.put("/league-lab/toolkit/strawberry/map", {
    content_id: contentId, item_id: itemId, confirmation,
  });
  return data;
}

export async function updateLeagueStrawberryDifficulty(difficulty, confirmation) {
  const { data } = await API.put("/league-lab/toolkit/strawberry/difficulty", { difficulty, confirmation });
  return data;
}

export async function fetchLeagueProfileSkins(championId) {
  const { data } = await API.get(`/league-lab/toolkit/profile/skins/${championId}`);
  return data;
}

export async function updateLeagueProfileBackground(championId, skinId, augmentId, confirmation) {
  const { data } = await API.post("/league-lab/toolkit/profile/background", {
    champion_id: championId, skin_id: skinId, augment_id: augmentId || null, confirmation,
  });
  return data;
}

export async function runLeagueProfileUtilityAction(action, confirmation) {
  const { data } = await API.post("/league-lab/toolkit/profile/action", { action, confirmation });
  return data;
}

export async function fetchLeagueGamePreview(gameId, source = "auto", includeTimeline = true) {
  const { data } = await API.get(`/league-lab/toolkit/game-preview/${encodeURIComponent(gameId)}`, {
    params: { source, include_timeline: includeTimeline },
  });
  return data;
}

export async function updateLeagueChatPresence(payload) {
  const { data } = await API.put("/league-lab/toolkit/chat-presence", payload);
  return data;
}

export async function updateLeagueRankedStatus(payload) {
  const { data } = await API.put("/league-lab/toolkit/ranked-status", payload);
  return data;
}

export async function sendLeagueChatMessage(lines) {
  const { data } = await API.post("/league-lab/toolkit/chat-message", { lines });
  return data;
}

export async function terminateLeagueGameClient() {
  const { data } = await API.post("/league-lab/toolkit/terminate-game-client");
  return data;
}

export async function fetchLeagueGameSettingsFile() {
  const { data } = await API.get("/league-lab/toolkit/game-settings-file");
  return data;
}

export async function updateLeagueGameSettingsFile(mode) {
  const { data } = await API.put("/league-lab/toolkit/game-settings-file", { mode });
  return data;
}

export async function fetchLeagueClientWindow() {
  const { data } = await API.get("/league-lab/toolkit/client-window");
  return data;
}

export async function resizeLeagueClientWindow(baseWidth, baseHeight) {
  const { data } = await API.put("/league-lab/toolkit/client-window", { base_width: baseWidth, base_height: baseHeight });
  return data;
}

export async function swapLeagueBenchChampion(championId) {
  const { data } = await API.post(`/league-lab/champ-select/bench/swap/${championId}`);
  return data;
}

export async function rerollLeagueChampion() {
  const { data } = await API.post("/league-lab/champ-select/reroll");
  return data;
}

export async function selectLeagueChampionSkin(skinId) {
  const { data } = await API.post(`/league-lab/champ-select/skin/${skinId}`);
  return data;
}
