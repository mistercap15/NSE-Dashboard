// ─────────────────────────────────────────────────────────────────────────────
// Fibonacci swing engine — the single source of truth for the Nifty futures
// strategy. Same contract as levels.js and qualify.js: pure functions, no
// fetching, no clock reading, everything a caller needs passed in. That is what
// makes the whole strategy testable from fixtures, and it is why the mobile app
// and the web app can never disagree about what the signal says — neither one
// computes it.
//
// THE TRADE, in one paragraph. Find the swing the market has just made: the
// highest high and lowest low of the last `swingLookback` closed hourly bars.
// In an uptrend, price that pulls back into the 0.618 retracement of that swing
// is buying the dip at a level the move itself defined, rather than at a round
// number. Rest a limit buy there, stop `atrStopMult` ATRs below it — volatility
// units, not a fixed percent, so the stop is equally loose in a wild week and a
// quiet one — and target the swing high that started it. If neither side is hit
// within `timeoutBars`, the setup has gone stale and the position leaves at the
// market.
//
// WHAT THIS MODULE DOES NOT DO. It never decides *when* it is running. Every
// function takes the bars (and, where it matters, `now`) as arguments, so there
// is no hidden dependency on the machine clock and a backtest and a live session
// walk exactly the same code. It also places no orders and knows nothing about
// lots, margin or brokers — that is a later build.
//
// BAR CONVENTION, and it is the easiest thing to get wrong. Everything here
// operates on CLOSED bars, and treats the LAST element of `candles` as the last
// closed bar. Upstox's intraday feed appends the bar currently forming, whose
// close moves tick by tick; feeding that in would make the signal flicker for an
// hour and then settle. Callers must strip it first — closedBars() below does
// exactly that, and the API route calls it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strategy parameters. Exported and flat so they can be tuned in one place, and
 * so a backtest can sweep them by passing an override object rather than
 * editing the module.
 */
export const FIB_CONFIG = {
  /** Bars in the rolling window that defines the swing high/low. */
  swingLookback: 30,
  /** Retracement depth for the entry. 0.618 is the golden-ratio level. */
  fibLevel: 0.618,
  /** Wilder ATR period, in bars. */
  atrPeriod: 14,
  /** Stop distance below entry, in ATRs. */
  atrStopMult: 2.0,
  /** Give up and exit after this many bars in the trade. */
  timeoutBars: 30,
  /**
   * Pullback filter. The signal bar's close must sit above this fraction of the
   * swing range for the setup to count as a pullback in an uptrend rather than
   * a breakdown. At 0.5 that is the midpoint — below it, the "retracement" has
   * eaten more than half the move and the trend thesis is gone.
   */
  trendFilter: 0.5,
};

/** NSE cash/derivatives session end, IST. The 15:15 bar is a 15-minute stub. */
const SESSION_END_MIN = 15 * 60 + 30;
const IST_OFFSET_MS = 5.5 * 3600000;
const HOUR_MS = 3600000;

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const isNum = (n) => Number.isFinite(n);

/** Minutes past IST midnight for an epoch-ms instant. */
function istMinutes(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * When a bar actually closes.
 *
 * Not simply open + 1h: the session ends at 15:30, so the 15:15 bar is a
 * 15-minute stub. Treating it as a full hour would have the engine waiting until
 * 16:15 for a bar that finalised 45 minutes earlier — i.e. missing the last
 * signal of every single day.
 */
export function barCloseMs(bar) {
  const openMs = bar?.timestamp ? new Date(bar.timestamp).getTime() : NaN;
  if (!isNum(openMs)) return NaN;
  const endOfSession = openMs + (SESSION_END_MIN - istMinutes(openMs)) * 60000;
  return Math.min(openMs + HOUR_MS, endOfSession);
}

/**
 * Drop any trailing bar that has not finished forming yet.
 *
 * Upstox's intraday endpoint always appends the in-progress bar, so during a
 * session the newest row is provisional. Rather than blindly dropping the last
 * element — which would throw away a perfectly good final bar when the series
 * ends at yesterday's close — this compares each bar's real close time to `now`.
 */
export function closedBars(candles, now = Date.now()) {
  if (!Array.isArray(candles)) return [];
  const out = [...candles];
  while (out.length) {
    const close = barCloseMs(out[out.length - 1]);
    if (isNum(close) && close <= now) break;
    out.pop();
  }
  return out;
}

/** The newest bar that has definitely closed, or null. */
export function lastClosedBar(candles, now = Date.now()) {
  const closed = closedBars(candles, now);
  return closed.length ? closed[closed.length - 1] : null;
}

/**
 * Wilder ATR, duplicated from technicals.js on purpose.
 *
 * fib.js is imported by the test harness as a standalone .mjs copy (see
 * scripts/test-fib.mjs) and by a Node executor later on, neither of which can
 * resolve this repo's "@/app/lib/..." alias. Keeping the engine dependency-free
 * is what lets it run unchanged in a browser bundle, a Next route and a bare
 * Node process. The two implementations are pinned together by a test that
 * asserts they agree bar for bar.
 */
function atrSeries(candles, period) {
  const n = Array.isArray(candles) ? candles.length : 0;
  const out = new Array(n).fill(null);
  if (!n || !isNum(period) || period < 1 || n < period) return out;

  const tr = candles.map((c, i) => {
    if (!c || !isNum(c.high) || !isNum(c.low)) return null;
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1]?.close;
    if (!isNum(pc)) return c.high - c.low;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  if (tr.slice(0, period).some((v) => !isNum(v))) return out;

  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    const t = isNum(tr[i]) ? tr[i] : prev;
    prev = (prev * (period - 1) + t) / period;
    out[i] = prev;
  }
  return out;
}

/** The shape returned when there is not enough to say anything. Never throws. */
function emptySignal(reason, extra = {}) {
  return {
    asOf: null,
    swingHigh: null,
    swingLow: null,
    range: null,
    fibEntry: null,
    stopPrice: null,
    targetPrice: null,
    atr: null,
    lastClose: null,
    stopDistancePts: null,
    targetDistancePts: null,
    rewardRiskRatio: null,
    entryValid: false,
    reason,
    ...extra,
  };
}

/**
 * The current signal state, computed from the last CLOSED bar.
 *
 * @param {Array} candles  hourly bars oldest→newest, in the getHourlyCandles
 *                         shape. The last element is taken to be the last closed
 *                         bar — strip the in-progress one with closedBars first.
 * @param {object} config  overrides merged over FIB_CONFIG.
 * @returns {object} always the same keys; nulls and entryValid:false when the
 *                   inputs cannot support a signal.
 *
 * The swing window EXCLUDES the signal bar itself. If the signal bar's own high
 * could set the swing high, then `targetPrice` would sometimes sit below the
 * price that just printed and the trend filter would be comparing the bar to a
 * range it helped define — circular, and it quietly inflates backtest results.
 */
export function computeFibSignal(candles, config = FIB_CONFIG) {
  const cfg = { ...FIB_CONFIG, ...(config || {}) };
  const { swingLookback, fibLevel, atrPeriod, atrStopMult, trendFilter } = cfg;

  if (!Array.isArray(candles) || candles.length === 0) {
    return emptySignal("No candles supplied.");
  }

  // Need the swing window, the signal bar itself, and enough bars before that
  // for ATR to have warmed up.
  const needed = swingLookback + 1;
  if (candles.length < needed) {
    return emptySignal(
      `Not enough history: ${candles.length} bars, need ${needed} for a ${swingLookback}-bar swing.`,
    );
  }

  const signalBar = candles[candles.length - 1];
  const lastClose = signalBar?.close;
  if (!isNum(lastClose)) return emptySignal("Last bar has no usable close.");

  // The window BEFORE the signal bar — see the note above.
  const window = candles.slice(-1 - swingLookback, -1);
  const highs = window.map((c) => c?.high).filter(isNum);
  const lows = window.map((c) => c?.low).filter(isNum);
  if (highs.length < swingLookback || lows.length < swingLookback) {
    return emptySignal("Swing window contains bars with missing highs/lows.");
  }

  const swingHigh = Math.max(...highs);
  const swingLow = Math.min(...lows);
  const range = swingHigh - swingLow;

  const base = {
    asOf: signalBar.timestamp ?? signalBar.date ?? null,
    swingHigh: round2(swingHigh),
    swingLow: round2(swingLow),
    range: round2(range),
    lastClose: round2(lastClose),
  };

  // A dead-flat window has no swing to retrace and no target to aim at. Dividing
  // through it would produce an entry equal to the high and an infinite R:R.
  if (!(range > 0)) {
    return { ...emptySignal("Flat swing range — no retracement to trade."), ...base };
  }

  const atrNow = atrSeries(candles, atrPeriod)[candles.length - 1];
  if (!isNum(atrNow) || atrNow <= 0) {
    return {
      ...emptySignal(`ATR unavailable — need at least ${atrPeriod} bars of range data.`),
      ...base,
    };
  }

  const fibEntry = swingHigh - range * fibLevel;
  const stopPrice = fibEntry - atrStopMult * atrNow;
  const targetPrice = swingHigh;

  const stopDistancePts = fibEntry - stopPrice;
  const targetDistancePts = targetPrice - fibEntry;
  const rewardRiskRatio = stopDistancePts > 0 ? targetDistancePts / stopDistancePts : null;

  // Pullback-in-uptrend filter. Below the midpoint of its own swing, this is not
  // a pullback being bought — it is a downtrend being caught.
  const trendFloor = swingLow + range * trendFilter;
  const uptrendOK = lastClose > trendFloor;

  const reason = uptrendOK
    ? `Pullback in uptrend: close ${round2(lastClose)} holds above the ${Math.round(trendFilter * 100)}% level ${round2(trendFloor)}. Rest a buy at ${round2(fibEntry)}, stop ${round2(stopPrice)}, target ${round2(targetPrice)}.`
    : `Stand aside: close ${round2(lastClose)} is at or below the ${Math.round(trendFilter * 100)}% level ${round2(trendFloor)}, so the swing has broken down rather than pulled back.`;

  return {
    ...base,
    fibEntry: round2(fibEntry),
    stopPrice: round2(stopPrice),
    targetPrice: round2(targetPrice),
    atr: round2(atrNow),
    stopDistancePts: round2(stopDistancePts),
    targetDistancePts: round2(targetDistancePts),
    rewardRiskRatio: rewardRiskRatio == null ? null : Math.round(rewardRiskRatio * 100) / 100,
    entryValid: uptrendOK,
    reason,
  };
}

/**
 * Trade management for an OPEN position: should it be out, and why?
 *
 * The executor calls this once per closed bar; a backtest calls it the same way.
 * It scans forward from the bar after entry and returns the FIRST exit event, so
 * repeated calls on a growing series keep answering identically instead of
 * drifting as new bars arrive.
 *
 * @param {object} p
 * @param {number} p.entryPrice   fill price
 * @param {number} p.entryIndex   index into `candles` of the bar the fill happened on
 * @param {number} p.stopPrice    from the signal that opened the trade
 * @param {number} p.targetPrice  ditto
 * @param {Array}  p.candles      closed bars oldest→newest
 * @returns {{action: "hold"|"stop"|"target"|"timeout", exitPrice: number|null,
 *            barsHeld: number, exitIndex: number|null, reason: string}}
 *
 * WHEN A BAR TOUCHES BOTH: the stop wins. Hourly bars do not record the order
 * ticks arrived in, so a bar spanning both levels is genuinely ambiguous.
 * Resolving it in the stop's favour is the only assumption that cannot flatter a
 * backtest — the opposite choice invents wins that may never have happened.
 */
export function manageTrade({
  entryPrice,
  entryIndex,
  stopPrice,
  targetPrice,
  candles,
  config = FIB_CONFIG,
} = {}) {
  const cfg = { ...FIB_CONFIG, ...(config || {}) };
  const hold = (reason, barsHeld = 0) => ({
    action: "hold",
    exitPrice: null,
    barsHeld,
    exitIndex: null,
    reason,
  });

  if (!Array.isArray(candles) || !candles.length) return hold("No candles supplied.");
  if (!isNum(entryPrice)) return hold("No entry price — nothing to manage.");
  if (!isNum(entryIndex) || entryIndex < 0 || entryIndex >= candles.length) {
    return hold("Entry index is outside the candle series.");
  }

  const hasStop = isNum(stopPrice);
  const hasTarget = isNum(targetPrice);

  for (let i = entryIndex + 1; i < candles.length; i++) {
    const bar = candles[i];
    const barsHeld = i - entryIndex;
    if (!bar) continue;

    // Stop first — see the note above.
    if (hasStop && isNum(bar.low) && bar.low <= stopPrice) {
      // A gap straight through the stop fills at the open, not at the level.
      const exitPrice = isNum(bar.open) && bar.open < stopPrice ? bar.open : stopPrice;
      return {
        action: "stop",
        exitPrice: round2(exitPrice),
        barsHeld,
        exitIndex: i,
        reason:
          exitPrice < stopPrice
            ? `Gapped through the stop — filled at the open ${round2(exitPrice)}, below the ${round2(stopPrice)} stop.`
            : `Stopped out at ${round2(stopPrice)} after ${barsHeld} bar${barsHeld === 1 ? "" : "s"}.`,
      };
    }

    if (hasTarget && isNum(bar.high) && bar.high >= targetPrice) {
      const exitPrice = isNum(bar.open) && bar.open > targetPrice ? bar.open : targetPrice;
      return {
        action: "target",
        exitPrice: round2(exitPrice),
        barsHeld,
        exitIndex: i,
        reason: `Target ${round2(targetPrice)} reached after ${barsHeld} bar${barsHeld === 1 ? "" : "s"}.`,
      };
    }

    if (barsHeld >= cfg.timeoutBars) {
      return {
        action: "timeout",
        exitPrice: round2(bar.close),
        barsHeld,
        exitIndex: i,
        reason: `Held ${barsHeld} bars without hitting stop or target — exiting at ${round2(bar.close)}.`,
      };
    }
  }

  const barsHeld = candles.length - 1 - entryIndex;
  return hold(
    `Open ${barsHeld} bar${barsHeld === 1 ? "" : "s"}: neither stop nor target touched.`,
    barsHeld,
  );
}
