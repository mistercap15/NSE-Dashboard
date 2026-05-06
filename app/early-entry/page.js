"use client"
import { useState, useEffect } from "react"
import Sidebar from "../components/Sidebar"
import Link from "next/link"
import { MONTHS, MONTH_FULL } from "../lib/api"

const currentMonth = new Date().getMonth() + 1
const nextMonth    = currentMonth === 12 ? 1 : currentMonth + 1

function ScoreBar({ score }) {
  const color =
    score >= 75 ? "bg-green-500" :
    score >= 65 ? "bg-yellow-500" :
    score >= 55 ? "bg-orange-400" : "bg-red-500"
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="font-mono text-[11px] text-soft w-8">{score}</span>
    </div>
  )
}

function StatusBadge({ status }) {
  const styles = {
    BUY:       "bg-green/15 text-green border-green/30",
    BUY_HALF:  "bg-amber/15 text-amber border-amber/30",
    WATCH:     "bg-accent/15 text-accent border-accent/30",
    MONITOR:   "bg-orange-500/15 text-orange-400 border-orange-500/30",
    SKIP:      "bg-red/15 text-red border-red/30",
  }
  const labels = {
    BUY:       "↑ BUY",
    BUY_HALF:  "↑ BUY HALF",
    WATCH:     "◎ WATCH",
    MONITOR:   "◉ MONITOR",
    SKIP:      "✕ SKIP",
  }
  return (
    <span className={`font-mono text-[10px] px-2 py-1 rounded border font-bold ${styles[status] || styles.SKIP}`}>
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

  // Check if Upstox is connected
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
          upstoxReady
            ? "border-green/20 bg-green/5"
            : "border-amber/20 bg-amber/5"
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

        {/* How it works */}
        {!data && !loading && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            {[
              { step:"01", title:"Seasonal filter",    desc:`Finds stocks with ≥75% win rate in ${MONTHS[selectedMonth-1]} with 10+ years data` },
              { step:"02", title:"Support zones",       desc:"Computes MA20, MA50, swing lows from Upstox daily price history" },
              { step:"03", title:"Signal scoring",      desc:"Combines seasonality + technical + dip type into 0-100 score" },
              { step:"04", title:"Entry recommendation",desc:"BUY ≥75 · BUY HALF ≥65 · WATCH ≥55 · SKIP <55" },
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
                <div className="font-mono text-sm text-text font-bold">
                  {data.totalCandidates}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-dim">Buy signals</div>
                <div className="font-mono text-sm text-green font-bold">
                  {data.buySignals}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-dim">Watching</div>
                <div className="font-mono text-sm text-amber font-bold">
                  {data.watchlist}
                </div>
              </div>
              <div className="ml-auto font-mono text-[10px] text-muted">
                Scanned {new Date(data.scannedAt).toLocaleString("en-IN")}
              </div>
            </div>

            {/* Stock cards */}
            <div className="space-y-3">
              {data.results.map((s) => (
                <div key={s.symbol}
                  className={`bg-card border rounded-lg overflow-hidden ${
                    s.status === "BUY" || s.status === "BUY_HALF"
                      ? "border-green/20"
                      : s.status === "WATCH"
                      ? "border-accent/20"
                      : "border-border"
                  }`}>
                  {/* Card header */}
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

                    {/* Current price */}
                    {s.price?.current && (
                      <span className="font-mono text-sm text-text">
                        ₹{s.price.current?.toLocaleString("en-IN")}
                      </span>
                    )}

                    {/* Nearest support */}
                    {s.support?.nearest && (
                      <span className="font-mono text-[11px] text-amber">
                        Support: ₹{s.support.nearest.price?.toLocaleString("en-IN")}
                        {" "}({s.support.nearest.type})
                        {" "}{s.support.distancePct}% away
                      </span>
                    )}

                    {/* Seasonality */}
                    <div className="flex gap-3 ml-auto">
                      <div className="text-right">
                        <div className="font-mono text-[9px] text-dim">
                          {MONTHS[selectedMonth - 1]} WR
                        </div>
                        <div className="font-mono text-[12px] font-bold text-green">
                          {s.nextMonth.win_rate?.toFixed(1)}%
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[9px] text-dim">Avg</div>
                        <div className="font-mono text-[12px] font-bold text-green">
                          +{s.nextMonth.avg_return?.toFixed(2)}%
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[9px] text-dim">Score</div>
                        <div className={`font-mono text-[12px] font-bold ${
                          s.signal.score >= 75 ? "text-green" :
                          s.signal.score >= 65 ? "text-amber" : "text-dim"
                        }`}>
                          {s.signal.score}/100
                        </div>
                      </div>
                    </div>

                    <span className="font-mono text-[11px] text-dim">
                      {expanded === s.symbol ? "▲" : "▼"}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {expanded === s.symbol && (
                    <div className="px-5 pb-5 border-t border-border pt-4 grid
                      grid-cols-1 lg:grid-cols-3 gap-4">

                      {/* Signal score breakdown */}
                      <div className="bg-bg rounded-lg p-4">
                        <div className="font-mono text-[10px] text-dim uppercase
                          tracking-widest mb-3">
                          Signal score: {s.signal.score}/100
                        </div>
                        <ScoreBar score={s.signal.score} />
                        <div className="mt-3 font-mono text-[11px] text-accent font-bold mb-2">
                          {s.signal.grade?.label} — {s.signal.grade?.action}
                        </div>
                        <div className="space-y-1.5">
                          {(s.signal.reasons || []).map((r, i) => (
                            <div key={i} className="font-mono text-[10px] text-dim flex gap-2">
                              <span className="text-accent shrink-0">→</span>
                              {r}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Technical context */}
                      <div className="bg-bg rounded-lg p-4">
                        <div className="font-mono text-[10px] text-dim uppercase
                          tracking-widest mb-3">
                          Technical context
                        </div>
                        {s.context ? (
                          <div className="space-y-2">
                            {[
                              { label:"MA20",          value: s.context.ma20 ? `₹${s.context.ma20.toFixed(0)}` : "—",       color: s.context.isBelowMa20 ? "text-amber" : "text-green" },
                              { label:"MA50",          value: s.context.ma50 ? `₹${s.context.ma50.toFixed(0)}` : "—",       color: s.context.isBelowMa50 ? "text-amber" : "text-green" },
                              { label:"From MA20",     value: s.context.pctFromMa20 ? `${s.context.pctFromMa20}%` : "—",    color: (s.context.pctFromMa20||0) < 0 ? "text-amber" : "text-green" },
                              { label:"Momentum",      value: `${s.context.momentum > 0 ? "+" : ""}${s.context.momentum}%`, color: (s.context.momentum||0) >= 0 ? "text-green" : "text-red" },
                              { label:"In range",      value: `${s.context.positionInRange}%`,                              color: (s.context.positionInRange||50) <= 40 ? "text-green" : "text-dim" },
                              { label:"From 52W high", value: `${s.context.pctFromYearHigh}%`,                              color: "text-dim" },
                            ].map(item => (
                              <div key={item.label} className="flex justify-between">
                                <span className="font-mono text-[10px] text-dim">{item.label}</span>
                                <span className={`font-mono text-[11px] font-medium ${item.color}`}>
                                  {item.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="font-mono text-[11px] text-muted">
                            {s.price?.error || "Connect Upstox for live technical data"}
                          </div>
                        )}
                      </div>

                      {/* Trade setup */}
                      <div className="bg-bg rounded-lg p-4">
                        <div className="font-mono text-[10px] text-dim uppercase
                          tracking-widest mb-3">
                          Trade setup
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="font-mono text-[10px] text-dim">Entry (current)</span>
                            <span className="font-mono text-[11px] text-text">
                              ₹{s.price?.current?.toLocaleString("en-IN") || "—"}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-mono text-[10px] text-dim">Avg-down zone</span>
                            <span className="font-mono text-[11px] text-amber">
                              {s.support?.nearest
                                ? `₹${s.support.nearest.price?.toLocaleString("en-IN")} (${s.support.nearest.type})`
                                : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-mono text-[10px] text-dim">Stop loss</span>
                            <span className="font-mono text-[11px] text-red">
                              {s.support?.second
                                ? `₹${(s.support.second.price * 0.97).toFixed(0)} (3% below ${s.support.second.type})`
                                : s.price?.current
                                ? `₹${(s.price.current * 0.93).toFixed(0)} (7% SL)`
                                : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-mono text-[10px] text-dim">Target</span>
                            <span className="font-mono text-[11px] text-green">
                              {s.price?.current && s.nextMonth.median_return
                                ? `₹${(s.price.current * (1 + s.nextMonth.median_return/100)).toFixed(0)} (+${s.nextMonth.median_return?.toFixed(1)}%)`
                                : `+${s.nextMonth.avg_return?.toFixed(1)}% from entry`}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-mono text-[10px] text-dim">Lot size</span>
                            <span className="font-mono text-[11px] text-soft">
                              {s.lot_size?.toLocaleString("en-IN")} shares
                            </span>
                          </div>
                          {s.price?.current && s.lot_size && (
                            <div className="flex justify-between">
                              <span className="font-mono text-[10px] text-dim">Notional/lot</span>
                              <span className="font-mono text-[11px] text-soft">
                                ₹{((s.price.current * s.lot_size) / 100000).toFixed(2)}L
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Contract note */}
                        <div className="mt-3 font-mono text-[10px] text-accent">
                          Trade: {s.symbol} {MONTHS[selectedMonth-1]} Futures
                        </div>
                        <div className="font-mono text-[10px] text-dim mt-1">
                          Enter now in current month contract
                          or next month contract depending on expiry
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
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
