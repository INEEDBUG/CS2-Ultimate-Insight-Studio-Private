import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeagueInGamePresetTools from "./LeagueInGamePresetTools";
import { sendLeagueInGamePreset } from "../../api/leagueLabApi";

vi.mock("../../api/leagueLabApi", () => ({ sendLeagueInGamePreset: vi.fn() }));

const baseSettings={
  toolkit_account_actions_enabled:false,
  in_game_send_enabled:false,
  in_game_send_interval_ms:250,
  in_game_fixed_presets:[{id:"hello",title:"问候",shortcut:"Ctrl+Alt+H",content:"你好"}],
};

describe("LeagueInGamePresetTools",()=>{
  beforeEach(()=>{vi.clearAllMocks();window.prompt=vi.fn();window.confirm=vi.fn();});

  it("keeps the send action disabled while either safety switch is off",()=>{
    render(<LeagueInGamePresetTools settings={baseSettings} busy={false} onSettingsUpdate={vi.fn()} onBusyChange={vi.fn()} onError={vi.fn()}/>);
    expect(screen.getByRole("button",{name:"发送 问候"}).disabled).toBe(true);
  });

  it("requires the exact phrase before manually sending the selected preset",async()=>{
    sendLeagueInGamePreset.mockResolvedValue({sent:true});
    window.prompt.mockReturnValueOnce("错误").mockReturnValueOnce("我确认发送");
    const props={settings:{...baseSettings,toolkit_account_actions_enabled:true,in_game_send_enabled:true},busy:false,onSettingsUpdate:vi.fn(),onBusyChange:vi.fn(),onError:vi.fn()};
    render(<LeagueInGamePresetTools {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:"发送 问候"}));
    expect(sendLeagueInGamePreset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"发送 问候"}));
    await waitFor(()=>expect(sendLeagueInGamePreset).toHaveBeenCalledWith("hello","manual","我确认发送"));
  });

  it("persists fixed presets in the user-selected order",async()=>{
    const onSettingsUpdate=vi.fn().mockResolvedValue({});
    const settings={...baseSettings,toolkit_account_actions_enabled:true,in_game_fixed_presets:[
      {id:"first",title:"第一条",shortcut:null,content:"一"},
      {id:"second",title:"第二条",shortcut:null,content:"二"},
    ]};
    render(<LeagueInGamePresetTools settings={settings} busy={false} onSettingsUpdate={onSettingsUpdate} onBusyChange={vi.fn()} onError={vi.fn()}/>);

    fireEvent.click(screen.getByRole("button",{name:"上移 第二条"}));

    await waitFor(()=>expect(onSettingsUpdate).toHaveBeenCalledWith({in_game_fixed_presets:[
      settings.in_game_fixed_presets[1],
      settings.in_game_fixed_presets[0],
    ]}));
  });
});
