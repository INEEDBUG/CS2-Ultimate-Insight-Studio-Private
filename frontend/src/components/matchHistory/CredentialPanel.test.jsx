import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startSteamOpenId: vi.fn(),
  fetchSteamOpenIdStatus: vi.fn(),
  saveMatchCredentials: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock("../../api/matchHistoryApi", () => ({
  startSteamOpenId: (...args) => mocks.startSteamOpenId(...args),
  fetchSteamOpenIdStatus: (...args) => mocks.fetchSteamOpenIdStatus(...args),
  saveMatchCredentials: (...args) => mocks.saveMatchCredentials(...args),
  testSteamConnection: vi.fn(),
}));
vi.mock("../../api/trainingApi.js", () => ({ fetchLocalCs2Settings: vi.fn().mockResolvedValue({ accounts: [] }) }));
vi.mock("../../desktop/desktopBridge.js", () => ({ desktopBridge: { openExternal: (...args) => mocks.openExternal(...args) } }));

import CredentialPanel from "./CredentialPanel";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("CredentialPanel Steam OpenID", () => {
  test("opens Steam, verifies the callback, and persists the returned SteamID", async () => {
    vi.useFakeTimers();
    mocks.startSteamOpenId.mockResolvedValue({ state: "flow-1", auth_url: "https://steamcommunity.com/openid/login" });
    mocks.fetchSteamOpenIdStatus.mockResolvedValue({ status: "complete", steam_id64: "76561198000000000", name: "Player" });
    mocks.saveMatchCredentials.mockResolvedValue({});
    render(<CredentialPanel configured={false} matchMode="premier" matchCount={20} />);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "使用 Steam 登录" })); });
    expect(mocks.openExternal).toHaveBeenCalledWith("https://steamcommunity.com/openid/login");
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });

    expect(mocks.fetchSteamOpenIdStatus).toHaveBeenCalledWith("flow-1");
    expect(mocks.saveMatchCredentials).toHaveBeenCalledWith(undefined, "76561198000000000", undefined, undefined, "premier", 20);
    expect(screen.getByDisplayValue("76561198000000000")).toBeTruthy();
  });
});
