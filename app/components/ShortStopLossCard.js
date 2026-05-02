"use client"

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

export default function ShortStopLossCard({ seasonality, currentMonth, entryPrice, symbol }) {
  const monthData    = seasonality?.[currentMonth - 1] || {}
  const bestMonth    = monthData?.best || 0

  // SL for short = 1.3x the best positive month (squeeze protection), clamped 4–20%
  const rawSL     = Math.abs(bestMonth) * 1.3
  const shortSL   = Math.min(Math.max(rawSL, 4), 20)

  // Profit target = most negative month historically
  const profitTarget = Math.abs(monthData?.worst || 0)

  // Price levels (SL is ABOVE entry for short)
  const ep               = entryPrice || 0
  const slPrice          = ep > 0 ? ep * (1 + shortSL / 100) : null
  const breakevenTrigger = ep > 0 ? ep * (1 - shortSL * 0.5 / 100) : null
  const targetPrice      = ep > 0 ? ep * (1 - profitTarget / 100) : null

  // R:R for short
  const avgNegReturn = Math.abs(monthData?.avg_return || 0)
  const rrRatio      = shortSL > 0 ? avgNegReturn / shortSL : 0
  const rrLabel      = rrRatio >= 2 ? "Excellent" : rrRatio >= 1.5 ? "Good" : rrRatio >= 1 ? "Acceptable" : "Poor"
  const rrColor      = rrRatio >= 1.5 ? "text-green" : rrRatio >= 1 ? "text-amber" : "text-red"

  // Volatility tier
  const tier =
    shortSL <= 5  ? "LOW" :
    shortSL <= 8  ? "MEDIUM" :
    shortSL <= 12 ? "HIGH" : "VERY HIGH"

  let tierColor
  if (shortSL <= 5)       tierColor = "text-green bg-green/10 border-green/20"
  else if (shortSL <= 8)  tierColor = "text-amber bg-amber/10 border-amber/20"
  else if (shortSL <= 12) tierColor = "text-orange-400 bg-orange-400/10 border-orange-400/20"
  else                    tierColor = "text-red bg-red/10 border-red/20"

  const monthName      = MONTHS[(currentMonth || 1) - 1]
  const totalYears     = monthData?.data_points || 0
  const isResultsMonth = [1, 4, 7, 10].includes(currentMonth)

  const fmtPrice = (n) =>
    n ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })}` : ""

  return (
    <div className="bg-red/[0.03] border border-red/20 rounded-lg p-5">

      {/* Short warning banner */}
      <div className="bg-red text-white font-mono text-xs px-4 py-2 rounded-lg mb-5">
        ↓ SHORT POSITION — Stop Loss is ABOVE your entry price
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-display text-base font-semibold text-text">
          Suggested Stop Loss — Short Position
        </h3>
        <span className={`font-mono text-[10px] px-2.5 py-1 rounded border font-medium ${tierColor}`}>
          {tier} VOLATILITY
        </span>
      </div>

      {/* 3 SL Tier Rows */}
      <div className="space-y-3">

        {/* Row 1 — Initial Stop Loss (above entry) */}
        <div className="bg-bg border border-red/15 rounded-lg p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">
                Initial SL — Set above entry
              </div>
              <div className="font-mono text-xl font-bold text-amber">
                +{shortSL.toFixed(1)}% above entry
              </div>
              {slPrice && (
                <div className="font-mono text-[11px] text-amber/70 mt-0.5">
                  {fmtPrice(slPrice)} — exit if stock RISES above this
                </div>
              )}
            </div>
            <div className="font-mono text-[10px] text-muted max-w-[180px] text-right leading-relaxed">
              Buy back futures immediately if stock rises above this price
            </div>
          </div>
        </div>

        {/* Row 2 — Trail SL down */}
        <div className="bg-bg border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1.5">
            Trail SL down when...
          </div>
          <div className="flex items-center justify-between">
            <div className="font-mono text-sm text-amber font-medium">
              Stock falls {(shortSL * 0.5).toFixed(1)}% from entry
              {breakevenTrigger ? ` (${fmtPrice(breakevenTrigger)})` : ""}
            </div>
            <div className="font-mono text-[10px] text-muted max-w-[200px] text-right leading-relaxed">
              Move your SL down to entry price — now you can only win or breakeven
            </div>
          </div>
        </div>

        {/* Row 3 — Profit Target */}
        <div className="bg-bg border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1.5">
            Profit target
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm text-green font-medium">
                -{profitTarget.toFixed(1)}% below entry
                {targetPrice ? ` (${fmtPrice(targetPrice)})` : ""}
              </div>
              <div className="font-mono text-[11px] text-dim mt-0.5">
                Based on worst single month historically — consider booking here
              </div>
            </div>
            <div className="font-mono text-[10px] text-muted max-w-[200px] text-right leading-relaxed">
              Consider booking partial profits at this level
            </div>
          </div>
        </div>

      </div>

      {/* R:R */}
      <div className={`mt-4 font-mono text-sm font-medium ${rrColor}`}>
        Risk/Reward this month: {rrRatio.toFixed(2)}:1 —{" "}
        <span className="font-normal">{rrLabel}</span>
      </div>

      {/* Squeeze Warning */}
      <div className="mt-2 font-mono text-[11px] text-red">
        ⚠ Squeeze risk: Best single month on record was +{bestMonth.toFixed(1)}%.
        This is your worst case scenario as a short seller. News/results can override seasonality.
      </div>

      {/* Results Month Warning */}
      {isResultsMonth && (
        <div className="mt-2 bg-red/10 border border-red/25 rounded-lg px-4 py-2 font-mono text-[11px] text-red">
          ⚠ WARNING: This is a quarterly results month (Jan/Apr/Jul/Oct).
          Earnings surprises can cause violent short squeezes. Reduce position size by 50%
          or avoid shorting altogether during results season.
        </div>
      )}

      {/* Based On */}
      <div className="mt-4 pt-4 border-t border-red/15 space-y-0.5">
        <div className="font-mono text-[10px] text-muted">
          Based on: Best {symbol} {monthName} on record: +{bestMonth.toFixed(1)}%
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
