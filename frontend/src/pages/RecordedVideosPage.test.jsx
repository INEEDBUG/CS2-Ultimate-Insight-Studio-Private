import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import RecordedVideosPage from "./RecordedVideosPage";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(() => Promise.resolve({ data: {} })),
}));

vi.mock("../api/api.js", () => ({
  default: { get: mocks.get, post: mocks.post, patch: vi.fn() },
  getRecordedClipStreamUrl: (id) => `/api/recorded-clips/${id}/stream`,
}));
vi.mock("../desktop/desktopBridge.js", () => ({ desktopBridge: null }));

describe("RecordedVideosPage", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockClear();
    mocks.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/storage")
      ? { configured_path: "D:/OBS", recent_path: "D:/OBS", obs_connected: true }
      : { items: [{ id: 7, output_path: "D:/OBS/ace.mp4", player_name: "Player", duration_sec: 65 }] } }));
  });

  test("lists recorded files, plays them in-app, and reveals the selected file", async () => {
    render(<RecordedVideosPage />);

    expect((await screen.findAllByText("ace.mp4")).length).toBe(2);
    const video = screen.getByLabelText("播放 ace.mp4");
    expect(video.getAttribute("src")).toBe("/api/recorded-clips/7/stream");
    expect(screen.getByText("1:05")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /定位文件/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/reveal-file-in-explorer", { path: "D:/OBS/ace.mp4" }));
  });
});
