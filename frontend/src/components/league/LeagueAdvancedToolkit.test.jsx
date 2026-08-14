import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeagueAdvancedToolkit from "./LeagueAdvancedToolkit";
import { createLeagueQueueLobby, fetchLeagueGamePreview, runLeagueProfileUtilityAction } from "../../api/leagueLabApi";

vi.mock("../../api/leagueLabApi", () => ({
  fetchLeagueLobbyOptions: vi.fn().mockResolvedValue({
    queues: [{ id: 420, name: "单双排", eligible: true }],
    lobby: { gameConfig: { queueId: 420 } },
    strawberry: { active: false, maps: [], difficulties: [1,2,3], loadout_available: false },
  }),
  fetchLeagueChampions: vi.fn().mockResolvedValue({ champions: [{ id: 22, name: "艾希" }] }),
  fetchLeagueProfileSkins: vi.fn().mockResolvedValue({ skins: [] }),
  fetchLeagueGamePreview: vi.fn().mockResolvedValue({
    source: "lcu",
    metadata: { game_id: 123, game_mode: "CLASSIC" },
    timeline: { loaded: true, frame_count: 2, event_count: 1 },
    teams: [],
    ongoing_preview: { historical_preview: true, game_id: 123, available: true, players: [] },
  }),
  createLeagueQueueLobby: vi.fn().mockResolvedValue({ created: true }),
  leaveLeagueLobby: vi.fn(),
  updateLeagueStrawberryPlayer: vi.fn(),
  updateLeagueStrawberryMap: vi.fn(),
  updateLeagueStrawberryDifficulty: vi.fn(),
  updateLeagueProfileBackground: vi.fn(),
  runLeagueProfileUtilityAction: vi.fn().mockResolvedValue({ applied: true }),
}));

const props={busy:false,onBusyChange:vi.fn(),onError:vi.fn()};

describe("LeagueAdvancedToolkit",()=>{
  beforeEach(()=>{vi.clearAllMocks();window.prompt=vi.fn();});

  it("keeps lobby and profile writes disabled until the account gate is enabled",async()=>{
    render(<LeagueAdvancedToolkit {...props} enabled={false}/>);
    await screen.findByText(/单双排/);
    fireEvent.change(screen.getByRole("combobox",{name:"房间队列"}),{target:{value:"420"}});
    expect(screen.getByRole("button",{name:"创建房间"}).disabled).toBe(true);
    expect(screen.getByRole("button",{name:"清空全部表情槽位"}).disabled).toBe(true);
  });

  it("creates only the selected eligible queue after the exact phrase",async()=>{
    render(<LeagueAdvancedToolkit {...props} enabled/>);
    await screen.findByText(/单双排/);
    fireEvent.change(screen.getByRole("combobox",{name:"房间队列"}),{target:{value:"420"}});
    window.prompt.mockReturnValueOnce("我确认创建");
    fireEvent.click(screen.getByRole("button",{name:"创建房间"}));
    await waitFor(()=>expect(createLeagueQueueLobby).toHaveBeenCalledWith(420,"我确认创建"));
  });

  it("requires the profile modification phrase for utility actions",async()=>{
    render(<LeagueAdvancedToolkit {...props} enabled/>);
    await screen.findByText(/单双排/);
    window.prompt.mockReturnValueOnce("错误");
    fireEvent.click(screen.getByRole("button",{name:"清空全部表情槽位"}));
    expect(runLeagueProfileUtilityAction).not.toHaveBeenCalled();
    window.prompt.mockReturnValueOnce("我确认修改");
    fireEvent.click(screen.getByRole("button",{name:"清空全部表情槽位"}));
    await waitFor(()=>expect(runLeagueProfileUtilityAction).toHaveBeenCalledWith("clear-emotes","我确认修改"));
  });

  it("loads an arbitrary game and passes the exact read-only draft to the ongoing panel",async()=>{
    const onDryRunGame=vi.fn();
    render(<LeagueAdvancedToolkit {...props} enabled={false} onDryRunGame={onDryRunGame}/>);
    await screen.findByText(/单双排/);
    fireEvent.change(screen.getByRole("textbox",{name:"Game ID"}),{target:{value:"123"}});
    fireEvent.click(screen.getByRole("button",{name:"查看对局"}));
    await waitFor(()=>expect(fetchLeagueGamePreview).toHaveBeenCalledWith(123,"auto",true));
    fireEvent.click(await screen.findByRole("button",{name:"载入实时面板模拟"}));
    expect(onDryRunGame).toHaveBeenCalledWith({historical_preview:true,game_id:123,available:true,players:[]});
  });
});
