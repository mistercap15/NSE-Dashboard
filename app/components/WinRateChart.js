"use client";
import { MONTHS } from "../lib/api";

export default function WinRateChart({ seasonality, highlightMonth }) {
  if (!seasonality || seasonality.length === 0) return null;

  const max = 100;

  return (
    <div className="space-y-1.5">
      {seasonality.map((s, i) => {
        const wr      = s.win_rate || 0;
        const avg     = s.avg_return || 0;
        const isHigh  = i === highlightMonth;
        // How many times did this specific month appear in history?
        // positive_years / (win_rate/100) gives the per-month total.
        // Fall back to data_points/12 when win_rate is 0 (no positives).
        const monthTotal = wr > 0
          ? Math.round(s.positive_years / (wr / 100))
          : Math.round((s.data_points || 0) / 12);
        const barColor =
          wr === 100 ? "#10B981" :
          wr >= 80   ? "#34D399" :
          wr >= 65   ? "#F59E0B" :
          wr >= 50   ? "#6B7280" : "#EF4444";

        return (
          <div key={s.month || MONTHS[i]}
            className={`flex items-center gap-3 rounded px-2 py-1 transition-colors ${
              isHigh ? "bg-accent/5 border border-accent/10" : "hover:bg-white/[0.02]"
            }`}
          >
            {/* Month label */}
            <div className="font-mono text-[11px] text-dim w-7 shrink-0">
              {MONTHS[i]}
            </div>

            {/* Bar */}
            <div className="flex-1 relative h-4 bg-border rounded-sm overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full rounded-sm transition-all duration-500"
                style={{ width: `${wr}%`, background: barColor, opacity: 0.8 }}
              />
              <div className="absolute inset-0 flex items-center px-2">
                <span className="font-mono text-[10px] text-text/80">{wr.toFixed(0)}%</span>
              </div>
            </div>

            {/* Avg return */}
            <div className={`font-mono text-[11px] w-14 text-right shrink-0 ${
              avg >= 0 ? "text-green" : "text-red"
            }`}>
              {avg >= 0 ? "+" : ""}{avg.toFixed(2)}%
            </div>

            {/* Pos/Neg years */}
            <div className="font-mono text-[10px] text-dim w-10 text-right shrink-0">
              {s.positive_years}/{monthTotal}
            </div>
          </div>
        );
      })}
    </div>
  );
}
