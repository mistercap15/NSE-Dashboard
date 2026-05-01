"use client";
import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import SignalBadge from "../components/SignalBadge";
import SeasonalityHeatmap from "../components/SeasonalityHeatmap";
import WinRateChart from "../components/WinRateChart";
import StockSearch from "../components/StockSearch";
import Link from "next/link";
import { MONTHS, MONTH_FULL, getSignalLabel } from "../lib/api";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const currentMonth = new Date().getMonth() + 1;

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtMonth(dateStr) {
  if (!dateStr) return "";
  const [y, m] = dateStr.split("-");
  return `${MONTHS[parseInt(m) - 1]} ${y}`;
}

function cardBorder(signal) {
  const s = (signal || "").toUpperCase();
  if (s.includes("PERFECT") || s.includes("EXCELLENT")) return "border-green/40 bg-green/[0.06]";
  if (s.includes("BULLISH"))  return "border-green/25 bg-green/[0.04]";
  if (s.includes("MILD"))     return "border-amber/30 bg-amber/[0.05]";
  if (s.includes("NEUTRAL"))  return "border-border bg-card/60";
  if (s.includes("WEAK"))     return "border-red/20 bg-red/[0.04]";
  if (s.includes("AVOID"))    return "border-red/35 bg-red/[0.07]";
  return "border-border bg-card/60";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function LoadingSkeleton({ symbol }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <div className="text-center">
          <div className="font-mono text-sm text-text">
            Fetching real NSE data for <span className="text-accent">{symbol}</span>…
          </div>
          <div className="font-mono text-[11px] text-dim mt-1">
            GOOGLEFINANCE can take 5–8 seconds · hang tight
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-card border border-border rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="h-28 bg-card border border-border rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="h-64 bg-card border border-border rounded-lg animate-pulse" />
      <div className="h-64 bg-card border border-border rounded-lg animate-pulse" />
    </div>
  );
}

function PriceTooltip({ active, payload }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded px-3 py-2 font-mono text-xs shadow-lg">
      <div className="text-dim mb-1">{d.date}</div>
      <div className="text-text">₹{d.close?.toLocaleString("en-IN")}</div>
      {d.return_pct !== null && d.return_pct !== undefined && (
        <div className={d.return_pct >= 0 ? "text-green" : "text-red"}>
          {d.return_pct >= 0 ? "+" : ""}{d.return_pct?.toFixed(2)}%
        </div>
      )}
    </div>
  );
}

// ── Main page content (inside Suspense) ────────────────────────────────────────

function AnalysisContent() {
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const heatmapRef    = useRef(null);
  const winRateRef    = useRef(null);

  const [symbol,        setSymbol]        = useState(searchParams.get("symbol") || "");
  const [data,          setData]          = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [showRaw,       setShowRaw]       = useState(false);
  const [highlightMonth, setHighlightMonth] = useState(null); // 0-indexed

  const fetchData = async (sym) => {
    if (!sym) return;
    setLoading(true);
    setError(null);
    setData(null);
    setShowRaw(false);
    setHighlightMonth(null);
    router.push(`/analysis?symbol=${sym}`, { scroll: false });
    try {
      const res = await fetch(`/api/analysis?symbol=${sym}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-load if symbol is in URL on mount
  useEffect(() => {
    const sym = searchParams.get("symbol");
    if (sym) {
      setSymbol(sym);
      fetchData(sym);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (sym) => {
    setSymbol(sym);
    fetchData(sym);
  };

  const handleMonthCardClick = (idx) => {
    setHighlightMonth(idx);
    heatmapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Derived data ─────────────────────────────────────────────────────────────
  const prices      = data?.prices     || [];
  const seasonality = data?.seasonality || [];

  const firstClose  = prices[0]?.close;
  const lastClose   = prices[prices.length - 1]?.close;
  const totalReturn = firstClose && lastClose
    ? ((lastClose - firstClose) / firstClose * 100).toFixed(1)
    : null;

  const bestMonth  = [...seasonality].sort((a, b) => b.win_rate - a.win_rate)[0];
  const worstMonth = [...seasonality].sort((a, b) => a.win_rate - b.win_rate)[0];

  // Price chart — only yearly ticks on X axis
  const chartData  = prices.map(p => ({ date: p.date, close: p.close, return_pct: p.return_pct }));
  const yearTicks  = chartData.filter(d => d.date?.endsWith("-01")).map(d => d.date);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Search bar ──────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">
          NSE F&O Seasonality
        </div>
        <h1 className="font-display text-3xl font-bold text-text tracking-tight mb-5">
          Stock Analysis<span className="text-accent">.</span>
        </h1>
        <StockSearch onSelect={handleSelect} defaultValue={symbol} loading={loading} />
      </div>

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {loading && <LoadingSkeleton symbol={symbol} />}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <div className="bg-red/5 border border-red/20 rounded-lg p-6 text-center">
          <div className="font-mono text-sm text-red mb-2">{error}</div>
          <div className="font-mono text-[11px] text-dim">
            Check the symbol is a valid NSE F&O stock. If it exists on BSE only, try the suffix approach.
          </div>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!loading && !error && !data && (
        <div className="text-center py-24">
          <div className="font-display text-xl text-dim mb-2">Search for any F&O stock above</div>
          <div className="font-mono text-sm text-muted">
            Real data • 2009 to present • 16 years of monthly history
          </div>
        </div>
      )}

      {/* ── Data sections ───────────────────────────────────────────────────── */}
      {!loading && data && (
        <div className="space-y-8 animate-fade-in">

          {/* ── SECTION 1 — Stock header ───────────────────────────────────── */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex flex-col lg:flex-row lg:items-start gap-6">

              {/* Left — identity */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="font-display text-4xl font-bold text-accent tracking-tight">
                    {data.symbol || symbol}
                  </h2>
                  {data.sector && (
                    <span className="font-mono text-[10px] px-2.5 py-1 rounded border border-accent/25 text-accent bg-accent/8">
                      {data.sector}
                    </span>
                  )}
                </div>
                <div className="font-mono text-xs text-dim">
                  {data.exchange} · {fmtMonth(prices[0]?.date)} – {fmtMonth(prices[prices.length - 1]?.date)} · {prices.length} monthly closes
                  {data.lot_size && ` · Lot: ${data.lot_size.toLocaleString("en-IN")} shares`}
                </div>
              </div>

              {/* Right — key numbers */}
              <div className="flex gap-6 shrink-0">
                {lastClose && (
                  <div>
                    <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Latest Close</div>
                    <div className="font-mono text-2xl font-medium text-text">
                      ₹{lastClose.toLocaleString("en-IN")}
                    </div>
                    <div className="font-mono text-[11px] text-dim">{prices[prices.length - 1]?.date}</div>
                  </div>
                )}
                {totalReturn !== null && (
                  <div>
                    <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Since 2009</div>
                    <div className={`font-mono text-2xl font-medium ${parseFloat(totalReturn) >= 0 ? "text-green" : "text-red"}`}>
                      {parseFloat(totalReturn) >= 0 ? "+" : ""}{totalReturn}%
                    </div>
                    <div className="font-mono text-[11px] text-dim">total return</div>
                  </div>
                )}
              </div>
            </div>

            {/* Best / Worst month strip */}
            {seasonality.length > 0 && (
              <div className="flex gap-4 mt-5 pt-5 border-t border-border">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-dim uppercase tracking-widest">Best month:</span>
                  <span className="font-mono text-xs text-green font-medium">{bestMonth?.month}</span>
                  <SignalBadge winRate={bestMonth?.win_rate} />
                  <span className="font-mono text-[10px] text-dim">{bestMonth?.win_rate}% WR</span>
                </div>
                <div className="w-px bg-border" />
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-dim uppercase tracking-widest">Worst month:</span>
                  <span className="font-mono text-xs text-red font-medium">{worstMonth?.month}</span>
                  <SignalBadge winRate={worstMonth?.win_rate} />
                  <span className="font-mono text-[10px] text-dim">{worstMonth?.win_rate}% WR</span>
                </div>
              </div>
            )}
          </div>

          {/* ── SECTION 2 — 12-month seasonality cards ────────────────────── */}
          {seasonality.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-base font-semibold text-text">Monthly Seasonality</h2>
                <span className="font-mono text-[10px] text-dim">Click a month to highlight it below</span>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {seasonality.map((s, i) => {
                  const signal    = getSignalLabel(s.win_rate);
                  const isCurrent = i + 1 === currentMonth;
                  const borders   = isCurrent
                    ? "border-accent/50 bg-accent/[0.06] ring-1 ring-accent/30"
                    : cardBorder(signal);
                  return (
                    <button
                      key={s.month || MONTHS[i]}
                      onClick={() => handleMonthCardClick(i)}
                      className={`rounded-lg border p-3 text-left transition-all hover:scale-[1.02] ${borders}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`font-display text-xs font-semibold ${isCurrent ? "text-accent" : "text-dim"}`}>
                          {MONTH_FULL[i]}
                        </span>
                        {isCurrent && (
                          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        )}
                      </div>
                      <div className={`font-mono text-2xl font-bold mb-0.5 ${
                        s.win_rate >= 80 ? "text-green" :
                        s.win_rate >= 65 ? "text-amber" :
                        s.win_rate >= 50 ? "text-soft"  : "text-red"
                      }`}>
                        {s.win_rate?.toFixed(0)}%
                      </div>
                      <div className={`font-mono text-[10px] mb-2 ${s.avg_return >= 0 ? "text-green" : "text-red"}`}>
                        {s.avg_return >= 0 ? "+" : ""}{s.avg_return?.toFixed(2)}%
                      </div>
                      <SignalBadge winRate={s.win_rate} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── SECTION 3 — Heatmap ───────────────────────────────────────── */}
          {prices.length > 0 && (
            <div ref={heatmapRef} className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-display text-base font-semibold text-text mb-4">
                Year × Month Returns — Real NSE Data
              </h2>
              <SeasonalityHeatmap
                data={prices}
                onCellClick={({ month }) => {
                  setHighlightMonth(month - 1);
                  winRateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            </div>
          )}

          {/* ── SECTION 4 — Win Rate bar chart ────────────────────────────── */}
          {seasonality.length > 0 && (
            <div ref={winRateRef} className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-base font-semibold text-text">
                  Monthly Win Rate & Avg Return
                </h2>
                <div className="flex items-center gap-4 font-mono text-[10px] text-dim">
                  <span>Win rate bar</span>
                  <span>Avg return</span>
                  <span className="w-10 text-right">Pos/Total</span>
                </div>
              </div>
              <WinRateChart seasonality={seasonality} highlightMonth={highlightMonth} />
            </div>
          )}

          {/* ── SECTION 5 — Price history chart ───────────────────────────── */}
          {chartData.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-display text-base font-semibold text-text mb-4">
                Price History — Monthly Closes (₹)
              </h2>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#4D9FFF" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#4D9FFF" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    ticks={yearTicks}
                    tickFormatter={(v) => v?.split("-")[0]}
                    tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#64748B" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#64748B" }}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v) =>
                      v >= 1000 ? `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `₹${v}`
                    }
                  />
                  <Tooltip content={<PriceTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke="#4D9FFF"
                    strokeWidth={1.5}
                    fill="url(#priceGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: "#4D9FFF" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── SECTION 6 — Raw data table (collapsible) ──────────────────── */}
          {prices.length > 0 && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="w-full px-5 py-3.5 flex items-center justify-between font-mono text-sm text-dim hover:text-text hover:bg-white/[0.02] transition-colors"
              >
                <span>Raw Monthly Returns</span>
                <span className="text-[11px]">{showRaw ? "Hide ↑" : "Show all returns ↓"}</span>
              </button>

              {showRaw && (
                <div className="border-t border-border overflow-auto max-h-[420px]">
                  <table className="w-full font-mono text-[11px]">
                    <thead className="sticky top-0 bg-card border-b border-border">
                      <tr>
                        <th className="text-left py-2.5 px-5 text-dim font-normal">Date</th>
                        <th className="text-right py-2.5 px-5 text-dim font-normal">Close (₹)</th>
                        <th className="text-right py-2.5 px-5 text-dim font-normal">Monthly Return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...prices].reverse().map(p => (
                        <tr key={p.date} className="table-row">
                          <td className="py-2 px-5 text-dim">{p.date}</td>
                          <td className="py-2 px-5 text-right text-soft">
                            ₹{p.close?.toLocaleString("en-IN")}
                          </td>
                          <td className={`py-2 px-5 text-right ${
                            p.return_pct === null || p.return_pct === undefined
                              ? "text-muted"
                              : p.return_pct >= 0 ? "text-green" : "text-red"
                          }`}>
                            {p.return_pct === null || p.return_pct === undefined
                              ? "—"
                              : `${p.return_pct >= 0 ? "+" : ""}${p.return_pct.toFixed(2)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </>
  );
}

// ── Page shell ─────────────────────────────────────────────────────────────────

export default function AnalysisPage() {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-[200px] flex-1 p-8">
        <Suspense fallback={
          <div className="flex items-center gap-3 py-20 justify-center">
            <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-sm text-dim">Loading…</span>
          </div>
        }>
          <AnalysisContent />
        </Suspense>
      </main>
    </div>
  );
}
