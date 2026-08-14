import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LeaguePresetShortcutManager from "./LeaguePresetShortcutManager";
import { fetchLeagueLabStatus, sendLeagueInGamePreset } from "../api/leagueLabApi";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";

vi.mock("../api/leagueLabApi", () => ({
  fetchLeagueLabStatus: vi.fn(),
  sendLeagueInGamePreset: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register: vi.fn(), unregister: vi.fn() }));

describe("LeaguePresetShortcutManager", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    register.mockResolvedValue(undefined);
    unregister.mockResolvedValue(undefined);
    sendLeagueInGamePreset.mockResolvedValue({ sent: true });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); delete window.__TAURI_INTERNALS__; });

  it("keeps every preset shortcut unregistered until both safety switches are enabled", async () => {
    fetchLeagueLabStatus.mockResolvedValue({ settings: {
      toolkit_account_actions_enabled: false,
      in_game_send_enabled: true,
      in_game_fixed_presets: [{ id: "hello", shortcut: "Ctrl+Alt+H" }],
    } });
    render(<LeaguePresetShortcutManager />);
    await waitFor(() => expect(fetchLeagueLabStatus).toHaveBeenCalled());
    expect(register).not.toHaveBeenCalled();
  });

  it("registers enabled fixed text shortcuts and dispatches only pressed events", async () => {
    fetchLeagueLabStatus.mockResolvedValue({ settings: {
      toolkit_account_actions_enabled: true,
      in_game_send_enabled: true,
      in_game_fixed_presets: [{ id: "hello", shortcut: "Ctrl+Alt+H" }],
    } });
    render(<LeaguePresetShortcutManager />);
    await waitFor(() => expect(register).toHaveBeenCalledWith("Ctrl+Alt+H", expect.any(Function)));
    const handler = register.mock.calls[0][1];
    await handler({ state: "Released" });
    expect(sendLeagueInGamePreset).not.toHaveBeenCalled();
    await handler({ state: "Pressed" });
    expect(sendLeagueInGamePreset).toHaveBeenCalledWith("hello", "shortcut", "");
  });
});
