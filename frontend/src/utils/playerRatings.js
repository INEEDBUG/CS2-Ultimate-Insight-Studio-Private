const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const safe = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const keyOf = (value) => String(value || "").trim().toLowerCase();

// HLTV keeps its exact averages, deviations, map/side tables and coefficients
// private. These public-principle baselines are intentionally kept in one place
// so Rating Pro stays auditable and can be calibrated against local CS2 samples.
const EXPECTED = {
  T: { kpr: 0.65, survival: 0.28, kast: 68.5, adr: 73 },
  CT: { kpr: 0.71, survival: 0.36, kast: 72.5, adr: 77 },
  ALL: { kpr: 0.68, survival: 0.32, kast: 70.5, adr: 75 },
};

const DEVIATION = { kpr: 0.18, survival: 0.12, kast: 9.5, adr: 18, impact: 0.12, multi: 0.10, swing: 0.045 };

function subrating(value, expected, deviation, strength = 0.22) {
  const z = (safe(value) - expected) / Math.max(0.001, deviation);
  return clamp(1 + z * strength, 0.15, 2.35);
}

// Public community estimator for HLTV Rating 2.0. HLTV does not publish the
// production formula, so this value must remain labelled as estimated. Keeping
// the estimator isolated makes screenshots and external calculators directly
// reproducible instead of applying our former second shrink toward 1.00.
export function estimateHltvRating2(player, rounds) {
  const roundCount = Math.max(1, safe(rounds));
  const kpr = safe(player?.kpr) || safe(player?.kills) / roundCount;
  const dpr = safe(player?.dpr) || safe(player?.deaths) / roundCount;
  const apr = safe(player?.assists) / roundCount;
  const impact = 2.13 * kpr + 0.42 * apr - 0.41;
  const estimate = 0.0073 * safe(player?.kast)
    + 0.3591 * kpr
    - 0.5329 * dpr
    + 0.2372 * impact
    + 0.0032 * safe(player?.adr)
    + 0.1587;
  return clamp(estimate, 0.05, 3.00);
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function multiKillIndex(player, rounds) {
  return (
    safe(player.one_kill_rounds) * 0.04
    + safe(player.two_kill_rounds) * 0.35
    + safe(player.three_kill_rounds) * 0.85
    + safe(player.four_kill_rounds) * 1.45
    + safe(player.five_kill_rounds) * 2.10
  ) / Math.max(1, rounds);
}

function emptyContext() {
  return {
    rounds: 0, kills: 0, deaths: 0, assists: 0, kastPoints: 0,
    effectiveSurvival: 0, pureLostSaves: 0, openingKills: 0,
    openingDeaths: 0, tradeKills: 0, tradedDeaths: 0,
  };
}

function sideFor(round, teamKey) {
  return String(teamKey === "a" ? round?.team_a_side : round?.team_b_side).toUpperCase();
}

function winnerFor(round) {
  if (round?.winner_team_key === "a" || round?.winner_team_key === "b") return round.winner_team_key;
  return "";
}

function equipmentFor(round, teamKey) {
  return safe(teamKey === "a" ? round?.team_a_equipment_value : round?.team_b_equipment_value);
}

function roundWinProbability({ ownAlive, enemyAlive, ownEquipment, enemyEquipment, side }) {
  const aliveSignal = (ownAlive - enemyAlive) * 0.72;
  const economySignal = clamp((ownEquipment - enemyEquipment) / 30000, -1.2, 1.2) * 0.34;
  const sideSignal = side === "CT" ? 0.08 : side === "T" ? -0.08 : 0;
  return sigmoid(aliveSignal + economySignal + sideSignal);
}

function isTradeKill(events, index, playerByName, tickRate) {
  const event = events[index];
  const actor = playerByName.get(keyOf(event?.actor));
  if (!actor) return false;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = events[cursor];
    if (safe(event.tick) - safe(previous.tick) > tickRate * 5) break;
    const previousVictim = playerByName.get(keyOf(previous.target));
    if (previousVictim?.team_key === actor.team_key && keyOf(previous.actor) === keyOf(event.target)) return true;
  }
  return false;
}

function buildRoundContext(data, players, playerByName) {
  const rounds = Array.isArray(data.rounds) ? data.rounds : [];
  const tickRate = Math.max(1, safe(data.tick_rate) || 64);
  const contexts = new Map(players.map((player) => [keyOf(player.name), {
    ALL: emptyContext(), T: emptyContext(), CT: emptyContext(),
    swing: 0, killSwing: 0, roundEndSwing: 0, ecoKillPoints: 0,
    ecoKillCount: 0, flashAssists: 0,
  }]));
  const teamPlayers = {
    a: players.filter((player) => player.team_key === "a"),
    b: players.filter((player) => player.team_key === "b"),
  };
  let contextualRounds = 0;

  for (const round of rounds) {
    const winner = winnerFor(round);
    if (winner && sideFor(round, "a") && sideFor(round, "b")) contextualRounds += 1;
    const alive = {
      a: new Set(teamPlayers.a.map((player) => keyOf(player.name))),
      b: new Set(teamPlayers.b.map((player) => keyOf(player.name))),
    };
    const roundFlags = new Map(players.map((player) => [keyOf(player.name), {
      kill: false, assist: false, death: false, tradedDeath: false,
    }]));
    const events = (Array.isArray(round.events) ? round.events : [])
      .filter((event) => event?.type === "kill")
      .sort((a, b) => safe(a.tick) - safe(b.tick));
    const positiveSwing = new Map(players.map((player) => [keyOf(player.name), 0]));

    events.forEach((event, index) => {
      const actorKey = keyOf(event.actor);
      const targetKey = keyOf(event.target);
      const assistKey = keyOf(event.assister);
      const actor = playerByName.get(actorKey);
      const target = playerByName.get(targetKey);
      if (!actor || !target || actor.team_key === target.team_key) return;
      const actorSide = sideFor(round, actor.team_key);
      const actorContext = contexts.get(actorKey);
      const targetContext = contexts.get(targetKey);
      const ownAliveBefore = alive[actor.team_key]?.size || 0;
      const enemyAliveBefore = alive[target.team_key]?.size || 0;
      const ownEquipment = equipmentFor(round, actor.team_key);
      const enemyEquipment = equipmentFor(round, target.team_key);
      const before = roundWinProbability({
        ownAlive: ownAliveBefore, enemyAlive: enemyAliveBefore,
        ownEquipment, enemyEquipment, side: actorSide,
      });
      alive[target.team_key]?.delete(targetKey);
      const after = roundWinProbability({
        ownAlive: alive[actor.team_key]?.size || 0,
        enemyAlive: alive[target.team_key]?.size || 0,
        ownEquipment, enemyEquipment, side: actorSide,
      });
      const rawSwing = Math.max(0, after - before);
      const trade = isTradeKill(events, index, playerByName, tickRate);
      const teamAdr = teamPlayers[actor.team_key].reduce((sum, teammate) => sum + Math.max(0, safe(teammate.adr)), 0);
      const damageShare = teamAdr ? safe(actor.adr) / teamAdr : 0.2;
      const damageShareFactor = clamp(damageShare * Math.max(1, teamPlayers[actor.team_key].length), 0.55, 1.45);
      const killerCredit = rawSwing * clamp(0.70 + damageShareFactor * 0.14 + (trade ? 0.08 : 0), 0.72, 0.96);
      actorContext.swing += killerCredit;
      actorContext.killSwing += killerCredit;
      positiveSwing.set(actorKey, safe(positiveSwing.get(actorKey)) + killerCredit);
      targetContext.swing -= rawSwing * 0.22;
      const ecoPoint = clamp(1 + (enemyEquipment - ownEquipment) / 50000, 0.78, 1.22);
      actorContext.ecoKillPoints += ecoPoint;
      actorContext.ecoKillCount += 1;
      roundFlags.get(actorKey).kill = true;
      roundFlags.get(targetKey).death = true;

      if (assistKey && contexts.has(assistKey) && assistKey !== actorKey && assistKey !== targetKey) {
        roundFlags.get(assistKey).assist = true;
        const flashAssist = Boolean(event.is_flash_assist || event.flash_assisted || event.assistedflash);
        const assistCredit = rawSwing * (flashAssist ? 0.12 : 0.06);
        contexts.get(assistKey).swing += assistCredit;
        positiveSwing.set(assistKey, safe(positiveSwing.get(assistKey)) + assistCredit);
        if (flashAssist) contexts.get(assistKey).flashAssists += 1;
      }
      if (trade) {
        actorContext.ALL.tradeKills += 1;
        const sideContext = actorContext[actorSide];
        if (sideContext) sideContext.tradeKills += 1;
        for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
          const previous = events[cursor];
          if (safe(event.tick) - safe(previous.tick) > tickRate * 5) break;
          if (keyOf(previous.actor) === targetKey) {
            const tradedKey = keyOf(previous.target);
            if (roundFlags.has(tradedKey)) roundFlags.get(tradedKey).tradedDeath = true;
            break;
          }
        }
      }
    });

    const first = events.find((event) => {
      const actor = playerByName.get(keyOf(event.actor));
      const target = playerByName.get(keyOf(event.target));
      return actor && target && actor.team_key !== target.team_key;
    });
    if (first) {
      const actor = playerByName.get(keyOf(first.actor));
      const target = playerByName.get(keyOf(first.target));
      for (const [player, field] of [[actor, "openingKills"], [target, "openingDeaths"]]) {
        const context = contexts.get(keyOf(player?.name));
        if (!context) continue;
        context.ALL[field] += 1;
        const sideContext = context[sideFor(round, player.team_key)];
        if (sideContext) sideContext[field] += 1;
      }
    }

    // Rating 3.0's post-hotfix end-of-round credit is shared between clutchers,
    // positive WPA contributors, defusers and surviving winners. We only have a
    // subset of those facts, so this is deliberately capped and low-weight.
    if (winner) {
      const loser = winner === "a" ? "b" : "a";
      const winSide = sideFor(round, winner);
      const probability = roundWinProbability({
        ownAlive: alive[winner]?.size || 0, enemyAlive: alive[loser]?.size || 0,
        ownEquipment: equipmentFor(round, winner), enemyEquipment: equipmentFor(round, loser),
        side: winSide,
      });
      const remainingCredit = clamp(1 - probability, 0, 0.35) * 0.35;
      const weights = new Map();
      for (const player of teamPlayers[winner]) {
        const playerKey = keyOf(player.name);
        let weight = positiveSwing.get(playerKey) > 0 ? 2 : 0;
        if (alive[winner].has(playerKey)) weight += 1;
        const clutched = (round.special_events || []).some((event) => event?.type === "clutch" && event?.won && keyOf(event.player) === playerKey);
        if (clutched) weight += 1;
        const defused = (round.events || []).some((event) => event?.type === "defuse" && keyOf(event.actor || event.player) === playerKey);
        if (defused) weight += 1;
        if (weight > 0) weights.set(playerKey, weight);
      }
      const weightTotal = [...weights.values()].reduce((sum, value) => sum + value, 0);
      for (const [playerKey, weight] of weights) {
        const credit = weightTotal ? remainingCredit * weight / weightTotal : 0;
        contexts.get(playerKey).swing += credit;
        contexts.get(playerKey).roundEndSwing += credit;
      }
    }

    for (const player of players) {
      const playerKey = keyOf(player.name);
      const context = contexts.get(playerKey);
      const side = sideFor(round, player.team_key);
      const flag = roundFlags.get(playerKey);
      for (const bucket of [context.ALL, context[side]].filter(Boolean)) {
        bucket.rounds += 1;
        if (flag.kill) bucket.kills += 1;
        if (flag.assist) bucket.assists += 1;
        if (flag.death) bucket.deaths += 1;
        if (flag.tradedDeath) bucket.tradedDeaths += 1;
        const survived = !flag.death;
        const won = winner === player.team_key;
        if (flag.kill || flag.assist || flag.tradedDeath || (survived && won)) bucket.kastPoints += 1;
        if (survived && won) bucket.effectiveSurvival += 1;
        else if (survived && !won) {
          bucket.effectiveSurvival += 0.35;
          if (!flag.kill && !flag.assist) bucket.pureLostSaves += 1;
        } else if (flag.tradedDeath) bucket.effectiveSurvival += 0.55;
      }
    }
  }
  return { contexts, contextCoverage: rounds.length ? contextualRounds / rounds.length : 0 };
}

function weightedExpected(context, metric) {
  const sideRounds = safe(context.T.rounds) + safe(context.CT.rounds);
  if (!sideRounds) return EXPECTED.ALL[metric];
  return (EXPECTED.T[metric] * context.T.rounds + EXPECTED.CT[metric] * context.CT.rounds) / sideRounds;
}

function shrinkTowardAverage(value, rounds) {
  const reliability = clamp(rounds / (rounds + 6), 0.35, 0.88);
  return 1 + (safe(value) - 1) * reliability;
}

function verdictDetail(row, kind) {
  const strongest = Object.entries(row.subratings || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  const weakest = Object.entries(row.subratings || {}).sort((a, b) => a[1] - b[1])[0]?.[0];
  const labels = { kill: "击杀产出", damage: "伤害", survival: "生存质量", kast: "回合参与", multi: "多杀爆发", swing: "关键回合影响" };
  if (kind === "hero") {
    if (safe(row.player.clutch_wins) > 0) return `${safe(row.player.clutch_wins)} 次残局取胜，${labels[strongest] || "综合影响"}领跑全队`;
    return `${labels[strongest] || "综合输出"}是本方最强项，关键回合贡献最高`;
  }
  if (safe(row.pure_lost_saves ?? row.pureLostSaves) > 0) return `${safe(row.pure_lost_saves ?? row.pureLostSaves)} 个失利回合纯保枪，且${labels[weakest] || "综合产出"}偏低`;
  if (safe(row.player.first_deaths) > safe(row.player.first_kills)) return `首死偏多，${labels[weakest] || "负向回合影响"}是主要短板`;
  return `${labels[weakest] || "综合产出"}为本方最低，未能抵消失利回合代价`;
}

export function buildMatchRatingPro(data = {}) {
  const players = Array.isArray(data.players) ? data.players : [];
  const rounds = Math.max(1, Array.isArray(data.rounds) ? data.rounds.length : 0);
  const playerByName = new Map(players.map((player) => [keyOf(player.name), player]));
  const { contexts, contextCoverage } = buildRoundContext(data, players, playerByName);
  const scoreA = safe(data.team_a_score);
  const scoreB = safe(data.team_b_score);
  const winnerKey = scoreA === scoreB ? "" : scoreA > scoreB ? "a" : "b";

  const raw = players.map((player) => {
    const context = contexts.get(keyOf(player.name)) || { ALL: emptyContext(), T: emptyContext(), CT: emptyContext() };
    const useRoundAdjustment = contextCoverage >= 0.5 && context.ALL.rounds > 0;
    const hasEventTotals = useRoundAdjustment && (context.ALL.kills > 0 || context.ALL.deaths > 0);
    const kpr = safe(player.kpr) || safe(player.kills) / rounds;
    const dpr = safe(player.dpr) || safe(player.deaths) / rounds;
    const adjustedSurvival = useRoundAdjustment
      ? context.ALL.effectiveSurvival / context.ALL.rounds
      : 1 - dpr;
    const adjustedKast = useRoundAdjustment
      ? context.ALL.kastPoints / context.ALL.rounds * 100
      : safe(player.kast);
    const multiIndex = multiKillIndex(player, rounds);
    const openingKills = hasEventTotals ? context.ALL.openingKills : safe(player.first_kills);
    const openingDeaths = hasEventTotals ? context.ALL.openingDeaths : safe(player.first_deaths);
    const tradeKills = Math.max(safe(player.trade_kills), safe(context.ALL.tradeKills));
    const impactIndex = multiIndex
      + (openingKills * 0.45 - openingDeaths * 0.32) / rounds
      + safe(player.clutch_wins) / rounds * 0.90
      + tradeKills / rounds * 0.12
      + safe(player.assists) / rounds * 0.04;

    const kill = subrating(kpr, weightedExpected(context, "kpr"), DEVIATION.kpr);
    const survival = subrating(adjustedSurvival, weightedExpected(context, "survival"), DEVIATION.survival);
    const kast = subrating(adjustedKast, weightedExpected(context, "kast"), DEVIATION.kast);
    const damage = subrating(safe(player.adr), weightedExpected(context, "adr"), DEVIATION.adr);
    const impact = subrating(impactIndex, 0.15, DEVIATION.impact, 0.24);
    const ratingPro2 = estimateHltvRating2(player, rounds);

    const ecoFactorRaw = context.ecoKillCount ? context.ecoKillPoints / context.ecoKillCount : 1;
    const ecoSample = clamp(context.ecoKillCount / 8, 0, 1);
    const ecoFactor = clamp(1 + (ecoFactorRaw - 1) * ecoSample, 0.84, 1.16);
    const awpShare = safe(player.awp_kills) / Math.max(1, safe(player.kills));
    const damageEcoFactor = ecoFactor < 1
      ? 1 + (ecoFactor - 1) * (0.50 - awpShare * 0.20)
      : 1 + (ecoFactor - 1) * 0.50;
    let kastEcoFactor = 1 + (ecoFactor - 1) * 0.22;
    if (winnerKey && player.team_key !== winnerKey && kastEcoFactor > 1) kastEcoFactor = 1 + (kastEcoFactor - 1) * 0.45;
    const multi = subrating(multiIndex, 0.13, DEVIATION.multi, 0.20);
    const swingRaw = safe(context.swing) / rounds;
    const swing = subrating(swingRaw, 0, DEVIATION.swing, 0.18);
    const subratings = {
      kill: kill * ecoFactor,
      damage: damage * damageEcoFactor,
      survival,
      kast: kast * kastEcoFactor,
      multi,
      swing,
    };
    // Post-Oct-2025 public balance: kills gain weight, Swing and Multi-Kills
    // lose weight, and output vs cost remains approximately 60:40 when half
    // of the mixed Swing component is assigned to each side of that balance.
    const ratingPro3Raw = subratings.kill * 0.28
      + subratings.damage * 0.19
      + subratings.survival * 0.18
      + subratings.kast * 0.17
      + subratings.multi * 0.08
      + subratings.swing * 0.10;
    const ratingPro3 = clamp(shrinkTowardAverage(ratingPro3Raw, rounds), 0.18, 2.25);
    return {
      player, ratingPro2, ratingPro3, subratings,
      adjustedKast, adjustedSurvival, ecoFactor, swingRaw,
      pureLostSaves: safe(context.ALL.pureLostSaves),
      flashAssists: safe(context.flashAssists),
      roundEndSwing: safe(context.roundEndSwing) / rounds,
    };
  });

  const rated = raw.map((row) => ({
    name: row.player.name,
    team_key: row.player.team_key,
    rating_pro_2: Number(row.ratingPro2.toFixed(2)),
    rating_pro_3: Number(row.ratingPro3.toFixed(2)),
    round_swing: Number(row.swingRaw.toFixed(3)),
    round_end_swing: Number(row.roundEndSwing.toFixed(3)),
    eco_factor: Number(row.ecoFactor.toFixed(3)),
    adjusted_kast: Number(row.adjustedKast.toFixed(1)),
    adjusted_survival: Number((row.adjustedSurvival * 100).toFixed(1)),
    pure_lost_saves: row.pureLostSaves,
    flash_assists: row.flashAssists,
    subratings: Object.fromEntries(Object.entries(row.subratings).map(([key, value]) => [key, Number(value.toFixed(2))])),
    confidence: rounds >= 18 && contextCoverage >= 0.8 && safe(row.player.adr) > 0 ? "high" : rounds >= 10 && contextCoverage >= 0.5 ? "medium" : "low",
    player: row.player,
  }));

  const loserKey = winnerKey === "a" ? "b" : winnerKey === "b" ? "a" : "";
  const heroPool = winnerKey ? rated.filter((row) => row.team_key === winnerKey) : rated;
  const culpritPool = loserKey ? rated.filter((row) => row.team_key === loserKey) : rated;
  const hero = [...heroPool].sort((a, b) => b.rating_pro_3 - a.rating_pro_3)[0] || null;
  const culprit = [...culpritPool].sort((a, b) => a.rating_pro_3 - b.rating_pro_3)[0] || null;
  return {
    players: rated.map((row) => ({ ...row, player: undefined })),
    hero: hero ? { ...hero, detail: verdictDetail(hero, "hero"), player: undefined } : null,
    culprit: culprit ? { ...culprit, detail: verdictDetail(culprit, "culprit"), player: undefined } : null,
    model_version: "rating-pro-estimated-hltv2-v3",
    model_note: "Estimated R2 使用公开社区估算式，以 KPR、DPR、APR、ADR、KAST 和 Impact 计算，便于和 csstats.gg 的 Estimated HLTV Rating 2.0 对照；RP3 继续加入逐回合经济、多杀、助攻/补枪与 Round Swing。两者都不是 HLTV 官方评分。",
  };
}
