import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetchLeagueLabStatus } from "../api/leagueLabApi";

export default function LeagueMiniAutoManager() {
  const lastSync = useRef("");

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return undefined;
    let disposed = false;
    const sync = async () => {
      try {
        const status = await fetchLeagueLabStatus();
        if (disposed) return;
        const settings = status?.settings || {};
        const shouldShow = Boolean(settings.mini_enabled && settings.mini_auto_show && status?.mini_should_show);
        const context = `${status?.connected ? "connected" : "offline"}:${status?.phase || "None"}:${status?.champ_select?.is_spectating ? "spectating" : "playing"}`;
        const contentProtected = Boolean(settings.streamer_content_protection_enabled);
        const signature = `${shouldShow}:${context}:${contentProtected}`;
        if (signature === lastSync.current) return;
        lastSync.current = signature;
        await invoke("set_league_content_protection", { enabled: contentProtected });
        await invoke("sync_league_mini", { shouldShow, context });
      } catch {
        // Backend startup and shutdown races are expected; the next poll retries.
      }
    };
    sync();
    const timer = window.setInterval(sync, 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  return null;
}
