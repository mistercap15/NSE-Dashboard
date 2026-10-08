'use client';

const reasons = {
  advance_timeout: 'Did not close 0.5% above the open by 10:00',
  first_pullback_ended_early: 'First pullback ended before two lower-close candles',
  pullback_below_open: 'Pullback touched or fell below the session open',
  first_pullback_proximity_failed: 'Pullback was too far from EMA9 and VWAP',
  sixth_pullback_candle: 'Pullback exceeded five candles',
  entry_cutoff: 'Entry window ended at 11:00',
  pending_expired: 'Entry trigger expired without a fill',
  no_ask: 'No sell offers — cannot simulate a buy',
  no_bid: 'No buy bids — cannot simulate a sell',
  empty_book: 'No executable bids or offers',
  unusable_quote: 'Quote failed freshness or book checks',
};
const phases = {selected:'Waiting for the opening advance',advanced:'Waiting for the first pullback',pullback:'First pullback forming',armed:'Entry trigger armed',entered:'Paper entry recorded'};
export default function SessionStatus({diagnostics, day}) {
  if (!diagnostics || diagnostics.day !== day) return null;
  const d = diagnostics;
  return <div className="rounded-xl border border-border bg-bg p-4 space-y-3">
    <h3 className="font-bold">Session activity · {day}</h3>
    <p>{d.summary}</p>
    <p className="text-sm text-dim">{d.setups.length} watched · {d.signals} entry signals · {d.entries} paper entries</p>
    {d.entry_halted && <p className="text-sm text-amber-600 dark:text-amber-300">Account entry halt: {d.halt_reason || 'Data-health checks blocked new entries during this session.'}</p>}
    <div className="grid sm:grid-cols-2 gap-2">{d.setups.map(s=><div key={s.symbol} className="rounded-lg border border-border p-3">
      <strong>{s.rank}. {s.symbol}</strong>
      <p className="text-sm text-dim mt-1">{s.reason ? reasons[s.reason] || s.reason.replaceAll('_',' ') : phases[s.phase] || 'Waiting for setup'}</p>
      {s.pending && <p className="text-xs mt-1">Trigger ₹{s.pending.trigger} · stop ₹{s.pending.stop}</p>}
      {d.quote_issues.filter(q=>q.symbol===s.symbol).map((q,i)=><p key={i} className="text-xs text-amber-600 dark:text-amber-300 mt-1">{reasons[q.reason] || q.reason.replaceAll('_',' ')}</p>)}
    </div>)}</div>
    <p className="text-xs text-dim">A gap is a candidate, not an entry. Zero trades are expected when the fixed setup rules do not qualify. Last observation: {d.last_observation || 'none'}.</p>
  </div>;
}
