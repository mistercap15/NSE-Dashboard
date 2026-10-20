// UI language only: this does not change trading rules or claim calibrated odds.
export function hedgeSummary(data, { checkedAt, now = Date.now() } = {}) {
  const a = data?.advice;
  const stamp = checkedAt ? Number(checkedAt) * 1000 : Date.parse(data?.asOf || '');
  const stale = Number.isFinite(stamp) && now - stamp > 10 * 60 * 1000;
  const direction = a?.direction || 'unknown';
  const base = {
    direction,
    directionLabel: { bullish: 'Bullish trend', bearish: 'Bearish trend', mixed: 'Mixed trend', unknown: 'Trend unavailable' }[direction] || 'Trend unavailable',
    asOf: a?.asOf || null,
    checkedAt: Number.isFinite(stamp) ? new Date(stamp).toISOString() : null,
    partial: !!a?.missing?.length,
    chips: [
      { label: 'Stock', value: direction === 'unknown' ? 'Unknown' : direction[0].toUpperCase() + direction.slice(1) },
      { label: 'Sector', value: a?.sector?.status === 'available' ? (a.sector.weak ? 'Weak' : 'No broad weakness') : 'Unknown' },
      { label: 'News', value: a?.news?.status === 'available' ? (a.news.items?.some(x => x.eventReview && now - Date.parse(x.publishedAt) < 2 * 86400000) ? 'Review event' : 'No tagged event') : 'Unknown' },
    ],
    hedgeReview: a?.exit || 'No reliable hedge-exit assessment.',
  };
  if (a?.status?.startsWith('Contract expired')) return { ...base, tone: 'muted', action: 'Review settlement', reason: 'This contract has expired. Monitoring has stopped.', code: 'expired' };
  if (!a || stale || !a.support || ['Insufficient data', 'Data unavailable'].includes(a.status)) {
    return { ...base, direction: 'unknown', directionLabel: 'Data needs attention', chips: [], tone: 'muted', action: stale ? 'Refresh before deciding' : 'Waiting for reliable data', reason: stale ? 'The last monitoring result is over ten minutes old.' : 'A hedge decision needs usable price history and a current assessment.', code: 'unknown' };
  }
  const trigger = `Next trigger: daily close below ₹${a.support.toFixed(2)} with confirmation.`;
  if (a.status === 'Protection warranted') return { ...base, tone: 'red', code: 'protect', action: 'Review adding a put', reason: 'Support broke with confirming weakness.', trigger, quoteNote: data?.simple?.recommendation?.eligible ? 'Check the selected put before placing your own order.' : 'Refresh a usable put quote before acting.' };
  if (a.status === 'Review event risk') return { ...base, tone: 'amber', code: 'event', action: 'Review the news first', reason: 'A company event needs attention before changing protection.', trigger };
  if (a.status === 'Prepare protection') return { ...base, tone: 'amber', code: 'prepare', action: 'Prepare a put · wait for confirmation', reason: 'Price is weak or near support; the full hedge trigger has not confirmed.', trigger };
  return { ...base, tone: direction === 'bullish' ? 'green' : 'blue', code: 'wait', action: 'Wait · no new put signal', reason: 'The daily protection trigger is not active.', trigger };
}
