import { useEffect, useState } from "react";
import { Boxes, Gift, RefreshCw, ScrollText, Users } from "lucide-react";
import { fetchLeagueToolkitOverview } from "../../api/leagueLabApi";

const cards = [
  ["missions", "任务", ScrollText],
  ["unclaimed_rewards", "待处理奖励", Gift],
  ["loot", "战利品种类", Boxes],
  ["friends", "好友", Users],
];

export default function LeagueToolkitOverview({ onError }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); try { setData(await fetchLeagueToolkitOverview()); } catch (error) { onError(error?.response?.data?.detail || "工具箱读取失败"); } finally { setBusy(false); } };
  useEffect(() => { load(); }, []);
  return <div className="space-y-4">
    <div className="flex items-center justify-between"><div><h2 className="font-bold">League 客户端工具箱</h2><p className="mt-1 text-xs text-cs2-text-muted">读取任务、奖励、战利品与好友概况。当前阶段严格只读，不会领取、分解、兑换或删除任何内容。</p></div><button onClick={load} className="rounded-xl border border-cs2-border px-3 py-2 text-xs"><RefreshCw className={`mr-1 inline h-4 w-4 ${busy ? "animate-spin" : ""}`}/>刷新</button></div>
    <section className="grid gap-3 md:grid-cols-4">{cards.map(([key,label,Icon])=><article key={key} className="rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4"><Icon className="mb-5 h-5 w-5 text-emerald-300"/><div className="text-2xl font-bold">{data?.counts?.[key] ?? "—"}</div><div className="mt-1 text-xs text-cs2-text-muted">{label}</div></article>)}</section>
    <section className="rounded-2xl border border-cs2-border bg-cs2-bg-elevated p-4"><h3 className="text-sm font-bold">进行中的任务</h3><div className="mt-3 grid gap-2">{(data?.missions||[]).slice(0,12).map((mission,index)=><div key={mission.id||index} className="rounded-xl border border-cs2-border-subtle px-3 py-2 text-xs"><b>{mission.title||mission.name||mission.id||"未命名任务"}</b><span className="ml-2 text-cs2-text-muted">{mission.status||mission.state||""}</span></div>)}{data&&!data.missions?.length&&<div className="text-xs text-cs2-text-muted">暂无可显示任务</div>}</div></section>
  </div>;
}
