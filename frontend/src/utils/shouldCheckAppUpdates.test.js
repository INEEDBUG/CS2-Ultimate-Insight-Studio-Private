import { describe, expect, test } from "vitest";
import { shouldCheckAppUpdates } from "./shouldCheckAppUpdates";

describe("private build update policy", () => {
  test("never checks the upstream update channel", async () => {
    await expect(shouldCheckAppUpdates()).resolves.toBe(false);
  });
});
