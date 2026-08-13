import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./index.css";
import { setDesktopSessionToken } from "./api/api.js";
import LeagueOngoingGame from "./components/league/LeagueOngoingGame";

async function bootstrap() {
  setDesktopSessionToken(await invoke("backend_session_token"));
  ReactDOM.createRoot(document.getElementById("root")).render(
    <main className="min-h-screen bg-[#111214] p-5 text-white">
      <LeagueOngoingGame onOpenPlayer={() => {}} onError={() => {}} />
    </main>,
  );
}

bootstrap().catch((error) => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <div className="h-screen bg-[#111214] p-5 text-sm text-red-300">实时对局窗口启动失败：{String(error?.message || error)}</div>,
  );
});
