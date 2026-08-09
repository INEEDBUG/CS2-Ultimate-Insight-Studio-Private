import { describe, expect, test } from "vitest";
import { buildMatchRatingPro } from "./playerRatings";

const player = (name, team, stats) => ({
  name, team_key: team, average_equipment_value: 4000,
  kills: 15, deaths: 15, assists: 4, kpr: 0.68, dpr: 0.68,
  adr: 75, kast: 70, first_kills: 2, first_deaths: 2,
  two_kill_rounds: 2, three_kill_rounds: 0, four_kill_rounds: 0,
  five_kill_rounds: 0, clutch_wins: 0, trade_kills: 2, ...stats,
});

describe("Rating Pro match model", () => {
  test("ranks the winner's impact leader as hero and the loser's weakest player as culprit", () => {
    const data = {
      team_a_score: 13, team_b_score: 8,
      players: [
        player("Hero", "a", { kills: 25, deaths: 10, kpr: 1.05, dpr: 0.42, adr: 108, kast: 86, first_kills: 6, clutch_wins: 1 }),
        player("Mate", "a", {}),
        player("Culprit", "b", { kills: 7, deaths: 20, kpr: 0.3, dpr: 0.86, adr: 42, kast: 48, first_kills: 0, first_deaths: 6 }),
        player("Opponent", "b", {}),
      ],
      rounds: Array.from({ length: 21 }, (_, index) => ({ round_number: index + 1, events: [] })),
    };
    const result = buildMatchRatingPro(data);
    expect(result.hero.name).toBe("Hero");
    expect(result.culprit.name).toBe("Culprit");
    expect(result.players.find((row) => row.name === "Hero").rating_pro_3).toBeGreaterThan(1);
    expect(result.players.find((row) => row.name === "Culprit").rating_pro_2).toBeLessThan(1);
    expect(result.model_note).toContain("不是 HLTV 官方评分");
  });

  test("credits high-leverage kills and discounts a stronger economy", () => {
    const data = {
      team_a_score: 1, team_b_score: 0,
      players: [
        player("Closer", "a", { average_equipment_value: 2500 }),
        player("Rich", "a", { average_equipment_value: 6000 }),
        player("Enemy", "b", { average_equipment_value: 5000 }),
      ],
      rounds: [{
        team_a_equipment_value: 12000, team_b_equipment_value: 25000,
        events: [
          { type: "kill", tick: 1, actor: "Closer", target: "Enemy" },
        ],
      }],
    };
    const result = buildMatchRatingPro(data);
    const closer = result.players.find((row) => row.name === "Closer");
    const rich = result.players.find((row) => row.name === "Rich");
    expect(closer.round_swing).toBeGreaterThan(0);
    expect(closer.eco_factor).toBeGreaterThan(rich.eco_factor);
  });
});
