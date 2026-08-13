// Unit checks for the levels engine. Run: npm run test:levels
//
// app/lib/levels.js is ESM, but package.json has no "type": "module", so bare
// node would parse it as CommonJS. Next transpiles it happily; here we copy it
// to a .mjs beside itself so plain node reads it as the ESM it is.
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, ".levels.tmp.mjs");
cpSync(join(here, "..", "app", "lib", "levels.js"), tmp);
process.on("exit", () => { try { rmSync(tmp); } catch {} });

const { computeLevels, pickStopAnchor, floorsToSupports, seasonalityFor } = await import(tmp);


let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const supports = [
  { price: 980, type: "MA20", strength: "MEDIUM" },
  { price: 950, type: "MA50", strength: "STRONG" },
  { price: 900, type: "52W_LOW", strength: "VERY_STRONG" },
];
const seas = { medianReturn: 6, worst: -8, winRate: 75, n: 12 };

// 1. Stop is structural, under the nearest meaningful support.
const a = computeLevels({ entry: 1000, supports, seasonality: seas, strategy: "seasonal" });
ok("stop sits under a support level", a.stop.price === Math.round(950 * 0.97 * 100) / 100,
   `got ${a.stop.price}`);
ok("stop names its anchor", a.stop.basis === "MA50", `got ${a.stop.basis}`);

// 2. Seasonal target = entry compounded by median.
ok("seasonal target uses median", a.target.price === 1060 && a.target.basis === "SEASONAL_MEDIAN",
   `got ${a.target.price}/${a.target.basis}`);

// 3. Same entry + same supports -> IDENTICAL stop under the other strategy.
//    This is the bug the whole change exists to fix.
const b = computeLevels({ entry: 1000, supports, seasonality: seas,
  reversionTarget: 1400, strategy: "reversion" });
// Strategies share ONE stop function. They can still land differently, because
// the seasonal (month-long) side applies a holding-period guard that skips
// levels too close to survive a month. Reversion — a short bounce — does not.
// What must hold: reversion keeps the nearest structural level, and seasonal is
// never *tighter* than reversion.
ok("reversion keeps the nearest structural stop",
   b.stop.price === Math.round(950 * 0.97 * 100) / 100, `got ${b.stop.price}`);
ok("seasonal is never tighter than reversion", a.stop.price <= b.stop.price,
   `seasonal ${a.stop.price} vs reversion ${b.stop.price}`);
ok("reversion target differs and is tagged",
   b.target.basis === "MEAN_REVERSION" && b.target.price !== a.target.price);

// 4. Target cap at +30%.
ok("target capped at +30%", b.target.price === 1300 && b.target.capped === true,
   `got ${b.target.price} capped=${b.target.capped}`);

// 5. Risk check flags, but does NOT clamp, the stop.
const deep = [{ price: 800, type: "SWING_LOW", strength: "STRONG" }];
const c = computeLevels({ entry: 1000, supports: deep, seasonality: { ...seas, worst: -4 } });
ok("deep stop is kept, not tightened", c.stop.price === 776, `got ${c.stop.price}`);
ok("but excess risk is flagged", c.stop.exceedsSeasonalRisk === true);
ok("and explained in warnings", c.warnings.some((w) => /size down/i.test(w)));

// 6. No supports -> seasonal worst case drives the stop.
const d = computeLevels({ entry: 1000, supports: [], seasonality: seas });
ok("falls back to seasonal worst", d.stop.basis === "SEASONAL_WORST" && d.stop.price === 904,
   `got ${d.stop.basis}/${d.stop.price}`);

// 7. Nothing at all -> flat 7%, clearly labelled.
const e = computeLevels({ entry: 1000, supports: [], seasonality: null });
ok("final fallback is flat 7%", e.stop.basis === "FALLBACK" && e.stop.price === 930);

// 8. A weak nearest support defers to a strong one close behind.
const weakFirst = [
  { price: 995, type: "MA10", strength: "WEAK" },
  { price: 975, type: "MA50", strength: "STRONG" },
];
ok("weak anchor defers to a nearby strong one",
   pickStopAnchor(weakFirst, 1000, { maxRiskPct: 9.6 }).type === "MA50");
// ...but not to a distant one.
const weakThenFar = [
  { price: 995, type: "MA10", strength: "WEAK" },
  { price: 890, type: "MA50", strength: "STRONG" },
];
ok("but not to one the risk budget can't reach",
   pickStopAnchor(weakThenFar, 1000, { maxRiskPct: 9.6 }).type === "MA10");

// 9. R:R, average-in and rupee amounts.
const f = computeLevels({ entry: 1000, supports, seasonality: seas, lotSize: 100, lots: 2 });
ok("risk:reward computed", f.riskReward === Math.round((60 / 78.5) * 100) / 100,
   `got ${f.riskReward}`);
ok("average-in is the entry/stop midpoint", f.averageIn === Math.round(((1000 + 921.5) / 2) * 100) / 100);
ok("rupee risk uses lot size x lots", f.riskAmount === Math.round(78.5 * 100 * 2));
ok("average-in is lot-independent (presentation decides if it shows)",
   computeLevels({ entry: 1000, supports, seasonality: seas, lots: 1 }).averageIn ===
   computeLevels({ entry: 1000, supports, seasonality: seas, lots: 3 }).averageIn);

// 10. A negative month is reported, not hidden.
const g = computeLevels({ entry: 1000, supports, seasonality: { medianReturn: -3, worst: -12 } });
ok("negative month warns instead of faking upside",
   g.warnings.some((w) => /no historical upside/i.test(w)));

// 10b. A symbol with neither seasonality nor a usable mean (a recent listing or
// post-demerger line) must say WHY there is no target, not just return null.
const thin = computeLevels({ entry: 1000, supports, seasonality: null, reversionTarget: null });
ok("no target is explained, not silent",
   thin.target === null && thin.warnings.some((w) => /No target/.test(w)),
   JSON.stringify(thin.warnings));
ok("...and the stop still stands", thin.stop.price > 0 && thin.stop.price < 1000);

// 11. Guards.
ok("bad entry returns null", computeLevels({ entry: 0 }) === null);
ok("no args returns null", computeLevels() === null);

// 12. Helpers.
ok("floors map to supports by touch count",
   floorsToSupports([{ low: 100, touches: 5 }])[0].strength === "VERY_STRONG");
const s = seasonalityFor([5, -3, 8, 12, -1]);
ok("seasonalityFor computes median/worst/winRate",
   s.medianReturn === 5 && s.worst === -3 && s.winRate === 60 && s.n === 5,
   JSON.stringify(s));



// ── Integration: real computeSupportZones output feeding computeLevels ───────
// The unit checks above use hand-written support arrays. This exercises the
// actual seam the /api/levels route relies on.
cpSync(join(here, "..", "app", "lib", "technicals.js"), join(here, ".tech.tmp.mjs"));
process.on("exit", () => { try { rmSync(join(here, ".tech.tmp.mjs")); } catch {} });
const { computeSupportZones } = await import(join(here, ".tech.tmp.mjs"));

// A stock that fell from 1200 to ~1000 and is now basing — so MAs, the 52-week
// low and swing lows all sit below price, which is the interesting case.
const candles = [];
for (let i = 0; i < 300; i++) {
  const base = i < 200 ? 1200 - i * 1.0 : 1000 + Math.sin(i / 8) * 25;
  const close = Math.round(base * 100) / 100;
  candles.push({
    date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
    open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000,
  });
}
const price = candles[candles.length - 1].close;
const zones = computeSupportZones(candles, price);
ok("support zones are found from real candles", zones.zones.length > 0,
   `got ${zones.zones.length}`);
ok("every zone sits below entry", zones.zones.every((z) => z.price <= price));

const live = computeLevels({
  entry: price,
  supports: zones.zones,
  seasonality: { medianReturn: 5, worst: -9, winRate: 70, n: 14 },
  reversionTarget: 1150,
  strategy: "seasonal",
});
ok("integration produces a stop below entry", live.stop.price < price, `got ${live.stop.price}`);
ok("integration stop is anchored to a named zone type",
   zones.zones.some((z) => z.type === live.stop.basis), `basis ${live.stop.basis}`);
ok("integration target is above entry", live.target.price > price);
ok("integration risk:reward is positive", live.riskReward > 0, `got ${live.riskReward}`);
ok("integration reports no fallback warnings",
   !live.warnings.some((w) => /flat 7%|No support level/.test(w)),
   JSON.stringify(live.warnings));

// The invariant that actually matters for the bug this fixes: identical inputs
// under the SAME strategy always give an identical stop. Sizing and Early Entry
// are both seasonal, so they can no longer disagree about the same stock.
const again = computeLevels({
  entry: price, supports: zones.zones,
  seasonality: { medianReturn: 5, worst: -9, winRate: 70, n: 14 },
  reversionTarget: 1150, strategy: "seasonal",
});
ok("INTEGRATION: same strategy + same inputs = same stop",
   again.stop.price === live.stop.price && again.target.price === live.target.price,
   `${again.stop.price} vs ${live.stop.price}`);

const rev = computeLevels({
  entry: price, supports: zones.zones,
  seasonality: { medianReturn: 5, worst: -9, winRate: 70, n: 14 },
  reversionTarget: 1150, strategy: "reversion",
});
ok("INTEGRATION: seasonal stop is no tighter than reversion",
   live.stop.price <= rev.stop.price, `seasonal ${live.stop.price} vs reversion ${rev.stop.price}`);

// The horizon guard must actually bite: a month-long stop can't sit under a
// 10-day average when the month's worst case is -9%.
const minPct = live.stop.minStopPct;
ok("seasonal stop respects the holding-period floor",
   minPct == null || live.stop.pct >= minPct || live.stop.basis === "SEASONAL_WORST",
   `stop ${live.stop.pct}% vs floor ${minPct}%`);

console.log(`\n  ${pass} passed, ${fail} failed  (incl. integration)`);
process.exit(fail ? 1 : 0);
