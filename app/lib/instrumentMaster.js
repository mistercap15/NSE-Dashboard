// ─────────────────────────────────────────────────────────────────────────────
// Upstox instrument-master resolver (server-only, Node runtime).
//
// Instead of relying solely on the hardcoded ISIN_MAP (which drifts as NSE adds
// or renames F&O names), we pull Upstox's published NSE instrument master and
// resolve trading_symbol → instrument_key from it. The hardcoded map stays as a
// fallback for when the master can't be fetched. This makes symbol resolution
// self-healing: new/renamed tickers just work on the next master refresh.
//
// The master is ~2 MB gzipped (~82k rows across every NSE segment). We fetch +
// parse once per instance and cache it in memory with a TTL; concurrent loads
// dedupe.
//
// TWO INDEXES, ONE DOWNLOAD. The same file carries cash equities and the whole
// derivatives chain, so one parse builds both:
//
//   • equities — Map<trading_symbol, instrument_key> over NSE_EQ/EQ. What
//     keyFor() has always served. Unchanged.
//   • futures  — Map<underlying_symbol, contract[]> over NSE_FO/FUT, sorted by
//     expiry. Only 640 of the 35,264 NSE_FO rows are futures (the rest are CE/PE
//     option strikes), so keeping them costs nothing and saves a second fetch.
//
// Futures deliberately do NOT go through keyFor(). An equity key is stable for
// the life of the listing; a futures key belongs to ONE contract and dies at its
// expiry, so callers must ask for a contract and get its expiry back with it.
// ─────────────────────────────────────────────────────────────────────────────
import zlib from "zlib";
import { toInstrumentKey } from "./instruments";

const MASTER_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
const TTL_MS = 12 * 60 * 60 * 1000; // refresh twice a day

let _map = null;       // Map<UPPER trading_symbol, instrument_key>
let _futures = null;   // Map<UPPER underlying_symbol, contract[]> (expiry ascending)
let _loadedAt = 0;
let _loading = null;   // in-flight promise, so concurrent callers share one fetch

/** IST calendar day for an epoch-ms expiry — the date a human calls the expiry. */
const istDayOf = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

/**
 * One futures contract, normalised to camelCase and carrying everything a
 * caller needs to trade and roll it. Every field is read straight off the
 * master row — nothing here is derived or guessed.
 *
 * `expiry` is epoch-ms of the actual expiry instant, which is why no
 * last-Thursday/last-Tuesday date arithmetic appears anywhere in this file. NSE
 * moved monthly F&O expiry from Thursday to Tuesday and the master simply
 * followed; code that computes the date itself silently goes stale.
 */
function toContract(row) {
  return {
    instrumentKey: row.instrument_key,
    tradingSymbol: row.trading_symbol,
    expiry: row.expiry,               // epoch ms
    expiryDate: istDayOf(row.expiry), // YYYY-MM-DD in IST
    lotSize: row.lot_size,
    freezeQty: row.freeze_quantity,
    tickSize: row.tick_size,
    underlying: row.underlying_symbol,
  };
}

async function fetchMaster() {
  const res = await fetch(MASTER_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`instrument master HTTP ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const json = JSON.parse(zlib.gunzipSync(gz).toString("utf8"));

  const equities = new Map();
  const futures = new Map();

  for (const it of json) {
    // NSE cash equities (indices live in NSE_INDEX and are addressed directly).
    if (it.segment === "NSE_EQ" && it.instrument_type === "EQ") {
      const sym = (it.trading_symbol || it.tradingsymbol || "").toUpperCase();
      if (sym && it.instrument_key) equities.set(sym, it.instrument_key);
      continue;
    }
    // Futures only — CE/PE strikes are the overwhelming bulk of NSE_FO and are
    // not something this app trades.
    if (it.segment === "NSE_FO" && it.instrument_type === "FUT") {
      const under = (it.underlying_symbol || it.asset_symbol || "").toUpperCase();
      if (!under || !it.instrument_key || !it.expiry) continue;
      if (!futures.has(under)) futures.set(under, []);
      futures.get(under).push(toContract(it));
    }
  }

  if (equities.size < 1000) throw new Error(`instrument master looks incomplete (${equities.size} rows)`);

  // Sort each chain once, here, so every read is a scan of an ordered list.
  for (const chain of futures.values()) chain.sort((a, b) => a.expiry - b.expiry);

  return { equities, futures };
}

// Ensure the master is loaded and reasonably fresh. Never throws — on failure it
// keeps whatever it had (possibly null → callers fall back to ISIN_MAP).
export async function ensureInstrumentMap() {
  const now = Date.now();
  if (_map && now - _loadedAt < TTL_MS) return _map;
  if (_loading) return _loading;
  _loading = fetchMaster()
    .then(({ equities, futures }) => {
      _map = equities;
      _futures = futures;
      _loadedAt = Date.now();
      return _map;
    })
    .catch((e) => { console.error("[instrumentMaster]", e.message); return _map; })
    .finally(() => { _loading = null; });
  return _loading;
}

// Sync resolver: master first (call ensureInstrumentMap() beforehand), then the
// hardcoded ISIN map as a fallback. Never throws.
export function keyFor(symbol) {
  const s = String(symbol || "").toUpperCase();
  return _map?.get(s) || toInstrumentKey(s);
}

// Whether a symbol resolved via the live master (vs the hardcoded fallback).
export function isFromMaster(symbol) {
  return !!_map?.get(String(symbol || "").toUpperCase());
}

// ── Futures chain ────────────────────────────────────────────────────────────
// All three readers are sync and fail open: call ensureInstrumentMap() first,
// and if the master never loaded they return [] / null rather than throwing.
// There is no ISIN-style fallback here on purpose — a futures instrument key is
// an opaque exchange token (NSE_FO|58072), not something that can be derived
// from the symbol, so a guess would be a wrong key rather than a near miss.

/** Every listed contract for an underlying, expiry ascending. */
export function futuresChain(underlying = "NIFTY") {
  return _futures?.get(String(underlying || "").toUpperCase()) || [];
}

/**
 * The contract to trade right now: the nearest one that has not expired yet.
 *
 * `expiry` is the expiry instant (15:30 IST on the day), so on expiry morning
 * this still returns the expiring contract — correct for a position already
 * open, and the caller's roll rule decides whether to open anything new. Pass
 * `now` to make this testable without touching the clock.
 */
export function currentFuturesContract(underlying = "NIFTY", now = Date.now()) {
  return futuresChain(underlying).find((c) => c.expiry >= now) || null;
}

/** The one after that — what a roll rolls into. Null if only one is listed. */
export function nextFuturesContract(underlying = "NIFTY", now = Date.now()) {
  const chain = futuresChain(underlying);
  const i = chain.findIndex((c) => c.expiry >= now);
  return i === -1 ? null : chain[i + 1] || null;
}

/**
 * Pure form of the two readers above, exported for tests: pick from an explicit
 * chain instead of the module-level cache.
 */
export function pickContracts(chain, now = Date.now()) {
  const sorted = [...(chain || [])].filter((c) => c && c.expiry).sort((a, b) => a.expiry - b.expiry);
  const i = sorted.findIndex((c) => c.expiry >= now);
  return i === -1
    ? { current: null, next: null }
    : { current: sorted[i], next: sorted[i + 1] || null };
}
