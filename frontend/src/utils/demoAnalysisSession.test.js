import { describe, expect, test, vi } from "vitest";
import {
  demoAnalysisSessionIdentity,
  resetDemoAnalysisDefaultView,
  setDemoAnalysisDefaultView,
} from "./demoAnalysisSession";

describe("demoAnalysisSession", () => {
  test("resets a Demo-library re-entry to Highlights", () => {
    const storage = { removeItem: vi.fn() };
    const demo = { id: 7, path: "C:/demos/cached.dem" };

    resetDemoAnalysisDefaultView([demo], storage);

    expect(storage.removeItem).toHaveBeenCalledWith(
      `cs2-session-demo-analysis:${demoAnalysisSessionIdentity(demo)}:tab`,
    );
  });

  test("opens a freshly parsed Demo directly on the scoreboard", () => {
    const storage = { setItem: vi.fn() };
    const demo = { id: 7, path: "C:/demos/cached.dem" };

    setDemoAnalysisDefaultView([demo], "overview", storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      `cs2-session-demo-analysis:${demoAnalysisSessionIdentity(demo)}:tab`,
      JSON.stringify("overview"),
    );
  });
});
