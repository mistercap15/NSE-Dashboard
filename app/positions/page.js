"use client"
import { useState, useEffect, useCallback } from "react"
import Sidebar from "../components/Sidebar"
import { MONTHS, MONTH_FULL } from "../lib/api"

const currentMonth = new Date().getMonth() + 1
const STORAGE_KEY  = "nse_positions_v1"

function loadPositions() {
  if (typeof window === "undefined") return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
  } catch { return [] }
}

function savePositions(positions) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions))
}

function getActionStyle(action) {
  switch (action) {
    case "EXIT_NOW":   return { bg: "bg-green/10",  border: "border-green/30",  text: "text-green",  badge: "EXIT NOW"  }
    case "TRAIL_STOP": return { bg: "bg-accent/10", border: "border-accent/30", text: "text-accent", badge: "TRAIL SL"  }
    case "TIME_STOP":  return { bg: "bg-amber/10",  border: "border-amber/30",  text: "text-amber",  badge: "TIME STOP" }
    case "WATCH":      return { bg: "bg-amber/5",   border: "border-amber/20",  text: "text-amber",  badge: "WATCH"     }
    case "HOLD":       return { bg: "bg-card",      border: "border-border",    text: "text-soft",   badge: "HOLD"      }
    default:           return { bg: "bg-card",      border: "border-border",    text: "text-dim",    badge: "—"         }
  }
}

function CaptureBar({ pct }) {
  const capped = Math.min(pct, 120)
  const color  =
    pct >= 90 ? "bg-green"  :
    pct >= 60 ? "bg-accent" :
    pct >= 30 ? "bg-amber"  : "bg-red"
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="font-mono text-[9px] text-dim">Median captured</span>
        <span className={`font-mono text-[10px] font-bold ${
          pct >= 90 ? "text-green" : pct >= 60 ? "text-accent" : "text-amber"
        }`}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(capped, 100)}%` }}
        />
      </div>
    </div>
  )
}

export default function PositionsPage() {
  const [positions,   setPositions]   = useState([])
  const [enriched,    setEnriched]    = useState([])
  const [totalPnL,    setTotalPnL]    = useState(0)
  const [loading,     setLoading]     = useState(false)
  const [lastFetch,   setLastFetch]   = useState(null)
  const [showForm,    setShowForm]    = useState(false)
  const [upstoxError, setUpstoxError] = useState(null)

  const [form, setForm] = useState({
    symbol:      "",
    direction:   "LONG",
    entryPrice:  "",
    lotSize:     "",
    entryDate:   new Date().toISOString().slice(0, 10),
    medianReturn:"",
    avgReturn:   "",
    targetMonth: currentMonth === 12 ? 1 : currentMonth + 1,
  })

  useEffect(() => {
    setPositions(loadPositions())
  }, [])

  const fetchLiveData = useCallback(async (positionsToFetch) => {
    if (positionsToFetch.length === 0) return
    setLoading(true)
    setUpstoxError(null)
    try {
      const res  = await fetch("/api/positions", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ positions: positionsToFetch }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEnriched(data.positions || [])
      setTotalPnL(data.totalPnL  || 0)
      setLastFetch(new Date())
    } catch (e) {
      setUpstoxError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (positions.length > 0) {
      fetchLiveData(positions)
      const interval = setInterval(() => fetchLiveData(positions), 5 * 60 * 1000)
      return () => clearInterval(interval)
    }
  }, [positions, fetchLiveData])

  const addPosition = async () => {
    if (!form.symbol || !form.entryPrice || !form.lotSize) return

    let medianReturn = parseFloat(form.medianReturn) || 0
    let avgReturn    = parseFloat(form.avgReturn)    || 0

    if (!medianReturn || !avgReturn) {
      try {
        const res  = await fetch(`/api/stock/${form.symbol.toUpperCase()}`)
        const data = await res.json()
        const monthData = data?.seasonality?.[form.targetMonth - 1]
        if (monthData) {
          medianReturn = monthData.median_return || 0
          avgReturn    = monthData.avg_return    || 0
        }
      } catch (e) {
        console.error("Could not fetch stock data", e)
      }
    }

    const newPos = {
      id:          Date.now().toString(),
      symbol:      form.symbol.toUpperCase(),
      direction:   form.direction,
      entryPrice:  parseFloat(form.entryPrice),
      lotSize:     parseInt(form.lotSize),
      entryDate:   form.entryDate,
      targetMonth: parseInt(form.targetMonth),
      medianReturn,
      avgReturn,
    }

    const updated = [...positions, newPos]
    setPositions(updated)
    savePositions(updated)
    setShowForm(false)
    setForm({
      symbol: "", direction: "LONG", entryPrice: "",
      lotSize: "", entryDate: new Date().toISOString().slice(0, 10),
      medianReturn: "", avgReturn: "",
      targetMonth: currentMonth === 12 ? 1 : currentMonth + 1,
    })
    fetchLiveData(updated)
  }

  const removePosition = (id) => {
    const updated = positions.filter(p => p.id !== id)
    setPositions(updated)
    savePositions(updated)
    setEnriched(prev => prev.filter(p => p.id !== id))
  }

  const displayPositions = enriched.length > 0
    ? enriched
    : positions.map(p => ({ ...p, pnl: null, recommendation: null }))

  const exitNowCount = displayPositions.filter(p => p.recommendation?.action === "EXIT_NOW").length
  const trailCount   = displayPositions.filter(p => p.recommendation?.action === "TRAIL_STOP").length

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-[200px] flex-1 p-8">

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">
            Live Position Monitor
          </div>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="font-display text-3xl font-bold text-text">
                Open Positions<span className="text-accent">.</span>
              </h1>
              <p className="font-body text-sm text-dim mt-1">
                Real-time P&amp;L and daily exit recommendations based on seasonal targets.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {lastFetch && (
                <span className="font-mono text-[10px] text-dim">
                  Updated {lastFetch.toLocaleTimeString("en-IN")}
                </span>
              )}
              <button
                onClick={() => fetchLiveData(positions)}
                disabled={loading || positions.length === 0}
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-border
                  text-dim hover:text-text transition-colors disabled:opacity-40"
              >
                {loading ? "Refreshing..." : "↻ Refresh"}
              </button>
              <button
                onClick={() => setShowForm(true)}
                className="font-mono text-sm px-4 py-2 rounded border border-accent/30
                  bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
              >
                + Add Position
              </button>
            </div>
          </div>
        </div>

        {/* Alert bar */}
        {(exitNowCount > 0 || trailCount > 0) && (
          <div className={`mb-6 p-4 rounded-lg border flex items-center justify-between flex-wrap gap-3 ${
            exitNowCount > 0
              ? "border-green/30 bg-green/5"
              : "border-accent/30 bg-accent/5"
          }`}>
            <div>
              <div className={`font-mono text-[11px] uppercase tracking-widest mb-1 ${
                exitNowCount > 0 ? "text-green" : "text-accent"
              }`}>
                {exitNowCount > 0
                  ? `⚡ ${exitNowCount} position${exitNowCount > 1 ? "s" : ""} ready to exit`
                  : `📊 ${trailCount} position${trailCount > 1 ? "s" : ""} — move stop loss`}
              </div>
              <div className="font-body text-sm text-dim">
                {exitNowCount > 0
                  ? "Seasonal target reached. Exit to lock in profits."
                  : "Good profit built up. Move stop loss to protect gains."}
              </div>
            </div>
          </div>
        )}

        {/* Upstox error */}
        {upstoxError && (
          <div className="mb-6 p-4 rounded-lg border border-red/20 bg-red/5
            flex items-center justify-between">
            <div>
              <div className="font-mono text-[11px] text-red mb-1">Live price unavailable</div>
              <div className="font-body text-sm text-dim">
                {upstoxError.includes("token") ? "Upstox session expired." : upstoxError}
              </div>
            </div>
            {upstoxError.includes("token") && (
              <a href="/api/upstox/login"
                className="font-mono text-[11px] px-3 py-1.5 rounded border
                  border-accent/30 bg-accent/10 text-accent">
                Reconnect →
              </a>
            )}
          </div>
        )}

        {/* Portfolio summary */}
        {displayPositions.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Open Positions", value: displayPositions.length, color: "text-text" },
              {
                label: "Total P&L",
                value: totalPnL >= 0
                  ? `+₹${Math.abs(totalPnL).toLocaleString("en-IN")}`
                  : `-₹${Math.abs(totalPnL).toLocaleString("en-IN")}`,
                color: totalPnL >= 0 ? "text-green" : "text-red",
              },
              { label: "Exit Signals", value: exitNowCount, color: exitNowCount > 0 ? "text-green" : "text-dim" },
              { label: "Trail Signals", value: trailCount,  color: trailCount  > 0 ? "text-accent" : "text-dim" },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border rounded-lg p-4">
                <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">
                  {s.label}
                </div>
                <div className={`font-mono text-xl font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Position cards */}
        <div className="space-y-4">
          {displayPositions.map(p => {
            const rec      = p.recommendation
            const style    = getActionStyle(rec?.action)
            const pnl      = p.pnl
            const isProfit = (pnl?.total || 0) >= 0

            return (
              <div key={p.id}
                className={`rounded-lg border overflow-hidden ${style.border} ${style.bg}`}>

                {/* Card header */}
                <div className="px-5 py-4 flex items-start justify-between gap-4 flex-wrap">

                  {/* Left: symbol + meta */}
                  <div className="flex items-center gap-3">
                    <div className={`font-mono text-[10px] font-bold px-2 py-1 rounded border ${
                      p.direction === "LONG"
                        ? "border-green/30 text-green bg-green/10"
                        : "border-red/30 text-red bg-red/10"
                    }`}>
                      {p.direction === "LONG" ? "↑ LONG" : "↓ SHORT"}
                    </div>
                    <div>
                      <div className="font-mono text-xl font-bold text-accent">{p.symbol}</div>
                      <div className="font-mono text-[10px] text-dim">
                        {MONTHS[(p.targetMonth - 1) % 12]} target ·{" "}
                        Entered {p.entryDate} ·{" "}
                        {p.timing?.daysInTrade ?? 0} days ago ·{" "}
                        {p.timing?.daysRemaining ?? 0} days left
                      </div>
                    </div>
                  </div>

                  {/* Right: P&L + price + badge + remove */}
                  <div className="flex items-center gap-4 flex-wrap">
                    {pnl && (
                      <div className="text-right">
                        <div className="font-mono text-[10px] text-dim mb-0.5">Live P&L</div>
                        <div className={`font-mono text-lg font-bold ${isProfit ? "text-green" : "text-red"}`}>
                          {isProfit ? "+" : "-"}₹{Math.abs(pnl.total).toLocaleString("en-IN")}
                        </div>
                        <div className={`font-mono text-[11px] ${isProfit ? "text-green" : "text-red"}`}>
                          {isProfit ? "+" : ""}{pnl.returnPct}%
                        </div>
                      </div>
                    )}

                    {p.livePrice && (
                      <div className="text-right">
                        <div className="font-mono text-[10px] text-dim mb-0.5">Current</div>
                        <div className="font-mono text-base font-bold text-text">
                          ₹{p.livePrice.toLocaleString("en-IN")}
                        </div>
                        <div className={`font-mono text-[11px] ${
                          (p.quote?.changePct || 0) >= 0 ? "text-green" : "text-red"
                        }`}>
                          {(p.quote?.changePct || 0) >= 0 ? "+" : ""}
                          {(p.quote?.changePct || 0).toFixed(2)}% today
                        </div>
                      </div>
                    )}

                    {rec && (
                      <div className={`font-mono text-[11px] font-bold px-3 py-1.5 rounded border
                        ${style.border} ${style.text} text-center min-w-[80px]`}>
                        {style.badge}
                      </div>
                    )}

                    <button
                      onClick={() => removePosition(p.id)}
                      className="font-mono text-[11px] text-muted hover:text-red transition-colors px-2"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Capture bar + recommendation detail */}
                {pnl && (
                  <div className="px-5 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">

                    {/* Left: capture bar + stats */}
                    <div className="bg-bg rounded-lg p-4">
                      <CaptureBar pct={pnl.medianCapture} />
                      <div className="mt-3 space-y-1.5">
                        {[
                          { label: "Entry price",    value: `₹${p.entryPrice.toLocaleString("en-IN")}`, color: "text-soft" },
                          { label: "Current price",  value: `₹${(p.livePrice || 0).toLocaleString("en-IN")}`, color: isProfit ? "text-green" : "text-red" },
                          { label: "Median target",  value: `₹${Math.round(p.entryPrice * (1 + p.medianReturn / 100)).toLocaleString("en-IN")} (+${p.medianReturn}%)`, color: "text-accent" },
                          { label: "Lot size",       value: `${p.lotSize} shares`, color: "text-dim" },
                        ].map(item => (
                          <div key={item.label} className="flex justify-between">
                            <span className="font-mono text-[10px] text-dim">{item.label}</span>
                            <span className={`font-mono text-[11px] font-medium ${item.color}`}>{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: recommendation */}
                    {rec && (
                      <div className={`rounded-lg p-4 border ${style.border} ${style.bg}`}>
                        <div className={`font-mono text-[10px] uppercase tracking-widest mb-2 ${style.text}`}>
                          Today&apos;s Recommendation
                        </div>
                        <div className={`font-display text-sm font-bold mb-2 ${style.text}`}>
                          {rec.title}
                        </div>
                        <p className="font-body text-[12px] text-dim leading-relaxed mb-2">
                          {rec.reason}
                        </p>
                        <div className="font-mono text-[10px] text-muted">{rec.detail}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Add position modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-lg font-bold text-text">Add Position</h2>
                <button onClick={() => setShowForm(false)} className="text-dim hover:text-text">✕</button>
              </div>

              <div className="space-y-4">
                {/* Direction toggle */}
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {["LONG", "SHORT"].map(d => (
                    <button key={d}
                      onClick={() => setForm(f => ({ ...f, direction: d }))}
                      className={`flex-1 py-2 font-mono text-sm transition-colors ${
                        form.direction === d
                          ? d === "LONG" ? "bg-green/15 text-green" : "bg-red/15 text-red"
                          : "text-dim"
                      }`}>
                      {d === "LONG" ? "↑ Long" : "↓ Short"}
                    </button>
                  ))}
                </div>

                {/* Input fields */}
                {[
                  { key: "symbol",     label: "Symbol",        placeholder: "HEROMOTOCO", type: "text"   },
                  { key: "entryPrice", label: "Entry Price ₹", placeholder: "5075",       type: "number" },
                  { key: "lotSize",    label: "Lot Size",      placeholder: "150",        type: "number" },
                  { key: "entryDate",  label: "Entry Date",    placeholder: "",           type: "date"   },
                ].map(f => (
                  <div key={f.key}>
                    <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-1.5">
                      {f.label}
                    </label>
                    <input
                      type={f.type}
                      value={form[f.key]}
                      onChange={e => setForm(prev => ({
                        ...prev,
                        [f.key]: f.key === "symbol" ? e.target.value.toUpperCase() : e.target.value,
                      }))}
                      placeholder={f.placeholder}
                      className="w-full bg-bg border border-border rounded-lg px-4 py-2.5
                        font-mono text-sm text-text placeholder-muted focus:border-accent
                        focus:outline-none transition-colors"
                    />
                  </div>
                ))}

                {/* Target month */}
                <div>
                  <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-1.5">
                    Target Month
                  </label>
                  <select
                    value={form.targetMonth}
                    onChange={e => setForm(f => ({ ...f, targetMonth: parseInt(e.target.value) }))}
                    className="w-full bg-bg border border-border rounded-lg px-4 py-2.5
                      font-mono text-sm text-text focus:border-accent focus:outline-none"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>

                <div className="font-mono text-[10px] text-dim">
                  Median return and avg return auto-fetched from your MCP server
                </div>

                <button
                  onClick={addPosition}
                  className="w-full font-mono text-sm py-3 rounded-lg border border-accent/30
                    bg-accent/15 text-accent hover:bg-accent/25 transition-colors font-bold"
                >
                  Add Position
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {displayPositions.length === 0 && !showForm && (
          <div className="text-center py-20 border border-border rounded-lg">
            <div className="font-display text-2xl text-dim mb-2">No open positions</div>
            <div className="font-mono text-sm text-muted mb-6">
              Add your futures positions to track live P&amp;L and get daily exit recommendations
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="font-mono text-sm px-6 py-2.5 rounded-lg border border-accent/30
                bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              + Add First Position
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-border pt-4 mt-8 flex items-center justify-between">
          <div className="font-mono text-[10px] text-muted">
            Live prices via Upstox · Recommendations based on seasonal median targets · Not SEBI advice
          </div>
          <div className="font-mono text-[10px] text-muted">
            Crafted by <span className="text-accent">Khilan Patel</span>
          </div>
        </div>
      </main>
    </div>
  )
}
