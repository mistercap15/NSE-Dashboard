'use client';
import {useState} from 'react';
const reason = r => ({history_pending:'History check pending',eligible:'Eligible for V1',below_10_crore_liquidity:'Below ₹10 cr liquidity',insufficient_complete_history:'Needs 20 complete sessions',corporate_action_quarantine:'Corporate action — excluded',outside_1_to_10_percent:'Outside 1–10% range'}[r] || r?.replaceAll('_',' ') || 'Waiting');
const money = n => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
export default function MarketScanner({data}) {
  const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[limit,setLimit]=useState(50);
  const scan=data?.scanner, prep=data?.preparation;
  const selected=data?.selection?.day===scan?.day ? data?.shortlist || [] : [];
  const rows=(scan?.rows || []).filter(r=>r.gap>0 && `${r.symbol} ${r.name}`.toLowerCase().includes(search.toLowerCase()) && (filter==='all'||filter==='range'&&r.gap>=.01&&r.gap<=.1||filter==='eligible'&&r.eligibility==='eligible'));
  return <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
    <div><p className="text-xs uppercase tracking-widest text-sky-400">NSE cash equities</p><h2 className="text-2xl font-bold mt-1">Market gap scanner</h2><p className="text-sm text-dim mt-2">Every positive opening gap is visible. The strategy monitors only the top five verified 1–10% gaps.</p></div>
    {!scan?<p className="text-dim">Waiting for an actual market-wide snapshot. The historical pilot is separate.</p>:<>
      <p className="text-xs text-dim">{scan.day} · {scan.source} · completed {new Date(scan.completed_at).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})} IST</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Quoted',`${scan.quoted} / ${scan.exchange_listed}`],['Gap-ups',scan.gap_up],['Eligible',scan.eligible],['V1 watchlist',`${selected.length} / 5`]].map(([label,value])=><div key={label} className="bg-bg rounded-lg p-3"><p className="text-xs text-dim">{label}</p><p className="text-xl font-bold mt-1">{value}</p></div>)}</div>
      {prep&&<p className="text-sm text-dim">Prior-session checks: {prep.checked} / {prep.total} processed · {prep.ready} have enough history · {prep.failed} failed checks. Unknown eligibility blocks paper entries.</p>}
      {data?.service?.entry_halt_reason&&<p className="text-sm text-amber-500">{data.service.entry_halt_reason}</p>}
      <div className="flex flex-wrap gap-3"><input aria-label="Search gap stocks" placeholder="Search symbol or company" value={search} onChange={e=>{setSearch(e.target.value);setLimit(50)}} className="rounded-lg border border-border bg-bg p-2 flex-1 min-w-40"/><select aria-label="Gap filter" value={filter} onChange={e=>{setFilter(e.target.value);setLimit(50)}} className="rounded-lg border border-border bg-bg p-2"><option value="all">All gap-ups</option><option value="range">1–10% gaps</option><option value="eligible">Eligible for V1</option></select></div>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{['Stock','Opening gap','Open','Previous close','History','Eligibility'].map(h=><th className="p-3 text-dim" key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(0,limit).map(r=><tr key={r.symbol} className="border-t border-border"><td className="p-3"><strong>{r.symbol}</strong><p className="text-xs text-dim max-w-52 truncate">{r.name}</p></td><td className="p-3 text-green-500 font-bold">+{(r.gap*100).toFixed(2)}%</td><td className="p-3">{money(r.open)}</td><td className="p-3">{money(r.previous_close)}</td><td className="p-3">{r.history_sessions} sessions</td><td className="p-3">{selected.some(s=>s.symbol===r.symbol)?'On V1 watchlist':reason(r.eligibility)}<p className="text-xs text-dim">{r.gap_basis==='verified_prior_candle_close'?'Previous close verified':'Gap indicative until history/action checks'}</p></td></tr>)}</tbody></table></div>
      {!rows.length&&<p className="text-dim">No stocks match this filter.</p>}
      {rows.length>limit&&<button className="rounded-lg bg-sky-800 px-4 py-2" onClick={()=>setLimit(limit+100)}>Show 100 more · {rows.length} matches</button>}
      <details><summary className="text-sm cursor-pointer">Unavailable data ({scan.unavailable.length})</summary><ul className="text-sm text-dim mt-3">{scan.unavailable.map((r,i)=><li key={i}>{r.symbol}: {reason(r.reason)}</li>)}</ul></details>
    </>}
  </section>;
}
