import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DemoDownloadActivityCenter from "./DemoDownloadActivityCenter.jsx";
import { useDemoDownloadStore } from "../stores/demoDownloadStore.js";

describe("DemoDownloadActivityCenter", () => {
  afterEach(() => {
    cleanup();
    act(() => useDemoDownloadStore.setState({ jobs: [], pollingError: "" }));
    vi.restoreAllMocks();
  });

  test("keeps active transfer progress visible outside the download page", () => {
    act(() => useDemoDownloadStore.setState({
      refreshJobs: vi.fn(async () => []),
      jobs: [{
        job_id: "job-1",
        status: "running",
        stage: "downloading",
        progress: 0.42,
        filename: "match730_1.dem",
        message: "正在下载",
        download_speed_bps: 2 * 1024 * 1024,
        download_bytes: 20 * 1024 * 1024,
        upload_bytes: 0,
      }],
    }));

    render(<MemoryRouter><DemoDownloadActivityCenter /></MemoryRouter>);

    expect(screen.getByRole("button", { name: "查看官匹 Demo 下载进度" })).toBeTruthy();
    expect(screen.getByText("match730_1.dem")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("2.0 MB/s")).toBeTruthy();
    expect(screen.getByText("↓ 20.0 MB")).toBeTruthy();
    expect(screen.getByText("↑ 0 B")).toBeTruthy();
  });

  test("stays hidden when no download is running", () => {
    act(() => useDemoDownloadStore.setState({ refreshJobs: vi.fn(async () => []), jobs: [] }));
    render(<MemoryRouter><DemoDownloadActivityCenter /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "查看官匹 Demo 下载进度" })).toBeNull();
  });
});
