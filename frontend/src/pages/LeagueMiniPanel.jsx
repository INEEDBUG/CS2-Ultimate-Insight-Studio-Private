import { useCallback, useEffect, useState } from "react";
import { Minus, Pin, PinOff, RefreshCw, Shield, Swords, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { acceptLeagueChampSelectTrade, cancelLeagueAutoAccept, declineLeagueChampSelectTrade, declineLeagueReadyCheck, dodgeLeagueChampSelect, fetchLeagueLabStatus, rerollLeagueChampion, runLeagueLabAction, saveLeagueLabSettings, selectLeagueChampionSkin, setLeagueAutoSelectTemporarilyDisabled, stopLeagueMatchmaking, swapLeagueBenchChampion } from "../api/leagueLabApi";
import { getLeagueChampionIconUrl } from "../api/api";
import { maskLeagueName } from "../utils/leagueStreamerMode";

const PHASE_LABELS = {
  Lobby: "房间中",
  Matchmaking: "正在匹配",
  ReadyCheck: "对局已找到",
  ChampSelect: "英雄选择",
  InProgress: "游戏进行中",
  Reconnect: "等待重连",
  PreEndOfGame: "对局结算中",
  EndOfGame: "对局已结束",
  WaitingForStats: "等待战绩",
  None: "未连接",
};

const MATCHMAKING_STATUS_LABELS = {
  idle: "等待开始匹配",
  countdown: "即将开始匹配",
  searching: "搜索对局中",
  waiting_for_invitees: "等待邀请者回应",
  waiting_for_penalty: "等待排队惩罚结束",
  insufficient_members: "等待更多房间成员",
  not_leader: "等待房主开始",
  lobby_unavailable: "暂时无法读取房间",
  unsupported_lobby: "当前房间不支持自动匹配",
  cannot_start: "当前不能开始匹配",
  rematch_cancelled: "已按重排策略取消匹配",
};

const ACCOUNT_ACTION_MESSAGE = "账号写入操作已关闭；请先在主窗口开启后再执行接受、秒退、重随、换位或皮肤操作。";

function getDisplayPhase(status) {
  return status?.connected && status?.phase ? status.phase : "None";
}

function getCountdownSeconds(countdown, now) {
  const dueAt = Number(countdown?.due_at);
  if (Number.isFinite(dueAt) && dueAt > 0) return Math.max(0, dueAt * 1000 - now) / 1000;
  if (countdown?.remaining_seconds === null || countdown?.remaining_seconds === undefined || countdown?.remaining_seconds === "") return null;
  const remaining = Number(countdown.remaining_seconds);
  return Number.isFinite(remaining) ? Math.max(0, remaining) : null;
}

function getActionProgress(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  return {
    completed: actions.filter((action) => action?.completed).length,
    total: actions.length,
    active: actions.find((action) => action?.in_progress),
  };
}

function MiniSwitch({ label, checked, onChange, disabled = false, title }) {
  return <div className="flex items-center justify-between gap-3 py-1.5 text-xs text-zinc-300"><span>{label}</span><button type="button" role="switch" aria-checked={checked} disabled={disabled} title={title} onClick={() => onChange(!checked)} className={`relative h-5 w-9 appearance-none rounded-full p-0 transition-colors duration-150 active:scale-[.97] ${checked ? "bg-emerald-500" : "bg-zinc-700"} disabled:cursor-not-allowed disabled:opacity-40`}><span className={`absolute left-1 top-1 h-3 w-3 rounded-full bg-white transition-transform duration-150 ${checked ? "translate-x-4" : "translate-x-0"}`} /></button></div>;
}

function formatObservedSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? `${Math.max(0, seconds).toFixed(seconds >= 10 ? 0 : 1)} 秒` : "未知";
}

function getActionPlanRows(actionPlan, now) {
  if (!actionPlan || typeof actionPlan !== "object") return [];
  const rows = [];
  for (const [key, item] of [["accept_due", actionPlan.accept_due], ["phase_due", actionPlan.phase_due]]) {
    if (!item || typeof item !== "object") continue;
    rows.push({ key, label: item.label || key, item, seconds: getCountdownSeconds(item, now) });
  }
  for (const [index, item] of (Array.isArray(actionPlan.champion_due) ? actionPlan.champion_due : []).entries()) {
    if (!item || typeof item !== "object") continue;
    rows.push({ key: `champion_due_${item.action_id || index}`, label: item.label || "自动选择 / 禁用英雄", item, seconds: getCountdownSeconds(item, now) });
  }
  return rows;
}

const AUTO_SELECT_MOVE_LABELS = {
  "pick-intent": "预选英雄",
  "show-pick": "亮出英雄",
  "complete-pick": "锁定英雄",
  "show-ban": "亮出禁用",
  "complete-ban": "锁定禁用",
  vote: "投票",
  "show-subset-pick": "子集选人并锁定",
  "complete-subset-pick": "锁定子集英雄",
  "subset-bench-swap": "子集换位",
  "bench-swap": "备战席换位",
};

const AUTO_SELECT_MOVE_META = {
  "pick-intent": { expected: "expected_picks", actionability: "intent", kind: "pick" },
  "show-pick": { expected: "expected_picks", actionability: "show", kind: "pick" },
  "complete-pick": { expected: "expected_picks", actionability: "complete", kind: "pick" },
  "show-ban": { expected: "expected_bans", actionability: "show", kind: "ban" },
  "complete-ban": { expected: "expected_bans", actionability: "complete", kind: "ban" },
  vote: { expected: null, actionability: "vote", kind: "vote" },
  "show-subset-pick": { expected: "expected_picks", actionability: "subset_pick", kind: "pick" },
  "complete-subset-pick": { expected: "expected_picks", actionability: "subset_pick", kind: "pick" },
  "subset-bench-swap": { expected: "expected_swaps", actionability: "bench_swap", kind: "bench" },
  "bench-swap": { expected: "expected_swaps", actionability: "bench_swap", kind: "bench" },
};

const AUTO_SELECT_STATUS_LABELS = {
  unknown: "未知",
  "not-owned": "未拥有",
  unpickable: "当前不可选",
  banned: "已禁用",
  "pick-intented": "已被预选",
  picked: "已被选择",
  "subset-pickable": "子集可选",
  pickable: "可选择",
  unbannable: "当前不可禁用",
  bannable: "可禁用",
  unswappable: "不可换位",
  "subset-swappable": "子集可换位",
  "waiting-on-finalization": "等待最终化",
  swappable: "可换位",
};

const AUTO_SELECT_PLAN_META = [
  ["delayed_pick", "自动选人计划"],
  ["delayed_ban", "自动禁用计划"],
  ["delayed_bench_swap", "自动备战席换位"],
  ["delayed_trade", "自动处理换英雄"],
];

function getAutoSelectMoveLabel(move) {
  return AUTO_SELECT_MOVE_LABELS[move] || (move ? `未知动作 · ${move}` : "动作尚未确定");
}

function getAutoSelectStatusLabel(status) {
  return AUTO_SELECT_STATUS_LABELS[status] || (status ? `未知状态 · ${status}` : "未知");
}

function getAutoSelectRows(autoSelect, key) {
  return key && Array.isArray(autoSelect?.[key]) ? autoSelect[key].filter((row) => row && typeof row === "object") : [];
}

function getAutoSelectGate(autoSelect, status) {
  const config = autoSelect?.config;
  const master = typeof config?.master_enabled === "boolean"
    ? config.master_enabled
    : typeof status?.settings?.automation_enabled === "boolean" ? status.settings.automation_enabled : null;
  const feature = typeof config?.feature_enabled === "boolean"
    ? config.feature_enabled
    : typeof status?.settings?.auto_select_enabled === "boolean" ? status.settings.auto_select_enabled : null;
  const temporarilyDisabled = typeof autoSelect?.temporarily_disabled === "boolean"
    ? autoSelect.temporarily_disabled
    : typeof status?.auto_select_temporarily_disabled === "boolean" ? status.auto_select_temporarily_disabled : null;
  const enabled = typeof autoSelect?.enabled === "boolean" ? autoSelect.enabled : null;
  let label = "门控状态未返回 · 仅展示";
  let tone = "text-zinc-400";
  if (temporarilyDisabled === true) {
    label = "临时暂停自动选择";
    tone = "text-amber-200";
  } else if (master === false) {
    label = "自动化总开关已关闭";
    tone = "text-amber-200";
  } else if (feature === false || enabled === false) {
    label = "自动选择功能已关闭";
    tone = "text-amber-200";
  } else if (master === true && feature === true && enabled !== false) {
    label = "自动选择已启用";
    tone = "text-emerald-200";
  }
  return { label, tone, master, feature, temporarilyDisabled, enabled };
}

function getAutoSelectTaskTime(task, now) {
  if (!task || typeof task !== "object") return { seconds: null, progress: null };
  const seconds = getCountdownSeconds({
    due_at: task.due_at ?? task.finish_at ?? task.finishAt,
    remaining_seconds: task.remaining_seconds,
  }, now);
  const startAt = Number(task.start_at ?? task.startAt);
  const finishAt = Number(task.finish_at ?? task.finishAt);
  if (Number.isFinite(startAt) && Number.isFinite(finishAt) && finishAt > startAt) {
    const current = now / 1000;
    return {
      seconds,
      progress: Math.min(100, Math.max(0, ((current - startAt) / (finishAt - startAt)) * 100)),
    };
  }
  return { seconds, progress: null };
}

function getAutoSelectTaskTarget(task, key) {
  if (!task || typeof task !== "object") return "";
  const championId = task.champion_id ?? task.championId ?? task.requester_champion_id ?? task.requesterChampionId;
  if (championId === undefined || championId === null || championId === "") return "";
  const action = task.operation || task.action;
  if (key === "delayed_trade" && action) return ` · ${action === "accept" ? "接受" : action === "decline" ? "拒绝" : action} #${championId}`;
  return ` · #${championId}`;
}

function AutoSelectContextCard({ status, phase, now }) {
  const autoSelect = status?.auto_select;
  if (phase !== "ChampSelect" || !autoSelect || typeof autoSelect !== "object") return null;
  const move = autoSelect.move;
  const meta = AUTO_SELECT_MOVE_META[move];
  const gate = getAutoSelectGate(autoSelect, status);
  const expectedRows = getAutoSelectRows(autoSelect, meta?.expected);
  const actionability = autoSelect.actionability;
  const actionabilityValue = meta && actionability && typeof actionability[meta.actionability] === "boolean"
    ? actionability[meta.actionability]
    : null;
  const currentAction = autoSelect.current_action;
  const currentChampionId = currentAction?.champion_id || currentAction?.championId;
  const subset = autoSelect.subset;
  const subsetUnavailable = (move === "show-subset-pick" || move === "complete-subset-pick" || move === "subset-bench-swap")
    && subset && subset.available === false;
  const statusCounts = expectedRows.reduce((counts, row) => {
    const key = row.status || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const hasActionEvidence = Boolean(currentAction || move || expectedRows.length || subset || actionability);
  return <section data-testid="mini-auto-select-context" className="mb-3 rounded-xl border border-emerald-400/20 bg-emerald-500/[.045] p-3" aria-live="polite">
    <div className="flex items-center justify-between gap-2"><div className="text-[10px] uppercase tracking-[.16em] text-emerald-300">自动选人上下文</div><div className={`rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold ${gate.tone}`}>{gate.label}</div></div>
    <div className="mt-2 flex items-center justify-between gap-2"><span className="text-sm font-semibold text-white">{getAutoSelectMoveLabel(move)}</span>{currentAction && <span className="text-[10px] text-zinc-400">动作 #{String(currentAction.id ?? "未知")}</span>}</div>
    {!hasActionEvidence && <div className="mt-2 text-[10px] text-zinc-500">客户端尚未返回可证明的自动选人状态。</div>}
    {hasActionEvidence && <div className="mt-2 grid gap-2 text-[10px] text-zinc-400">
      {currentAction && <div className="flex items-center justify-between gap-2"><span>当前动作</span><span className="font-semibold text-zinc-200">{currentAction.type || "未知"} · {currentAction.completed ? "已完成" : currentAction.in_progress ? "进行中" : "等待"}{currentChampionId ? ` · 英雄 #${currentChampionId}` : ""}</span></div>}
      {meta?.kind === "vote" && <div className="rounded-lg border border-violet-400/20 bg-violet-400/[.06] p-2 text-violet-100">upstream 投票动作仅展示当前客户端状态，不自动提交投票。</div>}
      {subset && (meta?.kind === "pick" || meta?.kind === "bench") && <div className="flex items-center justify-between gap-2"><span>子集英雄池</span><span className={subsetUnavailable ? "font-semibold text-amber-200" : "font-semibold text-zinc-200"}>{subset.available === false ? "未返回" : `${Array.isArray(subset.ids) ? subset.ids.length : 0} 个`}</span></div>}
      {meta && <div className="flex items-center justify-between gap-2"><span>动作通道</span><span className={actionabilityValue === true ? "font-semibold text-emerald-200" : actionabilityValue === false ? "font-semibold text-amber-200" : "font-semibold text-zinc-500"}>{actionabilityValue === true ? "可操作" : actionabilityValue === false ? "当前不可操作" : "未返回 · 仅展示"}</span></div>}
      {expectedRows.length > 0 && <div data-testid={`mini-auto-expected-${meta?.expected || "unknown"}`} className="rounded-lg border border-white/10 bg-black/10 p-2"><div className="mb-1 flex items-center justify-between gap-2"><span>候选状态</span><span className="text-zinc-500">{expectedRows.length} 个</span></div><div className="flex flex-wrap gap-1">{expectedRows.slice(0, 8).map((row) => <span key={String(row.id)} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-300"><span>#{row.id}</span><span className="text-emerald-200">{getAutoSelectStatusLabel(row.status)}</span></span>)}{expectedRows.length > 8 && <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-500">+{expectedRows.length - 8}</span>}</div><div className="mt-1 text-[10px] text-zinc-500">{Object.entries(statusCounts).map(([key, count]) => `${getAutoSelectStatusLabel(key)} ${count}`).join(" · ")}</div></div>}
      {subsetUnavailable && <div className="text-amber-200">子集英雄池尚未返回，当前不推断可操作候选。</div>}
      {!move && <div className="text-zinc-500">动作未知；不会显示任何自动或手动操作。</div>}
      {move && !meta && <div className="text-amber-200">未识别的动作类型；仅保留原始状态。</div>}
    </div>}
  </section>;
}

function AutoSelectAutomationPlan({ status, phase, now }) {
  const autoSelect = status?.auto_select;
  if (phase !== "ChampSelect" || !autoSelect || typeof autoSelect !== "object") return null;
  const plans = AUTO_SELECT_PLAN_META.map(([key, label]) => ({ key, label, task: autoSelect[key] })).filter((entry) => entry.task && typeof entry.task === "object");
  if (!plans.length) return null;
  const gate = getAutoSelectGate(autoSelect, status);
  return <section data-testid="mini-auto-select-plan" className="mb-3 rounded-xl border border-cyan-400/20 bg-cyan-500/[.045] p-3">
    <div className="flex items-center justify-between gap-2"><div className="text-[10px] uppercase tracking-[.16em] text-cyan-300">自动计划</div><span className={gate.tone}>{gate.temporarilyDisabled ? "已暂停" : "只读计划"}</span></div>
    <div className="mt-2 grid gap-2">{plans.map(({ key, label, task }) => { const timing = getAutoSelectTaskTime(task, now); return <div key={key} data-testid={`mini-auto-plan-${key}`} className="rounded-lg border border-white/10 bg-black/10 p-2"><div className="flex items-center justify-between gap-2 text-[10px]"><span className="font-semibold text-zinc-200">{label}{getAutoSelectTaskTarget(task, key)}</span><span className="tabular-nums text-cyan-100">{timing.seconds == null ? "倒计时不可用" : formatObservedSeconds(timing.seconds)}</span></div><div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-zinc-500"><span>{task.move || task.operation || task.action || "等待执行"}{task.completed === true ? " · 完成动作" : ""}</span><span>{timing.progress == null ? "进度未返回" : `${Math.round(timing.progress)}%`}</span></div>{timing.progress != null && <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-400" style={{ width: `${timing.progress}%` }} /></div>}</div>; })}</div>
  </section>;
}

function PhaseContextCard({ status, phase, actionCountdown, actionSeconds, phaseSeconds, now }) {
  const actionProgress = phase === "ChampSelect" ? getActionProgress(status?.champ_select?.my_actions) : null;
  const actionProgressLabel = status?.settings?.auto_select_enabled ? "自动计划进度" : "客户端动作进度";
  const matchmakingStatus = MATCHMAKING_STATUS_LABELS[status?.matchmaking_status] || status?.matchmaking_status;
  const readyCheck = status?.ready_check;
  const matchmakingSearch = status?.matchmaking_search;
  const actionPlanRows = getActionPlanRows(status?.action_plan, now);
  const readyTimerSeconds = getCountdownSeconds(readyCheck?.timer, now);
  const hasActionCountdown = actionSeconds != null && actionCountdown;
  const hasPhaseTimer = phase === "ChampSelect" && phaseSeconds != null;
  const hasActionProgress = Boolean(actionProgress);
  const hasMatchmakingStatus = (phase === "Lobby" || phase === "Matchmaking") && Boolean(matchmakingStatus);
  const hasReadyCheck = phase === "ReadyCheck" && readyCheck && typeof readyCheck === "object";
  const hasMatchmakingSearch = (phase === "Lobby" || phase === "Matchmaking") && matchmakingSearch && typeof matchmakingSearch === "object";
  const hasActionPlan = actionPlanRows.length > 0;
  const hasDetails = hasActionCountdown || hasPhaseTimer || hasActionProgress || hasMatchmakingStatus || hasReadyCheck || hasMatchmakingSearch || hasActionPlan;
  let description = "等待本机 League 客户端返回当前阶段。";
  if (phase === "Lobby") description = "房间已连接；可以等待队友或开始匹配。";
  if (phase === "Matchmaking") description = "客户端正在搜索对局，Mini 会持续显示匹配状态。";
  if (phase === "ReadyCheck") description = "对局已找到，请在客户端接受窗口结束前处理。";
  if (phase === "ChampSelect") description = "正在进行英雄选择；下面只显示客户端已返回的计划与倒计时。";
  if (phase === "InProgress") description = "游戏进行中；Mini 将在有可证明的客户端状态时显示相关信息。";
  if (phase === "Reconnect") description = "客户端正在等待重连。";
  if (phase === "None") {
    if (status?.requires_elevation) description = "检测到 League 客户端，但读取 LCU 需要管理员权限。";
    else if (status?.last_error) description = `连接失败：${status.last_error}`;
    else if (status?.client_window_detected) description = "已检测到客户端窗口，正在等待 LCU 连接。";
    else if (!status) description = "正在读取客户端状态。";
    else description = "启动并登录 League 客户端后，Mini 会自动连接。";
  }
  return <section data-testid="mini-phase-context" className="mb-3 rounded-xl border border-sky-400/20 bg-sky-500/[.06] p-3" aria-live="polite">
    <div className="flex items-center justify-between gap-2"><div className="text-[10px] uppercase tracking-[.16em] text-sky-300">当前上下文</div><div className="rounded-full border border-sky-400/25 px-2 py-0.5 text-[10px] font-semibold text-sky-200">阶段 · {PHASE_LABELS[phase] || phase}</div></div>
    <p className="mt-1 text-[11px] leading-5 text-zinc-300">{description}</p>
    {hasDetails ? <div className="mt-2 grid gap-2 text-[10px] text-zinc-400">
      {hasMatchmakingStatus && <div className="flex items-center justify-between gap-2"><span>匹配状态</span><span className="font-semibold text-zinc-200">{matchmakingStatus}</span></div>}
      {hasActionCountdown && <div data-testid="mini-action-countdown" className="flex items-center justify-between gap-2"><span>{actionCountdown.label || "自动计划"}</span><span className="font-semibold tabular-nums text-emerald-200">{actionSeconds.toFixed(1)} 秒</span></div>}
      {hasPhaseTimer && <div data-testid="mini-phase-countdown" className="flex items-center justify-between gap-2"><span>{status?.champ_select?.timer_phase || "当前选择阶段"}</span><span className="font-semibold tabular-nums text-sky-200">{Math.ceil(phaseSeconds)} 秒</span></div>}
      {hasActionProgress && <div data-testid="mini-action-progress" className="flex items-center justify-between gap-2"><span>{actionProgressLabel}{actionProgress.active ? ` · ${actionProgress.active.type === "pick" ? "选择" : actionProgress.active.type === "ban" ? "禁用" : actionProgress.active.type}` : ""}</span><span className="font-semibold text-zinc-200">{actionProgress.completed}/{actionProgress.total} 已完成</span></div>}
      {hasReadyCheck && <div data-testid="mini-ready-check" className="rounded-lg border border-amber-400/20 bg-amber-400/[.06] p-2"><div className="flex items-center justify-between gap-2"><span>ReadyCheck · {readyCheck.state || "未知状态"}</span><span className="font-semibold text-amber-100">{readyCheck.player_response || "未响应"}</span></div>{readyTimerSeconds != null && <div className="mt-1 flex items-center justify-between gap-2"><span>剩余时间</span><span className="font-semibold tabular-nums text-amber-100">{formatObservedSeconds(readyTimerSeconds)}</span></div>}<div className="mt-1 text-[10px] text-zinc-500">{readyCheck.can_accept ? "可接受" : "当前不可接受"} · {readyCheck.can_decline ? "可拒绝" : "当前不可拒绝"}</div></div>}
      {hasMatchmakingSearch && <div data-testid="mini-matchmaking-search" className="rounded-lg border border-cyan-400/20 bg-cyan-400/[.05] p-2"><div className="flex items-center justify-between gap-2"><span>匹配搜索</span><span className="font-semibold text-cyan-100">{matchmakingSearch.search_state || (matchmakingSearch.is_currently_in_queue ? "搜索中" : "未搜索")}</span></div><div className="mt-1 grid grid-cols-2 gap-1 text-[10px]"><span>队列中：{matchmakingSearch.is_currently_in_queue ? "是" : "否"}</span>{matchmakingSearch.time_in_queue != null && <span>已等待：{formatObservedSeconds(matchmakingSearch.time_in_queue)}</span>}{matchmakingSearch.estimated_queue_time != null && <span>预计：{formatObservedSeconds(matchmakingSearch.estimated_queue_time)}</span>}{matchmakingSearch.queue_id != null && <span>队列 ID：{matchmakingSearch.queue_id}</span>}</div>{(matchmakingSearch.errors || []).length > 0 && <div className="mt-1 text-rose-200">{matchmakingSearch.errors.map((error, index) => <div key={`${error.code || "error"}-${index}`}>{error.message || error.code || "匹配错误"}</div>)}</div>}</div>}
      {hasActionPlan && <div data-testid="mini-action-plan" className="rounded-lg border border-emerald-400/20 bg-emerald-400/[.05] p-2"><div className="mb-1 font-semibold text-emerald-100">自动计划</div>{actionPlanRows.map((row) => <div key={row.key} className="flex items-center justify-between gap-2"><span>{row.label}</span><span className="font-semibold tabular-nums text-emerald-100">{row.seconds != null ? formatObservedSeconds(row.seconds) : "已暂停 / 等待状态"}</span></div>)}</div>}
    </div> : <div className="mt-2 text-[10px] text-zinc-500">客户端尚未返回可显示的阶段细节。</div>}
  </section>;
}

export default function LeagueMiniPanel() {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [pinned, setPinned] = useState(true);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    try {
      const next = await fetchLeagueLabStatus();
      setStatus(next);
      return next;
    } catch (error) {
      setStatus(null);
      setMessage(error?.response?.data?.detail || error?.message || "无法读取英雄联盟客户端状态。");
      return null;
    }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 1500); return () => clearInterval(id); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(id); }, []);
  useEffect(() => {
    document.documentElement.style.opacity = String(status?.settings?.mini_opacity ?? 1);
    return () => { document.documentElement.style.opacity = "1"; };
  }, [status?.settings?.mini_opacity]);
  const applyStatusResult = useCallback(async (result, successMessage = "") => {
    if (result && typeof result === "object") {
      setStatus(result);
      if (successMessage) setMessage(successMessage);
      return result;
    }
    if (successMessage) setMessage(`${successMessage} 正在刷新状态。`);
    await load();
    return null;
  }, [load]);
  const update = async (patch) => {
    try { await applyStatusResult(await saveLeagueLabSettings({ ...(status?.settings || {}), ...patch })); }
    catch (error) { setMessage(error?.response?.data?.detail || "设置更新失败"); }
  };
  const team = status?.champ_select?.my_team || [];
  const bench = status?.champ_select?.bench_champions || [];
  const respawn = status?.respawn_timer || {};
  const skinSelector = status?.settings?.mini_show_skin_selector === false ? {} : (status?.champ_select?.skin_selector || {});
  const actionCountdown = status?.action_countdown;
  const actionSeconds = getCountdownSeconds(actionCountdown, now);
  const phaseDeadline = status?.champ_select?.timer_deadline_at;
  const phaseSeconds = Number.isFinite(Number(phaseDeadline)) && Number(phaseDeadline) > 0 ? Math.max(0, Number(phaseDeadline) * 1000 - now) / 1000 : null;
  const streamerMode = Boolean(status?.settings?.streamer_mode_enabled);
  const canWrite = Boolean(status?.settings?.toolkit_account_actions_enabled);
  const phase = getDisplayPhase(status);
  const readyCheck = status?.ready_check;
  const matchmakingSearch = status?.matchmaking_search;
  const actionPlan = status?.action_plan;
  const readyCanAccept = phase === "ReadyCheck" && readyCheck?.can_accept === true;
  const readyCanDecline = phase === "ReadyCheck" && readyCheck?.can_decline === true;
  const canCancelAutoAccept = phase === "ReadyCheck" && Boolean(actionPlan?.accept_due);
  const canStopMatchmaking = phase === "Matchmaking" && matchmakingSearch?.is_currently_in_queue === true;
  const trades = Array.isArray(status?.champ_select?.trades) ? status.champ_select.trades : [];
  const visibleSummonerName = streamerMode ? maskLeagueName(status?.summoner_name, 0, status?.settings?.streamer_mode_use_aliases, status?.current_summoner?.puuid) : status?.summoner_name;
  const setWindowPinned = async () => {
    const next = !pinned;
    await getCurrentWindow().setAlwaysOnTop(next);
    setPinned(next);
  };
  const minimizeWindow = () => getCurrentWindow().minimize();
  const closeWindow = () => getCurrentWindow().close();
  const requireAccountActions = () => {
    if (!canWrite) { setMessage("账号写入操作已关闭；请先在主窗口开启后再执行此操作。"); return false; }
    return true;
  };
  const applyAccountAction = async (action, successMessage) => {
    if (!requireAccountActions()) return;
    try { await applyStatusResult(await runLeagueLabAction(action), successMessage); }
    catch (error) { setMessage(error?.response?.data?.detail || `${action} 操作失败`); }
  };
  const accept = async () => {
    if (!readyCanAccept) { setMessage("当前 ReadyCheck 不允许接受或状态证据尚未返回。"); return; }
    await applyAccountAction("accept", "已发送接受请求。");
  };
  const declineReady = async () => {
    if (!readyCanDecline) { setMessage("当前 ReadyCheck 不允许拒绝或状态证据尚未返回。"); return; }
    if (!requireAccountActions()) return;
    try { await applyStatusResult(await declineLeagueReadyCheck(), "已发送拒绝对局请求。"); }
    catch (error) { setMessage(error?.response?.data?.detail || error?.message || "拒绝对局失败"); }
  };
  const cancelAutoAccept = async () => {
    if (!canCancelAutoAccept) { setMessage("当前没有可取消的自动接受计划。"); return; }
    try { await applyStatusResult(await cancelLeagueAutoAccept(), "已取消本次自动接受。"); }
    catch (error) { setMessage(error?.response?.data?.detail || error?.message || "取消自动接受失败"); }
  };
  const stopMatchmaking = async () => {
    if (!canStopMatchmaking) { setMessage("当前没有可停止的匹配搜索。"); return; }
    if (!requireAccountActions()) return;
    try { await applyStatusResult(await stopLeagueMatchmaking(), "已发送停止匹配请求。"); }
    catch (error) { setMessage(error?.response?.data?.detail || error?.message || "停止匹配失败"); }
  };
  const applyTradeAction = async (trade, operation) => {
    if (!trade?.actionable || (operation === "accept" ? trade.can_accept !== true : trade.can_decline !== true)) {
      setMessage("该换英雄请求当前不可操作。");
      return;
    }
    if (!requireAccountActions()) return;
    try {
      const result = operation === "accept" ? await acceptLeagueChampSelectTrade(trade.id) : await declineLeagueChampSelectTrade(trade.id);
      await applyStatusResult(result, operation === "accept" ? "已接受换英雄请求。" : "已拒绝换英雄请求。");
    } catch (error) { setMessage(error?.response?.data?.detail || error?.message || "换英雄请求处理失败"); }
  };
  const dodge = async () => {
    if (!requireAccountActions()) return;
    const confirmation = window.prompt("秒退会产生排队惩罚。若仍要继续，请输入：我确认秒退");
    if (confirmation !== "我确认秒退") { setMessage("已取消秒退。"); return; }
    try { await applyStatusResult(await dodgeLeagueChampSelect(confirmation), "已发送一次秒退请求。"); }
    catch (error) { setMessage(error?.response?.data?.detail || "秒退失败"); }
  };
  const reroll = async () => {
    if (!requireAccountActions()) return;
    try { await applyStatusResult(await rerollLeagueChampion(), "重随请求已发送。"); }
    catch (error) { setMessage(error?.response?.data?.detail || "重随失败"); }
  };
  const swapBench = async (championId) => {
    if (!requireAccountActions()) return;
    try { await applyStatusResult(await swapLeagueBenchChampion(championId), "已发送备战席换取请求。"); }
    catch (error) { setMessage(error?.response?.data?.detail || "备战席换取失败"); }
  };
  const selectSkin = async (event) => {
    if (!requireAccountActions()) return;
    try { await applyStatusResult(await selectLeagueChampionSkin(Number(event.target.value)), "已发送皮肤选择请求。"); }
    catch (error) { setMessage(error?.response?.data?.detail || "皮肤选择失败"); }
  };
  return <div className="h-screen overflow-y-auto bg-[#111214] p-3 text-white">
    <div data-tauri-drag-region className="mb-3 flex items-center justify-between border-b border-white/10 pb-2 text-[11px] text-zinc-400"><span data-tauri-drag-region>Insight · League Mini</span><span className="flex items-center gap-1"><button type="button" aria-label={pinned ? "取消置顶" : "窗口置顶"} onClick={setWindowPinned} className={`rounded p-1.5 hover:bg-white/10 ${pinned ? "text-emerald-400" : "text-zinc-500"}`}>{pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}</button><button type="button" aria-label="刷新 Mini" onClick={load} className="rounded p-1.5 hover:bg-white/10"><RefreshCw className="h-3.5 w-3.5" /></button><button type="button" aria-label="最小化 Mini" onClick={minimizeWindow} className="rounded p-1.5 hover:bg-white/10"><Minus className="h-3.5 w-3.5" /></button><button type="button" aria-label="关闭 Mini" onClick={closeWindow} className="rounded p-1.5 hover:bg-rose-500 hover:text-white"><X className="h-3.5 w-3.5" /></button></span></div>
    <div className="mb-3 rounded-xl border border-white/10 bg-white/[.025] p-3 text-center">
      <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300">{phase === "ChampSelect" ? <Swords /> : <Shield />}</div>
      <div className="text-sm font-bold">{status?.connected ? (PHASE_LABELS[status.phase] || status.phase || "已连接英雄联盟") : "等待英雄联盟客户端"}</div>
      <div className="mt-1 text-[11px] text-zinc-500">{visibleSummonerName || "启动并登录客户端后自动连接"}</div>
    </div>
    <PhaseContextCard status={status} phase={phase} actionCountdown={actionCountdown} actionSeconds={actionSeconds} phaseSeconds={phaseSeconds} now={now} />
    <AutoSelectContextCard status={status} phase={phase} now={now} />
    <AutoSelectAutomationPlan status={status} phase={phase} now={now} />
    {status?.connected && !canWrite && <div data-testid="mini-account-actions-disabled" className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/[.06] px-3 py-2 text-[10px] leading-5 text-amber-200">账号写入操作已关闭；接受、秒退、重随、换位和皮肤操作已禁用。自动化开关仍按主窗口的独立设置控制。</div>}
    {team.length > 0 && <div className="mb-3 grid grid-cols-5 gap-1 rounded-xl border border-white/10 p-2">{team.map((member) => member.champion_id ? <img key={member.cell_id} src={getLeagueChampionIconUrl(member.champion_id)} alt={String(member.champion_id)} title={String(member.champion_id)} className="aspect-square w-full rounded-lg bg-white/5 object-cover"/> : <div key={member.cell_id} className="grid aspect-square place-items-center rounded-lg bg-white/5 text-xs font-bold text-emerald-300">?</div>)}</div>}
    {status?.champ_select?.bench_enabled && <div className="mb-3 rounded-xl border border-white/10 bg-white/[.025] p-2"><div className="mb-2 flex items-center justify-between text-[10px] text-zinc-500"><span>备战席 · 点击换取</span><button disabled={!canWrite||!status?.champ_select?.rerolls_remaining||status?.champ_select?.allow_rerolling === false} title={!canWrite?ACCOUNT_ACTION_MESSAGE:undefined} onClick={reroll} className="rounded border border-white/10 px-2 py-1 text-zinc-300 disabled:cursor-not-allowed disabled:opacity-30">重随 {status?.champ_select?.rerolls_remaining||0}</button></div>{!canWrite&&<div className="mb-2 text-[10px] text-amber-300">手动换取、重随和换肤需先在客户端工具中启用账号写入。</div>}<div className="grid grid-cols-5 gap-1">{bench.slice(0,10).map((id)=><button key={id} disabled={!canWrite} title={!canWrite?ACCOUNT_ACTION_MESSAGE:`换取英雄 ${id}`} onClick={() => swapBench(id)} className="aspect-square overflow-hidden rounded-md bg-white/5 active:scale-[.94] disabled:cursor-not-allowed disabled:opacity-30"><img src={getLeagueChampionIconUrl(id)} alt={String(id)} className="h-full w-full object-cover"/></button>)}</div></div>}
    {status?.phase === "ChampSelect" && (status?.champ_select?.my_actions || []).length > 0 && <div className="mb-3 rounded-xl border border-white/10 bg-white/[.025] p-2"><div className="mb-2 text-[10px] text-zinc-500">我的英雄选择流程</div><div className="space-y-1">{status.champ_select.my_actions.map((action)=><div key={action.id || `${action.type}-${action.champion_id}`} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] ${action.in_progress ? "bg-sky-500/10 text-sky-200" : action.completed ? "bg-emerald-500/10 text-emerald-200" : "bg-white/[.025] text-zinc-400"}`}>{action.champion_id ? <img src={getLeagueChampionIconUrl(action.champion_id)} alt="" className="h-5 w-5 rounded"/> : <span className="h-2 w-2 rounded-full bg-current"/>}<span className="flex-1">{action.type === "pick" ? "选择英雄" : action.type === "ban" ? "禁用英雄" : action.type === "vote" ? "投票" : action.type}</span><span>{action.in_progress ? "进行中" : action.completed ? "已完成" : "等待"}</span></div>)}</div></div>}
    {phase === "ChampSelect" && trades.length > 0 && <div data-testid="mini-trades" className="mb-3 rounded-xl border border-violet-400/25 bg-violet-500/[.05] p-2"><div className="mb-2 text-[10px] font-semibold text-violet-200">换英雄请求</div><div className="space-y-2">{trades.map((trade, index) => { const otherName = trade.other_player?.game_name || trade.other_player?.summoner_name || `玩家 ${index + 1}`; const actionable = trade.actionable === true; return <div key={String(trade.id ?? index)} data-testid={`mini-trade-${trade.id ?? index}`} className="rounded-lg border border-white/10 bg-black/10 p-2"><div className="flex items-center justify-between gap-2 text-[10px]"><span>{trade.initiated_by_local_player ? "你发起的请求" : `${otherName} 的请求`}</span><span className={actionable ? "text-emerald-200" : "text-zinc-500"}>{trade.state || "未知状态"}</span></div>{actionable ? <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={!canWrite || trade.can_accept !== true} title={!canWrite ? ACCOUNT_ACTION_MESSAGE : undefined} onClick={() => applyTradeAction(trade, "accept")} className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2 py-1.5 text-[10px] font-semibold text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40">接受换英雄</button><button type="button" disabled={!canWrite || trade.can_decline !== true} title={!canWrite ? ACCOUNT_ACTION_MESSAGE : undefined} onClick={() => applyTradeAction(trade, "decline")} className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-2 py-1.5 text-[10px] font-semibold text-rose-200 disabled:cursor-not-allowed disabled:opacity-40">拒绝换英雄</button></div> : <div className="mt-1 text-[10px] text-zinc-500">当前不可操作：{trade.actionability?.reason || "状态已变化或请求已过期"}</div>}</div>; })}</div></div>}
    {skinSelector.available&&<div className="mb-3 rounded-xl border border-white/10 bg-white/[.025] p-2"><div className="mb-2 text-[10px] text-zinc-500">已拥有皮肤</div>{!canWrite&&<div className="mb-2 text-[10px] text-amber-300">手动换肤需先在主窗口启用账号写入。</div>}<select value={skinSelector.selected_skin_id||""} disabled={!canWrite||skinSelector.disabled} title={!canWrite?ACCOUNT_ACTION_MESSAGE:undefined} onChange={selectSkin} className="w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"><option value="" disabled>选择皮肤</option>{(skinSelector.skins||[]).map((skin)=><option key={skin.id} value={skin.id}>{skin.name}{skin.is_chroma?" · 炫彩":""}</option>)}</select></div>}
    {respawn.dead && <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-center"><div className="text-[10px] uppercase tracking-[.18em] text-rose-300">复活倒计时</div><div className="mt-1 text-3xl font-black tabular-nums text-white">{Number(respawn.time_left || 0).toFixed(1)}s</div></div>}
    <div className="rounded-xl border border-white/10 bg-white/[.025] px-3 py-2">
      <MiniSwitch label="自动接受" checked={Boolean(status?.settings?.auto_accept_enabled)} onChange={(value) => update({ auto_accept_enabled: value })} />
      <MiniSwitch label="自动选择英雄" checked={Boolean(status?.settings?.auto_select_enabled)} onChange={(value) => update({ auto_select_enabled: value })} />
      {phase === "ChampSelect" && <MiniSwitch label="临时暂停自动选择 / 禁用" checked={Boolean(status?.auto_select_temporarily_disabled)} onChange={async(value) => { try { await applyStatusResult(await setLeagueAutoSelectTemporarilyDisabled(value)); } catch (error) { setMessage(error?.response?.data?.detail || "切换失败"); } }} />}
      <MiniSwitch label="自动符文与技能" checked={Boolean(status?.settings?.auto_champion_config_enabled)} onChange={(value) => update({ auto_champion_config_enabled: value })} />
      <MiniSwitch label="复活计时器" checked={Boolean(status?.settings?.respawn_timer_enabled)} onChange={(value) => update({ respawn_timer_enabled: value })} />
    </div>
    {!canWrite&&<div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 px-2 py-1.5 text-[10px] text-amber-300">手动接受、拒绝、停止匹配、备战席操作和换肤需先在主窗口“客户端工具”中启用账号写入。</div>}
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button disabled={!canWrite || !readyCanAccept} title={!canWrite ? ACCOUNT_ACTION_MESSAGE : !readyCanAccept ? "ReadyCheck 尚未返回可接受状态。" : undefined} onClick={accept} className="rounded-lg bg-emerald-500/15 px-2 py-2 text-xs font-semibold text-emerald-300 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-30">立即接受</button>
      {phase === "ChampSelect" ? <button disabled={!canWrite} title={!canWrite ? ACCOUNT_ACTION_MESSAGE : undefined} onClick={dodge} className="rounded-lg bg-rose-500/15 px-2 py-2 text-xs font-semibold text-rose-300 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-30">立即秒退</button> : <button onClick={() => update({ automation_enabled: !status?.settings?.automation_enabled })} className="rounded-lg border border-white/10 px-2 py-2 text-xs font-semibold text-zinc-300 active:scale-[.97]">{status?.settings?.automation_enabled ? "暂停自动化" : "启用自动化"}</button>}
    </div>
    {(readyCanDecline || canCancelAutoAccept) && <div data-testid="mini-ready-actions" className="mt-2 grid grid-cols-2 gap-2">
      {readyCanDecline && <button type="button" disabled={!canWrite} title={!canWrite ? ACCOUNT_ACTION_MESSAGE : undefined} onClick={declineReady} className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-2 py-2 text-xs font-semibold text-rose-200 disabled:cursor-not-allowed disabled:opacity-40">拒绝对局</button>}
      {canCancelAutoAccept && <button type="button" onClick={cancelAutoAccept} className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-2 py-2 text-xs font-semibold text-amber-100">取消自动接受</button>}
    </div>}
    {canStopMatchmaking && <div data-testid="mini-matchmaking-actions" className="mt-2"><button type="button" disabled={!canWrite} title={!canWrite ? ACCOUNT_ACTION_MESSAGE : undefined} onClick={stopMatchmaking} className="w-full rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2 py-2 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40">停止匹配</button></div>}
    {message ? <div className="mt-2 rounded-lg border border-white/10 bg-white/[.025] px-2 py-1.5 text-[10px] text-zinc-400">{message}</div> : null}
  </div>;
}
