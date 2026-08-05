import { describe, expect, test } from "vitest";
import { replayTeamVisible } from "./ReplaySceneCanvas";

describe("replayTeamVisible", () => {
  test("shows both teams in global view", () => {
    expect(replayTeamVisible("a", "all")).toBe(true);
    expect(replayTeamVisible("b", "all")).toBe(true);
  });

  test("shows only the selected team in team view", () => {
    expect(replayTeamVisible("a", "a")).toBe(true);
    expect(replayTeamVisible("b", "a")).toBe(false);
  });
});
