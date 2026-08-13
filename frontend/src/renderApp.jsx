import React, { Suspense, lazy, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { useThemeStore } from "./stores/themeStore";

const LeagueMiniPanel = lazy(() => import("./pages/LeagueMiniPanel"));

class MiniErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div className="h-screen bg-[#111214] p-5 text-sm text-red-300"><div className="font-bold">Mini 面板加载失败</div><div className="mt-2 break-words text-xs text-zinc-400">{String(this.state.error?.message || this.state.error)}</div></div>;
    return this.props.children;
  }
}

function ThemeApplier() {
  const mode = useThemeStore((state) => state.mode);
  const setResolvedTheme = useThemeStore((state) => state.setResolvedTheme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = mode === "time"
        ? ((new Date().getHours() >= 7 && new Date().getHours() < 19) ? "light" : "dark")
        : mode === "system"
          ? (media.matches ? "dark" : "light")
          : mode;

      document.documentElement.classList.remove("dark", "light");
      document.documentElement.classList.add(resolved);
      document.documentElement.dataset.themeMode = mode;
      document.documentElement.style.colorScheme = resolved;
      setResolvedTheme(resolved);
    };

    applyTheme();
    media.addEventListener?.("change", applyTheme);
    const timer = mode === "time" ? window.setInterval(applyTheme, 60_000) : null;
    return () => {
      media.removeEventListener?.("change", applyTheme);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [mode, setResolvedTheme]);
  return null;
}

const isLeagueMini = new URLSearchParams(window.location.search).get("window") === "league-mini";
ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <ThemeApplier />
    {isLeagueMini
      ? <MiniErrorBoundary><Suspense fallback={<div className="h-screen bg-[#111214]" />}><LeagueMiniPanel /></Suspense></MiniErrorBoundary>
      : <App />}
  </BrowserRouter>,
);
