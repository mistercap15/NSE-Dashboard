// ── Statistics toolkit ───────────────────────────────────────────────────────
// Pure functions for the institutional-grade analytics: significance testing,
// confidence intervals, backtest performance metrics, and correlation.
// No dependencies — safe to import on server or client.

// Monthly stock returns above this magnitude (%) are treated as data errors
// (corporate-action / listing artifacts, e.g. a fake +555,900% month) and dropped.
export const RETURN_SANITY_CAP = 150;

export function sanitizeReturns(returns) {
  return returns.filter(r => r !== null && r !== undefined && Number.isFinite(r) && Math.abs(r) <= RETURN_SANITY_CAP);
}

// ── Descriptive stats ────────────────────────────────────────────────────────
export function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Simple moving average of the last `period` values (null if too short)
export function sma(xs, period) {
  if (!xs || xs.length < period) return null;
  const slice = xs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Sample standard deviation (n-1)
export function stdDev(xs) {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
}

// ── Student's t-distribution ───────────────────────────────────────────────────
// Regularized incomplete beta function (Numerical Recipes), used for the t CDF.
function betacf(a, b, x) {
  const FPMIN = 1e-30;
  let qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-7) break;
  }
  return h;
}

function gammaln(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

// Two-sided p-value for a t-statistic with df degrees of freedom.
export function tDistPValue(t, df) {
  if (df <= 0) return 1;
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5); // already two-sided
}

// Critical t value for a two-sided confidence level (default 95%), via bisection.
export function tCritical(df, conf = 0.95) {
  if (df <= 0) return 0;
  const targetP = 1 - conf;            // two-sided tail
  let lo = 0, hi = 1000;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (tDistPValue(mid, df) > targetP) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── Significance of a series of returns (is mean ≠ 0?) ─────────────────────────
// Returns { n, mean, std, median, t, p, ciLow, ciHigh, significant }
export function significance(rawReturns, conf = 0.95) {
  const xs = sanitizeReturns(rawReturns);
  const n = xs.length;
  const m = mean(xs);
  const sd = stdDev(xs);
  if (n < 3 || sd === 0) {
    return { n, mean: m, std: sd, median: median(xs), t: 0, p: 1, ciLow: m, ciHigh: m, significant: false };
  }
  const se = sd / Math.sqrt(n);
  const t = m / se;
  const df = n - 1;
  const p = tDistPValue(t, df);
  const tc = tCritical(df, conf);
  return {
    n, mean: m, std: sd, median: median(xs),
    t, p,
    ciLow: m - tc * se,
    ciHigh: m + tc * se,
    significant: p < (1 - conf),
  };
}

// ── Backtest performance metrics ───────────────────────────────────────────────
// All take an array of periodic (monthly) returns in PERCENT.

export function totalReturn(monthlyPct) {
  return (monthlyPct.reduce((acc, r) => acc * (1 + r / 100), 1) - 1) * 100;
}

export function equityCurve(monthlyPct, start = 100) {
  let eq = start;
  return monthlyPct.map(r => (eq = eq * (1 + r / 100)));
}

export function cagr(monthlyPct) {
  const years = monthlyPct.length / 12;
  if (years <= 0) return 0;
  const growth = monthlyPct.reduce((acc, r) => acc * (1 + r / 100), 1);
  if (growth <= 0) return -100;
  return (growth ** (1 / years) - 1) * 100;
}

// Annualized Sharpe (rf = 0)
export function sharpe(monthlyPct) {
  const sd = stdDev(monthlyPct);
  if (sd === 0) return 0;
  return (mean(monthlyPct) / sd) * Math.sqrt(12);
}

// Annualized Sortino (downside deviation, rf = 0)
export function sortino(monthlyPct) {
  const downs = monthlyPct.filter(r => r < 0);
  if (!downs.length) return mean(monthlyPct) > 0 ? Infinity : 0;
  const dd = Math.sqrt(downs.reduce((a, r) => a + r * r, 0) / monthlyPct.length);
  if (dd === 0) return 0;
  return (mean(monthlyPct) / dd) * Math.sqrt(12);
}

// Max drawdown (%) from an equity curve
export function maxDrawdown(curve) {
  let peak = -Infinity, maxDD = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

export function profitFactor(monthlyPct) {
  const gains = monthlyPct.filter(r => r > 0).reduce((a, r) => a + r, 0);
  const losses = Math.abs(monthlyPct.filter(r => r < 0).reduce((a, r) => a + r, 0));
  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

export function winRate(monthlyPct) {
  if (!monthlyPct.length) return 0;
  return (monthlyPct.filter(r => r > 0).length / monthlyPct.length) * 100;
}

// Bundle of metrics for a return stream
export function performanceStats(monthlyPct) {
  const curve = equityCurve(monthlyPct);
  return {
    months: monthlyPct.length,
    totalReturn: totalReturn(monthlyPct),
    cagr: cagr(monthlyPct),
    sharpe: sharpe(monthlyPct),
    sortino: sortino(monthlyPct),
    maxDrawdown: maxDrawdown(curve),
    profitFactor: profitFactor(monthlyPct),
    winRate: winRate(monthlyPct),
    avgMonth: mean(monthlyPct),
    bestMonth: monthlyPct.length ? Math.max(...monthlyPct) : 0,
    worstMonth: monthlyPct.length ? Math.min(...monthlyPct) : 0,
    curve,
  };
}

// ── Correlation ────────────────────────────────────────────────────────────────
// Pearson correlation of two equal-length arrays (caller aligns them).
export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const xa = a.slice(0, n), xb = b.slice(0, n);
  const ma = mean(xa), mb = mean(xb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = xa[i] - ma, y = xb[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}
