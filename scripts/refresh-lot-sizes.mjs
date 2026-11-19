// Refresh data/lotSizes.json from NSE's public fo_mktlots.csv, then the public
// Upstox instrument master, then the cache already on disk, then the lots
// stored on the seasonality snapshot.
//
//   node scripts/refresh-lot-sizes.mjs
//
// No credentials. A result that fails validateLotSizes is not written, so a
// blocked download or a torn file cannot replace a good cache.
import { readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NSE_LOT_URL,
  UPSTOX_MASTER_URL,
  BROWSER_HEADERS,
  parseFoMktLots,
  lotsFromMasterContracts,
  resolveLotSizes,
  validateLotSizes,
  lotsEqual,
} from "../app/lib/lotSizes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_PATH = join(ROOT, "data", "lotSizes.json");
const UNIVERSE_PATH = join(ROOT, "data", "universe.json");

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return null; }
}

async function fetchNseCsv() {
  const headers = { ...BROWSER_HEADERS };
  let cookie = "";
  try {
    const home = await fetch("https://www.nseindia.com/", { headers, redirect: "follow" });
    const baked = typeof home.headers.getSetCookie === "function" ? home.headers.getSetCookie() : [];
    cookie = baked.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  } catch {
    // The homepage is only a cookie warmup. The file URL is tried either way.
  }
  const res = await fetch(NSE_LOT_URL, {
    headers: {
      ...headers,
      Accept: "text/csv,text/plain,*/*",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`NSE fo_mktlots HTTP ${res.status}`);
  const text = await res.text();
  if (!/SYMBOL/i.test(text) || !/NIFTY/.test(text)) {
    throw new Error("NSE response was not the lot-size file");
  }
  return text;
}

async function fetchUpstoxLots() {
  const res = await fetch(UPSTOX_MASTER_URL, {
    headers: { "User-Agent": BROWSER_HEADERS["User-Agent"], Accept: "*/*" },
  });
  if (!res.ok) throw new Error(`Upstox master HTTP ${res.status}`);
  const rows = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
  const contracts = [];
  for (const it of rows) {
    if (it?.segment === "NSE_FO" && it?.instrument_type === "FUT") {
      contracts.push({
        underlying: it.underlying_symbol,
        expiry: it.expiry,
        lotSize: it.lot_size,
      });
    }
  }
  return lotsFromMasterContracts(contracts);
}

async function main() {
  const previous = await readJson(CACHE_PATH);
  const universe = await readJson(UNIVERSE_PATH);
  const prevLots = previous?.lots || {};
  const universeLots = universe?.lotSize || {};

  let nse = {};
  let column = previous?.column || null;
  try {
    const parsed = parseFoMktLots(await fetchNseCsv());
    nse = parsed.lots;
    column = parsed.column || column;
    console.log(`NSE ${column || "?"}: ${Object.keys(nse).length} symbols`);
  } catch (e) {
    console.error("NSE lot file unavailable:", e.message);
  }

  let upstox = {};
  try {
    upstox = await fetchUpstoxLots();
    console.log(`Upstox futures: ${Object.keys(upstox).length} underlyings`);
  } catch (e) {
    console.error("Upstox master unavailable:", e.message);
  }

  const { lots, from } = resolveLotSizes({
    nse, upstox, cache: prevLots, universe: universeLots,
  });
  const counts = { nse: 0, upstox: 0, cache: 0, universe: 0 };
  for (const src of Object.values(from)) counts[src] = (counts[src] || 0) + 1;

  const verdict = validateLotSizes(lots, Object.keys(prevLots).length ? prevLots : null);
  if (!verdict.ok) {
    console.error("Refusing to write data/lotSizes.json:");
    for (const err of verdict.errors) console.error("  - " + err);
    process.exit(1);
  }

  if (Object.keys(prevLots).length && lotsEqual(prevLots, lots)) {
    console.log(`Lots unchanged (${Object.keys(lots).length} symbols).`);
    return;
  }

  const doc = {
    generatedAt: new Date().toISOString(),
    source: Object.keys(nse).length ? "nse-fo-mktlots" : "upstox-nse-fo",
    column,
    url: NSE_LOT_URL,
    counts,
    symbols: Object.keys(lots).length,
    lots: Object.fromEntries(Object.entries(lots).sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeFile(CACHE_PATH, JSON.stringify(doc, null, 2) + "\n");
  console.log(
    `Wrote data/lotSizes.json (${doc.symbols} symbols, ${verdict.flips} changed vs the previous cache).`,
  );
  console.log("counts", counts);
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isDirectRun()) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
