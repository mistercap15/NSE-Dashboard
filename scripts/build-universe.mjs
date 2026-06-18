// Builds/repairs data/universe.json — a compact snapshot of the full F&O
// universe's monthly return history. The MCP batch endpoint is slow and
// rate-limit-prone (live GOOGLEFINANCE, ~30s per 6 symbols), so we snapshot
// offline and let the app read it instantly. History changes only monthly.
//
//   node scripts/build-universe.mjs          # incremental: fetch only missing symbols
//   node scripts/build-universe.mjs --full   # refetch everything from scratch
//
// The build is idempotent: re-running repairs any symbols that came back empty
// (rate-limited) without re-fetching the ones already captured.

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MCP_URL = process.env.MCP_URL || "https://nse-data-mcp.vercel.app/mcp";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "universe.json");
const FULL = process.argv.includes("--full");
const CONCURRENCY = 3;      // gentle — high concurrency triggers GOOGLEFINANCE rate limits
const RETRIES = 4;
const REPAIR_ROUNDS = 5;

async function callMCP(name, args, attempt = 1) {
  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result?._raw ?? data.result;
  } catch (e) {
    if (attempt <= RETRIES) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
      return callMCP(name, args, attempt + 1);
    }
    throw e;
  }
}

const chunk = (a, s) => { const o = []; for (let i = 0; i < a.length; i += s) o.push(a.slice(i, i + s)); return o; };

async function pool(items, limit, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
  }));
}

function usableMonths(map) { return map ? Object.keys(map).length : 0; }

async function main() {
  // Seed from existing snapshot unless --full
  let series = {}, lotSize = {}, sectors = {};
  if (!FULL) {
    try {
      const prev = JSON.parse(await readFile(OUT, "utf8"));
      series = prev.series || {}; lotSize = prev.lotSize || {}; sectors = prev.sectors || {};
      console.log(`Loaded existing snapshot (${Object.keys(series).filter(s => usableMonths(series[s]) > 0).length} symbols with data)`);
    } catch { /* no prior snapshot */ }
  }

  console.log("Fetching universe symbol list…");
  const all = await callMCP("get_all_rankings", { top: 50 });
  for (const m of Object.values(all.all_months || {})) for (const s of m) if (!sectors[s.symbol]) sectors[s.symbol] = s.sector;
  const allSymbols = Object.keys(sectors);

  // Fetch one batch and merge any symbols that come back with usable data.
  async function fetchBatch(group) {
    const r = await callMCP("get_batch_data", { symbols: group }).catch(e => ({ _err: e.message }));
    for (const [sym, d] of Object.entries(r?.results || {})) {
      const map = {};
      for (const p of d.prices || []) {
        if (p.return_pct === null || p.return_pct === undefined) continue;
        map[p.date] = Math.round(p.return_pct * 100) / 100;
      }
      if (Object.keys(map).length) { series[sym] = map; if (d.lot_size) lotSize[sym] = d.lot_size; }
    }
  }

  let needed = allSymbols.filter(s => usableMonths(series[s]) === 0);
  console.log(`${allSymbols.length} symbols total · ${needed.length} need fetching @ ${CONCURRENCY} concurrent`);

  for (let round = 1; round <= REPAIR_ROUNDS && needed.length; round++) {
    const batches = chunk(needed, 6);
    let done = 0;
    await pool(batches, CONCURRENCY, async (group) => {
      await fetchBatch(group);
      done++;
      process.stdout.write(`\r  round ${round}: batch ${done}/${batches.length}        `);
    });
    const before = needed.length;
    needed = allSymbols.filter(s => usableMonths(series[s]) === 0);
    console.log(`\n  round ${round}: recovered ${before - needed.length}, still missing ${needed.length}`);
    if (needed.length === before) break; // no progress — give up
  }

  let minYear = Infinity, maxYear = -Infinity;
  for (const map of Object.values(series)) for (const ym of Object.keys(map)) {
    const y = Number(ym.split("-")[0]); if (y < minYear) minYear = y; if (y > maxYear) maxYear = y;
  }

  const symbols = allSymbols.filter(s => usableMonths(series[s]) > 0);
  // keep only sectors/series for symbols we actually have
  const cleanSeries = {}, cleanSectors = {};
  for (const s of symbols) { cleanSeries[s] = series[s]; cleanSectors[s] = sectors[s]; }

  const snapshot = { generatedAt: new Date().toISOString(), minYear, maxYear, symbols, sectors: cleanSectors, lotSize, series: cleanSeries };
  await writeFile(OUT, JSON.stringify(snapshot));
  const kb = (JSON.stringify(snapshot).length / 1024).toFixed(0);
  console.log(`\n✓ Wrote ${OUT} — ${symbols.length}/${allSymbols.length} symbols, ${minYear}–${maxYear}, ${kb}KB`);
  if (needed.length) console.log(`  ⚠ ${needed.length} still empty: ${needed.join(", ")}`);
}

main().catch(e => { console.error("\nFAILED:", e); process.exit(1); });
