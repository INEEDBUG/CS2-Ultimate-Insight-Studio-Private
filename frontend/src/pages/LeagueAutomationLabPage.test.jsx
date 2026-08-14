import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeagueAutomationLabPage from "./LeagueAutomationLabPage";
import { fetchLeagueClientInstallations, fetchLeagueClients, fetchLeagueLabStatus, fetchLeagueMatches, fetchLeagueReplay, saveLeagueLabSettings } from "../api/leagueLabApi";

vi.mock("../api/leagueLabApi", () => ({
  fetchLeagueLabStatus: vi.fn(),
  fetchLeagueClients: vi.fn(),
  fetchLeagueClientInstallations: vi.fn(),
  fetchLeagueMatches: vi.fn(),
  fetchLeagueReplay: vi.fn(),
  fetchLeagueLoadoutCatalog: vi.fn(),
  fetchLeagueMatchDetails: vi.fn(),
  selectLeagueClient: vi.fn(),
  launchLeagueClient: vi.fn(),
  saveLeagueLabSettings: vi.fn(),
  runLeagueLabAction: vi.fn(),
}));

const status = {
  connected: true,
  phase: "Lobby",
  summoner_name: "Tester",
  platform_id: "HN1",
  settings: {
    automation_enabled: false,
    auto_accept_enabled: false,
    auto_accept_delay_seconds: 1,
    play_again_enabled: false,
    auto_reconnect_enabled: false,
    invitation_strategy: "ignore",
  },
};

describe("LeagueAutomationLabPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLeagueLabStatus.mockResolvedValue(status);
    fetchLeagueClients.mockResolvedValue({ clients: [], selected_pid: 0 });
    fetchLeagueClientInstallations.mockResolvedValue({ installations: [] });
    fetchLeagueMatches.mockResolvedValue({ matches: [{ game_id: 1001, champion_id: 1, champion_name: "安妮", participant_puuid: "self", team_id: 100, win: true, participants: [] }] });
    fetchLeagueReplay.mockResolvedValue({ enabled: false });
    saveLeagueLabSettings.mockResolvedValue({ ...status, settings: { ...status.settings, automation_enabled: true } });
  });

  it("shows the detected League client and persists the master switch", async () => {
    render(<LeagueAutomationLabPage />);
    expect(await screen.findByText("已连接：Tester")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "启用英雄联盟自动化" }));
    await waitFor(() => expect(saveLeagueLabSettings).toHaveBeenCalledWith(expect.objectContaining({ automation_enabled: true })));
  });

  it("uses the detailed match card in the current-account history", async () => {
    render(<LeagueAutomationLabPage />);
    await screen.findByText("已连接：Tester");
    fireEvent.click(screen.getByRole("button", { name: "我的战绩" }));
    await waitFor(() => expect(fetchLeagueMatches).toHaveBeenCalledWith(20));
    expect(await screen.findByRole("button", { name: "展开战绩详情" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "结算后自动刷新战绩" })).toBeTruthy();
  });
});
