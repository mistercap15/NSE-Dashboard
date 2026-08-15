// ─────────────────────────────────────────────────────────────────────────────
// Playbook — the month's highest-conviction trades.
//
// The app already answers three narrower questions:
//   • /rankings    — does this stock have a historical edge THIS month?
//   • /swing-low   — is it sitting on a floor that has actually held before?
//   • /early-entry — is now a sensible moment, and does the setup pass its
//                    pre-trade checks?
//
// Each is a partial view, and the honest answer to "what should I trade" is the
// handful of names where all three agree. This scores that agreement.
//
// THE ONE THING THIS MUST NOT DO is double-count. Rankings and early-entry both
// read seasonality from the same snapshot, so blending their scores would weigh
// the same evidence twice and make a seasonally-strong name look confirmed by
// two independent sources when it isn't. The components below are therefore cut
// by EVIDENCE TYPE, not by which screen they came from:
//
//   EDGE      (45%) — seasonality + statistical significance.   Rankings.
//   STRUCTURE (30%) — floor quality, bounce history, reward:risk. Swing-low.
//   TIMING    (25%) — checklist, distance to entry, momentum.    Early-entry.
//
// Each is computed from a different underlying measurement, so a stock scoring
// well on all three genuinely has three separate reasons to like it. Confluence
// is then rewarded on top, modestly — appearing in more than one screener is
// corroboration, not a multiplier on the edge itself.
// ─────────────────────────────────────────────────────────────────────────────

export const WEIGHTS = { edge: 0.45, structure: 0.3, timing: 0.25 };

/** A trade has to clear all of these before it can be recommended at all. */
export const GATES = {
  minYears: 5,
  minRiskReward: 1.2,
  minConviction: 45,
};

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;

// ── EDGE — is there a historical edge this month? ────────────────────────────
// Weighted toward win rate and sample size rather than headline return: a big
// median on six years is a smaller claim than a modest one on eighteen.
export function scoreEdge(r) {
  if (!r) return { score: 0, notes: [] };
  const notes = [];
  const wr = r.win_rate ?? 0;
  const med = r.median_return ?? 0;
  const years = (r.positive_years ?? 0) + (r.negative_years ?? 0);
  const sig = r.sig;

  const wrPts = wr >= 90 ? 40 : wr >= 85 ? 34 : wr >= 80 ? 28 : wr >= 75 ? 18 : wr >= 65 ? 8 : 0;
  const medPts = med >= 9 ? 25 : med >= 7 ? 20 : med >= 5 ? 14 : med >= 3 ? 8 : med > 0 ? 2 : 0;
  const yrPts = years >= 15 ? 20 : years >= 10 ? 15 : years >= 7 ? 9 : years >= 5 ? 4 : 0;
  // Significance is evidence the edge isn't noise — worth real weight, but it
  // can't carry a stock on its own.
  const sigPts = sig?.significant ? 15 : sig && sig.p < 0.1 ? 8 : 0;

  if (wrPts >= 28) notes.push(`${wr.toFixed(0)}% win rate over ${years} years`);
  if (medPts >= 14) notes.push(`median ${med > 0 ? "+" : ""}${med.toFixed(1)}% for the month`);
  if (sig?.significant) notes.push(`statistically significant (p=${sig.p.toFixed(3)})`);
  else if (sig && sig.p < 0.1) notes.push(`near-significant (p=${sig.p.toFixed(2)})`);

  return { score: clamp(wrPts + medPts + yrPts + sigPts), notes, years };
}

// ── STRUCTURE — is the price at a place worth buying? ────────────────────────
// Swing-low's floor evidence is the strongest input here. A stock absent from
// that screener can still score, but only from reward:risk, so it caps low —
// which is correct: we have no structural evidence for it.
export function scoreStructure(sl, levels) {
  const notes = [];
  let score = 0;

  if (sl) {
    const tier = (sl.tier ?? "").toUpperCase();
    score += tier === "PRIME" ? 40 : tier === "STRONG" ? 28 : tier === "WATCH" ? 15 : 0;

    const touches = sl.floor?.touches ?? 0;
    score += touches >= 6 ? 20 : touches >= 4 ? 15 : touches >= 2 ? 8 : 0;
    if (touches >= 4) notes.push(`floor tested ${touches} times`);

    // Bounce rate is a 0–1 ratio from the engine.
    const rate = sl.bounceRate ?? 0;
    const samples = sl.bounceSamples ?? 0;
    score += rate >= 0.6 && samples >= 3 ? 20 : rate >= 0.5 && samples >= 2 ? 12 : samples >= 1 ? 5 : 0;
    if (samples >= 2 && rate >= 0.5) {
      notes.push(`bounced ${Math.round(rate * 100)}% of the time (n=${samples})`);
    }
    if (sl.rsi != null && sl.rsi <= 40) notes.push(`oversold, RSI ${sl.rsi.toFixed(0)}`);
  }

  const rr = levels?.riskReward ?? 0;
  score += rr >= 2.5 ? 20 : rr >= 2 ? 15 : rr >= 1.5 ? 10 : rr >= 1 ? 5 : 0;
  if (rr >= 1.5) notes.push(`${rr.toFixed(1)}× reward for the risk`);

  return { score: clamp(score), notes, inSwingLow: Boolean(sl) };
}

// ── TIMING — is now the moment? ──────────────────────────────────────────────
// The checklist is the same one /early-entry runs (app/lib/checklist.js), so a
// setup can't pass here and fail there.
export function scoreTiming(checklist, levels, context) {
  const notes = [];
  let score = 0;

  const result = checklist?.result;
  score += result === "PASS" ? 35 : result === "CAUTION" ? 18 : 0;
  if (result === "PASS") notes.push("passes every pre-trade check");
  else if (result === "CAUTION") notes.push(`${checklist.passCount}/${checklist.totalChecks} checks passed`);

  // How far above the stop's anchor price are we? Close to structure is a
  // better entry than extended above it.
  const anchor = levels?.stop?.anchorPrice;
  const entry = levels?.entry?.price;
  if (anchor && entry) {
    const distPct = ((entry - anchor) / entry) * 100;
    score += distPct <= 2 ? 30 : distPct <= 4 ? 22 : distPct <= 7 ? 14 : distPct <= 12 ? 6 : 0;
    // Whenever this scores, say why. A component that adds points silently is
    // just an unexplained number on the card.
    if (distPct <= 2) notes.push(`sitting right on its support (${distPct.toFixed(1)}% above)`);
    else if (distPct <= 4) notes.push(`${distPct.toFixed(1)}% above its support — near the entry zone`);
    else if (distPct <= 7) notes.push(`${distPct.toFixed(1)}% above its support`);
  }

  // Not falling hard. A knife still dropping is a worse entry than one basing.
  const mom = context?.momentum;
  if (mom != null) {
    score += mom >= -1 && mom <= 6 ? 20 : mom > 6 ? 10 : mom >= -4 ? 8 : 0;
    if (mom >= -1 && mom <= 6) notes.push("price is basing rather than falling");
  }

  // A target that isn't already half-reached.
  if (levels?.target && entry && levels.target.price > entry) {
    const upside = levels.target.pct ?? 0;
    score += upside >= 8 ? 15 : upside >= 5 ? 10 : upside >= 3 ? 5 : 0;
  }

  return { score: clamp(score), notes };
}

/**
 * Blend the three lenses into one conviction score.
 *
 * `sources` is how many of the three screeners actually surfaced this name.
 * Corroboration earns a small bonus — it is a sanity check on the blend, not a
 * fourth source of edge, so it stays deliberately modest.
 */
export function convictionOf({ edge, structure, timing, sources }) {
  const base =
    WEIGHTS.edge * edge.score + WEIGHTS.structure * structure.score + WEIGHTS.timing * timing.score;
  const confluence = sources >= 3 ? 1.1 : sources === 2 ? 1.05 : 1;
  return round1(clamp(base * confluence));
}

/** Conviction band, for the badge. */
export function bandOf(score) {
  if (score >= 75) return "HIGH";
  if (score >= 60) return "GOOD";
  if (score >= GATES.minConviction) return "FAIR";
  return "LOW";
}

/**
 * Why this trade, in plain sentences.
 *
 * Ordered strongest-lens-first, so the headline reason is whichever evidence is
 * actually carrying the pick rather than a fixed template.
 */
export function reasonsFor({ edge, structure, timing, levels, sources }) {
  const ranked = [
    { key: "edge", s: edge },
    { key: "structure", s: structure },
    { key: "timing", s: timing },
  ].sort((a, b) => b.s.score - a.s.score);

  const reasons = [];
  for (const { s } of ranked) reasons.push(...s.notes);

  if (sources >= 3) {
    reasons.unshift("Flagged by all three screeners — seasonality, floor and timing agree");
  } else if (sources === 2) {
    reasons.unshift("Flagged by two screeners independently");
  }

  // The risk caveat is the one line that must never be the thing truncated, so
  // it is appended AFTER trimming rather than before — appending first meant a
  // stock with six good reasons silently dropped its own warning.
  const caveat = levels?.stop?.exceedsSeasonalRisk
    ? `Stop is wider than this month usually moves (${levels.stop.pct}% vs ${levels.stop.seasonalRiskNormPct}%) — size down`
    : null;

  const trimmed = reasons.slice(0, caveat ? 5 : 6);
  return caveat ? [...trimmed, caveat] : trimmed;
}

/**
 * Rank candidates and keep the ones worth showing.
 *
 * Everything that fails a gate is returned separately with the reason, because
 * "why isn't X here?" is a question the screen should be able to answer.
 */
export function buildPlaybook(candidates, { top = 6 } = {}) {
  const rejected = [];
  const passed = [];

  for (const cand of candidates) {
    const why = [];
    if ((cand.edge.years ?? 0) < GATES.minYears) why.push(`only ${cand.edge.years ?? 0}y of history`);
    if (!cand.levels) why.push("no live price levels");
    else {
      if ((cand.levels.riskReward ?? 0) < GATES.minRiskReward) {
        why.push(`reward:risk ${(cand.levels.riskReward ?? 0).toFixed(1)}× below ${GATES.minRiskReward}×`);
      }
      if (!cand.levels.target || cand.levels.target.price <= cand.levels.entry.price) {
        why.push("no upside to target");
      }
    }
    if (cand.conviction < GATES.minConviction) why.push(`conviction ${cand.conviction} below ${GATES.minConviction}`);

    if (why.length) rejected.push({ symbol: cand.symbol, conviction: cand.conviction, why });
    else passed.push(cand);
  }

  passed.sort((a, b) => b.conviction - a.conviction);
  return { picks: passed.slice(0, top), rejected: rejected.slice(0, 20), considered: candidates.length };
}

/**
 * Ration lots across the picks against real capital.
 *
 * Conviction decides the order and the base size; capital decides how far down
 * the list you actually get. Anything that doesn't fit is reported rather than
 * silently dropped.
 */
export function allocateCapital(picks, { capital, reserve, avgLotCost = 150000, maxPositions = 6 }) {
  const usable = Math.max(0, capital - reserve);
  let remaining = usable;

  const sized = picks.slice(0, maxPositions).map((p) => {
    const lotSize = p.levels?.lotSize ?? p.lotSize ?? 0;
    const entry = p.levels?.entry?.price ?? 0;

    // NOTIONAL is the contract's face value; MARGIN is what it actually ties up.
    // Futures are leveraged — TVSMOTOR is 700 × ₹4,307 = ₹30.1L of notional on
    // roughly ₹1.5L of margin — so budgeting against notional makes every trade
    // look unaffordable. `avgLotCost` is the user's own statement of what a lot
    // costs them, which is the margin figure, so that is what capital is
    // rationed against. Notional rides along for exposure.
    const notional = lotSize && entry ? lotSize * entry : 0;
    const lotCost = avgLotCost > 0 ? avgLotCost : notional;

    // Conviction sets the ambition: high conviction earns up to 2 lots, the
    // rest 1. Capital then decides whether that is affordable.
    const wanted = p.conviction >= 75 ? 2 : 1;
    let lots = 0;
    if (lotCost > 0) {
      lots = Math.min(wanted, Math.floor(remaining / lotCost));
      remaining -= lots * lotCost;
    }

    const deployed = lots * lotCost;
    const riskPerLot =
      p.levels && lotSize ? (p.levels.entry.price - p.levels.stop.price) * lotSize : 0;

    return {
      ...p,
      lots,
      wantedLots: wanted,
      lotCost: Math.round(lotCost),
      notionalPerLot: Math.round(notional),
      notional: Math.round(notional * lots),
      capitalUsed: Math.round(deployed),
      riskAmount: Math.round(riskPerLot * lots),
      rewardAmount:
        p.levels?.target && lotSize
          ? Math.round((p.levels.target.price - p.levels.entry.price) * lotSize * lots)
          : 0,
      affordable: lots > 0,
    };
  });

  const deployed = sized.reduce((a, p) => a + p.capitalUsed, 0);
  const notional = sized.reduce((a, p) => a + p.notional, 0);
  const totalRisk = sized.reduce((a, p) => a + p.riskAmount, 0);
  const totalReward = sized.reduce((a, p) => a + p.rewardAmount, 0);

  return {
    positions: sized,
    usable,
    deployed,
    dryPowder: Math.max(0, usable - deployed),
    deployedPct: usable > 0 ? Math.round((deployed / usable) * 100) : 0,
    /** Face value of the contracts — the exposure behind the margin. */
    notional,
    totalRisk,
    totalReward,
    // Risk as a share of the whole account is the number that actually matters
    // when deciding whether this plan is too aggressive.
    riskPctOfCapital: capital > 0 ? round1((totalRisk / capital) * 100) : 0,
    unaffordable: sized.filter((p) => !p.affordable).map((p) => p.symbol),
  };
}
