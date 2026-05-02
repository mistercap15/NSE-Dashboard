"use client";
import { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import SignalBadge from "../components/SignalBadge";
import Link from "next/link";
import { MONTHS, MONTH_FULL } from "../lib/api";

const CURRENT_MONTH = new Date().getMonth() + 1;

export default function CalendarPage() {
  const [data,      setData]      = useState(null);
  const [shortData, setShortData] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [top,       setTop]       = useState(5);

  useEffect(() => {
    // Fetch top stocks for all 12 months
    Promise.all(
      MONTHS.map((_, i) =>
        fetch(`/api/rankings?month=${i+1}&top=${top}&sector=ALL`)
          .then(r => r.json())
          .catch(() => ({ top_stocks: [] }))
      )
    ).then(results => {
      const mapped = {};
      const shortMapped = {};
      MONTHS.forEach((m, i) => {
        mapped[m]      = results[i].top_stocks      || [];
        shortMapped[m] = results[i].short_candidates || [];
      });
      setData(mapped);
      setShortData(shortMapped);
      setLoading(false);
    });
  }, [top]);

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">Full Year View</div>
          <div className="flex items-end justify-between">
            <h1 className="font-display text-3xl font-bold text-text">
              Trading Calendar<span className="text-accent">.</span>
            </h1>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-dim">Top</span>
              {[3,5,10].map(n => (
                <button key={n} onClick={() => { setTop(n); setLoading(true); }}
                  className={`font-mono text-[10px] px-2.5 py-1 rounded border transition-colors ${
                    top === n ? "bg-accent/15 border-accent/40 text-accent" : "border-border text-dim hover:text-text"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 py-20 justify-center">
            <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-sm text-dim">Loading full year rankings…</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {MONTHS.map((m, i) => {
              const stocks     = data?.[m] || [];
              const isCurrent  = i + 1 === CURRENT_MONTH;
              const avgWR      = stocks.length > 0
                ? (stocks.reduce((a,s) => a + (s.win_rate||0), 0) / stocks.length).toFixed(0)
                : null;

              return (
                <div
                  key={m}
                  className={`bg-card border rounded-lg overflow-hidden card-hover ${
                    isCurrent ? "border-accent/40" : "border-border"
                  }`}
                >
                  {/* Month header */}
                  <div className={`px-4 py-3 flex items-center justify-between ${
                    isCurrent ? "bg-accent/10 border-b border-accent/20" : "border-b border-border"
                  }`}>
                    <div>
                      <div className={`font-display text-sm font-semibold ${isCurrent ? "text-accent" : "text-text"}`}>
                        {MONTH_FULL[i]}
                      </div>
                      {avgWR && (
                        <div className="font-mono text-[10px] text-dim">avg WR {avgWR}%</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isCurrent && (
                        <div className="flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
                          <span className="font-mono text-[9px] text-green">NOW</span>
                        </div>
                      )}
                      <Link
                        href={`/rankings?month=${i+1}`}
                        className="font-mono text-[10px] text-dim hover:text-accent transition-colors"
                      >
                        All →
                      </Link>
                    </div>
                  </div>

                  {/* Stock list */}
                  <div className="p-3 space-y-1.5">
                    {stocks.length === 0 ? (
                      <div className="font-mono text-[10px] text-muted text-center py-4">
                        No data — run populateAllStocks()
                      </div>
                    ) : (
                      stocks.map((s, rank) => (
                        <Link
                          key={s.symbol}
                          href={`/stock/${s.symbol}`}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.03] transition-colors group"
                        >
                          <span className="font-mono text-[9px] text-muted w-4">{rank+1}</span>
                          <span className="font-mono text-[11px] text-accent group-hover:text-white transition-colors flex-1">
                            {s.symbol}
                          </span>
                          <span className={`font-mono text-[10px] ${
                            s.win_rate >= 80 ? "text-green" : s.win_rate >= 60 ? "text-amber" : "text-red"
                          }`}>
                            {s.win_rate?.toFixed(0)}%
                          </span>
                          <span className={`font-mono text-[10px] ${
                            s.avg_return >= 0 ? "text-green" : "text-red"
                          }`}>
                            {s.avg_return >= 0 ? "+" : ""}{s.avg_return?.toFixed(1)}%
                          </span>
                        </Link>
                      ))
                    )}

                    {/* Short candidates */}
                    {shortData?.[m] && shortData[m].length > 0 && (
                      <div className="mt-2 pt-2 border-t border-red/10">
                        <div className="font-mono text-[9px] text-red mb-1 uppercase tracking-wider">
                          Short candidates
                        </div>
                        {shortData[m].slice(0, 2).map((s) => (
                          <Link
                            key={s.symbol}
                            href={`/stock/${s.symbol}`}
                            className="flex items-center gap-2 px-2 py-1 rounded
                              hover:bg-red/[0.05] transition-colors group"
                          >
                            <span className="font-mono text-[11px] text-red group-hover:text-white
                              transition-colors flex-1">
                              {s.symbol}
                            </span>
                            <span className="font-mono text-[10px] text-red">
                              {s.short_win_prob?.toFixed(0)}% short
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
