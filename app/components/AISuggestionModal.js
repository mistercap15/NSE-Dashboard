"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Sparkles, TrendingUp, TrendingDown, ShieldCheck, Check } from "lucide-react";

const ANALYZE_STEPS = [
  "Scanning F&O universe",
  "Scoring seasonal edge",
  "Weighing risk vs reward",
  "Ranking by conviction",
];

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

function PickCard({ pick, rank, delay = 0 }) {
  const isLong = pick.direction === "LONG";
  const Icon = isLong ? TrendingUp : TrendingDown;
  const dirColor = isLong ? "text-green" : "text-red";
  return (
    <div
      className="bg-bg border border-border rounded-lg p-3.5 hover:border-muted transition-colors animate-pop-in"
      style={{ animationDelay: `${delay}ms` }}
    >
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

function AnalyzingScreen({ total, monthName }) {
  const [step, setStep]   = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const stepTimer = setInterval(() => setStep(s => Math.min(s + 1, ANALYZE_STEPS.length)), 360);
    return () => clearInterval(stepTimer);
  }, []);

  useEffect(() => {
    if (!total) return;
    const start = performance.now();
    const dur = 1400;
    let raf;
    const tick = (t) => {
      const p = Math.min((t - start) / dur, 1);
      setCount(Math.round(p * total));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total]);

  return (
    <div className="py-10 px-2 flex flex-col items-center text-center animate-fade-in">
      {/* Sparkle in spinning ring */}
      <div className="relative w-20 h-20 mb-6">
        <div className="absolute inset-0 rounded-full border-2 border-accent/15" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-ring-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles size={26} className="text-accent animate-sparkle" style={{ filter: "drop-shadow(0 0 8px rgba(77,159,255,0.6))" }} />
        </div>
      </div>

      <div className="font-display text-lg font-semibold text-text mb-1">Analyzing {monthName}…</div>
      <div className="font-mono text-[11px] text-dim mb-6">
        Read <span className="text-accent tabular-nums">{count}</span> stocks · scoring seasonal conviction
      </div>

      {/* Indeterminate scan bar */}
      <div className="w-56 h-1 rounded-full bg-muted/30 overflow-hidden mb-7 relative">
        <div className="absolute top-0 left-0 h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent animate-scan" />
      </div>

      {/* Stepped checklist */}
      <div className="flex flex-col gap-2.5 items-start">
        {ANALYZE_STEPS.map((label, i) => {
          const done   = i < step;
          const active = i === step;
          return (
            <div key={label} className={`flex items-center gap-2.5 transition-opacity duration-300 ${i <= step ? "opacity-100" : "opacity-30"}`}>
              <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 border ${
                done ? "bg-green/15 border-green/40" : active ? "border-accent/50" : "border-border"
              }`}>
                {done
                  ? <Check size={10} className="text-green" />
                  : active
                    ? <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    : <span className="w-1.5 h-1.5 rounded-full bg-muted" />}
              </span>
              <span className={`font-mono text-[12px] ${done ? "text-soft" : active ? "text-text" : "text-dim"}`}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AISuggestionModal({ result, onClose }) {
  const [phase, setPhase] = useState("analyzing"); // "analyzing" → "done"

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    const reveal = setTimeout(() => setPhase("done"), 1700);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      clearTimeout(reveal);
    };
  }, [onClose]);

  if (!result) return null;
  const { best, longs, shorts, monthName, generatedAt, scanned } = result;
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
          {phase === "analyzing" ? (
            <AnalyzingScreen total={scanned} monthName={monthName} />
          ) : (
          <div className="animate-fade-in">
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
            <div className="mb-6 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 to-transparent p-4 animate-pop-in">
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
                  {longs.map((p, i) => <PickCard key={p.symbol} pick={p} rank={i + 1} delay={120 + i * 70} />)}
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
                  {shorts.map((p, i) => <PickCard key={p.symbol} pick={p} rank={i + 1} delay={160 + i * 70} />)}
                </div>
              </div>
            )}
          </div>

          <p className="mt-6 font-mono text-[10px] text-muted leading-relaxed">
            Conviction blends seasonal win-rate, years of history, median-vs-average consistency, and
            risk/reward from best/worst months. Rule-based seasonal analysis — not financial advice.
          </p>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
