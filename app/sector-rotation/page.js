"use client";
import { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import { MONTHS } from "../lib/api";

const CURRENT_MONTH = new Date().getMonth() + 1;

const ACTION_STYLES = {
  LONG:   { bg: "bg-green/10",  border: "border-green/20",  text: "text-green",  label: "LONG"   },
  SHORT:  { bg: "bg-red/10",    border: "border-red/20",    text: "text-red",    label: "SHORT"  },
  PAIRED: { bg: "bg-accent/10", border: "border-accent/20", text: "text-accent", label: "PAIRED" },
  FLAT:   { bg: "bg-card",      border: "border-border",    text: "text-dim",    label: "FLAT"   },
};

function ActionBadge({ action }) {
  const s = ACTION_STYLES[action] || ACTION_STYLES.FLAT;
  return (
    <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${s.bg} ${s.border} ${s.text}`}>
      {s.label}
    </span>
  );
}

function StockPill({ stock, side }) {
  const color = side === "long" ? "text-green" : "text-red";
  return (
    <span className={`font-mono text-[11px] ${color} bg-card border border-border rounded px-2 py-0.5`}>
      {stock.symbol}
      <span className="text-muted ml-1">{stock.win_rate}%</span>
    </span>
  );
}

function MonthCard({ strategy, isActive }) {
  const [open, setOpen] = useState(isActive);
  const s = ACTION_STYLES[strategy.action] || ACTION_STYLES.FLAT;

  return (
    <div className={`border rounded-lg overflow-hidden transition-all ${isActive ? "border-accent/30" : "border-border"}`}>
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-card/80 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`font-mono text-[10px] w-3 ${isActive ? "text-green" : "text-muted"}`}>
            {isActive ? "▶" : ""}
          </span>
          <span className="font-display text-sm font-semibold text-text w-[88px] shrink-0">
            {strategy.monthName}
          </span>
          <ActionBadge action={strategy.action} />
          {strategy.isResultsMonth && (
            <span className="font-mono text-[10px] text-amber border border-amber/20 bg-amber/10 px-1.5 py-0.5 rounded hidden sm:inline">
              RESULTS
            </span>
          )}
          {strategy.dataQualityWarning && (
            <span className="font-mono text-[10px] text-dim hidden sm:inline">⚠ Low data</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {strategy.longTrades?.slice(0, 2).map(s => (
            <StockPill key={s.symbol} stock={s} side="long" />
          ))}
          {strategy.shortTrades?.slice(0, 1).map(s => (
            <StockPill key={s.symbol} stock={s} side="short" />
          ))}
          <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${s.border} ${s.text} shrink-0`}>
            Q{strategy.qualityScore}
          </span>
          <span className="text-dim text-xs ml-1">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-border px-4 py-4 space-y-4 bg-bg">
          {/* Reason */}
          <div>
            <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Analysis</div>
            <p className="font-body text-sm text-soft leading-relaxed">{strategy.reason}</p>
          </div>

          {/* Long trades */}
          {strategy.longTrades?.length > 0 && (
            <div>
              <div className="font-mono text-[10px] text-green uppercase tracking-widest mb-2">Long Trades</div>
              <div className="flex flex-wrap gap-2">
                {strategy.longTrades.map(s => (
                  <div key={s.symbol} className="bg-green/5 border border-green/20 rounded px-3 py-1.5">
                    <div className="font-mono text-xs text-green font-semibold">{s.symbol}</div>
                    <div className="font-mono text-[10px] text-dim">{s.win_rate}% WR · {s.avg_return > 0 ? "+" : ""}{s.avg_return?.toFixed(1)}% avg</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Short trades */}
          {strategy.shortTrades?.length > 0 && (
            <div>
              <div className="font-mono text-[10px] text-red uppercase tracking-widest mb-2">Short Trades</div>
              <div className="flex flex-wrap gap-2">
                {strategy.shortTrades.map(s => (
                  <div key={s.symbol} className="bg-red/5 border border-red/20 rounded px-3 py-1.5">
                    <div className="font-mono text-xs text-red font-semibold">{s.symbol}</div>
                    <div className="font-mono text-[10px] text-dim">{s.win_rate}% WR · {s.avg_return?.toFixed(1)}% avg</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Paired trade */}
          {strategy.pairedTrade && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
              <div className="font-mono text-[10px] text-accent uppercase tracking-widest mb-2">Paired Trade</div>
              <div className="font-mono text-[11px] text-soft">{strategy.pairedTrade.combinedEdge}</div>
            </div>
          )}

          {/* Macro check */}
          <div className="bg-card border border-border rounded p-3">
            <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Macro Check</div>
            <p className="font-mono text-[11px] text-soft">{strategy.macroCheck}</p>
          </div>

          {/* Data quality warning */}
          {strategy.dataQualityWarning && (
            <div className="font-mono text-[11px] text-amber bg-amber/5 border border-amber/20 rounded p-2">
              {strategy.dataQualityWarning}
            </div>
          )}

          {/* Quality stocks count */}
          <div className="font-mono text-[10px] text-muted">
            {strategy.totalQualityStocks} stocks passed 10-year data filter · {strategy.totalScanned} total scanned
          </div>
        </div>
      )}
    </div>
  );
}

export default function SectorRotationPage() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    fetch("/api/strategies")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const strategies = data?.strategies || [];
  const currentStrategy = strategies.find(s => s.month === CURRENT_MONTH);

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">Sector Rotation</div>
          <h1 className="font-display text-3xl font-bold text-text">
            Strategy Calendar<span className="text-accent">.</span>
          </h1>
          <p className="font-body text-sm text-dim mt-1">
            Monthly trade recommendations filtered for 10+ years of data quality.
          </p>
        </div>

        {/* Current month highlight */}
        {currentStrategy && !loading && (
          <div className={`mb-6 p-4 rounded-lg border ${ACTION_STYLES[currentStrategy.action]?.bg} ${ACTION_STYLES[currentStrategy.action]?.border}`}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
              <span className="font-mono text-[10px] text-dim uppercase tracking-widest">This month — {currentStrategy.monthName}</span>
              <ActionBadge action={currentStrategy.action} />
            </div>
            <div className="flex flex-wrap gap-2">
              {currentStrategy.longTrades?.map(s => (
                <StockPill key={s.symbol} stock={s} side="long" />
              ))}
              {currentStrategy.shortTrades?.map(s => (
                <StockPill key={s.symbol} stock={s} side="short" />
              ))}
              {currentStrategy.longTrades?.length === 0 && currentStrategy.shortTrades?.length === 0 && (
                <span className="font-mono text-[11px] text-dim">No high-conviction setups this month</span>
              )}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-3 py-16 justify-center">
            <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-sm text-dim">Loading 12-month strategy data…</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red/10 border border-red/20 rounded-lg p-4 font-mono text-sm text-red mb-6">
            Error: {error}
          </div>
        )}

        {/* Month cards */}
        {!loading && !error && (
          <div className="space-y-2">
            {strategies.map(strategy => (
              <MonthCard
                key={strategy.month}
                strategy={strategy}
                isActive={strategy.month === CURRENT_MONTH}
              />
            ))}
          </div>
        )}

        {/* Footer note */}
        {!loading && data && (
          <div className="mt-6 font-mono text-[10px] text-muted">
            Generated {new Date(data.generated_at).toLocaleString()} · Min {data.min_data_points} years data quality filter applied
          </div>
        )}

      </main>
    </div>
  );
}
