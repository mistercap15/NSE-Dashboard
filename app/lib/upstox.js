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

// Long-lived (1 year) read-only token generated from the Upstox developer
// console. Read server-side only — it must never be added to next.config.js's
// `env` block, which inlines values into the client bundle.
//
// When set it becomes the credential for ALL market data, which is what lets
// the dashboard show prices with nobody logged into Upstox. Everything the app
// requests — /historical-candle/* and /market-quote/quotes — is Market Data,
// the category Upstox serves from any IP, so this works from Vercel's dynamic
// addresses. It is read-only and cannot reach account or order endpoints; the
// app calls none, so nothing is lost. See resolveAccessToken() below.
const ANALYTICS_TOKEN = process.env.UPSTOX_ANALYTICS_TOKEN || null

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

// In-memory cache — populated from file on first use. This holds the per-user
// OAuth token; it is only consulted when no analytics token is configured.
let _accessToken  = process.env.UPSTOX_ACCESS_TOKEN || readTokenFromFile()
let _tokenExpired = false

/**
 * The single place any Upstox credential is chosen. Every market-data call
 * funnels through here via upstoxGet.
 *
 * ORDER MATTERS, and the analytics token deliberately wins outright rather than
 * acting as a fallback. Two reasons:
 *
 *   1. Determinism. `_accessToken` is a module global that every route
 *      overwrites with the caller's cookie (setAccessToken), so with two people
 *      using the dashboard, whose credential served a given request depended on
 *      who hit that warm instance last. Market data no longer touches that
 *      variable at all.
 *   2. It is the whole point. If a stale cookie could outrank the env token,
 *      behaviour would differ depending on whether someone happened to have
 *      done an OAuth login that day — which is exactly the daily ritual this
 *      change removes.
 *
 * Falls back to the OAuth token when UPSTOX_ANALYTICS_TOKEN is unset, so an
 * environment without it (local dev, or before the Vercel var is added) behaves
 * exactly as it did before.
 */
export function resolveAccessToken() {
  if (ANALYTICS_TOKEN) return ANALYTICS_TOKEN
  // Recover from file if the in-memory copy was wiped by a hot reload.
  if (!_accessToken) _accessToken = readTokenFromFile()
  return _accessToken || null
}

/** Whether the long-lived market-data token is configured. */
export function hasAnalyticsToken() {
  return !!ANALYTICS_TOKEN
}

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
  const token = resolveAccessToken()
  if (!token) {
    throw new Error(
      "No access token. Set UPSTOX_ANALYTICS_TOKEN, or visit /api/upstox/login first."
    )
  }

  const qs  = Object.keys(params).length ? "?" + new URLSearchParams(params) : ""
  const res = await fetch(`${base}${endpoint}${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        "application/json",
    },
    cache: "no-store",
  })

  if (res.status === 401) {
    // "Expired" is an OAuth concept: those tokens die at 03:30 IST daily and the
    // fix is to log in again. An analytics token lives a year, so a 401 on one
    // means it is wrong or revoked — a configuration problem, not a stale
    // session. Marking it expired here would set a sticky process-global flag
    // that logs every open tab out and blanks prices for the life of the
    // instance, so the OAuth bookkeeping only runs when OAuth is what we used.
    if (!ANALYTICS_TOKEN) {
      _accessToken  = null
      _tokenExpired = true
      clearTokenFile()
      throw new Error("TOKEN_EXPIRED")
    }
    throw new Error("ANALYTICS_TOKEN_REJECTED: Upstox rejected UPSTOX_ANALYTICS_TOKEN (401).")
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

/**
 * Re-key a /market-quote/quotes response back to the instrument keys that were
 * requested. Pure and exported so it can be unit-tested without a token.
 *
 * THE PROBLEM THIS SOLVES. Upstox does not key the response by what you asked
 * for. You request `NSE_EQ|INE848E01016` (exchange|ISIN) and the response comes
 * back keyed `NSE_EQ:NHPC` (exchange:SYMBOL) — a different delimiter AND a
 * different identifier. The old normaliser only reconciled the delimiter, so
 * `nse_eq|ine848e01016` was compared against `nse_eq|nhpc` and never matched.
 * Batch quotes therefore returned {} for every symbol, silently: no error, no
 * 401, just an empty object and price columns full of em dashes.
 *
 * Single-symbol getQuote hid the same bug behind `Object.values(map)[0]` — with
 * exactly one entry, grabbing the only value always "works" regardless of its
 * key. That is why live quotes looked fine while /sizing showed nothing.
 *
 * Matching runs in descending order of authority:
 *   1. exact — the response key IS the requested key (future-proofing; free)
 *   2. instrument_token — Upstox echoes the requested key inside each quote
 *      object. This is the reliable one: exact, unambiguous, and immune to
 *      whatever it chooses to use for the outer key.
 *   3. delimiter/encoding-normalised key — the previous behaviour, kept because
 *      it costs nothing and covers a response that omits instrument_token.
 *
 * Never throws; unmatched keys are simply absent from the result, which is what
 * every caller already treats as "no quote for this symbol".
 */
export function mapQuotesToKeys(raw, requestedKeys) {
  const out = {}
  if (!raw || typeof raw !== "object" || !Array.isArray(requestedKeys)) return out

  const entries = Object.entries(raw)
  if (!entries.length) return out

  // `NSE_EQ:NHPC`, `NSE_EQ%7CINE...` and `NSE_EQ|INE...` all collapse to one form.
  const norm = (k) => String(k).replace(/%7C/gi, "|").replace(/:/g, "|").toLowerCase()

  // instrument_token → quote. Built once rather than scanned per requested key.
  const byToken = new Map()
  for (const [, v] of entries) {
    const tok = v && typeof v === "object" ? v.instrument_token : null
    if (tok) byToken.set(norm(tok), v)
  }

  // Only real quote objects are emitted. A matched-but-null value would make
  // `Object.keys(result).length` — which /api/upstox/quotes returns as `count` —
  // claim a quote that isn't there.
  const usable = (v) => v && typeof v === "object"

  for (const key of requestedKeys) {
    if (usable(raw[key])) { out[key] = raw[key]; continue }

    const k = norm(key)
    const viaToken = byToken.get(k)
    if (usable(viaToken)) { out[key] = viaToken; continue }

    const found = entries.find(([rk]) => norm(rk) === k && usable(raw[rk]))
    if (found) out[key] = found[1]
  }

  return out
}

export async function getQuote(instrumentKey) {
  const data  = await upstoxGet("/market-quote/quotes", { instrument_key: instrumentKey })
  const quoteMap = data?.data || {}
  // Same re-keying as the batch path. The single-value fallback stays as a last
  // resort: with one instrument requested there is only one thing it can be, so
  // it is safe here in a way it would not be for a batch.
  const quote = mapQuotesToKeys(quoteMap, [instrumentKey])[instrumentKey]
    ?? Object.values(quoteMap)[0]
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
  return mapQuotesToKeys(data?.data || {}, instrumentKeys)
}

// Whether a usable market-data credential exists. Several routes gate their
// whole price layer on this, so it has to count the analytics token — otherwise
// they short-circuit to "not connected" while a perfectly good env token sits
// unused.
export function hasValidToken() {
  return !!resolveAccessToken()
}

// Only ever true of the daily OAuth token. An analytics token cannot be
// "expired" in the sense the UI means (re-login required), so reporting it as
// such would send users to a login they no longer need.
export function isTokenExpired() {
  if (ANALYTICS_TOKEN) return false
  return _tokenExpired
}

export function setAccessToken(token) {
  _accessToken  = token
  _tokenExpired = false
  writeTokenToFile(token)
}
