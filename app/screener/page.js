"use client";
import { useState } from "react";
import Sidebar from "../components/Sidebar";
import RankingsTable from "../components/RankingsTable";
import { MONTHS } from "../lib/api";

const CURRENT_MONTH = new Date().getMonth() + 1;

export default function ScreenerPage() {
  const [month,   setMonth]   = useState(CURRENT_MONTH);
  const [sector,  setSector]  = useState("ALL");
  const [minWR,   setMinWR]   = useState(70);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);

  const SECTORS = [
    "ALL","Banking","Finance","Insurance","IT","Pharma","Healthcare",
    "FMCG","Auto","Auto Ancillary","Cap Goods","Defence","Energy",
    "Oil&Gas","Utilities","Metals","Mining","Cement","Real Estate",
    "Consumer","Retail","Telecom","Chemicals","Paints","Infra",
  ];

  const runScreen = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/rankings?month=${month}&sector=${sector}&top=100`);
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  };

  const filtered = (data?.top_stocks || []).filter(s => s.win_rate >= minWR);

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-[200px] flex-1 p-8">

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">Stock Screener</div>
          <h1 className="font-display text-3xl font-bold text-text">
            Screen & Filter<span className="text-accent">.</span>
          </h1>
          <p className="font-body text-sm text-dim mt-1">
            Filter F&O stocks by month, sector, and minimum win rate.
          </p>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-lg p-5 mb-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Month */}
            <div>
              <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-2">Month</label>
              <div className="grid grid-cols-6 gap-1">
                {MONTHS.map((m, i) => (
                  <button key={m} onClick={() => setMonth(i+1)}
                    className={`font-mono text-[10px] py-1.5 rounded border transition-colors ${
                      month === i+1
                        ? "bg-accent/15 border-accent/40 text-accent"
                        : "border-border text-dim hover:text-text"
                    }`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Sector */}
            <div>
              <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-2">Sector</label>
              <select
                value={sector}
                onChange={e => setSector(e.target.value)}
                className="w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm text-text focus:border-accent focus:outline-none"
              >
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Min Win Rate */}
            <div>
              <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-2">
                Min Win Rate: <span className="text-accent">{minWR}%</span>
              </label>
              <input type="range" min={30} max={100} value={minWR}
                onChange={e => setMinWR(parseInt(e.target.value))}
                className="w-full accent-[#00D4FF]" />
              <div className="flex justify-between font-mono text-[9px] text-muted mt-1">
                <span>30%</span><span>65%</span><span>80%</span><span>100%</span>
              </div>
            </div>
          </div>

          <button onClick={runScreen}
            className="mt-4 font-mono text-sm bg-accent/15 border border-accent/30 text-accent px-6 py-2 rounded hover:bg-accent/25 transition-colors">
            {loading ? "Screening…" : "Run Screen →"}
          </button>
        </div>

        {/* Results */}
        {loading && (
          <div className="flex items-center gap-3 py-12 justify-center">
            <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-sm text-dim">Running screen…</span>
          </div>
        )}

        {!loading && data && (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="font-display text-sm font-semibold text-text">
                  {filtered.length} stocks match
                </h2>
                <div className="font-mono text-[10px] text-dim">
                  {MONTHS[month-1]} · {sector} · WR ≥ {minWR}%
                </div>
              </div>
              {filtered.length !== (data?.top_stocks?.length || 0) && (
                <div className="font-mono text-[10px] text-dim">
                  {(data?.top_stocks?.length || 0) - filtered.length} filtered out
                </div>
              )}
            </div>
            <RankingsTable stocks={filtered} />
          </div>
        )}

        {!loading && !data && (
          <div className="text-center py-16 border border-border rounded-lg">
            <div className="font-mono text-sm text-dim mb-2">Set your filters and click Run Screen</div>
          </div>
        )}
      </main>
    </div>
  );
}
