import { create } from "zustand";

export const THEME_STORAGE_KEY = "cs2-insight-theme";
export const THEME_MODES = ["system", "time", "light", "dark"];
export const DAY_START_HOUR = 7;
export const NIGHT_START_HOUR = 19;

function readInitialMode() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (THEME_MODES.includes(stored)) return stored;
  } catch {
    // Storage can be unavailable in privacy-restricted webviews.
  }
  return "system";
}

export function resolveTheme(mode, { now = new Date(), systemDark = false } = {}) {
  if (mode === "light" || mode === "dark") return mode;
  if (mode === "time") {
    const hour = now.getHours();
    return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? "light" : "dark";
  }
  return systemDark ? "dark" : "light";
}

const initialMode = readInitialMode();

export const useThemeStore = create((set) => ({
  mode: initialMode,
  resolvedTheme: resolveTheme(initialMode),
  setMode: (mode) => {
    if (!THEME_MODES.includes(mode)) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Keep the in-memory preference even when persistence is unavailable.
    }
    set({ mode });
  },
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
}));
