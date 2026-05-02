"use client"
import Link from "next/link"

export default function ShortCandidatesTable({ stocks }) {
  if (!stocks || stocks.length === 0) return (
    <div className="text-dim font-mono text-sm p-8 text-center">
      No short candidates found for this month
    </div>
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-red/10">
            {[
              "#", "Symbol", "Sector",
              "Short Win Prob",
              "Avg Return",
              "Best (worst case squeeze)",
              "Worst (best case for us)",
              "Lot", "Suggested SL", "Signal"
            ].map(h => (
              <th key={h}
                className="text-right first:text-left py-2.5 px-3
                  font-mono text-[11px] text-dim font-normal whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stocks.map((s, i) => (
            <tr key={s.symbol} className="table-row group border-b border-red/5">
              <td className="py-2.5 px-3 font-mono text-[11px] text-muted">{i + 1}</td>
              <td className="py-2.5 px-3">
                <Link
                  href={`/stock/${s.symbol}`}
                  className="font-mono text-[13px] font-medium text-red
                    hover:text-white transition-colors"
                >
                  {s.symbol}
                </Link>
              </td>
              <td className="py-2.5 px-3 font-body text-[12px] text-dim">{s.sector}</td>
              {/* Short win probability */}
              <td className="py-2.5 px-3 font-mono text-[12px] text-right">
                <span className={
                  s.short_win_prob >= 70 ? "text-red font-medium" :
                  s.short_win_prob >= 55 ? "text-amber" : "text-dim"
                }>
                  {s.short_win_prob?.toFixed(1)}%
                </span>
                {(() => {
                  // data_points = total monthly closes (e.g. 180 for 15 yrs),
                  // so derive per-month count the same way RankingsTable does
                  const totalYrs = s.win_rate > 0
                    ? Math.round((s.positive_years || 0) / (s.win_rate / 100))
                    : Math.round((s.data_points || 0) / 12)
                  const negYrs = totalYrs - (s.positive_years || 0)
                  return (
                    <span className="text-muted text-[10px] ml-1">
                      ({negYrs}/{totalYrs} neg yrs)
                    </span>
                  )
                })()}
              </td>
              {/* Avg return - negative is good for short */}
              <td className={`py-2.5 px-3 font-mono text-[12px] text-right ${
                (s.avg_return || 0) < 0 ? "text-red font-medium" : "text-dim"
              }`}>
                {(s.avg_return || 0) >= 0 ? "+" : ""}{(s.avg_return || 0).toFixed(2)}%
              </td>
              {/* Best month = worst case squeeze */}
              <td className="py-2.5 px-3 font-mono text-[11px] text-right text-amber">
                +{(s.best || 0).toFixed(1)}%
              </td>
              {/* Worst month = our best case profit */}
              <td className="py-2.5 px-3 font-mono text-[11px] text-right text-green">
                {(s.worst || 0).toFixed(1)}%
              </td>
              <td className="py-2.5 px-3 font-mono text-[11px] text-right text-dim">
                {s.lot_size?.toLocaleString("en-IN") || "—"}
              </td>
              {/* Short SL = above entry */}
              <td className="py-2.5 px-3 font-mono text-[12px] text-right text-amber">
                +{(s.short_sl_pct || 0).toFixed(1)}%
              </td>
              {/* Signal */}
              <td className="py-2.5 px-3 text-center">
                <span className={`badge ${
                  s.short_win_prob >= 70 ? "badge-avoid" :
                  s.short_win_prob >= 55 ? "badge-weak" : "badge-neutral"
                }`}>
                  {s.short_win_prob >= 70 ? "STRONG SHORT" :
                   s.short_win_prob >= 55 ? "MILD SHORT" : "WEAK SHORT"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Short disclaimer note */}
      <div className="px-5 py-3 border-t border-red/10 bg-red/[0.02]">
        <p className="font-mono text-[10px] text-muted">
          Short Win Prob = % of years this month was NEGATIVE for this stock.
          Best (squeeze risk) = highest single month return ever — your worst case as a short seller.
          Suggested SL = 1.3× the best month return, placed ABOVE your entry price.
          Never short a stock in its quarterly results month (Jan/Apr/Jul/Oct) — earnings can override any seasonality.
        </p>
      </div>
    </div>
  )
}
