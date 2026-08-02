import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { useThemeStore } from "./stores/themeStore";

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

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <ThemeApplier />
    <App />
  </BrowserRouter>,
);
