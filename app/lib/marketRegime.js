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
//   THIS        Extreme Fear …       the Nifty index price itself, versus its
//               Extreme Greed        own trailing high and its 50/200-day MAs
//
// A market can be 12% off its high (Extreme Fear here) while breadth is still
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

/**
 * Drawdown boundaries, in percent off the trailing high.
 *
 * FOUR LABELS, THREE MEASURED BUCKETS. The 56-month study split the data three
 * ways — under 5% off the high, 5-10%, and over 10%. The display vocabulary
 * splits the top bucket again at 2% to separate "at the high" from "near it",
 * because those feel different to read even though the study never measured
 * them apart. So Extreme Greed and Greed SHARE one historical figure, and
 * HISTORICAL_CONTEXT says so out loud rather than quietly printing the same
 * number twice as if it had been measured twice.
 */
export const THRESHOLDS = { extremeGreed: 2, greed: 5, fear: 10 }

/**
 * What the 56-month study found for seasonal longs opened in each regime.
 *
 * READ THIS BEFORE TRUSTING THE VOCABULARY. A fear/greed dial invites the
 * contrarian reading — buy the fear, sell the greed — and for THIS system the
 * sample says the opposite: seasonal longs opened while the Nifty sat near its
 * high did better (~+3.0%/mo, 75% positive) than ones opened deep in a
 * drawdown (~+0.8%/mo, 58% positive). That is momentum behaviour, not mean
 * reversion.
 *
 * Two reasons not to over-trust it either way: 56 months split three ways
 * leaves very few observations per bucket, and the window is mostly a rising
 * market, which flatters "buy near the high" everywhere it is measured. Hence
 * CAVEAT, which every consumer is required to display.
 *
 * HARDCODED, and that is the honest thing to show — these are a fixed finding,
 * not something recomputed live.
 */
export const HISTORICAL_CONTEXT = {
  "Extreme Greed":
    "Under 5% off the high, seasonal longs historically averaged ~+3.0%/mo, 75% positive",
  Greed:
    "Under 5% off the high, seasonal longs historically averaged ~+3.0%/mo, 75% positive",
  Fear: "5-10% off the high, seasonal longs historically averaged ~+1.5%/mo",
  "Extreme Fear":
    "Over 10% off the high, seasonal longs historically averaged only ~+0.8%/mo, 58% positive",
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
 * Label from drawdown.
 *
 * THE VOCABULARY IS SENTIMENT; THE MEASUREMENT IS DRAWDOWN. "Extreme Greed"
 * here means one specific, checkable thing — the Nifty is within 2% of its own
 * 252-session closing high — and nothing about positioning, options flow or
 * volatility, which is what a full fear/greed index would fold in. The label is
 * a name for a distance, not an assessment of the market's mood, and it is
 * never an instruction: see HISTORICAL_CONTEXT above for what actually followed
 * each one.
 *
 * Boundaries are closed on the fearful side, matching the earlier scheme:
 * exactly 2.0% off is NOT "within 2%" and reads Greed; exactly 5.0% reads Fear;
 * exactly 10.0% is still Fear, and Extreme Fear begins beyond it. Stated here
 * because a boundary that lives only in a comparison operator is a boundary
 * nobody can check.
 */
export function labelFor(pctOffHigh) {
  if (!Number.isFinite(pctOffHigh)) return "Unknown"
  if (pctOffHigh < THRESHOLDS.extremeGreed) return "Extreme Greed"
  if (pctOffHigh < THRESHOLDS.greed) return "Greed"
  if (pctOffHigh <= THRESHOLDS.fear) return "Fear"
  return "Extreme Fear"
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
