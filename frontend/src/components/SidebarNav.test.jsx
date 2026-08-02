import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SidebarNav from "./SidebarNav";

globalThis.__APP_VERSION__ = "test";

vi.mock("../i18n/useT.js", () => ({ useT: () => (key) => key }));
vi.mock("../stores/themeStore", () => ({
  useThemeStore: (selector) => selector({ theme: "dark", toggleTheme: vi.fn() }),
}));
vi.mock("../stores/replayStore", () => ({
  useReplayStore: { getState: () => ({ requestSuspendPlayback: vi.fn() }) },
}));

describe("SidebarNav", () => {
  test("keeps the official demo downloader reachable after onboarding", () => {
    render(
      <MemoryRouter>
        <SidebarNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "nav.officialDemos" }).getAttribute("href")).toBe(
      "/match-history",
    );
  });
});
