"use client"
import { useState, useEffect, useCallback } from "react"
import Sidebar from "../components/Sidebar"
import StatCard from "../components/StatCard"

// ─────────────────────────────────────────────────────────────────────────────
// Crypto Fib Bot — monitoring view for the Delta perpetuals bot.
//
// The same screen language as /fib, because it is the same strategy: only the
// instrument differs. Three things are genuinely different and the screen says
// so rather than hiding them:
//
//   • a NETWORK badge, because testnet and mainnet must never be confused
//   • a symbol switch, since one bot trades one symbol but the signal serves both
//   • the stop as a PERCENTAGE, which is what makes the 2x leverage cap legible:
//     a ~2% stop at 50x is the whole margin, which is how the previous bot died
//
// There is no Upstox connection banner. Delta's candle endpoint is public, so
// this page needs no broker credential at all.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_MS = 60000          // crypto is 24/7 — no market-hours gate
const DASH = "—"
const SYMBOLS = [
  { key: "BTC", label: "BTC", lot: 0.001 },
  { key: "ETH", label: "ETH", lot: 0.01 },
]

function fmt(n, decimals = 2) {
  if (!Number.isFinite(n)) return DASH
  return n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function barLabel(iso) {
  if (typeof iso !== "string" || iso.length < 16) return null
  return { time: iso.slice(11, 16) + " UTC", date: iso.slice(0, 10) }
}

export default function CryptoFibPage() {
  const [symbol, setSymbol] = useState("ETH")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState(null)
  const [lastFetch, setLastFetch] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crypto-fib/signal?symbol=${symbol}`, { cache: "no-store" })
      setData(await res.json())
      setFetchErr(null)
    } catch (e) {
      setFetchErr(e.message || "Could not reach the server")
    } finally {
      setLoading(false)
      setLastFetch(new Date())
    }
  }, [symbol])

  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => {
    const id = setInterval(load, POLL_MS)   // always — the market never closes
    return () => clearInterval(id)
  }, [load])

  const signal  = data?.signal || null
  const err     = data?.error || null
  const armed   = signal?.entryValid === true
  const testnet = data?.network !== "mainnet"
  const bar     = barLabel(signal?.asOf)

  // The number that justifies the leverage cap.
  const riskPct = Number.isFinite(signal?.fibEntry) && Number.isFinite(signal?.stopPrice)
    ? ((signal.fibEntry - signal.stopPrice) / signal.fibEntry) * 100
    : null

  const state = !signal ? "unavailable" : armed ? "armed" : "aside"
  const HERO = {
    armed:       { label: "ORDER ARMED", tone: "green", note: "A limit buy should be resting at the entry price." },
    aside:       { label: "STAND ASIDE", tone: "amber", note: "No order should be resting right now." },
    unavailable: { label: "SIGNAL UNAVAILABLE", tone: "dim", note: err || "The engine could not produce a signal." },
  }[state]
  const toneText = { green: "text-green", amber: "text-amber", dim: "text-dim" }[HERO.tone]
  const toneBg   = { green: "border-green/30 bg-green/5", amber: "border-amber/30 bg-amber/5", dim: "border-border bg-card" }[HERO.tone]

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
              Crypto Fib<span className="text-accent">.</span>
              <span className={`font-mono text-[10px] px-2 py-0.5 rounded uppercase tracking-widest ${
                testnet ? "bg-amber/15 text-amber" : "bg-red/15 text-red"}`}>
                {testnet ? "testnet" : "mainnet · real money"}
              </span>
            </h1>
            <p className="font-mono text-[11px] text-dim mt-2 max-w-2xl">
              The <span className="text-soft">same swing-Fib strategy</span> as the Nifty bot, on Delta
              perpetuals. Buys the 0.618 retracement of the last 30-bar swing, stop 2 ATRs below,
              target the swing high. Long only, 24/7, <span className="text-soft">2× leverage max</span>.
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

        {/* ── Symbol switch ──────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-6">
          {SYMBOLS.map((s) => (
            <button key={s.key} onClick={() => setSymbol(s.key)}
              className={`font-mono text-sm px-4 py-2 rounded border transition-colors ${
                symbol === s.key
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border bg-card text-dim hover:text-text"}`}>
              {s.label}
            </button>
          ))}
          <span className="font-mono text-[11px] text-muted ml-2">
            {data?.symbol || DASH} · 1 lot = {data?.lotSize ?? DASH} {symbol}
          </span>
        </div>

        {fetchErr && (
          <div className="mb-6 p-4 rounded-lg border border-red/30 bg-red/5">
            <div className="font-mono text-[11px] uppercase tracking-widest mb-1 text-red">✕ Could Not Reach The Server</div>
            <div className="font-body text-sm text-dim">{fetchErr}</div>
          </div>
        )}

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
                  <div className="font-mono text-lg text-text">{bar.time}</div>
                  <div className="font-mono text-[11px] text-muted">{bar.date} bar</div>
                </>
              ) : <div className="font-mono text-lg text-dim">{DASH}</div>}
            </div>
          </div>
        </div>

        {/* ── Levels ─────────────────────────────────────────────────── */}
        <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-3">
          The plan {armed ? "in force" : "if it re-arms"}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <StatCard label="Fib Entry — limit buy" value={fmt(signal?.fibEntry)}
            sub={armed ? "order rests here" : "not armed"} color={armed ? "text-accent" : "text-text"} />
          <StatCard label="Stop" value={fmt(signal?.stopPrice)}
            sub={riskPct != null ? `${riskPct.toFixed(2)}% below entry` : undefined} color="text-red" />
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
          <StatCard label="Risk at 2×" value={riskPct != null ? `${(riskPct * 2).toFixed(1)}%` : DASH}
            sub="of margin, if stopped" color={riskPct != null && riskPct * 2 > 25 ? "text-red" : "text-soft"} />
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">Notes</div>
          <ul className="font-mono text-[11px] text-muted space-y-1.5 leading-relaxed">
            <li>· Same engine as the Nifty Fib bot — <span className="text-soft">app/lib/fib.js</span>, not a second copy.</li>
            <li>· Entry is a resting <span className="text-soft">limit</span>, so it fills at that price or better, or not at all.</li>
            <li>· Leverage is capped at 2× in code. A ~2% stop at 50× is the entire margin — the position
              would liquidate before reaching the stop it was given.</li>
            <li>· Perpetuals charge funding roughly every 8h; a ~30h hold pays it 3–4 times.</li>
            {data?.barsUsed ? <li>· Computed from {data.barsUsed} closed hourly bars.</li> : null}
          </ul>
        </div>

      </main>
    </div>
  )
}
