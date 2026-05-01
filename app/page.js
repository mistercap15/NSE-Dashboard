import Sidebar from "./components/Sidebar";
import StatCard from "./components/StatCard";
import SignalBadge from "./components/SignalBadge";
import Link from "next/link";
import { MONTHS, MONTH_FULL } from "./lib/api";

const currentMonth  = new Date().getMonth() + 1;
const currentYear   = new Date().getFullYear();
const nextMonth     = currentMonth === 12 ? 1 : currentMonth + 1;

// Static overview stats (dynamic data comes from /rankings page)
const OVERVIEW_STATS = [
  { label: "F&O Stocks",    value: "205",        sub: "NSE listed",     color: "text-accent" },
  { label: "Data points",   value: "~40,000",    sub: "Monthly records", color: "text-text" },
  { label: "History",       value: "16+ yrs",    sub: "2009–2025",      color: "text-text" },
  { label: "Data source",   value: "Real NSE",   sub: "GOOGLEFINANCE",  color: "text-green" },
];

const QUICK_ACTIONS = [
  { label: "View June rankings",    href: "/rankings?month=6",  desc: "Top F&O stocks for June" },
  { label: "Full year calendar",    href: "/calendar",           desc: "12-month ranking grid" },
  { label: "Screen by sector",      href: "/screener",           desc: "Filter by Pharma, IT, FMCG…" },
  { label: "Portfolio P&L",         href: "/portfolio",          desc: "Calculate expected returns" },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />

      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">

        {/* Header */}
        <div className="mb-8">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">
            NSE Monthly Stock Ranking System
          </div>
          <h1 className="font-display text-3xl font-bold text-text tracking-tight">
            F&O Seasonality<span className="text-accent">.</span>
          </h1>
          <p className="font-body text-sm text-dim mt-2 max-w-lg">
            Real historical data for 205 NSE F&O stocks. Find the highest win-rate stocks
            for every month. Trade with a statistical edge.
          </p>
        </div>

        {/* Current month banner */}
        <div className="mb-6 rounded-lg border border-accent/20 bg-accent/5 px-5 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-mono text-[10px] text-accent uppercase tracking-widest mb-1">
              Current month
            </div>
            <div className="font-display text-xl font-bold text-text">
              {MONTH_FULL[currentMonth - 1]} {currentYear}
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link
              href={`/rankings?month=${currentMonth}`}
              className="font-mono text-xs bg-accent/10 border border-accent/30 text-accent px-4 py-2 rounded hover:bg-accent/20 transition-colors"
            >
              View {MONTHS[currentMonth - 1]} Rankings →
            </Link>
            <Link
              href={`/rankings?month=${nextMonth}`}
              className="font-mono text-xs bg-border text-dim px-4 py-2 rounded hover:text-text transition-colors"
            >
              Prep for {MONTHS[nextMonth - 1]} →
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {OVERVIEW_STATS.map(s => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>

        {/* Two column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

          {/* Monthly signals preview */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-base font-semibold text-text">Monthly Signals</h2>
              <Link href="/calendar" className="font-mono text-[11px] text-accent hover:text-white transition-colors">
                Full calendar →
              </Link>
            </div>
            <div className="space-y-2">
              {MONTHS.map((m, i) => {
                // Static signal hints (real data loads on Rankings page)
                const STATIC_SIGNALS = [
                  { wr: 58, avg: 2.21 }, { wr: 50, avg: 1.07 }, { wr: 67, avg: 2.59 },
                  { wr: 67, avg: 2.71 }, { wr: 65, avg: 4.34 }, { wr: 71, avg: 2.87 },
                  { wr: 59, avg: 2.51 }, { wr: 71, avg: 2.87 }, { wr: 71, avg: 3.59 },
                  { wr: 71, avg: 3.40 }, { wr: 53, avg: 2.33 }, { wr: 71, avg: 1.31 },
                ];
                const sig = STATIC_SIGNALS[i];
                const isCurrent = i + 1 === currentMonth;
                return (
                  <Link
                    key={m}
                    href={`/rankings?month=${i + 1}`}
                    className={`flex items-center gap-3 px-3 py-2 rounded transition-colors ${
                      isCurrent
                        ? "bg-accent/5 border border-accent/10"
                        : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <span className={`font-mono text-[11px] w-7 ${isCurrent ? "text-accent" : "text-dim"}`}>
                      {m}
                    </span>
                    <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${sig.wr}%`,
                          background: sig.wr >= 80 ? "#10B981" : sig.wr >= 65 ? "#F59E0B" : "#EF4444"
                        }}
                      />
                    </div>
                    <span className={`font-mono text-[11px] w-10 text-right ${
                      sig.avg >= 0 ? "text-green" : "text-red"
                    }`}>
                      {sig.avg >= 0 ? "+" : ""}{sig.avg.toFixed(1)}%
                    </span>
                    <span className="text-[10px] font-mono text-dim w-9 text-right">{sig.wr}%</span>
                    {isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Quick actions */}
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-display text-base font-semibold text-text mb-4">Quick Actions</h2>
              <div className="space-y-2">
                {QUICK_ACTIONS.map(a => (
                  <Link
                    key={a.href}
                    href={a.href}
                    className="flex items-center justify-between px-3 py-3 rounded border border-border hover:border-accent/30 hover:bg-accent/5 transition-all group"
                  >
                    <div>
                      <div className="font-body text-sm text-text group-hover:text-accent transition-colors">
                        {a.label}
                      </div>
                      <div className="font-mono text-[10px] text-dim">{a.desc}</div>
                    </div>
                    <span className="text-dim group-hover:text-accent transition-colors">→</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* How to use */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-display text-base font-semibold text-text mb-3">How to use</h2>
              <ol className="space-y-2">
                {[
                  "Open Rankings → select the upcoming month",
                  "Review top stocks by win rate + avg return",
                  "Filter by sector to find your preferred segment",
                  "Click a stock for full seasonality deep dive",
                  "Add to Portfolio to compute expected P&L",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="font-mono text-[10px] text-accent mt-0.5 shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-body text-[12px] text-dim">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
