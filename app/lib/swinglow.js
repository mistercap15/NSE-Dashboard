// ─────────────────────────────────────────────────────────────────────────────
// Swing-low engine — pure, dependency-free, unit-testable.
//
// Goal: surface F&O stocks sitting at a PROVEN support floor — a price band the
// stock has repeatedly bounced from — while it's oversold, with favourable
// reward:risk. This is the "low risk / high reward" oversold-bounce setup.
//
// Everything here is a pure function of a daily-candle array
//   candles = [{ date:"YYYY-MM-DD", open, high, low, close, volume }, ...]  (ascending)
// so it can be tested on synthetic data without any network/Upstox.
//
// Tunables live at the top of each function and in SCORE_WEIGHTS — adjust freely.
// ─────────────────────────────────────────────────────────────────────────────

const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ── Simple moving average of the last `period` closes ────────────────────────
export function sma(closes, period) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ── RSI (Wilder's smoothing), latest value ───────────────────────────────────
export function rsi(closes, period = 14) {
  if (!closes || closes.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return round(100 - 100 / (1 + rs), 1);
}

// ── All swing-low pivots across full history ─────────────────────────────────
// A pivot low is a candle whose low is the minimum of the window `lookback`
// candles either side of it. Unlike technicals.findSwingLows (last 3 only),
// this returns every pivot so we can cluster them into floors.
export function allSwingLows(candles, lookback = 5) {
  const lows = candles.map((c) => c.low);
  const out = [];
  for (let i = lookback; i < lows.length - lookback; i++) {
    const window = lows.slice(i - lookback, i + lookback + 1);
    if (lows[i] === Math.min(...window)) {
      out.push({ price: lows[i], date: candles[i].date, index: i });
    }
  }
  return out;
}

// ── Cluster swing lows into support floors ───────────────────────────────────
// Pivots within `tolerancePct` of a cluster's running mean collapse into one
// floor. `touches` = how many times price bottomed in that band → floor strength.
export function detectFloors(candles, { lookback = 5, tolerancePct = 3.5 } = {}) {
  const pivots = allSwingLows(candles, lookback).sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of pivots) {
    const c = clusters.find((cl) => Math.abs(p.price - cl.mid) / cl.mid <= tolerancePct / 100);
    if (c) {
      c.prices.push(p.price); c.indices.push(p.index); c.dates.push(p.date);
      c.mid = mean(c.prices);
    } else {
      clusters.push({ prices: [p.price], indices: [p.index], dates: [p.date], mid: p.price });
    }
  }
  return clusters
    .map((c) => ({
      low: round(Math.min(...c.prices)),
      high: round(Math.max(...c.prices)),
      mid: round(c.mid),
      touches: c.prices.length,
      lastIndex: Math.max(...c.indices),
      lastTouch: c.dates[c.indices.indexOf(Math.max(...c.indices))],
    }))
    .sort((a, b) => b.touches - a.touches || b.mid - a.mid);
}

// ── Bounce statistics for a given floor zone ─────────────────────────────────
// Every time close ENTERS the [low, high] band from above, look forward
// `forwardDays` and measure the best rebound. Proves the floor actually bounces
// rather than being a level price sliced straight through.
export function bounceStats(candles, zone, { forwardDays = 40, bounceThresholdPct = 8 } = {}) {
  if (!zone) return { entries: 0, bounces: 0, bounceRate: 0, avgBouncePct: 0 };
  const closes = candles.map((c) => c.close);
  const bounces = [];
  let entries = 0;
  let i = 1;
  while (i < closes.length) {
    const enteredZone = closes[i] <= zone.high && closes[i] >= zone.low * 0.94;
    const cameFromAbove = closes[i - 1] > zone.high;
    if (enteredZone && cameFromAbove) {
      entries++;
      const entryPrice = closes[i];
      const fwd = closes.slice(i + 1, i + 1 + forwardDays);
      const peak = fwd.length ? Math.max(...fwd) : entryPrice;
      bounces.push(((peak - entryPrice) / entryPrice) * 100);
      i += forwardDays; // skip the window so one dip isn't double-counted
    } else {
      i++;
    }
  }
  const good = bounces.filter((b) => b >= bounceThresholdPct).length;
  return {
    entries,
    bounces: good,
    bounceRate: entries ? round(good / entries, 2) : 0,
    avgBouncePct: bounces.length ? round(mean(bounces), 1) : 0,
  };
}

// ── Full per-stock analysis ──────────────────────────────────────────────────
// Returns null when there isn't enough history to be meaningful.
export function analyzeSwingLow(candles, { minCandles = 120 } = {}) {
  if (!candles || candles.length < minCandles) return null;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const price = closes[closes.length - 1];
  if (!Number.isFinite(price) || price <= 0) return null;

  const ma50 = sma(closes, Math.min(50, closes.length));
  const ma200 = sma(closes, Math.min(200, closes.length));
  const rsi14 = rsi(closes, 14);

  const high3y = Math.max(...highs);
  const low3y = Math.min(...lows);
  const high52 = Math.max(...highs.slice(-252));
  const low52 = Math.min(...lows.slice(-252));
  const drawdownFromHighPct = round(((price - high3y) / high3y) * 100, 1); // negative
  const aboveLow3yPct = round(((price - low3y) / low3y) * 100, 1);

  const floors = detectFloors(candles);

  // Nearest PROVEN floor (>=2 touches). We want the band the price is resting
  // ON: one whose mid is at/below price (allow a 3% dip into/under it), or that
  // literally brackets the price. Bands well ABOVE price are resistance, not
  // support, so they're excluded — picking the highest qualifying mid gives the
  // closest floor beneath the current price.
  const provenBelow = floors
    .filter((f) => f.touches >= 2 && (f.mid <= price * 1.03 || (f.low <= price && price <= f.high)))
    .sort((a, b) => b.mid - a.mid);
  const nearestFloor = provenBelow[0] || null;

  const distToFloorPct = nearestFloor ? round(((price - nearestFloor.mid) / price) * 100, 1) : null;
  const inZone = nearestFloor
    ? price <= nearestFloor.high * 1.05 && price >= nearestFloor.low * 0.97
    : false;

  const bounce = nearestFloor ? bounceStats(candles, nearestFloor) : { entries: 0, bounceRate: 0, avgBouncePct: 0 };

  // Reward:risk — upside to the mean-reversion target (MA200, floored at 3y mean),
  // downside to a stop just under the floor. Ratio drives the trade math.
  const meanClose = mean(closes);
  const target = round(Math.max(ma200 || 0, meanClose));
  const stop = nearestFloor ? round(nearestFloor.low * 0.97) : round(price * 0.93);
  const upsidePct = round(((target - price) / price) * 100, 1);
  const downsidePct = round(((price - stop) / price) * 100, 1);
  const rr = downsidePct > 0 ? round(upsidePct / downsidePct, 2) : null;

  return {
    price: round(price),
    ma50: ma50 ? round(ma50) : null,
    ma200: ma200 ? round(ma200) : null,
    rsi: rsi14,
    high52: round(high52), low52: round(low52),
    high3y: round(high3y), low3y: round(low3y),
    drawdownFromHighPct, aboveLow3yPct,
    floors: floors.slice(0, 6),
    nearestFloor, distToFloorPct, inZone,
    belowMa50: ma50 ? price < ma50 : null,
    belowMa200: ma200 ? price < ma200 : null,
    bounce,
    rr: { target, stop, upsidePct, downsidePct, ratio: rr },
  };
}

// ── Composite score (0–100), leaning on the proven-floor lens ────────────────
export const SCORE_WEIGHTS = { floor: 45, oversold: 30, rewardRisk: 15, seasonality: 10 };

// seasonal: { nextMonthWR, nextMonthName } or null
export function scoreSwingLow(a, seasonal) {
  if (!a || !a.nearestFloor) return null;
  const reasons = [];

  // ── Floor lens (max 45): proximity + strength + bounce reliability ──────────
  const d = a.distToFloorPct ?? 999;
  let floorPts =
    d <= 2 ? 22 : d <= 5 ? 16 : d <= 8 ? 10 : d <= 12 ? 4 : 0;
  if (floorPts >= 16) reasons.push(`At proven support ₹${a.nearestFloor.low}–₹${a.nearestFloor.high}`);
  else if (floorPts > 0) reasons.push(`Approaching support (${d}% above)`);

  const t = a.nearestFloor.touches;
  const touchPts = t >= 4 ? 13 : t >= 3 ? 10 : t >= 2 ? 6 : 2;
  reasons.push(`${t} historical touches of this floor`);

  let bouncePts = 0;
  if (a.bounce.entries >= 2) {
    bouncePts = a.bounce.bounceRate >= 0.7 ? 10 : a.bounce.bounceRate >= 0.5 ? 6 : a.bounce.bounceRate >= 0.3 ? 3 : 0;
    if (bouncePts >= 6) reasons.push(`Bounced ${Math.round(a.bounce.bounceRate * 100)}% of the time (avg +${a.bounce.avgBouncePct}%)`);
  }
  const floor = floorPts + touchPts + bouncePts;

  // ── Oversold lens (max 30) ──────────────────────────────────────────────────
  let oversold = 0;
  if (a.rsi != null) {
    oversold += a.rsi <= 30 ? 10 : a.rsi <= 40 ? 6 : a.rsi <= 50 ? 3 : 0;
    if (a.rsi <= 35) reasons.push(`Oversold (RSI ${a.rsi})`);
  }
  if (a.belowMa200) { oversold += 7; reasons.push("Below 200-DMA — value zone"); }
  if (a.belowMa50) oversold += 4;
  const dd = Math.abs(a.drawdownFromHighPct || 0);
  oversold += dd >= 40 ? 9 : dd >= 25 ? 6 : dd >= 15 ? 3 : 0;
  if (dd >= 25) reasons.push(`${Math.round(dd)}% off its 3-yr high`);
  oversold = Math.min(oversold, SCORE_WEIGHTS.oversold);

  // ── Reward:risk lens (max 15) ───────────────────────────────────────────────
  const r = a.rr.ratio ?? 0;
  const rrPts = r >= 3 ? 15 : r >= 2 ? 11 : r >= 1.5 ? 7 : r >= 1 ? 3 : 0;
  if (r >= 1.5) reasons.push(`Reward:risk ${r}:1 (+${a.rr.upsidePct}% up / −${a.rr.downsidePct}% risk)`);

  // ── Seasonality confirmation (max 10 bonus) ─────────────────────────────────
  let seasonPts = 0;
  let inSeason = false;
  if (seasonal && Number.isFinite(seasonal.nextMonthWR)) {
    const wr = seasonal.nextMonthWR;
    seasonPts = wr >= 80 ? 10 : wr >= 70 ? 6 : wr >= 60 ? 3 : 0;
    inSeason = wr >= 65;
    if (inSeason) reasons.push(`Seasonally strong in ${seasonal.nextMonthName} (${wr}% WR)`);
  }

  const score = Math.min(100, Math.round(floor + oversold + rrPts + seasonPts));
  const grade =
    score >= 80 ? "A+" : score >= 68 ? "A" : score >= 55 ? "B" : score >= 42 ? "C" : "SKIP";

  return {
    score, grade, inSeason,
    components: { floor: Math.round(floor), oversold: Math.round(oversold), rewardRisk: rrPts, seasonality: seasonPts },
    reasons,
  };
}

// ── Bucket a fully-analysed+scored stock ─────────────────────────────────────
// "at" = in/at the floor now & some oversold; "approaching" = above but nearby.
export function bucketOf(a, scored) {
  if (!a || !a.nearestFloor || !scored) return "none";
  const d = a.distToFloorPct ?? 999;
  const oversoldish = a.rsi == null || a.rsi <= 55;
  const hasEdge = (a.rr.ratio ?? 0) >= 1 && a.rr.upsidePct > 0;
  if (!hasEdge) return "none";
  if ((a.inZone || d <= 6) && oversoldish) return "at";
  if (d <= 12) return "approaching";
  return "none";
}
