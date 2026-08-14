import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLeagueLabStatus, fetchLeagueOngoingGame } from "../../api/leagueLabApi";
import LeagueOngoingGame from "./LeagueOngoingGame";

vi.mock("../../api/leagueLabApi", () => ({
  fetchLeagueLabStatus: vi.fn(),
  fetchLeagueOngoingGame: vi.fn(),
}));

describe("LeagueOngoingGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLeagueLabStatus.mockResolvedValue({ settings: {} });
    fetchLeagueOngoingGame.mockResolvedValue({
      available: true,
      query_stage: "lobby",
      show_match_history_item_border: true,
      players: [{
        puuid: "player-1",
        team: "LOBBY",
        champion_id: 0,
        champion_name: "",
        summoner: { gameName: "Tester", profileIconId: 12 },
        recent: { matches: 3, wins: 2, average_kda: 4.2, akari_score: 7.5 },
        champion_usage: { mode: "none" },
        performance_tags: [],
      }],
    });
  });

  it("renders lobby-stage players with a single profile icon and opens the player", async () => {
    const onOpenPlayer = vi.fn();
    render(<LeagueOngoingGame onOpenPlayer={onOpenPlayer}/>);

    expect(await screen.findByText("当前房间")).toBeTruthy();
    expect(screen.getByText("房间阶段已开始分析当前队伍；进入英雄选择后会自动补全对手、英雄与分路。")).toBeTruthy();
    expect(screen.getAllByAltText("召唤师头像")).toHaveLength(1);
    expect(screen.getByText(/Akari 7.5/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tester/ }));
    expect(onOpenPlayer).toHaveBeenCalledWith("player-1");
    await waitFor(() => expect(fetchLeagueOngoingGame).toHaveBeenCalled());
  });
});
