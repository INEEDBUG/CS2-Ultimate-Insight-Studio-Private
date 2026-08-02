import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Trophy, RefreshCw, Download, Info, Loader2, Link2 } from "lucide-react";
import {
  fetchMatchHistory,
  downloadMatchDemo,
  downloadMatchDemoFromShareCode,
  saveMatchCredentials,
} from "../api/matchHistoryApi";
import CredentialPanel from "../components/matchHistory/CredentialPanel";
import PlayerOverviewPanel from "../components/matchHistory/PlayerOverviewPanel";
import MatchHistoryFilterBar from "../components/matchHistory/MatchHistoryFilterBar";
import MatchHistoryRow from "../components/matchHistory/MatchHistoryRow";
import API from "../api/api";
import { useT } from "../i18n/useT.js";
import {
  FILTER_ALL_MAPS,
  FILTER_ALL_RESULTS,
  FILTER_ALL_TIME,
  FILTER_LAST_7,
  FILTER_LAST_30,
} from "./matchHistoryFilters.js";

const PAGE_SIZE = 20;

const DEFAULT_FILTERS = {
  search: "",
  map: FILTER_ALL_MAPS,
  result: FILTER_ALL_RESULTS,
  time: FILTER_ALL_TIME,
  mode: "all",
};

function applyFilters(matches, filters) {
  return matches.filter((m) => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!m.match_id.includes(q)) return false;
    }
    if (filters.map !== FILTER_ALL_MAPS && m.map !== filters.map) return false;
    if (filters.result !== FILTER_ALL_RESULTS && m.result !== filters.result) return false;
    if (filters.mode !== "all" && m.mode !== filters.mode) return false;
    if (filters.time !== FILTER_ALL_TIME) {
      const days = filters.time === FILTER_LAST_7 ? 7 : 30;
      const cutoff = Date.now() - days * 86400000;
      if (new Date(m.played_at).getTime() < cutoff) return false;
    }
    return true;
  });
}

function exportCsv(matches) {
  const cols = ["match_id","map","mode","result","score_own","score_opp","kills","deaths","assists","headshot_pct","adr","rating","played_at"];
  const rows = [cols.join(","), ...matches.map((m) => cols.map((c) => m[c] ?? "").join(","))];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "match_history.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function MatchHistoryPage() {
  const navigate = useNavigate();
  const t = useT();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [credOpen, setCredOpen] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [viewMode, setViewMode] = useState("list");
  const [page, setPage] = useState(1);
  const [localLibrary, setLocalLibrary] = useState({});
  const [shareCode, setShareCode] = useState("");
  const [shareCodeConsent, setShareCodeConsent] = useState(false);
  const [shareCodeBusy, setShareCodeBusy] = useState(false);
  const [shareCodeStatus, setShareCodeStatus] = useState(null);

  const doFetch = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetchMatchHistory();
      setData(res);
      setCredOpen(false);
    } catch (e) {
      setErr(e?.response?.data?.detail || t("match.fetchFail"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    API.get("/config").then(({ data: cfg }) => {
      setConfig(cfg);
      if (cfg.steam_api_key && cfg.steam_id64) {
        doFetch();
      } else {
        setCredOpen(true);
      }
    }).catch(() => setCredOpen(true));
  }, [doFetch]);

  async function handleCredSaved() {
    const { data: cfg } = await API.get("/config");
    setConfig(cfg);
    doFetch();
  }

  async function handleDownload(demoUrl, matchId, filename) {
    await downloadMatchDemo(demoUrl, matchId, filename);
    setLocalLibrary((prev) => ({ ...prev, [matchId]: true }));
  }

  async function handleShareCodeDownload(event) {
    event.preventDefault();
    setShareCodeBusy(true);
    setShareCodeStatus(null);
    try {
      const result = await downloadMatchDemoFromShareCode(shareCode.trim(), shareCodeConsent);
      setLocalLibrary((prev) => ({ ...prev, [result.match_id]: true }));
      setShareCodeStatus({ ok: true, text: t("match.shareCodeSuccess", { filename: result.filename }) });
    } catch (e) {
      setShareCodeStatus({
        ok: false,
        text: e?.response?.data?.detail || t("match.shareCodeFail"),
      });
    } finally {
      setShareCodeBusy(false);
    }
  }

  function handleGoToLibrary() {
    navigate("/library");
  }

  const allMatches = data?.matches ?? [];
  const filtered = applyFilters(allMatches, filters).map((m) => ({
    ...m,
    demo_in_library: m.demo_in_library || !!localLibrary[m.match_id],
  }));

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageMatches = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const configured = !!(config?.steam_api_key);

  return (
    <div className="flex flex-col gap-5 p-7">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold text-cs2-text-primary">
            <Trophy className="h-6 w-6 text-cs2-accent" />
            {t("match.pageTitle")}
          </h1>
          <p className="mt-0.5 text-[13.5px] text-cs2-text-secondary">
            {t("match.pageSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCredOpen((v) => !v)}
            className="rounded-[7px] border border-cs2-border px-3 py-1.5 text-[13px] font-semibold text-cs2-text-secondary hover:text-cs2-text-primary"
          >
            {t("match.btnEditCred")}
          </button>
          <button
            onClick={doFetch}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-[7px] border border-cs2-border px-3 py-1.5 text-[13px] font-semibold text-cs2-text-secondary hover:text-cs2-text-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {t("match.btnRefresh")}
          </button>
          <button
            disabled
            className="flex items-center gap-1.5 rounded-[7px] bg-cs2-accent px-3 py-1.5 text-[13px] font-semibold text-black opacity-40 cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            {t("match.btnDownloadSelected")}
          </button>
        </div>
      </div>

      {/* Demo retention notice */}
      <div
        className="flex items-start gap-3 rounded-[10px] border px-4 py-3 text-[13px]"
        style={{ background: "rgba(56,178,196,0.08)", borderColor: "rgba(56,178,196,0.25)", color: "#a5f3fc" }}
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#38b2c4]" />
        <span>
          <strong className="text-[#38b2c4]">{t("match.demoRetentionTitle")}</strong>
          {t("match.demoRetentionBody", { days: 8 })}
        </span>
      </div>


      <form
        onSubmit={handleShareCodeDownload}
        className="rounded-[10px] border border-cs2-border bg-cs2-surface px-4 py-4"
      >
        <div className="flex items-start gap-3">
          <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-cs2-accent" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-cs2-text-primary">
              {t("match.shareCodeTitle")}
            </div>
            <p className="mt-1 text-[12.5px] leading-5 text-cs2-text-secondary">
              {t("match.shareCodeDescription")}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={shareCode}
                onChange={(event) => setShareCode(event.target.value)}
                placeholder={t("match.shareCodePlaceholder")}
                className="min-w-0 flex-1 rounded-[7px] border border-cs2-border bg-cs2-bg px-3 py-2 text-[13px] text-cs2-text-primary outline-none focus:border-cs2-accent"
              />
              <button
                type="submit"
                disabled={!shareCode.trim() || !shareCodeConsent || shareCodeBusy}
                className="flex items-center justify-center gap-1.5 rounded-[7px] bg-cs2-accent px-4 py-2 text-[13px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {shareCodeBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {shareCodeBusy ? t("match.shareCodeDownloading") : t("match.shareCodeDownload")}
              </button>
            </div>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-[12px] leading-5 text-cs2-text-muted">
              <input
                type="checkbox"
                checked={shareCodeConsent}
                onChange={(event) => setShareCodeConsent(event.target.checked)}
                className="mt-1"
              />
              <span>{t("match.shareCodeConsent")}</span>
            </label>
            {shareCodeStatus && (
              <div className={`mt-2 text-[12.5px] ${shareCodeStatus.ok ? "text-cs2-success" : "text-cs2-fail"}`}>
                {shareCodeStatus.text}
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Credential panel */}
      {(credOpen || !configured) && (
        <CredentialPanel
          configured={configured && !credOpen}
          maskedKey={config?.steam_api_key}
          steamId64={config?.steam_id64}
          matchMode={config?.match_mode}
          matchCount={config?.match_count}
          onSaved={handleCredSaved}
          onSync={doFetch}
        />
      )}

      {/* Player overview */}
      {data?.player && (
        <PlayerOverviewPanel player={data.player} stats={data.stats_summary} />
      )}

      {/* Error */}
      {err && (
        <div className="rounded-[10px] border border-cs2-fail/30 bg-cs2-fail/10 px-4 py-3 text-[13px] text-cs2-fail">
          {err}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="flex items-center justify-center gap-3 py-20 text-cs2-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("match.loadingMatches")}
        </div>
      )}

      {/* Match list */}
      {data && !loading && (
        <>
          <MatchHistoryFilterBar
            filters={filters}
            onFiltersChange={(f) => { setFilters(f); setPage(1); }}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onExportCsv={() => exportCsv(filtered)}
          />

          <div className="flex flex-col gap-2.5">
            {pageMatches.length === 0 ? (
              <div className="py-16 text-center text-cs2-text-muted">{t("match.noMatches")}</div>
            ) : (
              pageMatches.map((m) => (
                <MatchHistoryRow
                  key={m.match_id}
                  match={m}
                  onDownload={handleDownload}
                  onGoToLibrary={handleGoToLibrary}
                />
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-[12.5px] text-cs2-text-muted">
              <span>{t("match.paginationRange", { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, filtered.length), total: filtered.length })}</span>
              <div className="flex gap-1">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-2 py-1 disabled:opacity-30">‹</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`min-w-[28px] rounded px-2 py-1 ${p === page ? "bg-cs2-accent text-black font-bold" : "hover:text-cs2-text-primary"}`}
                  >
                    {p}
                  </button>
                ))}
                <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="px-2 py-1 disabled:opacity-30">›</button>
              </div>
              <span>{t("match.paginationPerPage", { n: PAGE_SIZE })}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
