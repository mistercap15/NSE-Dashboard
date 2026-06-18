// ── Portfolio construction ───────────────────────────────────────────────────
// Given a set of picks, builds a correlation matrix, flags concentration, and
// sizes positions by inverse-volatility (risk parity) so no single name or
// cluster dominates the book. All derived from the full-history snapshot.

import { pearson, stdDev, sanitizeReturns, RETURN_SANITY_CAP, mean } from "./stats";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Aligned, sanitized return pairs over the months both stocks traded.
function alignedPair(mapA, mapB) {
  const a = [], b = [];
  for (const ym of Object.keys(mapA)) {
    if (!(ym in mapB)) continue;
    const ra = mapA[ym], rb = mapB[ym];
    if (Math.abs(ra) > RETURN_SANITY_CAP || Math.abs(rb) > RETURN_SANITY_CAP) continue;
    a.push(ra); b.push(rb);
  }
  return [a, b];
}

export function analyzePortfolio(universe, { symbols, capital = 1000000, riskPct = 1 }) {
  // Drop symbols with no/insufficient history so they don't distort weights.
  const excluded = [];
  const items = [];
  for (const sym of symbols) {
    const r = universe.series[sym];
    const rets = r ? sanitizeReturns(r.points.map(p => p.ret)) : [];
    if (rets.length < 6) { excluded.push(sym); continue; }
    const map = {};
    for (const p of r.points) map[p.ym] = p.ret;
    const vol = stdDev(rets) * Math.sqrt(12); // annualized monthly vol (%)
    items.push({ symbol: r.symbol, sector: r.sector, lotSize: r.lotSize, map, vol, avgMonth: mean(rets) });
  }
  const n = items.length;
  if (n === 0) return null;

  // Inverse-volatility (risk-parity) weights
  const invs = items.map(x => (x.vol > 0 ? 1 / x.vol : 0));
  const sumInv = invs.reduce((a, b) => a + b, 0) || 1;
  items.forEach((x, i) => {
    x.weight = invs[i] / sumInv;
    x.alloc = Math.round(capital * x.weight);
  });

  // Correlation matrix + summary
  const matrix = Array.from({ length: n }, () => Array(n).fill(1));
  let pairSum = 0, pairCount = 0;
  const highPairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [a, b] = alignedPair(items[i].map, items[j].map);
      const r = pearson(a, b);
      matrix[i][j] = matrix[j][i] = Number(r.toFixed(2));
      pairSum += r; pairCount++;
      if (r >= 0.6) highPairs.push({ a: items[i].symbol, b: items[j].symbol, r: Number(r.toFixed(2)) });
    }
  }
  const avgCorr = pairCount ? pairSum / pairCount : 0;

  // Sector concentration (by weight)
  const sectorWeight = {};
  for (const x of items) sectorWeight[x.sector] = (sectorWeight[x.sector] || 0) + x.weight;
  const topSector = Object.entries(sectorWeight).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const uniqueSectors = Object.keys(sectorWeight).length;

  // Diversification score (0-100): low average correlation + sector spread
  const corrScore = (1 - avgCorr) / 2 * 100;       // avgCorr 0 → 50, -1 → 100, 1 → 0
  const sectorScore = (uniqueSectors / n) * 100;
  const diversification = Math.round(clamp(0.7 * corrScore + 0.3 * sectorScore, 0, 100));

  // Flags
  const flags = [];
  highPairs.sort((a, b) => b.r - a.r).slice(0, 3).forEach(p =>
    flags.push(`${p.a} & ${p.b} move together (r=${p.r}) — overlapping bet`));
  if (topSector[1] > 0.4) flags.push(`${Math.round(topSector[1] * 100)}% of capital in ${topSector[0]} — sector-concentrated`);
  if (avgCorr > 0.4) flags.push(`High average correlation (${avgCorr.toFixed(2)}) — basket behaves like one position`);
  if (!flags.length) flags.push("Well diversified — low cross-correlation and spread across sectors");

  const riskBudget = Math.round(capital * (riskPct / 100));

  // ── Portfolio-level risk (monthly), accounting for correlation ───────────────
  // Monthly vol per name (un-annualized) and weights → portfolio variance wᵀΣw.
  const wv = items.map((x, i) => ({ w: x.weight, volM: x.vol / Math.sqrt(12) }));
  let variance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      variance += wv[i].w * wv[j].w * wv[i].volM * wv[j].volM * matrix[i][j];
    }
  }
  const portMonthlyVol = Math.sqrt(Math.max(variance, 0));            // % monthly
  const portExpMonthly = items.reduce((a, x) => a + x.weight * x.avgMonth, 0); // % monthly
  // Naive (no-correlation) vol for comparison — shows the diversification benefit
  const naiveVol = Math.sqrt(wv.reduce((a, x) => a + (x.w * x.volM) ** 2, 0));
  // 95% monthly VaR (parametric, 1.65σ) as a positive loss number
  const var95Pct = Math.max(0, 1.65 * portMonthlyVol - portExpMonthly);

  const risk = {
    expMonthlyPct: Number(portExpMonthly.toFixed(2)),
    volMonthlyPct: Number(portMonthlyVol.toFixed(2)),
    volAnnualPct: Number((portMonthlyVol * Math.sqrt(12)).toFixed(1)),
    diversificationBenefitPct: naiveVol > 0 ? Number(((1 - portMonthlyVol / naiveVol) * 100).toFixed(0)) : 0,
    var95Pct: Number(var95Pct.toFixed(2)),
    var95Amount: Math.round(capital * (var95Pct / 100)),
    expMonthlyAmount: Math.round(capital * (portExpMonthly / 100)),
  };

  return {
    capital,
    riskPct,
    riskBudget,
    excluded,
    risk,
    diversification,
    avgCorr: Number(avgCorr.toFixed(2)),
    symbols: items.map(x => x.symbol),
    items: items.map(x => ({
      symbol: x.symbol,
      sector: x.sector,
      vol: Number(x.vol.toFixed(1)),
      weight: Number((x.weight * 100).toFixed(1)),
      alloc: x.alloc,
    })).sort((a, b) => b.weight - a.weight),
    matrix,
    flags,
  };
}
