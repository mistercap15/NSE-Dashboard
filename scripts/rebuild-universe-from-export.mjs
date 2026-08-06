// ─────────────────────────────────────────────────────────────────────────────
// Rebuild data/universe.json's monthly-return history from the real Upstox daily
// export (data/exports/daily_candles_export_*.json).
//
// Why: the previous snapshot was built from the MCP/GOOGLEFINANCE feed, which had
// corrupted monthly returns for many stocks (e.g. UPL Sep showing 82% win rate
// vs a real ~41%). The Upstox export is the broker's actual split-adjusted daily
// data, so month-over-month close returns computed from it are ground truth.
//
//   node scripts/rebuild-universe-from-export.mjs
//
// Keeps sectors / lotSize / symbols from the existing universe.json; only the
// `series` (monthly % returns) is regenerated. A backup of the old file is
// written to data/exports/ (gitignored) before overwriting.
// ─────────────────────────────────────────────────────────────────────────────
import { readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UNIVERSE = join(ROOT, "data", "universe.json");
const EXPORT_DIR = join(ROOT, "data", "exports");

// Start month of the stored series. Matches the analysis page's MCP window
// (start_year 2009) so every seasonality surface reports the same win rates.
// (Pre-2009 closes are still used to compute the Jan-2009 return, just not stored.)
const START_YM = "2009-01";

// Monthly % return series from daily candles: (monthEndClose / prevMonthEndClose − 1)·100.
function monthlySeries(candles) {
  const monthEnd = {};
  for (const b of candles) monthEnd[b.date.slice(0, 7)] = b.close; // ascending → last write = month-end
  const out = {};
  for (const ym of Object.keys(monthEnd).sort()) {
    const [y, m] = ym.split("-").map(Number);
    const pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    if (monthEnd[pm] == null || monthEnd[pm] === 0) continue;
    if (ym < START_YM) continue; // prev-month still used above; just not stored
    out[ym] = Math.round((monthEnd[ym] / monthEnd[pm] - 1) * 100 * 100) / 100;
  }
  return out;
}

async function main() {
  // Newest export file.
  const files = (await readdir(EXPORT_DIR)).filter((f) => /^daily_candles_export_\d+\.json$/.test(f)).sort();
  if (!files.length) { console.error("No export file in data/exports/ — run export-backtest-data.mjs first."); process.exit(1); }
  const exportPath = join(EXPORT_DIR, files.at(-1));
  console.log(`→ Using export: data/exports/${files.at(-1)}`);

  const oldU = JSON.parse(await readFile(UNIVERSE, "utf8"));
  const exp = JSON.parse(await readFile(exportPath, "utf8"));

  const series = {};
  let minYear = Infinity, maxYear = -Infinity, rebuilt = 0, kept = 0;

  for (const sym of oldU.symbols) {
    const candles = exp.candles[sym];
    if (!candles || !candles.length) {
      series[sym] = oldU.series[sym] || {}; // fallback: keep old if not in export
      kept++;
      continue;
    }
    const s = monthlySeries(candles);
    series[sym] = s;
    rebuilt++;
    for (const ym of Object.keys(s)) {
      const y = +ym.slice(0, 4);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
  }

  const newU = {
    generatedAt: new Date().toISOString(),
    source: "upstox-daily-export",
    builtFrom: files.at(-1),
    minYear, maxYear,
    symbols: oldU.symbols,
    sectors: oldU.sectors,
    lotSize: oldU.lotSize,
    series,
  };

  // Backup old file (into gitignored exports dir) then overwrite.
  await copyFile(UNIVERSE, join(EXPORT_DIR, "universe_pre_rebuild.json"));
  await writeFile(UNIVERSE, JSON.stringify(newU));

  console.log(`✓ Rebuilt ${rebuilt} symbols (${kept} kept from old), years ${minYear}–${maxYear}.`);
  console.log(`  Backup: data/exports/universe_pre_rebuild.json`);
  console.log(`  Wrote:  data/universe.json`);
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
