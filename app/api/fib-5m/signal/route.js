import { NextResponse } from "next/server";
import {
  get5mSeries,
  setAccessToken,
  hasValidToken,
  isTokenExpired,
} from "@/app/lib/upstox";
import { ensureInstrumentMap, currentFuturesContract, nextFuturesContract } from "@/app/lib/instrumentMaster";
import { computeFibSignal, closedBars, FIB_CONFIG, BAR_MS } from "@/app/lib/fib";
import { upstoxTokenFor } from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Live Fibonacci signal for the front-month Nifty future, on 5-MINUTE bars.
//
//   GET /api/fib-5m/signal
//   GET /api/fib-5m/signal?underlying=BANKNIFTY
//
// A deliberate near-copy of /api/fib/signal. THE STRATEGY IS IDENTICAL — same
// computeFibSignal, same FIB_CONFIG, same contract resolver, same roll rule,
// same fail-open contract. The ONLY difference is the candle feed: get5mSeries
// instead of getHourlySeries, and the matching bar length handed to closedBars.
//
// Copied rather than parameterised on purpose. The hourly route is the live
// hourly bot's only source of truth; making it generic to serve a second,
// junior bot would put a real-money feed on a shared code path to save a page
// of duplication. Same reasoning as get5mCandles in app/lib/upstox.js.
//
// WHAT "5-MINUTE" CHANGES, AND WHAT IT DOES NOT
//   • closedBars MUST be told the bar length. With the hourly default a 5-min
//     bar would be considered unfinished for a further 55 minutes, so the
//     signal would run on a bar eleven bars stale — silently, with no error.
//   • timeoutBars is 30 bars either way, but 30 five-minute bars is 2.5 hours
//     against 30 hourly bars' four-and-a-bit sessions. That is inherent to
//     running one config on two timeframes and is left as specified.
//   • Everything else — swing window, 0.618, ATR(14), 2.0x stop, 0.5 trend
//     filter, long-only — is untouched, because the point is to reuse validated
//     logic rather than invent a second strategy.
//
// FAILS OPEN, ALWAYS 200, for the same reason as the hourly route: tokens die
// at 03:30 IST daily and that is normal, not exceptional.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much 5-minute history to pull.
 *
 * The engine needs swingLookback + atrPeriod bars. At 75 bars a session that is
 * well under one day, but a swing window measured over half a session would be
 * noise. 15 calendar days ≈ 10 sessions ≈ 750 bars gives the swing something
 * real to sit on and still fits one request inside the 28-day paging window.
 */
const HISTORY_DAYS = 15;

/** Bars the engine needs before it can say anything at all. */
const MIN_BARS = FIB_CONFIG.swingLookback + FIB_CONFIG.atrPeriod + 5;

/** Roll to the next contract this many calendar days before expiry. Same value
 *  as the hourly route — the reasoning there is about the contract dying under
 *  an open trade, which does not depend on the bar length. */
const ROLL_DAYS = 6;

/** A new 5-minute bar closes every five minutes, so the answer goes stale far
 *  faster than the hourly route's. 20s is short enough to stay fresh and long
 *  enough that a 15-second executor poll does not fetch on every single cycle. */
const CACHE_TTL_MS = 20000;
let CACHE = { key: null, at: 0, payload: null };

export async function GET(request) {
  const token = await upstoxTokenFor(request);
  if (token) setAccessToken(token);

  const { searchParams } = new URL(request.url);
  const underlying = (searchParams.get("underlying") || "NIFTY").toUpperCase();

  const base = {
    underlying,
    timeframe: "5m",
    contract: null,
    signal: null,
    barsUsed: 0,
    dataAsOf: null,
    tokenValid: false,
    config: FIB_CONFIG,
    error: null,
  };

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

    const front = currentFuturesContract(underlying);
    const next = nextFuturesContract(underlying);
    const frontDays = front ? (front.expiry - Date.now()) / 86400000 : 0;
    const rolled = Boolean(front && next && frontDays <= ROLL_DAYS);
    const contract = rolled ? next : front;
    if (!contract) {
      return NextResponse.json({
        ...base,
        error: `No live futures contract found for ${underlying} in the instrument master.`,
      });
    }

    const roll = rolled ? null : next;
    const contractOut = {
      rolled,
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

    const series = await get5mSeries(contract.instrumentKey, { days: HISTORY_DAYS });
    // The bar length is NOT optional here — see the header note.
    const closed = closedBars(series, Date.now(), BAR_MS["5m"]);

    if (closed.length < MIN_BARS) {
      return NextResponse.json({
        ...base,
        contract: contractOut,
        barsUsed: closed.length,
        error: `Only ${closed.length} closed 5-minute bars available for ${contract.tradingSymbol}; need ${MIN_BARS}.`,
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
