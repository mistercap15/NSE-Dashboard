import { sma } from "./technicals"

// ─────────────────────────────────────────────────────────────────────────────
// Market Mood — where the Nifty is relative to its own recent high.
//
// PURE INFORMATION. This computes context for a human reading the seasonal
// picks. It does not size anything, gate anything or score anything, and it is
// deliberately not wired into conviction, lot allocation or the rankings sort.
// If that ever changes it should be a separate, argued decision — the numbers
// below are not strong enough to drive money on their own (see CAVEAT).
//
// THERE ARE NOW THREE MARKET-CONTEXT READINGS ON THE RANKINGS PAGE, and they
// measure different things, so they can and will disagree:
//
//   regime.js   RISK-ON / RISK-OFF   breadth — how many stocks are above their
//                                    own 10-month MA, from the offline snapshot
//   sentiment   BULLISH / BEARISH    a blended score in /api/rankings
//   THIS        Healthy / Caution /  the Nifty index price itself, versus its
//               Correction           own trailing high and its 50/200-day MAs
//
// A market can be 12% off its high (Correction here) while breadth is still
// RISK-ON, because breadth is about participation and this is about drawdown.
// The UI says "Nifty price" on this panel for exactly that reason: a reader who
// sees two labels disagreeing should be able to tell why in one glance.
//
// WHICH HIGH. A rolling 252-session high — about one trading year — not the
// all-time high. Distance from an all-time high made years ago says more about
// history than about now; a market that has gone sideways for two years would
// read as a permanent "Correction" and the label would stop carrying
// information. 252 keeps it to the cycle a seasonal entry actually lives in.
// When fewer than 252 sessions are supplied the high is taken over whatever is
// there and `window_sessions` reports the real number, so a caller can tell a
// one-year reading from a three-month one.
// ─────────────────────────────────────────────────────────────────────────────

/** Sessions in the trailing-high window. ~1 trading year. */
export const HIGH_WINDOW = 252

/** Drawdown boundaries, in percent off the trailing high. */
export const THRESHOLDS = { healthy: 5, caution: 10 }

/**
 * What the 56-month study found for seasonal longs opened in each regime.
 *
 * HARDCODED, AND THAT IS THE HONEST THING TO SHOW. These are not recomputed
 * live; they are a fixed finding from a study of 56 months. 56 months split
 * three ways leaves very few observations per bucket, which is why every one of
 * these ships with CAVEAT attached and why the UI is required to show it. The
 * difference between +3.0% and +0.8% is suggestive, not established.
 */
export const HISTORICAL_CONTEXT = {
  Healthy: "Seasonal longs historically averaged ~+3.0%/mo, 75% positive",
  Caution: "Historically ~+1.5%/mo",
  Correction: "Seasonal longs historically averaged only ~+0.8%/mo, 58% positive",
}

export const CAVEAT =
  "Based on a limited 56-month sample — use as context, not a rule."

/** Everything null, label Unknown. The shape never changes, so the UI can render
 *  it without branching on presence. */
function unknown(reason) {
  return {
    nifty_price: null,
    trailing_high: null,
    pct_off_high: null,
    above_50dma: null,
    above_200dma: null,
    sma50: null,
    sma200: null,
    regime_label: "Unknown",
    historical_context: null,
    caveat: CAVEAT,
    window_sessions: 0,
    asOf: null,
    reason,
  }
}

/**
 * Label from drawdown. Boundaries are closed on the Caution side, deliberately:
 * "within 5% of the high" is Healthy, so exactly 5.0% off is NOT within 5% and
 * reads Caution. Same at the other end — exactly 10.0% is still the "5-10%"
 * band, and Correction begins beyond it. Stated here because a boundary that
 * lives only in a comparison operator is a boundary nobody can check.
 */
export function labelFor(pctOffHigh) {
  if (!Number.isFinite(pctOffHigh)) return "Unknown"
  if (pctOffHigh < THRESHOLDS.healthy) return "Healthy"
  if (pctOffHigh <= THRESHOLDS.caution) return "Caution"
  return "Correction"
}

/**
 * Current market mood from Nifty DAILY candles.
 *
 * @param {Array} candles  oldest→newest, in the getDailyCandles shape
 *                         ({ date, open, high, low, close, volume }).
 * @returns {object}       always the same keys; regime_label "Unknown" and a
 *                         `reason` when there is not enough to say anything.
 *
 * Pure: no fetching, no clock, no globals. Given the same candles it returns
 * the same object, which is what makes it testable at the boundaries.
 */
export function computeMarketRegime(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return unknown("No Nifty candles available.")
  }

  // Tolerate rows with a missing or non-numeric close rather than producing a
  // number built partly from nothing — a bad row upstream should narrow the
  // sample, not silently skew the high.
  const usable = candles.filter((c) => c && Number.isFinite(Number(c.close)))
  if (usable.length === 0) {
    return unknown("Nifty candles carried no usable closes.")
  }

  const closes = usable.map((c) => Number(c.close))
  const last = usable[usable.length - 1]
  const close = closes[closes.length - 1]

  // The trailing high is taken on CLOSES, not intraday highs. A seasonal entry
  // is judged against where the market has actually settled; one spike printed
  // in a minute and never held would otherwise deepen every later drawdown
  // reading for a year.
  const window = closes.slice(-HIGH_WINDOW)
  const trailingHigh = Math.max(...window)
  if (!(trailingHigh > 0)) {
    return unknown("Nifty closes were not usable for a trailing high.")
  }

  const pctOffHigh = ((trailingHigh - close) / trailingHigh) * 100
  const label = labelFor(pctOffHigh)

  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, 200)

  return {
    nifty_price: round2(close),
    trailing_high: round2(trailingHigh),
    pct_off_high: round2(pctOffHigh),
    // null, not false, when there is not enough history. "Below its 200-day"
    // and "we cannot compute a 200-day" are different statements and the UI
    // needs to be able to tell them apart.
    above_50dma: sma50 === null ? null : close > sma50,
    above_200dma: sma200 === null ? null : close > sma200,
    sma50: sma50 === null ? null : round2(sma50),
    sma200: sma200 === null ? null : round2(sma200),
    regime_label: label,
    historical_context: HISTORICAL_CONTEXT[label] ?? null,
    caveat: CAVEAT,
    window_sessions: window.length,
    asOf: last?.date ?? null,
    reason: null,
  }
}

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null)
