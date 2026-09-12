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

const label = (pct) => computeMarketRegime(series(25000, offBy(pct))).regime_label;

console.log("\n── the four labels ──");
ok("deep drawdown → Extreme Fear", label(15) === "Extreme Fear", label(15));
ok("mid drawdown → Fear", label(7) === "Fear", label(7));
ok("shallow drawdown → Greed", label(3.5) === "Greed", label(3.5));
ok("at the high → Extreme Greed", label(0.4) === "Extreme Greed", label(0.4));
ok("exactly at the high → Extreme Greed",
   computeMarketRegime(series(25000, 25000)).regime_label === "Extreme Greed");
ok("ABOVE the prior high → Extreme Greed, 0% off",
   computeMarketRegime(series(25000, 25500)).regime_label === "Extreme Greed" &&
   computeMarketRegime(series(25000, 25500)).pct_off_high === 0,
   JSON.stringify(computeMarketRegime(series(25000, 25500)).pct_off_high));

console.log("\n── the boundaries, which is the point of this file ──");
// Each band is closed on the FEARFUL side: "within 2% of the high" is Extreme
// Greed, so exactly 2.00% off is not within 2%.
ok("1.99% off → Extreme Greed", label(1.99) === "Extreme Greed", label(1.99));
ok("EXACTLY 2.00% off → Greed, not Extreme Greed", label(2) === "Greed", label(2));
ok("2.01% off → Greed", label(2.01) === "Greed", label(2.01));
ok("4.99% off → Greed", label(4.99) === "Greed", label(4.99));
ok("EXACTLY 5.00% off → Fear, not Greed", label(5) === "Fear", label(5));
ok("5.01% off → Fear", label(5.01) === "Fear", label(5.01));
ok("9.99% off → Fear", label(9.99) === "Fear", label(9.99));
ok("EXACTLY 10.00% off → Fear, still in the band", label(10) === "Fear", label(10));
ok("10.01% off → Extreme Fear", label(10.01) === "Extreme Fear", label(10.01));

ok("labelFor agrees with the pipeline at 2", labelFor(2) === "Greed");
ok("labelFor agrees with the pipeline at 5", labelFor(5) === "Fear");
ok("labelFor agrees with the pipeline at 10", labelFor(10) === "Fear");
ok("labelFor on nonsense → Unknown", labelFor(NaN) === "Unknown" && labelFor(null) === "Unknown");

console.log("\n── the labels are ordered, with no gaps or overlaps ──");
{
  // Sweep the whole range and assert the sequence only ever moves one way:
  // Extreme Greed → Greed → Fear → Extreme Fear. A mis-ordered comparison in
  // labelFor would show up here as a band appearing twice.
  const order = ["Extreme Greed", "Greed", "Fear", "Extreme Fear"];
  const seen = [];
  let bad = null;
  for (let p = -2; p <= 25; p += 0.01) {
    const l = labelFor(p);
    if (l !== seen[seen.length - 1]) seen.push(l);
    if (!order.includes(l)) bad = `${p} → ${l}`;
  }
  ok("every drawdown from -2% to 25% gets one of the four labels", bad === null, bad);
  ok("the bands appear in order and each exactly once",
     JSON.stringify(seen) === JSON.stringify(order), JSON.stringify(seen));
}

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
  ok("  ...so the market reads Extreme Greed, not permanently in Extreme Fear",
     r.regime_label === "Extreme Greed", r.regime_label);
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
  ok("Extreme Fear carries its own historical line",
     r.historical_context === HISTORICAL_CONTEXT["Extreme Fear"]);
  ok("  ...which names the sample's weakness", /58%/.test(r.historical_context));
  ok("the caveat is present on every reading", r.caveat === CAVEAT && /56-month/.test(r.caveat));
  ok("  ...and on an Unknown reading too",
     computeMarketRegime([]).caveat === CAVEAT);
  for (const l of ["Extreme Greed", "Greed", "Fear", "Extreme Fear"]) {
    ok(`  every label has a historical line: ${l}`,
       typeof HISTORICAL_CONTEXT[l] === "string" && HISTORICAL_CONTEXT[l].length > 0);
  }
  // THE POINT OF THE WHOLE FEATURE. A fear/greed dial invites "buy the fear",
  // and this sample says the opposite for seasonal longs. If someone ever
  // flips these figures to match the intuition, this fails.
  ok("Extreme Fear's figure is the WEAKEST, not the strongest",
     /\+0\.8%/.test(HISTORICAL_CONTEXT["Extreme Fear"]), HISTORICAL_CONTEXT["Extreme Fear"]);
  ok("Extreme Greed's figure is the strongest",
     /\+3\.0%/.test(HISTORICAL_CONTEXT["Extreme Greed"]), HISTORICAL_CONTEXT["Extreme Greed"]);
  ok("Extreme Greed and Greed share one measured bucket, and both say '5%' so a\n       reader can see it was never measured finer",
     HISTORICAL_CONTEXT["Extreme Greed"] === HISTORICAL_CONTEXT.Greed &&
     /Under 5% off the high/.test(HISTORICAL_CONTEXT.Greed));
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
     r.regime_label === "Extreme Greed" && r.trailing_high === 100, JSON.stringify(r));
}

console.log("\n── it is INFORMATION, not an instruction ──");
{
  const r = computeMarketRegime(series(25000, offBy(15)));
  const text = JSON.stringify(r).toLowerCase();
  for (const word of ["do not", "don't", "avoid", "skip", "block", "must not", "stop trading",
                      "buy now", "good time", "time to buy", "sell"]) {
    ok(`no "${word}" anywhere in the payload`, !text.includes(word));
  }
  ok("no sizing or lot field leaks in",
     !("lots" in r) && !("conviction" in r) && !("score" in r));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
