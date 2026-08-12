import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";

vi.mock("../api/matchHistoryApi", () => ({
  fetchMatchHistory: () => new Promise(() => {}),
  downloadMatchDemo: vi.fn(),
  startShareCodeDownloadJob: vi.fn(),
  cancelShareCodeDownloadJob: vi.fn(),
  retryShareCodeDownloadJob: vi.fn(),
}));

vi.mock("../components/matchHistory/CredentialPanel", () => ({
  default: () => <div />,
}));

vi.mock("../i18n/useT.js", () => ({
  useT: () => (key) => key,
}));

import MatchHistoryPage from "./MatchHistoryPage";

describe("MatchHistoryPage layout", () => {
  test("owns the vertical scroll region inside the fixed desktop shell", () => {
    render(
      <MemoryRouter>
        <MatchHistoryPage />
      </MemoryRouter>,
    );

    const region = screen.getByTestId("match-history-scroll-region");
    expect(region.classList.contains("min-h-0")).toBe(true);
    expect(region.classList.contains("flex-1")).toBe(true);
    expect(region.classList.contains("overflow-y-auto")).toBe(true);
    expect(region.classList.contains("custom-scrollbar")).toBe(true);
  });
});
