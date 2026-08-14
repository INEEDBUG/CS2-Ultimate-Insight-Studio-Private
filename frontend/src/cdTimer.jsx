import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./index.css";
import { setDesktopSessionToken } from "./api/api.js";
import LeagueCooldownTimerPanel from "./pages/LeagueCooldownTimerPanel";

async function bootstrap() {
  setDesktopSessionToken(await invoke("backend_session_token"));
  ReactDOM.createRoot(document.getElementById("root")).render(<LeagueCooldownTimerPanel />);
}

bootstrap().catch((error) => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <div className="bg-zinc-950 p-3 text-xs text-rose-300">技能计时器启动失败：{String(error?.message || error)}</div>,
  );
});
