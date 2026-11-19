// Unit checks for the monthly F&O expiry calendar.
// Run: node scripts/test-events.mjs
//
// NSE moved monthly expiry from the last Thursday to the last Tuesday in
// September 2025, and rolls a weekend or NSE holiday back to the previous
// trading day. The server clock on Vercel is UTC; these dates are IST.
//
// Same .mjs copy trick as the other suites: the lib is ESM but package.json has
// no "type": "module", so bare node would parse it as CommonJS.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const tmp = join(here, ".events.tmp");
mkdirSync(tmp, { recursive: true });
process.on("exit", () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

writeFileSync(join(tmp, "master-stub.mjs"), `
export function currentFuturesContract() {
  return globalThis.__LISTED_NIFTY__ || null;
}
export function futuresChain() {
  return globalThis.__NIFTY_CHAIN__ || [];
}
`);
cpSync(join(root, "data", "events.json"), join(tmp, "events.json"));
writeFileSync(join(tmp, "events.mjs"),
  readFileSync(join(root, "app", "lib", "events.js"), "utf8")
    .replace(
      'import calendarFile from "../../data/events.json";',
      'import calendarFile from "./events.json" with { type: "json" };',
    )
    .replace(
      'import { currentFuturesContract, futuresChain } from "./instrumentMaster";',
      'import { currentFuturesContract, futuresChain } from "./master-stub.mjs";',
    ));

const {
  monthlyFoExpiry,
  lastThursday,
  expiryWeekday,
  getCalendar,
  istYmd,
  listedNiftyExpiryFor,
} = await import(join(tmp, "events.mjs"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const dow = (ymd) => new Date(`${ymd}T00:00:00Z`).toUTCString().slice(0, 3);

// ── Weekday change: November 2026 ────────────────────────────────────────────
// 30 Nov 2026 is a Monday, so the last Tuesday is the 24th and the last
// Thursday is the 26th. The old calendar returned the Thursday.
ok("Nov 2026 = Tue 24 Nov",
  monthlyFoExpiry(2026, 11, []) === "2026-11-24" && dow("2026-11-24") === "Tue",
  `got ${monthlyFoExpiry(2026, 11, [])}`);
ok("Nov 2026 is not the old last Thursday",
  lastThursday(2026, 11) === "2026-11-26" && monthlyFoExpiry(2026, 11, []) !== lastThursday(2026, 11));

// With the real NSE calendar, 24 Nov 2026 is Guru Nanak Jayanti, so the
// contract — and the listed NIFTY future — expires the previous session.
ok("Nov 2026 holiday-shifts off Tue 24 Nov to Mon 23 Nov",
  monthlyFoExpiry(2026, 11) === "2026-11-23" && dow("2026-11-23") === "Mon",
  `got ${monthlyFoExpiry(2026, 11)}`);

// ── The rule boundary ────────────────────────────────────────────────────────
ok("Aug 2025 is still the last Thursday",
  expiryWeekday(2025, 8) === 4 && monthlyFoExpiry(2025, 8) === "2025-08-28" && dow("2025-08-28") === "Thu",
  monthlyFoExpiry(2025, 8));
ok("Sep 2025 is the first last-Tuesday month",
  expiryWeekday(2025, 9) === 2 && monthlyFoExpiry(2025, 9) === "2025-09-30" && dow("2025-09-30") === "Tue",
  monthlyFoExpiry(2025, 9));

// ── Holiday roll-back, including across a weekend ───────────────────────────
ok("Jan 2023 Republic Day shifts last Thursday to Wed 25 Jan",
  monthlyFoExpiry(2023, 1) === "2023-01-25" && dow("2023-01-25") === "Wed",
  monthlyFoExpiry(2023, 1));
ok("Mar 2023 Ram Navami shifts last Thursday to Wed 29 Mar",
  monthlyFoExpiry(2023, 3) === "2023-03-29",
  monthlyFoExpiry(2023, 3));
ok("Mar 2026 Mahavir Jayanti shifts last Tuesday to Mon 30 Mar",
  monthlyFoExpiry(2026, 3) === "2026-03-30" && dow("2026-03-30") === "Mon",
  monthlyFoExpiry(2026, 3));
ok("Jan 2027 Republic Day shifts last Tuesday to Mon 25 Jan",
  monthlyFoExpiry(2027, 1) === "2027-01-25",
  monthlyFoExpiry(2027, 1));

// Injected: Tuesday and Monday both shut, so the roll steps over the weekend.
ok("a Tuesday+Monday holiday rolls to the previous Friday",
  monthlyFoExpiry(2026, 11, ["2026-11-24", "2026-11-23"]) === "2026-11-20"
  && dow("2026-11-20") === "Fri",
  monthlyFoExpiry(2026, 11, ["2026-11-24", "2026-11-23"]));

// ── IST, not the server's local clock ────────────────────────────────────────
// 2026-11-23 19:00 UTC is 00:30 IST on 24 Nov. UTC still says the 23rd, which
// is the (holiday-shifted) November expiry; IST is already the next day, so
// the next expiry is December's last Tuesday.
ok("19:00 UTC on 23 Nov is already 24 Nov in IST", istYmd("2026-11-23T19:00:00Z") === "2026-11-24");
const rolled = getCalendar("2026-11-23T19:00:00Z");
ok("IST rolls a passed November expiry forward to 29 Dec 2026",
  rolled.expiry.date === "2026-12-29" && rolled.expiry.via === "nse-calendar",
  JSON.stringify(rolled.expiry));
ok("the same instant still sees November when read as a UTC civil date would",
  istYmd("2026-11-23T18:00:00Z") === "2026-11-23");
const stillNov = getCalendar("2026-11-23T18:00:00Z");
ok("18:00 UTC on 23 Nov is still the November expiry in IST",
  stillNov.expiry.date === "2026-11-23" && stillNov.expiry.daysAway === 0,
  JSON.stringify(stillNov.expiry));

// 2026-07-28 20:00 UTC is 01:30 IST on 29 Jul. The RBI/FOMC rows are civil dates;
// the July event is today, not yesterday.
const aroundEvent = getCalendar("2026-07-28T20:00:00Z", 45);
ok("event dates are IST civil dates",
  aroundEvent.events.some((e) => e.date === "2026-07-29" && e.daysAway === 0)
  && aroundEvent.events.some((e) => e.date === "2026-08-05"),
  JSON.stringify(aroundEvent.events));

// ── Listed NIFTY future overlays the computed next expiry ───────────────────
// Computed November expiry is the 23rd. A listed contract on the 20th must win,
// which is how a master holiday the static list missed still reaches the UI.
globalThis.__LISTED_NIFTY__ = { expiryDate: "2026-11-20", expiry: Date.parse("2026-11-20T18:29:00Z") };
const over = getCalendar("2026-11-19T08:00:00Z");
ok("a loaded NIFTY future replaces the computed next expiry",
  over.expiry.date === "2026-11-20" && over.expiry.via === "nifty-future"
  && monthlyFoExpiry(2026, 11) === "2026-11-23",
  JSON.stringify(over.expiry));

globalThis.__LISTED_NIFTY__ = null;
globalThis.__NIFTY_CHAIN__ = [
  { expiryDate: "2026-12-28", expiry: Date.parse("2026-12-28T18:29:00Z") },
];
ok("playbook hold uses the listed contract for that month",
  listedNiftyExpiryFor(2026, 12) === "2026-12-28");
ok("a month the master does not list stays on the calendar",
  listedNiftyExpiryFor(2026, 3) === null && monthlyFoExpiry(2026, 3) === "2026-03-30");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
