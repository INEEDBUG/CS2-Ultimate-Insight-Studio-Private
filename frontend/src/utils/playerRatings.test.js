import { describe, expect, test } from "vitest";
import { buildMatchRatingPro } from "./playerRatings";

const player = (name, team, stats) => ({
  name, team_key: team, average_equipment_value: 4000,
  kills: 15, deaths: 15, assists: 4, kpr: 0.68, dpr: 0.68,
  adr: 75, kast: 70, first_kills: 2, first_deaths: 2,
  two_kill_rounds: 2, three_kill_rounds: 0, four_kill_rounds: 0,
  five_kill_rounds: 0, clutch_wins: 0, trade_kills: 2, ...stats,
});

const round = (number, winner = "a", events = [], equipment = [25000, 25000]) => ({
  round_number: number,
  winner_team_key: winner,
  team_a_side: number <= 12 ? "CT" : "T",
  team_b_side: number <= 12 ? "T" : "CT",
  team_a_equipment_value: equipment[0],
  team_b_equipment_value: equipment[1],
  events,
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
    expect(result.model_version).toContain("public-principles-v2");
    expect(result.players[0].subratings).toMatchObject({
      kill: expect.any(Number), damage: expect.any(Number), survival: expect.any(Number),
      kast: expect.any(Number), multi: expect.any(Number), swing: expect.any(Number),
    });
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

  test("removes pure lost-round saves from adjusted KAST and discounts survival credit", () => {
    const data = {
      team_a_score: 0, team_b_score: 2,
      players: [
        player("Saver", "a", { kills: 0, deaths: 0, kpr: 0, dpr: 0, kast: 100 }),
        player("Fighter", "a", { kills: 1, deaths: 2, kpr: 0.5, dpr: 1, kast: 50 }),
        player("Enemy", "b", { kills: 2, deaths: 1, kpr: 1, dpr: 0.5, kast: 100 }),
      ],
      rounds: [
        round(1, "b", [{ type: "kill", tick: 10, actor: "Enemy", target: "Fighter" }]),
        round(2, "b", [{ type: "kill", tick: 20, actor: "Fighter", target: "Enemy" }, { type: "kill", tick: 30, actor: "Enemy", target: "Fighter" }]),
      ],
    };
    const saver = buildMatchRatingPro(data).players.find((row) => row.name === "Saver");
    expect(saver.pure_lost_saves).toBe(2);
    expect(saver.adjusted_kast).toBe(0);
    expect(saver.adjusted_survival).toBe(35);
    expect(saver.rating_pro_2).toBeLessThan(1);
  });

  test("credits a quick revenge as a trade and shares flash-assisted swing", () => {
    const data = {
      tick_rate: 64, team_a_score: 1, team_b_score: 0,
      players: [player("Entry", "a"), player("Trader", "a"), player("Flasher", "a"), player("Enemy", "b")],
      rounds: [round(1, "a", [
        { type: "kill", tick: 100, actor: "Enemy", target: "Entry" },
        { type: "kill", tick: 180, actor: "Trader", target: "Enemy", assister: "Flasher", is_flash_assist: true },
      ])],
    };
    const result = buildMatchRatingPro(data);
    const flasher = result.players.find((row) => row.name === "Flasher");
    const trader = result.players.find((row) => row.name === "Trader");
    expect(flasher.flash_assists).toBe(1);
    expect(flasher.round_swing).toBeGreaterThan(0);
    expect(trader.round_swing).toBeGreaterThan(flasher.round_swing);
  });

  test("shrinks very small samples toward 1.00", () => {
    const oneRound = buildMatchRatingPro({
      team_a_score: 1, team_b_score: 0,
      players: [player("Ace", "a", { kills: 5, deaths: 0, kpr: 5, dpr: 0, adr: 500, five_kill_rounds: 1 }), player("Enemy", "b")],
      rounds: [round(1, "a", [{ type: "kill", tick: 1, actor: "Ace", target: "Enemy" }])],
    });
    const ace = oneRound.players.find((row) => row.name === "Ace");
    expect(ace.rating_pro_3).toBeGreaterThan(1);
    expect(ace.rating_pro_3).toBeLessThan(1.6);
    expect(ace.confidence).toBe("low");
  });
});
