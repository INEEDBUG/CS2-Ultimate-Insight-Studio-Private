import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeagueDetailedMatchCard from "./LeagueDetailedMatchCard";
import { fetchLeagueMatchDetails, fetchLeagueReplay } from "../../api/leagueLabApi";

vi.mock("../../api/leagueLabApi", () => ({
  deleteLeaguePlayerEncounter: vi.fn(),
  downloadLeagueReplay: vi.fn(),
  fetchLeagueMatchDetails: vi.fn(),
  fetchLeagueReplay: vi.fn(),
  watchLeagueReplay: vi.fn(),
}));

const match = {
  game_id: 1001,
  participant_puuid: "self",
  team_id: 100,
  champion_id: 1,
  champion_name: "安妮",
  spell1_id: 4,
  spell2_id: 14,
  kills: 10,
  deaths: 2,
  assists: 8,
  damage: 20000,
  cs: 180,
  gold: 12000,
  duration_seconds: 1800,
  played_at: 1786600000000,
  game_mode: "CLASSIC",
  win: true,
  items: [1001, 1002],
  participants: [
    { puuid: "self", team_id: 100, champion_id: 1, champion_name: "安妮", game_name: "自己", kills: 10, deaths: 2, assists: 8, damage: 20000, cs: 180, gold: 12000, win: true, items: [1001] },
    { puuid: "ally", team_id: 100, champion_id: 2, champion_name: "奥拉夫", game_name: "队友", kills: 5, deaths: 4, assists: 7, damage: 12000, cs: 140, gold: 9000, win: true, items: [1002] },
    { puuid: "enemy", team_id: 200, champion_id: 3, champion_name: "加里奥", game_name: "对手", kills: 4, deaths: 8, assists: 3, damage: 9000, cs: 150, gold: 8000, win: false, items: [1003] },
  ],
};

describe("LeagueDetailedMatchCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLeagueReplay.mockResolvedValue({ enabled: false });
    fetchLeagueMatchDetails.mockResolvedValue({ source: "lcu", frame_count: 30, event_count: 120, frames: [], events: [], participants: [] });
  });

  it("expands into both team scoreboards and opens a participant", async () => {
    const onOpenPlayer = vi.fn();
    render(<LeagueDetailedMatchCard match={match} onOpenPlayer={onOpenPlayer} />);

    fireEvent.click(screen.getByRole("button", { name: "展开战绩详情" }));
    expect(await screen.findByText("队伍 100 · 胜利")).toBeTruthy();
    expect(screen.getByText("队伍 200 · 失败")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /队友/ }).at(-1));
    expect(onOpenPlayer).toHaveBeenCalledWith("ally");
  });

  it("loads timeline details only when that tab is opened", async () => {
    render(<LeagueDetailedMatchCard match={match} />);
    fireEvent.click(screen.getByRole("button", { name: "展开战绩详情" }));
    expect(fetchLeagueMatchDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "时间线" }));
    await waitFor(() => expect(fetchLeagueMatchDetails).toHaveBeenCalledWith(1001, "auto"));
    expect(await screen.findByText("120")).toBeTruthy();
  });
});
