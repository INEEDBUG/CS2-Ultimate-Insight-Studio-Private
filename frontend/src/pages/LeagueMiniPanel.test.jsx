import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeagueMiniPanel from "./LeagueMiniPanel";
import { fetchLeagueLabStatus } from "../api/leagueLabApi";

const windowActions = {
  close: vi.fn(),
  minimize: vi.fn(),
  setAlwaysOnTop: vi.fn(),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowActions,
}));

vi.mock("../api/leagueLabApi", () => ({
  fetchLeagueLabStatus: vi.fn(),
  rerollLeagueChampion: vi.fn(),
  runLeagueLabAction: vi.fn(),
  saveLeagueLabSettings: vi.fn(),
  selectLeagueChampionSkin: vi.fn(),
  setLeagueAutoSelectTemporarilyDisabled: vi.fn(),
  dodgeLeagueChampSelect: vi.fn(),
  swapLeagueBenchChampion: vi.fn(),
}));

vi.mock("../api/api", () => ({
  getLeagueChampionIconUrl: (id) => `champion-${id}.png`,
}));

describe("LeagueMiniPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLeagueLabStatus.mockResolvedValue({
      connected: true,
      phase: "ChampSelect",
      summoner_name: "Tester",
      settings: { mini_opacity: 1 },
      champ_select: { my_team: [{ cell_id: 1, champion_id: 22 }], my_actions: [{ id: 1, type: "pick", champion_id: 22, in_progress: true }] },
    });
  });

  it("renders client state instead of a blank auxiliary window", async () => {
    render(<LeagueMiniPanel />);
    expect(await screen.findByText("英雄选择")).toBeTruthy();
    expect(screen.getByText("Tester")).toBeTruthy();
    expect(screen.getByAltText("22").getAttribute("src")).toBe("champion-22.png");
    expect(screen.getByText("我的英雄选择流程")).toBeTruthy();
    expect(screen.getByText("进行中")).toBeTruthy();
  });

  it("exposes working pin, minimize, close and refresh controls", async () => {
    render(<LeagueMiniPanel />);
    await screen.findByText("英雄选择");

    fireEvent.click(screen.getByRole("button", { name: "取消置顶" }));
    await waitFor(() => expect(windowActions.setAlwaysOnTop).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByRole("button", { name: "最小化 Mini" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭 Mini" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "刷新 Mini" })));

    expect(windowActions.minimize).toHaveBeenCalledOnce();
    expect(windowActions.close).toHaveBeenCalledOnce();
    expect(fetchLeagueLabStatus).toHaveBeenCalledTimes(2);
  });
});
