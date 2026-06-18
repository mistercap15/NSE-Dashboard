// ── AI Suggestion engine ───────────────────────────────────────────────────
// Rule-based multi-factor conviction model. Takes the monthly ranking data
// (already fetched by the rankings page) and returns the handful of stocks
// actually worth trading — both LONG and SHORT — with a generated rationale.
// 100% client-side: instant, free, no API key.

import { MONTH_FULL } from "./api";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Derive years of history (mirrors RankingsTable / rankings page logic)
export function stockYears(s) {
  return s.win_rate > 0
    ? Math.round((s.positive_years || 0) / (s.win_rate / 100))
    : Math.round((s.data_points || 0) / 12);
}

function confidenceLabel(years) {
  if (years >= 15) return "High";
  if (years >= 8)  return "Medium";
  return "Low";
}

// ── LONG scoring ─────────────────────────────────────────────────────────────
function scoreLong(s) {
  const years = stockYears(s);
  const wr    = s.win_rate || 0;
  const avg   = s.avg_return || 0;
  const med   = (s.median_return ?? avg);
  const worst = s.worst || 0;

  // 1. Seasonal probability — how often this month closes green (0-100)
  const probScore = wr;

  // 2. Reliability — more years of data = more trustworthy (15+ yrs = full marks)
  const reliability = clamp(years / 15, 0, 1) * 100;

  // 3. Consistency — median should be healthy AND close to/above the average,
  //    so the edge isn't driven by one freak year.
  const medianHealth   = clamp(50 + med * 12, 0, 100);          // med +4% ≈ 98
  const outlierFactor  = avg > 0 ? clamp(med / avg, 0, 1) : 0.5; // med ≥ avg ⇒ 1
  const consistency    = medianHealth * (0.6 + 0.4 * outlierFactor);

  // 4. Risk / reward — average gain vs the worst month ever seen
  const downside = Math.abs(worst) || 1;
  const rr       = avg / downside;
  const rrScore  = clamp(rr * 60 + 30, 0, 100);                 // rr 0.5 ⇒ 60

  const conviction =
    0.42 * probScore +
    0.18 * reliability +
    0.22 * consistency +
    0.18 * rrScore;

  return { conviction, years, factors: { probScore, reliability, consistency, rrScore } };
}

// ── SHORT scoring ────────────────────────────────────────────────────────────
function scoreShort(s) {
  const years     = stockYears(s);
  const wr        = s.win_rate || 0;
  const shortProb = (s.short_win_prob ?? (100 - wr));
  const avg       = s.avg_return || 0;   // negative ⇒ good for a short
  const med       = (s.median_return ?? avg);
  const best      = s.best || 0;         // big positive month ⇒ squeeze risk

  // 1. Probability the short closes in profit
  const probScore = shortProb;

  // 2. Reliability
  const reliability = clamp(years / 15, 0, 1) * 100;

  // 3. Edge — how negative the typical return is
  const edgeScore = clamp(50 + (-avg) * 12 + (-med) * 6, 0, 100);

  // 4. Squeeze safety — a large best-month is dangerous for a short
  const squeezeScore = 100 - (clamp(best, 0, 30) / 30) * 100;

  const conviction =
    0.42 * probScore +
    0.18 * reliability +
    0.22 * edgeScore +
    0.18 * squeezeScore;

  return { conviction, years, factors: { probScore, reliability, edgeScore, squeezeScore } };
}

// ── Rationale builders ───────────────────────────────────────────────────────
function longReasons(s, years) {
  const wr    = s.win_rate || 0;
  const avg   = s.avg_return || 0;
  const med   = (s.median_return ?? avg);
  const worst = s.worst || 0;
  const r = [];

  if (wr === 100)      r.push(`Never closed red this month in ${years} yrs`);
  else if (wr >= 85)   r.push(`Wins ~${Math.round(wr / 10)} of 10 years (${wr.toFixed(0)}%)`);
  else                 r.push(`${wr.toFixed(0)}% win rate`);

  if (avg > 0 && med >= avg)        r.push("Median ≥ average — gains are consistent");
  else if (avg > 0 && med < avg * 0.5) r.push("⚠ Average inflated by outliers");

  if (years >= 15)      r.push(`Deep history (${years} yrs)`);
  else if (years < 8)   r.push(`⚠ Only ${years} yrs of data`);

  if (avg / (Math.abs(worst) || 1) >= 0.6) r.push("Strong reward vs downside");
  return r;
}

function shortReasons(s, years) {
  const wr        = s.win_rate || 0;
  const shortProb = (s.short_win_prob ?? (100 - wr));
  const avg       = s.avg_return || 0;
  const best      = s.best || 0;
  const r = [];

  if (wr === 0)        r.push(`Never closed green this month in ${years} yrs`);
  else                 r.push(`${shortProb.toFixed(0)}% short win probability`);

  if (avg < 0)         r.push(`Avg ${avg.toFixed(1)}% — historically falls`);
  if (years >= 15)     r.push(`Deep history (${years} yrs)`);
  else if (years < 8)  r.push(`⚠ Only ${years} yrs of data`);

  if (best <= 8)       r.push("Low squeeze risk");
  else if (best >= 15) r.push(`⚠ Squeeze risk (best month +${best.toFixed(0)}%)`);
  return r;
}

// Suggested protective stop (% from entry), derived from history
function longStop(s)  { return clamp(Math.abs(s.worst || 0) * 0.5, 3, 12); }
function shortStop(s) { return s.short_sl_pct ?? clamp(Math.abs(s.best || 0) * 1.0, 4, 15); }

// Statistical significance multiplier on conviction. A proven edge (p<0.05) is
// trusted in full; an unproven one is discounted; unknown gets a mild haircut.
function sigFactor(sig) {
  if (!sig) return 0.92;
  return sig.significant ? 1.0 : 0.80;
}
function sigReason(sig) {
  if (!sig) return null;
  if (sig.significant) return `Statistically significant (p${sig.p < 0.01 ? "<0.01" : "<0.05"})`;
  return "⚠ Not statistically significant";
}

// Trend confirmation: reward picks that agree with the 10-month trend, penalize
// those fighting it (a seasonal long below trend, or a short in an uptrend).
function trendFactor(direction, trend) {
  if (!trend) return 1.0;
  const aligned = direction === "LONG" ? trend.above : !trend.above;
  return aligned ? 1.05 : 0.85;
}
function trendReason(direction, trend) {
  if (!trend) return null;
  const aligned = direction === "LONG" ? trend.above : !trend.above;
  if (direction === "LONG")
    return aligned ? "Confirmed by uptrend (above 10-mo MA)" : "⚠ Below 10-mo trend — fighting the tape";
  return aligned ? "Confirmed by downtrend (below 10-mo MA)" : "⚠ In an uptrend — squeeze risk";
}

// ── Public API ───────────────────────────────────────────────────────────────
export function getAISuggestions(data, { month, minYears = 0, count = 5 } = {}) {
  if (!data) return null;

  const yearsOk = (s) => minYears <= 0 || stockYears(s) >= minYears;

  // How many stocks the scan considered (for the analyzing animation)
  const scanned = (data.top_stocks || []).length + (data.avoid_stocks || []).length;

  // LONG: from top_stocks, require a real seasonal edge
  const longs = (data.top_stocks || [])
    .filter(yearsOk)
    .filter(s => (s.win_rate || 0) >= 60 && (s.avg_return || 0) > 0)
    .map(s => {
      const { conviction: base, years, factors } = scoreLong(s);
      const conviction = clamp(base * sigFactor(s.sig) * trendFactor("LONG", s.trend), 0, 100);
      const reasons = longReasons(s, years);
      const sr = sigReason(s.sig);
      if (sr) reasons.push(sr);
      const tr = trendReason("LONG", s.trend);
      if (tr) reasons.push(tr);
      return {
        ...s,
        direction: "LONG",
        conviction,
        confidence: confidenceLabel(years),
        years,
        factors,
        reasons,
        stopPct: longStop(s),
        summary: `Buy ${s.symbol} — ${(s.win_rate || 0).toFixed(0)}% win rate, avg +${(s.avg_return || 0).toFixed(1)}% in ${MONTH_FULL[month - 1]}.`,
      };
    })
    .sort((a, b) => b.conviction - a.conviction)
    .slice(0, count);

  // SHORT: from short_candidates, require a real downside edge
  const shorts = (data.short_candidates || [])
    .filter(yearsOk)
    .filter(s => (s.short_win_prob ?? (100 - (s.win_rate || 0))) >= 55)
    .map(s => {
      const { conviction: base, years, factors } = scoreShort(s);
      const conviction = clamp(base * sigFactor(s.sig) * trendFactor("SHORT", s.trend), 0, 100);
      const reasons = shortReasons(s, years);
      const sr = sigReason(s.sig);
      if (sr) reasons.push(sr);
      const tr = trendReason("SHORT", s.trend);
      if (tr) reasons.push(tr);
      return {
        ...s,
        direction: "SHORT",
        conviction,
        confidence: confidenceLabel(years),
        years,
        factors,
        reasons,
        stopPct: shortStop(s),
        summary: `Short ${s.symbol} — ${(s.short_win_prob ?? (100 - (s.win_rate || 0))).toFixed(0)}% short-win probability, avg ${(s.avg_return || 0).toFixed(1)}% in ${MONTH_FULL[month - 1]}.`,
      };
    })
    .sort((a, b) => b.conviction - a.conviction)
    .slice(0, count);

  // Single highest-conviction trade across both directions
  const best = [longs[0], shorts[0]]
    .filter(Boolean)
    .sort((a, b) => b.conviction - a.conviction)[0] || null;

  return {
    month,
    monthName: MONTH_FULL[month - 1],
    best,
    longs,
    shorts,
    scanned,
    regime: data.regime || null,
    calendar: data.calendar || null,
    generatedAt: new Date(),
  };
}
