import fs   from "fs"
import path from "path"

// ── Config ────────────────────────────────────────────────────────
const BASE_URL     = "https://api.upstox.com/v2"
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
let _accessToken = process.env.UPSTOX_ACCESS_TOKEN || readTokenFromFile()

// ── Auth functions ────────────────────────────────────────────────

export function getLoginUrl() {
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     API_KEY,
    redirect_uri:  REDIRECT_URI,
  })
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

async function upstoxGet(endpoint, params = {}) {
  // Recover token from file if in-memory copy was wiped by hot reload
  if (!_accessToken) _accessToken = readTokenFromFile()
  if (!_accessToken) throw new Error("No access token. Visit /api/upstox/login first.")

  const qs  = Object.keys(params).length ? "?" + new URLSearchParams(params) : ""
  const res = await fetch(`${BASE_URL}${endpoint}${qs}`, {
    headers: {
      Authorization: `Bearer ${_accessToken}`,
      Accept:        "application/json",
    },
    cache: "no-store",
  })

  if (res.status === 401) {
    _accessToken = null
    clearTokenFile()
    throw new Error("Access token expired. Visit /api/upstox/login to re-authenticate.")
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

export async function getQuote(instrumentKey) {
  const data  = await upstoxGet("/market-quote/quotes", { instrument_key: instrumentKey })
  // Key in response may differ in encoding — fall back to first value if exact match missing
  const quoteMap = data?.data || {}
  const quote = quoteMap[instrumentKey] ?? Object.values(quoteMap)[0]
  if (!quote) throw new Error(`No quote data for ${instrumentKey} — response keys: ${Object.keys(quoteMap).join(", ")}`)
  return {
    symbol:    instrumentKey,
    ltp:       quote.last_price,
    change:    quote.net_change,
    changePct: quote.net_change_percentage,
    high:      quote.ohlc?.high,
    low:       quote.ohlc?.low,
    open:      quote.ohlc?.open,
    prevClose: quote.ohlc?.close,
    volume:    quote.volume,
  }
}

export async function getBatchQuotes(instrumentKeys) {
  const data = await upstoxGet("/market-quote/quotes", {
    instrument_key: instrumentKeys.join(",")
  })
  return data?.data || {}
}

export function hasValidToken() {
  if (!_accessToken) _accessToken = readTokenFromFile()
  return !!_accessToken
}

export function setAccessToken(token) {
  _accessToken = token
  writeTokenToFile(token)
}
