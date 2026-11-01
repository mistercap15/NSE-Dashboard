import { NextResponse } from "next/server";
import { computeFibSignal, FIB_CONFIG } from "@/app/lib/fib";
import {
  getDeltaHourlyCandles, closedDeltaBars, resolveSymbol, LOT_SIZE, deltaBase,
} from "@/app/lib/deltaCandles";

// ─────────────────────────────────────────────────────────────────────────────
// Swing-Fib signal for a Delta perpetual.
//
//   GET /api/crypto-fib/signal?symbol=BTC
//   GET /api/crypto-fib/signal?symbol=ETH
//
// The strategy is not reimplemented. computeFibSignal from app/lib/fib.js is
// imported and run unchanged — the same function serving the live Nifty bot,
// with the same validated config. Only the candles differ. That is the whole
// point of having kept the engine pure and free of imports.
//
// This is a READ-ONLY import. Nothing here can affect the Nifty signal.
//
// No market-hours gate and no token gate: crypto trades 24/7 and Delta's candle
// endpoint is public, so this route needs no credential of any kind. It cannot
// touch an account even in principle.
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_HOURS = 400;          // ≫ swingLookback + atrPeriod, one request
const MIN_BARS = FIB_CONFIG.swingLookback + FIB_CONFIG.atrPeriod + 5;

const CACHE_TTL_MS = 30000;
const CACHE = new Map();            // symbol → { at, payload }

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("symbol") || "BTC";
  const symbol = resolveSymbol(raw);

  const base = {
    symbol,
    requested: raw,
    network: deltaBase().includes("testnet") ? "testnet" : "mainnet",
    lotSize: symbol ? LOT_SIZE[symbol] : null,
    signal: null,
    barsUsed: 0,
    dataAsOf: null,
    config: FIB_CONFIG,
    error: null,
  };

  if (!symbol) {
    return NextResponse.json({ ...base, error: `Unknown symbol "${raw}" — use BTC or ETH.` });
  }

  const hit = CACHE.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...hit.payload, cached: true });
  }

  try {
    const series = await getDeltaHourlyCandles(symbol, { hours: HISTORY_HOURS });
    const closed = closedDeltaBars(series);

    if (closed.length < MIN_BARS) {
      return NextResponse.json({
        ...base,
        barsUsed: closed.length,
        error: `Only ${closed.length} closed hourly bars for ${symbol}; need ${MIN_BARS}.`,
      });
    }

    const signal = computeFibSignal(closed);
    const payload = {
      ...base,
      signal,
      barsUsed: closed.length,
      dataAsOf: signal.asOf,
      cached: false,
    };
    CACHE.set(symbol, { at: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (e) {
    // Never throws, same as every other signal route here.
    return NextResponse.json({ ...base, error: `Could not build the signal: ${e.message}` });
  }
}
