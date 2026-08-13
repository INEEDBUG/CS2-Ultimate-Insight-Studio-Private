import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { fetchLeagueChampions, fetchLeagueLoadoutCatalog } from "../../api/leagueLabApi";
import { getLeagueChampionIconUrl } from "../../api/api";

const emptyDraft = {
  champion_id: "",
  primary_style_id: "",
  sub_style_id: "",
  selected_perk_ids: [],
  spell1_id: "",
  spell2_id: "",
};

function Select({ label, value, onChange, options }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-cs2-text-secondary">{label}</span><select value={value} onChange={(event)=>onChange(event.target.value)} className="w-full rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2.5 text-sm text-cs2-text-primary"><option value="">请选择</option>{options.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
}

export default function LeagueChampionLoadoutEditor({ loadouts = [], onChange, onError }) {
  const [catalog,setCatalog]=useState({champions:[],styles:[],spells:[]});
  const [draft,setDraft]=useState(emptyDraft);
  const [search,setSearch]=useState("");
  useEffect(()=>{Promise.all([fetchLeagueChampions(),fetchLeagueLoadoutCatalog()]).then(([champions,loadout])=>setCatalog({champions:champions.champions||[],styles:loadout.styles||[],spells:loadout.spells||[]})).catch(()=>onError?.("无法读取英雄、符文与召唤师技能目录"));},[onError]);
  const championOptions=useMemo(()=>{const q=search.trim().toLowerCase();return catalog.champions.filter((item)=>!q||item.name.toLowerCase().includes(q)||item.alias.toLowerCase().includes(q)||String(item.id).includes(q));},[catalog.champions,search]);
  const championsById=useMemo(()=>new Map(catalog.champions.map((item)=>[Number(item.id),item])),[catalog.champions]);
  const stylesById=useMemo(()=>new Map(catalog.styles.map((item)=>[Number(item.id),item])),[catalog.styles]);
  const spellsById=useMemo(()=>new Map(catalog.spells.map((item)=>[Number(item.id),item])),[catalog.spells]);
  const selectedStyles=catalog.styles.filter((style)=>[String(draft.primary_style_id),String(draft.sub_style_id)].includes(String(style.id)));
  const togglePerk=(id)=>setDraft((current)=>({...current,selected_perk_ids:current.selected_perk_ids.includes(id)?current.selected_perk_ids.filter((value)=>value!==id):[...current.selected_perk_ids,id]}));
  const save=()=>{const item={...draft,champion_id:Number(draft.champion_id),primary_style_id:Number(draft.primary_style_id),sub_style_id:Number(draft.sub_style_id),spell1_id:Number(draft.spell1_id),spell2_id:Number(draft.spell2_id)};if(!item.champion_id||!item.primary_style_id||!item.sub_style_id||!item.spell1_id||!item.spell2_id){onError?.("请完整选择英雄、主副符文系与两个召唤师技能");return;}if(item.selected_perk_ids.length===0){onError?.("请至少选择一个符文");return;}onChange([...loadouts.filter((value)=>Number(value.champion_id)!==item.champion_id),item]);setDraft(emptyDraft);};
  return <div className="mt-4 space-y-4">
    <div className="grid gap-3 md:grid-cols-3"><label className="block md:col-span-3"><span className="mb-1.5 block text-xs font-semibold text-cs2-text-secondary">查找英雄</span><div className="flex items-center gap-2 rounded-xl border border-cs2-border bg-cs2-bg-input px-3"><Search className="h-4 w-4 text-cs2-text-muted"/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="输入英雄名称" className="w-full bg-transparent py-2.5 text-sm outline-none"/></div></label><Select label="英雄" value={draft.champion_id} onChange={(value)=>setDraft({...draft,champion_id:value})} options={championOptions}/><Select label="主符文系" value={draft.primary_style_id} onChange={(value)=>setDraft({...draft,primary_style_id:value,selected_perk_ids:[]})} options={catalog.styles}/><Select label="副符文系" value={draft.sub_style_id} onChange={(value)=>setDraft({...draft,sub_style_id:value,selected_perk_ids:[]})} options={catalog.styles}/><Select label="召唤师技能 1" value={draft.spell1_id} onChange={(value)=>setDraft({...draft,spell1_id:value})} options={catalog.spells}/><Select label="召唤师技能 2" value={draft.spell2_id} onChange={(value)=>setDraft({...draft,spell2_id:value})} options={catalog.spells}/></div>
    {selectedStyles.map((style)=><section key={style.id} className="rounded-xl border border-cs2-border-subtle bg-black/10 p-3"><div className="mb-2 text-xs font-semibold text-cs2-text-secondary">{style.name} <span className="text-cs2-text-muted">· 点击选择符文</span></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(style.perks||[]).map((perk)=><button type="button" key={perk.id} onClick={()=>togglePerk(perk.id)} className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${draft.selected_perk_ids.includes(perk.id)?"border-emerald-400/50 bg-emerald-400/15 text-emerald-200":"border-cs2-border bg-cs2-bg-input text-cs2-text-secondary"}`}><span className="font-semibold">{perk.name}</span></button>)}</div></section>)}
    <button onClick={save} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-black active:scale-[.98]">添加或替换英雄配置</button>
    <div className="grid gap-2">{loadouts.map((item)=>{const champion=championsById.get(Number(item.champion_id));return <div key={item.champion_id} className="flex items-center gap-3 rounded-xl border border-cs2-border-subtle px-3 py-2 text-xs"><img src={getLeagueChampionIconUrl(item.champion_id)} alt="" className="h-9 w-9 rounded-lg bg-white/5 object-cover"/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{champion?.name||`英雄 ${item.champion_id}`}</strong><span className="text-cs2-text-muted">{stylesById.get(Number(item.primary_style_id))?.name||item.primary_style_id} / {stylesById.get(Number(item.sub_style_id))?.name||item.sub_style_id} · {spellsById.get(Number(item.spell1_id))?.name||item.spell1_id} + {spellsById.get(Number(item.spell2_id))?.name||item.spell2_id}</span></span><button onClick={()=>onChange(loadouts.filter((value)=>Number(value.champion_id)!==Number(item.champion_id)))} aria-label="删除配置" className="rounded-lg p-2 text-red-300 hover:bg-red-400/10"><X className="h-4 w-4"/></button></div>;})}</div>
  </div>;
}
