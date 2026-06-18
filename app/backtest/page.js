"use client";
import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Cell,
} from "recharts";
import { LineChart, Info } from "lucide-react";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";

const DIRECTIONS = [
  { key: "LONG",  label: "↑ Long-only",  hint: "Buy the seasonal top-N each month" },
  { key: "SHORT", label: "↓ Short-only", hint: "Short the seasonal bottom-N each month" },
  { key: "LS",    label: "⇅ Long + Short", hint: "Market-neutral: long top-N, short bottom-N" },
];

const fmtPct = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const fmtNum = (v, d = 2) => (v === null || v === undefined || !isFinite(v) ? "∞" : v.toFixed(d));

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 shadow-xl">
      <div className="font-mono text-[10px] text-dim mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="font-mono text-[11px]" style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(1) : p.value}
        </div>
      ))}
    </div>
  );
}

export default function BacktestPage() {
  const [direction, setDirection] = useState("LONG");
  const [topN,      setTopN]      = useState(5);
  const [startYear, setStartYear] = useState(2015);
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  const run = useCallback(async (dir, n, sy) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/backtest?direction=${dir}&topN=${n}&startYear=${sy}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { run(direction, topN, startYear); }, [direction, topN, startYear, run]);

  const s = data?.stats;
  const b = data?.benchStats;
  const beatBench = s && b && s.cagr > b.cagr;

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">
        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2 flex items-center gap-2">
            <LineChart size={13} className="text-accent" /> Strategy Backtest
          </div>
          <div className="flex items-end gap-4 flex-wrap">
            <h1 className="font-display text-3xl font-bold text-text">
              Seasonal Edge<span className="text-accent">.</span>
            </h1>
            {data?.coverage && (
              <span className="font-mono text-[10px] text-muted mb-1">
                {data.coverage.from} → {data.coverage.to} · {data.coverage.months} months · {data.universe?.symbols} stocks
              </span>
            )}
          </div>
          <p className="font-body text-[13px] text-dim mt-2 max-w-2xl">
            Walk-forward simulation: each month, stocks are ranked by their seasonal return for that
            calendar month using <span className="text-soft">only prior years</span> (no lookahead), then the
            top-N basket is traded. Benchmark = equal-weight whole universe.
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {DIRECTIONS.map((d) => (
              <button
                key={d.key}
                onClick={() => setDirection(d.key)}
                title={d.hint}
                className={`px-4 py-2 font-mono text-[12px] transition-colors border-r border-border last:border-r-0 ${
                  direction === d.key ? "bg-accent/15 text-accent" : "text-dim hover:text-text"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-dim uppercase tracking-widest">Basket</span>
            <select value={topN} onChange={(e) => setTopN(Number(e.target.value))}
              className="bg-bg border border-border rounded-lg px-3 py-1.5 font-mono text-[11px] text-dim focus:border-accent focus:outline-none cursor-pointer">
              {[3, 5, 8, 10, 15].map(n => <option key={n} value={n}>Top {n}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-dim uppercase tracking-widest">From</span>
            <select value={startYear} onChange={(e) => setStartYear(Number(e.target.value))}
              className="bg-bg border border-border rounded-lg px-3 py-1.5 font-mono text-[11px] text-dim focus:border-accent focus:outline-none cursor-pointer">
              {[2013, 2014, 2015, 2016, 2017, 2018].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-3 py-16 justify-center">
            <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-sm text-dim">Running walk-forward backtest…</span>
          </div>
        )}

        {error && (
          <div className="bg-red/10 border border-red/20 rounded-lg p-4 font-mono text-sm text-red mb-6">
            {error.includes("snapshot")
              ? <>Universe snapshot not built yet. Run <span className="text-accent">node scripts/build-universe.mjs</span>, then refresh.</>
              : <>Error: {error}</>}
          </div>
        )}

        {!loading && !error && s && (
          <>
            {/* Headline metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <StatCard label="CAGR" value={fmtPct(s.cagr)} sub={`Benchmark ${fmtPct(b.cagr)}`} color={s.cagr >= 0 ? "text-green" : "text-red"} />
              <StatCard label="Total return" value={fmtPct(s.totalReturn, 0)} sub={`over ${(s.months / 12).toFixed(1)} yrs`} color={s.totalReturn >= 0 ? "text-green" : "text-red"} />
              <StatCard label="Sharpe" value={fmtNum(s.sharpe)} sub={`Benchmark ${fmtNum(b.sharpe)}`} color="text-accent" />
              <StatCard label="Max drawdown" value={fmtPct(s.maxDrawdown, 1)} sub="Peak-to-trough" color="text-red" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatCard label="Sortino" value={fmtNum(s.sortino)} sub="Downside-adjusted" color="text-accent" />
              <StatCard label="Win rate" value={`${s.winRate.toFixed(0)}%`} sub="Profitable months" color={s.winRate >= 50 ? "text-green" : "text-amber"} />
              <StatCard label="Profit factor" value={fmtNum(s.profitFactor)} sub="Gains ÷ losses" color={s.profitFactor >= 1 ? "text-green" : "text-red"} />
              <StatCard label="Avg month" value={fmtPct(s.avgMonth, 2)} sub={`Best ${fmtPct(s.bestMonth,0)} / Worst ${fmtPct(s.worstMonth,0)}`} color={s.avgMonth >= 0 ? "text-green" : "text-red"} />
            </div>

            {/* Verdict banner */}
            <div className={`rounded-lg border px-4 py-3 mb-6 font-mono text-[12px] flex items-center gap-2 ${
              beatBench ? "border-green/30 bg-green/10 text-green" : "border-amber/30 bg-amber/10 text-amber"
            }`}>
              <Info size={14} />
              {beatBench
                ? `Strategy beat buy-the-universe by ${fmtPct(s.cagr - b.cagr)} CAGR with a ${fmtNum(s.sharpe)} Sharpe — the seasonal edge added alpha.`
                : `Strategy returned ${fmtPct(s.cagr)} CAGR vs ${fmtPct(b.cagr)} for the universe — edge is thin here; try a different direction or basket size.`}
            </div>

            {/* Equity curve */}
            <div className="bg-card border border-border rounded-lg p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-base font-semibold text-text">Equity Curve <span className="text-dim font-normal text-[12px]">(₹100 start)</span></h2>
                <div className="flex items-center gap-4 font-mono text-[10px]">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-accent inline-block" /> Strategy</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-dim inline-block" /> Universe</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.curve} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(77,159,255)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="rgb(77,159,255)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
                  <XAxis dataKey="ym" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#64748b" }}
                    tickFormatter={(v) => v.slice(0, 4)} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10, fontFamily: "monospace", fill: "#64748b" }} width={50} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="benchmark" name="Universe" stroke="#64748b" strokeWidth={1} fill="none" dot={false} />
                  <Area type="monotone" dataKey="equity" name="Strategy" stroke="rgb(77,159,255)" strokeWidth={2} fill="url(#eq)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Yearly returns */}
            <div className="bg-card border border-border rounded-lg p-5 mb-6">
              <h2 className="font-display text-base font-semibold text-text mb-4">Calendar-Year Returns</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.yearly} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 10, fontFamily: "monospace", fill: "#64748b" }} width={50} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148,163,184,0.05)" }} />
                  <ReferenceLine y={0} stroke="#64748b" />
                  <Bar dataKey="ret" name="Return" radius={[2, 2, 0, 0]}>
                    {data.yearly.map((d) => (
                      <Cell key={d.year} fill={d.ret >= 0 ? "rgb(34,197,94)" : "rgb(248,113,113)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Current basket */}
            {data.latest && (
              <div className="bg-card border border-border rounded-lg p-5 mb-6">
                <h2 className="font-display text-base font-semibold text-text mb-1">
                  Latest Basket <span className="font-mono text-[11px] text-dim">({data.latest.ym})</span>
                </h2>
                <p className="font-mono text-[10px] text-muted mb-3">What the strategy would hold in the most recent month.</p>
                <div className="grid md:grid-cols-2 gap-4">
                  {(direction !== "SHORT") && (
                    <div>
                      <div className="font-mono text-[10px] text-green uppercase tracking-widest mb-2">Long</div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.latest.longSymbols.map(sym => (
                          <span key={sym} className="font-mono text-[11px] px-2 py-1 rounded border border-green/25 bg-green/5 text-green">{sym}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(direction !== "LONG") && (
                    <div>
                      <div className="font-mono text-[10px] text-red uppercase tracking-widest mb-2">Short</div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.latest.shortSymbols.map(sym => (
                          <span key={sym} className="font-mono text-[11px] px-2 py-1 rounded border border-red/25 bg-red/5 text-red">{sym}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <p className="font-mono text-[10px] text-muted leading-relaxed">
              Equal-weight monthly rebalance, returns gross of costs/slippage and dividends. Extreme monthly
              returns (|r| &gt; 150%, corporate-action artifacts) are excluded. Snapshot generated {data.universe?.generatedAt?.slice(0,10) || "—"}.
              Past performance is not indicative of future results.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
