// ─────────────────────────────────────────────────────────────────────────────
// Trade levels — the single source of truth for entry, stop and target.
//
// These used to be computed in three places with three different rules: the
// sizing page stopped at `worst × 1.2` below entry, the early-entry page at 3%
// under the second support, and the swing-low engine at 3% under the floor. The
// same stock could therefore show three different stops depending on which
// screen you were looking at. Everything now routes through here.
//
// STOP — one rule, always structural. Price sits above real levels, so a stop
// belongs just under the nearest one that matters; a stop placed anywhere else
// is noise. Seasonality does NOT tighten it: clamping a stop above support is
// how you get taken out precisely when support is tested. Instead the seasonal
// worst case is a *risk check* — if the structural stop implies more downside
// than the month historically delivers, we say so (and callers size down), the
// same way the sizing engine's hard caps already reduce lots rather than moving
// the stop.
//
// TARGET — genuinely strategy-dependent, so it is tagged rather than forced:
//   • "seasonal"  — entry compounded by the month's median return. The monthly
//                   edge trade the rankings and sizing pages are built around.
//   • "reversion" — the mean (MA200 / 3y average) that a beaten-down name pulls
//                   back to. What the swing-low screener is actually trading.
// Both are capped at +30% so a crashed stock can't advertise a fantasy target,
// and every response states which basis produced the number.
// ─────────────────────────────────────────────────────────────────────────────

/** Upside cap. A "first move" target stays believable; beyond this is fiction. */
export const TARGET_CAP_PCT = 30;

/** Structural stops sit this far under the level they protect. */
const STOP_BUFFER = 0.97;

/** Seasonal worst case is widened by this before being called unusual. */
const RISK_NORM_MULTIPLE = 1.2;

/** Used only when a symbol has neither support levels nor seasonal history. */
const FALLBACK_STOP_PCT = 7;

/**
 * Holding-period guard for the seasonal strategy, as a fraction of the month's
 * worst case. A month-long position needs a stop that survives a month of
 * noise, so levels nearer than this are skipped in favour of the next one down.
 * Swing Low is exempt — a bounce off a floor is a days-to-weeks trade.
 */
const SEASONAL_MIN_STOP_FRACTION = 0.6;

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

// Strength ranking for picking which support the stop should hide under.
const STRENGTH_RANK = { VERY_STRONG: 0, STRONG: 1, MEDIUM: 2, WEAK: 3 };

/**
 * Pick the level a stop should sit beneath.
 *
 * Two budgets shape the choice, and both come from the seasonal worst case:
 *
 *   maxRiskPct — how far you can afford to reach. A STRONG level is worth
 *     reaching for over a nearer WEAK one, but not at any price.
 *
 *   minRiskPct — how near is too near. This is the holding-period guard. A
 *     month-long seasonal position stopped just under the 10-day average is
 *     stopped out by ordinary intra-month noise, so levels closer than this are
 *     skipped and the next one down is used. Swing Low passes no minimum: it is
 *     a short bounce off a floor, where a tight structural stop is the point.
 *
 * Returns null when nothing qualifies, which the caller reads as "fall back to
 * the seasonal worst case".
 */
export function pickStopAnchor(supports, entry, { minRiskPct = null, maxRiskPct = null } = {}) {
  const below = (supports || [])
    .filter((z) => Number.isFinite(z?.price) && z.price > 0 && z.price < entry)
    .sort((a, b) => b.price - a.price);
  if (!below.length) return null;

  const riskOf = (z) => ((entry - z.price * STOP_BUFFER) / entry) * 100;

  // Drop levels too close to survive the holding period.
  const eligible = minRiskPct != null ? below.filter((z) => riskOf(z) >= minRiskPct) : below;
  if (!eligible.length) return null;

  if (maxRiskPct != null) {
    const affordableStrong = eligible.find(
      (z) => (STRENGTH_RANK[z.strength] ?? 2) <= 1 && riskOf(z) <= maxRiskPct,
    );
    if (affordableStrong) return affordableStrong;
  }

  return eligible[0];
}

/**
 * @param {object} args
 * @param {number}  args.entry          Entry price.
 * @param {string} [args.entryBasis]    "live" | "first-day-open" | "provisional".
 * @param {Array}  [args.supports]      computeSupportZones().zones, or swing-low floors
 *                                      mapped to {price, type, strength}.
 * @param {object} [args.seasonality]   { medianReturn, worst, winRate, n } for the month.
 * @param {number} [args.reversionTarget] MA200 / 3y mean, for strategy "reversion".
 * @param {string} [args.strategy]      "seasonal" (default) | "reversion".
 * @param {number} [args.lotSize]
 * @param {number} [args.lots]
 */
export function computeLevels({
  entry,
  entryBasis = "live",
  supports = [],
  seasonality = null,
  reversionTarget = null,
  strategy = "seasonal",
  lotSize = null,
  lots = 0,
} = {}) {
  if (!Number.isFinite(entry) || entry <= 0) return null;

  const warnings = [];

  // ── STOP ──────────────────────────────────────────────────────────────────
  const seasonalWorst = Number.isFinite(seasonality?.worst) ? seasonality.worst : null;
  // `worst` is negative (e.g. −6.3), so this is the tolerable downside as a
  // positive percentage. It is the budget for reaching a sturdier support, and
  // afterwards a check on the result — never a clamp.
  const riskNorm = seasonalWorst != null ? Math.abs(seasonalWorst) * RISK_NORM_MULTIPLE : null;
  // Only the month-long strategy gets a "too close to be meaningful" floor.
  const minRiskPct =
    strategy === "seasonal" && seasonalWorst != null
      ? Math.abs(seasonalWorst) * SEASONAL_MIN_STOP_FRACTION
      : null;
  const anchor = pickStopAnchor(supports, entry, { minRiskPct, maxRiskPct: riskNorm });

  // Did the horizon guard actually reject something? Worth saying, since the
  // stop then sits further away than the chart's nearest line suggests.
  const nearestAny = pickStopAnchor(supports, entry);
  const skippedNearer = Boolean(
    minRiskPct != null && nearestAny && (!anchor || anchor.price !== nearestAny.price),
  );

  let stopPrice;
  let stopBasis;
  if (anchor) {
    stopPrice = round2(anchor.price * STOP_BUFFER);
    stopBasis = anchor.type || "SUPPORT";
  } else if (riskNorm != null) {
    stopPrice = round2(entry * (1 - riskNorm / 100));
    stopBasis = "SEASONAL_WORST";
    warnings.push(
      skippedNearer
        ? "Every support below entry sits too close to survive a month — stop derived from the seasonal worst case."
        : "No support level below entry — stop derived from the seasonal worst case.",
    );
  } else {
    stopPrice = round2(entry * (1 - FALLBACK_STOP_PCT / 100));
    stopBasis = "FALLBACK";
    warnings.push("No support levels and no seasonal history — stop is a flat 7%.");
  }

  const stopPct = round1(((entry - stopPrice) / entry) * 100);

  // Risk check, NOT a clamp: a structural stop that risks more than the month
  // historically loses is a smaller position, not a tighter stop.
  const exceedsSeasonalRisk = riskNorm != null && stopPct > riskNorm;
  if (skippedNearer && anchor) {
    warnings.push(
      `Nearer support at ${round2(nearestAny.price)} skipped — too close to hold for a month.`,
    );
  }

  if (exceedsSeasonalRisk) {
    warnings.push(
      `Stop risks ${stopPct}%, beyond the ${round1(riskNorm)}% this month's worst case suggests — size down rather than tightening it.`,
    );
  }

  // ── TARGET ────────────────────────────────────────────────────────────────
  const capPrice = entry * (1 + TARGET_CAP_PCT / 100);
  let rawTarget = null;
  let targetBasis;

  if (strategy === "reversion") {
    rawTarget = Number.isFinite(reversionTarget) && reversionTarget > entry ? reversionTarget : null;
    targetBasis = "MEAN_REVERSION";
    if (rawTarget == null && Number.isFinite(seasonality?.medianReturn)) {
      rawTarget = entry * (1 + seasonality.medianReturn / 100);
      targetBasis = "SEASONAL_MEDIAN";
      warnings.push("No mean above entry — fell back to the seasonal median target.");
    }
  } else {
    if (Number.isFinite(seasonality?.medianReturn)) {
      rawTarget = entry * (1 + seasonality.medianReturn / 100);
      targetBasis = "SEASONAL_MEDIAN";
    } else if (Number.isFinite(reversionTarget) && reversionTarget > entry) {
      rawTarget = reversionTarget;
      targetBasis = "MEAN_REVERSION";
      warnings.push("No seasonal history — fell back to the mean-reversion target.");
    }
  }

  let target = null;
  let targetCapped = false;
  if (rawTarget != null && rawTarget > 0) {
    targetCapped = rawTarget > capPrice;
    target = round2(Math.min(rawTarget, capPrice));
  }

  const targetPct = target != null ? round1(((target - entry) / entry) * 100) : null;

  // A seasonal target below entry means the month is historically negative —
  // real information, not an error, but it isn't a long setup.
  if (target != null && target <= entry) {
    warnings.push("Target sits at or below entry — this month has no historical upside.");
  }

  // No target at all needs saying out loud. It happens for genuinely thin
  // symbols — a recent listing or demerger has neither seasonal history in the
  // snapshot nor enough candles for a mean — and a blank with no reason looks
  // like a bug rather than an honest "not enough data".
  if (target == null) {
    const why = [];
    if (!Number.isFinite(seasonality?.medianReturn)) why.push("no seasonal history");
    if (!Number.isFinite(reversionTarget) || reversionTarget <= entry) {
      why.push("no mean above entry");
    }
    warnings.push(
      `No target — ${why.join(" and ")}. Too little history to project one; the stop still stands.`,
    );
  }

  // ── DERIVED ───────────────────────────────────────────────────────────────
  const risk = entry - stopPrice;
  const reward = target != null ? target - entry : null;
  const riskReward = reward != null && risk > 0 ? round2(reward / risk) : null;

  // Midpoint of entry and stop, so a planned dip fill still sits above the
  // stop. Always computed — whether it is worth *showing* depends on having 2+
  // lots to stage, and that is the caller's presentation decision, not a rule.
  const averageIn = round2((entry + stopPrice) / 2);

  const perLot = Number.isFinite(lotSize) && lotSize > 0 ? lotSize : null;
  const riskAmount = perLot && lots ? Math.round(risk * perLot * lots) : null;
  const rewardAmount = perLot && lots && reward != null ? Math.round(reward * perLot * lots) : null;

  return {
    strategy,
    entry: { price: round2(entry), basis: entryBasis },
    stop: {
      price: stopPrice,
      pct: stopPct,
      basis: stopBasis,
      anchorPrice: anchor ? round2(anchor.price) : null,
      exceedsSeasonalRisk,
      seasonalRiskNormPct: riskNorm != null ? round1(riskNorm) : null,
      /** A closer level existed but was too near for the holding period. */
      skippedNearer,
      minStopPct: minRiskPct != null ? round1(minRiskPct) : null,
    },
    target:
      target != null
        ? { price: target, pct: targetPct, basis: targetBasis, capped: targetCapped }
        : null,
    riskReward,
    averageIn,
    riskAmount,
    rewardAmount,
    warnings,
  };
}

/** Swing-low floors -> the {price, type, strength} shape the stop picker wants. */
export function floorsToSupports(floors) {
  return (floors || [])
    .filter((f) => Number.isFinite(f?.low))
    .map((f) => ({
      price: f.low,
      type: "FLOOR",
      // A multi-touch band is the strongest structure the app knows about.
      strength: (f.touches ?? 0) >= 4 ? "VERY_STRONG" : (f.touches ?? 0) >= 2 ? "STRONG" : "MEDIUM",
    }));
}

/** Pull one month's seasonal stats out of the universe snapshot's return series. */
export function seasonalityFor(returns) {
  const vals = (returns || []).filter((r) => Number.isFinite(r));
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianReturn =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    medianReturn: round2(medianReturn),
    worst: round2(sorted[0]),
    best: round2(sorted[sorted.length - 1]),
    winRate: Math.round((vals.filter((r) => r > 0).length / vals.length) * 100),
    n: vals.length,
  };
}
