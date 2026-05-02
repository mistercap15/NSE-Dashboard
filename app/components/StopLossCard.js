"use client"

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

export default function StopLossCard({ seasonality, currentMonth, entryPrice, symbol }) {
  // Step 1 — Get current month's data
  const monthData  = seasonality?.[currentMonth - 1]
  const worstMonth = monthData?.worst || 0

  // Step 2 — Base stop loss from worst historical loss + 20% buffer, clamped 3–15%
  const rawSL  = Math.abs(worstMonth) * 1.2
  const baseSL = Math.min(Math.max(rawSL, 3), 15)

  // Step 3 — Volatility tier
  let tier, tierColor
  if (baseSL <= 5)       { tier = "LOW";       tierColor = "text-green bg-green/10 border-green/20" }
  else if (baseSL <= 8)  { tier = "MEDIUM";    tierColor = "text-amber bg-amber/10 border-amber/20" }
  else if (baseSL <= 12) { tier = "HIGH";      tierColor = "text-orange-400 bg-orange-400/10 border-orange-400/20" }
  else                   { tier = "VERY HIGH"; tierColor = "text-red bg-red/10 border-red/20" }

  // Step 4 — Three SL levels
  const initialSL   = baseSL
  const trailingSL  = baseSL * 0.35

  // Step 5 — Price levels (only if entryPrice given)
  const ep                 = entryPrice || 0
  const initialSLPrice     = ep > 0 ? ep * (1 - initialSL / 100)         : null
  const breakevenTrigger   = ep > 0 ? ep * (1 + initialSL * 0.5 / 100)  : null
  const trailingSLTrigger  = ep > 0 ? ep * (1 + initialSL / 100)         : null

  // Step 6 — Risk/Reward
  const avgReturn  = monthData?.avg_return || 0
  const riskReward = initialSL > 0 ? avgReturn / initialSL : 0
  const rrLabel    = riskReward >= 2 ? "Excellent" : riskReward >= 1.5 ? "Good" : riskReward >= 1 ? "Acceptable" : "Poor"
  const rrColor    = riskReward >= 1.5 ? "text-green" : riskReward >= 1 ? "text-amber" : "text-red"

  const monthName  = MONTHS[(currentMonth || 1) - 1]
  const totalYears = monthData?.data_points || 0

  const fmtPrice = (n) =>
    n ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })}` : ""

  return (
    <div className="bg-card border border-border rounded-lg p-5">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-display text-base font-semibold text-text">Suggested Stop Loss</h3>
        <span className={`font-mono text-[10px] px-2.5 py-1 rounded border font-medium ${tierColor}`}>
          {tier} VOLATILITY
        </span>
      </div>

      {/* 3 SL Tier Rows */}
      <div className="space-y-3">

        {/* Row 1 — Initial SL */}
        <div className="bg-bg border border-border rounded-lg p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">
                Initial Stop Loss — Set on entry
              </div>
              <div className="font-mono text-xl font-bold text-red">
                -{initialSL.toFixed(1)}%
              </div>
              {initialSLPrice && (
                <div className="font-mono text-[11px] text-red/70 mt-0.5">
                  {fmtPrice(initialSLPrice)}
                </div>
              )}
            </div>
            <div className="font-mono text-[10px] text-muted max-w-[180px] text-right leading-relaxed">
              Exit immediately if stock falls below this from entry
            </div>
          </div>
        </div>

        {/* Row 2 — Move to Breakeven */}
        <div className="bg-bg border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1.5">
            Move to Breakeven When...
          </div>
          <div className="flex items-center justify-between">
            <div className="font-mono text-sm text-amber font-medium">
              +{(initialSL * 0.5).toFixed(1)}% in profit
              {breakevenTrigger ? ` (${fmtPrice(breakevenTrigger)})` : ""}
            </div>
            <div className="font-mono text-[10px] text-muted max-w-[200px] text-right leading-relaxed">
              Shift SL to your entry price — now you can only win or breakeven
            </div>
          </div>
        </div>

        {/* Row 3 — Trailing Stop */}
        <div className="bg-bg border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1.5">
            Trail from Peak When...
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm text-green font-medium">
                +{initialSL.toFixed(1)}% in profit
                {trailingSLTrigger ? ` (${fmtPrice(trailingSLTrigger)})` : ""}
              </div>
              <div className="font-mono text-[11px] text-dim mt-0.5">
                Trail at -{trailingSL.toFixed(1)}% below peak price
              </div>
            </div>
            <div className="font-mono text-[10px] text-muted max-w-[200px] text-right leading-relaxed">
              Lock in profits as stock rises — SL moves up with price
            </div>
          </div>
        </div>

      </div>

      {/* Risk/Reward */}
      <div className={`mt-4 font-mono text-sm font-medium ${rrColor}`}>
        Risk/Reward this month: {riskReward.toFixed(2)}:1 —{" "}
        <span className="font-normal">{rrLabel}</span>
      </div>

      {/* Time Stop */}
      <div className="mt-2 font-mono text-[11px] text-amber">
        ⏱ Time Stop: If stock hasn't moved by the 15th — exit 50% of position
      </div>

      {/* Based On */}
      <div className="mt-4 pt-4 border-t border-border space-y-0.5">
        <div className="font-mono text-[10px] text-muted">
          Based on: Worst {symbol} {monthName} on record: {worstMonth.toFixed(1)}%
        </div>
        {totalYears > 0 && (
          <div className="font-mono text-[10px] text-muted">
            Data: {totalYears} years of {monthName} history
          </div>
        )}
      </div>

    </div>
  )
}
