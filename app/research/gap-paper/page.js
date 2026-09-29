'use client';
import { useEffect, useState } from 'react';
import Sidebar from '../../components/Sidebar';
import pilot from '../../lib/gapPaperPilot.json';
import DailyPaperPanel from './DailyPaperPanel';
import MarketScanner from './MarketScanner';
function Table({ rows, columns }) {
  if (!rows?.length) return <p className="text-dim py-3">No records yet.</p>;
  const value = v => v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'number' ? Number(v.toFixed(3)).toLocaleString('en-IN') : String(v);
  return <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{columns.map(c => <th className="p-2 border-b border-border" key={c}>{c.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map((r,i) => <tr key={i}>{columns.map(c => <td className="p-2 border-b border-border" key={c}>{value(r[c])}</td>)}</tr>)}</tbody></table></div>;
}
export default function GapPaperPage() {
  const [day,setDay]=useState(()=>new Date(Date.now()+19800000).toISOString().slice(0,10));
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState('');
  async function refresh(){try{const r=await fetch(`/api/research/gap-paper?day=${encodeURIComponent(day)}`,{cache:'no-store'});const j=await r.json();if(!r.ok)throw Error(j.error);setData(j);setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{refresh();const timer=setInterval(refresh,15000);return()=>clearInterval(timer);},[day]);
  async function act(action){setBusy(true);try{const r=await fetch('/api/research/gap-paper',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,confirm:confirmation})});const j=await r.json();if(!r.ok)throw Error(j.error);await refresh();setConfirmation('');setError('');}catch(e){setError(e.message);}finally{setBusy(false);}}
  const stocks=Object.entries(data?.stocks||{}).map(([symbol,x])=>({symbol,...x,trigger:x.pending?.trigger,stop:x.pending?.stop,proposed_quantity:x.proposed_quantity}));
  const positions=Object.values(data?.positions||{});
  return <><Sidebar /><main className="md:ml-[200px] pt-20 md:pt-8 min-h-screen bg-bg text-text p-6 space-y-7">
    <a href="/" className="text-sky-400">← NSERank</a>
    <header><p className="font-bold text-amber-300">PAPER — NO LIVE ORDERS</p><h1 className="text-3xl font-bold mt-2">Gap & first pullback</h1><p className="text-dim mt-2">Mechanical research adaptation · V1 · No proven edge</p></header>
    <MarketScanner data={data}/>
    <DailyPaperPanel data={data} day={day} setDay={setDay} error={error}/>
    <details className="rounded border border-border p-4 space-y-4">
      <summary className="text-xl font-bold cursor-pointer">Historical five-stock pilot · separate research</summary>
      <p>{pilot.label}</p><p className="text-amber-600 dark:text-amber-300">{pilot.warning}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[['Trades',pilot.summary.trades],['Net P&L',`₹${pilot.summary.net_pnl.toFixed(2)}`],['Account return',`${(pilot.summary.account_return*100).toFixed(3)}%`],['Maximum drawdown',`₹${pilot.summary.max_marked_drawdown_rupees.toFixed(2)}`]].map(([label,value])=><div key={label} className="rounded bg-surface p-3"><p className="text-sm text-dim">{label}</p><p className="text-xl font-bold">{value}</p></div>)}</div>
      <p>These are saved research results, not current paper activity. No observer starts when you open this page.</p>
      <details><summary className="cursor-pointer font-bold">Yearly account results</summary><Table rows={pilot.summary.annual.map(r=>({...r,return_percent:r.account_return*100}))} columns={['year','trades','net_account_pnl','return_percent','profit_factor']}/></details>
      <details><summary className="cursor-pointer font-bold">Results by stock</summary><Table rows={Object.entries(pilot.summary.by_stock).map(([symbol,r])=>({symbol,...r}))} columns={['symbol','trades','net_pnl','win_rate','profit_factor']}/></details>
      <details><summary className="cursor-pointer font-bold">Cost and data sensitivity</summary><Table rows={pilot.scenarios.map(r=>({...r,return_percent:r.account_return*100}))} columns={['scenario','trades','net_pnl','return_percent','profit_factor']}/><p className="text-sm text-amber-600 dark:text-amber-300">{pilot.ambiguity_warning}</p></details>
      <details><summary className="cursor-pointer font-bold">Pilot trades and itemized costs</summary><Table rows={pilot.trades} columns={['symbol','qty','entry_at','exit_at','entry','exit','pnl','reason','entry_costs','exit_costs']}/></details>
      <details><summary className="cursor-pointer font-bold">Pilot equity and data coverage</summary><p>{pilot.equity_sampling}</p><Table rows={pilot.equity_curve} columns={['at','equity']}/><Table rows={pilot.coverage} columns={['symbol','earliest','latest','valid_unique_rows','invalid_rows','zero_volume_bars']}/></details>
    </details>
    {error&&<p role="alert" className="text-red-300">{error}</p>}
    <section className="rounded border border-border p-4 space-y-2"><h2 className="font-bold">Current paper account</h2><p>{data?.data_status||'Loading…'} · Last completed event: {data?.last_event||'none'}</p><p>{data?.message}</p><p>Fill model: {data?.execution||'candle-modeled'} · Universe observed: {data?.universe_size||0} · Excluded: {data?.excluded_stocks||0} · Daily risk halt: {String(data?.halted||false)}</p><p>Account: {data?.account_id||'not initialized'}</p><p>Cash ₹{data?.cash?.toLocaleString('en-IN')||'—'} · Marked equity ₹{data?.equity?.toLocaleString('en-IN')||'—'} · Maximum drawdown ₹{data?.drawdown?.toLocaleString('en-IN')||'—'}</p>
      <button disabled={busy||!data?.account_id} onClick={()=>act(data?.paused?'resume':'pause')} className="bg-sky-800 p-2 rounded disabled:opacity-40">{data?.paused?'Resume paper entries':'Pause new paper entries'}</button><p className="text-sm text-dim">Pause leaves paper exits active. This control never touches live executors. Data polling on this page does not start an observer.</p>
    </section>
    <section><h2 className="text-xl">Frozen shortlist</h2><Table rows={data?.shortlist} columns={['rank','symbol','gap','median_value']}/><p className="text-xs text-dim">Gap is a fraction: 0.02 = 2%.</p></section>
    <section><h2 className="text-xl">Setups and exclusions</h2><Table rows={stocks} columns={['symbol','phase','reason','gap','ema','vwap','trigger','stop','proposed_target','proposed_quantity']}/></section>
    <section><h2 className="text-xl">Signals (latest 100)</h2><Table rows={data?.signals} columns={['symbol','at','observed_at','eligible_from','trigger','stop','rank']}/></section>
    <section><h2 className="text-xl">Open paper positions</h2><Table rows={positions} columns={['symbol','qty','entry_at','entry','stop','target','mark','execution']}/></section>
    <section><h2 className="text-xl">Closed trades (latest 100)</h2><Table rows={data?.trades} columns={['symbol','qty','entry','exit','pnl','reason','entry_costs','exit_costs','ambiguous','delayed']}/></section>
    <section><h2 className="text-xl">Rejected signals</h2><Table rows={data?.rejections} columns={['at','symbol','reason']}/></section>
    <section><h2 className="text-xl">Marked equity (latest observations)</h2><Table rows={data?.equity_curve?.slice(-12)} columns={['at','equity','exposure','drawdown','stale_marks']}/></section>
    <section className="border border-red-900 rounded p-4"><h2 className="text-xl">Reset paper account</h2><p>Archives this paper account and starts a new ₹200,000 account. No broker funds or positions are affected.</p><label className="block mt-3">Type RESET PAPER ACCOUNT<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="block bg-slate-800 border border-slate-600 p-2 my-2" /></label><button disabled={busy||confirmation!=='RESET PAPER ACCOUNT'||!data?.account_id} onClick={()=>act('reset')} className="bg-red-900 rounded p-2 disabled:opacity-40">Reset paper account</button></section>
  </main></>;
}
