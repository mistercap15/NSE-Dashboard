// Lot-size resolver. No network: every input is a string or an object.
// Run: node scripts/test-lot-sizes.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NSE_LOT_URL,
  BROWSER_HEADERS,
  parseFoMktLots,
  lotsFromMasterContracts,
  resolveLotSizes,
  validateLotSizes,
  overlayLotSizes,
} from "../app/lib/lotSizes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// If any helper reaches the network, fail the run instead of hanging on it.
globalThis.fetch = () => {
  throw new Error("test-lot-sizes must not use the network");
};

ok("NSE url is the public fo_mktlots file",
  NSE_LOT_URL === "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv");
ok("request headers look like a browser, not a bare script",
  /Mozilla\/5\.0/.test(BROWSER_HEADERS["User-Agent"])
  && BROWSER_HEADERS.Referer === "https://www.nseindia.com/");

// ── CSV: first populated month column, not the far-month one ────────────────
const csv = [
  "UNDERLYING                          ,SYMBOL    ,NOV-26     ,DEC-26     ,JAN-27     ",
  "NIFTY 50                            ,NIFTY     ,65         ,65         ,65         ",
  "NIFTY BANK                          ,BANKNIFTY ,30         ,30         ,           ",
  "Derivatives on Individual Securities,Symbol    ,NOV-26     ,DEC-26     ,JAN-27     ",
  "WIPRO LTD                           ,WIPRO     ,           ,3000       ,1500       ",
  "TATA STEEL LTD                      ,TATASTEEL ,2750       ,2750       ,           ",
  "STEEL AUTHORITY OF INDIA            ,SAIL      ,4700       ,           ,           ",
  "NOT A REAL TICKER                   ,NOT A SYM ,1          ,1          ,1          ",
].join("\n");
const parsed = parseFoMktLots(csv);
ok("first populated file column is NOV-26", parsed.column === "NOV-26", parsed.column);
ok("symbol column is used, not the underlying name",
  parsed.lots.NIFTY === 65 && parsed.lots["NIFTY 50"] === undefined);
ok("BANKNIFTY reads the near month", parsed.lots.BANKNIFTY === 30);
ok("a blank near month falls through to the next populated column",
  parsed.lots.WIPRO === 3000, String(parsed.lots.WIPRO));
ok("TATASTEEL and SAIL keep the near-month lot",
  parsed.lots.TATASTEEL === 2750 && parsed.lots.SAIL === 4700);
ok("a padded header row and a non-ticker are ignored",
  parsed.lots.SYMBOL === undefined && parsed.lots["NOT A SYM"] === undefined);

// ── Upstox: nearest future, not a later contract with a different lot ────────
const fromMaster = lotsFromMasterContracts([
  { underlying: "IDEA", expiry: 200, lotSize: 36125 },
  { underlying: "IDEA", expiry: 100, lotSize: 71475 },
  { underlying: "NIFTY", expiry: 100, lotSize: 65 },
  { underlying: "nope", expiry: 100, lotSize: 0 },
]);
ok("nearest expiry wins when the lot changes down the curve",
  fromMaster.IDEA === 71475 && fromMaster.NIFTY === 65 && fromMaster.NOPE === undefined);

// ── Fallback order ───────────────────────────────────────────────────────────
const resolved = resolveLotSizes({
  nse: { WIPRO: 3000, NIFTY: 65 },
  upstox: { WIPRO: 9999, TATASTEEL: 2750, BANKNIFTY: 30 },
  cache: { SAIL: 4700, TATASTEEL: 1 },
  universe: { SAIL: 7000, EXIDEIND: 1800, WIPRO: 1500 },
});
ok("NSE beats Upstox, cache and the snapshot",
  resolved.lots.WIPRO === 3000 && resolved.from.WIPRO === "nse");
ok("Upstox fills a name the CSV did not have",
  resolved.lots.TATASTEEL === 2750 && resolved.from.TATASTEEL === "upstox"
  && resolved.lots.BANKNIFTY === 30 && resolved.from.BANKNIFTY === "upstox");
ok("cache beats the snapshot, and the snapshot is last",
  resolved.lots.SAIL === 4700 && resolved.from.SAIL === "cache"
  && resolved.lots.EXIDEIND === 1800 && resolved.from.EXIDEIND === "universe");

// ── Validation ───────────────────────────────────────────────────────────────
function book(n, flipCount) {
  const prev = {};
  const next = {};
  for (let i = 0; i < n; i++) {
    const sym = `S${String(i).padStart(3, "0")}`;
    prev[sym] = 100;
    next[sym] = i < flipCount ? 200 : 100;
  }
  prev.NIFTY = next.NIFTY = 65;
  prev.BANKNIFTY = next.BANKNIFTY = 30;
  return { prev, next };
}
const half = book(160, 80); // 80 / 162 ≈ 49.4%
const over = book(160, 90); // 90 / 162 ≈ 55.6%
ok("just under half the cache flipping is accepted", validateLotSizes(half.next, half.prev).ok);
ok("more than half the cache flipping is rejected",
  !validateLotSizes(over.next, over.prev).ok
  && validateLotSizes(over.next, over.prev).errors.some((e) => e.includes("flipped")));
const thin = { ...half.next };
delete thin.NIFTY;
ok("missing NIFTY is rejected", !validateLotSizes(thin, null).ok);
const fractional = { ...half.next, WIPRO: 10.5 };
ok("a non-integer lot is rejected", !validateLotSizes(fractional, null).ok);
ok("a first cache with no previous file is not a flip",
  validateLotSizes(half.next, null).ok && validateLotSizes(half.next, {}).flipRate === 0);

// ── Overlay does not rewrite the snapshot ────────────────────────────────────
const base = { WIPRO: 1500, INFY: 400 };
const merged = overlayLotSizes(base, { lots: { WIPRO: 3000, NIFTY: 65, BAD: 1.5, ZERO: 0 } });
ok("overlay replaces WIPRO and adds NIFTY",
  merged.WIPRO === 3000 && merged.NIFTY === 65 && merged.INFY === 400);
ok("overlay leaves the snapshot object alone and skips bad lots",
  base.WIPRO === 1500 && merged.BAD === undefined && merged.ZERO === undefined);

const universePath = join(root, "data", "universe.json");
const universeText = readFileSync(universePath, "utf8");
const snapshotLots = JSON.parse(universeText).lotSize;
ok("snapshot on disk still has the stale lots",
  snapshotLots.WIPRO === 1500 && snapshotLots.TATASTEEL === 5500 && snapshotLots.SAIL === 7000);

const cache = JSON.parse(readFileSync(join(root, "data", "lotSizes.json"), "utf8"));
ok("committed cache corrects WIPRO, TATASTEEL and SAIL",
  cache.lots.WIPRO === 3000 && cache.lots.TATASTEEL === 2750 && cache.lots.SAIL === 4700);
ok("committed cache has the index futures and passes validation",
  cache.lots.NIFTY > 0 && cache.lots.BANKNIFTY > 0 && validateLotSizes(cache.lots, cache.lots).ok
  && Object.keys(cache.lots).length >= 150);

const overlaid = overlayLotSizes(snapshotLots, cache);
ok("loading would serve the cache lot without editing the snapshot text",
  overlaid.WIPRO === 3000 && overlaid.TATASTEEL === 2750 && overlaid.SAIL === 4700
  && snapshotLots.WIPRO === 1500
  && readFileSync(universePath, "utf8") === universeText);

const workflow = readFileSync(join(root, ".github", "workflows", "refresh-lot-sizes.yml"), "utf8");
ok("the refresh workflow runs daily at 13:30 UTC", workflow.includes("30 13 * * *"));
ok("the refresh workflow uses no secrets", !/secrets\./.test(workflow));

const loader = readFileSync(join(root, "app", "lib", "dataset.js"), "utf8");
ok("dataset overlays the cache and does not write the snapshot",
  loader.includes("overlayLotSizes") && !loader.includes("writeFile"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
