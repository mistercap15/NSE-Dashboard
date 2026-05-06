"use client"
import { useState, useEffect } from "react"
import Sidebar from "../components/Sidebar"
import Link from "next/link"
import { MONTHS, MONTH_FULL } from "../lib/api"

const currentMonth = new Date().getMonth() + 1
const nextMonth    = currentMonth === 12 ? 1 : currentMonth + 1

// ── Plain label for support zone types ────────────────────────────
function supportTypeLabel(type) {
  if (!type)                  return "support zone"
  if (type === "MA20")        return "4-week average"
  if (type === "MA50")        return "10-week average"
  if (type === "MA10")        return "2-week average"
  if (type === "SWING_LOW")   return "recent price floor"
  if (type === "PREV_MONTH_LOW") return "last month's low"
  if (type === "52W_LOW")     return "52-week low"
  return type
}

// ── Helper: watch-for bullet lines ────────────────────────────────
function getWatchForText(support, scanningMonth) {
  const monthName = MONTHS[(scanningMonth - 1) % 12]
  const day22     = `22nd ${monthName}`
  const near      = support?.nearest
  const far       = support?.second
  const lines     = []

  if (near) {
    lines.push(
      `If price falls to ₹${near.price?.toLocaleString("en-IN")} (${supportTypeLabel(near.type)}) → score jumps — consider entering 1 lot`
    )
  }
  if (far) {
    lines.push(
      `If price falls further to ₹${far.price?.toLocaleString("en-IN")} (${supportTypeLabel(far.type)}) → stronger signal — enter or average down`
    )
  }
  lines.push(`If neither happens → enter at market on ${day22} anyway`)
  return lines
}

// ── Helper: momentum plain text ────────────────────────────────────
function getMomentumText(momentum) {
  if (momentum < -3)
    return { icon: "📉", text: "Falling — price dropping, getting closer to entry zone" }
  if (momentum < 0)
    return { icon: "📊", text: "Slowing — selling pressure easing, may be forming a base" }
  if (momentum < 2)
    return { icon: "➡️",  text: "Flat — price moving sideways, watch for direction" }
  return   { icon: "📈", text: "Rising — price moving away from support zone, wait" }
}

// ── Grade Pill (replaces raw "40/100" score) ──────────────────────
function GradePill({ grade, score }) {
  const colorClass =
    score >= 75 ? "bg-green/15 text-green border-green/30" :
    score >= 65 ? "bg-amber/15 text-amber border-amber/30" :
    score >= 55 ? "bg-orange-500/15 text-orange-400 border-orange-500/30" :
                  "bg-red/15 text-red border-red/30"
  return (
    <span
      className={`font-mono text-[11px] px-2 py-0.5 rounded border font-bold cursor-help ${colorClass}`}
      title={`Score: ${score}/100 — updates daily as price moves`}
    >
      {grade}
    </span>
  )
}

// ── Status Badge ───────────────────────────────────────────────────
function StatusBadge({ status }) {
  const styles = {
    BUY:      "bg-green/15 text-green border-green/30",
    BUY_HALF: "bg-amber/15 text-amber border-amber/30",
    WATCH:    "bg-accent/15 text-accent border-accent/30",
    MONITOR:  "bg-orange-500/15 text-orange-400 border-orange-500/30",
    SKIP:     "bg-red/15 text-red border-red/30",
  }
  const labels = {
    BUY:      "↑ Enter Now",
    BUY_HALF: "↑ Enter — Not Perfect",
    WATCH:    "⏳ Set Price Alert",
    MONITOR:  "👁 Check Daily",
    SKIP:     "✕ Skip This Month",
  }
  const descriptions = {
    BUY:      "Strong setup — enter 1 lot at current price",
    BUY_HALF: "Good setup but wait for slight dip — enter when closer to support",
    WATCH:    "Seasonality is good but price is not at right level yet — set alert",
    MONITOR:  "Too early — price is too high, check again in 2-3 days",
    SKIP:     "Either weak seasonality or fundamental concern — avoid",
  }
  return (
    <span
      className={`font-mono text-[10px] px-2 py-1 rounded border font-bold ${styles[status] || styles.SKIP}`}
      title={descriptions[status] || ""}
    >
      {labels[status] || status}
    </span>
  )
}

export default function EarlyEntryPage() {
  const [data,          setData]          = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [upstoxReady,   setUpstoxReady]   = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(nextMonth)
  const [expanded,      setExpanded]      = useState(null)

  useEffect(() => {
    fetch("/api/upstox/status")
      .then(r => r.json())
      .then(d => setUpstoxReady(d.connected))
      .catch(() => setUpstoxReady(false))
  }, [])

  const runScan = async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/early-entry?month=${selectedMonth}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-[200px] flex-1 p-8">

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">
            Early Entry Scanner
          </div>
          <h1 className="font-display text-3xl font-bold text-text">
            Smart Entry<span className="text-accent">.</span>
          </h1>
          <p className="font-body text-sm text-dim mt-1 max-w-2xl">
            Enter next month&apos;s strongest seasonal stocks during the current month&apos;s
            dip — at technical support zones instead of waiting for month start.
            Combines seasonality edge with precise technical entry.
          </p>
        </div>

        {/* Upstox connection status */}
        <div className={`mb-6 p-4 rounded-lg border flex items-center justify-between ${
          upstoxReady ? "border-green/20 bg-green/5" : "border-amber/20 bg-amber/5"
        }`}>
          <div>
            <div className={`font-mono text-[11px] uppercase tracking-widest mb-1 ${
              upstoxReady ? "text-green" : "text-amber"
            }`}>
              {upstoxReady ? "✓ Upstox Connected" : "⚠ Upstox Not Connected"}
            </div>
            <div className="font-body text-sm text-dim">
              {upstoxReady
                ? "Live daily price data available — support zones computed from real OHLC"
                : "Connect Upstox to enable live price data and support zone detection"}
            </div>
          </div>
          {!upstoxReady && (
            <a href="/api/upstox/login"
              className="font-mono text-sm px-4 py-2 rounded border border-accent/30
                bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
              Connect Upstox →
            </a>
          )}
        </div>

        {/* Month selector + scan button */}
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          <div>
            <div className="font-mono text-[10px] text-dim uppercase tracking-wider mb-2">
              Scan for entries into
            </div>
            <div className="flex gap-2 flex-wrap">
              {MONTHS.map((m, i) => (
                <button key={m} onClick={() => setSelectedMonth(i + 1)}
                  className={`font-mono text-[11px] px-3 py-1.5 rounded border transition-all ${
                    selectedMonth === i + 1
                      ? "bg-accent/15 border-accent/40 text-accent"
                      : "border-border text-dim hover:text-text"
                  }`}>
                  {m}
                  {i + 1 === nextMonth && (
                    <span className="ml-1 inline-block w-1 h-1 rounded-full bg-green align-middle" />
                  )}
                </button>
              ))}
            </div>
          </div>
          <button onClick={runScan} disabled={loading}
            className="font-mono text-sm px-6 py-2.5 rounded border border-accent/30
              bg-accent/15 text-accent hover:bg-accent/25 transition-all
              disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 mt-6">
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border border-accent border-t-transparent
                  rounded-full animate-spin" />
                Scanning...
              </>
            ) : (
              `⚡ Scan ${MONTHS[selectedMonth - 1]} Entries`
            )}
          </button>
        </div>

        {/* How it works (pre-scan) */}
        {!data && !loading && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            {[
              { step:"01", title:"Seasonal filter",     desc:`Finds stocks with ≥75% win rate in ${MONTHS[selectedMonth-1]} with 10+ years data` },
              { step:"02", title:"Support zones",        desc:"Computes 4-week average, 10-week average, and price floors from Upstox daily history" },
              { step:"03", title:"Signal scoring",       desc:"Combines seasonality + technical position + dip type into 0-100 score" },
              { step:"04", title:"Entry recommendation", desc:"Enter Now ≥75 · Not Perfect ≥65 · Set Alert ≥55 · Skip <55" },
            ].map(s => (
              <div key={s.step} className="bg-card border border-border rounded-lg p-4">
                <div className="font-mono text-[10px] text-accent mb-2">{s.step}</div>
                <div className="font-display text-sm font-semibold text-text mb-1">{s.title}</div>
                <div className="font-body text-[12px] text-dim">{s.desc}</div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red/10 border border-red/20 rounded-lg p-4 font-mono text-sm text-red mb-6">
            {error.includes("access token") ? (
              <span>
                {error} —{" "}
                <a href="/api/upstox/login" className="underline">
                  Click here to connect Upstox
                </a>
              </span>
            ) : error}
          </div>
        )}

        {/* Results */}
        {data && (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-6 mb-5 p-4 bg-card border border-border rounded-lg flex-wrap">
              <div>
                <div className="font-mono text-[10px] text-dim">Target month</div>
                <div className="font-mono text-sm text-accent font-bold">
                  {MONTH_FULL[selectedMonth - 1]}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-dim">Candidates scanned</div>
                <div className="font-mono text-sm text-text font-bold">{data.totalCandidates}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-dim">Buy signals</div>
                <div className="font-mono text-sm text-green font-bold">{data.buySignals}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-dim">Watching</div>
                <div className="font-mono text-sm text-amber font-bold">{data.watchlist}</div>
              </div>
              <div className="ml-auto font-mono text-[10px] text-muted">
                Scanned {new Date(data.scannedAt).toLocaleString("en-IN")}
              </div>
            </div>

            {/* Stock cards */}
            <div className="space-y-3">
              {data.results.map((s) => {
                // ── Derived values ─────────────────────────────────────
                const price          = s.price?.current
                const score          = s.signal.score
                const grade          = s.signal.grade?.label
                const nearSupport    = s.support?.nearest
                const farSupport     = s.support?.second
                const distancePct    = s.support?.distancePct
                const momentum       = s.context?.momentum || 0
                const ma20           = s.context?.ma20
                const ma50           = s.context?.ma50
                const medianReturn   = s.nextMonth.median_return || s.nextMonth.avg_return
                const winRate        = s.nextMonth.win_rate

                // Stop loss: 3% below second support, or 7% from entry
                const slPrice = farSupport
                  ? Math.round(farSupport.price * 0.97)
                  : price ? Math.round(price * 0.93) : null
                const slAmount = slPrice && price && s.lot_size
                  ? Math.round((price - slPrice) * s.lot_size)
                  : null
                const slPct = slPrice && price
                  ? Math.round((price - slPrice) / price * 100 * 10) / 10
                  : null

                // Target
                const targetPrice = price && medianReturn
                  ? Math.round(price * (1 + medianReturn / 100))
                  : null
                const expectedProfit = targetPrice && price && s.lot_size
                  ? Math.round((targetPrice - price) * s.lot_size)
                  : null

                // Notional exposure
                const notional = price && s.lot_size ? price * s.lot_size : null

                // Averaging down
                const secondSupportPrice = farSupport?.price
                const newAverage = price && secondSupportPrice
                  ? Math.round((price + secondSupportPrice) / 2)
                  : null
                const newProfit = targetPrice && newAverage && s.lot_size
                  ? Math.round((targetPrice - newAverage) * s.lot_size * 2)
                  : null

                // Distance from current to MAs (positive = above → % to drop)
                const distToMa20 = ma20 && price && price > ma20
                  ? Math.round((price - ma20) / price * 100 * 10) / 10
                  : null
                const distToMa50 = ma50 && price && price > ma50
                  ? Math.round((price - ma50) / price * 100 * 10) / 10
                  : null
                const distToSl = slPrice && price
                  ? Math.round((price - slPrice) / price * 100 * 10) / 10
                  : null

                // Price position sentence
                const diffFromMa20 = ma20 && price
                  ? Math.round(Math.abs(price - ma20))
                  : null
                const absPctFromMa20 = s.context?.pctFromMa20 != null
                  ? Math.abs(s.context.pctFromMa20)
                  : null

                // Momentum description
                const momentumInfo = getMomentumText(momentum)

                // Watch-for lines (use currentMonth for fallback date — we enter this month)
                const watchLines = getWatchForText(s.support, currentMonth)

                // Fallback date label
                const fallbackDate = `22nd ${MONTHS[currentMonth - 1]}`

                // Nearest support price formatted
                const nearestSupportFmt = nearSupport?.price?.toLocaleString("en-IN")

                return (
                  <div key={s.symbol}
                    className={`bg-card border rounded-lg overflow-hidden ${
                      s.status === "BUY" || s.status === "BUY_HALF"
                        ? "border-green/20"
                        : s.status === "WATCH"
                        ? "border-accent/20"
                        : "border-border"
                    }`}>

                    {/* ── Collapsed card header ─────────────────────── */}
                    <div
                      className="px-5 py-3.5 flex items-center gap-4 cursor-pointer
                        hover:bg-white/[0.02] transition-colors flex-wrap"
                      onClick={() => setExpanded(expanded === s.symbol ? null : s.symbol)}
                    >
                      <StatusBadge status={s.status} />

                      <Link href={`/analysis?symbol=${s.symbol}`}
                        onClick={e => e.stopPropagation()}
                        className="font-mono text-lg font-bold text-accent hover:text-white transition-colors">
                        {s.symbol}
                      </Link>

                      <span className="font-mono text-[11px] text-dim">{s.sector}</span>

                      {price && (
                        <span className="font-mono text-sm text-text">
                          ₹{price.toLocaleString("en-IN")}
                        </span>
                      )}

                      {/* Plain language summary (Change 5) */}
                      {nearSupport && (
                        <span className="font-mono text-[11px] text-amber">
                          {score >= 75
                            ? "Ready to enter — price at support zone"
                            : score >= 65
                            ? `Near entry zone — ${distancePct}% away from ₹${nearSupport.price?.toLocaleString("en-IN")}`
                            : score >= 55
                            ? `Watching — set alert at ₹${nearSupport.price?.toLocaleString("en-IN")}`
                            : `Not ready — wait for ₹${nearSupport.price?.toLocaleString("en-IN")} (${distancePct}% lower)`
                          }
                        </span>
                      )}

                      {/* Seasonality stats + grade pill */}
                      <div className="flex gap-3 ml-auto">
                        <div className="text-right">
                          <div className="font-mono text-[9px] text-dim">
                            {MONTHS[selectedMonth - 1]} WR
                          </div>
                          <div className="font-mono text-[12px] font-bold text-green">
                            {winRate?.toFixed(1)}%
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[9px] text-dim">Avg</div>
                          <div className="font-mono text-[12px] font-bold text-green">
                            +{s.nextMonth.avg_return?.toFixed(2)}%
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[9px] text-dim">Grade</div>
                          <GradePill grade={grade} score={score} />
                        </div>
                      </div>

                      <span className="font-mono text-[11px] text-dim">
                        {expanded === s.symbol ? "▲" : "▼"}
                      </span>
                    </div>

                    {/* ── Expanded detail ───────────────────────────── */}
                    {expanded === s.symbol && (
                      <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">

                        {/* Change 6: How this works */}
                        <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
                          <div className="font-mono text-[10px] text-accent uppercase tracking-widest mb-1">
                            How this works
                          </div>
                          <div className="font-body text-[12px] text-dim">
                            This score updates every time you scan. It goes UP when the stock
                            falls toward its support zone and DOWN when it rises away from it.
                            A score of 75+ means conditions are right to enter today.
                            Below 55 means wait — the price hasn&apos;t come down to the right
                            level yet.
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                          {/* ── Col 1: Why this stock ──────────────── */}
                          <div className="bg-bg rounded-lg p-4 space-y-4">

                            {/* WHY THIS STOCK */}
                            <div>
                              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">
                                Why this stock
                              </div>
                              <div className="font-body text-[12px] text-soft leading-relaxed">
                                {s.symbol} has gone up in{" "}
                                <span className="text-green font-semibold">
                                  {winRate?.toFixed(0)}%
                                </span>
                                {" "}of {MONTHS[selectedMonth - 1]}s
                                {s.nextMonth.data_points
                                  ? ` over ${s.nextMonth.data_points} years`
                                  : ""}
                                {s.nextMonth.avg_return != null && (
                                  <> with an average gain of{" "}
                                    <span className="text-green font-semibold">
                                      +{s.nextMonth.avg_return?.toFixed(2)}%
                                    </span>
                                  </>
                                )}.{" "}
                                {s.currentMonth?.is_weak
                                  ? `${MONTHS[currentMonth - 1]} is historically weak — making it a good early entry candidate.`
                                  : "Entering early during dips gives a better entry price."
                                }
                              </div>
                            </div>

                            {/* WHAT'S HAPPENING RIGHT NOW */}
                            <div>
                              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">
                                What&apos;s happening right now
                              </div>
                              <div className="font-body text-[12px] leading-relaxed">
                                {score >= 75 ? (
                                  <span className="text-green">
                                    ✅ Price is at a support zone — good time to enter
                                  </span>
                                ) : score >= 65 ? (
                                  <span className="text-amber">
                                    🟡 Price is near support but not quite there yet
                                  </span>
                                ) : score >= 55 ? (
                                  <span className="text-amber">
                                    ⏳ Price is moving toward support — set an alert
                                  </span>
                                ) : (
                                  <span className="text-dim">
                                    📍 Price is{" "}
                                    <span className="text-text">{distancePct}%</span>
                                    {" "}away from support right now.
                                    {nearSupport && (
                                      <> Wait for it to fall to{" "}
                                        <span className="text-amber">
                                          ₹{nearSupport.price?.toLocaleString("en-IN")}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* WHAT TO WATCH FOR */}
                            <div>
                              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">
                                What to watch for
                              </div>
                              <div className="space-y-1.5">
                                {watchLines.map((line, i) => (
                                  <div key={i} className="font-body text-[12px] text-soft leading-relaxed flex gap-2">
                                    <span className="text-accent shrink-0">→</span>
                                    {line}
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* WHY TODAY IS DIFFERENT (score 40–65 only) */}
                            {score >= 40 && score < 65 && s.context && (
                              <div>
                                <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">
                                  Why today is different
                                </div>
                                <div className="font-body text-[12px] text-dim leading-relaxed">
                                  Score changes daily as price moves. Price moved{" "}
                                  {momentum > 0 ? "up" : "down"}{" "}
                                  by ~{Math.abs(momentum).toFixed(1)}% recently — moving{" "}
                                  {momentum > 0 ? "further from" : "closer to"}
                                  {" "}the entry zone.
                                </div>
                              </div>
                            )}
                          </div>

                          {/* ── Col 2: Price position ──────────────── */}
                          <div className="bg-bg rounded-lg p-4 space-y-4">
                            {s.context ? (
                              <>
                                {/* PRICE POSITION */}
                                <div>
                                  <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">
                                    Price position
                                  </div>
                                  {diffFromMa20 != null && absPctFromMa20 != null ? (
                                    <div className="font-body text-[12px] text-soft leading-relaxed">
                                      {s.symbol} is currently{" "}
                                      <span className={s.context.isBelowMa20 ? "text-amber font-semibold" : "text-text font-semibold"}>
                                        ₹{diffFromMa20.toLocaleString("en-IN")} ({absPctFromMa20}%)
                                      </span>
                                      {" "}{s.context.isBelowMa20 ? "below" : "above"} its 4-week
                                      average price of{" "}
                                      <span className="text-accent">₹{ma20?.toFixed(0)}</span>
                                      {" "}—{" "}
                                      {s.context.isBelowMa20
                                        ? "trading at a discount to recent prices."
                                        : "not yet at a discount."}
                                    </div>
                                  ) : (
                                    <div className="font-body text-[12px] text-dim">
                                      Price context not available
                                    </div>
                                  )}
                                </div>

                                {/* SUPPORT LADDER */}
                                <div>
                                  <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">
                                    Support levels — where to buy
                                  </div>
                                  <div className="space-y-1 font-mono text-[11px]">
                                    <div className="flex justify-between items-baseline py-1 border-b border-border/40">
                                      <span className="text-accent font-semibold">Current price</span>
                                      <span className="text-accent">
                                        ₹{price?.toLocaleString("en-IN")}
                                        <span className="text-dim font-normal ml-2 text-[10px]">← you are here</span>
                                      </span>
                                    </div>
                                    {ma20 && (
                                      <div className="flex justify-between items-baseline py-1">
                                        <span className="text-amber">4-week average</span>
                                        <span className="text-amber">
                                          ₹{ma20.toFixed(0)}
                                          {distToMa20 != null && (
                                            <span className="text-dim font-normal ml-2 text-[10px]">
                                              ← first buy zone ({distToMa20}% down)
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    )}
                                    {ma50 && (
                                      <div className="flex justify-between items-baseline py-1">
                                        <span className="text-green">10-week average</span>
                                        <span className="text-green">
                                          ₹{ma50.toFixed(0)}
                                          {distToMa50 != null && (
                                            <span className="text-dim font-normal ml-2 text-[10px]">
                                              ← better buy zone ({distToMa50}% down)
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    )}
                                    {slPrice && (
                                      <div className="flex justify-between items-baseline py-1">
                                        <span className="text-red">Stop loss</span>
                                        <span className="text-red">
                                          ₹{slPrice.toLocaleString("en-IN")}
                                          {distToSl != null && (
                                            <span className="text-red/60 font-normal ml-2 text-[10px]">
                                              ← exit if falls here ({distToSl}% down)
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* MOMENTUM */}
                                <div>
                                  <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">
                                    Momentum
                                  </div>
                                  <div className="font-body text-[12px] text-soft">
                                    <span className="mr-1">{momentumInfo.icon}</span>
                                    {momentumInfo.text}
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="font-mono text-[11px] text-muted">
                                {s.price?.error || "Connect Upstox for live technical data"}
                              </div>
                            )}
                          </div>

                          {/* ── Col 3: Action plan ─────────────────── */}
                          <div className="bg-bg rounded-lg p-4">
                            <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-3">
                              Your action plan
                            </div>
                            <div className="space-y-3">

                              {/* Step 1: When to enter */}
                              <div>
                                <div className="font-mono text-[9px] text-accent uppercase mb-1">
                                  Step 1 — When to enter
                                </div>
                                <div className="font-body text-[12px] text-soft">
                                  {s.status === "BUY" && price ? (
                                    <>Enter today at{" "}
                                      <span className="text-green font-semibold">
                                        ₹{price.toLocaleString("en-IN")}
                                      </span>
                                      {" "}— conditions are met</>
                                  ) : s.status === "BUY_HALF" && nearSupport ? (
                                    <>Enter when price reaches{" "}
                                      <span className="text-amber font-semibold">
                                        ₹{nearestSupportFmt}
                                      </span>
                                      {distancePct ? ` (currently ${distancePct}% away)` : ""}</>
                                  ) : s.status === "WATCH" && nearSupport ? (
                                    <>Set a price alert at{" "}
                                      <span className="text-accent font-semibold">
                                        ₹{nearestSupportFmt}
                                      </span></>
                                  ) : nearSupport ? (
                                    <>No action yet — wait for price to fall to{" "}
                                      <span className="text-dim font-semibold">
                                        ₹{nearestSupportFmt}
                                      </span></>
                                  ) : (
                                    "No clear support level yet — wait"
                                  )}
                                </div>
                              </div>

                              {/* Step 2: What to buy */}
                              <div>
                                <div className="font-mono text-[9px] text-accent uppercase mb-1">
                                  Step 2 — What to buy
                                </div>
                                <div className="font-body text-[12px] text-soft">
                                  Buy 1 lot of{" "}
                                  <span className="font-mono text-accent">
                                    {s.symbol} {MONTHS[selectedMonth - 1]} Futures
                                  </span>
                                  {s.lot_size && price && (
                                    <>
                                      <br />
                                      = {s.lot_size.toLocaleString("en-IN")} shares × ₹{price.toLocaleString("en-IN")}
                                      {notional && (
                                        <> ={" "}
                                          <span className="text-text font-semibold">
                                            ₹{(notional / 100000).toFixed(2)}L
                                          </span>
                                          {" "}total exposure
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Step 3: Stop loss */}
                              <div>
                                <div className="font-mono text-[9px] text-red uppercase mb-1">
                                  Step 3 — Stop loss
                                </div>
                                <div className="font-body text-[12px] text-red/80">
                                  {slPrice ? (
                                    <>
                                      If price falls below{" "}
                                      <span className="font-semibold">
                                        ₹{slPrice.toLocaleString("en-IN")}
                                      </span>
                                      {" "}→ exit immediately
                                      {slAmount && slPct && (
                                        <>
                                          <br />
                                          Loss on 1 lot:{" "}
                                          <span className="font-semibold">
                                            ₹{slAmount.toLocaleString("en-IN")}
                                          </span>
                                          {" "}({slPct}% from entry)
                                        </>
                                      )}
                                    </>
                                  ) : (
                                    "Set stop 7% below entry price"
                                  )}
                                </div>
                              </div>

                              {/* Step 4: Target */}
                              <div>
                                <div className="font-mono text-[9px] text-green uppercase mb-1">
                                  Step 4 — Target
                                </div>
                                <div className="font-body text-[12px] text-green/80">
                                  {MONTHS[selectedMonth - 1]} historically gains{" "}
                                  <span className="font-semibold">
                                    {medianReturn?.toFixed(1)}%
                                  </span>
                                  {" "}for {s.symbol}
                                  {targetPrice && (
                                    <>
                                      <br />
                                      Target price:{" "}
                                      <span className="font-semibold">
                                        ₹{targetPrice.toLocaleString("en-IN")}
                                      </span>
                                    </>
                                  )}
                                  {expectedProfit && (
                                    <>
                                      <br />
                                      Expected profit:{" "}
                                      <span className="font-semibold">
                                        ₹{expectedProfit.toLocaleString("en-IN")}
                                      </span>
                                      {" "}on 1 lot
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Step 5: Fallback */}
                              <div>
                                <div className="font-mono text-[9px] text-amber uppercase mb-1">
                                  Step 5 — Fallback
                                </div>
                                <div className="font-body text-[12px] text-amber/80">
                                  If price never dips to your target entry:
                                  <br />
                                  Enter at market on{" "}
                                  <span className="font-semibold">{fallbackDate}</span>
                                  {" "}anyway.
                                  <br />
                                  Never miss a{" "}
                                  <span className="font-semibold">{winRate?.toFixed(0)}% win rate</span>
                                  {" "}trade for lack of perfect entry.
                                </div>
                              </div>

                              {/* Step 6: Averaging down (score >= 55 only) */}
                              {score >= 55 && secondSupportPrice && newAverage && (
                                <div>
                                  <div className="font-mono text-[9px] text-dim uppercase mb-1">
                                    Step 6 — Averaging down (optional)
                                  </div>
                                  <div className="font-body text-[12px] text-dim">
                                    If you enter and price falls to{" "}
                                    <span className="text-amber">
                                      ₹{secondSupportPrice.toLocaleString("en-IN")}
                                    </span>:
                                    <br />
                                    Consider adding 1 more lot there.
                                    <br />
                                    New average:{" "}
                                    <span className="text-text">
                                      ₹{newAverage.toLocaleString("en-IN")}
                                    </span>
                                    {newProfit && (
                                      <> | New target profit:{" "}
                                        <span className="text-green">
                                          ₹{newProfit.toLocaleString("en-IN")}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}

                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {data.results.length === 0 && (
              <div className="text-center py-16 border border-border rounded-lg">
                <div className="font-mono text-sm text-dim mb-1">
                  No candidates found for {MONTH_FULL[selectedMonth - 1]}
                </div>
                <div className="font-mono text-[11px] text-muted">
                  Requires ≥75% win rate with 10+ years of data
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="border-t border-border pt-4 flex items-center justify-between mt-8">
          <div className="font-mono text-[10px] text-muted">
            Support zones from Upstox daily OHLC ·
            Seasonality from NSE master sheet ·
            Not SEBI advice
          </div>
          <div className="font-mono text-[10px] text-muted">
            Crafted by <span className="text-accent">Khilan Patel</span>
          </div>
        </div>
      </main>
    </div>
  )
}
