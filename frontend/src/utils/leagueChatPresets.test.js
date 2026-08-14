import { describe, expect, it } from "vitest";
import { buildLeagueFormPreset, buildLeaguePremadePreset } from "./leagueChatPresets";

const players = [
  { summoner:{gameName:"Alpha"}, champion_name:"阿狸", recent:{matches:10,wins:6}, champion_usage:{matches:4,average_kda:3.125}, premade_group:1 },
  { summoner:{gameName:"Beta"}, champion_name:"盖伦", recent:{matches:5,wins:2}, champion_usage:{matches:2,average_kda:1.5}, premade_group:1 },
];

describe("League chat preset generators", () => {
  it("builds recent-form lines without identifiers", () => {
    expect(buildLeagueFormPreset(players)[0]).toBe("Alpha：近10场 60%胜率，阿狸 4场 / KDA 3.13");
  });

  it("groups inferred premades", () => {
    expect(buildLeaguePremadePreset(players)).toEqual(["组排 A：Alpha、Beta"]);
  });
});
