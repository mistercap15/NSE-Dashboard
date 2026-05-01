"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Sidebar from "../components/Sidebar";
import RankingsTable from "../components/RankingsTable";
import StatCard from "../components/StatCard";
import { MONTHS, MONTH_FULL, SECTORS, getSignalLabel } from "../lib/api";

const CURRENT_MONTH = new Date().getMonth() + 1;

function RankingsContent() {
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const [month,   setMonth]   = useState(parseInt(searchParams.get("month") || CURRENT_MONTH));
  const [sector,  setSector]  = useState("ALL");
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const fetchRankings = useCallback(async (m, s) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rankings?month=${m}&sector=${s}&top=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRankings(month, sector);
    router.push(`/rankings?month=${month}`, { scroll: false });
  }, [month, sector]);

  const top    = data?.top_stocks    || [];
  const avoid  = data?.avoid_stocks  || [];
  const total  = data?.total_stocks  || 0;
  const mName  = MONTH_FULL[month - 1];

  const perfect  = top.filter(s => s.win_rate === 100).length;
  const avgWR    = top.length > 0 ? (top.slice(0,10).reduce((a,s) => a + s.win_rate, 0) / Math.min(top.length,10)).toFixed(1) : "—";
  const avgRet   = top.length > 0 ? (top.slice(0,10).reduce((a,s) => a + (s.avg_return||0), 0) / Math.min(top.length,10)).toFixed(2) : "—";

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">Monthly Rankings</div>
        <div className="flex items-end gap-4 flex-wrap">
          <h1 className="font-display text-3xl font-bold text-text">
            {mName}<span className="text-accent">.</span>
          </h1>
          {data?.last_updated && (
            <span className="font-mono text-[10px] text-muted mb-1">
              Updated: {data.last_updated}
            </span>
          )}
        </div>
      </div>

      {/* Month selector */}
      <div className="flex gap-1.5 mb-6 flex-wrap">
        {MONTHS.map((m, i) => (
          <button
            key={m}
            onClick={() => setMonth(i + 1)}
            className={`font-mono text-[11px] px-3 py-1.5 rounded border transition-all ${
              month === i + 1
                ? "bg-accent/15 border-accent/40 text-accent"
                : "bg-card border-border text-dim hover:text-text hover:border-muted"
            }`}
          >
            {m}
            {i + 1 === CURRENT_MONTH && (
              <span className="ml-1 inline-block w-1 h-1 rounded-full bg-green align-middle" />
            )}
          </button>
        ))}
      </div>

      {/* Sector filter */}
      <div className="mb-6 flex flex-col gap-2">
        <span className="font-mono text-[10px] text-dim uppercase tracking-widest">Sector:</span>
        <div className="flex gap-1.5 flex-wrap">
          {["ALL","Banking","IT","Pharma","FMCG","Auto","Defence","Energy","Cement","Real Estate","Consumer","Finance"].map(s => (
            <button
              key={s}
              onClick={() => setSector(s)}
              className={`font-mono text-[10px] px-2.5 py-1 rounded border transition-all ${
                sector === s
                  ? "bg-purple/15 border-purple/40 text-purple"
                  : "border-border text-dim hover:text-text hover:border-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Stocks scanned" value={total || "—"} sub="F&O stocks" />
        <StatCard label="Perfect (100%)" value={perfect} sub="Never negative" color="text-green" />
        <StatCard label="Top 10 avg WR" value={top.length ? `${avgWR}%` : "—"} sub="Win rate" color="text-accent" />
        <StatCard label="Top 10 avg ret" value={top.length ? `+${avgRet}%` : "—"} sub="Avg monthly return" color="text-green" />
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center gap-3 py-12 justify-center">
          <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
          <span className="font-mono text-sm text-dim">Loading {mName} rankings…</span>
        </div>
      )}
      {error && (
        <div className="bg-red/10 border border-red/20 rounded-lg p-4 font-mono text-sm text-red mb-6">
          Error: {error} — Make sure populateAllStocks() has been run in Apps Script.
        </div>
      )}

      {/* Top picks table */}
      {!loading && top.length > 0 && (
        <>
          <div className="bg-card border border-border rounded-lg mb-6 overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-2 h-2 rounded-full bg-green shrink-0" />
                <h2 className="font-display text-base font-semibold text-text truncate">
                  Top Picks — {mName}
                </h2>
                <span className="font-mono text-[10px] text-dim shrink-0">{top.length} stocks</span>
              </div>
              <span className="font-mono text-[10px] text-dim shrink-0 hidden sm:block">
                Ranked by composite score (WR×0.6 + Avg×4)
              </span>
            </div>
            <RankingsTable stocks={top} />
          </div>

          {/* Avoid section */}
          {avoid.length > 0 && (
            <div className="bg-card border border-red/10 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-red/10 flex items-center gap-3 flex-wrap">
                <div className="w-2 h-2 rounded-full bg-red shrink-0" />
                <h2 className="font-display text-base font-semibold text-text">
                  Avoid in {MONTHS[month - 1]}
                </h2>
                <span className="font-mono text-[10px] text-dim">Worst performers historically</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px] text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Symbol</th>
                      <th className="text-left py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Sector</th>
                      <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Win Rate</th>
                      <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Avg Return</th>
                      <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Worst</th>
                      <th className="text-center py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {avoid.map(s => (
                      <tr key={s.symbol} className="table-row">
                        <td className="py-2.5 px-3 font-mono text-[13px] text-red">{s.symbol}</td>
                        <td className="py-2.5 px-3 font-body text-[12px] text-dim">{s.sector}</td>
                        <td className="py-2.5 px-3 font-mono text-[12px] text-right text-red">{s.win_rate?.toFixed(1)}%</td>
                        <td className="py-2.5 px-3 font-mono text-[12px] text-right text-red">
                          {s.avg_return >= 0 ? "+" : ""}{s.avg_return?.toFixed(2)}%
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-right text-red">{s.worst?.toFixed(1)}%</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="badge badge-avoid">{getSignalLabel(s.win_rate)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!loading && !error && top.length === 0 && (
        <div className="text-center py-16 border border-border rounded-lg">
          <div className="font-mono text-sm text-dim mb-2">No ranking data found</div>
          <div className="font-mono text-[11px] text-muted">
            Run <span className="text-accent">populateAllStocks()</span> in Apps Script, then refresh.
          </div>
        </div>
      )}
    </>
  );
}

export default function RankingsPage() {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">
        <Suspense fallback={
          <div className="flex items-center gap-3 py-12 justify-center">
            <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-sm text-dim">Loading rankings…</span>
          </div>
        }>
          <RankingsContent />
        </Suspense>
      </main>
    </div>
  );
}
