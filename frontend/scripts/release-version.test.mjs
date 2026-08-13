import { describe, expect, test } from "vitest";
import { resolveReleaseVersion } from "./release-version.mjs";

describe("release version resolver", () => {
  test("increments the latest stable patch for a main push", () => {
    expect(
      resolveReleaseVersion({
        eventName: "push",
        refType: "branch",
        refName: "main",
        latestReleaseTag: "v2.5.10",
      }),
    ).toBe("2.5.11");
  });

  test("uses an explicitly pushed tag", () => {
    expect(
      resolveReleaseVersion({
        eventName: "push",
        refType: "tag",
        refName: "V3.0.0",
      }),
    ).toBe("3.0.0");
  });

  test("preserves a manual release-candidate version", () => {
    expect(
      resolveReleaseVersion({
        eventName: "workflow_dispatch",
        requestedVersion: "2.6.0-rc.1",
      }),
    ).toBe("2.6.0-rc.1");
  });

  test("rejects a non-semantic latest release tag", () => {
    expect(() =>
      resolveReleaseVersion({
        eventName: "push",
        refType: "branch",
        latestReleaseTag: "nightly",
      }),
    ).toThrow(/stable semantic version/);
  });
});
