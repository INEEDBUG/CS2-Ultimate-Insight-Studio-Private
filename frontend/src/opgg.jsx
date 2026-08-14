import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import LeagueOpggPanel from "./pages/LeagueOpggPanel";
import "./index.css";
import { setDesktopSessionToken } from "./api/api.js";

async function bootstrap() {
  setDesktopSessionToken(await invoke("backend_session_token"));
  ReactDOM.createRoot(document.getElementById("root")).render(<LeagueOpggPanel />);
}

bootstrap().catch((error) => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <div className="h-screen bg-[#101114] p-5 text-sm text-red-300">OP.GG 窗口启动失败：{String(error?.message || error)}</div>,
  );
});
