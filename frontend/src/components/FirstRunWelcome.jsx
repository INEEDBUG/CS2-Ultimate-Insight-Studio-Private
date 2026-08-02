import { useState } from "react";
import { Crosshair, Download, Keyboard, Library, Sparkles, X } from "lucide-react";
import { useT } from "../i18n/useT.js";

export const FIRST_RUN_WELCOME_KEY = "cs2-ultimate-insight.welcome.v1";

export function shouldShowFirstRunWelcome(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(FIRST_RUN_WELCOME_KEY) !== "done";
  } catch {
    return true;
  }
}

function rememberWelcomeComplete(storage = globalThis.localStorage) {
  try {
    storage?.setItem(FIRST_RUN_WELCOME_KEY, "done");
  } catch {
    // The welcome remains dismissible even when storage is unavailable.
  }
}

export default function FirstRunWelcome({ open, onNavigate }) {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);

  if (!open || dismissed) return null;

  const finish = (path) => {
    rememberWelcomeComplete();
    setDismissed(true);
    if (path) onNavigate(path);
  };

  const destinations = [
    { path: "/library", icon: Library, title: t("welcome.libraryTitle"), body: t("welcome.libraryBody") },
    { path: "/match-history", icon: Download, title: t("welcome.demoTitle"), body: t("welcome.demoBody") },
    { path: "/sensitivity-lab", icon: Crosshair, title: t("welcome.aimTitle"), body: t("welcome.aimBody") },
    { path: "/input-lab", icon: Keyboard, title: t("welcome.inputTitle"), body: t("welcome.inputBody") },
  ];

  return (
    <div className="absolute inset-0 z-[85] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
      <section className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-cs2-bg-card shadow-2xl shadow-black/60">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cs2-orange via-amber-300 to-violet-400" />
        <button type="button" onClick={() => finish()} aria-label={t("welcome.skip")} className="absolute right-4 top-4 rounded-md p-1.5 text-cs2-text-muted transition-colors hover:bg-white/5 hover:text-cs2-text-primary">
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pb-6 pt-7 sm:px-8">
          <div className="flex items-start gap-4">
            <div className="rounded-xl border border-cs2-orange/30 bg-cs2-orange/10 p-3 text-cs2-orange">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="pr-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cs2-orange">{t("welcome.eyebrow")}</p>
              <h1 id="first-run-title" className="mt-1 text-2xl font-bold tracking-tight text-cs2-text-primary">{t("welcome.title")}</h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-6 text-cs2-text-secondary">{t("welcome.body")}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {destinations.map(({ path, icon: Icon, title, body }) => (
              <button key={path} type="button" onClick={() => finish(path)} className="group flex items-start gap-3 rounded-xl border border-cs2-border bg-cs2-bg-dark/45 p-4 text-left transition-colors hover:border-cs2-orange/40 hover:bg-cs2-orange/5">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-cs2-text-muted transition-colors group-hover:text-cs2-orange" />
                <span>
                  <span className="block text-[13px] font-semibold text-cs2-text-primary">{title}</span>
                  <span className="mt-1 block text-[11.5px] leading-5 text-cs2-text-muted">{body}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/5 pt-4">
            <p className="text-[11.5px] text-cs2-text-muted">{t("welcome.localNote")}</p>
            <button type="button" onClick={() => finish("/library")} className="shrink-0 rounded-lg bg-cs2-orange px-4 py-2 text-[12.5px] font-bold text-black transition-transform active:scale-[0.98]">
              {t("welcome.start")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
