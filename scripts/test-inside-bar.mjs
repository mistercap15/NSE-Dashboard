// Unit checks for the inside-bar breakout engine. Run: npm run test:inside-bar
//
// Same .mjs copy trick as the other suites: the lib is ESM but package.json has
// no "type": "module", so bare node would parse it as CommonJS.
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, ".insideBar.tmp.mjs");
cpSync(join(here, "..", "app", "lib", "insideBar.js"), tmp);
process.on("exit", () => { try { rmSync(tmp); } catch {} });

const { computeInsideBarSignal, manageInsideBarTrade, isInside, IB_CONFIG } = await import(tmp);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const near = (a, b, eps = 0.01) => Number.isFinite(a) && Math.abs(a - b) < eps;

let seq = 0;
const bar = (o, h, l, c) => ({
  timestamp: `2026-08-24T${String(9 + (seq++ % 7)).padStart(2, "0")}:15:00+05:30`,
  open: o, high: h, low: l, close: c, volume: 100,
});

// ── isInside — strict on both sides ─────────────────────────────────────────
const mother = { high: 100, low: 90 };
ok("a bar within both extremes is inside", isInside({ high: 99, low: 91 }, mother));
ok("an equal high is NOT inside", !isInside({ high: 100, low: 91 }, mother));
ok("an equal low is NOT inside", !isInside({ high: 99, low: 90 }, mother));
ok("a higher high is not inside", !isInside({ high: 101, low: 91 }, mother));
ok("garbage is not inside", !isInside(null, mother) && !isInside({ high: 99 }, mother));

// ── Setup detection ─────────────────────────────────────────────────────────
// Mother 24200-24000 (range 200), then an inside bar, then a quiet bar.
const setup = () => { seq = 0; return [
  bar(24050, 24100, 23950, 24020),   // 0 filler
  bar(24020, 24200, 24000, 24150),   // 1 MOTHER  high 24200 low 24000
  bar(24150, 24180, 24050, 24100),   // 2 INSIDE
]; };

let s = computeInsideBarSignal(setup());
ok("finds the mother bar", s.motherHigh === 24200 && s.motherLow === 24000, JSON.stringify(s));
ok("range is the mother's height", s.range === 200);
ok("knows the last closed bar IS the inside bar", s.isInsideBar === true);
ok("state is watching_breakout", s.state === "watching_breakout", s.state);
ok("no entry while only watching", s.entryValid === false);
ok("long trigger is the mother high", s.longTrigger === 24200);
ok("short trigger is the mother low", s.shortTrigger === 24000);
ok("long stop is the opposite side", s.longStop === 24000);
ok("short stop is the opposite side", s.shortStop === 24200);
ok("long target is 5x range above the trigger",
   near(s.longTarget, 24200 + 5 * 200), String(s.longTarget));
ok("short target is 5x range below the trigger",
   near(s.shortTarget, 24000 - 5 * 200), String(s.shortTarget));
ok("explains what it is watching", /watching/i.test(s.reason), s.reason);

// ── NO LOOKAHEAD — the defining discipline ─────────────────────────────────
// An inside bar cannot break itself out. At the moment it closed, nobody knew
// which way it would go; reading a direction from it would be reading the future.
const insideOnly = setup();
ok("the inside bar alone never produces a signal",
   computeInsideBarSignal(insideOnly).entryValid === false);
ok("  ...and reports no direction",
   computeInsideBarSignal(insideOnly).direction === null);

// A bar that would be "inside" relative to a LATER bar must not count: only the
// bar immediately before it can be its mother.
const notMother = [bar(100, 300, 50, 200), bar(200, 150, 120, 140), bar(140, 400, 10, 300)];
ok("only the immediately-preceding bar can be the mother",
   computeInsideBarSignal(notMother).motherHigh === 300,
   JSON.stringify(computeInsideBarSignal(notMother)));

// ── LONG breakout ───────────────────────────────────────────────────────────
const longBreak = [...setup(), bar(24100, 24260, 24090, 24240)];   // breaks 24200
s = computeInsideBarSignal(longBreak);
ok("a break above the mother high is a LONG signal", s.state === "long_signal", s.state);
ok("direction is long", s.direction === "long");
ok("entry is valid on the breakout bar", s.entryValid === true);
ok("breakout is zero bars ago", s.breakoutBarsAgo === 0, String(s.breakoutBarsAgo));
ok("the inside-bar flag is now false", s.isInsideBar === false);
ok("levels survive the breakout", s.longTrigger === 24200 && s.longStop === 24000);
ok("reason names the direction and levels",
   /long breakout/i.test(s.reason) && s.reason.includes("24200"), s.reason);

// ── SHORT breakout ──────────────────────────────────────────────────────────
const shortBreak = [...setup(), bar(24100, 24140, 23960, 23980)];  // breaks 24000
s = computeInsideBarSignal(shortBreak);
ok("a break below the mother low is a SHORT signal", s.state === "short_signal", s.state);
ok("direction is short", s.direction === "short");
ok("entry is valid on the breakout bar", s.entryValid === true);
ok("short stop is the mother HIGH", s.shortStop === 24200);
ok("short target is below", s.shortTarget < s.shortTrigger);

// ── A stale breakout is not an entry ────────────────────────────────────────
const stale = [...setup(),
  bar(24100, 24260, 24090, 24240),   // the break
  bar(24240, 24300, 24230, 24290),   // and the market has moved on
];
s = computeInsideBarSignal(stale);
ok("a breakout one bar old still reports its direction", s.direction === "long");
ok("  ...but is no longer enterable", s.entryValid === false);
ok("  ...and says why", /too late/i.test(s.reason), s.reason);
ok("  ...counting how stale it is", s.breakoutBarsAgo === 1, String(s.breakoutBarsAgo));

// ── Ambiguity: one bar covering both sides ─────────────────────────────────
const both = [...setup(), bar(24100, 24260, 23950, 24100)];
s = computeInsideBarSignal(both);
ok("a bar breaking BOTH sides voids the setup", s.state === "no_setup", s.state);
ok("  ...refuses to guess a direction", s.direction === null && s.entryValid === false);
ok("  ...and says the direction is unknowable", /unknowable/i.test(s.reason), s.reason);

// ── No setup / staleness / degenerate input ────────────────────────────────
const trending = [bar(100, 110, 90, 105), bar(105, 125, 100, 120), bar(120, 140, 115, 135)];
ok("a trending series has no inside bar",
   computeInsideBarSignal(trending).state === "no_setup");

const old = [...setup()];
for (let i = 0; i < 12; i++) old.push(bar(24100, 24150, 24050, 24100));  // all inside-ish but stale
ok("a setup older than the lookback is not used",
   computeInsideBarSignal(old, { ...IB_CONFIG, setupLookback: 3 }).state !== "long_signal");

const flat = [bar(100, 100, 100, 100), bar(100, 100, 100, 100), bar(100, 100, 100, 100)];
ok("a zero-range mother cannot set up", computeInsideBarSignal(flat).entryValid === false);

ok("two bars is not enough", /at least 3/.test(computeInsideBarSignal([bar(1, 2, 0, 1), bar(1, 2, 0, 1)]).reason));
ok("empty input is handled", computeInsideBarSignal([]).state === "no_setup");
ok("null input is handled", computeInsideBarSignal(null).entryValid === false);
ok("garbage bars do not throw", (() => {
  try { return computeInsideBarSignal([{}, {}, {}]).entryValid === false; } catch { return false; }
})());
ok("every return path has the same shape",
   JSON.stringify(Object.keys(computeInsideBarSignal(longBreak)).sort()) ===
   JSON.stringify(Object.keys(computeInsideBarSignal(null)).sort()));
ok("defaults come from IB_CONFIG",
   IB_CONFIG.targetMult === 5.0 && IB_CONFIG.timeoutBars === 20);

// ── manageInsideBarTrade — LONG ─────────────────────────────────────────────
const L = { direction: "long", entryPrice: 24200, entryIndex: 0, stopPrice: 24000, targetPrice: 25200 };
let r = manageInsideBarTrade({ ...L, candles: [bar(24200, 24250, 24180, 24230), bar(24230, 24240, 23990, 24010)] });
ok("long: stop hit is detected", r.action === "stop" && r.exitPrice === 24000, JSON.stringify(r));
r = manageInsideBarTrade({ ...L, candles: [bar(24200, 24250, 24180, 24230), bar(24230, 25260, 24220, 25240)] });
ok("long: target hit is detected", r.action === "target" && r.exitPrice === 25200, JSON.stringify(r));
r = manageInsideBarTrade({ ...L, candles: [bar(24200, 24250, 24180, 24230), bar(24230, 25260, 23990, 24100)] });
ok("long: a bar spanning both resolves to the STOP", r.action === "stop", JSON.stringify(r));
r = manageInsideBarTrade({ ...L, candles: [bar(24200, 24250, 24180, 24230), bar(23900, 23950, 23800, 23850)] });
ok("long: a gap through the stop fills at the open", r.exitPrice === 23900, JSON.stringify(r));

// ── manageInsideBarTrade — SHORT, the mirror image ─────────────────────────
const S = { direction: "short", entryPrice: 24000, entryIndex: 0, stopPrice: 24200, targetPrice: 23000 };
r = manageInsideBarTrade({ ...S, candles: [bar(24000, 24050, 23950, 23980), bar(23980, 24210, 23970, 24190)] });
ok("short: stop is ABOVE and is detected", r.action === "stop" && r.exitPrice === 24200, JSON.stringify(r));
r = manageInsideBarTrade({ ...S, candles: [bar(24000, 24050, 23950, 23980), bar(23980, 24000, 22990, 23010)] });
ok("short: target is BELOW and is detected", r.action === "target" && r.exitPrice === 23000, JSON.stringify(r));
r = manageInsideBarTrade({ ...S, candles: [bar(24000, 24050, 23950, 23980), bar(23980, 24210, 22990, 23500)] });
ok("short: a bar spanning both resolves to the STOP", r.action === "stop", JSON.stringify(r));
r = manageInsideBarTrade({ ...S, candles: [bar(24000, 24050, 23950, 23980), bar(24300, 24400, 24250, 24350)] });
ok("short: a gap through the stop fills at the open", r.exitPrice === 24300, JSON.stringify(r));

// ── Timeout, both directions ────────────────────────────────────────────────
const quiet = (n) => Array.from({ length: n }, () => bar(24100, 24120, 24080, 24100));
r = manageInsideBarTrade({ ...L, candles: [bar(24200, 24250, 24180, 24230), ...quiet(25)],
                           config: { ...IB_CONFIG, timeoutBars: 20 } });
ok("long: times out after the configured bars", r.action === "timeout" && r.barsHeld === 20, JSON.stringify(r));
r = manageInsideBarTrade({ ...S, candles: [bar(24000, 24050, 23950, 23980), ...quiet(25)],
                           config: { ...IB_CONFIG, timeoutBars: 20 } });
ok("short: times out too", r.action === "timeout" && r.barsHeld === 20, JSON.stringify(r));

// ── Fails open ──────────────────────────────────────────────────────────────
ok("untouched position holds", manageInsideBarTrade({ ...L, candles: [bar(24200, 24250, 24180, 24230)] }).action === "hold");
ok("no direction holds", manageInsideBarTrade({ ...L, direction: null, candles: quiet(3) }).action === "hold");
ok("bad entry index holds", manageInsideBarTrade({ ...L, entryIndex: 99, candles: quiet(3) }).action === "hold");
ok("no arguments holds", manageInsideBarTrade().action === "hold");

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
