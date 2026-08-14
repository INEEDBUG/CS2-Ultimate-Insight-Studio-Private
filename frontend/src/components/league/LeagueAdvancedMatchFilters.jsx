import { Plus, Trash2 } from "lucide-react";

const FIELDS=[["champion_name","英雄"],["game_mode","模式"],["position","位置"],["queue_id","队列 ID"],["kills","击杀"],["deaths","死亡"],["assists","助攻"],["kda","KDA"],["damage","英雄伤害"],["gold","金币"],["cs","补刀"]];
const OPS=[["eq","等于"],["neq","不等于"],["contains","包含"],["gte","大于等于"],["lte","小于等于"]];

export default function LeagueAdvancedMatchFilters({ rules=[], logic="and", onChange }) {
  const patch=(index,change)=>onChange(rules.map((rule,i)=>i===index?{...rule,...change}:rule),logic);
  return <section className="rounded-xl border border-cs2-border bg-cs2-bg-elevated p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-sm">组合筛选器</b><span className="ml-2 text-[10px] text-cs2-text-muted">可与上方基础条件共同使用</span></div><div className="flex gap-2"><select value={logic} onChange={(e)=>onChange(rules,e.target.value)} className="rounded-lg border border-cs2-border bg-cs2-bg-input px-2 py-1.5 text-xs"><option value="and">全部满足 AND</option><option value="or">任一满足 OR</option></select><button type="button" onClick={()=>onChange([...rules,{field:"kills",operator:"gte",value:""}],logic)} className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-200"><Plus className="mr-1 inline h-3.5 w-3.5"/>添加条件</button></div></div>
    {rules.length>0&&<div className="mt-3 grid gap-2">{rules.map((rule,index)=><div key={index} className="grid grid-cols-[1fr_1fr_1.2fr_auto] gap-2"><select value={rule.field} onChange={(e)=>patch(index,{field:e.target.value})} className="rounded-lg border border-cs2-border bg-cs2-bg-input px-2 py-2 text-xs">{FIELDS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><select value={rule.operator} onChange={(e)=>patch(index,{operator:e.target.value})} className="rounded-lg border border-cs2-border bg-cs2-bg-input px-2 py-2 text-xs">{OPS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><input value={rule.value} onChange={(e)=>patch(index,{value:e.target.value})} placeholder="比较值" className="min-w-0 rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-xs"/><button type="button" aria-label="删除条件" onClick={()=>onChange(rules.filter((_,i)=>i!==index),logic)} className="rounded-lg px-2 text-rose-300 hover:bg-rose-400/10"><Trash2 className="h-4 w-4"/></button></div>)}</div>}
  </section>;
}
