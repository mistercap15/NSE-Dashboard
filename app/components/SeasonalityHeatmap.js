"use client";
import { MONTHS, getHeatmapColor } from "../lib/api";
import { useState } from "react";

export default function SeasonalityHeatmap({ data, onCellClick }) {
  const [tooltip, setTooltip] = useState(null);

  if (!data || data.length === 0) return (
    <div className="text-dim font-mono text-xs p-4">No heatmap data available</div>
  );

  // data = array of { date: "YYYY-MM", close, return_pct }
  const years = [...new Set(data.map(d => d.date?.split("-")[0]))].sort();

  const grid = {};
  data.forEach(d => {
    if (!d.date) return;
    const [yr, mo] = d.date.split("-");
    if (!grid[yr]) grid[yr] = {};
    grid[yr][parseInt(mo)] = d.return_pct;
  });

  return (
    <div className="overflow-x-auto relative">
      {tooltip && (
        <div className="absolute top-0 right-0 bg-card border border-border rounded px-3 py-2 font-mono text-xs z-10 pointer-events-none">
          <div className="text-soft">{tooltip.label}</div>
          <div className={tooltip.val >= 0 ? "text-green" : "text-red"}>
            {tooltip.val >= 0 ? "+" : ""}{tooltip.val?.toFixed(2)}%
          </div>
        </div>
      )}
      <table className="text-[10px] font-mono border-separate border-spacing-[2px]">
        <thead>
          <tr>
            <th className="text-dim text-left pr-3 pb-1 font-normal w-12">Year</th>
            {MONTHS.map(m => (
              <th key={m} className="text-dim font-normal text-center w-9 pb-1">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map(yr => (
            <tr key={yr}>
              <td className="text-dim pr-3 font-medium">{yr}</td>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(mo => {
                const val = grid[yr]?.[mo];
                const color = getHeatmapColor(val);
                const disp  = val !== undefined && val !== null
                  ? `${val >= 0 ? "+" : ""}${val.toFixed(1)}`
                  : "–";
                const textColor = val !== null && val !== undefined
                  ? Math.abs(val) > 6 ? "#fff"
                  : val >= 0 ? "#6EE7B7" : "#FCA5A5"
                  : "#374151";
                return (
                  <td key={mo}
                    className="heatmap-cell text-center rounded-[3px] cursor-pointer"
                    style={{ background: color, color: textColor, width: 36, height: 22, minWidth: 36 }}
                    onMouseEnter={() => setTooltip({ label: `${yr} ${MONTHS[mo-1]}`, val })}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => onCellClick?.({ year: yr, month: mo, value: val })}
                  >
                    {disp}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3">
        <span className="text-dim text-[10px] font-mono">Return:</span>
        {[
          { color: "rgb(0,190,100)",  label: ">10%" },
          { color: "rgb(0,130,70)",   label: "+5%" },
          { color: "#1E2A3E",         label: "~0%" },
          { color: "rgb(180,20,30)",  label: "-5%" },
          { color: "rgb(239,20,30)",  label: "<-10%" },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className="w-4 h-3 rounded-[2px]" style={{ background: l.color }} />
            <span className="text-dim text-[10px] font-mono">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
