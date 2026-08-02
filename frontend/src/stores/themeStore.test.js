import { beforeEach, describe, expect, test, vi } from "vitest";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  test("uses device appearance by default", async () => {
    const { useThemeStore } = await import("./themeStore");
    expect(useThemeStore.getState().mode).toBe("system");
  });

  test("resolves local daytime without a network clock", async () => {
    const { resolveTheme } = await import("./themeStore");
    expect(resolveTheme("time", { now: new Date(2026, 7, 2, 12, 0) })).toBe("light");
    expect(resolveTheme("time", { now: new Date(2026, 7, 2, 22, 0) })).toBe("dark");
  });

  test("persists an explicit appearance mode", async () => {
    const { THEME_STORAGE_KEY, useThemeStore } = await import("./themeStore");
    useThemeStore.getState().setMode("time");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("time");
    expect(useThemeStore.getState().mode).toBe("time");
  });
});
