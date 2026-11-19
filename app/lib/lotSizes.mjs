// ── F&O lot-size resolver ────────────────────────────────────────────────────
// Pure. Nothing here touches the network, so the unit test and the dataset
// loader can both use it. The daily refresh script is what actually fetches.
//
// Order, per symbol, first hit wins:
//   1. NSE fo_mktlots.csv  (near-month column)
//   2. Upstox NSE instrument master (nearest listed future)
//   3. the committed data/lotSizes.json cache
//   4. the lot already stored on the seasonality snapshot

export const NSE_LOT_URL = "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv";
export const UPSTOX_MASTER_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";

// NSE's archive rejects a bare client. These are the headers a current Chrome
// sends when a person downloads the file from the exchange site.
export const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/csv,text/plain,application/octet-stream,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
  "Referer": "https://www.nseindia.com/",
  "Cache-Control": "no-cache",
};

const MONTH_COL = /^[A-Z]{3}-\d{2}$/;
const TICKER = /^[A-Z0-9][A-Z0-9.&-]{0,24}$/;

export function isPositiveInt(n) {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * Parse fo_mktlots.csv. Each row keeps the first month column that actually
 * has a lot — that is the near contract. Later columns are the far months and
 * are often blank, and for a few names they already show next quarter's lot.
 */
export function parseFoMktLots(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { lots: {}, column: null, columns: [] };

  const header = splitCsvLine(lines[0]);
  const monthIdx = [];
  header.forEach((cell, i) => { if (MONTH_COL.test(cell)) monthIdx.push(i); });

  const lots = {};
  const used = {};
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const sym = String(cells[1] || "").toUpperCase();
    if (!sym || sym === "SYMBOL" || !TICKER.test(sym)) continue;
    for (const i of monthIdx) {
      const raw = cells[i];
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      if (!isPositiveInt(n)) continue;
      lots[sym] = n;
      const name = header[i];
      used[name] = (used[name] || 0) + 1;
      break;
    }
  }

  const columns = monthIdx.map((i) => header[i]);
  const column = columns.find((name) => used[name]) || null;
  return { lots, column, columns };
}

/** Nearest listed future's lot, per underlying. `expiry` is epoch ms. */
export function lotsFromMasterContracts(contracts) {
  const best = new Map();
  for (const c of contracts || []) {
    const sym = String(c?.underlying || c?.underlying_symbol || "").toUpperCase();
    const lot = Number(c?.lotSize ?? c?.lot_size);
    if (!sym || !TICKER.test(sym) || !isPositiveInt(lot)) continue;
    const exp = Number(c?.expiry);
    const when = Number.isFinite(exp) ? exp : Number.POSITIVE_INFINITY;
    const prev = best.get(sym);
    if (!prev || when < prev.when) best.set(sym, { lot, when });
  }
  const lots = {};
  for (const [sym, v] of best) lots[sym] = v.lot;
  return lots;
}

function pick(table, sym) {
  if (!table || typeof table !== "object") return null;
  const raw = table[sym] ?? table[sym?.toUpperCase?.()];
  const n = typeof raw === "number" ? raw : Number(raw);
  return isPositiveInt(n) ? n : null;
}

/**
 * @param {{ nse?: object, upstox?: object, cache?: object, universe?: object }} sources
 * @returns {{ lots: Record<string, number>, from: Record<string, string> }}
 */
export function resolveLotSizes({ nse = {}, upstox = {}, cache = {}, universe = {} } = {}) {
  const symbols = new Set();
  for (const table of [nse, upstox, cache, universe]) {
    if (!table) continue;
    for (const key of Object.keys(table)) symbols.add(String(key).toUpperCase());
  }
  const lots = {};
  const from = {};
  for (const sym of symbols) {
    const steps = [["nse", nse], ["upstox", upstox], ["cache", cache], ["universe", universe]];
    for (const [name, table] of steps) {
      const lot = pick(table, sym);
      if (lot != null) { lots[sym] = lot; from[sym] = name; break; }
    }
  }
  return { lots, from };
}

/**
 * Reject a refresh that is too small, missing the index futures, not integral,
 * or that rewrites more than half the previous cache. Exactly 50% is allowed;
 * a torn download that flips most names is not.
 */
export function validateLotSizes(lots, previous = null) {
  const errors = [];
  const symbols = Object.keys(lots || {});
  if (symbols.length < 150) errors.push(`only ${symbols.length} symbols (need at least 150)`);
  if (!isPositiveInt(lots?.NIFTY)) errors.push("NIFTY missing");
  if (!isPositiveInt(lots?.BANKNIFTY)) errors.push("BANKNIFTY missing");
  for (const sym of symbols) {
    if (!isPositiveInt(lots[sym])) errors.push(`${sym} is not a positive integer lot`);
  }

  const prevMap = previous && typeof previous === "object"
    ? (previous.lots && typeof previous.lots === "object" ? previous.lots : previous)
    : null;
  const prevKeys = [];
  if (prevMap) {
    for (const key of Object.keys(prevMap)) {
      const n = Number(prevMap[key]);
      if (isPositiveInt(n)) prevKeys.push(key);
    }
  }
  let flips = 0;
  for (const key of prevKeys) {
    if (lots?.[key] !== Number(prevMap[key])) flips++;
  }
  const flipRate = prevKeys.length ? flips / prevKeys.length : 0;
  if (prevKeys.length && flipRate > 0.5) {
    errors.push(`${flips} of ${prevKeys.length} lots flipped (${(flipRate * 100).toFixed(1)}% > 50%)`);
  }
  return { ok: errors.length === 0, errors, flips, compared: prevKeys.length, flipRate };
}

/** Cache wins per symbol. Does not mutate `base` or the snapshot it came from. */
export function overlayLotSizes(base = {}, cache) {
  let extra = {};
  if (cache && typeof cache === "object") {
    // The committed file is `{ lots: { SYM: n } }`. A bare map is accepted too.
    // Prefer `.lots` so document fields like `symbols: 224` are not read as a lot.
    extra = cache.lots && typeof cache.lots === "object" ? cache.lots : cache;
  }
  const out = { ...(base || {}) };
  for (const [sym, raw] of Object.entries(extra)) {
    const n = Number(raw);
    if (isPositiveInt(n)) out[String(sym).toUpperCase()] = n;
  }
  return out;
}

export function lotsEqual(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const key of keys) if (Number(a?.[key]) !== Number(b?.[key])) return false;
  return true;
}
