// Unit checks for the Fibonacci futures engine. Run: npm run test:fib
//
// Same .mjs copy trick as the other test scripts: the libs are ESM but
// package.json has no "type": "module", so bare node would parse them as
// CommonJS. instrumentMaster.js additionally imports "./instruments", which
// does not resolve from scripts/ — so that specifier is rewritten to point at
// the sibling copy.
import { cpSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const lib = (name) => join(here, "..", "app", "lib", name);
const tmp = (name) => join(here, `.${name}.tmp.mjs`);

const temps = [];
const copy = (name) => {
  const dest = tmp(name);
  cpSync(lib(`${name}.js`), dest);
  temps.push(dest);
  return dest;
};

const fibPath = copy("fib");
const technicalsPath = copy("technicals");

// instrumentMaster imports a sibling module; repoint it at our copy.
const instrumentsPath = copy("instruments");
const masterDest = tmp("instrumentMaster");
writeFileSync(
  masterDest,
  readFileSync(lib("instrumentMaster.js"), "utf8").replace(
    /from "\.\/instruments"/,
    `from "./${instrumentsPath.split("/").pop()}"`,
  ),
);
temps.push(masterDest);

process.on("exit", () => { for (const t of temps) { try { rmSync(t); } catch {} } });

const { computeFibSignal, manageTrade, closedBars, lastClosedBar, barCloseMs, FIB_CONFIG } =
  await import(fibPath);
const { atr, trueRange, atrAt } = await import(technicalsPath);
const { pickContracts, futuresChain, currentFuturesContract, nextFuturesContract } =
  await import(masterDest);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const near = (a, b, eps = 0.01) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < eps;

// ── ATR (Wilder) ────────────────────────────────────────────────────────────
// Hand-computed fixture. Ranges are 2 until a 9-point bar, so the seed and the
// smoothing step are both verifiable by eye:
//   TR   = [2, 2, 2, 9, 2]
//   seed = (2+2+2)/3            = 2
//   [3]  = (2*2 + 9)/3          = 4.33333
//   [4]  = (4.33333*2 + 2)/3    = 3.55556
const bar = (h, l, c, o = c) => ({ open: o, high: h, low: l, close: c, volume: 1 });
const atrFixture = [
  bar(10, 8, 9),
  bar(11, 9, 10),
  bar(12, 10, 11),
  bar(20, 11, 19),
  bar(21, 19, 20),
];

const tr = trueRange(atrFixture);
ok("trueRange first bar is high-low", tr[0] === 2, `got ${tr[0]}`);
ok("trueRange uses the wider gap-aware leg", tr[3] === 9, `got ${tr[3]}`);

const a3 = atr(atrFixture, 3);
ok("ATR is null before the seed bar", a3[0] === null && a3[1] === null);
ok("ATR seeds with the mean of the first n true ranges", near(a3[2], 2), `got ${a3[2]}`);
ok("ATR applies Wilder smoothing", near(a3[3], 4.33333), `got ${a3[3]}`);
ok("ATR keeps smoothing forward", near(a3[4], 3.55556), `got ${a3[4]}`);
ok("ATR series is aligned to candles", a3.length === atrFixture.length);
ok("atrAt reads the newest value", near(atrAt(atrFixture, 3), 3.55556), `got ${atrAt(atrFixture, 3)}`);

// Gap awareness: a bar that opens far below the prior close has a true range
// much larger than its own high-low. This is the whole reason for using TR.
const gapped = [bar(100, 90, 95), bar(80, 70, 75)];
ok("trueRange catches a gap down", trueRange(gapped)[1] === 25, `got ${trueRange(gapped)[1]}`);

// Fails open rather than throwing.
ok("ATR on too-few candles returns nulls", atr([bar(10, 8, 9)], 14).every((v) => v === null));
ok("ATR on garbage input returns []", atr(null, 14).length === 0);
ok("ATR survives a malformed bar mid-series",
   atr([...atrFixture, { high: null, low: null, close: null }], 3).length === 6);

// ── computeFibSignal — geometry ─────────────────────────────────────────────
// 8 bars, lookback 5. The swing window is bars 2..6 (the signal bar is excluded
// on purpose), giving swingHigh 150 / swingLow 100 / range 50:
//   fibEntry = 150 - 50*0.618 = 119.10
//   target   = 150
//   trend floor (50% of range) = 125, and the signal bar closes at 132.
const CFG = { swingLookback: 5, atrPeriod: 3, atrStopMult: 2, timeoutBars: 4 };
const ts = (i) => `2026-08-1${Math.floor(i / 7) + 1}T${String(9 + (i % 7)).padStart(2, "0")}:15:00+05:30`;
const mk = (o, h, l, c, i) => ({ timestamp: ts(i), date: ts(i).slice(0, 10), open: o, high: h, low: l, close: c, volume: 100 });

const trend = [
  mk(100, 105, 98, 102, 0),
  mk(102, 108, 100, 106, 1),
  mk(106, 150, 104, 145, 2),   // swing high 150
  mk(145, 148, 130, 135, 3),
  mk(135, 140, 100, 110, 4),   // swing low 100
  mk(110, 125, 108, 120, 5),
  mk(120, 132, 118, 130, 6),
  mk(130, 135, 126, 132, 7),   // signal bar, closes 132
];

const s = computeFibSignal(trend, CFG);
ok("swing high comes from the window, excluding the signal bar", s.swingHigh === 150, `got ${s.swingHigh}`);
ok("swing low comes from the window", s.swingLow === 100, `got ${s.swingLow}`);
ok("range is high minus low", s.range === 50, `got ${s.range}`);
ok("fib entry is the 0.618 retracement", near(s.fibEntry, 119.1), `got ${s.fibEntry}`);
ok("target is the swing high", s.targetPrice === 150, `got ${s.targetPrice}`);
ok("target distance is entry to swing high", near(s.targetDistancePts, 30.9), `got ${s.targetDistancePts}`);
// The reported `atr` is itself rounded to 2dp, so recomputing the stop from it
// drifts by up to a paisa against the stop computed from the full-precision ATR.
ok("stop sits atrStopMult ATRs below entry",
   near(s.stopPrice, s.fibEntry - 2 * s.atr, 0.02), `entry ${s.fibEntry} atr ${s.atr} stop ${s.stopPrice}`);
ok("stop distance equals the ATR multiple", near(s.stopDistancePts, 2 * s.atr), `got ${s.stopDistancePts}`);
ok("reward:risk is target over stop distance",
   near(s.rewardRiskRatio, s.targetDistancePts / s.stopDistancePts, 0.02), `got ${s.rewardRiskRatio}`);
ok("asOf is the signal bar's timestamp", s.asOf === trend[7].timestamp, `got ${s.asOf}`);
ok("signal bar's own high cannot set the target", trend[7].high === 135 && s.swingHigh === 150);

// The engine's internal ATR must agree with technicals.atr — they are two
// copies of Wilder's method and are allowed to drift only over this test's body.
ok("engine ATR matches technicals.atr", near(s.atr, atrAt(trend, 3)), `${s.atr} vs ${atrAt(trend, 3)}`);

// ── computeFibSignal — the trend filter ─────────────────────────────────────
ok("entryValid is true for a pullback holding above the midpoint", s.entryValid === true);
ok("valid state explains itself", /pullback in uptrend/i.test(s.reason), s.reason);

// Same swing, but the signal bar closes below the 50% level (125).
const broken = [...trend.slice(0, 7), mk(130, 135, 118, 120, 7)];
const sb = computeFibSignal(broken, CFG);
ok("entryValid is false once the close breaks the midpoint", sb.entryValid === false, `close ${sb.lastClose}`);
ok("levels are still reported when standing aside",
   sb.fibEntry === s.fibEntry && sb.targetPrice === 150, `got ${sb.fibEntry}`);
ok("invalid state explains itself", /stand aside/i.test(sb.reason), sb.reason);

// Exactly at the midpoint is not above it — the filter must not be inclusive.
const atFloor = [...trend.slice(0, 7), mk(130, 135, 118, 125, 7)];
ok("close exactly at the midpoint does not qualify",
   computeFibSignal(atFloor, CFG).entryValid === false);

// ── computeFibSignal — edge cases, all fail open ────────────────────────────
const flat = Array.from({ length: 8 }, (_, i) => mk(100, 100, 100, 100, i));
const sf = computeFibSignal(flat, CFG);
ok("flat range does not divide through zero", sf.entryValid === false && sf.fibEntry === null);
ok("flat range is named as the reason", /flat/i.test(sf.reason), sf.reason);
ok("flat range still reports the swing it found", sf.swingHigh === 100 && sf.range === 0);

const short = computeFibSignal(trend.slice(0, 3), CFG);
ok("too few candles returns nulls, not a throw", short.fibEntry === null && short.entryValid === false);
ok("too few candles says how many it needed", /need 6/.test(short.reason), short.reason);

ok("empty array is handled", computeFibSignal([], CFG).reason === "No candles supplied.");
ok("null input is handled", computeFibSignal(null, CFG).entryValid === false);
ok("garbage bars do not throw", (() => {
  try {
    const r = computeFibSignal(Array.from({ length: 8 }, () => ({ high: null, low: null, close: null })), CFG);
    return r.entryValid === false;
  } catch { return false; }
})());

// A signal always returns the same key set, so clients can render it blind.
ok("every return path has the same shape",
   JSON.stringify(Object.keys(s).sort()) === JSON.stringify(Object.keys(short).sort()),
   `${Object.keys(s).length} vs ${Object.keys(short).length}`);

// Default config is used when none is passed.
ok("defaults come from FIB_CONFIG", FIB_CONFIG.fibLevel === 0.618 && FIB_CONFIG.swingLookback === 30);

// ── manageTrade ─────────────────────────────────────────────────────────────
const POS = { entryPrice: 119.1, entryIndex: 0, stopPrice: 100, targetPrice: 150, config: CFG };

const stopped = manageTrade({ ...POS, candles: [
  mk(119, 122, 118, 121, 0),
  mk(121, 123, 115, 117, 1),
  mk(117, 118,  99, 101, 2),   // low 99 <= stop 100
] });
ok("stop exit is detected", stopped.action === "stop", JSON.stringify(stopped));
ok("stop fills at the stop price", stopped.exitPrice === 100, `got ${stopped.exitPrice}`);
ok("stop reports bars held", stopped.barsHeld === 2, `got ${stopped.barsHeld}`);

const gapStop = manageTrade({ ...POS, candles: [
  mk(119, 122, 118, 121, 0),
  mk(85, 90, 80, 88, 1),       // opens below the stop
] });
ok("a gap through the stop fills at the open", gapStop.action === "stop" && gapStop.exitPrice === 85,
   JSON.stringify(gapStop));
ok("the gap is explained", /gapped/i.test(gapStop.reason), gapStop.reason);

const hitTarget = manageTrade({ ...POS, candles: [
  mk(119, 122, 118, 121, 0),
  mk(121, 140, 120, 138, 1),
  mk(138, 152, 136, 150, 2),   // high 152 >= target 150
] });
ok("target exit is detected", hitTarget.action === "target", JSON.stringify(hitTarget));
ok("target fills at the target price", hitTarget.exitPrice === 150, `got ${hitTarget.exitPrice}`);

// Ambiguous bar: spans both levels. The stop must win — assuming otherwise
// invents wins a real fill sequence may never have produced.
const both = manageTrade({ ...POS, candles: [
  mk(119, 122, 118, 121, 0),
  mk(120, 155, 95, 130, 1),
] });
ok("a bar touching both levels resolves to the stop", both.action === "stop", JSON.stringify(both));

const timedOut = manageTrade({ ...POS, candles: [
  mk(119, 122, 118, 121, 0),
  mk(121, 124, 119, 122, 1),
  mk(122, 125, 120, 123, 2),
  mk(123, 126, 121, 124, 3),
  mk(124, 127, 122, 126, 4),   // barsHeld 4 == timeoutBars
] });
ok("timeout exit is detected", timedOut.action === "timeout", JSON.stringify(timedOut));
ok("timeout exits at that bar's close", timedOut.exitPrice === 126, `got ${timedOut.exitPrice}`);
ok("timeout counts bars since entry", timedOut.barsHeld === 4, `got ${timedOut.barsHeld}`);

const holding = manageTrade({ ...POS, candles: [
  mk(119, 122, 118, 121, 0),
  mk(121, 124, 119, 122, 1),
] });
ok("an untouched position holds", holding.action === "hold" && holding.exitPrice === null,
   JSON.stringify(holding));

ok("stop precedes target within the same scan", (() => {
  const r = manageTrade({ ...POS, candles: [mk(119, 122, 118, 121, 0), mk(120, 99, 98, 98, 1)] });
  return r.action === "stop";
})());
ok("manageTrade fails open on missing candles", manageTrade({ ...POS, candles: [] }).action === "hold");
ok("manageTrade fails open on a bad entry index",
   manageTrade({ ...POS, entryIndex: 99, candles: [mk(119, 122, 118, 121, 0)] }).action === "hold");
ok("manageTrade fails open on no arguments", manageTrade().action === "hold");

// ── Bar-close accounting ────────────────────────────────────────────────────
// The 15:15 bar is a 15-minute stub closing with the session at 15:30, not a
// full hour. Getting this wrong drops the last signal of every day.
const b0915 = { timestamp: "2026-08-13T09:15:00+05:30" };
const b1515 = { timestamp: "2026-08-13T15:15:00+05:30" };
ok("a mid-session bar closes an hour after it opens",
   barCloseMs(b0915) === new Date("2026-08-13T10:15:00+05:30").getTime());
ok("the 15:15 stub closes at 15:30, not 16:15",
   barCloseMs(b1515) === new Date("2026-08-13T15:30:00+05:30").getTime(),
   new Date(barCloseMs(b1515)).toISOString());

const session = [b0915, { timestamp: "2026-08-13T10:15:00+05:30" }, { timestamp: "2026-08-13T11:15:00+05:30" }];
const mid1115 = new Date("2026-08-13T11:40:00+05:30").getTime();
ok("the bar still forming is dropped", closedBars(session, mid1115).length === 2);
ok("lastClosedBar returns the newest finished bar",
   lastClosedBar(session, mid1115).timestamp === "2026-08-13T10:15:00+05:30");
ok("after the close nothing is dropped",
   closedBars(session, new Date("2026-08-13T16:00:00+05:30").getTime()).length === 3);
ok("closedBars fails open on garbage", closedBars(null).length === 0 && lastClosedBar([]) === null);

// ── Futures contract resolution ─────────────────────────────────────────────
// Nearest expiry that has not passed wins; `next` is the roll target. The chain
// is deliberately supplied out of order — the real master is not sorted either.
const NOW = new Date("2026-08-18T12:00:00+05:30").getTime();
const chain = [
  { instrumentKey: "NSE_FO|48704", tradingSymbol: "NIFTY FUT 27 OCT 26", expiry: new Date("2026-10-27T15:30:00+05:30").getTime(), lotSize: 65, freezeQty: 1755 },
  { instrumentKey: "NSE_FO|11111", tradingSymbol: "NIFTY FUT 28 JUL 26", expiry: new Date("2026-07-28T15:30:00+05:30").getTime(), lotSize: 65, freezeQty: 1755 },
  { instrumentKey: "NSE_FO|58072", tradingSymbol: "NIFTY FUT 25 AUG 26", expiry: new Date("2026-08-25T15:30:00+05:30").getTime(), lotSize: 65, freezeQty: 1755 },
  { instrumentKey: "NSE_FO|68407", tradingSymbol: "NIFTY FUT 29 SEP 26", expiry: new Date("2026-09-29T15:30:00+05:30").getTime(), lotSize: 65, freezeQty: 1755 },
];

const picked = pickContracts(chain, NOW);
ok("current contract is the nearest unexpired one",
   picked.current.instrumentKey === "NSE_FO|58072", picked.current?.tradingSymbol);
ok("expired contracts are skipped", picked.current.expiry > NOW);
ok("next contract is the one after it",
   picked.next.instrumentKey === "NSE_FO|68407", picked.next?.tradingSymbol);
ok("contract carries the fields an order needs",
   picked.current.lotSize === 65 && picked.current.freezeQty === 1755);

// On expiry day, before 15:30, the expiring contract is still the front month —
// a position is open in it and it is still the one that trades.
const expiryMorning = new Date("2026-08-25T10:00:00+05:30").getTime();
ok("on expiry morning the expiring contract is still current",
   pickContracts(chain, expiryMorning).current.instrumentKey === "NSE_FO|58072");
ok("after the expiry instant it rolls",
   pickContracts(chain, new Date("2026-08-25T15:31:00+05:30").getTime()).current.instrumentKey === "NSE_FO|68407");

ok("a fully expired chain yields nulls",
   pickContracts(chain, new Date("2027-01-01T00:00:00+05:30").getTime()).current === null);
ok("a single-contract chain has no roll target",
   pickContracts([chain[0]], NOW).next === null);
ok("pickContracts fails open on garbage", pickContracts(null, NOW).current === null);
ok("pickContracts ignores rows without an expiry",
   pickContracts([{ instrumentKey: "X" }, chain[2]], NOW).current.instrumentKey === "NSE_FO|58072");

// Without a loaded master these must return empty, not throw — the route calls
// ensureInstrumentMap() first, but a cold instance can still race it.
ok("futuresChain fails open before the master loads", futuresChain("NIFTY").length === 0);
ok("currentFuturesContract fails open before the master loads",
   currentFuturesContract("NIFTY") === null && nextFuturesContract("NIFTY") === null);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
