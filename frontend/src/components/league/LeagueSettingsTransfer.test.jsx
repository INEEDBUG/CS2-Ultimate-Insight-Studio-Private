import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeagueSettingsTransfer, { buildLeagueSettingsExport, parseLeagueSettingsImport } from "./LeagueSettingsTransfer";

describe("League settings transfer", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("exports settings without credential-like fields", () => {
    expect(buildLeagueSettingsExport({ automation_enabled: true, token: "secret", nested: { api_key: "secret", value: 2 } }, "2026-08-15T00:00:00.000Z")).toEqual({
      format: "cs2-ultimate-insight-studio/league-settings",
      schema_version: 1,
      exported_at: "2026-08-15T00:00:00.000Z",
      settings: { automation_enabled: true, nested: { value: 2 } },
    });
  });

  it("sanitizes a compatible settings envelope", () => {
    const imported = parseLeagueSettingsImport(JSON.stringify({ format: "cs2-ultimate-insight-studio/league-settings", schema_version: 1, settings: { automation_enabled: true, toolkit_account_actions_enabled: true, mini_enabled: false, unknown_field: "ignored", access_token: "removed" } }), { automation_enabled: false, toolkit_account_actions_enabled: false, mini_enabled: true });
    expect(imported).toMatchObject({ automation_enabled: false, toolkit_account_actions_enabled: false, mini_enabled: false });
    expect(imported).not.toHaveProperty("unknown_field");
    expect(imported).not.toHaveProperty("access_token");
  });

  it("rejects invalid and future-version files", () => {
    expect(() => parseLeagueSettingsImport("not-json", { mini_enabled: true })).toThrow("有效的 JSON");
    expect(() => parseLeagueSettingsImport(JSON.stringify({ format: "cs2-ultimate-insight-studio/league-settings", schema_version: 99, settings: { mini_enabled: false } }), { mini_enabled: true })).toThrow("更新版本");
  });

  it("imports a selected JSON file after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<LeagueSettingsTransfer settings={{ automation_enabled: false, mini_enabled: true }} onImport={onImport}/>);
    const file = new File([JSON.stringify({ mini_enabled: false, automation_enabled: true })], "settings.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(JSON.stringify({ mini_enabled: false, automation_enabled: true })) });
    fireEvent.change(screen.getByLabelText("选择 League 设置文件"), { target: { files: [file] } });
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ mini_enabled: false, automation_enabled: false })));
    expect(screen.getByRole("status").textContent).toContain("仍为关闭状态");
  });
});
