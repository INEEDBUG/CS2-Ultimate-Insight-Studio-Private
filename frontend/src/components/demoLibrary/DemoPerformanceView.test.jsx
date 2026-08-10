import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import DemoPerformanceView from "./DemoPerformanceView";

const players = [
  { name: "Hero", team_key: "a", team_number: 2, kills: 25, deaths: 10, assists: 5, kd: 2.5, kpr: 1, dpr: 0.4, adr: 108, kast: 84, first_kills: 5, first_deaths: 1 },
  { name: "Mate", team_key: "a", team_number: 2, kills: 14, deaths: 14, assists: 4, kd: 1, kpr: 0.56, dpr: 0.56, adr: 72, kast: 70 },
  { name: "Culprit", team_key: "b", team_number: 3, kills: 6, deaths: 22, assists: 2, kd: 0.27, kpr: 0.24, dpr: 0.88, adr: 41, kast: 48, first_kills: 0, first_deaths: 6 },
  { name: "Opponent", team_key: "b", team_number: 3, kills: 18, deaths: 17, assists: 3, kd: 1.06, kpr: 0.72, dpr: 0.68, adr: 81, kast: 72 },
];

const rows = [
  { id: 1, map_name: "de_mirage", team_a_score: 13, team_b_score: 8, source: "Matchmaking", match_date: null, added_at: "2026-08-10T10:00:00Z", players },
  { id: 2, map_name: "de_nuke", team_a_score: 9, team_b_score: 13, source: "Matchmaking", match_date: "2026-08-09T12:30:00Z", added_at: "2026-08-10T10:00:00Z", players },
];

const detail = {
  ...rows[1],
  result: {
    analysis_workspace: {
      map_name: "de_nuke",
      team_a_name: "Alpha",
      team_b_name: "Bravo",
      team_a_score: 9,
      team_b_score: 13,
      players,
      rounds: Array.from({ length: 22 }, (_, index) => ({
        round_number: index + 1,
        winner_team_key: index < 9 ? "a" : "b",
        events: [],
      })),
    },
  },
};

describe("DemoPerformanceView", () => {
  test("separates unknown match time from import time and renders the full scoreboard", () => {
    render(
      <DemoPerformanceView
        rows={rows}
        selectedId={2}
        onSelect={vi.fn()}
        detail={detail}
        detailLoading={false}
        expectedPlayers={["Hero"]}
        onOpenAnalysis={vi.fn()}
        onSyncMatchTimes={vi.fn()}
        syncingMatchTimes={false}
      />,
    );

    expect(screen.getByText("比赛时间未知")).toBeTruthy();
    expect(screen.getByText("Steam 比赛时间")).toBeTruthy();
    expect(screen.getByText("Rating Pro 是本地透明估算，不是 HLTV 官方评分。比赛日期仅在 Steam Game Coordinator 返回 `matchtime` 时标记为真实比赛时间。")).toBeTruthy();
    expect(screen.getByText("本场英雄")).toBeTruthy();
    expect(screen.getByText("本场战犯")).toBeTruthy();
    expect(screen.getAllByText("Hero").length).toBeGreaterThan(0);
  });

  test("selects a recent match and can start match-time sync", () => {
    const onSelect = vi.fn();
    const onSyncMatchTimes = vi.fn();
    render(
      <DemoPerformanceView
        rows={rows}
        selectedId={2}
        onSelect={onSelect}
        detail={detail}
        detailLoading={false}
        expectedPlayers={[]}
        onOpenAnalysis={vi.fn()}
        onSyncMatchTimes={onSyncMatchTimes}
        syncingMatchTimes={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /mirage/i }));
    fireEvent.click(screen.getByRole("button", { name: "同步真实比赛时间" }));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onSyncMatchTimes).toHaveBeenCalledTimes(1);
  });
});
