const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const safe = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const keyOf = (value) => String(value || "").trim().toLowerCase();

function centered(value, baseline, spread) {
  return clamp(1 + (safe(value) - baseline) / spread, 0.15, 2.35);
}

function multiKillIndex(player, rounds) {
  return (
    safe(player.two_kill_rounds) * 0.18
    + safe(player.three_kill_rounds) * 0.46
    + safe(player.four_kill_rounds) * 0.82
    + safe(player.five_kill_rounds) * 1.2
  ) / Math.max(1, rounds);
}

function estimateRoundSwing(data, playerByName) {
  const totals = new Map([...playerByName.keys()].map((key) => [key, 0]));
  const rounds = Array.isArray(data.rounds) ? data.rounds : [];
  for (const round of rounds) {
    let aliveA = 5;
    let aliveB = 5;
    const events = (Array.isArray(round.events) ? round.events : [])
      .filter((event) => event?.type === "kill")
      .sort((a, b) => safe(a.tick) - safe(b.tick));
    for (const event of events) {
      const actorKey = keyOf(event.actor);
      const targetKey = keyOf(event.target);
      const actor = playerByName.get(actorKey);
      const target = playerByName.get(targetKey);
      if (!actor || !target || actor.team_key === target.team_key) continue;
      const beforeDiff = actor.team_key === "a" ? aliveA - aliveB : aliveB - aliveA;
      if (target.team_key === "a") aliveA = Math.max(0, aliveA - 1);
      if (target.team_key === "b") aliveB = Math.max(0, aliveB - 1);
      const afterDiff = actor.team_key === "a" ? aliveA - aliveB : aliveB - aliveA;
      const before = 1 / (1 + Math.exp(-0.72 * beforeDiff));
      const after = 1 / (1 + Math.exp(-0.72 * afterDiff));
      let swing = Math.max(0, after - before);
      const ownEquipment = safe(actor.team_key === "a" ? round.team_a_equipment_value : round.team_b_equipment_value);
      const enemyEquipment = safe(actor.team_key === "a" ? round.team_b_equipment_value : round.team_a_equipment_value);
      if (ownEquipment || enemyEquipment) {
        swing *= clamp(1 + (enemyEquipment - ownEquipment) / 80000, 0.82, 1.18);
      }
      if (event.headshot) swing *= 1.03;
      totals.set(actorKey, safe(totals.get(actorKey)) + swing);
      totals.set(targetKey, safe(totals.get(targetKey)) - swing * 0.28);
      const assisterKey = keyOf(event.assister);
      if (assisterKey && totals.has(assisterKey)) {
        totals.set(assisterKey, safe(totals.get(assisterKey)) + swing * 0.16);
      }
    }
  }
  const divisor = Math.max(1, rounds.length);
  return new Map([...totals].map(([key, value]) => [key, value / divisor]));
}

function verdictDetail(player, kind) {
  if (kind === "hero") {
    if (safe(player.clutch_wins) > 0) return `${safe(player.clutch_wins)} 次残局取胜并带来最高综合影响`;
    if (safe(player.first_kills) > safe(player.first_deaths)) return "首杀与持续输出共同拉高胜率";
    return "全场输出、存活和回合参与最稳定";
  }
  if (safe(player.first_deaths) > safe(player.first_kills)) return "首死偏多，负向回合影响最明显";
  if (safe(player.adr) < 60) return "有效伤害不足，难以为队伍创造交换空间";
  return "本局综合产出与关键回合影响最低";
}

export function buildMatchRatingPro(data = {}) {
  const players = Array.isArray(data.players) ? data.players : [];
  const rounds = Math.max(1, Array.isArray(data.rounds) ? data.rounds.length : 0);
  const playerByName = new Map(players.map((player) => [keyOf(player.name), player]));
  const swingByName = estimateRoundSwing(data, playerByName);
  const teamEquipment = { a: [], b: [] };
  for (const player of players) {
    if (player.team_key === "a" || player.team_key === "b") {
      teamEquipment[player.team_key].push(safe(player.average_equipment_value));
    }
  }
  const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  const raw = players.map((player) => {
    const kpr = safe(player.kpr) || safe(player.kills) / rounds;
    const dpr = safe(player.dpr) || safe(player.deaths) / rounds;
    const kill = centered(kpr, 0.68, 0.34);
    const survival = centered(1 - dpr, 0.32, 0.28);
    const kast = centered(safe(player.kast), 70, 34);
    const damage = centered(safe(player.adr), 75, 55);
    const multiIndex = multiKillIndex(player, rounds);
    const impactIndex = multiIndex
      + (safe(player.first_kills) - safe(player.first_deaths) * 0.75) / rounds * 0.22
      + safe(player.clutch_wins) / rounds * 0.48
      + safe(player.trade_kills) / rounds * 0.08;
    const impact = centered(impactIndex, 0.13, 0.34);
    const ratingPro2 = clamp((kill + survival + kast + damage + impact) / 5, 0.18, 2.25);

    const enemyKey = player.team_key === "a" ? "b" : "a";
    const ownEquipment = safe(player.average_equipment_value) || avg(teamEquipment[player.team_key] || []);
    const enemyEquipment = avg(teamEquipment[enemyKey] || []);
    const ecoFactor = ownEquipment && enemyEquipment
      ? clamp(1 + (enemyEquipment - ownEquipment) / 30000 * 0.12, 0.9, 1.1)
      : 1;
    const multi = centered(multiIndex, 0.13, 0.32);
    const swingRaw = safe(swingByName.get(keyOf(player.name)));
    return { player, kill, survival, kast, damage, multi, ratingPro2, ecoFactor, swingRaw };
  });

  const meanSwing = raw.length ? raw.reduce((sum, row) => sum + row.swingRaw, 0) / raw.length : 0;
  const rated = raw.map((row) => {
    const swing = centered(row.swingRaw, meanSwing, 0.12);
    const ratingPro3 = clamp(
      row.kill * row.ecoFactor * 0.24
        + row.damage * row.ecoFactor * 0.18
        + row.survival * 0.18
        + row.kast * 0.12
        + row.multi * 0.10
        + swing * 0.18,
      0.18,
      2.25,
    );
    return {
      name: row.player.name,
      team_key: row.player.team_key,
      rating_pro_2: Number(row.ratingPro2.toFixed(2)),
      rating_pro_3: Number(ratingPro3.toFixed(2)),
      round_swing: Number(row.swingRaw.toFixed(3)),
      eco_factor: Number(row.ecoFactor.toFixed(3)),
      confidence: rounds >= 18 && safe(row.player.adr) > 0 && safe(row.player.kast) > 0 ? "high" : rounds >= 10 ? "medium" : "low",
      player: row.player,
    };
  });

  const scoreA = safe(data.team_a_score);
  const scoreB = safe(data.team_b_score);
  const winnerKey = scoreA === scoreB ? "" : scoreA > scoreB ? "a" : "b";
  const loserKey = winnerKey === "a" ? "b" : winnerKey === "b" ? "a" : "";
  const heroPool = winnerKey ? rated.filter((row) => row.team_key === winnerKey) : rated;
  const culpritPool = loserKey ? rated.filter((row) => row.team_key === loserKey) : rated;
  const hero = [...heroPool].sort((a, b) => b.rating_pro_3 - a.rating_pro_3)[0] || null;
  const culprit = [...culpritPool].sort((a, b) => a.rating_pro_3 - b.rating_pro_3)[0] || null;
  return {
    players: rated.map((row) => ({ ...row, player: undefined })),
    hero: hero ? { ...hero, detail: verdictDetail(hero.player, "hero"), player: undefined } : null,
    culprit: culprit ? { ...culprit, detail: verdictDetail(culprit.player, "culprit"), player: undefined } : null,
    model_note: "Rating Pro 为本地估算：2.0 使用击杀、存活、KAST、伤害与影响；3.0 额外加入经济修正、多杀和回合胜率摆动。不是 HLTV 官方评分。",
  };
}
