"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import { MONTH_FULL } from "../lib/api";
import { getNextMonth } from "../lib/date";

// ─────────────────────────────────────────────────────────────────────────────
// Position-sizing engine for the seasonal futures system.
// Recommends 1/2/3 lots per stock from a conviction score, applies hard risk
// caps, then rations lots against real usable capital. All logic is pure and
// lives in scoreStock() + allocateLots() so the thresholds are easy to tweak.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = { capital: 1500000, reserve: 250000, avgLotCost: 150000 };

// Format a number as Indian-grouped rupees.
const fmtINR = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

// SSR-safe lazy initializer for a persisted numeric setting.
const readNum = (key, fallback) => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) ? n : fallback;
};

// Data-years derivation — identical to rankings/page.js.
function deriveYears(s) {
  if (s.win_rate > 0) return Math.round((s.positive_years || 0) / (s.win_rate / 100));
  return Math.round((s.data_points || 0) / 12);
}

// A live price may or may not ride along on /api/rankings. Probe a few likely
// field names; return null when none is a usable positive number.
function priceOf(s) {
  const p = s.price ?? s.last_price ?? s.ltp ?? s.close ?? null;
  return Number.isFinite(p) && p > 0 ? p : null;
}

// ── Conviction score (0–100) + base lots + hard risk caps ────────────────────
// Four weighted components. Adjust thresholds/points inline to retune.
function scoreStock(s) {
  const years = deriveYears(s);
  const wr    = s.win_rate ?? 0;
  const med   = s.median_return ?? 0;
  const worst = s.worst ?? 0;

  // Win rate — dominant signal (max 40)
  const wrPts    = wr >= 90 ? 40 : wr >= 85 ? 35 : wr >= 80 ? 30 : wr >= 75 ? 18 : 5;
  // Median return — typical-year edge, outlier-resistant (max 25)
  const medPts   = med >= 9 ? 25 : med >= 7 ? 20 : med >= 5 ? 15 : 5;
  // Data years — sample size / reliability (max 20)
  const yrPts    = years >= 15 ? 20 : years >= 10 ? 15 : years >= 7 ? 8 : 2;
  // Worst case — downside tolerance (max 15)
  const worstPts = worst >= -3 ? 15 : worst >= -6 ? 10 : worst >= -10 ? 5 : 0;

  const score = wrPts + medPts + yrPts + worstPts;

  // Base lots + grade from score.
  const baseLots = score >= 82 ? 3 : score >= 68 ? 2 : score >= 55 ? 1 : 0;
  const grade    = score >= 82 ? "A+" : score >= 68 ? "A" : score >= 55 ? "B" : "SKIP";

  // Hard risk caps — may only REDUCE lots, never raise. Record which fired.
  const capReasons = [];
  let cappedLots = baseLots;
  if (baseLots > 0) {
    if (years < 7)    { cappedLots = Math.min(cappedLots, 1); capReasons.push(`<7y history (${years}y)`); }
    if (worst <= -10) { cappedLots = Math.min(cappedLots, 1); capReasons.push(`worst ${worst.toFixed(1)}%`); }
    if (wr < 80)      { cappedLots = Math.min(cappedLots, 1); capReasons.push(`WR ${wr.toFixed(0)}%<80`); }
  }

  // Below-bar stocks (base 0) are never sized — explain why.
  const belowBar = baseLots === 0;
  const skipReasons = [];
  if (belowBar) {
    if (wr < 80)  skipReasons.push(`WR ${wr.toFixed(0)}%<80`);
    if (med < 5)  skipReasons.push(`median ${med.toFixed(1)}%<5`);
    skipReasons.push(`score ${score}<55`);
  }

  return { ...s, years, score, grade, baseLots, cappedLots, recLots: cappedLots, capReasons, belowBar, skipReasons };
}

// ── Ration recommended lots against a global lot budget ──────────────────────
// candidates: pre-scored, pre-sorted by score desc. maxLots: floor(usable/cost).
// Fills each stock's recommended lots in order; the stock that overflows the
// budget gets the remainder (partial), everyone after gets 0 (→ reserve list).
function allocateLots(candidates, maxLots) {
  let remaining = Math.max(0, maxLots);
  return candidates.map((c) => {
    const give = Math.max(0, Math.min(c.recLots, remaining));
    remaining -= give;
    return { ...c, allocLots: give };
  });
}

const gradeColor = (g) =>
  g === "A+" ? "text-green" : g === "A" ? "text-accent" : g === "B" ? "text-amber" : "text-dim";

const numberInput =
  "w-full bg-card border border-border rounded-lg px-3 py-2.5 font-mono text-sm text-text " +
  "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 transition-colors";

export default function SizingPage() {
  const [month,      setMonth]      = useState(() => getNextMonth());
  const [capital,    setCapital]    = useState(() => readNum("ps.capital", DEFAULTS.capital));
  const [reserve,    setReserve]    = useState(() => readNum("ps.reserve", DEFAULTS.reserve));
  const [avgLotCost, setAvgLotCost] = useState(() => readNum("ps.avgLotCost", DEFAULTS.avgLotCost));

  const [stocks,  setStocks]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // Persist the money settings on change.
  useEffect(() => { localStorage.setItem("ps.capital", String(capital)); }, [capital]);
  useEffect(() => { localStorage.setItem("ps.reserve", String(reserve)); }, [reserve]);
  useEffect(() => { localStorage.setItem("ps.avgLotCost", String(avgLotCost)); }, [avgLotCost]);

  const fetchRankings = useCallback(async (m) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rankings?month=${m}&top=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setStocks(json.top_stocks || []);
    } catch (e) {
      setError(e.message);
      setStocks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRankings(month); }, [month, fetchRankings]);

  // ── Derived capital math + allocation (recomputes on any input change) ──────
  const model = useMemo(() => {
    const usable  = Math.max(0, capital - reserve);
    const budget  = avgLotCost > 0 ? Math.floor(usable / avgLotCost) : 0;

    const scored    = stocks.map(scoreStock);
    const belowBar  = scored.filter((s) => s.belowBar);
    const candidates = scored
      .filter((s) => !s.belowBar && s.cappedLots >= 1)
      .sort((a, b) => b.score - a.score);

    // Live price present on the payload? If so we can show true per-lot notional.
    const hasLivePrice = candidates.some((c) => priceOf(c) !== null);

    const allocated = allocateLots(candidates, budget).map((c) => {
      const live = priceOf(c);
      // Prefer real notional (price × lot_size) when available; else the assumption.
      const lotCost = live && c.lot_size ? live * c.lot_size : avgLotCost;
      return { ...c, lotCost, lotCostLive: Boolean(live && c.lot_size), capitalUsed: c.allocLots * lotCost };
    });

    const sized   = allocated.filter((c) => c.allocLots >= 1);
    const reserved = allocated.filter((c) => c.allocLots === 0); // qualified, no capital left

    const totalLots = sized.reduce((a, c) => a + c.allocLots, 0);
    const deployed  = sized.reduce((a, c) => a + c.capitalUsed, 0);
    const dryPowder = Math.max(0, usable - deployed);
    const deployedPct = usable > 0 ? Math.round((deployed / usable) * 100) : 0;

    return {
      usable, budget, hasLivePrice,
      sized, reserved, belowBar,
      qualifiedCount: candidates.length,
      totalLots, deployed, dryPowder, deployedPct,
      positions: sized.length,
    };
  }, [stocks, capital, reserve, avgLotCost]);

  const thin = !loading && model.qualifiedCount > 0 && model.qualifiedCount < 5;
  const mName = MONTH_FULL[month - 1];

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">Position Sizing</div>
          <h1 className="font-display text-3xl font-bold text-text">
            {mName}<span className="text-accent">.</span>
          </h1>
          <p className="font-mono text-[11px] text-dim mt-2 max-w-2xl">
            How many lots to enter per stock — conviction-graded, risk-capped, then rationed against real capital.
          </p>
        </div>

        {/* Controls */}
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <label className="block">
              <span className="font-mono text-[10px] text-dim uppercase tracking-widest">Month</span>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={`${numberInput} mt-1.5 cursor-pointer`}
              >
                {MONTH_FULL.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="font-mono text-[10px] text-dim uppercase tracking-widest">Total Capital ₹</span>
              <input
                type="number" min={0} step={50000} value={capital}
                onChange={(e) => setCapital(Number(e.target.value) || 0)}
                className={`${numberInput} mt-1.5`}
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] text-dim uppercase tracking-widest">Reserve ₹</span>
              <input
                type="number" min={0} step={25000} value={reserve}
                onChange={(e) => setReserve(Number(e.target.value) || 0)}
                className={`${numberInput} mt-1.5`}
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] text-dim uppercase tracking-widest">Avg cost / lot ₹</span>
              <input
                type="number" min={0} step={10000} value={avgLotCost}
                onChange={(e) => setAvgLotCost(Number(e.target.value) || 0)}
                className={`${numberInput} mt-1.5`}
              />
            </label>
          </div>

          <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className="font-mono text-[11px] text-dim">
              Usable = Capital − Reserve ={" "}
              <span className="text-green font-medium">{fmtINR(model.usable)}</span>
            </span>
            <span className="font-mono text-[11px] text-dim">
              Lot budget ≈ <span className="text-text">{model.budget}</span> lots
            </span>
            <span className="font-mono text-[10px] text-muted">
              Basis:{" "}
              {model.hasLivePrice
                ? <span className="text-accent">live notional (price × lot) where available, else avg cost</span>
                : <span>flat avg cost / lot ({fmtINR(avgLotCost)}) — no live price on feed</span>}
            </span>
          </div>
        </div>

        {/* Loading / error */}
        {loading && (
          <div className="flex items-center gap-3 py-12 justify-center">
            <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-sm text-dim">Loading {mName} rankings…</span>
          </div>
        )}
        {error && !loading && (
          <div className="text-center py-10 border border-red/20 rounded-lg mb-6">
            <div className="font-mono text-sm text-red mb-1">Failed to load rankings</div>
            <div className="font-mono text-[11px] text-muted">{error}</div>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Summary statcards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
              <StatCard label="Usable capital" value={fmtINR(model.usable)} sub="Capital − Reserve" color="text-green" />
              <StatCard label="Total lots" value={model.totalLots} sub={`across ${model.positions} stocks`} color="text-accent" />
              <StatCard label="Capital deployed" value={fmtINR(model.deployed)} sub={`${model.deployedPct}% of usable`} color="text-text" />
              <StatCard label="Dry powder" value={fmtINR(model.dryPowder)} sub="left unallocated" color="text-amber" />
              <StatCard label="Positions" value={model.positions} sub="stocks ≥ 1 lot" color="text-text" />
            </div>

            {/* Thin-month note */}
            {thin && (
              <div className="mb-6 rounded-lg border border-amber/25 bg-amber/5 px-4 py-3">
                <span className="font-mono text-[11px] text-amber leading-relaxed">
                  Only {model.qualifiedCount} stock{model.qualifiedCount === 1 ? "" : "s"} clear the bar this month —
                  deploying {model.totalLots} lot{model.totalLots === 1 ? "" : "s"}, keeping {fmtINR(model.dryPowder)} as
                  dry powder. Don&apos;t force weak stocks to fill positions.
                </span>
              </div>
            )}

            {/* Main sizing table */}
            <div className="bg-card border border-border rounded-lg mb-6 overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green" />
                <h2 className="font-display text-base font-semibold text-text">Recommended sizing — {mName}</h2>
                <span className="font-mono text-[10px] text-dim">{model.sized.length} sized</span>
              </div>

              {model.sized.length === 0 ? (
                <div className="text-dim font-mono text-sm p-8 text-center">
                  No stocks sized — either none clear the bar or capital is exhausted.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left  py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Stock</th>
                        <th className="text-left  py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Sector</th>
                        <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">WR%</th>
                        <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Median%</th>
                        <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Years</th>
                        <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Worst%</th>
                        <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Score</th>
                        <th className="text-center py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Grade</th>
                        <th className="text-center py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Rec. Lots</th>
                        <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Capital used</th>
                        <th className="text-left  py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Risk cap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.sized.map((s) => (
                        <tr key={s.symbol} className="table-row">
                          <td className="py-2.5 px-3 font-mono text-[13px] font-medium text-accent">{s.symbol}</td>
                          <td className="py-2.5 px-3 font-body text-[12px] text-dim">{s.sector}</td>
                          <td className="py-2.5 px-3 font-mono text-[12px] text-right">
                            <span className={s.win_rate >= 80 ? "text-green" : s.win_rate >= 60 ? "text-amber" : "text-red"}>
                              {(s.win_rate || 0).toFixed(1)}
                            </span>
                          </td>
                          <td className={`py-2.5 px-3 font-mono text-[12px] text-right ${(s.median_return || 0) >= 0 ? "text-green" : "text-red"}`}>
                            {(s.median_return || 0) >= 0 ? "+" : ""}{(s.median_return || 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[12px] text-right text-soft">{s.years}</td>
                          <td className="py-2.5 px-3 font-mono text-[12px] text-right text-red">{(s.worst || 0).toFixed(1)}</td>
                          <td className="py-2.5 px-3 font-mono text-[12px] text-right text-soft">{s.score}</td>
                          <td className={`py-2.5 px-3 font-mono text-[12px] font-semibold text-center ${gradeColor(s.grade)}`}>{s.grade}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`font-mono text-xl font-bold ${gradeColor(s.grade)}`}>{s.allocLots}</span>
                            {s.allocLots < s.recLots && (
                              <span className="block font-mono text-[9px] text-amber">partial of {s.recLots}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[12px] text-right text-text">
                            {fmtINR(s.capitalUsed)}
                            {s.lotCostLive && <span className="block font-mono text-[9px] text-accent">live</span>}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[10px] text-amber">
                            {s.capReasons.length ? s.capReasons.join(" · ") : <span className="text-muted">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Secondary: reserve list — qualified but no capital left */}
            {model.reserved.length > 0 && (
              <div className="bg-card border border-amber/20 rounded-lg mb-6 overflow-hidden">
                <div className="px-5 py-3 border-b border-amber/20 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-amber" />
                  <h2 className="font-display text-base font-semibold text-text">Reserve list — qualified, no capital left</h2>
                  <span className="font-mono text-[10px] text-dim">{model.reserved.length} stocks</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <tbody>
                      {model.reserved.map((s) => (
                        <tr key={s.symbol} className="table-row">
                          <td className="py-2.5 px-3 font-mono text-[13px] font-medium text-soft">{s.symbol}</td>
                          <td className="py-2.5 px-3 font-body text-[12px] text-dim">{s.sector}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-right text-dim">score {s.score}</td>
                          <td className={`py-2.5 px-3 font-mono text-[11px] text-center font-semibold ${gradeColor(s.grade)}`}>{s.grade}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-right text-dim">would take {s.recLots} lot{s.recLots === 1 ? "" : "s"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-5 py-2.5 border-t border-border font-mono text-[10px] text-muted">
                  These cleared the conviction bar but the lot budget ran out. Free up capital to add them.
                </div>
              </div>
            )}

            {/* Secondary: below bar — skipped */}
            {model.belowBar.length > 0 && (
              <div className="bg-card border border-border rounded-lg mb-6 overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-muted" />
                  <h2 className="font-display text-base font-semibold text-dim">Below bar — skipped</h2>
                  <span className="font-mono text-[10px] text-muted">{model.belowBar.length} stocks</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <tbody>
                      {model.belowBar
                        .sort((a, b) => b.score - a.score)
                        .map((s) => (
                        <tr key={s.symbol} className="table-row">
                          <td className="py-2.5 px-3 font-mono text-[13px] text-dim">{s.symbol}</td>
                          <td className="py-2.5 px-3 font-body text-[12px] text-muted">{s.sector}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-right text-muted">score {s.score}</td>
                          <td className="py-2.5 px-3 font-mono text-[10px] text-red">{s.skipReasons.join(" · ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
