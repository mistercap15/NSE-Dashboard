// ── Market regime & trend overlay ────────────────────────────────────────────
// Fully offline, from the monthly-return snapshot. A 10-month moving-average
// crossover (Faber's classic timing filter) is the regime gate. Because the
// crossover test (price > MA) is scale-invariant, we can reconstruct a synthetic
// price index from returns alone and get the exact same signal as real prices —
// no Upstox / live data dependency.

import { sanitizeReturns, sma } from "./stats";

const MA_MONTHS = 10; // ~200 trading days

// Synthetic price index from a chronological return series (%).
function reconstructIndex(rets) {
  let px = 100;
  return rets.map(r => (px = px * (1 + r / 100)));
}

// Trend state for one stock from its sorted monthly points.
export function trendState(points) {
  const sorted = [...points].sort((a, b) => a.ym.localeCompare(b.ym));
  const rets = sorted.map(p => p.ret).filter(r => r !== null && Number.isFinite(r));
  if (rets.length < MA_MONTHS + 1) return null;

  const idx = reconstructIndex(rets);
  const price = idx[idx.length - 1];
  const ma = sma(idx, MA_MONTHS);
  if (!ma) return null;

  // MA slope: current MA vs MA 3 months ago
  const maPrev = idx.length >= MA_MONTHS + 3 ? sma(idx.slice(0, -3), MA_MONTHS) : ma;
  const rising = ma >= maPrev;
  const above = price > ma;

  return {
    above,
    rising,
    pctFromMA: Number((((price - ma) / ma) * 100).toFixed(1)),
    state: above && rising ? "UPTREND" : !above && !rising ? "DOWNTREND" : "TRANSITION",
  };
}

// Whole-market regime: equal-weight universe index + breadth.
export function marketRegime(universe) {
  // Equal-weight monthly return across all stocks (sanitized), by month
  const byMonth = {};
  for (const sym of universe.symbols) {
    for (const p of universe.series[sym].points) {
      if (!Number.isFinite(p.ret) || Math.abs(p.ret) > 150) continue;
      (byMonth[p.ym] ||= []).push(p.ret);
    }
  }
  const yms = Object.keys(byMonth).sort();
  // Require minimum breadth so early sparse months don't distort the index
  const idxRets = yms.filter(ym => byMonth[ym].length >= 10)
    .map(ym => byMonth[ym].reduce((a, b) => a + b, 0) / byMonth[ym].length);

  const idx = reconstructIndex(idxRets);
  const price = idx[idx.length - 1];
  const ma = sma(idx, MA_MONTHS);

  // Breadth: share of stocks currently above their own 10-month MA
  let above = 0, counted = 0;
  for (const sym of universe.symbols) {
    const t = trendState(universe.series[sym].points);
    if (!t) continue;
    counted++;
    if (t.above) above++;
  }
  const breadth = counted ? Math.round((above / counted) * 100) : null;

  const riskOn = ma ? price > ma : null;
  return {
    riskOn,
    breadth,
    pctFromMA: ma ? Number((((price - ma) / ma) * 100).toFixed(1)) : null,
    label: riskOn === null ? "Unknown" : riskOn ? "Risk-On" : "Risk-Off",
    note: riskOn
      ? `Market above its ${MA_MONTHS}-mo trend, ${breadth}% of stocks in uptrends — favorable for longs.`
      : `Market below its ${MA_MONTHS}-mo trend, only ${breadth}% of stocks in uptrends — favor caution / shorts.`,
  };
}
