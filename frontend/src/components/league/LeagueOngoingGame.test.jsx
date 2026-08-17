import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLeagueLabStatus, fetchLeagueMatchDetails, fetchLeagueOngoingGame } from "../../api/leagueLabApi";
import LeagueOngoingGame from "./LeagueOngoingGame";

vi.mock("../../api/leagueLabApi", () => ({
  fetchLeagueLabStatus: vi.fn(),
  fetchLeagueLoadoutCatalog: vi.fn(),
  fetchLeagueMatchDetails: vi.fn(),
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
    fetchLeagueMatchDetails.mockResolvedValue({ source: "lcu", frame_count: 0, event_count: 0, events: [], frames: [] });
  });

  it("renders lobby-stage players with a single profile icon and opens the player", async () => {
    const onOpenPlayer = vi.fn();
    render(<LeagueOngoingGame onOpenPlayer={onOpenPlayer}/>);

    expect(await screen.findByText("当前房间")).toBeTruthy();
    expect(screen.getByText("房间阶段已开始分析当前队伍；进入英雄选择后会自动补全对手、英雄与分路。")).toBeTruthy();
    expect(screen.getAllByAltText("召唤师头像")).toHaveLength(1);
    expect(screen.getByText(/Akari 7.5/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "打开 Tester 玩家中心" }));
    expect(onOpenPlayer).toHaveBeenCalledWith("player-1");
    await waitFor(() => expect(fetchLeagueOngoingGame).toHaveBeenCalled());
  });

  it("expands and collapses one player card without changing the player navigation", async () => {
    render(<LeagueOngoingGame />);

    const expand = await screen.findByRole("button", { name: "展开 Tester 详情" });
    expect(screen.queryByTestId("player-details")).toBeNull();
    fireEvent.click(expand);
    expect(await screen.findByTestId("player-details")).toBeTruthy();
    expect(screen.getByText("当前英雄使用")).toBeTruthy();
    expect(screen.getByText("近期对局")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起 Tester 详情" }));
    expect(screen.queryByTestId("player-details")).toBeNull();
  });

  it("shows tag explanations as visible text and a native tooltip", async () => {
    fetchLeagueOngoingGame.mockResolvedValueOnce({
      available: true,
      query_stage: "lobby",
      players: [{
        puuid: "player-1",
        team: "LOBBY",
        summoner: { gameName: "Tester", profileIconId: 12 },
        recent: { matches: 5, wins: 4, average_kda: 4.2, akari_score: 7.5 },
        champion_usage: { mode: "none" },
        performance_tags: [{ id: "hot", label: "近况强势", tone: "positive", title: "最近 5 场赢下 4 场。" }],
      }],
    });
    render(<LeagueOngoingGame />);
    fireEvent.click(await screen.findByRole("button", { name: "展开 Tester 详情" }));
    expect(await screen.findByTestId("player-tag-explanations")).toBeTruthy();
    expect(screen.getByText("最近 5 场赢下 4 场。")).toBeTruthy();
    expect(screen.getAllByTitle("最近 5 场赢下 4 场。").length).toBeGreaterThanOrEqual(2);
  });

  it("renders recent matches from the existing payload and loads detailed data only on demand", async () => {
    fetchLeagueOngoingGame.mockResolvedValueOnce({
      available: true,
      query_stage: "lobby",
      players: [{
        puuid: "player-1",
        team: "LOBBY",
        summoner: { gameName: "Tester", profileIconId: 12 },
        recent: { matches: 1, wins: 1, average_kda: 3, akari_score: 6 },
        champion_usage: { mode: "recent", matches: 1, wins: 1, average_kda: 3 },
        games: { games: [{
          gameId: 9001,
          gameCreation: 1786600000000,
          gameDuration: 1200,
          gameMode: "CLASSIC",
          queueId: 420,
          participantIdentities: [{ participantId: 1, player: { puuid: "player-1", gameName: "Tester" } }],
          participants: [{ participantId: 1, teamId: 100, championId: 1, spell1Id: 4, spell2Id: 14, stats: { kills: 8, deaths: 2, assists: 4, win: true, totalMinionsKilled: 120, totalDamageDealtToChampions: 18000, item0: 1001 } }],
        }] },
      }],
    });
    render(<LeagueOngoingGame />);
    fireEvent.click(await screen.findByRole("button", { name: "展开 Tester 详情" }));
    expect(await screen.findByTestId("player-recent-matches")).toBeTruthy();
    expect(fetchLeagueMatchDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "展开战绩详情" }));
    fireEvent.click(screen.getByRole("button", { name: "时间线" }));
    await waitFor(() => expect(fetchLeagueMatchDetails).toHaveBeenCalledWith(9001, "auto"));
  });

  it("keeps the expanded card useful when the payload has no recent matches", async () => {
    fetchLeagueOngoingGame.mockResolvedValueOnce({
      available: true,
      query_stage: "lobby",
      players: [{ puuid: "player-1", team: "LOBBY", summoner: { gameName: "Tester" }, recent: {}, champion_usage: { mode: "none" }, performance_tags: [] }],
    });
    render(<LeagueOngoingGame />);
    fireEvent.click(await screen.findByRole("button", { name: "展开 Tester 详情" }));
    expect(await screen.findByText("暂无可展示的近期对局；当前卡片只显示客户端已返回的聚合指标。"  )).toBeTruthy();
    expect(screen.getByText("当前 payload 没有排位明细。")).toBeTruthy();
    expect(screen.getByText("当前没有可解释的标签。")).toBeTruthy();
  });
});
