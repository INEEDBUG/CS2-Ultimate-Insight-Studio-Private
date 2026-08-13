import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./index.css";
import { setDesktopSessionToken } from "./api/api.js";
import LeagueMiniPanel from "./pages/LeagueMiniPanel";

class MiniErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div className="h-screen bg-[#111214] p-5 text-sm text-red-300"><div className="font-bold">Mini 面板加载失败</div><div className="mt-2 break-words text-xs text-zinc-400">{String(this.state.error?.message || this.state.error)}</div></div>;
    }
    return this.props.children;
  }
}

async function bootstrap() {
  setDesktopSessionToken(await invoke("backend_session_token"));
  ReactDOM.createRoot(document.getElementById("root")).render(
    <MiniErrorBoundary><LeagueMiniPanel /></MiniErrorBoundary>,
  );
}

bootstrap().catch((error) => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <div className="h-screen bg-[#111214] p-5 text-sm text-red-300">Mini 启动失败：{String(error?.message || error)}</div>,
  );
});
