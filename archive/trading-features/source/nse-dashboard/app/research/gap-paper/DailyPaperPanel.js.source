'use client';
import SessionStatus from './SessionStatus';
const money = value => value == null ? '—' : `₹${Number(value).toLocaleString('en-IN', {maximumFractionDigits: 2})}`;
export default function DailyPaperPanel({ data, day, setDay, error }) {
  const d = data?.selected_day === day ? data?.daily : null, service = data?.service;
  const stale = service?.heartbeat_age_seconds > 30 || (service?.status === 'observing' && service?.quote_age_seconds > 15);
  return <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Daily paper trading</h2><label className="text-sm">Session date <input aria-label="Paper session date" type="date" value={day} onChange={e=>setDay(e.target.value)} className="bg-bg text-text border border-border rounded px-2 py-1 ml-2"/></label></div>
    <p className={stale || error ? 'text-red-500' : 'text-dim'}>{error ? 'Connection interrupted — retained figures may be stale.' : stale ? 'Service or market data is stale. Do not treat these marks as current.' : service?.status?.replaceAll('_',' ') || 'Paper service not connected'}</p>
    <p className="text-sm text-dim">{service?.message || 'Saved historical results below are separate from live paper observation.'}</p>
    {service && <p className="text-xs text-dim">Service heartbeat: {service.heartbeat_at || 'none'} · Last quote received: {service.last_quote_received || 'none'} · Last completed candle: {service.last_completed_candle || 'none'}</p>}
    {data?.universe?.label && <p className="text-sm">{data.universe.label} · {data.universe.members} admitted stocks before liquidity/setup filters</p>}
    {(data?.operational_halt || service?.entry_halt) && <p className="text-amber-600 dark:text-amber-300">New entries blocked by data-health checks. Existing paper positions still exit on the next valid quote. A manual resume does not override data-health or daily-loss limits.</p>}
    <SessionStatus diagnostics={data?.session_diagnostics} day={day}/>
    {!d ? <p className="text-dim">No forward paper observations recorded for {day}. No historical trades have been invented for this date.</p> : <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Net P&L for day',d.net_pnl],['Realized P&L',d.realized_pnl],['Open P&L change',d.unrealized_change],['Fees paid (included)',d.fees],['Marked equity',d.equity],['Available cash',d.cash],['Open P&L now',d.open_unrealized_pnl],['Day max drawdown',d.max_drawdown]].map(([label,value])=><div key={label} className="bg-bg rounded p-3"><p className="text-xs text-dim">{label}</p><p className="font-bold text-lg">{money(value)}</p></div>)}</div>
      <p>{d.entries} entries · {d.closed_trades} closed trades · {d.open_positions} open positions at the last observation</p>
      <p className="text-xs text-dim">Daily net P&L = realized P&L + change in open P&L. Fees already paid are included; future exit charges are not yet deducted from open positions. Quote fills are simulated and may miss prices between polls.</p>
      <h3 className="font-bold">Trades closed on {day}</h3>
      {!data.day_records?.trades?.length ? <p className="text-dim">No closed trades on this date.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Stock','Shares','Entry time','Exit time','Entry','Exit','Net P&L','Exit reason'].map(x=><th key={x} className="text-left p-2">{x}</th>)}</tr></thead><tbody>{data.day_records.trades.map((t,i)=><tr key={i}>{[t.symbol,t.qty,t.entry_at,t.exit_at,money(t.entry),money(t.exit),money(t.pnl),t.reason].map((v,j)=><td key={j} className="p-2 border-t border-border">{v}</td>)}</tr>)}</tbody></table></div>}
      {['signals','rejections'].map(kind=><details key={kind}><summary className="cursor-pointer">{kind === 'signals' ? 'Session signals' : 'Rejected entries'} ({data.day_records?.[kind]?.length || 0})</summary><ul className="space-y-2 mt-2">{(data.day_records?.[kind] || []).map((r,i)=><li key={i} className="border border-border rounded p-2 text-sm"><strong>{r.symbol}</strong> · {r.observed_at || r.at}<br/>{kind==='signals' ? `Trigger ${money(r.trigger)} · Stop ${money(r.stop)}` : r.reason?.replaceAll('_',' ')}</li>)}</ul></details>)}
    </>}
    {!!data?.daily_history?.length && <details><summary className="cursor-pointer">Daily history</summary><div className="flex flex-wrap gap-2 mt-2">{data.daily_history.map(r=><button key={r.day} onClick={()=>setDay(r.day)} className="border border-border rounded p-2 text-sm">{r.day} · {money(r.net_pnl)}</button>)}</div></details>}
  </section>;
}
