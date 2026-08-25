// ─────────────────────────────────────────────────────────────────────────────
// Delta Exchange candle source — the ONLY thing the crypto bot adds to the
// data layer. The strategy itself is not touched: computeFibSignal in fib.js is
// reused unchanged, because it is the version already validated and running live
// on Nifty. A second copy of the maths would be a second thing to get wrong.
//
// Verified against the live API (Aug 2026):
//   GET /v2/history/candles?resolution=1h&symbol=BTCUSD&start=<sec>&end=<sec>
//   → { result: [ { time, open, high, low, close, volume }, … ] }
//
// Two shapes differ from Upstox and both matter:
//   • `time` is epoch SECONDS, not milliseconds, and not an ISO string.
//   • Newest FIRST, so it is reversed to the oldest→newest order every engine
//     in this repo expects.
//
// TESTNET vs mainnet is a base-URL swap. The default is testnet on purpose —
// this bot has no business reaching a real-money endpoint, and a missing env var
// should fail safe rather than fail rich.
// ─────────────────────────────────────────────────────────────────────────────

const TESTNET_BASE = "https://cdn-ind.testnet.deltaex.org";
const MAINNET_BASE = "https://api.india.delta.exchange";

/** Perpetuals this bot understands. Delta names them without a separator. */
export const CRYPTO_SYMBOLS = { BTC: "BTCUSD", ETH: "ETHUSD" };

/**
 * Contract sizes, needed to turn "lots" into a quantity of coin. Delta quotes
 * perpetuals in lots, not in BTC — 1 BTCUSD lot is 0.001 BTC.
 */
export const LOT_SIZE = { BTCUSD: 0.001, ETHUSD: 0.01 };

export function deltaBase() {
  // Anything other than an explicit "mainnet" means testnet.
  return process.env.DELTA_NETWORK === "mainnet" ? MAINNET_BASE : TESTNET_BASE;
}

/** Normalise "btc", "BTC.P", "BTCUSD" → "BTCUSD". Unknown input returns null so
 *  callers refuse rather than guess at a product that may not exist. */
export function resolveSymbol(input) {
  const s = String(input || "BTC").toUpperCase().replace(/[.\-_]P$/, "");
  if (Object.values(CRYPTO_SYMBOLS).includes(s)) return s;
  return CRYPTO_SYMBOLS[s] || null;
}

/**
 * Hourly candles, oldest→newest, in the shape every engine here consumes.
 *
 * @param {string} symbol e.g. "BTCUSD"
 * @param {{hours?: number}} opts how much history to pull
 */
export async function getDeltaHourlyCandles(symbol, { hours = 400 } = {}) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - hours * 3600;
  const url = `${deltaBase()}/v2/history/candles?resolution=1h`
    + `&symbol=${encodeURIComponent(symbol)}&start=${start}&end=${end}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Delta candles HTTP ${res.status}`);
  const body = await res.json();
  const rows = body?.result || [];

  return rows
    .map((c) => ({
      // Seconds → the ISO string the rest of the codebase reads, so bar labels
      // and the closed-bar logic behave identically to the Nifty side.
      timestamp: new Date(c.time * 1000).toISOString(),
      date: new Date(c.time * 1000).toISOString().slice(0, 10),
      open: c.open, high: c.high, low: c.low, close: c.close,
      volume: c.volume,
    }))
    .filter((c) => Number.isFinite(c.open) && Number.isFinite(c.close))
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
}

/**
 * Drop the bar still forming.
 *
 * Crypto trades 24/7, so unlike NSE there is no session end and no 15:15 stub:
 * a bar simply closes one hour after it opens. That makes this far simpler than
 * fib.js's closedBars, which has to reason about a market that shuts.
 */
export function closedDeltaBars(candles, now = Date.now()) {
  if (!Array.isArray(candles)) return [];
  const out = [...candles];
  while (out.length) {
    const openMs = new Date(out[out.length - 1].timestamp).getTime();
    if (Number.isFinite(openMs) && openMs + 3600000 <= now) break;
    out.pop();
  }
  return out;
}
