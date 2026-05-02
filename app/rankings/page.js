"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Sidebar from "../components/Sidebar";
import RankingsTable from "../components/RankingsTable";
import StatCard from "../components/StatCard";
import { MONTHS, MONTH_FULL, SECTORS, getSignalLabel } from "../lib/api";
import { RankingsPDFButton } from "../components/PDFDownloadButton";
import ShortCandidatesTable from "../components/ShortCandidatesTable";

const CURRENT_MONTH = new Date().getMonth() + 1;

function RankingsContent() {
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const [month,     setMonth]     = useState(parseInt(searchParams.get("month") || CURRENT_MONTH));
  const [sector,    setSector]    = useState("ALL");
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [direction, setDirection] = useState("LONG"); // "LONG" or "SHORT"
  const [minYears,  setMinYears]  = useState(0);

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

  const top    = data?.top_stocks       || [];
  const avoid  = data?.avoid_stocks     || [];
  const short  = data?.short_candidates || [];
  const total  = data?.total_stocks     || 0;
  const mName  = MONTH_FULL[month - 1];

  // Derive per-month years from data_points (same logic as RankingsTable)
  const stockYears = (s) => s.win_rate > 0
    ? Math.round((s.positive_years || 0) / (s.win_rate / 100))
    : Math.round((s.data_points || 0) / 12);

  const topF   = minYears > 0 ? top.filter(s => stockYears(s) >= minYears)   : top;
  const avoidF = minYears > 0 ? avoid.filter(s => stockYears(s) >= minYears) : avoid;
  const shortF = minYears > 0 ? short.filter(s => stockYears(s) >= minYears) : short;

  const perfect  = topF.filter(s => s.win_rate === 100).length;
  const avgWR    = topF.length > 0 ? (topF.slice(0,10).reduce((a,s) => a + s.win_rate, 0) / Math.min(topF.length,10)).toFixed(1) : "—";
  const avgRet   = topF.length > 0 ? (topF.slice(0,10).reduce((a,s) => a + (s.avg_return||0), 0) / Math.min(topF.length,10)).toFixed(2) : "—";

  // Short stats (use filtered)
  const zeroWR    = shortF.filter(s => s.win_rate === 0).length;
  const avgNegRet = shortF.length > 0
    ? (shortF.reduce((a, s) => a + (s.avg_return || 0), 0) / shortF.length).toFixed(2)
    : "—";
  const bestProb  = shortF.length > 0
    ? Math.max(...shortF.map(s => s.short_win_prob || 0)).toFixed(1)
    : "—";

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
          {data && !loading && <div className="mb-0.5"><RankingsPDFButton month={month} data={data} /></div>}
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

      {/* Direction toggle + Min Years filter */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setDirection("LONG")}
            className={`px-5 py-2 font-mono text-sm transition-colors ${
              direction === "LONG"
                ? "bg-green/15 text-green border-r border-border"
                : "text-dim hover:text-text border-r border-border"
            }`}
          >
            ↑ Long
          </button>
          <button
            onClick={() => setDirection("SHORT")}
            className={`px-5 py-2 font-mono text-sm transition-colors ${
              direction === "SHORT"
                ? "bg-red/15 text-red"
                : "text-dim hover:text-text"
            }`}
          >
            ↓ Short
          </button>
        </div>
        <span className="font-mono text-[10px] text-muted hidden sm:block">
          {direction === "LONG"
            ? "Stocks with highest seasonal buy probability"
            : "Stocks with highest seasonal short probability"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10px] text-dim uppercase tracking-widest whitespace-nowrap">
            Min data
          </span>
          <select
            value={minYears}
            onChange={e => setMinYears(Number(e.target.value))}
            className="bg-bg border border-border rounded-lg px-3 py-1.5 font-mono text-[11px] text-dim focus:border-accent focus:outline-none transition-colors cursor-pointer"
          >
            <option value={0}>All years</option>
            <option value={5}>5+ years</option>
            <option value={10}>10+ years</option>
            <option value={15}>15+ years</option>
            <option value={20}>20+ years</option>
            <option value={25}>25+ years</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      {direction === "LONG" ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Stocks scanned" value={topF.length || "—"} sub={minYears > 0 ? `${minYears}+ yr filter` : "F&O stocks"} />
          <StatCard label="Perfect (100%)" value={perfect} sub="Never negative" color="text-green" />
          <StatCard label="Top 10 avg WR" value={topF.length ? `${avgWR}%` : "—"} sub="Win rate" color="text-accent" />
          <StatCard label="Top 10 avg ret" value={topF.length ? `+${avgRet}%` : "—"} sub="Avg monthly return" color="text-green" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Short candidates" value={shortF.length || "—"} sub={minYears > 0 ? `${minYears}+ yr filter` : "Historical weak stocks"} />
          <StatCard label="0% win rate" value={zeroWR} sub="Never positive" color="text-red" />
          <StatCard label="Avg neg return" value={shortF.length ? `${avgNegRet}%` : "—"} sub="Avg monthly return" color="text-red" />
          <StatCard label="Best short prob" value={shortF.length ? `${bestProb}%` : "—"} sub="Highest short probability" color="text-amber" />
        </div>
      )}

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

      {/* Content — conditional on direction */}
      {!loading && direction === "LONG" && topF.length > 0 && (
        <>
          <div className="bg-card border border-border rounded-lg mb-6 overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-2 h-2 rounded-full bg-green shrink-0" />
                <h2 className="font-display text-base font-semibold text-text truncate">
                  Top Picks — {mName}
                </h2>
                <span className="font-mono text-[10px] text-dim shrink-0">{topF.length} stocks</span>
              </div>
              <span className="font-mono text-[10px] text-dim shrink-0 hidden sm:block">
                Ranked by composite score (WR×0.6 + Avg×4)
              </span>
            </div>
            <RankingsTable stocks={topF} />
          </div>

          {avoidF.length > 0 && (
            <div className="bg-card border border-red/10 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-red/10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-red shrink-0" />
                  <h2 className="font-display text-base font-semibold text-text truncate">
                    Avoid in {mName}
                  </h2>
                  <span className="font-mono text-[10px] text-dim shrink-0">{avoidF.length} stocks</span>
                </div>
                <span className="font-mono text-[10px] text-dim shrink-0 hidden sm:block">
                  Short-sell candidates — worst historical performers
                </span>
              </div>
              <RankingsTable stocks={avoidF} />
            </div>
          )}
        </>
      )}

      {!loading && direction === "SHORT" && (
        <div className="bg-card border border-red/20 rounded-lg mb-6 overflow-hidden">
          <div className="px-5 py-3 border-b border-red/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-red" />
              <h2 className="font-display text-base font-semibold text-text">
                Short Candidates — {mName}
              </h2>
              <span className="font-mono text-[10px] text-dim">
                {shortF.length} stocks
              </span>
            </div>
            <span className="font-mono text-[10px] text-red hidden sm:block">
              Sell futures on these — historically weak in {mName}
            </span>
          </div>
          <ShortCandidatesTable stocks={shortF} />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && direction === "LONG" && topF.length === 0 && (
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
