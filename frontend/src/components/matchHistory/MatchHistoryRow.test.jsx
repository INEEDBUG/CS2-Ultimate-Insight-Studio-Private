import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("../../i18n/useT.js", () => ({
  useT: () => (key, params = {}) => key === "match.mapThumbnailAlt"
    ? `${params.map} 地图缩略图`
    : key,
}));

vi.mock("./DemoDownloadCell", () => ({
  default: () => <div />,
}));

import MatchHistoryRow from "./MatchHistoryRow";

const match = {
  match_id: "123",
  map: "de_dust2",
  mode: "competitive",
  result: "win",
  score_own: 13,
  score_opp: 2,
  duration_sec: 1440,
  played_at: "2026-08-12T21:57:00+08:00",
  rounds: [],
  kills: 10,
  deaths: 8,
  assists: 2,
  headshot_pct: 40,
  adr: null,
  rating: null,
  mvp_count: 1,
  ace_count: 0,
};

describe("MatchHistoryRow map thumbnail", () => {
  test("uses the bundled CS2 map artwork", () => {
    render(<MatchHistoryRow match={match} onDownload={vi.fn()} onGoToLibrary={vi.fn()} />);

    const image = screen.getByRole("img", { name: "dust2 地图缩略图" });
    expect(image.getAttribute("src")).toBe("/images/maps/de_dust2.webp");
  });

  test("falls back to the bundled unknown-map artwork", () => {
    render(<MatchHistoryRow match={{ ...match, map: "de_missing" }} onDownload={vi.fn()} onGoToLibrary={vi.fn()} />);

    const image = screen.getByRole("img", { name: "missing 地图缩略图" });
    fireEvent.error(image);
    expect(image.getAttribute("src")).toBe("/images/maps/thumbnail_unknown.webp");
  });
});
