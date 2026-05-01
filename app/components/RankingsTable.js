"use client";
import Link from "next/link";
import SignalBadge from "./SignalBadge";

export default function RankingsTable({ stocks, showRank = true }) {
  if (!stocks || stocks.length === 0) return (
    <div className="text-dim font-mono text-sm p-8 text-center">
      No data — run populateAllStocks() in Apps Script first
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {showRank && <th className="text-left py-2.5 px-3 font-mono text-[11px] text-dim font-normal w-10">#</th>}
            <th className="text-left py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Symbol</th>
            <th className="text-left py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Sector</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Win Rate</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Avg Return</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Best</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Worst</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Lot</th>
            <th className="text-center py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Signal</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Score</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s, i) => (
            <tr key={s.symbol} className="table-row group">
              {showRank && (
                <td className="py-2.5 px-3 font-mono text-[11px] text-muted">{i + 1}</td>
              )}
              <td className="py-2.5 px-3">
                <Link
                  href={`/stock/${s.symbol}`}
                  className="font-mono text-[13px] font-medium text-accent hover:text-white transition-colors"
                >
                  {s.symbol}
                </Link>
              </td>
              <td className="py-2.5 px-3 font-body text-[12px] text-dim">{s.sector}</td>
              <td className="py-2.5 px-3 font-mono text-[12px] text-right">
                <span className={s.win_rate >= 80 ? "text-green" : s.win_rate >= 60 ? "text-amber" : "text-red"}>
                  {s.win_rate?.toFixed(1)}%
                </span>
                <span className="text-muted text-[10px] ml-1">
                  ({s.positive_years}/{s.win_rate > 0
                    ? Math.round(s.positive_years / (s.win_rate / 100))
                    : Math.round((s.data_points || 0) / 12)})
                </span>
              </td>
              <td className={`py-2.5 px-3 font-mono text-[12px] text-right ${
                s.avg_return >= 0 ? "text-green" : "text-red"
              }`}>
                {s.avg_return >= 0 ? "+" : ""}{s.avg_return?.toFixed(2)}%
              </td>
              <td className="py-2.5 px-3 font-mono text-[11px] text-right text-green">
                +{s.best?.toFixed(1)}%
              </td>
              <td className="py-2.5 px-3 font-mono text-[11px] text-right text-red">
                {s.worst?.toFixed(1)}%
              </td>
              <td className="py-2.5 px-3 font-mono text-[11px] text-right text-dim">
                {s.lot_size?.toLocaleString("en-IN") || "—"}
              </td>
              <td className="py-2.5 px-3 text-center">
                <SignalBadge winRate={s.win_rate} signal={s.signal} />
              </td>
              <td className="py-2.5 px-3 font-mono text-[11px] text-right text-soft">
                {s.score?.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
