import { describe, expect, it } from "vitest";
import {
  hasLeagueChampionConfig,
  leagueOpggItemGroups,
  leagueOpggModeForGameMode,
  leagueOpggPositionForAssignedPosition,
  leagueOpggStats,
} from "./leagueOpgg";

describe("League OP.GG helpers", () => {
  it("maps queue modes and assigned positions", () => {
    expect(leagueOpggModeForGameMode("KIWI")).toBe("aram");
    expect(leagueOpggModeForGameMode("CHERRY")).toBe("arena");
    expect(leagueOpggPositionForAssignedPosition("UTILITY", "ranked")).toBe("support");
    expect(leagueOpggPositionForAssignedPosition("TOP", "aram")).toBe("none");
  });

  it("prefers position stats and falls back to average stats", () => {
    const summary = { average_stats: { rank: 9 }, positions: [{ name: "TOP", stats: { rank: 2 } }] };
    expect(leagueOpggStats(summary, "top").rank).toBe(2);
    expect(leagueOpggStats(summary, "jungle").rank).toBe(9);
  });

  it("builds bounded item-set groups", () => {
    const groups = leagueOpggItemGroups({
      starter_items: [{ ids: [1054, 2003], pick_rate: 0.5 }],
      boots: [{ ids: [3006] }],
      core_items: [{ ids: [6631, 3046], pick_rate: 0.25 }],
      last_items: Array.from({ length: 25 }, (_, index) => ({ ids: [3000 + index] })),
    });
    expect(groups.map((row) => row.title.split(" ")[0])).toEqual(["出门装", "鞋子", "核心装", "后期可选"]);
    expect(groups.at(-1).item_ids).toHaveLength(20);
  });

  it("detects existing integrated champion configuration", () => {
    expect(hasLeagueChampionConfig({ auto_champion_config_enabled: true, champion_loadouts: [{ champion_id: 86 }] }, 86)).toBe(true);
    expect(hasLeagueChampionConfig({ auto_champion_config_enabled: false, champion_loadouts: [{ champion_id: 86 }] }, 86)).toBe(false);
  });
});
