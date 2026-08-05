function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalize(value, low, high) {
  return clamp(((Number(value) - low) / Math.max(0.0001, high - low)) * 100);
}

function gradeForScore(score) {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 68) return "B";
  if (score >= 55) return "C";
  return "D";
}

function labelForScore(score) {
  if (score >= 90) return "主宰比赛";
  if (score >= 80) return "关键核心";
  if (score >= 68) return "稳定贡献";
  if (score >= 55) return "表现普通";
  return "状态低迷";
}

export function buildPlayerAssessment(player = {}, totalRounds = 0) {
  const kills = Number(player.kills || 0);
  const deaths = Number(player.deaths || 0);
  const kd = Number(player.kd || kills / Math.max(1, deaths));
  const adr = Number(player.adr || 0);
  const kast = Number(player.kast || 0);
  const firstKills = Number(player.first_kills || 0);
  const firstDeaths = Number(player.first_deaths || 0);
  const openingAttempts = firstKills + firstDeaths;
  const openingWinRate = openingAttempts ? firstKills / openingAttempts * 100 : 50;
  const multiKills = Number(player.two_kill_rounds || 0)
    + Number(player.three_kill_rounds || 0) * 1.6
    + Number(player.four_kill_rounds || 0) * 2.3
    + Number(player.five_kill_rounds || 0) * 3;
  const clutchWins = Number(player.clutch_wins || 0);
  const tradeKills = Number(player.trade_kills || 0);
  const rounds = Math.max(1, Number(totalRounds) || 1);
  const impact = normalize((multiKills + clutchWins * 2 + tradeKills * 0.55) / rounds, 0.03, 0.65);
  const score = Math.round(
    normalize(adr, 42, 118) * 0.3
      + normalize(kd, 0.48, 1.55) * 0.25
      + normalize(kast, 48, 84) * 0.23
      + openingWinRate * 0.1
      + impact * 0.12,
  );

  const strengths = [];
  const improvements = [];
  if (adr >= 90) strengths.push("伤害输出充足");
  if (kd >= 1.2) strengths.push("对枪交换占优");
  if (kast >= 72) strengths.push("回合参与稳定");
  if (firstKills > firstDeaths && firstKills >= 2) strengths.push("首杀影响力突出");
  if (tradeKills >= Math.max(2, rounds * 0.12)) strengths.push("补枪意识良好");
  if (clutchWins > 0) strengths.push(`${clutchWins} 次残局取胜`);
  if (adr < 65) improvements.push("提升有效伤害与存活输出");
  if (kd < 0.85) improvements.push("减少无效对枪和首死");
  if (kast < 62) improvements.push("加强补枪、存活和回合参与");
  if (firstDeaths > firstKills + 1) improvements.push("控制激进前压造成的首死");
  if (!strengths.length) strengths.push("基础数据相对均衡");
  if (!improvements.length) improvements.push("保持当前节奏并复盘关键失败回合");

  return {
    score,
    grade: gradeForScore(score),
    label: labelForScore(score),
    strengths: strengths.slice(0, 3),
    improvements: improvements.slice(0, 2),
    summary: `${labelForScore(score)}：${strengths[0]}；下一步建议${improvements[0]}。`,
  };
}

export function buildRoundPlayerAssessments(round = {}, players = []) {
  const byName = new Map();
  const ensure = (name) => {
    const key = String(name || "").trim().toLowerCase();
    if (!key || key === "world") return null;
    if (!byName.has(key)) {
      const meta = players.find((player) => String(player?.name || "").trim().toLowerCase() === key) || {};
      byName.set(key, {
        name: String(meta.name || name).trim(),
        team_key: meta.team_key || "",
        kills: 0,
        deaths: 0,
        headshots: 0,
        openingKills: 0,
        objective: 0,
      });
    }
    return byName.get(key);
  };
  players.forEach((player) => ensure(player?.name));
  const events = Array.isArray(round?.events) ? round.events : [];
  let firstKillSeen = false;
  for (const event of events) {
    if (event?.type === "kill") {
      const actor = ensure(event.actor);
      const target = ensure(event.target);
      if (actor) {
        actor.kills += 1;
        if (event.headshot) actor.headshots += 1;
        if (!firstKillSeen) actor.openingKills += 1;
      }
      if (target) target.deaths += 1;
      firstKillSeen = true;
    } else if (["plant", "defuse", "explode"].includes(event?.type)) {
      const actor = ensure(event.actor);
      if (actor) actor.objective += event.type === "defuse" ? 2 : 1;
    }
  }
  return [...byName.values()].map((item) => {
    const won = item.team_key && item.team_key === round?.winner_team_key;
    const score = clamp(45 + item.kills * 18 - item.deaths * 9 + item.headshots * 4 + item.openingKills * 7 + item.objective * 8 + (won ? 5 : 0));
    let label = "参与有限";
    if (item.kills >= 3 || score >= 88) label = "回合关键先生";
    else if (item.kills >= 2 || score >= 75) label = "高影响贡献";
    else if (item.kills === 1 || item.objective > 0 || score >= 58) label = "完成有效贡献";
    else if (item.deaths > 0) label = "过早出局";
    return { ...item, score: Math.round(score), grade: gradeForScore(score), label };
  }).sort((a, b) => Number(b.score) - Number(a.score) || a.name.localeCompare(b.name));
}
