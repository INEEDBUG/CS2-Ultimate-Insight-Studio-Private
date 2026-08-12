import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchLocalCs2Settings: vi.fn(),
}));

vi.mock("../../api/trainingApi.js", () => ({
  fetchLocalCs2Settings: (...args) => mocks.fetchLocalCs2Settings(...args),
}));

import CredentialPanel from "./CredentialPanel";

afterEach(() => {
  vi.clearAllMocks();
});

describe("CredentialPanel local Steam Game Coordinator", () => {
  test("connects the detected local Steam account without requesting a Web API key", async () => {
    mocks.fetchLocalCs2Settings.mockResolvedValue({
      active_account_id: "123",
      accounts: [{ account_id: "123", steam_id64: "76561198000000123", persona_name: "Player" }],
    });
    const onConnect = vi.fn();
    render(<CredentialPanel connected={false} loading={false} onConnect={onConnect} />);

    expect(await screen.findByText("检测到：Player")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "连接并显示最近 8 场" }));

    expect(onConnect).toHaveBeenCalledWith(true);
  });

  test("shows the GC account returned by Steam and refreshes without consent", async () => {
    mocks.fetchLocalCs2Settings.mockResolvedValue({
      active_account_id: "other",
      accounts: [
        { account_id: "other", steam_id64: "76561198000000001", persona_name: "Other" },
        { account_id: "target", steam_id64: "76561198000000002", persona_name: "Target" },
      ],
    });
    const onConnect = vi.fn();
    render(
      <CredentialPanel
        connected
        player={{ steam_id64: "76561198000000002" }}
        loading={false}
        onConnect={onConnect}
      />,
    );

    await waitFor(() => expect(screen.getByText(/已连接本机 Steam：Target/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "刷新最近战绩" }));
    expect(onConnect).toHaveBeenCalledWith(false);
  });
});
