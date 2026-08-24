import { NextResponse } from "next/server";
import {
  getHourlySeries,
  setAccessToken,
  hasValidToken,
  isTokenExpired,
} from "@/app/lib/upstox";
import { ensureInstrumentMap, currentFuturesContract, nextFuturesContract } from "@/app/lib/instrumentMaster";
import { computeInsideBarSignal, IB_CONFIG } from "@/app/lib/insideBar";
import { closedBars } from "@/app/lib/fib";
import { upstoxTokenFor } from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Live inside-bar breakout signal for the front-month Nifty future.
//
//   GET /api/inside-bar/signal
//   GET /api/inside-bar/signal?underlying=BANKNIFTY
//
// A deliberate near-clone of /api/fib/signal: same contract resolution, same
// bar handling, same fail-open shape. Two strategies that answer in different
// shapes would mean two of everything downstream, so they answer in the same one.
//
// closedBars() is imported from fib.js rather than duplicated. Stripping the
// forming bar is a property of Upstox's feed, not of either strategy, and the
// 15:15 stub rule is exactly the sort of thing that would rot if it existed
// twice. This is a read-only import — nothing here changes the Fibonacci engine,
// which is running live.
//
// Analytics only. No orders, no position state; the executor that consumes this
// is a separate process on the droplet.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enough hourly history for a setup plus its breakout, with room to spare. The
 * engine looks back setupLookback bars for an inside bar and then forward for
 * the break; at seven bars a session, 40 calendar days is many times that while
 * staying inside v3's 3-month cap in one request.
 */
const HISTORY_DAYS = 40;

/** Below this there isn't enough to find a mother/inside pair and judge it. */
const MIN_BARS = IB_CONFIG.setupLookback + 5;

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
    config: IB_CONFIG,
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
    // The forming bar is excluded: an inside bar that has not finished forming
    // is not an inside bar, and a breakout read from a partial bar can un-happen.
    const closed = closedBars(series);

    if (closed.length < MIN_BARS) {
      return NextResponse.json({
        ...base,
        contract: contractOut,
        barsUsed: closed.length,
        error: `Only ${closed.length} closed hourly bars available for ${contract.tradingSymbol}; need ${MIN_BARS}.`,
      });
    }

    const signal = computeInsideBarSignal(closed);

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
