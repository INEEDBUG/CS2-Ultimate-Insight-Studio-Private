import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Keyboard, Plus, RefreshCw, Save, Send, Trash2, X } from "lucide-react";
import {
  cancelLeagueInGameSend,
  fetchLeagueLabStatus,
  fetchLeagueOngoingGame,
  sendLeagueInGameLines,
  sendLeagueInGamePreset,
} from "../../api/leagueLabApi";
import { maskLeagueName } from "../../utils/leagueStreamerMode";

const DRAFT_STORAGE_KEY = "league-in-game-preset-draft-v1";
const createPresetId = () => `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const TARGET_OPTIONS = [
  ["all", "双方全部"],
  ["friendly", "仅己方"],
  ["enemy", "仅敌方"],
  ["selected", "手动选择"],
];
const SHORTCUT_TARGETS = [["friendly", "己方"], ["enemy", "敌方"], ["all", "双方"]];
const NAME_STRATEGIES = [
  ["preferName", "优先玩家名"],
  ["preferChampionName", "优先当前英雄"],
  ["championNameWithName", "英雄 · 玩家名"],
];
const RATING_OPTIONS = [
  ["recentMatches", "近期场次", "近几场样本数"],
  ["winRate", "胜率", "近期样本胜率"],
  ["kda", "平均 KDA", "近期样本平均 KDA"],
  ["championUsage", "当前英雄使用", "当前英雄样本场数、胜率与 KDA"],
  ["akariScore", "Akari Score", "现有对局分析聚合评分"],
  ["position", "当前分路", "当前队伍或选人阶段提供的分路"],
  ["performanceTags", "表现标签", "现有性能标签文本"],
];
const JUNGLE_OPTIONS = [
  ["gamesAnalyzed", "分析场数", "打野时间线样本数"],
  ["activityPreference", "活动区域", "上、中、下半区活动偏好"],
  ["firstClearDistribution", "首开分布", "首个野区营地偏好"],
  ["earlyGank", "早期参与", "3/4 分钟参与击杀率"],
  ["gankVolume", "平均 Gank", "各分路平均参与击杀数"],
];

function createDefaultDrafts() {
  return {
    rating: {
      targetMode: "all",
      selectedPuuids: [],
      nameDisplayStrategy: "preferName",
      showCurrentChampion: false,
      display: Object.fromEntries(RATING_OPTIONS.map(([key]) => [key, false])),
    },
    jungle: {
      targetMode: "all",
      selectedPuuids: [],
      nameDisplayStrategy: "preferName",
      showCurrentChampion: false,
      display: Object.fromEntries(JUNGLE_OPTIONS.map(([key]) => [key, false])),
    },
    premade: {
      targetMode: "all",
      selectedPuuids: [],
      nameDisplayStrategy: "preferName",
    },
  };
}

function readDrafts() {
  const defaults = createDefaultDrafts();
  if (typeof window === "undefined") return defaults;
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return defaults;
    return {
      rating: { ...defaults.rating, ...(saved.rating || {}), display: { ...defaults.rating.display, ...(saved.rating?.display || {}) } },
      jungle: { ...defaults.jungle, ...(saved.jungle || {}), display: { ...defaults.jungle.display, ...(saved.jungle?.display || {}) } },
      premade: { ...defaults.premade, ...(saved.premade || {}) },
    };
  } catch {
    return defaults;
  }
}

function playerKey(player, index) {
  return String(player?.puuid || player?.playerPuuid || `player-${player?.team || "unknown"}-${index}`);
}

function playerName(player, index, strategy, streamerMode = false, useAliases = false) {
  const rawName = player?.summoner?.gameName || player?.game_name || `玩家 ${index + 1}`;
  const name = streamerMode ? maskLeagueName(rawName, index, useAliases, player?.puuid || player?.playerPuuid) : rawName;
  const champion = player?.champion_name || "";
  if (strategy === "preferChampionName") return champion || name;
  if (strategy === "championNameWithName") return champion ? `${champion} · ${name}` : name;
  return name;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatCount(value) {
  const number = finiteNumber(value);
  return number == null ? "—" : String(number);
}

function formatDecimal(value, digits = 2) {
  const number = finiteNumber(value);
  return number == null ? "—" : number.toFixed(digits);
}

function percent(value) {
  const number = finiteNumber(value);
  return number == null ? "—" : `${Math.round(number * 100)}%`;
}

function ratioPercent(value, total) {
  const numerator = finiteNumber(value);
  const denominator = finiteNumber(total);
  return numerator == null || denominator == null || denominator <= 0 ? "—" : `${Math.round(numerator / denominator * 100)}%`;
}

function laneLabel(value) {
  return { top: "上半区", mid: "中路", bot: "下半区", unknown: "未知区域" }[value] || value || "未知区域";
}

function campLabel(value) {
  const [side, camp] = String(value || "").split(":");
  const sideText = { blue: "蓝色方野区", red: "红色方野区" }[side] || "未知野区";
  const campText = { blue: "蓝 BUFF", red: "红 BUFF", wolves: "三狼", raptors: "F6", krugs: "石甲虫" }[camp] || camp || "未知营地";
  return `${sideText} ${campText}`;
}

function buildRatingLines(players, draft, privacy) {
  return players.map((player, index) => {
    const recent = player?.recent || {};
    const usage = player?.champion_usage || {};
    const matches = finiteNumber(recent.matches);
    const values = [];
    if (draft.display.recentMatches) values.push(`近 ${formatCount(matches)} 场`);
    if (draft.display.winRate) values.push(`胜率 ${ratioPercent(recent.wins, matches)}`);
    if (draft.display.kda) values.push(`KDA ${formatDecimal(recent.average_kda)}`);
    if (draft.display.championUsage) values.push(`${player?.champion_name || "当前英雄"} ${formatCount(usage.matches)} 场 / ${ratioPercent(usage.wins, usage.matches)}胜率 / KDA ${formatDecimal(usage.average_kda)}`);
    if (draft.display.akariScore) values.push(`Akari ${formatDecimal(recent.akari_score)}`);
    if (draft.display.position && player?.position) values.push(`分路 ${player.position}`);
    if (draft.display.performanceTags && Array.isArray(player?.performance_tags) && player.performance_tags.length) values.push(player.performance_tags.map((tag) => tag.label || tag.title || tag.id).filter(Boolean).join("、"));
    if (draft.showCurrentChampion && player?.champion_name) values.push(`当前 ${player.champion_name}`);
    return `${playerName(player, index, draft.nameDisplayStrategy, privacy.streamerMode, privacy.useAliases)}：${values.length ? values.join("，") : "未选择可发送指标"}`;
  });
}

function buildJungleLines(players, draft, privacy) {
  return players.map((player, index) => {
    const jungle = player?.jungle_analysis || {};
    const values = [];
    if (!Number(jungle.games_analyzed || 0)) return `${playerName(player, index, draft.nameDisplayStrategy, privacy.streamerMode, privacy.useAliases)}：暂无可用打野时间线`;
    if (draft.display.gamesAnalyzed) values.push(`分析 ${jungle.games_analyzed} 场`);
    if (draft.display.activityPreference) values.push(`活动偏好 ${laneLabel(jungle.preferred_lane)}${jungle.zone_percentages ? `（上 ${percent(jungle.zone_percentages.top)} / 中 ${percent(jungle.zone_percentages.mid)} / 下 ${percent(jungle.zone_percentages.bot)}）` : ""}`);
    if (draft.display.firstClearDistribution) values.push(`首开 ${campLabel(jungle.preferred_start_camp)}`);
    if (draft.display.earlyGank) values.push(`早期参与 3 分钟 ${percent(jungle.early_gank?.level3_rate)} / 4 分钟 ${percent(jungle.early_gank?.level4_rate)}`);
    if (draft.display.gankVolume && jungle.average_ganks) values.push(`平均 Gank 上 ${formatDecimal(jungle.average_ganks.top, 1)} / 中 ${formatDecimal(jungle.average_ganks.mid, 1)} / 下 ${formatDecimal(jungle.average_ganks.bot, 1)}`);
    if (draft.showCurrentChampion && player?.champion_name) values.push(`当前 ${player.champion_name}`);
    return `${playerName(player, index, draft.nameDisplayStrategy, privacy.streamerMode, privacy.useAliases)}：${values.length ? values.join("，") : "未选择可发送指标"}`;
  });
}

function buildPremadeLines(players, draft, privacy) {
  const groups = new Map();
  players.forEach((player, index) => {
    if (!player?.premade_group) return;
    const key = Number(player.premade_group);
    if (!Number.isSafeInteger(key) || key <= 0) return;
    const names = groups.get(key) || [];
    names.push(playerName(player, index, draft.nameDisplayStrategy, privacy.streamerMode, privacy.useAliases));
    groups.set(key, names);
  });
  return [...groups.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([group, names]) => `组排 ${String.fromCharCode(64 + group)}：${names.join("、")}`);
}

function Toggle({ label, description, checked, disabled, onChange }) {
  return <label className={`flex items-center justify-between gap-3 rounded-lg border border-cs2-border-subtle px-3 py-2 text-xs ${disabled ? "opacity-40" : ""}`}>
    <span><b className="block">{label}</b>{description ? <small className="mt-0.5 block text-[10px] text-cs2-text-muted">{description}</small> : null}</span>
    <input type="checkbox" aria-label={label} checked={Boolean(checked)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-indigo-400"/>
  </label>;
}

function TargetPicker({ kind, draft, players, ownPuuid, disabled, streamerMode, useAliases, onChange }) {
  const own = players.find((player) => player?.puuid === ownPuuid);
  return <section className="rounded-xl border border-cs2-border-subtle p-3">
    <div className="flex flex-wrap items-center gap-2"><b className="text-xs">目标玩家</b><select aria-label={`${kind}目标范围`} value={draft.targetMode} disabled={disabled} onChange={(event) => onChange({ targetMode: event.target.value })} className="rounded-lg border border-cs2-border bg-cs2-bg-input px-2 py-1.5 text-xs">{TARGET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="text-[10px] text-cs2-text-muted">{players.length ? `已读取 ${players.length} 人` : "请先读取当前玩家"}</span></div>
    {draft.targetMode === "selected" ? <div className="mt-2 grid max-h-44 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">{players.map((player, index) => { const key = playerKey(player, index); const visibleName = playerName(player, index, draft.nameDisplayStrategy, streamerMode, useAliases); return <label key={key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/5"><input type="checkbox" aria-label={`选择 ${visibleName}`} checked={draft.selectedPuuids.includes(key)} disabled={disabled} onChange={(event) => onChange({ selectedPuuids: event.target.checked ? [...new Set([...draft.selectedPuuids, key])] : draft.selectedPuuids.filter((value) => value !== key) })} className="h-3.5 w-3.5 accent-indigo-400"/><span className="truncate">{visibleName}</span></label>; })}</div> : null}
    {(draft.targetMode === "friendly" || draft.targetMode === "enemy") && !own ? <p className="mt-2 text-[10px] text-amber-200">当前数据中没有匹配本机召唤师，无法证明己方/敌方范围；请改用双方全部或手动选择。</p> : null}
  </section>;
}

function ShortcutGrid({ kind, settings, busy, enabled, onSave }) {
  const key = `in_game_${kind}_shortcuts`;
  return <div className="mt-3 rounded-xl border border-cs2-border-subtle p-3"><b className="text-xs">{kind === "rating" ? "评分" : kind === "jungle" ? "打野画像" : "组排关系"}快捷键</b><p className="mt-1 text-[10px] text-cs2-text-muted">留空即关闭；快捷键读取最新数据后按目标生成。后端当前只持久化快捷键，下面的名字/指标 draft 只影响页面手动预览和发送，不会改变快捷键内容。</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{SHORTCUT_TARGETS.map(([target, label]) => <label key={target} className="text-[10px] text-cs2-text-muted"><span>{label}</span><input aria-label={`${kind === "rating" ? "近期表现" : kind === "jungle" ? "打野画像" : "组排关系"}${label}快捷键`} defaultValue={settings?.[key]?.[target] || ""} maxLength={80} disabled={!enabled || busy} onBlur={(event) => onSave(target, event.target.value)} placeholder="未设置" className="mt-1 w-full rounded-lg border border-cs2-border bg-cs2-bg-input px-2 py-1.5 font-mono text-xs disabled:opacity-40"/></label>)}</div></div>;
}

export default function LeagueInGamePresetTools({ settings, busy, onSettingsUpdate, onBusyChange, onError, streamerMode = false, useAliases = false }) {
  const [tab, setTab] = useState("rating");
  const [items, setItems] = useState(() => Array.isArray(settings?.in_game_fixed_presets) ? settings.in_game_fixed_presets : []);
  const [drafts, setDrafts] = useState(readDrafts);
  const [players, setPlayers] = useState([]);
  const [ownPuuid, setOwnPuuid] = useState("");
  const [playersBusy, setPlayersBusy] = useState(false);
  const [playersError, setPlayersError] = useState("");
  const [previews, setPreviews] = useState({ rating: [], jungle: [], premade: [] });
  const playersRequest = useRef(0);

  useEffect(() => setItems(Array.isArray(settings?.in_game_fixed_presets) ? settings.in_game_fixed_presets : []), [settings?.in_game_fixed_presets]);
  useEffect(() => {
    try { window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts)); } catch { /* local-only preferences are best effort */ }
  }, [drafts]);
  useEffect(() => () => { playersRequest.current += 1; }, []);

  const enabled = Boolean(settings?.toolkit_account_actions_enabled && settings?.in_game_send_enabled);
  const updateDraft = (kind, patch) => setDrafts((current) => ({ ...current, [kind]: { ...current[kind], ...patch, display: patch.display ? { ...current[kind].display, ...patch.display } : current[kind].display } }));
  const persist = async (next) => { onBusyChange(true); try { await onSettingsUpdate({ in_game_fixed_presets: next }); setItems(next); } catch (error) { onError(error?.response?.data?.detail || "保存游戏内预设失败"); } finally { onBusyChange(false); } };
  const patchItem = (id, patch) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const add = () => persist([...items, { id: createPresetId(), title: "未命名预设", shortcut: null, content: "" }]);
  const remove = (id) => { if (window.confirm("删除这条固定文字预设？")) persist(items.filter((item) => item.id !== id)); };
  const move = (id, offset) => { const index = items.findIndex((item) => item.id === id); const target = index + offset; if (index < 0 || target < 0 || target >= items.length) return; const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; persist(next); };
  const sendFixed = async (id) => { if (window.prompt("该操作会向当前房间、英雄选择或前台游戏聊天发送预设内容。\n请输入“我确认发送”继续：") !== "我确认发送") return; onBusyChange(true); try { await sendLeagueInGamePreset(id, "manual", "我确认发送"); } catch (error) { onError(error?.response?.data?.detail || "发送预设失败"); } finally { onBusyChange(false); } };
  const toggle = async (value) => { if (value && !window.confirm("启用后，已配置快捷键的固定文字预设可在软件驻留后台时发送；只有房间、英雄选择或前台英雄联盟游戏阶段会执行。确定启用吗？")) return; await onSettingsUpdate({ in_game_send_enabled: value }); };
  const saveGeneratedShortcut = (kind, target, value) => { const key = `in_game_${kind}_shortcuts`; return onSettingsUpdate({ [key]: { friendly: null, enemy: null, all: null, ...(settings?.[key] || {}), [target]: String(value || "").trim() || null } }); };

  const readPlayers = async () => {
    const request = ++playersRequest.current;
    setPlayersBusy(true); setPlayersError("");
    try {
      const [game, status] = await Promise.all([fetchLeagueOngoingGame(), fetchLeagueLabStatus()]);
      if (request !== playersRequest.current) return { players: [], ownPuuid: "" };
      const nextPlayers = Array.isArray(game?.players) ? game.players : [];
      const nextOwn = String(status?.current_summoner?.puuid || "");
      setPlayers(nextPlayers); setOwnPuuid(nextOwn);
      if (!nextPlayers.length) setPlayersError("当前没有可读取的房间或对局玩家。");
      return { players: nextPlayers, ownPuuid: nextOwn };
    } catch (error) {
      if (request !== playersRequest.current) return { players: [], ownPuuid: "" };
      const message = error?.response?.data?.detail || error?.message || "实时玩家读取失败";
      setPlayersError(message); onError(message); return { players: [], ownPuuid: "" };
    } finally { if (request === playersRequest.current) setPlayersBusy(false); }
  };

  const selectPlayers = (kind, sourcePlayers = players, sourceOwn = ownPuuid) => {
    const draft = drafts[kind];
    const own = sourcePlayers.find((player) => String(player?.puuid || "") === String(sourceOwn || ""));
    if (draft.targetMode === "selected") return sourcePlayers.filter((player, index) => draft.selectedPuuids.includes(playerKey(player, index)));
    if (!own || draft.targetMode === "all") return draft.targetMode === "all" ? sourcePlayers : [];
    return sourcePlayers.filter((player) => draft.targetMode === "friendly" ? String(player?.team) === String(own.team) : String(player?.team) !== String(own.team));
  };

  const generate = async (kind) => {
    let sourcePlayers = players; let sourceOwn = ownPuuid;
    if (!sourcePlayers.length) ({ players: sourcePlayers, ownPuuid: sourceOwn } = await readPlayers());
    const selected = selectPlayers(kind, sourcePlayers, sourceOwn);
    const privacy = { streamerMode, useAliases };
    const lines = kind === "rating" ? buildRatingLines(selected, drafts.rating, privacy) : kind === "jungle" ? buildJungleLines(selected, drafts.jungle, privacy) : buildPremadeLines(selected, drafts.premade, privacy);
    setPreviews((current) => ({ ...current, [kind]: lines }));
  };

  const sendGenerated = async (kind) => {
    const lines = previews[kind] || [];
    if (!lines.length) { onError("请先读取玩家并生成预览"); return; }
    if (window.prompt("该操作会向当前房间、英雄选择或前台游戏聊天发送生成的预设。\n请输入“我确认发送”继续：") !== "我确认发送") return;
    onBusyChange(true);
    try { await sendLeagueInGameLines(lines.slice(0, 10), "我确认发送", "manual", kind, drafts[kind].targetMode === "selected" ? null : drafts[kind].targetMode); } catch (error) { onError(error?.response?.data?.detail || "发送生成预设失败"); } finally { onBusyChange(false); }
  };

  const cancelSend = async () => { onBusyChange(true); try { await cancelLeagueInGameSend(); } catch (error) { onError(error?.response?.data?.detail || "取消发送失败"); } finally { onBusyChange(false); } };
  const renderGenerated = (kind, label, description, options) => {
    const draft = drafts[kind];
    const lines = previews[kind] || [];
    return <div className="space-y-3">
      <p className="text-xs leading-5 text-cs2-text-muted">{description}</p>
      <div className="flex flex-wrap gap-2"><button onClick={readPlayers} disabled={playersBusy || busy} className="inline-flex items-center gap-1 rounded-lg border border-cs2-border px-3 py-1.5 text-xs disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${playersBusy ? "animate-spin" : ""}`}/>读取当前玩家</button><button onClick={() => generate(kind)} disabled={playersBusy || busy || !players.length} className="rounded-lg border border-indigo-400/30 bg-indigo-400/10 px-3 py-1.5 text-xs font-semibold text-indigo-200 disabled:opacity-40">生成预览</button><button onClick={() => sendGenerated(kind)} disabled={!enabled || busy || !lines.length} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 disabled:opacity-40"><Send className="h-3.5 w-3.5"/>发送预览</button><button onClick={cancelSend} disabled={!enabled || busy} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-200 disabled:opacity-40"><X className="h-3.5 w-3.5"/>取消发送</button></div>
      {playersError ? <div role="alert" className="rounded-lg border border-amber-400/25 bg-amber-400/[.05] px-3 py-2 text-xs text-amber-200">{playersError}</div> : null}
      {players.length ? <TargetPicker kind={label} draft={draft} players={players} ownPuuid={ownPuuid} streamerMode={streamerMode} useAliases={useAliases} disabled={busy || playersBusy} onChange={(patch) => updateDraft(kind, patch)}/> : null}
      <div className="grid gap-3 lg:grid-cols-2"><section className="space-y-2 rounded-xl border border-cs2-border-subtle p-3"><b className="text-xs">名字与显示配置</b><label className="mt-2 block text-xs text-cs2-text-muted">名字显示策略<select aria-label={`${label}名字显示策略`} value={draft.nameDisplayStrategy} disabled={busy} onChange={(event) => updateDraft(kind, { nameDisplayStrategy: event.target.value })} className="mt-1 w-full rounded-lg border border-cs2-border bg-cs2-bg-input px-2 py-1.5 text-xs">{NAME_STRATEGIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>{"showCurrentChampion" in draft ? <Toggle label="显示当前英雄" description="只使用当前 payload 中的 champion_name。" checked={draft.showCurrentChampion} disabled={busy} onChange={(value) => updateDraft(kind, { showCurrentChampion: value })}/> : null}</section><section className="space-y-2 rounded-xl border border-cs2-border-subtle p-3"><b className="text-xs">可证明指标</b>{options.length ? options.map(([key, text, hint]) => <Toggle key={key} label={text} description={hint} checked={draft.display[key]} disabled={busy} onChange={(value) => updateDraft(kind, { display: { [key]: value } })}/>) : <p className="text-xs text-cs2-text-muted">组排关系由已有 `premade_group` 直接生成，不需要额外猜测指标。</p>}</section></div>
      <div className="rounded-xl border border-cs2-border-subtle p-3"><div className="flex items-center justify-between gap-2"><b className="text-xs">生成预览</b><span className="text-[10px] text-cs2-text-muted">最多发送前 10 行 · 当前 {lines.length} 行</span></div><textarea aria-label={`${label}生成预览`} readOnly value={lines.join("\n")} placeholder="读取玩家后点击“生成预览”；未选择指标时不会虚构数据。" rows={Math.min(10, Math.max(4, lines.length || 4))} className="mt-2 w-full resize-y rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 font-mono text-xs"/></div>
      <ShortcutGrid kind={kind} settings={settings} busy={busy} enabled={enabled} onSave={(target, value) => saveGeneratedShortcut(kind, target, value)}/>
    </div>;
  };

  return <section className="rounded-2xl border border-indigo-400/20 bg-cs2-bg-elevated p-4">
    <div className="flex flex-wrap items-center gap-3"><Keyboard className="h-4 w-4 text-indigo-300"/><div className="mr-auto"><h3 className="text-sm font-bold">游戏内预设</h3><p className="mt-1 text-xs text-cs2-text-muted">Rating、打野画像、组排关系和固定文字四个预设页。生成内容只使用当前已读取的 LCU payload；发送默认关闭，并受账号写入 gate 保护。</p></div><button role="switch" aria-label="启用游戏内预设发送" aria-checked={Boolean(settings?.in_game_send_enabled)} disabled={!settings?.toolkit_account_actions_enabled || busy} onClick={() => toggle(!settings?.in_game_send_enabled)} className={`relative h-6 w-11 rounded-full ${settings?.in_game_send_enabled ? "bg-indigo-500" : "bg-cs2-bg-input"} disabled:opacity-40`}><span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${settings?.in_game_send_enabled ? "translate-x-5" : ""}`}/></button></div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><label className="text-xs text-cs2-text-muted">逐行间隔 <input aria-label="逐行发送间隔" type="number" min="100" max="5000" value={settings?.in_game_send_interval_ms || 250} disabled={!settings?.toolkit_account_actions_enabled || busy} onChange={(event) => onSettingsUpdate({ in_game_send_interval_ms: Number(event.target.value) })} className="ml-1 w-20 rounded-lg border border-cs2-border bg-cs2-bg-input px-2 py-1.5"/> ms</label><button onClick={cancelSend} disabled={!enabled || busy} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-1.5 text-xs text-rose-200 disabled:opacity-40"><X className="h-3.5 w-3.5"/>取消当前发送</button></div>
    <div role="tablist" aria-label="游戏内预设类型" className="mt-4 flex flex-wrap gap-1 border-b border-cs2-border-subtle">{[["rating", "Rating"], ["jungle", "打野画像"], ["premade", "组排关系"], ["fixed", "固定文字"]].map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`rounded-t-lg px-3 py-2 text-xs font-semibold ${tab === value ? "bg-indigo-400/15 text-indigo-200" : "text-cs2-text-muted hover:bg-white/5"}`}>{label}</button>)}</div>
    <div className="mt-4">{tab === "rating" ? renderGenerated("rating", "Rating", "对齐 LeagueAkari 的评分预设交互，但仅显示宿主目前能从 ongoing-game 返回的近期样本、当前英雄使用、Akari Score、分路和标签。solo kills、视野、伤害、承伤、金币、补刀效率等字段当前 payload 未提供，因此不伪造。", RATING_OPTIONS) : null}{tab === "jungle" ? renderGenerated("jungle", "打野画像", "仅基于已返回的 jungle_analysis 时间线聚合：活动区域、首开营地、早期参与和平均 Gank。龙控、野怪控和历史主力英雄字段当前 payload 未提供。", JUNGLE_OPTIONS) : null}{tab === "premade" ? renderGenerated("premade", "组排关系", "根据当前 payload 的 premade_group 生成组排关系；没有可证明的组排关系时保持空预览，不猜测队友关系。", []) : null}{tab === "fixed" ? <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><button disabled={!settings?.toolkit_account_actions_enabled || busy || items.length >= 100} onClick={add} className="inline-flex items-center gap-1 rounded-lg border border-indigo-400/25 bg-indigo-400/10 px-3 py-1.5 text-xs text-indigo-200 disabled:opacity-40"><Plus className="h-3.5 w-3.5"/>新增预设</button><button disabled={!settings?.toolkit_account_actions_enabled || busy} onClick={() => persist(items)} className="inline-flex items-center gap-1 rounded-lg border border-cs2-border px-3 py-1.5 text-xs disabled:opacity-40"><Save className="h-3.5 w-3.5"/>保存全部</button></div><div className="space-y-2">{items.map((item, index) => <article key={item.id} className="grid gap-2 rounded-xl border border-cs2-border-subtle p-3 lg:grid-cols-[180px_160px_1fr_auto]"><input aria-label={`预设标题 ${item.id}`} value={item.title} maxLength={64} onChange={(event) => patchItem(item.id, { title: event.target.value })} placeholder="预设标题" className="rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><input aria-label={`预设快捷键 ${item.id}`} value={item.shortcut || ""} maxLength={80} onChange={(event) => patchItem(item.id, { shortcut: event.target.value.trim() || null })} placeholder="可选，如 Ctrl+Alt+H" className="rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><textarea aria-label={`预设内容 ${item.id}`} value={item.content} maxLength={65536} rows={2} onChange={(event) => patchItem(item.id, { content: event.target.value })} placeholder="每行一条，最多发送前 10 行" className="resize-y rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><div className="flex items-center gap-1"><button aria-label={`上移 ${item.title}`} disabled={busy || index === 0} onClick={() => move(item.id, -1)} className="rounded-lg border border-cs2-border p-2 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5"/></button><button aria-label={`下移 ${item.title}`} disabled={busy || index === items.length - 1} onClick={() => move(item.id, 1)} className="rounded-lg border border-cs2-border p-2 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5"/></button><button aria-label={`发送 ${item.title}`} disabled={!enabled || busy || !item.content.trim()} onClick={() => sendFixed(item.id)} className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-2 text-emerald-200 disabled:opacity-40"><Send className="h-3.5 w-3.5"/></button><button aria-label={`删除 ${item.title}`} disabled={busy} onClick={() => remove(item.id)} className="rounded-lg border border-rose-400/25 bg-rose-400/10 p-2 text-rose-200 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5"/></button></div></article>)}{!items.length ? <div className="rounded-xl border border-dashed border-cs2-border p-6 text-center text-xs text-cs2-text-muted">尚未创建固定文字预设</div> : null}</div></div> : null}</div>
  </section>;
}
