import { NextResponse } from "next/server";
import {
  getHourlySeries,
  setAccessToken,
  hasValidToken,
  isTokenExpired,
} from "@/app/lib/upstox";
import { ensureInstrumentMap, currentFuturesContract, nextFuturesContract } from "@/app/lib/instrumentMaster";
import { computeFibSignal, closedBars, FIB_CONFIG } from "@/app/lib/fib";
import { upstoxTokenFor } from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Live Fibonacci signal for the front-month Nifty future.
//
//   GET /api/fib/signal
//   GET /api/fib/signal?underlying=BANKNIFTY
//
// Analytics only — this route reads prices and returns levels. It places no
// orders and holds no position state; the executor that will consume it is a
// later build and lives elsewhere (order placement needs a static IP, which
// Vercel does not have).
//
// The strategy itself is entirely in app/lib/fib.js. This file does three
// things and nothing more: resolve which contract is front-month, fetch enough
// hourly bars, and hand them to the engine. Both clients — web and the Expo app
// — call this rather than recomputing anything, so they cannot disagree about
// what the signal says.
//
// FAILS OPEN, ALWAYS 200. A missing or expired Upstox token is the normal
// overnight state of this app, not an exception: tokens die at 03:30 IST every
// day. Returning 500 would make every client render an error page each morning,
// so instead the payload carries `signal: null` plus a reason and `tokenValid`,
// and the clients show "connect Upstox" rather than "something went wrong".
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much hourly history to pull. The engine needs swingLookback bars for the
 * swing window plus atrPeriod to warm ATR up; at seven bars per session that is
 * about nine trading days, so 40 calendar days is a comfortable multiple while
 * staying inside v3's 3-month cap in a single request.
 */
const HISTORY_DAYS = 40;

/** Bars the engine needs before it can say anything at all. */
const MIN_BARS = FIB_CONFIG.swingLookback + FIB_CONFIG.atrPeriod + 5;

/**
 * Short TTL cache. The answer only changes when a new hourly bar closes, but
 * polling clients (and a page with several components on it) shouldn't each
 * trigger a fetch. Per serverless instance and best-effort, like every other
 * cache in this codebase.
 */
const CACHE_TTL_MS = 60000;
let CACHE = { key: null, at: 0, payload: null };

export async function GET(request) {
  const token = await upstoxTokenFor(request);
  if (token) setAccessToken(token);

  const { searchParams } = new URL(request.url);
  const underlying = (searchParams.get("underlying") || "NIFTY").toUpperCase();

  const base = {
    underlying,
    contract: null,
    signal: null,
    barsUsed: 0,
    dataAsOf: null,
    tokenValid: false,
    config: FIB_CONFIG,
    error: null,
  };

  // Ask the Upstox module rather than the request alone: the token may equally
  // come from UPSTOX_ACCESS_TOKEN or a local .upstox_token, which is how the
  // scripts and local dev work.
  if (!hasValidToken() || isTokenExpired()) {
    return NextResponse.json({
      ...base,
      error: "Upstox not connected — connect to see the live signal.",
    });
  }
  base.tokenValid = true;

  const cacheKey = `${underlying}`;
  if (CACHE.key === cacheKey && CACHE.payload && Date.now() - CACHE.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...CACHE.payload, cached: true });
  }

  try {
    await ensureInstrumentMap();

    const contract = currentFuturesContract(underlying);
    if (!contract) {
      return NextResponse.json({
        ...base,
        error: `No live futures contract found for ${underlying} in the instrument master.`,
      });
    }

    const roll = nextFuturesContract(underlying);
    const contractOut = {
      instrumentKey: contract.instrumentKey,
      tradingSymbol: contract.tradingSymbol,
      expiry: contract.expiry,
      expiryDate: contract.expiryDate,
      lotSize: contract.lotSize,
      freezeQty: contract.freezeQty,
      tickSize: contract.tickSize,
      daysToExpiry: Math.max(0, Math.ceil((contract.expiry - Date.now()) / 86400000)),
      rollsInto: roll
        ? { instrumentKey: roll.instrumentKey, tradingSymbol: roll.tradingSymbol, expiryDate: roll.expiryDate }
        : null,
    };

    const series = await getHourlySeries(contract.instrumentKey, { days: HISTORY_DAYS });
    // Drop the bar still forming — the engine's whole contract is closed bars.
    const closed = closedBars(series);

    if (closed.length < MIN_BARS) {
      return NextResponse.json({
        ...base,
        contract: contractOut,
        barsUsed: closed.length,
        error: `Only ${closed.length} closed hourly bars available for ${contract.tradingSymbol}; need ${MIN_BARS}. A newly listed contract has little history — widen HISTORY_DAYS or wait for the session to build bars.`,
      });
    }

    const signal = computeFibSignal(closed);

    const payload = {
      ...base,
      contract: contractOut,
      signal,
      barsUsed: closed.length,
      dataAsOf: signal.asOf,
      cached: false,
    };

    CACHE = { key: cacheKey, at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (e) {
    // Never throw. An expired token surfaces here as TOKEN_EXPIRED from the
    // Upstox transport; anything else is a genuine upstream failure. Either way
    // the client gets a shape it can render.
    const expired = /TOKEN_EXPIRED/.test(e.message || "");
    return NextResponse.json({
      ...base,
      tokenValid: !expired,
      error: expired
        ? "Upstox token expired — reconnect to see the live signal."
        : `Could not build the signal: ${e.message}`,
    });
  }
}
