import { NextResponse } from "next/server"
import { getDailyCandles, setAccessToken } from "@/app/lib/upstox"
import { keyFor } from "@/app/lib/instrumentMaster"
import { upstoxTokenFor } from "@/app/lib/auth"
import { computeMarketRegime, CAVEAT } from "@/app/lib/marketRegime"

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/market-regime — where the Nifty sits relative to its own trailing
// high. Display-only context for the seasonal picks; nothing downstream sizes,
// gates or scores off it.
//
// THIS ROUTE NEVER THROWS AND NEVER 500s. It is decoration on a page that has a
// job to do: if Upstox is down, or the token died at 03:30, the rankings must
// still render. Every failure path returns 200 with regime_label "Unknown" and
// an `error` string saying what went wrong, in the same key shape as a good
// reading — so the panel degrades to "—" instead of blanking the page.
// ─────────────────────────────────────────────────────────────────────────────

/** Calendar days to request. The engine needs 252 sessions for the trailing
 *  high and 200 for the slow MA; ~500 calendar days is roughly 345 sessions,
 *  which clears both with room for holidays. */
const LOOKBACK_DAYS = 500

/** Nifty 50 spot. Same key and same fallback as the early-entry sentiment
 *  proxy — the index key occasionally returns an empty candle list, and
 *  RELIANCE's ISIN key is the one proven to work when it does. The fallback is
 *  reported in `source` because "the Nifty" and "a large-cap proxy" are not the
 *  same statement and the UI should not claim the first when it has the second. */
const NIFTY_KEY = "NSE_INDEX|Nifty 50"

function unknown(error) {
  return NextResponse.json({
    nifty_price: null,
    trailing_high: null,
    pct_off_high: null,
    above_50dma: null,
    above_200dma: null,
    sma50: null,
    sma200: null,
    regime_label: "Unknown",
    historical_context: null,
    caveat: CAVEAT,
    window_sessions: 0,
    asOf: null,
    source: null,
    error,
  })
}

export async function GET(request) {
  try {
    // Same gate as every other market-data route: the analytics token is
    // preferred inside upstox.js, this only supplies the per-request OAuth one
    // when that env var is absent.
    const token = await upstoxTokenFor(request)
    if (token) setAccessToken(token)

    let source = "Nifty 50"
    let candles = await getDailyCandles(NIFTY_KEY, LOOKBACK_DAYS)

    if (!candles?.length) {
      try {
        candles = await getDailyCandles(keyFor("RELIANCE"), LOOKBACK_DAYS)
        source = "RELIANCE (Nifty index unavailable)"
      } catch {
        candles = []
      }
    }

    if (!candles?.length) {
      return unknown("No Nifty candles returned — Upstox may be unavailable or the token expired.")
    }

    const regime = computeMarketRegime(candles)

    return NextResponse.json(
      { ...regime, source, error: regime.reason || null },
      // Daily closes change once a day; an hour of edge cache costs nothing and
      // keeps a panel that is pure decoration off the Upstox rate limit.
      { headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" } }
    )
  } catch (e) {
    return unknown(e?.message || "Market regime unavailable.")
  }
}
