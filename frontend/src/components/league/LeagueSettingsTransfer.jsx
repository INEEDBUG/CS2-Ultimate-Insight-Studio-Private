import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";

const EXPORT_FORMAT = "cs2-ultimate-insight-studio/league-settings";
const EXPORT_SCHEMA_VERSION = 1;
const MAX_IMPORT_BYTES = 1024 * 1024;
const SENSITIVE_KEY = /(password|passwd|secret|token|credential|private.?key|api.?key|authorization|cookie)/i;
const SAFETY_DEFAULTS = {
  automation_enabled: false,
  toolkit_account_actions_enabled: false,
  in_game_send_enabled: false,
  terminate_game_shortcut_enabled: false,
  opgg_auto_apply_runes: false,
  opgg_auto_apply_spells: false,
  opgg_auto_apply_items: false,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripSensitiveValues(value) {
  if (Array.isArray(value)) return value.map(stripSensitiveValues);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, item]) => [key, stripSensitiveValues(item)]));
}

export function buildLeagueSettingsExport(settings, exportedAt = new Date().toISOString()) {
  return {
    format: EXPORT_FORMAT,
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: exportedAt,
    settings: stripSensitiveValues(settings || {}),
  };
}

export function parseLeagueSettingsImport(text, currentSettings = {}) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  const imported = document?.format === EXPORT_FORMAT ? document.settings : document;
  if (!isPlainObject(imported)) throw new Error("文件中没有有效的 League 设置对象");
  if (document?.format === EXPORT_FORMAT && Number(document.schema_version) > EXPORT_SCHEMA_VERSION) {
    throw new Error("该设置文件来自更新版本，当前客户端无法安全导入");
  }
  const allowed = new Set(Object.keys(currentSettings || {}));
  const sanitized = Object.fromEntries(Object.entries(stripSensitiveValues(imported))
    .filter(([key]) => allowed.has(key)));
  if (!Object.keys(sanitized).length) throw new Error("设置文件没有当前版本可识别的字段");
  return { ...sanitized, ...SAFETY_DEFAULTS };
}

export default function LeagueSettingsTransfer({ settings, busy = false, onImport, onError }) {
  const inputRef = useRef(null);
  const [message, setMessage] = useState("");

  const exportSettings = () => {
    const payload = JSON.stringify(buildLeagueSettingsExport(settings), null, 2);
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `league-settings-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("设置已导出；账号凭据和密钥不会写入文件。");
  };

  const importSettings = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("设置文件超过 1 MB，已拒绝导入");
      const imported = parseLeagueSettingsImport(await file.text(), settings);
      if (!window.confirm("导入会覆盖当前 League 设置；所有自动化和账号写入总开关将保持关闭。继续吗？")) return;
      await onImport?.(imported);
      setMessage("设置已导入；自动化、账号写入和自动套用功能仍为关闭状态。");
    } catch (error) {
      setMessage("");
      onError?.(String(error?.message || error || "设置导入失败"));
    }
  };

  return (
    <section className="rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4">
      <h3 className="text-sm font-bold">League 设置备份</h3>
      <p className="mt-1 text-xs leading-5 text-cs2-text-muted">导出或恢复实验室配置。导出文件不包含 LCU/Riot 凭据；导入后所有会操作账号或游戏进程的总开关一律保持关闭。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={exportSettings} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40"><Download className="h-4 w-4"/>导出 JSON</button>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 disabled:opacity-40"><Upload className="h-4 w-4"/>导入 JSON</button>
        <input ref={inputRef} aria-label="选择 League 设置文件" type="file" accept="application/json,.json" className="hidden" onChange={importSettings}/>
      </div>
      {message && <p role="status" className="mt-3 text-xs text-emerald-300">{message}</p>}
    </section>
  );
}
