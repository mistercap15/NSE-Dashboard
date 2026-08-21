// Unit checks for the Upstox response mapping. Run: npm run test:upstox
//
// Same .mjs copy trick as the other test scripts: the lib is ESM but
// package.json has no "type": "module", so bare node parses it as CommonJS.
//
// Only the pure parts are exercised here — mapQuotesToKeys does no I/O, which is
// exactly why the re-keying logic was extracted from getBatchQuotes in the first
// place. Importing the module is side-effect-free: it reads env and looks for a
// .upstox_token file, both of which fail quietly.
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, ".upstox.tmp.mjs");
cpSync(join(here, "..", "app", "lib", "upstox.js"), tmp);
process.on("exit", () => { try { rmSync(tmp); } catch {} });

const { mapQuotesToKeys } = await import(tmp);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// ── The real shape, copied from Upstox's own documented example ─────────────
// Note what it does: the caller asked for NSE_EQ|INE848E01016 and the response
// is keyed NSE_EQ:NHPC — different delimiter AND different identifier (ISIN vs
// trading symbol). Only `instrument_token` echoes what was requested.
const nhpc = {
  ohlc: { open: 53.4, high: 53.8, low: 51.75, close: 52.05 },
  depth: { buy: [{ price: 52.0 }], sell: [{ price: 52.1 }] },
  timestamp: "2026-08-21T05:21:51.099+05:30",
  instrument_token: "NSE_EQ|INE848E01016",
  symbol: "NHPC",
  last_price: 52.05,
  volume: 24123697,
};
const reliance = {
  ohlc: { open: 1300, high: 1320, low: 1295, close: 1310 },
  instrument_token: "NSE_EQ|INE002A01018",
  symbol: "RELIANCE",
  last_price: 1313.2,
  volume: 5000000,
};

// This is the regression the whole file exists for: batch quotes silently
// returned {} because ISIN-keyed requests were compared against symbol-keyed
// responses. No error, no 401 — just empty price columns.
const live = { "NSE_EQ:NHPC": nhpc, "NSE_EQ:RELIANCE": reliance };
const asked = ["NSE_EQ|INE848E01016", "NSE_EQ|INE002A01018"];
const got = mapQuotesToKeys(live, asked);

ok("symbol-keyed response maps back to the ISIN keys requested",
   Object.keys(got).length === 2, JSON.stringify(Object.keys(got)));
ok("each requested key gets its OWN quote, not just any quote",
   got["NSE_EQ|INE848E01016"].symbol === "NHPC" &&
   got["NSE_EQ|INE002A01018"].symbol === "RELIANCE",
   JSON.stringify(Object.entries(got).map(([k, v]) => [k, v.symbol])));
ok("the mapped quote carries usable price data",
   got["NSE_EQ|INE002A01018"].last_price === 1313.2);

// The pre-fix normaliser only reconciled the delimiter, so it produced this:
const delimiterOnly = (k) => k.replace(/:/g, "|").toLowerCase();
ok("REGRESSION GUARD: delimiter-only matching genuinely fails on this fixture",
   delimiterOnly("NSE_EQ:NHPC") !== delimiterOnly("NSE_EQ|INE848E01016"));

// ── Match precedence ────────────────────────────────────────────────────────
ok("an exactly-keyed response still works",
   mapQuotesToKeys({ "NSE_EQ|INE002A01018": reliance }, ["NSE_EQ|INE002A01018"])["NSE_EQ|INE002A01018"]
     ?.symbol === "RELIANCE");

ok("URL-encoded pipes in the response key are tolerated",
   mapQuotesToKeys({ "NSE_EQ%7CINE002A01018": { last_price: 1 } }, ["NSE_EQ|INE002A01018"])
     ["NSE_EQ|INE002A01018"]?.last_price === 1);

// instrument_token must win over a coincidental key match, since it is the only
// field Upstox guarantees echoes the request.
const swapped = {
  "NSE_EQ:RELIANCE": { instrument_token: "NSE_EQ|INE848E01016", symbol: "NHPC", last_price: 52 },
};
ok("instrument_token outranks the outer key",
   mapQuotesToKeys(swapped, ["NSE_EQ|INE848E01016"])["NSE_EQ|INE848E01016"]?.symbol === "NHPC");

// A response without instrument_token still falls back to key normalisation.
ok("falls back to key matching when instrument_token is absent",
   mapQuotesToKeys({ "NSE_EQ:NHPC": { last_price: 52 } }, ["NSE_EQ|NHPC"])["NSE_EQ|NHPC"]
     ?.last_price === 52);

// ── Partial and futures keys ────────────────────────────────────────────────
ok("a symbol Upstox didn't return is simply absent, not null",
   !("NSE_EQ|MISSING" in mapQuotesToKeys(live, [...asked, "NSE_EQ|MISSING"])));
ok("the symbols it DID return still come through",
   Object.keys(mapQuotesToKeys(live, [...asked, "NSE_EQ|MISSING"])).length === 2);

ok("futures keys map too",
   mapQuotesToKeys(
     { "NSE_FO:NIFTY26AUGFUT": { instrument_token: "NSE_FO|58072", last_price: 24288 } },
     ["NSE_FO|58072"],
   )["NSE_FO|58072"]?.last_price === 24288);

// ── Fails open, never throws ────────────────────────────────────────────────
ok("empty response yields {}", Object.keys(mapQuotesToKeys({}, asked)).length === 0);
ok("null response yields {}", Object.keys(mapQuotesToKeys(null, asked)).length === 0);
ok("null keys yield {}", Object.keys(mapQuotesToKeys(live, null)).length === 0);
ok("no arguments yield {}", Object.keys(mapQuotesToKeys()).length === 0);
ok("a non-object quote value does not throw", (() => {
  try { return Object.keys(mapQuotesToKeys({ "NSE_EQ:X": null }, ["NSE_EQ|X"])).length === 0; }
  catch { return false; }
})());
ok("garbage types do not throw", (() => {
  try { mapQuotesToKeys("nope", ["a"]); mapQuotesToKeys(42, ["a"]); return true; }
  catch { return false; }
})());

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
