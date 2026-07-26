// ─────────────────────────────────────────────────────────────────────────────
// One-off exporter: historical daily OHLC for the whole F&O universe → a single
// JSON file under data/exports/, for offline backtesting.
//
//   node scripts/export-backtest-data.mjs
//   UPSTOX_ACCESS_TOKEN=<token> node scripts/export-backtest-data.mjs
//
// Auth: reuses the existing Upstox token — the UPSTOX_ACCESS_TOKEN env var or the
// local .upstox_token file that the app writes on OAuth (app/lib/upstox.js).
//
// This is a standalone script and — like scripts/build-universe.mjs — it does NOT
// import app/lib/*.js. Those are ESM modules transpiled by Next; a plain Node run
// treats the repo's .js as CommonJS and can't import their named exports. So the
// resolution + fetch logic below faithfully mirrors app/lib/instrumentMaster.js,
// app/lib/instruments.js and app/lib/upstox.js.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFile, mkdir, copyFile, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import zlib from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UNIVERSE_PATH = join(ROOT, "data", "universe.json");
const INSTRUMENTS_JS = join(ROOT, "app", "lib", "instruments.js");
const EXPORT_DIR = join(ROOT, "data", "exports");

const MASTER_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
const BASE_URL = "https://api.upstox.com/v2";

const CONCURRENCY = 8;          // matches the swing-low scan's batching
const START_DATE = "2000-01-01"; // pull the max history Upstox has for each name
const RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => new Date().toISOString().slice(0, 10);
const yyyymmdd = () => todayISO().replace(/-/g, "");

// ── Token (reuse existing auth) ──────────────────────────────────────────────
const TOKEN =
  process.env.UPSTOX_ACCESS_TOKEN ||
  (existsSync(join(ROOT, ".upstox_token")) ? readFileSync(join(ROOT, ".upstox_token"), "utf8").trim() : "");

if (!TOKEN) {
  console.error(`
✗ No Upstox access token found — cannot fetch candles.

  Provide it one of two ways, then re-run:
    1) Log in to the app locally (npm run dev → connect Upstox) to write .upstox_token, OR
    2) Pass the token inline:
         UPSTOX_ACCESS_TOKEN=<your_token> node scripts/export-backtest-data.mjs

  (The token is the value of the 'upstox_token' cookie on the running app.)
`);
  process.exit(1);
}

// ── Upstox GET with retry ────────────────────────────────────────────────────
async function upstoxGet(endpoint, attempt = 1) {
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    });
    if (res.status === 401) throw new Error("TOKEN_EXPIRED");
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    return res.json();
  } catch (e) {
    if (e.message === "TOKEN_EXPIRED") throw e;
    if (attempt <= RETRIES) { await sleep(700 * attempt); return upstoxGet(endpoint, attempt + 1); }
    throw e;
  }
}

// Fetch one date range of daily candles → ascending [{date,open,high,low,close,volume}]
async function getDailyRange(key, from, to) {
  const data = await upstoxGet(`/historical-candle/${encodeURIComponent(key)}/day/${to}/${from}`);
  const candles = data?.data?.candles || [];
  // Upstox returns newest-first; reverse to ascending (same as app/lib/upstox.js).
  return candles
    .map((c) => ({ date: c[0].slice(0, 10), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }))
    .reverse();
}

// Max available history. The v2 day interval accepts multi-year ranges (the app
// already pulls ~3yr in one call), so we try the whole window in one request and
// only fall back to year-by-year chunking if that single wide request errors.
async function getMaxHistory(key) {
  try {
    return await getDailyRange(key, START_DATE, todayISO());
  } catch (e) {
    if (e.message === "TOKEN_EXPIRED") throw e;
    const out = [];
    const endY = new Date().getFullYear();
    for (let y = 2000; y <= endY; y++) {
      const from = `${y}-01-01`;
      const to = y === endY ? todayISO() : `${y}-12-31`;
      try { out.push(...(await getDailyRange(key, from, to))); } catch { /* skip year */ }
    }
    const byDate = new Map();
    for (const c of out) byDate.set(c.date, c);
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}

// ── Instrument-key resolution (mirrors instrumentMaster.keyFor + instruments) ─
async function buildMasterMap() {
  const res = await fetch(MASTER_URL);
  if (!res.ok) throw new Error(`instrument master HTTP ${res.status}`);
  const json = JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
  const map = new Map();
  for (const it of json) {
    if (it.segment !== "NSE_EQ" || it.instrument_type !== "EQ") continue;
    const s = (it.trading_symbol || it.tradingsymbol || "").toUpperCase();
    if (s && it.instrument_key) map.set(s, it.instrument_key);
  }
  return map;
}

// Parse ISIN_MAP out of app/lib/instruments.js for the fallback path.
function parseIsinMap(src) {
  const map = {};
  const block = src.match(/ISIN_MAP\s*=\s*{([\s\S]*?)\n}/);
  if (block) {
    for (const m of block[1].matchAll(/["']?([A-Z0-9&\-]+)["']?\s*:\s*"([A-Z0-9]+)"/g)) map[m[1]] = m[2];
  }
  return map;
}

const keyFor = (sym, master, isin) => {
  const s = String(sym).toUpperCase();
  return master.get(s) || (isin[s] ? `NSE_EQ|${isin[s]}` : `NSE_EQ|${s}`);
};

// ── Bounded-concurrency pool (same pattern as app/api/swing-low/route.js) ─────
async function pool(items, limit, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
    })
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const universe = JSON.parse(await readFile(UNIVERSE_PATH, "utf8"));
  const symbols = universe.symbols || [];
  const total = symbols.length;
  console.log(`→ Universe: ${total} symbols. Fetching daily candles from ${START_DATE} …\n`);

  console.log("→ Loading Upstox instrument master …");
  const master = await buildMasterMap();
  const isin = parseIsinMap(await readFile(INSTRUMENTS_JS, "utf8"));
  console.log(`  master rows: ${master.size}, ISIN fallback entries: ${Object.keys(isin).length}\n`);

  const candles = {};
  let done = 0, ok = 0, failed = 0;
  const failures = [];

  await pool(symbols, CONCURRENCY, async (sym) => {
    const n = ++done;
    const key = keyFor(sym, master, isin);
    try {
      const rows = await getMaxHistory(key);
      if (!rows.length) throw new Error("no candles returned");
      candles[sym] = rows;
      ok++;
      console.log(`  [${n}/${total}] ${sym} → ${rows.length} candles (${key})`);
    } catch (e) {
      failed++;
      failures.push({ sym, key, error: e.message });
      console.log(`  [${n}/${total}] ${sym} ✗ SKIP (${e.message})`);
      if (e.message === "TOKEN_EXPIRED") {
        console.error("\n✗ Upstox token expired mid-run — re-connect and retry.\n");
        process.exit(1);
      }
    }
  });

  await mkdir(EXPORT_DIR, { recursive: true });
  const outName = `daily_candles_export_${yyyymmdd()}.json`;
  const outPath = join(EXPORT_DIR, outName);
  const payload = {
    generatedAt: new Date().toISOString(),
    days: Math.round((Date.now() - new Date(START_DATE).getTime()) / 86400000),
    candles,
  };
  await writeFile(outPath, JSON.stringify(payload));
  await copyFile(UNIVERSE_PATH, join(EXPORT_DIR, "universe.json"));

  console.log(`\n✓ Done. ${ok} ok, ${failed} skipped of ${total}.`);
  if (failures.length) console.log(`  skipped: ${failures.map((f) => f.sym).join(", ")}`);
  console.log(`\n  Wrote: data/exports/${outName}`);
  console.log(`  Wrote: data/exports/universe.json (copy)`);
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
