import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeagueAutomationLabPage from "./LeagueAutomationLabPage";
import { fetchLeagueLabStatus, saveLeagueLabSettings } from "../api/leagueLabApi";

vi.mock("../api/leagueLabApi", () => ({
  fetchLeagueLabStatus: vi.fn(),
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
    saveLeagueLabSettings.mockResolvedValue({ ...status, settings: { ...status.settings, automation_enabled: true } });
  });

  it("shows the detected League client and persists the master switch", async () => {
    render(<LeagueAutomationLabPage />);
    expect(await screen.findByText("已连接：Tester")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "启用英雄联盟自动化" }));
    await waitFor(() => expect(saveLeagueLabSettings).toHaveBeenCalledWith(expect.objectContaining({ automation_enabled: true })));
  });
});
