import { describe, expect, it } from "vitest";
import { matchesLeagueRules } from "./leagueMatchFilter";

const match = { champion_name:"Ashe", game_mode:"CLASSIC", position:"BOTTOM", kills:12, deaths:4, assists:8, damage:25000 };

describe("matchesLeagueRules", () => {
  it("combines numeric and text rules with AND or OR", () => {
    const rules=[{field:"kda",operator:"gte",value:"4"},{field:"champion_name",operator:"contains",value:"ash"}];
    expect(matchesLeagueRules(match,rules,"and")).toBe(true);
    expect(matchesLeagueRules(match,[...rules,{field:"damage",operator:"gte",value:"30000"}],"and")).toBe(false);
    expect(matchesLeagueRules(match,[{field:"kills",operator:"gte",value:"20"},{field:"position",operator:"eq",value:"bottom"}],"or")).toBe(true);
  });
});
