import { describe, expect, test } from "vitest";
import { buildPlayerAssessment, buildRoundPlayerAssessments } from "./playerPerformance";

describe("player performance assessments", () => {
  test("rates strong full-match performance above weak performance", () => {
    const strong = buildPlayerAssessment({ kills: 28, deaths: 14, adr: 104, kast: 79, first_kills: 6, first_deaths: 2, three_kill_rounds: 2, clutch_wins: 1, trade_kills: 5 }, 24);
    const weak = buildPlayerAssessment({ kills: 8, deaths: 21, adr: 49, kast: 51, first_kills: 1, first_deaths: 6 }, 24);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.strengths.length).toBeGreaterThan(0);
    expect(weak.improvements).toContain("减少无效对枪和首死");
  });

  test("builds round assessments for every roster player", () => {
    const results = buildRoundPlayerAssessments({
      winner_team_key: "a",
      events: [
        { type: "kill", actor: "Ace", target: "Beta", headshot: true },
        { type: "kill", actor: "Ace", target: "Gamma" },
        { type: "plant", actor: "Ace" },
      ],
    }, [
      { name: "Ace", team_key: "a" },
      { name: "Beta", team_key: "b" },
      { name: "Gamma", team_key: "b" },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ name: "Ace", kills: 2, label: "回合关键先生" });
    expect(results.find((item) => item.name === "Beta")?.deaths).toBe(1);
  });
});
