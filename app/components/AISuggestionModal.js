"use client";
import { useEffect } from "react";
import Link from "next/link";
import { X, Sparkles, TrendingUp, TrendingDown, ShieldCheck } from "lucide-react";

function ConvictionBar({ value, direction }) {
  const pct = Math.round(value);
  const color = direction === "LONG" ? "bg-green" : "bg-red";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] text-soft tabular-nums w-9 text-right">{pct}</span>
    </div>
  );
}

function ConfidencePill({ level }) {
  const cls = level === "High"
    ? "text-green border-green/30 bg-green/10"
    : level === "Medium"
      ? "text-amber border-amber/30 bg-amber/10"
      : "text-dim border-border bg-card";
  return (
    <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
      {level} conf
    </span>
  );
}

function PickCard({ pick, rank }) {
  const isLong = pick.direction === "LONG";
  const Icon = isLong ? TrendingUp : TrendingDown;
  const dirColor = isLong ? "text-green" : "text-red";
  return (
    <div className="bg-bg border border-border rounded-lg p-3.5 hover:border-muted transition-colors">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] text-muted w-4">{rank}</span>
          <Icon size={14} className={dirColor} />
          <Link
            href={`/stock/${pick.symbol}`}
            className="font-mono text-[14px] font-semibold text-accent hover:text-text transition-colors truncate"
          >
            {pick.symbol}
          </Link>
          <span className="font-body text-[11px] text-dim truncate hidden sm:inline">{pick.sector}</span>
        </div>
        <ConfidencePill level={pick.confidence} />
      </div>

      <div className="mb-2.5"><ConvictionBar value={pick.conviction} direction={pick.direction} /></div>

      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {pick.reasons.map((r, i) => (
          <span
            key={i}
            className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${
              r.startsWith("⚠")
                ? "text-amber border-amber/25 bg-amber/5"
                : "text-soft border-border bg-card"
            }`}
          >
            {r}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-3 font-mono text-[10px] text-dim">
        <span>WR <span className="text-soft">{(pick.win_rate || 0).toFixed(0)}%</span></span>
        <span>Avg <span className={isLong ? "text-green" : "text-red"}>{(pick.avg_return || 0) >= 0 ? "+" : ""}{(pick.avg_return || 0).toFixed(1)}%</span></span>
        <span className="flex items-center gap-1"><ShieldCheck size={11} className="text-dim" />SL <span className="text-amber">{pick.stopPct.toFixed(1)}%</span></span>
      </div>
    </div>
  );
}

export default function AISuggestionModal({ result, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!result) return null;
  const { best, longs, shorts, monthName, generatedAt } = result;
  const hasPicks = longs.length > 0 || shorts.length > 0;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
              <Sparkles size={15} className="text-accent" />
            </div>
            <div>
              <div className="font-display text-base font-semibold text-text leading-tight">
                AI Trade Suggestions
              </div>
              <div className="font-mono text-[10px] text-dim">
                {monthName} · {generatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-border text-dim hover:text-text hover:border-muted flex items-center justify-center transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          {!hasPicks && (
            <div className="text-center py-12">
              <div className="font-mono text-sm text-dim mb-1">No high-conviction trades this month</div>
              <div className="font-mono text-[11px] text-muted">
                Nothing cleared the quality bar for {monthName}. Try relaxing the “Min data” filter.
              </div>
            </div>
          )}

          {/* Hero — single best trade */}
          {best && (
            <div className="mb-6 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 to-transparent p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={13} className="text-accent" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-accent">
                  Top conviction trade
                </span>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
                <span className={`font-mono text-[11px] font-semibold ${best.direction === "LONG" ? "text-green" : "text-red"}`}>
                  {best.direction === "LONG" ? "↑ BUY" : "↓ SHORT"}
                </span>
                <Link href={`/stock/${best.symbol}`} className="font-display text-2xl font-bold text-text hover:text-accent transition-colors">
                  {best.symbol}
                </Link>
                <span className="font-mono text-[11px] text-soft">conviction {Math.round(best.conviction)}/100</span>
                <ConfidencePill level={best.confidence} />
              </div>
              <p className="font-body text-[13px] text-soft">{best.summary}</p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-5">
            {/* Longs */}
            {longs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-green" />
                  <h3 className="font-display text-sm font-semibold text-text">Best Longs</h3>
                  <span className="font-mono text-[10px] text-dim">{longs.length}</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {longs.map((p, i) => <PickCard key={p.symbol} pick={p} rank={i + 1} />)}
                </div>
              </div>
            )}

            {/* Shorts */}
            {shorts.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-red" />
                  <h3 className="font-display text-sm font-semibold text-text">Best Shorts</h3>
                  <span className="font-mono text-[10px] text-dim">{shorts.length}</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {shorts.map((p, i) => <PickCard key={p.symbol} pick={p} rank={i + 1} />)}
                </div>
              </div>
            )}
          </div>

          <p className="mt-6 font-mono text-[10px] text-muted leading-relaxed">
            Conviction blends seasonal win-rate, years of history, median-vs-average consistency, and
            risk/reward from best/worst months. Rule-based seasonal analysis — not financial advice.
          </p>
        </div>
      </div>
    </div>
  );
}
