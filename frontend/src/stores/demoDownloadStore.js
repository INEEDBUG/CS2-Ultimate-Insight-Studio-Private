import { create } from "zustand";
import { fetchDemoDownloadJobs } from "../api/matchHistoryApi.js";

function mergeJobs(current, incoming) {
  const map = new Map(current.map((job) => [job.job_id, job]));
  for (const job of incoming) map.set(job.job_id, job);
  return [...map.values()].sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
}

export const useDemoDownloadStore = create((set, get) => ({
  jobs: [],
  pollingError: "",
  upsertJob: (job) => set((state) => ({ jobs: mergeJobs(state.jobs, [job]) })),
  refreshJobs: async () => {
    try {
      const jobs = await fetchDemoDownloadJobs(false);
      set({ jobs, pollingError: "" });
      return jobs;
    } catch (error) {
      set({ pollingError: error?.response?.data?.detail || error?.message || "无法刷新下载任务" });
      return get().jobs;
    }
  },
}));

export function formatTransferBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function downloadJobPercent(job) {
  return Math.max(0, Math.min(100, Math.round((Number(job?.progress) || 0) * 100)));
}
