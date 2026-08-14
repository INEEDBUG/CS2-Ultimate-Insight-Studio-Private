import { useEffect, useRef } from "react";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { fetchLeagueLabStatus, sendLeagueInGamePreset } from "../api/leagueLabApi";

const POLL_INTERVAL_MS = 2500;

export default function LeaguePresetShortcutManager() {
  const registered = useRef(new Map());
  const syncing = useRef(false);
  const lastTriggered = useRef(new Map());

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return undefined;
    let disposed = false;

    const sync = async () => {
      if (disposed || syncing.current) return;
      syncing.current = true;
      try {
        const status = await fetchLeagueLabStatus();
        if (disposed) return;
        const settings = status?.settings || {};
        const desired = new Map();
        if (settings.toolkit_account_actions_enabled && settings.in_game_send_enabled) {
          for (const preset of settings.in_game_fixed_presets || []) {
            const shortcut = String(preset?.shortcut || "").trim();
            if (preset?.id && shortcut && !desired.has(shortcut)) desired.set(shortcut, String(preset.id));
          }
        }
        for (const [shortcut, presetId] of [...registered.current.entries()]) {
          if (desired.get(shortcut) === presetId) continue;
          await unregister(shortcut).catch(() => {});
          registered.current.delete(shortcut);
        }
        for (const [shortcut, presetId] of desired.entries()) {
          if (disposed || registered.current.get(shortcut) === presetId) continue;
          try {
            await register(shortcut, async (event) => {
              if (event?.state !== "Pressed") return;
              const now = Date.now();
              if (now - (lastTriggered.current.get(presetId) || 0) < 1000) return;
              lastTriggered.current.set(presetId, now);
              await sendLeagueInGamePreset(presetId, "shortcut", "").catch(() => {});
            });
            if (!disposed) registered.current.set(shortcut, presetId);
          } catch {
            // Invalid or occupied accelerators remain unregistered and are retried.
          }
        }
      } catch {
        // Backend startup and shutdown races are expected.
      } finally {
        syncing.current = false;
      }
    };

    void sync();
    const timer = window.setInterval(() => void sync(), POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      for (const shortcut of registered.current.keys()) void unregister(shortcut).catch(() => {});
      registered.current.clear();
    };
  }, []);

  return null;
}
