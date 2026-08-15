import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import LeagueAutomationLabPage from "./LeagueAutomationLabPage";
import { fetchLeagueClientInstallations, fetchLeagueClients, fetchLeagueLabStatus, fetchLeagueMatches, fetchLeagueOngoingGame, fetchLeagueReplay, saveLeagueLabSettings } from "../api/leagueLabApi";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

vi.mock("../api/leagueLabApi", () => ({
  fetchLeagueLabStatus: vi.fn(),
  fetchLeagueClients: vi.fn(),
  fetchLeagueClientInstallations: vi.fn(),
  fetchLeagueMatches: vi.fn(),
  fetchLeagueOngoingGame: vi.fn(),
  fetchLeagueReplay: vi.fn(),
  fetchLeagueLoadoutCatalog: vi.fn(),
  fetchLeagueMatchDetails: vi.fn(),
  selectLeagueClient: vi.fn(),
  launchLeagueClient: vi.fn(),
  saveLeagueLabSettings: vi.fn(),
  runLeagueLabAction: vi.fn(),
}));

vi.mock("../components/league/LeagueOngoingGame", () => ({
  default: () => <div>实时对局内容</div>,
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
    fetchLeagueOngoingGame.mockResolvedValue({ available: false, players: [] });
    fetchLeagueReplay.mockResolvedValue({ enabled: false });
    saveLeagueLabSettings.mockResolvedValue({ ...status, settings: { ...status.settings, automation_enabled: true } });
  });

  it("shows the detected League client and persists the master switch", async () => {
    render(<LeagueAutomationLabPage />);
    expect(await screen.findByText("已连接：Tester")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "启用英雄联盟自动化" }));
    await waitFor(() => expect(saveLeagueLabSettings).toHaveBeenCalledWith(expect.objectContaining({ automation_enabled: true })));
    expect(screen.getByLabelText("Mini 不透明度").value).toBe("1");
    expect(screen.getByLabelText("OP.GG 不透明度").value).toBe("1");
    expect(screen.getByRole("switch", { name: "Mini 显示皮肤选择器" })).toBeTruthy();
  });

  it("offers a confirmed administrator restart when an elevated WeGame client is visible", async () => {
    fetchLeagueLabStatus.mockResolvedValueOnce({
      ...status,
      connected: false,
      client_window_detected: true,
      requires_elevation: true,
      summoner_name: "",
    });
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    render(<LeagueAutomationLabPage />);
    expect(await screen.findByText("已发现客户端，但权限不足")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "以管理员身份重启并连接" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("restart_as_administrator"));
  });

  it("uses the detailed match card in the current-account history", async () => {
    render(<LeagueAutomationLabPage />);
    await screen.findByText("已连接：Tester");
    fireEvent.click(screen.getByRole("button", { name: "我的战绩" }));
    await waitFor(() => expect(fetchLeagueMatches).toHaveBeenCalledWith(20));
    expect(await screen.findByRole("button", { name: "展开战绩详情" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "结算后自动刷新战绩" })).toBeTruthy();
  });

  it("exposes configurable ongoing-game analysis controls", async () => {
    render(<LeagueAutomationLabPage />);
    await screen.findByText("已连接：Tester");
    fireEvent.click(screen.getByRole("button", { name: "实时对局" }));
    expect(screen.getByRole("switch", { name: "在房间阶段分析队友" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "所有玩家都分析打野路线" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "战绩条目强调边框" })).toBeTruthy();
    expect(screen.getByLabelText("实时玩家排序").value).toBe("default");
    expect(screen.getByLabelText("实时英雄数据来源").value).toBe("recent");
    expect(screen.getByLabelText("实时战绩样本范围").value).toBe("current");
    expect(screen.getByLabelText("实时详情时间线数量").value).toBe("20");
    expect(screen.getByRole("switch", { name: "显示打野路线画像" })).toBeTruthy();
    expect(screen.getByLabelText("实时对局战绩读取数").value).toBe("20");
    expect(screen.getByLabelText("打野画像分析场数").value).toBe("4");
    expect(screen.getByRole("switch", { name: "显示连胜 / 连败标签" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "显示表现画像标签" })).toBeTruthy();
    expect(screen.getByLabelText("实时对局并发查询数").value).toBe("10");
    expect(screen.getByLabelText("组排推断阈值").value).toBe("5");
  });
});
