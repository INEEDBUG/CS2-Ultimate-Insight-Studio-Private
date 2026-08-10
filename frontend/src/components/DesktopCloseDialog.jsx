import { LogOut, Minus, X } from "lucide-react";
import { useT } from "../i18n/useT.js";

export default function DesktopCloseDialog({
  open,
  busy = false,
  remember = false,
  onRememberChange,
  onChoice,
  onCancel,
}) {
  const t = useT();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-5 backdrop-blur-md" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-close-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-cs2-bg-card shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-white/8 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cs2-orange">
              {t("app.closeDialogEyebrow")}
            </p>
            <h2 id="desktop-close-title" className="mt-1.5 text-lg font-bold text-cs2-text-primary">
              {t("app.closeDialogTitle")}
            </h2>
            <p className="mt-1.5 text-xs leading-5 text-cs2-text-muted">
              {t("app.closeDialogDescription")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("common.cancel")}
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg p-2 text-cs2-text-muted transition hover:bg-white/5 hover:text-cs2-text-primary disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-3 px-6 py-5 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoice("tray")}
            className="group rounded-xl border border-cs2-accent/35 bg-cs2-accent/10 p-4 text-left transition hover:border-cs2-accent/70 hover:bg-cs2-accent/15 disabled:opacity-50"
          >
            <Minus className="h-5 w-5 text-cs2-accent" />
            <span className="mt-3 block text-sm font-bold text-cs2-text-primary">{t("app.closeDialogTray")}</span>
            <span className="mt-1 block text-[11px] leading-4 text-cs2-text-muted">{t("app.closeDialogTrayHint")}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoice("exit")}
            className="group rounded-xl border border-red-500/25 bg-red-500/5 p-4 text-left transition hover:border-red-500/60 hover:bg-red-500/10 disabled:opacity-50"
          >
            <LogOut className="h-5 w-5 text-red-400" />
            <span className="mt-3 block text-sm font-bold text-cs2-text-primary">{t("app.closeDialogExit")}</span>
            <span className="mt-1 block text-[11px] leading-4 text-cs2-text-muted">{t("app.closeDialogExitHint")}</span>
          </button>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-white/8 bg-black/10 px-6 py-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-cs2-text-secondary">
            <input
              type="checkbox"
              checked={remember}
              disabled={busy}
              onChange={(event) => onRememberChange(event.target.checked)}
              className="h-4 w-4 accent-cs2-orange"
            />
            {t("app.closeDialogRemember")}
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-cs2-border px-3 py-1.5 text-xs font-semibold text-cs2-text-secondary transition hover:text-cs2-text-primary disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
        </footer>
      </section>
    </div>
  );
}
