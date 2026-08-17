import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeagueMiniPanel from "./LeagueMiniPanel";
import { acceptLeagueChampSelectTrade, cancelLeagueAutoAccept, declineLeagueChampSelectTrade, declineLeagueReadyCheck, fetchLeagueLabStatus, rerollLeagueChampion, stopLeagueMatchmaking } from "../api/leagueLabApi";

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
  acceptLeagueChampSelectTrade: vi.fn(),
  cancelLeagueAutoAccept: vi.fn(),
  declineLeagueChampSelectTrade: vi.fn(),
  declineLeagueReadyCheck: vi.fn(),
  rerollLeagueChampion: vi.fn(),
  runLeagueLabAction: vi.fn(),
  saveLeagueLabSettings: vi.fn(),
  selectLeagueChampionSkin: vi.fn(),
  setLeagueAutoSelectTemporarilyDisabled: vi.fn(),
  stopLeagueMatchmaking: vi.fn(),
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

  it.each([
    ["未连接", { connected: false, phase: "" }],
    ["房间中", { connected: true, phase: "Lobby", matchmaking_status: "countdown" }],
    ["正在匹配", { connected: true, phase: "Matchmaking", matchmaking_status: "searching" }],
    ["对局已找到", { connected: true, phase: "ReadyCheck", action_countdown: { label: "自动接受对局", remaining_seconds: 2.5 } }],
  ])("renders a clear context card for %s", async (label, patch) => {
    fetchLeagueLabStatus.mockResolvedValue({
      connected: true,
      phase: "Lobby",
      summoner_name: "Tester",
      settings: { mini_opacity: 1, toolkit_account_actions_enabled: false },
      ...patch,
    });
    render(<LeagueMiniPanel />);
    const context = await screen.findByTestId("mini-phase-context");
    expect(context.textContent).toContain(label);
  });

  it("shows only evidence-backed phase timers and action progress", async () => {
    fetchLeagueLabStatus.mockResolvedValue({
      connected: true,
      phase: "ChampSelect",
      summoner_name: "Tester",
      settings: { mini_opacity: 1, toolkit_account_actions_enabled: false },
      champ_select: {
        timer_phase: "BAN_PICK",
        timer_deadline_at: Date.now() / 1000 + 20,
        my_actions: [
          { id: 1, type: "pick", champion_id: 22, completed: true, in_progress: false },
          { id: 2, type: "ban", champion_id: 0, completed: false, in_progress: true },
        ],
      },
      action_countdown: { label: "自动选择 / 禁用英雄", remaining_seconds: 3.5 },
    });
    render(<LeagueMiniPanel />);
    expect(await screen.findByTestId("mini-phase-countdown")).toBeTruthy();
    expect(screen.getByTestId("mini-action-countdown").textContent).toContain("自动选择 / 禁用英雄");
    expect(screen.getByTestId("mini-action-progress").textContent).toContain("1/2 已完成");
  });

  it("disables every manual client-write control when account writes are off", async () => {
    fetchLeagueLabStatus.mockResolvedValue({
      connected: true,
      phase: "ChampSelect",
      summoner_name: "Tester",
      settings: { mini_opacity: 1, toolkit_account_actions_enabled: false },
      champ_select: {
        bench_enabled: true,
        allow_rerolling: true,
        rerolls_remaining: 1,
        bench_champions: [22],
        skin_selector: { available: true, disabled: false, skins: [{ id: 11, name: "Test Skin" }] },
      },
    });
    render(<LeagueMiniPanel />);
    await screen.findByTestId("mini-account-actions-disabled");
    expect(screen.getByRole("button", { name: "立即接受" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "立即秒退" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /重随/ }).disabled).toBe(true);
    expect(screen.getByAltText("22").parentElement.disabled).toBe(true);
    expect(screen.getByRole("combobox").disabled).toBe(true);
  });

  it("keeps the previous status when reroll returns an empty response", async () => {
    const current = {
      connected: true,
      phase: "ChampSelect",
      summoner_name: "Tester",
      settings: { mini_opacity: 1, toolkit_account_actions_enabled: true },
      champ_select: { bench_enabled: true, allow_rerolling: true, rerolls_remaining: 1, bench_champions: [22] },
    };
    fetchLeagueLabStatus.mockResolvedValue(current);
    rerollLeagueChampion.mockResolvedValue(null);
    render(<LeagueMiniPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /重随/ }));
    await waitFor(() => expect(rerollLeagueChampion).toHaveBeenCalledOnce());
    expect(await screen.findByText(/重随请求已发送.*正在刷新状态/)).toBeTruthy();
    expect(screen.getByText("Tester")).toBeTruthy();
  });

  it("renders ReadyCheck evidence and keeps decline behind the toolkit gate while allowing local cancellation", async () => {
    const current = {
      connected: true,
      phase: "ReadyCheck",
      summoner_name: "Tester",
      settings: { mini_opacity: 1, toolkit_account_actions_enabled: false },
      ready_check: { state: "InProgress", player_response: "None", can_accept: true, can_decline: true, timer: { remaining_seconds: 4 } },
      action_plan: { accept_due: { label: "自动接受对局", remaining_seconds: 2.5 }, phase_due: null, champion_due: [] },
    };
    fetchLeagueLabStatus.mockResolvedValue(current);
    cancelLeagueAutoAccept.mockResolvedValue(null);
    render(<LeagueMiniPanel />);

    expect(await screen.findByTestId("mini-ready-check")).toBeTruthy();
    expect(screen.getByTestId("mini-ready-check").textContent).toContain("InProgress");
    expect(screen.getByTestId("mini-action-plan").textContent).toContain("自动接受对局");
    expect(screen.getByRole("button", { name: "拒绝对局" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "取消自动接受" }));
    await waitFor(() => expect(cancelLeagueAutoAccept).toHaveBeenCalledOnce());
    expect(await screen.findByText(/取消本次自动接受.*正在刷新状态/)).toBeTruthy();
    expect(declineLeagueReadyCheck).not.toHaveBeenCalled();
  });

  it("sends a gated ReadyCheck decline and never hides the API error", async () => {
    const current = {
      connected: true,
      phase: "ReadyCheck",
      summoner_name: "Tester",
      settings: { mini_opacity: 1, toolkit_account_actions_enabled: true },
      ready_check: { state: "InProgress", player_response: "None", can_accept: false, can_decline: true, timer: { remaining_seconds: 4 } },
    };
    fetchLeagueLabStatus.mockResolvedValue(current);
    declineLeagueReadyCheck.mockRejectedValue({ response: { data: { detail: "ReadyCheck 已结束" } } });
    render(<LeagueMiniPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "拒绝对局" }));
    await waitFor(() => expect(declineLeagueReadyCheck).toHaveBeenCalledOnce());
    expect(await screen.findByText("ReadyCheck 已结束")).toBeTruthy();
  });

  it("renders matchmaking search evidence and only exposes stop while the client is queued", async () => {
    const current = {
      connected: true,
      phase: "Matchmaking",
      summoner_name: "Tester",
      settings: { mini_opacity: 1, toolkit_account_actions_enabled: false },
      matchmaking_search: { is_currently_in_queue: true, search_state: "Searching", time_in_queue: 12, estimated_queue_time: 30, queue_id: 420, errors: [{ code: "WAIT", message: "等待服务器" }] },
    };
    fetchLeagueLabStatus.mockResolvedValue(current);
    render(<LeagueMiniPanel />);
    expect(await screen.findByTestId("mini-matchmaking-search")).toBeTruthy();
    expect(screen.getByTestId("mini-matchmaking-search").textContent).toContain("等待服务器");
    expect(screen.getByRole("button", { name: "停止匹配" }).disabled).toBe(true);
    expect(stopLeagueMatchmaking).not.toHaveBeenCalled();
  });

  it("renders actionable and stale champion trades, then refreshes a null action response", async () => {
    const current = {
      connected: true,
      phase: "ChampSelect",
      summoner_name: "Tester",
      settings: { mini_opacity: 1, toolkit_account_actions_enabled: true },
      champ_select: {
        trades: [
          { id: 17, state: "AVAILABLE", actionable: true, can_accept: true, can_decline: true, initiated_by_local_player: false, other_player: { game_name: "Ally" } },
          { id: 18, state: "INVALID", actionable: false, can_accept: false, can_decline: false, actionability: { reason: "state-not-actionable" } },
        ],
      },
    };
    fetchLeagueLabStatus.mockResolvedValue(current);
    acceptLeagueChampSelectTrade.mockResolvedValue(null);
    render(<LeagueMiniPanel />);
    expect(await screen.findByTestId("mini-trades")).toBeTruthy();
    expect(screen.getByText("Ally 的请求")).toBeTruthy();
    expect(screen.getByTestId("mini-trade-18").textContent).toContain("不可操作");
    fireEvent.click(screen.getByRole("button", { name: "接受换英雄" }));
    await waitFor(() => expect(acceptLeagueChampSelectTrade).toHaveBeenCalledWith(17));
    expect(await screen.findByText(/已接受换英雄请求.*正在刷新状态/)).toBeTruthy();
    expect(declineLeagueChampSelectTrade).not.toHaveBeenCalled();
  });

  it("shows action_plan champion deadlines without manufacturing a countdown", async () => {
    fetchLeagueLabStatus.mockResolvedValue({
      connected: true,
      phase: "ChampSelect",
      summoner_name: "Tester",
      settings: { mini_opacity: 1, toolkit_account_actions_enabled: true },
      action_plan: {
        accept_due: null,
        phase_due: { label: "自动返回房间", remaining_seconds: null },
        champion_due: [{ action_id: "pick-1", label: "自动选择 / 禁用英雄", remaining_seconds: 3 }],
      },
      champ_select: { my_actions: [] },
    });
    render(<LeagueMiniPanel />);
    expect(await screen.findByTestId("mini-action-plan")).toBeTruthy();
    expect(screen.getByTestId("mini-action-plan").textContent).toContain("自动选择 / 禁用英雄");
    expect(screen.getByTestId("mini-action-plan").textContent).toContain("已暂停 / 等待状态");
  });
});
