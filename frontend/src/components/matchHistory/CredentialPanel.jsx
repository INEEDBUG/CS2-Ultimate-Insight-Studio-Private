import { useEffect, useState } from "react";
import { Loader2, CircleCheck, UserRoundCheck, LogIn } from "lucide-react";
import { fetchSteamOpenIdStatus, startSteamOpenId, testSteamConnection, saveMatchCredentials } from "../../api/matchHistoryApi";
import { fetchLocalCs2Settings } from "../../api/trainingApi.js";
import { useT } from "../../i18n/useT.js";
import { desktopBridge } from "../../desktop/desktopBridge.js";

export default function CredentialPanel({
  configured,
  maskedKey,
  maskedAuthCode,
  maskedKnownCode,
  steamId64,
  syncedAt,
  matchMode,
  matchCount,
  onSaved,
  onSync,
}) {
  const t = useT();
  const MODES = [
    { value: "premier", label: t("match.credModePremier") },
    { value: "competitive", label: t("match.credModeCompetitive") },
  ];
  const COUNTS = [20, 50, 100];

  const [apiKey, setApiKey] = useState(maskedKey || "");
  const [id64, setId64] = useState(steamId64 || "");
  const [gameAuthCode, setGameAuthCode] = useState(maskedAuthCode || "");
  const [knownShareCode, setKnownShareCode] = useState(maskedKnownCode || "");
  const [mode, setMode] = useState(matchMode || "premier");
  const [count, setCount] = useState(matchCount || 20);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testErr, setTestErr] = useState("");
  const [localAccount, setLocalAccount] = useState(null);
  const [steamLogin, setSteamLogin] = useState(null);
  const [steamLoginBusy, setSteamLoginBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchLocalCs2Settings().then((result) => {
      if (!active) return;
      const accounts = result?.accounts || [];
      const current = accounts.find((item) => item.account_id === result?.active_account_id) || accounts[0];
      setLocalAccount(current || null);
      if (!id64 && current?.steam_id64) setId64(current.steam_id64);
    }).catch(() => {});
    return () => { active = false; };
  }, []); // Detect once; never reads or stores a Steam password.

  useEffect(() => {
    if (!steamLogin?.state || !steamLoginBusy) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      try {
        const result = await fetchSteamOpenIdStatus(steamLogin.state);
        if (stopped) return;
        if (result.status === "complete") {
          setId64(result.steam_id64);
          setTestResult({ name: result.name || result.steam_id64 });
          setSteamLoginBusy(false);
          await saveMatchCredentials(undefined, result.steam_id64, undefined, undefined, mode, count);
          if (maskedKey && maskedAuthCode && maskedKnownCode) onSaved?.();
          return;
        }
        if (result.status === "failed") {
          setTestErr(result.error || "Steam 登录失败");
          setSteamLoginBusy(false);
          return;
        }
        timer = window.setTimeout(poll, 800);
      } catch (error) {
        if (stopped) return;
        if (error?.response?.status === 404) {
          setTestErr("Steam 登录请求已过期，请重新登录");
          setSteamLoginBusy(false);
          return;
        }
        timer = window.setTimeout(poll, 1500);
      }
    };
    timer = window.setTimeout(poll, 600);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [steamLogin?.state, steamLoginBusy]);

  async function handleSteamLogin() {
    setSteamLoginBusy(true);
    setTestErr("");
    setTestResult(null);
    try {
      const flow = await startSteamOpenId();
      setSteamLogin(flow);
      if (desktopBridge?.openExternal) await desktopBridge.openExternal(flow.auth_url);
      else window.open(flow.auth_url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setSteamLoginBusy(false);
      setTestErr(error?.response?.data?.detail || "无法发起 Steam 登录");
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestErr("");
    setTestResult(null);
    try {
      const res = await testSteamConnection(apiKey, id64, gameAuthCode, knownShareCode);
      setTestResult(res);
    } catch (e) {
      setTestErr(e?.response?.data?.detail || t("match.credConnectFail"));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveMatchCredentials(apiKey || undefined, id64, gameAuthCode || undefined, knownShareCode || undefined, mode, count);
      onSaved?.();
    } catch (e) {
      setTestErr(e?.response?.data?.detail || t("match.credSaveFail"));
    } finally {
      setSaving(false);
    }
  }

  if (configured) {
    return (
      <div
        className="flex items-center gap-3 rounded-[10px] border px-5 py-3"
        style={{ background: "rgba(46,184,106,0.10)", borderColor: "rgba(46,184,106,0.28)" }}
      >
        <div
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: "#2eb86a", boxShadow: "0 0 8px #2eb86a80" }}
        />
        <div className="flex-1 text-[13px]">
          <span className="font-semibold text-[#2eb86a]">{t("match.credConfigured")}</span>
          {maskedKey && (
            <span className="ml-2 font-mono text-[12px] text-cs2-text-secondary">
              Key: {maskedKey}
            </span>
          )}
          {steamId64 && (
            <span className="ml-2 font-mono text-[12px] text-cs2-text-secondary">
              · {steamId64}
            </span>
          )}
          {syncedAt && (
            <span className="ml-2 text-[11px] text-cs2-text-muted">· {t("match.credLastSync", { time: syncedAt })}</span>
          )}
        </div>
        <button
          onClick={onSync}
          className="rounded-[7px] border border-cs2-border px-3 py-1 text-[12px] text-cs2-text-secondary hover:text-cs2-text-primary"
        >
          {t("match.credSync")}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-cs2-border bg-[#16161a] px-6 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[9px] border border-[#66c0f4]/30 bg-[#66c0f4]/[0.08] px-4 py-3">
        <LogIn className="h-5 w-5 text-[#66c0f4]" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-cs2-text-primary">使用 Steam 登录并绑定账号</p>
          <p className="mt-0.5 text-[10px] text-cs2-text-muted">密码只在 Steam 官方网页输入；OpenID 仅返回 SteamID，不会读取密码。逐局同步仍需一次性配置下方游戏认证码。</p>
        </div>
        <button type="button" onClick={handleSteamLogin} disabled={steamLoginBusy} className="flex items-center gap-1.5 rounded-[7px] bg-[#66c0f4] px-3 py-1.5 text-[11px] font-bold text-[#101820] transition-transform duration-150 active:scale-[0.97] disabled:opacity-50">{steamLoginBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}{steamLoginBusy ? "等待 Steam 确认" : "使用 Steam 登录"}</button>
      </div>
      {localAccount && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[9px] border border-sky-400/25 bg-sky-400/[0.07] px-4 py-3">
          <UserRoundCheck className="h-5 w-5 text-sky-300" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-cs2-text-primary">已识别本机当前 Steam 账号：{localAccount.persona_name || localAccount.account_name}</p>
            <p className="mt-0.5 font-mono text-[10px] text-cs2-text-muted">{localAccount.steam_id64} · 只读取 Steam 本地账号列表，不读取密码或登录 Cookie</p>
          </div>
          <button type="button" onClick={() => setId64(localAccount.steam_id64)} className="rounded-[7px] border border-sky-400/35 px-3 py-1.5 text-[11px] font-semibold text-sky-200 transition-transform duration-150 active:scale-[0.97]">使用此账号</button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 xl:grid-cols-2">
        {/* API Key */}
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-cs2-text-secondary">
            Steam Web API Key
            <a
              href="https://steamcommunity.com/dev/apikey"
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-cs2-accent underline"
            >
              {t("match.credGetKey")}
            </a>
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t("match.credApiKeyPlaceholder")}
            className="w-full rounded-[7px] border border-cs2-border bg-cs2-bg-input px-3 py-2 font-mono text-[12.5px] text-cs2-text-primary placeholder:text-cs2-text-muted focus:border-cs2-accent focus:outline-none"
          />
          <p className="mt-1 text-[11.5px] text-cs2-text-muted">
            {t("match.credApiKeyHint")}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-cs2-text-secondary">
            游戏认证码
            <a href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128" target="_blank" rel="noreferrer" className="ml-2 text-cs2-accent underline">获取</a>
          </label>
          <input
            type="password"
            value={gameAuthCode}
            onChange={(e) => setGameAuthCode(e.target.value)}
            placeholder="AAAA-AAAAA-AAAA"
            className="w-full rounded-[7px] border border-cs2-border bg-cs2-bg-input px-3 py-2 font-mono text-[12.5px] text-cs2-text-primary placeholder:text-cs2-text-muted focus:border-cs2-accent focus:outline-none"
          />
          <p className="mt-1 text-[11.5px] text-cs2-text-muted">由 Steam 为 CS2 比赛历史生成，仅保存在本机。</p>
        </div>

        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-cs2-text-secondary">起始比赛分享码</label>
          <input
            type="text"
            value={knownShareCode}
            onChange={(e) => setKnownShareCode(e.target.value)}
            placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
            className="w-full rounded-[7px] border border-cs2-border bg-cs2-bg-input px-3 py-2 font-mono text-[12.5px] text-cs2-text-primary placeholder:text-cs2-text-muted focus:border-cs2-accent focus:outline-none"
          />
          <p className="mt-1 text-[11.5px] text-cs2-text-muted">从 CS2 对局历史复制一场属于当前账号的分享码；软件会从此场向新比赛增量同步。</p>
        </div>

        {/* SteamID64 */}
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-cs2-text-secondary">
            Steam64ID
            <a
              href="https://www.steamidfinder.com/"
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-cs2-accent underline"
            >
              {t("match.credLookupId")}
            </a>
          </label>
          <input
            type="text"
            value={id64}
            onChange={(e) => setId64(e.target.value)}
            placeholder={t("match.credSteamIdPlaceholder")}
            className="w-full rounded-[7px] border border-cs2-border bg-cs2-bg-input px-3 py-2 font-mono text-[12.5px] text-cs2-text-primary placeholder:text-cs2-text-muted focus:border-cs2-accent focus:outline-none"
          />
          <p className="mt-1 text-[11.5px] text-cs2-text-muted">
            {t("match.credSteamIdHint")}
          </p>
        </div>

        {/* Mode */}
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-cs2-text-secondary">
            {t("match.credModeLabel")}
          </label>
          <div className="flex gap-1">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={`flex-1 rounded-[7px] border px-3 py-2 text-[12.5px] font-semibold transition-colors ${
                  mode === m.value
                    ? "border-cs2-accent/60 bg-cs2-accent/10 text-cs2-accent"
                    : "border-cs2-border text-cs2-text-secondary hover:text-cs2-text-primary"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Count */}
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-cs2-text-secondary">
            {t("match.credCountLabel")}
          </label>
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full rounded-[7px] border border-cs2-border bg-cs2-bg-input px-3 py-2 text-[12.5px] text-cs2-text-primary focus:border-cs2-accent focus:outline-none"
          >
            {COUNTS.map((c) => (
              <option key={c} value={c}>{t("match.credCountOption", { n: c })}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Risk notice */}
      <div
        className="mt-4 rounded-[8px] border px-4 py-3 text-[12px] leading-relaxed text-cs2-text-secondary"
        style={{ background: "rgba(255,140,0,0.07)", borderColor: "rgba(255,140,0,0.25)" }}
      >
        <span className="font-semibold text-cs2-accent">{t("match.credSecurityTitle")}</span>
        Steam 官方比赛历史同步必须同时使用 API Key、游戏认证码和已知分享码。所有凭据只写入本机配置；日志不会记录请求查询串。若凭据可能泄露，请前往 {" "}
        <a
          href="https://steamcommunity.com/dev/apikey"
          target="_blank"
          rel="noreferrer"
          className="text-cs2-accent underline"
        >
          Steam 开发者页面
        </a>
        {" "}重新生成 API Key，并在 Steam 帮助页撤销游戏认证码。
      </div>

      {testResult && (
        <div className="mt-3 flex items-center gap-2 text-[12.5px] text-[#2eb86a]">
          <CircleCheck className="h-4 w-4" />
          {t("match.credConnectSuccess", { name: testResult.name })}
        </div>
      )}
      {testErr && <p className="mt-2 text-[12.5px] text-cs2-fail">{testErr}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={handleTest}
          disabled={testing || !apiKey || !id64 || !gameAuthCode || !knownShareCode || apiKey.startsWith("****") || gameAuthCode.startsWith("****") || knownShareCode.startsWith("CSGO-****")}
          className="flex items-center gap-1.5 rounded-[7px] border border-cs2-border px-4 py-2 text-[13px] font-semibold text-cs2-text-secondary hover:text-cs2-text-primary disabled:opacity-50"
        >
          {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("match.credTestBtn")}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !apiKey || !id64 || !gameAuthCode || !knownShareCode}
          className="flex items-center gap-1.5 rounded-[7px] bg-cs2-accent px-4 py-2 text-[13px] font-semibold text-black hover:bg-cs2-accent-light disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("match.credSaveBtn")}
        </button>
      </div>
    </div>
  );
}
