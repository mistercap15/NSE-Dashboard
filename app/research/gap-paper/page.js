'use client';
import { useEffect, useState } from 'react';
function Table({ rows, columns }) {
  if (!rows?.length) return <p className="text-slate-400 py-3">No records yet.</p>;
  const value = v => v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'number' ? Number(v.toFixed(3)).toLocaleString('en-IN') : String(v);
  return <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{columns.map(c => <th className="p-2 border-b border-slate-700" key={c}>{c.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map((r,i) => <tr key={i}>{columns.map(c => <td className="p-2 border-b border-slate-800" key={c}>{value(r[c])}</td>)}</tr>)}</tbody></table></div>;
}
export default function GapPaperPage() {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState('');
  async function refresh(){try{const r=await fetch('/api/research/gap-paper',{cache:'no-store'});const j=await r.json();if(!r.ok)throw Error(j.error);setData(j);setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{refresh();const timer=setInterval(refresh,15000);return()=>clearInterval(timer);},[]);
  async function act(action){setBusy(true);try{const r=await fetch('/api/research/gap-paper',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,confirm:confirmation})});const j=await r.json();if(!r.ok)throw Error(j.error);setData(j);setConfirmation('');setError('');}catch(e){setError(e.message);}finally{setBusy(false);}}
  const stocks=Object.entries(data?.stocks||{}).map(([symbol,x])=>({symbol,...x,trigger:x.pending?.trigger,stop:x.pending?.stop,proposed_quantity:x.proposed_quantity}));
  const positions=Object.values(data?.positions||{});
  return <main className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-7">
    <a href="/" className="text-sky-400">← NSERank</a>
    <header><p className="font-bold text-amber-300">PAPER — NO LIVE ORDERS</p><h1 className="text-3xl font-bold mt-2">Gap & first pullback</h1><p className="text-slate-400 mt-2">Mechanical research adaptation · V1 · No proven edge</p></header>
    {error&&<p role="alert" className="text-red-300">{error}</p>}
    <section className="rounded border border-slate-700 p-4 space-y-2"><h2 className="font-bold">Observation status</h2><p>{data?.data_status||'Loading…'} · Last completed event: {data?.last_event||'none'}</p><p>{data?.message}</p><p>Fill model: {data?.execution||'candle-modeled'} · Universe observed: {data?.universe_size||0} · Excluded: {data?.excluded_stocks||0} · Daily risk halt: {String(data?.halted||false)}</p><p>Account: {data?.account_id||'not initialized'}</p><p>Cash ₹{data?.cash?.toLocaleString('en-IN')||'—'} · Marked equity ₹{data?.equity?.toLocaleString('en-IN')||'—'} · Maximum drawdown ₹{data?.drawdown?.toLocaleString('en-IN')||'—'}</p>
      <button disabled={busy||!data?.account_id} onClick={()=>act(data?.paused?'resume':'pause')} className="bg-sky-800 p-2 rounded disabled:opacity-40">{data?.paused?'Resume paper entries':'Pause new paper entries'}</button><p className="text-sm text-slate-400">Pause leaves paper exits active. This control never touches live executors. Data polling on this page does not start an observer.</p>
    </section>
    <section><h2 className="text-xl">Frozen shortlist</h2><Table rows={data?.shortlist} columns={['rank','symbol','gap','median_value']}/><p className="text-xs text-slate-400">Gap is a fraction: 0.02 = 2%.</p></section>
    <section><h2 className="text-xl">Setups and exclusions</h2><Table rows={stocks} columns={['symbol','phase','reason','gap','ema','vwap','trigger','stop','proposed_target','proposed_quantity']}/></section>
    <section><h2 className="text-xl">Signals (latest 100)</h2><Table rows={data?.signals} columns={['symbol','at','observed_at','eligible_from','trigger','stop','rank']}/></section>
    <section><h2 className="text-xl">Open paper positions</h2><Table rows={positions} columns={['symbol','qty','entry_at','entry','stop','target','mark','execution']}/></section>
    <section><h2 className="text-xl">Closed trades (latest 100)</h2><Table rows={data?.trades} columns={['symbol','qty','entry','exit','pnl','reason','entry_costs','exit_costs','ambiguous','delayed']}/></section>
    <section><h2 className="text-xl">Rejected signals</h2><Table rows={data?.rejections} columns={['at','symbol','reason']}/></section>
    <section><h2 className="text-xl">Marked equity (latest observations)</h2><Table rows={data?.equity_curve?.slice(-12)} columns={['at','equity','exposure','drawdown','stale_marks']}/></section>
    <section className="border border-red-900 rounded p-4"><h2 className="text-xl">Reset paper account</h2><p>Archives this paper account and starts a new ₹200,000 account. No broker funds or positions are affected.</p><label className="block mt-3">Type RESET PAPER ACCOUNT<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="block bg-slate-800 border border-slate-600 p-2 my-2" /></label><button disabled={busy||confirmation!=='RESET PAPER ACCOUNT'||!data?.account_id} onClick={()=>act('reset')} className="bg-red-900 rounded p-2 disabled:opacity-40">Reset paper account</button></section>
  </main>;
}
