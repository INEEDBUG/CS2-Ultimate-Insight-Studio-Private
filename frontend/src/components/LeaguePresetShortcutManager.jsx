import { useEffect, useRef } from "react";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { fetchLeagueLabStatus, fetchLeagueOngoingGame, sendLeagueInGameLines, sendLeagueInGamePreset } from "../api/leagueLabApi";
import { buildLeagueFormPreset, buildLeagueJunglePreset, buildLeaguePremadePreset } from "../utils/leagueChatPresets";

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
            if (preset?.id && shortcut && !desired.has(shortcut)) desired.set(shortcut, `fixed:${preset.id}`);
          }
          for (const kind of ["rating", "premade", "jungle"]) for (const target of ["friendly", "enemy", "all"]) {
            const shortcut = String(settings[`in_game_${kind}_shortcuts`]?.[target] || "").trim();
            if (shortcut && !desired.has(shortcut)) desired.set(shortcut, `generated:${kind}:${target}`);
          }
        }
        for (const [shortcut, presetId] of [...registered.current.entries()]) {
          if (desired.get(shortcut) === presetId) continue;
          await unregister(shortcut).catch(() => {});
          registered.current.delete(shortcut);
        }
        for (const [shortcut, action] of desired.entries()) {
          if (disposed || registered.current.get(shortcut) === action) continue;
          try {
            await register(shortcut, async (event) => {
              if (event?.state !== "Pressed") return;
              const now = Date.now();
              if (now - (lastTriggered.current.get(action) || 0) < 1000) return;
              lastTriggered.current.set(action, now);
              if (action.startsWith("fixed:")) {
                await sendLeagueInGamePreset(action.slice(6), "shortcut", "").catch(() => {});
                return;
              }
              const [, kind, target] = action.split(":");
              try {
                const [game, liveStatus] = await Promise.all([fetchLeagueOngoingGame(), fetchLeagueLabStatus()]);
                const players = game?.players || [];
                const own = players.find((player) => player?.puuid && player.puuid === liveStatus?.current_summoner?.puuid);
                const selected = target === "all" || !own ? players : players.filter((player) => target === "friendly" ? String(player.team) === String(own.team) : String(player.team) !== String(own.team));
                const lines = kind === "premade" ? buildLeaguePremadePreset(selected) : kind === "jungle" ? buildLeagueJunglePreset(selected) : buildLeagueFormPreset(selected);
                if (lines.length) await sendLeagueInGameLines(lines.slice(0, 10), "", "shortcut", kind, target);
              } catch {
                // Missing live data or a backend safety rejection leaves the game untouched.
              }
            });
            if (!disposed) registered.current.set(shortcut, action);
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
