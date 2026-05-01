"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import SeasonalityHeatmap from "../../components/SeasonalityHeatmap";
import WinRateChart from "../../components/WinRateChart";
import StatCard from "../../components/StatCard";
import SignalBadge from "../../components/SignalBadge";
import Link from "next/link";
import { MONTHS } from "../../lib/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export default function StockPage() {
  const { symbol }   = useParams();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tab,     setTab]     = useState("overview");

  useEffect(() => {
    if (!symbol) return;
    fetch(`/api/stock/${symbol}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [symbol]);

  if (loading) return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-[200px] flex-1 p-8 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
          <span className="font-mono text-sm text-dim">Fetching real data for {symbol}…</span>
        </div>
      </main>
    </div>
  );

  if (error) return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-[200px] flex-1 p-8">
        <div className="bg-red/10 border border-red/20 rounded-lg p-4 font-mono text-sm text-red">{error}</div>
      </main>
    </div>
  );

  const prices     = data?.prices     || [];
  const seasonality = data?.seasonality || [];

  // Price chart data
  const chartData = prices.slice(-60).map(p => ({
    date:   p.date,
    close:  p.close,
    return: p.return_pct,
  }));

  // Best / worst months
  const sortedBest  = [...seasonality].sort((a,b) => (b.win_rate||0) - (a.win_rate||0)).slice(0,3);
  const sortedWorst = [...seasonality].sort((a,b) => (a.win_rate||0) - (b.win_rate||0)).slice(0,3);

  const totalReturn = prices.length >= 2
    ? ((prices[prices.length-1].close - prices[0].close) / prices[0].close * 100).toFixed(1)
    : null;

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-card border border-border rounded px-3 py-2 font-mono text-xs">
        <div className="text-dim">{d.date}</div>
        <div className="text-text">₹{d.close?.toLocaleString("en-IN")}</div>
        {d.return !== null && (
          <div className={d.return >= 0 ? "text-green" : "text-red"}>
            {d.return >= 0 ? "+" : ""}{d.return?.toFixed(2)}%
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-[200px] flex-1 p-8">

        {/* Breadcrumb */}
        <div className="font-mono text-[11px] text-dim mb-4">
          <Link href="/rankings" className="hover:text-accent transition-colors">Rankings</Link>
          <span className="mx-2">›</span>
          <span className="text-text">{symbol}</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="font-display text-4xl font-bold text-accent tracking-tight">{symbol}</h1>
            <div className="font-mono text-xs text-dim mt-1">
              NSE F&O · {data?.exchange} · {data?.data_points} monthly records · {data?.start_year}–{data?.end_year}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-medium text-text">
              ₹{prices[prices.length-1]?.close?.toLocaleString("en-IN")}
            </div>
            <div className="font-mono text-xs text-dim">{prices[prices.length-1]?.date}</div>
            {data?.lot_size && (
              <div className="font-mono text-[11px] text-dim mt-1">
                Lot: <span className="text-soft">{data.lot_size?.toLocaleString("en-IN")} shares</span>
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total return" value={totalReturn ? `+${totalReturn}%` : "—"} sub="2009 to present" color="text-green" />
          <StatCard label="Data points" value={data?.data_points} sub="Monthly closes" />
          <StatCard label="Best month" value={sortedBest[0]?.month} sub={`${sortedBest[0]?.win_rate}% win rate`} color="text-green" />
          <StatCard label="Worst month" value={sortedWorst[0]?.month} sub={`${sortedWorst[0]?.win_rate}% win rate`} color="text-red" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-border">
          {["overview","heatmap","seasonality","returns"].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`font-mono text-[11px] px-4 py-2.5 capitalize transition-colors border-b-2 -mb-[1px] ${
                tab === t
                  ? "border-accent text-accent"
                  : "border-transparent text-dim hover:text-text"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {tab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Price chart */}
            <div className="bg-card border border-border rounded-lg p-5 lg:col-span-2">
              <h2 className="font-display text-sm font-semibold text-text mb-4">Price History (Monthly)</h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "IBM Plex Mono", fill: "#6B7280" }}
                    tickLine={false} axisLine={false} interval={11} />
                  <YAxis tick={{ fontSize: 10, fontFamily: "IBM Plex Mono", fill: "#6B7280" }}
                    tickLine={false} axisLine={false} width={60}
                    tickFormatter={v => `₹${v >= 1000 ? (v/1000).toFixed(1)+"k" : v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="close" stroke="#00D4FF" strokeWidth={1.5}
                    dot={false} activeDot={{ r: 3, fill: "#00D4FF" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Best months */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-display text-sm font-semibold text-text mb-4">Best Months</h2>
              <div className="space-y-3">
                {sortedBest.map(s => (
                  <div key={s.month} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-dim w-7">{s.month}</span>
                      <SignalBadge winRate={s.win_rate} />
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs text-green">{s.win_rate}% WR</div>
                      <div className="font-mono text-[10px] text-dim">avg +{s.avg_return}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Worst months */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-display text-sm font-semibold text-text mb-4">Worst Months</h2>
              <div className="space-y-3">
                {sortedWorst.map(s => (
                  <div key={s.month} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-dim w-7">{s.month}</span>
                      <SignalBadge winRate={s.win_rate} />
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs text-red">{s.win_rate}% WR</div>
                      <div className="font-mono text-[10px] text-dim">avg {s.avg_return}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Heatmap tab */}
        {tab === "heatmap" && (
          <div className="bg-card border border-border rounded-lg p-5">
            <h2 className="font-display text-sm font-semibold text-text mb-4">
              Year × Month Return Heatmap
            </h2>
            <SeasonalityHeatmap data={prices} />
          </div>
        )}

        {/* Seasonality tab */}
        {tab === "seasonality" && (
          <div className="bg-card border border-border rounded-lg p-5">
            <h2 className="font-display text-sm font-semibold text-text mb-4">
              Monthly Win Rate & Average Return
            </h2>
            <div className="flex items-center gap-6 mb-4 font-mono text-[10px] text-dim">
              <span>Month</span>
              <span className="ml-8">Win rate</span>
              <span className="ml-auto">Avg return</span>
              <span className="w-16 text-right">Pos/Total</span>
            </div>
            <WinRateChart seasonality={seasonality} />
          </div>
        )}

        {/* Returns tab */}
        {tab === "returns" && (
          <div className="bg-card border border-border rounded-lg p-5">
            <h2 className="font-display text-sm font-semibold text-text mb-4">
              Monthly Returns — Full History
            </h2>
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full font-mono text-[11px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-dim font-normal">Date</th>
                    <th className="text-right py-2 px-3 text-dim font-normal">Close (₹)</th>
                    <th className="text-right py-2 px-3 text-dim font-normal">Return %</th>
                  </tr>
                </thead>
                <tbody>
                  {[...prices].reverse().map(p => (
                    <tr key={p.date} className="table-row">
                      <td className="py-1.5 px-3 text-dim">{p.date}</td>
                      <td className="py-1.5 px-3 text-right text-soft">
                        ₹{p.close?.toLocaleString("en-IN")}
                      </td>
                      <td className={`py-1.5 px-3 text-right ${
                        p.return_pct === null ? "text-muted" :
                        p.return_pct >= 0 ? "text-green" : "text-red"
                      }`}>
                        {p.return_pct === null ? "—" :
                          `${p.return_pct >= 0 ? "+" : ""}${p.return_pct.toFixed(2)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
