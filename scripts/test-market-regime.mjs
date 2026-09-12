// Unit checks for the Market Mood engine.
// Run: npm run test:market-regime
//
// The interesting cases are the BOUNDARIES. "Within 5% of the high is Healthy"
// is ambiguous in English at exactly 5.000%, and a threshold that lives only in
// a comparison operator is one nobody can check. So the two edges are pinned
// here with candles built to land exactly on them.
//
// Same .mjs copy trick as the other suites: the libs are ESM but package.json
// has no "type": "module", so bare node would parse them as CommonJS.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..", "app", "lib");
const tmp = join(here, ".market-regime.tmp");
mkdirSync(tmp, { recursive: true });
process.on("exit", () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

cpSync(join(lib, "technicals.js"), join(tmp, "technicals.mjs"));
writeFileSync(join(tmp, "m.mjs"),
  readFileSync(join(lib, "marketRegime.js"), "utf8")
    .replace('from "./technicals"', 'from "./technicals.mjs"'));

const { computeMarketRegime, labelFor, HIGH_WINDOW, THRESHOLDS, CAVEAT, HISTORICAL_CONTEXT } =
  await import(join(tmp, "m.mjs"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${detail}`); }
};

/** n flat candles at `price`, then one final close at `last`. */
function series(price, last, n = 300) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, open: price, high: price, low: price, close: price, volume: 0 });
  }
  if (last !== null) {
    out.push({ date: "2026-09-11", open: last, high: last, low: last, close: last, volume: 0 });
  }
  return out;
}

/** A close exactly `pct` below a high of 25000. */
const offBy = (pct) => 25000 * (1 - pct / 100);

console.log("\n── the three labels ──");
ok("well below the high → Correction",
   computeMarketRegime(series(25000, offBy(15))).regime_label === "Correction");
ok("mid-band → Caution",
   computeMarketRegime(series(25000, offBy(7))).regime_label === "Caution");
ok("near the high → Healthy",
   computeMarketRegime(series(25000, offBy(2))).regime_label === "Healthy");
ok("at the high itself → Healthy",
   computeMarketRegime(series(25000, 25000)).regime_label === "Healthy");
ok("ABOVE the prior high → Healthy, 0% off",
   computeMarketRegime(series(25000, 25500)).regime_label === "Healthy" &&
   computeMarketRegime(series(25000, 25500)).pct_off_high === 0,
   JSON.stringify(computeMarketRegime(series(25000, 25500)).pct_off_high));

console.log("\n── the boundaries, which is the point of this file ──");
// "Within 5% of the high" is Healthy, so exactly 5.00% off is NOT within 5%.
ok("4.99% off → Healthy", computeMarketRegime(series(25000, offBy(4.99))).regime_label === "Healthy");
ok("EXACTLY 5.00% off → Caution, not Healthy",
   computeMarketRegime(series(25000, offBy(5))).regime_label === "Caution",
   computeMarketRegime(series(25000, offBy(5))).regime_label);
ok("5.01% off → Caution", computeMarketRegime(series(25000, offBy(5.01))).regime_label === "Caution");
// The "5-10%" band is closed at 10; Correction begins beyond it.
ok("9.99% off → Caution", computeMarketRegime(series(25000, offBy(9.99))).regime_label === "Caution");
ok("EXACTLY 10.00% off → Caution, still in the band",
   computeMarketRegime(series(25000, offBy(10))).regime_label === "Caution",
   computeMarketRegime(series(25000, offBy(10))).regime_label);
ok("10.01% off → Correction",
   computeMarketRegime(series(25000, offBy(10.01))).regime_label === "Correction");

ok("labelFor agrees with the pipeline at 5", labelFor(5) === "Caution");
ok("labelFor agrees with the pipeline at 10", labelFor(10) === "Caution");
ok("labelFor on nonsense → Unknown", labelFor(NaN) === "Unknown" && labelFor(null) === "Unknown");

console.log("\n── the moving averages ──");
{
  // 300 sessions at 100, then a close at 200: above both MAs.
  const up = computeMarketRegime(series(100, 200));
  ok("close above both MAs", up.above_50dma === true && up.above_200dma === true);
  const down = computeMarketRegime(series(100, 50));
  ok("close below both MAs", down.above_50dma === false && down.above_200dma === false);
  ok("  ...and the MA values are reported", down.sma50 !== null && down.sma200 !== null);
}
{
  // Only 80 sessions: a 50-day MA exists, a 200-day one does not.
  const short = computeMarketRegime(series(100, 105, 79));
  ok("50-day MA computed from 80 sessions", short.above_50dma === true);
  ok("200-day MA is NULL, not false, when there is not enough history",
     short.above_200dma === null && short.sma200 === null,
     JSON.stringify({ a: short.above_200dma, s: short.sma200 }));
}

console.log("\n── the trailing-high window ──");
{
  // A very high close 300 sessions back must fall OUT of a 252-session window.
  const old = [
    { date: "2024-01-01", close: 40000 },
    ...series(20000, 20000, 400),
  ];
  const r = computeMarketRegime(old);
  ok("a high older than the window is excluded",
     r.trailing_high === 20000, String(r.trailing_high));
  ok("  ...so the market reads Healthy, not permanently in Correction",
     r.regime_label === "Healthy", r.regime_label);
  ok("  ...and the window size is reported", r.window_sessions === HIGH_WINDOW,
     String(r.window_sessions));
}
{
  const shortHist = computeMarketRegime(series(100, 100, 29));
  ok("a short history reports its REAL window size, not 252",
     shortHist.window_sessions === 30, String(shortHist.window_sessions));
}

console.log("\n── the honest framing travels with the number ──");
{
  const r = computeMarketRegime(series(25000, offBy(15)));
  ok("Correction carries its own historical line",
     r.historical_context === HISTORICAL_CONTEXT.Correction);
  ok("  ...which names the sample's weakness", /58%/.test(r.historical_context));
  ok("the caveat is present on every reading", r.caveat === CAVEAT && /56-month/.test(r.caveat));
  ok("  ...and on an Unknown reading too",
     computeMarketRegime([]).caveat === CAVEAT);
}

console.log("\n── fail-open: bad input must never throw ──");
for (const [name, input] of [
  ["empty array", []],
  ["null", null],
  ["undefined", undefined],
  ["a string", "nifty"],
  ["a number", 42],
  ["array of nulls", [null, null]],
  ["rows with no close", [{ date: "2026-01-01" }, { date: "2026-01-02" }]],
  ["rows with junk closes", [{ close: "abc" }, { close: null }]],
]) {
  let r, threw = false;
  try { r = computeMarketRegime(input); } catch { threw = true; }
  ok(`${name} → Unknown, no throw`,
     !threw && r?.regime_label === "Unknown", threw ? "THREW" : JSON.stringify(r?.regime_label));
}
{
  const r = computeMarketRegime([]);
  ok("Unknown has the SAME keys as a real reading, so the UI need not branch",
     ["nifty_price", "pct_off_high", "above_50dma", "above_200dma", "regime_label",
      "historical_context", "caveat", "asOf"].every((k) => k in r));
  ok("  ...and says why", typeof r.reason === "string" && r.reason.length > 0, r.reason);
}
{
  // One good row among junk: narrow the sample, do not skew the high.
  const r = computeMarketRegime([{ close: "x" }, { date: "2026-09-11", close: 100 }]);
  ok("junk rows are dropped, not coerced to zero",
     r.regime_label === "Healthy" && r.trailing_high === 100, JSON.stringify(r));
}

console.log("\n── it is INFORMATION, not an instruction ──");
{
  const r = computeMarketRegime(series(25000, offBy(15)));
  const text = JSON.stringify(r).toLowerCase();
  for (const word of ["do not", "don't", "avoid", "skip", "block", "must not", "stop trading"]) {
    ok(`no "${word}" anywhere in the payload`, !text.includes(word));
  }
  ok("no sizing or lot field leaks in",
     !("lots" in r) && !("conviction" in r) && !("score" in r));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
