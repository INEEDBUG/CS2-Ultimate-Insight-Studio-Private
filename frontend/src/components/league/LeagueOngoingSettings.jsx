function Switch({ title, description, checked, onChange }) {
  return <div className="flex min-h-[68px] items-center gap-4 border-b border-cs2-border-subtle px-4 py-3 last:border-b-0"><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-cs2-text-primary">{title}</div><div className="mt-1 text-xs leading-5 text-cs2-text-muted">{description}</div></div><button type="button" role="switch" aria-label={title} aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-emerald-500" : "bg-cs2-bg-input"}`}><span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}/></button></div>;
}

const selectClass = "mt-1 block w-full rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-sm text-cs2-text-primary";

export default function LeagueOngoingSettings({ settings, onUpdate }) {
  return <section className="overflow-hidden rounded-xl border border-cs2-border bg-cs2-bg-elevated">
    <Switch title="在房间阶段分析队友" description="与 LeagueAkari 一致：进入房间后即读取当前队伍成员和近期表现，不必等到英雄选择。" checked={settings.ongoing_query_in_lobby_phase !== false} onChange={(value) => onUpdate({ ongoing_query_in_lobby_phase: value })}/>
    <Switch title="所有玩家都分析打野路线" description="默认只分析分配为打野的玩家；开启后会对全员加载有限场次时间线，速度会更慢。" checked={Boolean(settings.ongoing_show_jungle_pathing_for_all_players)} onChange={(value) => onUpdate({ ongoing_show_jungle_pathing_for_all_players: value })}/>
    <Switch title="战绩条目强调边框" description="在实时玩家卡片上增强近期战绩区域的边界，便于快速区分玩家。" checked={Boolean(settings.ongoing_show_match_history_item_border)} onChange={(value) => onUpdate({ ongoing_show_match_history_item_border: value })}/>
    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs text-cs2-text-muted">玩家排序<select aria-label="实时玩家排序" value={settings.ongoing_order_player_by || "default"} onChange={(event) => onUpdate({ ongoing_order_player_by: event.target.value })} className={selectClass}><option value="default">客户端默认</option><option value="position">分路</option><option value="premade-team">组排关系</option><option value="win-rate">近期胜率</option><option value="kda">近期 KDA</option><option value="akari-score">Akari Score</option></select></label>
      <label className="text-xs text-cs2-text-muted">英雄数据<select aria-label="实时英雄数据来源" value={settings.ongoing_champion_usage_mode || (settings.ongoing_show_champion_usage === false ? "none" : "recent")} onChange={(event) => onUpdate({ ongoing_champion_usage_mode: event.target.value, ongoing_show_champion_usage: event.target.value !== "none" })} className={selectClass}><option value="recent">近期使用表现</option><option value="mastery">英雄熟练度</option><option value="none">不显示</option></select></label>
      <label className="text-xs text-cs2-text-muted">战绩样本<select aria-label="实时战绩样本范围" value={settings.ongoing_match_history_tag_preference || "current"} onChange={(event) => onUpdate({ ongoing_match_history_tag_preference: event.target.value })} className={selectClass}><option value="current">优先当前队列</option><option value="all">全部模式</option></select></label>
      <label className="text-xs text-cs2-text-muted">详情时间线数量<input aria-label="实时详情时间线数量" type="number" min="0" max="100" value={settings.ongoing_game_details_load_count ?? 20} onChange={(event) => onUpdate({ ongoing_game_details_load_count: Number(event.target.value) })} className={selectClass}/></label>
    </div>
  </section>;
}
