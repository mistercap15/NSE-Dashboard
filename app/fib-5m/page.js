"use client"
import { useState, useEffect, useCallback } from "react"
import Sidebar from "../components/Sidebar"
import StatCard from "../components/StatCard"

// ─────────────────────────────────────────────────────────────────────────────
// 5-Minute Fib Bot — monitoring view for the gap-fill bot.
//
// Same strategy and the same screen language as /fib; only the bar length
// differs. What this page adds, and the reason it exists, is the COORDINATION
// picture: this bot only trades while the hourly bot is idle, so "what is it
// doing" is unanswerable from its own signal alone. Both signals are fetched
// and shown together.
//
// HONEST ABOUT WHAT IT CAN AND CANNOT SEE. This page reads the two SIGNAL
// routes. It does not read the droplet's state files, the exchange position or
// the contract claim — those live on the bot's machine, and the bot decides on
// all three. So the priority panel below says what the SIGNALS imply, which is
// the common case and a good predictor, and labels itself as such rather than
// pretending to be the bot's own verdict. Telegram and /status remain the
// authority on what the bot actually did.
//
// 7 Sep 2026 is why the panel leads with priority rather than tucking it at the
// bottom: on that day the hourly adopted this bot's position and both bracketed
// the same lots. Which bot owns the contract is the first thing worth seeing.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_MS = 30000          // a 5-minute bar closes twelve times an hour
const DASH = "—"

function fmt(n, decimals = 2) {
  if (!Number.isFinite(n)) return DASH
  return n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function barLabel(iso) {
  if (typeof iso !== "string" || iso.length < 16) return null
  return { time: iso.slice(11, 16), date: iso.slice(0, 10) }
}

export default function Fib5mPage() {
  const [data, setData] = useState(null)
  const [hourly, setHourly] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState(null)
  const [lastFetch, setLastFetch] = useState(null)

  const load = useCallback(async () => {
    try {
      // Both, together. The hourly one is not decoration — it decides whether
      // this bot may trade at all.
      const [a, b] = await Promise.all([
        fetch("/api/fib-5m/signal", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/fib/signal", { cache: "no-store" }).then((r) => r.json()),
      ])
      setData(a)
      setHourly(b)
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
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const signal = data?.signal || null
  const err    = data?.error || null
  const armed  = signal?.entryValid === true
  const bar    = barLabel(signal?.asOf)
  const c      = data?.contract || null

  const hourlySignal = hourly?.signal || null
  const hourlyArmed  = hourlySignal?.entryValid === true

  const riskPts = Number.isFinite(signal?.fibEntry) && Number.isFinite(signal?.stopPrice)
    ? signal.fibEntry - signal.stopPrice
    : null

  // What the signals imply about priority. Not the bot's own verdict — see the
  // header note — so the wording stays conditional throughout.
  const yielding = hourlyArmed
  const state = !signal ? "unavailable" : yielding ? "yield" : armed ? "armed" : "aside"
  const HERO = {
    armed:       { label: "READY TO BUY", tone: "green",
                   note: "The hourly bot looks idle, so a buy order should be waiting at this price." },
    aside:       { label: "WAITING FOR A SETUP", tone: "amber",
                   note: "No order should be waiting right now." },
    yield:       { label: "STANDING DOWN", tone: "purple",
                   note: "The hourly bot has a live setup, so this bot opens nothing until it clears." },
    unavailable: { label: "NO SIGNAL", tone: "dim",
                   note: err || "The engine could not work out a signal." },
  }[state]
  const toneText = { green: "text-green", amber: "text-amber", purple: "text-purple", dim: "text-dim" }[HERO.tone]
  const toneBg = {
    green: "border-green/30 bg-green/5", amber: "border-amber/30 bg-amber/5",
    purple: "border-purple/30 bg-purple/5", dim: "border-border bg-card",
  }[HERO.tone]

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">

        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">
              Automated Strategy · Monitoring
            </div>
            <h1 className="font-display text-3xl font-bold text-text flex items-center gap-3">
              5-Min Fib<span className="text-accent">.</span>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded uppercase tracking-widest bg-red/15 text-red">
                live · real money
              </span>
            </h1>
            <p className="font-mono text-[11px] text-dim mt-2 max-w-2xl">
              The <span className="text-soft">same swing-Fib strategy</span> as the hourly Nifty bot, on
              5-minute bars. It exists to fill the idle time between hourly setups and
              <span className="text-soft"> yields to the hourly bot in every case</span>.
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

        {fetchErr && (
          <div className="mb-6 p-4 rounded-lg border border-red/30 bg-red/5">
            <div className="font-mono text-[11px] uppercase tracking-widest mb-1 text-red">✕ Could Not Reach The Server</div>
            <div className="font-body text-sm text-dim">{fetchErr}</div>
          </div>
        )}

        {/* ── Who owns the contract ──────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-card p-4 mb-4">
          <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-3">
            Who has priority on this contract
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className={`rounded-md border p-3 ${
              hourlyArmed ? "border-accent/40 bg-accent/5" : "border-border bg-surface"}`}>
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest">Hourly bot · senior</div>
              <div className={`font-display text-lg font-bold mt-1 ${hourlyArmed ? "text-accent" : "text-soft"}`}>
                {hourly?.signal ? (hourlyArmed ? "Has a live setup" : "Idle") : "No signal"}
              </div>
              <div className="font-mono text-[11px] text-muted mt-1">
                {hourlyArmed
                  ? `buy ${fmt(hourlySignal.fibEntry)} · stop ${fmt(hourlySignal.stopPrice)}`
                  : "nothing armed"}
              </div>
            </div>
            <div className={`rounded-md border p-3 ${
              yielding ? "border-purple/40 bg-purple/5" : armed ? "border-green/40 bg-green/5" : "border-border bg-surface"}`}>
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest">5-min bot · junior</div>
              <div className={`font-display text-lg font-bold mt-1 ${
                yielding ? "text-purple" : armed ? "text-green" : "text-soft"}`}>
                {yielding ? "Stands down" : armed ? "Free to trade" : "Waiting for a setup"}
              </div>
              <div className="font-mono text-[11px] text-muted mt-1">
                {yielding ? "no new trades until the hourly clears" : "the hourly is not in the way"}
              </div>
            </div>
          </div>
          <p className="font-mono text-[10px] text-muted mt-3 leading-relaxed">
            Derived from the two <span className="text-soft">signals</span>, not from the bot itself. The bot
            also checks the exchange position, the order book and the contract claim on its own machine, so
            it can stand down for reasons this page cannot see. Telegram and <span className="text-soft">/status</span>
            {" "}are the authority.
          </p>
        </div>

        {/* ── Hero ───────────────────────────────────────────────────── */}
        <div className={`rounded-lg border p-5 md:p-6 mb-6 ${toneBg}`}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className={`font-display text-2xl md:text-3xl font-bold ${toneText} tracking-tight`}>
                {HERO.label}
              </div>
              <div className="font-body text-sm text-dim mt-1">{HERO.note}</div>
              {(signal?.reason || err) && (
                <p className="font-mono text-[12px] text-soft mt-3 leading-relaxed max-w-3xl">
                  {signal?.reason || err}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">As Of</div>
              {bar ? (
                <>
                  <div className="font-mono text-lg text-text">{bar.time} IST</div>
                  <div className="font-mono text-[11px] text-muted">{bar.date} · 5-min bar</div>
                </>
              ) : <div className="font-mono text-lg text-dim">{DASH}</div>}
            </div>
          </div>
        </div>

        {/* ── Levels ─────────────────────────────────────────────────── */}
        <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-3">
          The plan {armed ? "right now" : "when a setup appears"}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <StatCard label="Buy at (Fib level)" value={fmt(signal?.fibEntry)}
            sub={armed && !yielding ? "order waits here" : "no order yet"}
            color={armed && !yielding ? "text-accent" : "text-text"} />
          <StatCard label="Stop" value={fmt(signal?.stopPrice)}
            sub={riskPts != null ? `${fmt(riskPts)} pts below entry` : undefined} color="text-red" />
          <StatCard label="Target" value={fmt(signal?.targetPrice)} sub="the swing high" color="text-green" />
          <StatCard label="Reward : Risk"
            value={Number.isFinite(signal?.rewardRiskRatio) ? `${fmt(signal.rewardRiskRatio)}×` : DASH}
            sub="target ÷ stop distance"
            color={!Number.isFinite(signal?.rewardRiskRatio) ? "text-text"
              : signal.rewardRiskRatio >= 2 ? "text-green"
              : signal.rewardRiskRatio >= 1.5 ? "text-amber" : "text-red"} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard label="Swing High" value={fmt(signal?.swingHigh)} sub="30-bar high · target" color="text-soft" />
          <StatCard label="Swing Low"  value={fmt(signal?.swingLow)}  sub="30-bar low" color="text-soft" />
          <StatCard label="ATR (14)"   value={fmt(signal?.atr)}       sub="stop = 2 × ATR" color="text-soft" />
          <StatCard label="Contract"   value={c?.tradingSymbol || DASH}
            sub={c ? `lot ${c.lotSize} · ${c.daysToExpiry}d to expiry` : undefined} color="text-soft" mono />
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">Notes</div>
          <ul className="font-mono text-[11px] text-muted space-y-1.5 leading-relaxed">
            <li>· Same engine as the hourly Fib bot — <span className="text-soft">app/lib/fib.js</span>, one copy,
              only the candle feed differs.</li>
            <li>· The buy is a <span className="text-soft">waiting limit order</span>, so it fills at that price
              or better, or not at all.</li>
            <li>· 30 bars of timeout is <span className="text-soft">2.5 hours</span> here, against four sessions
              on the hourly. Same number, very different horizon.</li>
            <li>· Both bots trade this one contract on one Upstox account, and Upstox nets positions —
              which is why only one of them may ever hold it.</li>
            <li>· <span className="text-soft">/halt</span> to the Telegram bot stops it placing anything at all;
              <span className="text-soft"> /stop</span> only stops new entries and keeps protecting an open trade.</li>
            {data?.barsUsed ? <li>· Computed from {data.barsUsed} closed 5-minute bars.</li> : null}
          </ul>
        </div>

      </main>
    </div>
  )
}
