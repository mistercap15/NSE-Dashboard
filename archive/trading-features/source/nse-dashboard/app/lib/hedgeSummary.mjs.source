// UI language only: this does not change trading rules or claim calibrated odds.
export function hedgeSummary(data, { checkedAt, now = Date.now() } = {}) {
  const a = data?.advice;
  const stamp = checkedAt ? Number(checkedAt) * 1000 : Date.parse(data?.asOf || '');
  const stale = Number.isFinite(stamp) && now - stamp > 10 * 60 * 1000;
  const put = data?.simple?.recommendation;
  const quoteAge = now - Date.parse(put?.quote?.at || '');
  const usablePut = put?.eligible && Number.isFinite(quoteAge) && quoteAge >= -5000 && quoteAge <= 120000;
  const direction = a?.direction || 'unknown';
  const base = {
    direction,
    directionLabel: { bullish: 'Price looks strong', bearish: 'Price looks weak', mixed: 'Price is mixed', unknown: 'Price trend unknown' }[direction] || 'Price trend unknown',
    asOf: a?.asOf || null,
    checkedAt: Number.isFinite(stamp) ? new Date(stamp).toISOString() : null,
    partial: !!a?.missing?.length,
    chips: [
      { label: 'Stock', value: direction === 'unknown' ? 'Unknown' : direction[0].toUpperCase() + direction.slice(1) },
      { label: 'Sector', value: a?.sector?.status === 'available' ? (a.sector.weak ? 'Weak' : 'No broad weakness') : 'Unknown' },
      { label: 'News', value: a?.news?.status === 'available' ? (a.news.items?.some(x => x.eventReview && now - Date.parse(x.publishedAt) < 2 * 86400000) ? 'Review event' : 'No tagged event') : 'Unknown' },
    ],
    hedgeReview: !a?.exit ? 'We cannot suggest an exit yet.' : a.exit.startsWith('Recovery condition met') ? 'Consider selling your put. The stock is recovering; selling removes your protection.' : a.exit.startsWith('Expiry within') ? 'Expiry is near. Review both your futures and put before expiry.' : a.exit.startsWith('Review active') ? 'Keep your put for now. News or sector risk is still present.' : a.exit.startsWith('Maintain') ? 'Keep your put for now. Recovery is not clear yet.' : 'We cannot suggest an exit yet.',
  };
  if (a?.status?.startsWith('Contract expired')) return { ...base, tone: 'muted', action: 'Contract expired', reason: 'This contract has expired. Monitoring has stopped.', code: 'expired' };
  if (!a || !Number.isFinite(stamp) || stale || !a.support || ['Insufficient data', 'Data unavailable'].includes(a.status)) {
    return { ...base, direction: 'unknown', directionLabel: 'Data unavailable', chips: [], tone: 'muted', action: stale ? 'Unable to advise' : 'Unable to advise', reason: stale ? 'Prices need updating. Refresh to get a suggestion.' : 'We need fresh data before suggesting a put.', code: 'unknown' };
  }
  const trigger = `Watching ₹${a.support.toFixed(2)}. A close below it, plus other signs of weakness, can trigger a put.`;
  if (a.status === 'Protection warranted') return { ...base, tone: 'red', code: 'protect', action: usablePut ? 'Buy a put for protection' : 'Wait for a fresh put price', reason: usablePut ? 'The stock has weakened. A put can limit further losses.' : 'Protection is needed, but we do not have a usable put price yet.', trigger, quoteNote: usablePut ? 'Check the live price before placing your order.' : 'Refresh the put price before buying.' };
  if (a.status === 'Review event risk') return { ...base, tone: 'amber', code: 'event', action: 'Wait before buying a put', reason: 'There is company news to check. No clear buy signal yet.', trigger };
  if (a.status === 'Prepare protection') return { ...base, tone: 'amber', code: 'prepare', action: 'Wait before buying a put', reason: 'The stock looks weak, but the buy-put signal is not ready.', trigger };
  return { ...base, tone: direction === 'bullish' ? 'green' : 'blue', code: 'wait', action: 'Avoid buying a put for now', reason: 'There is no buy-put signal right now. We’ll keep checking.', trigger };
}
