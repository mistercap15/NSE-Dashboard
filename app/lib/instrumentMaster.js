// ─────────────────────────────────────────────────────────────────────────────
// Upstox instrument-master resolver (server-only, Node runtime).
//
// Instead of relying solely on the hardcoded ISIN_MAP (which drifts as NSE adds
// or renames F&O names), we pull Upstox's published NSE instrument master and
// resolve trading_symbol → instrument_key from it. The hardcoded map stays as a
// fallback for when the master can't be fetched. This makes symbol resolution
// self-healing: new/renamed tickers just work on the next master refresh.
//
// The master is ~2 MB gzipped (~9.4k NSE cash equities). We fetch + parse once
// per instance and cache it in memory with a TTL; concurrent loads dedupe.
// ─────────────────────────────────────────────────────────────────────────────
import zlib from "zlib";
import { toInstrumentKey } from "./instruments";

const MASTER_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
const TTL_MS = 12 * 60 * 60 * 1000; // refresh twice a day

let _map = null;       // Map<UPPER trading_symbol, instrument_key>
let _loadedAt = 0;
let _loading = null;   // in-flight promise, so concurrent callers share one fetch

async function fetchMaster() {
  const res = await fetch(MASTER_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`instrument master HTTP ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const json = JSON.parse(zlib.gunzipSync(gz).toString("utf8"));

  const map = new Map();
  for (const it of json) {
    // NSE cash equities only (F&O live in NSE_FO, indices in NSE_INDEX).
    if (it.segment !== "NSE_EQ" || it.instrument_type !== "EQ") continue;
    const sym = (it.trading_symbol || it.tradingsymbol || "").toUpperCase();
    if (sym && it.instrument_key) map.set(sym, it.instrument_key);
  }
  if (map.size < 1000) throw new Error(`instrument master looks incomplete (${map.size} rows)`);
  return map;
}

// Ensure the master is loaded and reasonably fresh. Never throws — on failure it
// keeps whatever it had (possibly null → callers fall back to ISIN_MAP).
export async function ensureInstrumentMap() {
  const now = Date.now();
  if (_map && now - _loadedAt < TTL_MS) return _map;
  if (_loading) return _loading;
  _loading = fetchMaster()
    .then((m) => { _map = m; _loadedAt = Date.now(); return m; })
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
