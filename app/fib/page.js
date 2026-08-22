"use client"
import { useState, useEffect, useCallback } from "react"
import Sidebar from "../components/Sidebar"
import StatCard from "../components/StatCard"

// ─────────────────────────────────────────────────────────────────────────────
// Fib Bot — monitoring view for the Nifty futures Fibonacci strategy.
//
// Presentation only. Every number on this page comes from GET /api/fib/signal;
// nothing here computes a level, a distance or a ratio. That is the same rule
// the mobile app follows, and it is why the two clients cannot disagree about
// what the bot would do — they render the identical payload from one engine
// (app/lib/fib.js).
//
// The bot does not trade yet. This screen answers one question: if the executor
// were running right now, would an order be resting, and at what price?
// ─────────────────────────────────────────────────────────────────────────────

/** How often to re-ask while the market is open. It's an hourly-bar strategy —
 *  a new bar can only appear once an hour, so a minute is already generous. */
const POLL_MS = 60000

const DASH = "—"

/** Display formatting only. Index levels are quoted to 2dp. */
function fmt(n, decimals = 2) {
  if (!Number.isFinite(n)) return DASH
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Bar timestamps arrive as "2026-08-18T15:15:00+05:30" — the offset is part of
 * the string, so slicing it shows IST wherever the browser happens to be.
 * new Date(...).toLocaleTimeString() would silently re-render a 15:15 IST bar as
 * 09:45 for anyone outside India, which is exactly the sort of quiet wrongness
 * a trading screen cannot afford.
 */
function barLabel(iso) {
  if (typeof iso !== "string" || iso.length < 16) return null
  return { time: iso.slice(11, 16), date: iso.slice(0, 10) }
}

/** NSE trades 09:15–15:30 IST, Mon–Fri. Used only to decide whether to poll. */
function isMarketHours(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600000)
  const day = ist.getUTCDay()
  if (day === 0 || day === 6) return false
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30
}

export default function FibBotPage() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  // Token sync to the droplet. `null` until a sync is attempted; then
  // { ok, message }. Deliberately holds no token — see /api/bot/sync.
  const [sync,    setSync]    = useState(null)
  const [syncing, setSyncing] = useState(false)
  // Whether a personal Upstox login exists on this browser. Distinct from the
  // signal's tokenValid, which is satisfied by the analytics token alone.
  const [oauthLinked, setOauthLinked] = useState(null)
  const [fetchErr, setFetchErr] = useState(null)
  const [lastFetch, setLastFetch] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/fib/signal", { cache: "no-store" })
      const json = await res.json()
      setData(json)
      setFetchErr(null)
    } catch (e) {
      // The route itself never throws, so this only fires if the network or the
      // deployment is down. Keep whatever was last shown rather than blanking.
      setFetchErr(e.message || "Could not reach the server")
    } finally {
      setLoading(false)
      setLastFetch(new Date())
    }
  }, [])

  // Push the trading account's order-capable token to the droplet. The button is
  // Declared before syncToken, which depends on it. `const` is not hoisted, so
  // the reverse order throws "Cannot access before initialization" during
  // render — and this page prerenders, so it fails the build, not just the page.
  const loadLinkState = useCallback(async () => {
    try {
      const d = await (await fetch("/api/upstox/status", { cache: "no-store" })).json()
      setOauthLinked(Boolean(d.oauthLinked))
    } catch { /* leave unknown; both buttons stay hidden rather than lying */ }
  }, [])

  // visible to anyone who can open this page; the real gate is server-side, where
  // /api/bot/sync refuses unless the token's Upstox account matches BOT_ACCOUNT_ID.
  const syncToken = useCallback(async () => {
    setSyncing(true)
    setSync(null)
    try {
      const res  = await fetch("/api/bot/sync", { method: "POST" })
      const json = await res.json()
      setSync(json.synced
        ? { ok: true,  message: `Synced for ${json.account} — valid until 03:30 IST` }
        : { ok: false, message: json.error || `Sync failed (${res.status})` })
    } catch (e) {
      setSync({ ok: false, message: e.message || "Could not reach the server" })
    } finally {
      setSyncing(false)
      loadLinkState()
    }
  }, [loadLinkState])

  useEffect(() => { load(); loadLinkState() }, [load, loadLinkState])

  useEffect(() => {
    const id = setInterval(() => { if (isMarketHours()) load() }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const contract   = data?.contract || null
  const signal     = data?.signal || null
  const tokenValid = data?.tokenValid === true
  const payloadErr = data?.error || null

  // Three states, in priority order: no token → nothing to show; an error or a
  // null signal → say why; otherwise the engine's own verdict.
  const armed = signal?.entryValid === true
  const state = !tokenValid ? "disconnected" : !signal ? "unavailable" : armed ? "armed" : "aside"

  const bar = barLabel(signal?.asOf)

  const STATE = {
    armed:        { label: "ORDER ARMED",       tone: "green", note: "A buy order should be resting at the entry price." },
    aside:        { label: "STAND ASIDE",       tone: "amber", note: "No order should be resting right now." },
    unavailable:  { label: "SIGNAL UNAVAILABLE", tone: "dim",   note: "The engine could not produce a signal." },
    disconnected: { label: "SIGNAL UNAVAILABLE", tone: "dim",   note: "Connect Upstox to see the live signal." },
  }[state]

  const toneText = { green: "text-green", amber: "text-amber", dim: "text-dim" }[STATE.tone]
  const toneBg   = { green: "border-green/30 bg-green/5", amber: "border-amber/30 bg-amber/5", dim: "border-border bg-card" }[STATE.tone]

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">
              Automated Strategy · Monitoring
            </div>
            <h1 className="font-display text-3xl font-bold text-text">
              Fib Bot<span className="text-accent">.</span>
            </h1>
            <p className="font-mono text-[11px] text-dim mt-2 max-w-2xl">
              Nifty futures, hourly bars. Buys the <span className="text-soft">0.618 retracement</span> of the
              last 30-bar swing when price is still holding above the midpoint; stop 2 ATRs below,
              target the swing high. <span className="text-soft">Watch-only</span> — nothing is being traded.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastFetch && (
              <span className="font-mono text-[10px] text-muted">
                checked {lastFetch.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="font-mono text-sm px-4 py-2 rounded border border-border bg-card text-soft
                hover:text-text hover:border-accent/40 transition-colors disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* ── Upstox connection (same pattern as swing-low / early-entry) ── */}
        {!loading && !tokenValid && (
          <div className="mb-6 p-4 rounded-lg border border-amber/20 bg-amber/5 flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest mb-1 text-amber">
                ⚠ Upstox Not Connected
              </div>
              <div className="font-body text-sm text-dim">
                {payloadErr || "The signal is built from live hourly candles — connect to see it."}
                {" "}Tokens lapse at 03:30 IST daily, so this is a once-a-day reconnect.
              </div>
            </div>
            <a href="/api/upstox/login"
              className="font-mono text-sm px-4 py-2 rounded border border-accent/30 bg-accent/10
                text-accent hover:bg-accent/20 transition-colors whitespace-nowrap">
              Connect Upstox →
            </a>
          </div>
        )}

        {/* A network failure is distinct from the route's own error payload. */}
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
              <div className="font-mono text-base text-text">{contract?.tradingSymbol || DASH}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Instrument Key</div>
              <div className="font-mono text-sm text-soft">{contract?.instrumentKey || DASH}</div>
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
            {contract?.rollsInto && (
              <div>
                <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Rolls Into</div>
                <div className="font-mono text-sm text-soft">{contract.rollsInto.tradingSymbol}</div>
              </div>
            )}
          </div>
        </div>

        {/* ── Bot token sync ─────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-1">
                Bot Token
              </div>
              <div className="font-body text-sm text-dim">
                Pushes your order-capable Upstox token to the droplet so the executor can trade.
              </div>
              <div className="font-mono text-[11px] text-muted mt-1.5">
                {oauthLinked === false
                  ? "Log in as the trading account (84BDRQ) first — the token it issues is what gets synced."
                  : "Logged in. Prices on this page use a separate read-only token and are unaffected."}
              </div>
              {sync && (
                <div className={`font-mono text-[11px] mt-2 ${sync.ok ? "text-green" : "text-red"}`}>
                  {sync.ok ? "✓ " : "✗ "}{sync.message}
                </div>
              )}
            </div>
            {/* One button at a time: the two actions are sequential, and showing
                a login you don't need next to a sync you can't do is just noise.
                While the link state is unknown neither renders — better briefly
                empty than briefly wrong. */}
            <div className="flex items-center gap-2 shrink-0">
              {oauthLinked === false && (
                <a
                  href="/api/upstox/login?next=/fib"
                  className="font-mono text-sm px-4 py-2 rounded border border-accent/30 bg-accent/10
                    text-accent hover:bg-accent/20 transition-colors whitespace-nowrap"
                >
                  Log in to trading account →
                </a>
              )}
              {oauthLinked === true && (
                <button
                  onClick={syncToken}
                  disabled={syncing}
                  className="font-mono text-sm px-4 py-2 rounded border border-purple/30 bg-purple/10
                    text-purple hover:bg-purple/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {syncing ? "Syncing…" : "Sync token to droplet"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Signal state (the hero) ────────────────────────────────── */}
        <div className={`rounded-lg border p-5 md:p-6 mb-6 ${toneBg}`}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className={`font-display text-2xl md:text-3xl font-bold ${toneText} tracking-tight`}>
                {STATE.label}
              </div>
              <div className="font-body text-sm text-dim mt-1">{STATE.note}</div>
              {/* The engine's own words, verbatim — it already explains itself. */}
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
              ) : (
                <div className="font-mono text-lg text-dim">{DASH}</div>
              )}
            </div>
          </div>
        </div>

        {/* ── The levels ─────────────────────────────────────────────── */}
        <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-3">
          The plan {armed ? "in force" : "if it re-arms"}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <StatCard
            label="Fib Entry — limit buy"
            value={fmt(signal?.fibEntry)}
            sub={armed ? "order rests here" : "not armed"}
            color={armed ? "text-accent" : "text-text"}
          />
          <StatCard
            label="Stop"
            value={fmt(signal?.stopPrice)}
            sub={Number.isFinite(signal?.stopDistancePts) ? `${fmt(signal.stopDistancePts)} pts risk` : undefined}
            color="text-red"
          />
          <StatCard
            label="Target"
            value={fmt(signal?.targetPrice)}
            sub={Number.isFinite(signal?.targetDistancePts) ? `${fmt(signal.targetDistancePts)} pts reward` : undefined}
            color="text-green"
          />
          <StatCard
            label="Reward : Risk"
            value={Number.isFinite(signal?.rewardRiskRatio) ? `${fmt(signal.rewardRiskRatio)}×` : DASH}
            sub="target ÷ stop distance"
            color={
              !Number.isFinite(signal?.rewardRiskRatio) ? "text-text"
                : signal.rewardRiskRatio >= 2 ? "text-green"
                : signal.rewardRiskRatio >= 1.5 ? "text-amber" : "text-red"
            }
          />
        </div>

        {/* ── Supporting detail ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard label="Swing High" value={fmt(signal?.swingHigh)} sub="30-bar high · target" color="text-soft" />
          <StatCard label="Swing Low"  value={fmt(signal?.swingLow)}  sub="30-bar low" color="text-soft" />
          <StatCard label="Range"      value={fmt(signal?.range)}     sub="high − low, pts" color="text-soft" />
          <StatCard label="ATR (14)"   value={fmt(signal?.atr)}       sub="stop = 2 × ATR" color="text-soft" />
        </div>

        {/* ── Footnotes ──────────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">Notes</div>
          <ul className="font-mono text-[11px] text-muted space-y-1.5 leading-relaxed">
            <li>
              · Levels come from the last <span className="text-soft">closed</span> hourly bar. The bar currently
              forming is excluded, so nothing here flickers mid-hour.
            </li>
            <li>
              · Hourly bars run 09:15, 10:15 … 15:15 IST; the 15:15 bar is a 15-minute stub closing with the session.
            </li>
            <li>
              · Watch-only. No orders are placed from this app — the executor is a later build and needs a
              static IP, which this deployment does not have.
            </li>
            {data?.barsUsed ? <li>· Computed from {data.barsUsed} closed bars.</li> : null}
          </ul>
        </div>

      </main>
    </div>
  )
}
