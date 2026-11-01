// ─────────────────────────────────────────────────────────────────────────────
// Inside-bar breakout engine — the second strategy, and the single source of
// truth for it. Same contract as fib.js: pure functions, no fetching, no clock
// reading, everything passed in. That is what lets one engine serve the web, the
// app and the droplet executor without any of them forming an opinion.
//
// THE TRADE. An inside bar — one whose whole range sits within the previous
// bar's — is a pause: the market has stopped expanding. The bar it sits inside
// (the "mother") defines the boundaries of that pause, and price leaving them is
// the market resuming. Buy the break above the mother's high, sell the break
// below its low, stop on the opposite side, and target five times the mother's
// range. If neither happens within `timeoutBars`, the pause did not resolve into
// anything and the trade leaves.
//
// LONG AND SHORT, unlike the Fibonacci strategy. An inside bar says nothing
// about direction — only that a decision is pending — so the breakout picks the
// side.
//
// NO LOOKAHEAD, and it matters more here than for a retracement. The setup is
// found among CLOSED bars only, and the breakout is only ever recognised on a
// bar AFTER the inside bar. Detecting an inside bar and its breakout on the same
// bar would be reading the future: at the moment the inside bar closed, nobody
// knew which way it would break.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strategy parameters. Flat and exported so a backtest can sweep them without
 * editing the module.
 */
export const IB_CONFIG = {
  /** Target distance as a multiple of the mother bar's range. */
  targetMult: 5.0,
  /** Give up after this many bars in the trade. */
  timeoutBars: 20,
  /**
   * How far back to look for a setup. An inside bar from two days ago whose
   * levels are still untouched is not a live setup, it is history — the
   * conditions that produced the pause are long gone.
   */
  setupLookback: 10,
  /**
   * How recently the breakout must have happened for an entry to still be worth
   * taking. 1 means "only on the bar that just closed": by the following bar the
   * move is underway and entering at the trigger would be chasing a price that
   * has already left.
   */
  maxBreakoutAge: 1,
};

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const isNum = (n) => Number.isFinite(n);

/**
 * Is `bar` entirely inside `mother`?
 *
 * Strict on both sides. A bar equalling the mother's high or low has TOUCHED the
 * boundary, which is not the compression this strategy trades — and an equal
 * high would also make the breakout level ambiguous the moment it is crossed.
 */
export function isInside(bar, mother) {
  if (!bar || !mother) return false;
  if (![bar.high, bar.low, mother.high, mother.low].every(isNum)) return false;
  return bar.high < mother.high && bar.low > mother.low;
}

/** The shape returned when there is nothing to say. Never throws. */
function emptySignal(reason, extra = {}) {
  return {
    asOf: null,
    motherHigh: null, motherLow: null, range: null,
    isInsideBar: false,
    activeMotherHigh: null, activeMotherLow: null,
    longTrigger: null, shortTrigger: null,
    longStop: null, shortStop: null,
    longTarget: null, shortTarget: null,
    lastClose: null,
    state: "no_setup",
    direction: null,
    entryValid: false,
    breakoutBarsAgo: null,
    reason,
    ...extra,
  };
}

/**
 * The current signal state, computed from closed bars.
 *
 * @param {Array} candles hourly bars oldest→newest. The LAST element is taken to
 *                be the last CLOSED bar — strip the forming one first
 *                (closedBars() in fib.js does exactly that).
 * @param {object} config overrides merged over IB_CONFIG.
 * @returns {object} always the same keys; nulls and entryValid:false when the
 *                   inputs cannot support a signal.
 */
export function computeInsideBarSignal(candles, config = IB_CONFIG) {
  const cfg = { ...IB_CONFIG, ...(config || {}) };

  if (!Array.isArray(candles) || candles.length < 3) {
    return emptySignal(
      `Not enough history: need at least 3 closed bars, have ${Array.isArray(candles) ? candles.length : 0}.`,
    );
  }

  const last = candles[candles.length - 1];
  const lastClose = last?.close;
  const base = {
    asOf: last?.timestamp ?? last?.date ?? null,
    lastClose: round2(lastClose),
  };

  // ── Find the most recent inside bar within the lookback ──────────────────
  // Searched newest-first: if several setups are pending, the freshest is the
  // one the market is actually working on.
  const oldest = Math.max(1, candles.length - 1 - cfg.setupLookback);
  let insideIdx = -1;
  for (let i = candles.length - 1; i >= oldest; i--) {
    if (isInside(candles[i], candles[i - 1])) { insideIdx = i; break; }
  }

  if (insideIdx === -1) {
    return {
      ...emptySignal(`No inside bar in the last ${cfg.setupLookback} closed bars — nothing set up.`),
      ...base,
    };
  }

  const mother = candles[insideIdx - 1];
  const motherHigh = mother.high;
  const motherLow = mother.low;
  const range = motherHigh - motherLow;
  const isInsideBarNow = insideIdx === candles.length - 1;

  const levels = {
    ...base,
    motherHigh: round2(motherHigh),
    motherLow: round2(motherLow),
    range: round2(range),
    isInsideBar: isInsideBarNow,
    activeMotherHigh: round2(motherHigh),
    activeMotherLow: round2(motherLow),
    longTrigger: round2(motherHigh),
    shortTrigger: round2(motherLow),
    longStop: round2(motherLow),
    shortStop: round2(motherHigh),
    longTarget: round2(motherHigh + range * cfg.targetMult),
    shortTarget: round2(motherLow - range * cfg.targetMult),
  };

  // A zero-range mother has no levels to break and would make the target
  // identical to the trigger.
  if (!(range > 0)) {
    return { ...emptySignal("Mother bar has no range — nothing to break out of."), ...levels };
  }

  // ── Has price left the mother bar since the inside bar closed? ───────────
  // Only bars AFTER the inside bar count. The inside bar is by definition
  // within the mother, so including it could never break anything, and
  // including the mother itself would be reading the setup from its own data.
  const after = candles.slice(insideIdx + 1);
  let direction = null;
  let breakoutIdx = -1;

  for (let i = 0; i < after.length; i++) {
    const bar = after[i];
    if (!isNum(bar?.high) || !isNum(bar?.low)) continue;
    const up = bar.high > motherHigh;
    const down = bar.low < motherLow;

    if (up && down) {
      // One bar covering both sides. Hourly bars record no tick order, so which
      // came first is unknowable — and guessing would invent a direction the
      // data does not contain. The setup is discarded rather than resolved.
      return {
        ...levels,
        state: "no_setup",
        direction: null,
        entryValid: false,
        breakoutBarsAgo: null,
        reason: `Setup void: one bar broke both ${round2(motherHigh)} and ${round2(motherLow)}, so the direction is unknowable.`,
      };
    }
    if (up || down) { direction = up ? "long" : "short"; breakoutIdx = i; break; }
  }

  if (!direction) {
    return {
      ...levels,
      state: "watching_breakout",
      direction: null,
      entryValid: false,
      breakoutBarsAgo: null,
      reason: `Inside bar formed${isInsideBarNow ? " on the last close" : ""}. Watching ${round2(motherHigh)} for a long and ${round2(motherLow)} for a short.`,
    };
  }

  const barsAgo = after.length - 1 - breakoutIdx;
  const fresh = barsAgo < cfg.maxBreakoutAge;
  const trigger = direction === "long" ? levels.longTrigger : levels.shortTrigger;
  const stop = direction === "long" ? levels.longStop : levels.shortStop;
  const target = direction === "long" ? levels.longTarget : levels.shortTarget;

  return {
    ...levels,
    state: direction === "long" ? "long_signal" : "short_signal",
    direction,
    entryValid: fresh,
    breakoutBarsAgo: barsAgo,
    reason: fresh
      ? `${direction === "long" ? "Long" : "Short"} breakout of the mother bar at ${trigger}. Stop ${stop}, target ${target} (${cfg.targetMult}× the ${round2(range)} range).`
      : `${direction === "long" ? "Long" : "Short"} break of ${trigger} happened ${barsAgo} bar${barsAgo === 1 ? "" : "s"} ago — too late to enter at the level.`,
  };
}

/**
 * Trade management for an OPEN position, long or short.
 *
 * Scans forward from the bar after entry and returns the FIRST exit event, so
 * repeated calls on a growing series keep answering identically rather than
 * drifting as bars arrive.
 *
 * WHEN A BAR TOUCHES BOTH LEVELS the stop wins, for either direction. Hourly
 * bars do not record the order ticks arrived in, and resolving the ambiguity in
 * the stop's favour is the only assumption that cannot flatter a backtest.
 */
export function manageInsideBarTrade({
  direction,
  entryPrice,
  entryIndex,
  stopPrice,
  targetPrice,
  candles,
  config = IB_CONFIG,
} = {}) {
  const cfg = { ...IB_CONFIG, ...(config || {}) };
  const hold = (reason, barsHeld = 0) => ({
    action: "hold", exitPrice: null, barsHeld, exitIndex: null, reason,
  });

  if (!Array.isArray(candles) || !candles.length) return hold("No candles supplied.");
  if (direction !== "long" && direction !== "short") return hold("No direction — nothing to manage.");
  if (!isNum(entryPrice)) return hold("No entry price — nothing to manage.");
  if (!isNum(entryIndex) || entryIndex < 0 || entryIndex >= candles.length) {
    return hold("Entry index is outside the candle series.");
  }

  const long = direction === "long";
  const hasStop = isNum(stopPrice);
  const hasTarget = isNum(targetPrice);

  for (let i = entryIndex + 1; i < candles.length; i++) {
    const bar = candles[i];
    const barsHeld = i - entryIndex;
    if (!bar) continue;

    // Stop first, always — see the note above.
    const stopHit = hasStop && (long
      ? isNum(bar.low) && bar.low <= stopPrice
      : isNum(bar.high) && bar.high >= stopPrice);
    if (stopHit) {
      // A gap straight through the stop fills at the open, not at the level.
      const gapped = isNum(bar.open) && (long ? bar.open < stopPrice : bar.open > stopPrice);
      const exitPrice = gapped ? bar.open : stopPrice;
      return {
        action: "stop",
        exitPrice: round2(exitPrice),
        barsHeld, exitIndex: i,
        reason: gapped
          ? `Gapped through the stop — filled at the open ${round2(exitPrice)}, past the ${round2(stopPrice)} stop.`
          : `Stopped out at ${round2(stopPrice)} after ${barsHeld} bar${barsHeld === 1 ? "" : "s"}.`,
      };
    }

    const targetHit = hasTarget && (long
      ? isNum(bar.high) && bar.high >= targetPrice
      : isNum(bar.low) && bar.low <= targetPrice);
    if (targetHit) {
      const gapped = isNum(bar.open) && (long ? bar.open > targetPrice : bar.open < targetPrice);
      const exitPrice = gapped ? bar.open : targetPrice;
      return {
        action: "target",
        exitPrice: round2(exitPrice),
        barsHeld, exitIndex: i,
        reason: `Target ${round2(targetPrice)} reached after ${barsHeld} bar${barsHeld === 1 ? "" : "s"}.`,
      };
    }

    if (barsHeld >= cfg.timeoutBars) {
      return {
        action: "timeout",
        exitPrice: round2(bar.close),
        barsHeld, exitIndex: i,
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
