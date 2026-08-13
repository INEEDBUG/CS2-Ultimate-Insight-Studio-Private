import { beforeEach, describe, expect, test } from "vitest";
import {
  AUTO_UPDATE_POLL_INTERVAL_MS,
  shouldCheckAppUpdates,
} from "./shouldCheckAppUpdates";

describe("signed desktop update policy", () => {
  beforeEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  test("does not check from a browser or Vite preview", async () => {
    await expect(shouldCheckAppUpdates()).resolves.toBe(false);
  });

  test("checks from a packaged Tauri desktop client", async () => {
    window.__TAURI_INTERNALS__ = {};
    await expect(shouldCheckAppUpdates()).resolves.toBe(true);
    delete window.__TAURI_INTERNALS__;
  });

  test("polls often enough to notify a running client", () => {
    expect(AUTO_UPDATE_POLL_INTERVAL_MS).toBe(15 * 60 * 1000);
  });
});
