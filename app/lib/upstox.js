import fs   from "fs"
import path from "path"

// ── Config ────────────────────────────────────────────────────────
const BASE_URL     = "https://api.upstox.com/v2"
// v3 is a separate base, not a path suffix. Only v3 exposes sub-daily candles.
const BASE_URL_V3  = "https://api.upstox.com/v3"
const AUTH_URL     = "https://api.upstox.com/v2/login/authorization/dialog"
const TOKEN_URL    = "https://api.upstox.com/v2/login/authorization/token"
const API_KEY      = process.env.UPSTOX_API_KEY
const API_SECRET   = process.env.UPSTOX_API_SECRET
const REDIRECT_URI = process.env.UPSTOX_REDIRECT_URI

// Token stored in .upstox_token file so it survives hot reloads
const TOKEN_FILE = path.join(process.cwd(), ".upstox_token")

function readTokenFromFile() {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim() || null
  } catch {
    return null
  }
}

function writeTokenToFile(token) {
  try {
    fs.writeFileSync(TOKEN_FILE, token, "utf8")
  } catch (e) {
    console.error("Could not write token file:", e.message)
  }
}

function clearTokenFile() {
  try { fs.unlinkSync(TOKEN_FILE) } catch {}
}

// In-memory cache — populated from file on first use
let _accessToken  = process.env.UPSTOX_ACCESS_TOKEN || readTokenFromFile()
let _tokenExpired = false

// ── Auth functions ────────────────────────────────────────────────

export function getLoginUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     API_KEY,
    redirect_uri:  REDIRECT_URI,
  })
  // Upstox echoes `state` back to the callback — we use it to return the user
  // to the page they were heading for before the OAuth round-trip.
  if (state) params.set("state", state)
  return `${AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     API_KEY,
      client_secret: API_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    "authorization_code",
    }).toString(),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token exchange failed: ${err}`)
  }
  const data = await res.json()
  _accessToken = data.access_token
  writeTokenToFile(_accessToken)
  return data
}

// ── Core request ──────────────────────────────────────────────────

async function upstoxGet(endpoint, params = {}, base = BASE_URL) {
  // Recover token from file if in-memory copy was wiped by hot reload
  if (!_accessToken) _accessToken = readTokenFromFile()
  if (!_accessToken) throw new Error("No access token. Visit /api/upstox/login first.")

  const qs  = Object.keys(params).length ? "?" + new URLSearchParams(params) : ""
  const res = await fetch(`${base}${endpoint}${qs}`, {
    headers: {
      Authorization: `Bearer ${_accessToken}`,
      Accept:        "application/json",
    },
    cache: "no-store",
  })

  if (res.status === 401) {
    _accessToken  = null
    _tokenExpired = true
    clearTokenFile()
    throw new Error("TOKEN_EXPIRED")
  }

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Upstox API error ${res.status}: ${err.slice(0, 200)}`)
  }

  return res.json()
}

// ── Market data ───────────────────────────────────────────────────

export async function getDailyCandles(instrumentKey, days = 60) {
  const toDate   = new Date()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - days)
  const fmt = (d) => d.toISOString().slice(0, 10)

  const data = await upstoxGet(
    `/historical-candle/${encodeURIComponent(instrumentKey)}/day/${fmt(toDate)}/${fmt(fromDate)}`
  )

  const candles = data?.data?.candles || []
  return candles.map(c => ({
    date:   c[0].slice(0, 10),
    open:   c[1],
    high:   c[2],
    low:    c[3],
    close:  c[4],
    volume: c[5],
  })).reverse()
}

// ── Hourly candles (v3) ───────────────────────────────────────────────────────
// getDailyCandles above is v2, whose path carries a single interval slug and
// supports nothing below /day/. Hourly needs v3, which differs in three ways
// that all matter: a different base URL, a `/:unit/:interval/` path pair, and a
// 7th column (open interest) that v2 never sent.
//
// VERIFIED AGAINST THE LIVE API (Aug 2026, NSE_FO|58072 — Nifty Aug future):
//   • rows are [timestamp, open, high, low, close, volume, open_interest]
//   • timestamp is the bar's OPEN, full ISO with offset: 2026-08-13T09:15:00+05:30
//   • newest-first, exactly like v2 — so we reverse to oldest→newest
//   • BAR ALIGNMENT IS SESSION-RELATIVE, NOT CLOCK-HOUR. A full day is
//     09:15, 10:15, 11:15, 12:15, 13:15, 14:15, 15:15 — seven bars, and the
//     15:15 one is a 15-minute stub closing with the 15:30 session end. Anything
//     that assumes bars open on the hour will mis-time every signal.
//   • the range cap is 3 CALENDAR MONTHS and it is a hard error, not a silent
//     truncation: 2026-05-14→2026-08-14 returns 392 rows, 2026-05-01→2026-08-14
//     returns UDAPI1148 "Invalid date range". Hence the paging below.
//   • hourly history starts January 2022.

/** v3 hourly hard limits — see the block above; both were measured, not assumed. */
const V3_HOURLY_MAX_DAYS = 85;          // under the 3-calendar-month cap, with slack
const V3_HOURLY_EPOCH    = "2022-01-01"; // no sub-daily data before this

/** IST calendar day for a Date. toISOString() would give the UTC day, which
 *  flips a day early every evening after 05:30 UTC. */
const istYmd = (d) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);

/**
 * Map a v3 candle row to the shape every engine in this repo consumes, plus the
 * two fields hourly bars need that daily bars don't.
 *
 * `date` stays YYYY-MM-DD so anything that groups by session still works, and
 * `timestamp` carries the full bar-open time. getDailyCandles does
 * `c[0].slice(0, 10)` and keeps only the date — doing that here would label all
 * seven bars of a day identically and destroy the series.
 */
function mapV3Candle(c) {
  return {
    timestamp:    c[0],
    date:         String(c[0]).slice(0, 10),
    open:         c[1],
    high:         c[2],
    low:          c[3],
    close:        c[4],
    volume:       c[5],
    openInterest: c[6] ?? null,
  };
}

/** Oldest→newest, de-duplicated by bar-open timestamp (pages can overlap). */
function normalizeBars(rows) {
  const byTs = new Map();
  for (const c of rows) {
    if (!Array.isArray(c) || c.length < 5) continue;
    byTs.set(c[0], mapV3Candle(c));
  }
  return [...byTs.values()].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
}

/**
 * Hourly candles for a range, paged around the 3-month cap and stitched.
 *
 * @param {string} instrumentKey  e.g. "NSE_FO|58072"
 * @param {{from?: Date|string, to?: Date|string, days?: number}} opts
 *        `days` is a convenience for "the last N days" when from/to are absent.
 * @returns {Promise<Array>} oldest→newest bars in the shape above. Empty array
 *          when the instrument has no data — never null, never throws for an
 *          empty result (a genuine API/auth failure still throws, and callers
 *          are expected to catch; see app/api/fib/signal/route.js).
 */
export async function getHourlyCandles(instrumentKey, { from, to, days = 60 } = {}) {
  const toDate = to ? new Date(to) : new Date();
  let fromDate = from ? new Date(from) : new Date(toDate.getTime() - days * 86400000);

  // Nothing exists before v3's sub-daily epoch; asking for it just wastes a call.
  const epoch = new Date(`${V3_HOURLY_EPOCH}T00:00:00Z`);
  if (fromDate < epoch) fromDate = epoch;
  if (fromDate > toDate) return [];

  // Walk backwards from `to` in sub-cap windows. Backwards rather than forwards
  // so a partial failure still leaves the RECENT bars — the ones a live signal
  // needs — rather than the oldest ones.
  const rows = [];
  let windowEnd = toDate;
  while (windowEnd >= fromDate) {
    const windowStart = new Date(
      Math.max(fromDate.getTime(), windowEnd.getTime() - V3_HOURLY_MAX_DAYS * 86400000),
    );
    const data = await upstoxGet(
      `/historical-candle/${encodeURIComponent(instrumentKey)}/hours/1/${istYmd(windowEnd)}/${istYmd(windowStart)}`,
      {},
      BASE_URL_V3,
    );
    rows.push(...(data?.data?.candles || []));

    if (windowStart <= fromDate) break;
    windowEnd = new Date(windowStart.getTime() - 86400000); // step past the edge
  }

  return normalizeBars(rows);
}

/**
 * Today's hourly bars, as they form. Historical candles exclude the current
 * session, so a live signal needs this stitched onto the end of them.
 *
 * THE LAST ROW IS THE BAR IN PROGRESS. It updates tick by tick and its close is
 * not final, so anything acting on a *closed* bar must drop it — use
 * lastClosedBar() from app/lib/fib.js rather than reading the tail directly. During a session
 * the 15:15 stub is the only bar shorter than an hour.
 */
export async function getIntradayHourlyCandles(instrumentKey) {
  const data = await upstoxGet(
    `/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/hours/1`,
    {},
    BASE_URL_V3,
  );
  return normalizeBars(data?.data?.candles || []);
}

/**
 * Historical + today, de-duplicated — the series a live signal should run on.
 * Intraday wins on collision because it carries the fresher copy of a bar.
 */
export async function getHourlySeries(instrumentKey, { days = 60 } = {}) {
  const history = await getHourlyCandles(instrumentKey, { days });
  let intraday = [];
  try {
    intraday = await getIntradayHourlyCandles(instrumentKey);
  } catch {
    // Outside market hours this can legitimately return nothing useful. History
    // alone is still a valid series, so this is not fatal.
  }
  const byTs = new Map();
  for (const b of history) byTs.set(b.timestamp, b);
  for (const b of intraday) byTs.set(b.timestamp, b);
  return [...byTs.values()].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
}

export async function getQuote(instrumentKey) {
  const data  = await upstoxGet("/market-quote/quotes", { instrument_key: instrumentKey })
  // Key in response may differ in encoding — fall back to first value if exact match missing
  const quoteMap = data?.data || {}
  const quote = quoteMap[instrumentKey] ?? Object.values(quoteMap)[0]
  if (!quote) throw new Error(`No quote data for ${instrumentKey} — response keys: ${Object.keys(quoteMap).join(", ")}`)
  // Upstox doesn't reliably return a percentage field — derive it from LTP vs prev close.
  const prevClose = quote.ohlc?.close
  const ltp = quote.last_price
  const changePct = (prevClose && ltp)
    ? ((ltp - prevClose) / prevClose) * 100
    : (quote.net_change_percentage ?? 0)
  return {
    symbol:    instrumentKey,
    ltp:       quote.last_price,
    change:    quote.net_change,
    changePct,
    high:      quote.ohlc?.high,
    low:       quote.ohlc?.low,
    open:      quote.ohlc?.open,
    prevClose: quote.ohlc?.close,
    volume:    quote.volume,
    bid:       quote.depth?.buy?.[0]?.price,
    ask:       quote.depth?.sell?.[0]?.price,
  }
}

export async function getBatchQuotes(instrumentKeys) {
  const data = await upstoxGet("/market-quote/quotes", {
    instrument_key: instrumentKeys.join(",")
  })
  const raw = data?.data || {}

  // Upstox response keys may differ from requested keys (colon vs pipe, URL encoding).
  // Build a normalized map so callers can always look up by the key they requested.
  const normalizeKey = (k) => k.replace(/%7C/gi, "|").replace(":", "|").toLowerCase()
  const rawEntries = Object.entries(raw)
  const normalized = {}

  for (const key of instrumentKeys) {
    if (raw[key] !== undefined) {
      normalized[key] = raw[key]
    } else {
      const keyNorm = normalizeKey(key)
      const found = rawEntries.find(([rk]) => normalizeKey(rk) === keyNorm)
      if (found) normalized[key] = found[1]
    }
  }

  return normalized
}

export function hasValidToken() {
  if (!_accessToken) _accessToken = readTokenFromFile()
  return !!_accessToken
}

export function isTokenExpired() {
  return _tokenExpired
}

export function setAccessToken(token) {
  _accessToken  = token
  _tokenExpired = false
  writeTokenToFile(token)
}
