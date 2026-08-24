"use client"
import { useState, useEffect, useCallback } from "react"
import Sidebar from "../components/Sidebar"
import StatCard from "../components/StatCard"

// ─────────────────────────────────────────────────────────────────────────────
// Inside Bar Bot — monitoring view for the breakout strategy.
//
// Deliberately the same screen as /fib with different numbers in it: contract
// strip, a hero state, the levels, the engine's own words. Two bots that look
// different would take two mental models to read, and the point of a monitor is
// that a glance is enough.
//
// The one structural difference is that this strategy trades BOTH ways, so the
// levels come in pairs — a long side and a short side — and the hero says which
// one, if either, is live.
//
// Presentation only. Every number arrives from GET /api/inside-bar/signal.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_MS = 60000
const DASH = "—"

function fmt(n, decimals = 2) {
  if (!Number.isFinite(n)) return DASH
  return n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** The offset is part of the string, so slicing shows IST wherever the browser
 *  is. Parsing to a Date would re-render a 15:15 IST bar for a traveller. */
function barLabel(iso) {
  if (typeof iso !== "string" || iso.length < 16) return null
  return { time: iso.slice(11, 16), date: iso.slice(0, 10) }
}

function isMarketHours(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600000)
  const day = ist.getUTCDay()
  if (day === 0 || day === 6) return false
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30
}

const STATES = {
  long_signal:       { label: "LONG SIGNAL",       tone: "green", note: "Breakout above the mother bar — a buy should be working." },
  short_signal:      { label: "SHORT SIGNAL",      tone: "red",   note: "Breakout below the mother bar — a sell should be working." },
  watching_breakout: { label: "WATCHING BREAKOUT", tone: "amber", note: "Inside bar formed. Waiting for price to leave the mother bar." },
  no_setup:          { label: "NO SETUP",          tone: "dim",   note: "No inside bar in the recent window." },
}

export default function InsideBarPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState(null)
  const [lastFetch, setLastFetch] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inside-bar/signal", { cache: "no-store" })
      setData(await res.json())
      setFetchErr(null)
    } catch (e) {
      setFetchErr(e.message || "Could not reach the server")
    } finally {
      setLoading(false)
      setLastFetch(new Date())
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const id = setInterval(() => { if (isMarketHours()) load() }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const contract   = data?.contract || null
  const signal     = data?.signal || null
  const tokenValid = data?.tokenValid === true
  const payloadErr = data?.error || null

  const state = !tokenValid || !signal ? null : STATES[signal.state] || STATES.no_setup
  const hero  = state || { label: "SIGNAL UNAVAILABLE", tone: "dim",
                           note: tokenValid ? "The engine could not produce a signal." : "Connect Upstox to see the live signal." }

  const toneText = { green: "text-green", red: "text-red", amber: "text-amber", dim: "text-dim" }[hero.tone]
  const toneBg   = { green: "border-green/30 bg-green/5", red: "border-red/30 bg-red/5",
                     amber: "border-amber/30 bg-amber/5", dim: "border-border bg-card" }[hero.tone]

  const bar = barLabel(signal?.asOf)
  const armed = signal?.entryValid === true
  const dir = signal?.direction

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">

        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">
              Automated Strategy · Monitoring
            </div>
            <h1 className="font-display text-3xl font-bold text-text">
              Inside Bar<span className="text-accent">.</span>
            </h1>
            <p className="font-mono text-[11px] text-dim mt-2 max-w-2xl">
              Nifty futures, hourly. An <span className="text-soft">inside bar</span> marks a pause; the
              break of the bar it sits inside picks the direction. Stop on the opposite side,
              target 5× that range. <span className="text-soft">Long and short</span>, watch-only.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastFetch && (
              <span className="font-mono text-[10px] text-muted">
                checked {lastFetch.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button onClick={load} disabled={loading}
              className="font-mono text-sm px-4 py-2 rounded border border-border bg-card text-soft
                hover:text-text hover:border-accent/40 transition-colors disabled:opacity-50">
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {!loading && !tokenValid && (
          <div className="mb-6 p-4 rounded-lg border border-amber/20 bg-amber/5 flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest mb-1 text-amber">⚠ Upstox Not Connected</div>
              <div className="font-body text-sm text-dim">
                {payloadErr || "The signal is built from live hourly candles — connect to see it."}
              </div>
            </div>
            <a href="/api/upstox/login?next=/inside-bar"
              className="font-mono text-sm px-4 py-2 rounded border border-accent/30 bg-accent/10
                text-accent hover:bg-accent/20 transition-colors whitespace-nowrap">
              Connect Upstox →
            </a>
          </div>
        )}

        {fetchErr && (
          <div className="mb-6 p-4 rounded-lg border border-red/30 bg-red/5">
            <div className="font-mono text-[11px] uppercase tracking-widest mb-1 text-red">✕ Could Not Reach The Server</div>
            <div className="font-body text-sm text-dim">{fetchErr}</div>
          </div>
        )}

        {/* ── Contract strip ─────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 mb-6">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Contract</div>
              <div className="font-mono text-base text-text flex items-center gap-2">
                {contract?.tradingSymbol || DASH}
                {/* Without this, a contract change mid-month reads as a bug: the
                    front month is still trading, so "why is it on September?" is
                    the obvious question. Says the switch was deliberate. */}
                {contract?.rolled && (
                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-purple/15 text-purple
                    uppercase tracking-widest" title="Rolled early — the previous contract was too close to expiry for a trade to finish">
                    rolled early
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Expiry</div>
              <div className="font-mono text-sm text-text">
                {contract?.expiryDate || DASH}
                {Number.isFinite(contract?.daysToExpiry) && (
                  <span className={`ml-2 text-[11px] ${contract.daysToExpiry <= 3 ? "text-amber" : "text-muted"}`}>
                    {contract.daysToExpiry === 0 ? "expires today" : `${contract.daysToExpiry}d away`}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Lot Size</div>
              <div className="font-mono text-sm text-text">{contract?.lotSize ?? DASH}</div>
            </div>
          </div>
        </div>

        {/* ── Hero ───────────────────────────────────────────────────── */}
        <div className={`rounded-lg border p-5 md:p-6 mb-6 ${toneBg}`}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className={`font-display text-2xl md:text-3xl font-bold ${toneText} tracking-tight`}>
                {hero.label}
              </div>
              <div className="font-body text-sm text-dim mt-1">{hero.note}</div>
              {(signal?.reason || payloadErr) && (
                <p className="font-mono text-[12px] text-soft mt-3 leading-relaxed max-w-3xl">
                  {signal?.reason || payloadErr}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">As Of</div>
              {bar ? (
                <>
                  <div className="font-mono text-lg text-text">{bar.time}</div>
                  <div className="font-mono text-[11px] text-muted">{bar.date} bar</div>
                </>
              ) : <div className="font-mono text-lg text-dim">{DASH}</div>}
            </div>
          </div>
        </div>

        {/* ── The mother bar ─────────────────────────────────────────── */}
        <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-3">
          The mother bar {signal?.isInsideBar ? "· inside bar just closed" : ""}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard label="Mother High — long trigger" value={fmt(signal?.motherHigh)}
            sub="break above = long" color="text-green" />
          <StatCard label="Mother Low — short trigger" value={fmt(signal?.motherLow)}
            sub="break below = short" color="text-red" />
          <StatCard label="Range" value={fmt(signal?.range)} sub="= initial risk, in points" color="text-soft" />
          <StatCard label="Last Close" value={fmt(signal?.lastClose)}
            sub={Number.isFinite(signal?.breakoutBarsAgo) ? `broke ${signal.breakoutBarsAgo} bar(s) ago` : "inside the range"}
            color="text-soft" />
        </div>

        {/* ── Both sides, the live one highlighted ───────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
          {/* Class names are written out in full, never built from a variable.
              Tailwind extracts classes by reading the source, so `bg-${tint}/5`
              produces markup referencing a class that was never generated — it
              silently renders unstyled rather than failing loudly. */}
          {[
            { side: "LONG", live: dir === "long", entry: signal?.longTrigger, stop: signal?.longStop,
              target: signal?.longTarget,
              card: "border-green/40 bg-green/5", label: "text-green", chip: "bg-green/15 text-green" },
            { side: "SHORT", live: dir === "short", entry: signal?.shortTrigger, stop: signal?.shortStop,
              target: signal?.shortTarget,
              card: "border-red/40 bg-red/5", label: "text-red", chip: "bg-red/15 text-red" },
          ].map((s) => (
            <div key={s.side}
              className={`rounded-lg border p-4 ${s.live && armed ? s.card : "border-border bg-card"}`}>
              <div className="flex items-center justify-between mb-3">
                <div className={`font-mono text-[11px] uppercase tracking-widest ${s.live ? s.label : "text-dim"}`}>
                  {s.side} side
                </div>
                {s.live && (
                  <div className={`font-mono text-[10px] px-2 py-0.5 rounded ${armed ? s.chip : "bg-card text-muted"}`}>
                    {armed ? "LIVE" : "TOO LATE"}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Entry</div>
                  <div className="font-mono text-base text-text">{fmt(s.entry)}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Stop</div>
                  <div className="font-mono text-base text-red">{fmt(s.stop)}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Target</div>
                  <div className="font-mono text-base text-green">{fmt(s.target)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">Notes</div>
          <ul className="font-mono text-[11px] text-muted space-y-1.5 leading-relaxed">
            <li>· An inside bar never signals on its own — the breakout is always a <span className="text-soft">later</span> bar.</li>
            <li>· Levels come from the last <span className="text-soft">closed</span> bar; the forming bar is excluded.</li>
            <li>· A single bar breaking both sides voids the setup — the direction is unknowable from hourly data.</li>
            <li>· Target is {data?.config?.targetMult ?? 5}× the mother range; timeout after {data?.config?.timeoutBars ?? 20} bars.</li>
            {data?.barsUsed ? <li>· Computed from {data.barsUsed} closed bars.</li> : null}
          </ul>
        </div>

      </main>
    </div>
  )
}
