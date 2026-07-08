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

// ── Price levels from an entry price (pure) ──────────────────────────────────
// Every level keys off `entry` = opening price of the first trading day of the
// month. `lots` is the recommended (allocated) lot count for this position.
// Returns null when there's no usable entry — callers render "—".
function computeLevels(entry, medianReturn, worst, lotSize, lots) {
  if (!Number.isFinite(entry) || entry <= 0 || !lotSize || !lots) return null;

  // TARGET — entry compounded by the median seasonal return for the month.
  const targetPrice    = Math.round(entry * (1 + (medianReturn || 0) / 100));
  const expectedProfit = Math.round((targetPrice - entry) * lotSize * lots);

  // STOP — historical worst month, widened 1.2×, as the exit. `worst` is
  // negative (e.g. -6.33 → stopPct -7.6%). Tweak the 1.2 buffer here to make
  // stops tighter/looser. (This is our own rule, NOT early-entry's support stop.)
  const stopPct    = (worst || 0) * 1.2;
  const stopPrice  = Math.round(entry * (1 + stopPct / 100));
  const riskAmount = Math.round((entry - stopPrice) * lotSize * lots);

  // AVERAGE-IN — only meaningful for 2+ lot plans (nothing to stage on 1 lot).
  // Sits at the MIDPOINT of entry and stop: a planned dip fill that is still
  // ABOVE the stop. It fills the SAME recommended size in two stages — it does
  // NOT add beyond it. If price breaks the stop you exit; no further averaging.
  const avgInPrice = lots >= 2 ? Math.round((entry + stopPrice) / 2) : null;

  return { targetPrice, expectedProfit, stopPrice, stopPct, riskAmount, avgInPrice };
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

  // Upstox connection state (drives the banner + graceful degradation).
  const [upstoxReady,  setUpstoxReady]  = useState(false);
  const [tokenExpired, setTokenExpired] = useState(false);

  // Entry prices per symbol: { SYM: { entry, provisional } }. Empty when Upstox
  // is unavailable — the sizing engine works fine without it (columns show "—").
  const [prices,        setPrices]        = useState({});
  const [priceMeta,     setPriceMeta]     = useState({ provisionalMonth: false, year: null });
  const [pricesLoading, setPricesLoading] = useState(false);

  // Persist the money settings on change.
  useEffect(() => { localStorage.setItem("ps.capital", String(capital)); }, [capital]);
  useEffect(() => { localStorage.setItem("ps.reserve", String(reserve)); }, [reserve]);
  useEffect(() => { localStorage.setItem("ps.avgLotCost", String(avgLotCost)); }, [avgLotCost]);

  // Detect Upstox connection once on mount (mirrors early-entry).
  useEffect(() => {
    fetch("/api/upstox/status")
      .then((r) => r.json())
      .then((d) => { setUpstoxReady(!!d.connected); setTokenExpired(!!d.expired); })
      .catch(() => setUpstoxReady(false));
  }, []);

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

  // Fetch first-trading-day entry prices whenever the month or symbol set
  // changes. Batched server-side; failures degrade to no prices (never blocks).
  const symbolsKey = stocks.map((s) => s.symbol).join(",");
  useEffect(() => {
    if (!symbolsKey) { setPrices({}); return; }
    let cancelled = false;
    setPricesLoading(true);
    fetch(`/api/sizing/entry-prices?month=${month}&symbols=${encodeURIComponent(symbolsKey)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setPrices(d.prices || {});
        setPriceMeta({ provisionalMonth: !!d.provisionalMonth, year: d.year });
      })
      .catch(() => { if (!cancelled) setPrices({}); })
      .finally(() => { if (!cancelled) setPricesLoading(false); });
    return () => { cancelled = true; };
  }, [month, symbolsKey]);

  // ── Derived capital math + allocation (recomputes on any input change) ──────
  const model = useMemo(() => {
    const usable  = Math.max(0, capital - reserve);
    const budget  = avgLotCost > 0 ? Math.floor(usable / avgLotCost) : 0;

    const scored    = stocks.map(scoreStock);
    const belowBar  = scored.filter((s) => s.belowBar);
    const candidates = scored
      .filter((s) => !s.belowBar && s.cappedLots >= 1)
      .sort((a, b) => b.score - a.score);

    const allocated = allocateLots(candidates, budget).map((c) => {
      // Entry = first-trading-day open (or provisional live). Fall back to any
      // price riding on the rankings payload, else null.
      const p = prices[c.symbol];
      const rawEntry = p && Number.isFinite(p.entry) ? p.entry : priceOf(c);
      const entry = Number.isFinite(rawEntry) && rawEntry > 0 ? rawEntry : null;
      const provisional = p ? !!p.provisional : false;

      // Per-lot cost: real notional (entry × lot_size) when we have an entry,
      // else the flat avg-cost assumption. Budget (maxLots) still uses avgLotCost.
      const lotCost = entry && c.lot_size ? entry * c.lot_size : avgLotCost;
      const levels = computeLevels(entry, c.median_return, c.worst, c.lot_size, c.allocLots);

      return {
        ...c, entry, provisional, levels,
        lotCost, lotCostReal: Boolean(entry && c.lot_size),
        capitalUsed: c.allocLots * lotCost,
      };
    });

    // Do we actually have first-day/live entry prices to show?
    const hasEntryPrices = allocated.some((c) => c.entry !== null);

    const sized   = allocated.filter((c) => c.allocLots >= 1);
    const reserved = allocated.filter((c) => c.allocLots === 0); // qualified, no capital left

    const totalLots = sized.reduce((a, c) => a + c.allocLots, 0);
    const deployed  = sized.reduce((a, c) => a + c.capitalUsed, 0);
    const dryPowder = Math.max(0, usable - deployed);
    const deployedPct = usable > 0 ? Math.round((deployed / usable) * 100) : 0;

    return {
      usable, budget, hasEntryPrices,
      sized, reserved, belowBar,
      qualifiedCount: candidates.length,
      totalLots, deployed, dryPowder, deployedPct,
      positions: sized.length,
    };
  }, [stocks, capital, reserve, avgLotCost, prices]);

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

        {/* Upstox connection status (mirrors early-entry) — prices only */}
        {tokenExpired ? (
          <div className="mb-6 p-4 rounded-lg border border-red/30 bg-red/5 flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest mb-1 text-red">✕ Upstox Session Expired</div>
              <div className="font-body text-sm text-dim">
                Sizing still works — but entry / target / stop prices need a live token. Re-authenticate to restore them.
              </div>
            </div>
            <a href="/api/upstox/login"
              className="font-mono text-sm px-4 py-2 rounded border border-red/30 bg-red/10 text-red hover:bg-red/20 transition-colors whitespace-nowrap">
              Re-authenticate →
            </a>
          </div>
        ) : !upstoxReady ? (
          <div className="mb-6 p-4 rounded-lg border border-amber/20 bg-amber/5 flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest mb-1 text-amber">⚠ Upstox Not Connected</div>
              <div className="font-body text-sm text-dim">
                Sizing, grades and capital math work without it — connect Upstox to fill in Entry / Target / Stop / Average-in.
              </div>
            </div>
            <a href="/api/upstox/login"
              className="font-mono text-sm px-4 py-2 rounded border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors whitespace-nowrap">
              Connect Upstox →
            </a>
          </div>
        ) : null}

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
              {model.hasEntryPrices
                ? <span className="text-accent">
                    {priceMeta.provisionalMonth ? "provisional live entry" : "first-day open"} × lot where available, else avg cost
                  </span>
                : <span>flat avg cost / lot ({fmtINR(avgLotCost)}) — {pricesLoading ? "loading prices…" : "no live prices"}</span>}
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

            {/* Provisional-entry note (future month → no first-day open yet) */}
            {model.hasEntryPrices && priceMeta.provisionalMonth && (
              <div className="mb-6 rounded-lg border border-amber/25 bg-amber/5 px-4 py-3">
                <span className="font-mono text-[11px] text-amber leading-relaxed">
                  Entry prices for {mName}{priceMeta.year ? ` ${priceMeta.year}` : ""} are <strong>provisional (live)</strong> —
                  the month hasn&apos;t started, so there&apos;s no first-day open yet. They lock to the first trading day&apos;s
                  open once the month opens.
                </span>
              </div>
            )}

            {/* Main sizing table */}
            <div className="bg-card border border-border rounded-lg mb-6 overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green" />
                <h2 className="font-display text-base font-semibold text-text">Recommended sizing — {mName}</h2>
                <span className="font-mono text-[10px] text-dim">{model.sized.length} sized</span>
                {pricesLoading && (
                  <span className="ml-auto flex items-center gap-2 font-mono text-[10px] text-dim">
                    <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
                    prices…
                  </span>
                )}
              </div>

              {model.sized.length === 0 ? (
                <div className="text-dim font-mono text-sm p-8 text-center">
                  No stocks sized — either none clear the bar or capital is exhausted.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1180px] text-sm">
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
                        <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Entry</th>
                        <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Target</th>
                        <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Stop</th>
                        <th
                          className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal"
                          title="Planned 2nd-stage fill for 2+ lot positions. Fills the SAME recommended size in two stages — it never adds beyond it. If price breaks the stop, exit; no further averaging."
                        >
                          Average-in
                        </th>
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

                          {/* Entry — first-day open (locked) or provisional live */}
                          <td className="py-2.5 px-3 text-right">
                            {s.entry != null ? (
                              <>
                                <div className="font-mono text-[12px] text-text">{fmtINR(s.entry)}</div>
                                <div className={`font-mono text-[9px] ${s.provisional ? "text-amber" : "text-dim"}`}>
                                  {s.provisional ? "provisional·live" : "1st-day open"}
                                </div>
                              </>
                            ) : <span className="font-mono text-[12px] text-muted">—</span>}
                          </td>

                          {/* Target — entry × (1 + median%) + expected profit */}
                          <td className="py-2.5 px-3 text-right">
                            {s.levels ? (
                              <>
                                <div className="font-mono text-[12px] text-text">{fmtINR(s.levels.targetPrice)}</div>
                                <div className="font-mono text-[9px] text-green">+{fmtINR(s.levels.expectedProfit)}</div>
                              </>
                            ) : <span className="font-mono text-[12px] text-muted">—</span>}
                          </td>

                          {/* Stop — worst×1.2 below entry + stop% + rupee risk */}
                          <td className="py-2.5 px-3 text-right">
                            {s.levels ? (
                              <>
                                <div className="font-mono text-[12px] text-red">{fmtINR(s.levels.stopPrice)}</div>
                                <div className="font-mono text-[9px] text-red/70">
                                  {s.levels.stopPct.toFixed(1)}% · {fmtINR(s.levels.riskAmount)} risk
                                </div>
                              </>
                            ) : <span className="font-mono text-[12px] text-muted">—</span>}
                          </td>

                          {/* Average-in — 2nd-stage fill, only for 2+ lot plans */}
                          <td className="py-2.5 px-3 text-right">
                            {s.levels?.avgInPrice ? (
                              <>
                                <div className="font-mono text-[12px] text-amber">{fmtINR(s.levels.avgInPrice)}</div>
                                <div className="font-mono text-[9px] text-dim">add 2nd half</div>
                              </>
                            ) : <span className="font-mono text-[12px] text-muted">—</span>}
                          </td>

                          <td className="py-2.5 px-3 font-mono text-[12px] text-right text-text">
                            {fmtINR(s.capitalUsed)}
                            {s.lotCostReal && <span className="block font-mono text-[9px] text-accent">live</span>}
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
