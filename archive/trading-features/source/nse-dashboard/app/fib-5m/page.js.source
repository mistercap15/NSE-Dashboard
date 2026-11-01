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
// TWO SOURCES, AND THE PANEL SAYS WHICH ONE IT IS USING. /api/bot/status serves
// what the bots on the droplet actually believe — holding, armed, paused,
// halted, and who owns the contract claim. When that is reachable the panel
// shows real state and is badged "live bot state". When it is not, the panel
// falls back to what the two SIGNALS imply and is badged "derived from signals",
// because a monitoring screen that cannot tell you which it is showing is worse
// than one that shows less.
//
// The distinction is not academic. On 7 Sep the signals were entirely normal
// while the hourly bot had adopted this bot's position and both were bracketing
// the same lots. Only the bots' own state showed it — which is why this page now
// also shouts if both report a position at once.
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
  const [bots, setBots] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState(null)
  const [lastFetch, setLastFetch] = useState(null)

  const load = useCallback(async () => {
    try {
      // Both, together. The hourly one is not decoration — it decides whether
      // this bot may trade at all.
      const [a, b, s] = await Promise.all([
        fetch("/api/fib-5m/signal", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/fib/signal", { cache: "no-store" }).then((r) => r.json()),
        // What the bots actually believe, straight off the droplet. Never
        // throws — /api/bot/status always answers with a shape.
        fetch("/api/bot/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ])
      setData(a)
      setHourly(b)
      setBots(s)
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
  // Live bot state wins wherever it is available; the signals are the fallback.
  const live = bots?.reachable === true
  const hourlyBot = live ? bots?.bots?.hourly : null
  const fiveBot   = live ? bots?.bots?.fivemin : null
  const claim     = live ? bots?.claim : null
  const bothHolding = Boolean(hourlyBot?.holding && fiveBot?.holding)

  // The bot's own view of whether it must stand down, when we can see it.
  const yielding = live
    ? Boolean(hourlyBot?.holding || hourlyBot?.armed
              || (claim && claim.owner !== "5m"))
    : hourlyArmed
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

        {/* ── Who owns the contract ──────────────────────────────────
            REAL bot state when the droplet is reachable; the signals are only
            the fallback. The distinction matters: on 7 Sep the signals looked
            normal while both bots held the same lots, and only the bots' own
            state showed it. */}
        <div className="rounded-lg border border-border bg-card p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="font-mono text-[10px] text-dim uppercase tracking-widest">
              Who has priority on this contract
            </div>
            <span className={`font-mono text-[9px] px-2 py-0.5 rounded uppercase tracking-widest ${
              live ? "bg-green/15 text-green" : "bg-amber/15 text-amber"}`}>
              {live ? "live bot state" : "derived from signals"}
            </span>
          </div>

          {bothHolding && (
            <div className="mb-3 p-3 rounded-md border border-red/40 bg-red/10">
              <div className="font-mono text-[11px] text-red uppercase tracking-widest mb-1">
                ⚠ Both bots report a position
              </div>
              <div className="font-body text-sm text-soft">
                Only one may ever hold this contract — Upstox nets positions. Check the account
                now, and send <span className="font-mono text-text">/halt</span> to both bots.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: "hourly", name: "Hourly bot · senior", bot: hourlyBot,
                fallback: hourlyArmed ? "Has a live setup" : "Idle" },
              { key: "fivemin", name: "5-min bot · junior", bot: fiveBot,
                fallback: yielding ? "Stands down" : armed ? "Free to trade" : "Waiting for a setup" },
            ].map(({ key, name, bot, fallback }) => {
              const holding = bot?.holding
              const down = bot && bot.service !== "active"
              const tone = down ? "border-red/40 bg-red/5"
                : holding ? "border-accent/40 bg-accent/5"
                : bot?.halted || bot?.enabled === false ? "border-amber/40 bg-amber/5"
                : "border-border bg-surface"
              const txt = down ? "text-red" : holding ? "text-accent"
                : bot?.halted || bot?.enabled === false ? "text-amber" : "text-soft"
              return (
                <div key={key} className={`rounded-md border p-3 ${tone}`}>
                  <div className="font-mono text-[10px] text-dim uppercase tracking-widest">{name}</div>
                  <div className={`font-display text-lg font-bold mt-1 ${txt}`}>
                    {!bot ? fallback
                      : down ? `SERVICE ${String(bot.service).toUpperCase()}`
                      : bot.halted ? "HALTED — places nothing"
                      : bot.enabled === false ? "PAUSED — no new trades"
                      : holding ? "Holding a position"
                      : bot.armed ? "Order armed"
                      : "Flat"}
                  </div>
                  <div className="font-mono text-[11px] text-muted mt-1">
                    {bot ? bot.summary : "from the signal only"}
                  </div>
                  {bot?.holding && (
                    <div className="font-mono text-[11px] text-soft mt-2">
                      entry {fmt(bot.entryPrice)} · stop {fmt(bot.stop)} · target {fmt(bot.target)}
                    </div>
                  )}
                  {bot?.stale && (
                    <div className="font-mono text-[10px] text-amber mt-2">
                      state {Math.round(bot.stateAgeSeconds)}s old — it may be down
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="font-mono text-[11px] text-muted">
              Contract claim:{" "}
              {claim
                ? <span className="text-soft">
                    {claim.owner === "5m" ? "the 5-min bot" : "the hourly bot"}
                    {claim.holding ? " holds a filled position" : " has an order out"}
                  </span>
                : <span className="text-dim">nobody holds it</span>}
            </div>
            {!live && (
              <div className="font-mono text-[10px] text-amber">
                {bots?.error || "Could not reach the droplet — showing what the signals imply."}
              </div>
            )}
          </div>
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
