// ── Walk-forward seasonal backtest ───────────────────────────────────────────
// Strictly lookahead-free: for each (year, month), stocks are ranked by their
// seasonal mean return for that calendar month using ONLY data from prior years
// (expanding window). We then take the realized return of the top-N basket.
// Benchmark = equal-weight return of the whole tradable universe that month.

import { performanceStats, mean, RETURN_SANITY_CAP } from "./stats";
import { monthReturns, returnAt } from "./dataset";

export function runBacktest(universe, { direction = "LONG", topN = 5, startYear, minHistory = 3 } = {}) {
  const { symbols, series, minYear, maxYear } = universe;
  const sy = startYear || minYear + 5;
  const dir = direction.toUpperCase();

  const months = [];

  for (let Y = sy; Y <= maxYear; Y++) {
    for (let M = 1; M <= 12; M++) {
      const scored = [];
      const realizedAll = [];

      for (const sym of symbols) {
        const pts = series[sym].points;
        const realized = returnAt(pts, Y, M);
        // Need a clean, tradable realized return for this month
        if (realized === null || !Number.isFinite(realized) || Math.abs(realized) > RETURN_SANITY_CAP) continue;
        const hist = monthReturns(pts, M, Y); // prior years only
        if (hist.length < minHistory) continue;
        scored.push({ sym, score: mean(hist), realized });
        realizedAll.push(realized);
      }

      if (scored.length < topN) continue; // insufficient breadth (warmup years)

      const benchmark = mean(realizedAll);
      const longBasket  = [...scored].sort((a, b) => b.score - a.score).slice(0, topN);
      const shortBasket = [...scored].sort((a, b) => a.score - b.score).slice(0, topN);

      let ret;
      if (dir === "LONG")        ret = mean(longBasket.map(p => p.realized));
      else if (dir === "SHORT")  ret = mean(shortBasket.map(p => -p.realized));
      else /* LS */              ret = 0.5 * mean(longBasket.map(p => p.realized)) + 0.5 * mean(shortBasket.map(p => -p.realized));

      months.push({
        ym: `${Y}-${String(M).padStart(2, "0")}`,
        ret,
        benchmark,
        longSymbols:  longBasket.map(p => p.sym),
        shortSymbols: shortBasket.map(p => p.sym),
      });
    }
  }

  const rets      = months.map(m => m.ret);
  const benchRets = months.map(m => m.benchmark);
  const stats      = performanceStats(rets);
  const benchStats = performanceStats(benchRets);

  // Equity curves aligned to months (both start at 100)
  const curve = months.map((m, i) => ({
    ym: m.ym,
    equity: Number(stats.curve[i].toFixed(2)),
    benchmark: Number(benchStats.curve[i].toFixed(2)),
  }));

  // Calendar-year compounded returns
  const byYear = {};
  for (const m of months) (byYear[m.ym.slice(0, 4)] ||= []).push(m.ret);
  const yearly = Object.entries(byYear).map(([year, rs]) => ({
    year,
    ret: Number(((rs.reduce((a, r) => a * (1 + r / 100), 1) - 1) * 100).toFixed(2)),
  }));

  // Most recent month's basket (what it would trade now)
  const latest = months.at(-1) || null;

  return {
    params: { direction: dir, topN, startYear: sy, minHistory },
    stats,
    benchStats,
    curve,
    yearly,
    latest,
    coverage: { from: months[0]?.ym || null, to: latest?.ym || null, months: months.length },
  };
}
