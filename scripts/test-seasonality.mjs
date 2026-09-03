// Unit checks for seasonality recomputed from monthly prices.
// Run: npm run test:seasonality
//
// The bug this pins, found 2 Sep 2026: the MCP's seasonality block counts the
// CURRENT, IN-PROGRESS month as a completed year. TIINDIA's September came back
// 7 positive / 2 negative over 9 years (77.8%), where the ninth "year" was
// 2026-09 at -1.6% — two days of trading scored as a losing September. The
// rankings page reads a different tool that excludes it and showed 87.5%, so
// the same stock showed 88% on one screen and 78% on another.
//
// Same .mjs copy trick as the other suites: the lib is ESM but package.json has
// no "type": "module", so bare node would parse it as CommonJS.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..", "app", "lib");
const tmp = join(here, ".seasonality.tmp");
mkdirSync(tmp, { recursive: true });
process.on("exit", () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

cpSync(join(lib, "date.js"), join(tmp, "date.mjs"));
writeFileSync(join(tmp, "s.mjs"),
  readFileSync(join(lib, "seasonalityFromPrices.js"), "utf8")
    .replace('from "./date"', 'from "./date.mjs"'));

const { seasonalityFromPrices, isCurrentMonth } = await import(join(tmp, "s.mjs"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// IST "now", so the fixtures do not drift as real time passes.
const now = new Date();
const istParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "numeric",
}).formatToParts(now);
const curM = Number(istParts.find(p => p.type === "month").value);
const curY = Number(istParts.find(p => p.type === "year").value);
const pad = (n) => String(n).padStart(2, "0");

// ── The exact TIINDIA September case ────────────────────────────────────────
const tiindia = [
  { date: "2017-11", return_pct: null },          // first row: no prior close
  { date: "2018-09", return_pct: 0.44 },
  { date: "2019-09", return_pct: 13.67 },
  { date: "2020-09", return_pct: -6.73 },
  { date: "2021-09", return_pct: 2.36 },
  { date: "2022-09", return_pct: 21.22 },
  { date: "2023-09", return_pct: 3.03 },
  { date: "2024-09", return_pct: 7.57 },
  { date: "2025-09", return_pct: 4.56 },
  { date: `${curY}-${pad(curM)}`, return_pct: -1.6 },   // the in-progress month
];
const sep = seasonalityFromPrices(tiindia).find(m => m.month_num === 9);

if (curM === 9) {
  ok("TIINDIA Sep: the in-progress month is excluded", sep.data_points === 8,
     `n=${sep?.data_points}`);
  ok("TIINDIA Sep: 7 positive / 1 negative",
     sep.positive_years === 7 && sep.negative_years === 1,
     `${sep?.positive_years}/${sep?.negative_years}`);
  ok("TIINDIA Sep: win rate is 87.5, matching /rankings — not 77.8",
     sep.win_rate === 87.5, `got ${sep?.win_rate}`);
} else {
  // Outside September the partial row lands in another month; the eight closed
  // Septembers must still stand on their own.
  ok("TIINDIA Sep: eight closed Septembers", sep.data_points === 8, `n=${sep?.data_points}`);
  ok("TIINDIA Sep: win rate 87.5", sep.win_rate === 87.5, `got ${sep?.win_rate}`);
}

ok("a null return is not counted as a flat month",
   !seasonalityFromPrices(tiindia).some(m => m.month_num === 11));

// ── The definition of a win: > 0, with no tolerance ─────────────────────────
const thresholdProbe = [
  { date: "2019-04", return_pct: 5 },
  { date: "2020-04", return_pct: -0.01 },   // a loss, however small
  { date: "2021-04", return_pct: -4.9 },    // inside a -5% band, still a loss
  { date: "2022-04", return_pct: 0 },       // exactly flat is NOT a win
];
const apr = seasonalityFromPrices(thresholdProbe).find(m => m.month_num === 4);
ok("a win is strictly return > 0 — no -5% tolerance",
   apr.positive_years === 1 && apr.negative_years === 3, `${apr?.positive_years}/${apr?.negative_years}`);
ok("exactly 0.00% is not a win", apr.win_rate === 25, `got ${apr?.win_rate}`);

// ── Statistics ──────────────────────────────────────────────────────────────
const statProbe = [
  { date: "2019-06", return_pct: -10 },
  { date: "2020-06", return_pct: 2 },
  { date: "2021-06", return_pct: 4 },
  { date: "2022-06", return_pct: 20 },
];
const jun = seasonalityFromPrices(statProbe).find(m => m.month_num === 6);
ok("best / worst are the extremes", jun.best === 20 && jun.worst === -10);
ok("median of an even sample is the midpoint", jun.median_return === 3, `got ${jun?.median_return}`);
ok("average is the mean", jun.avg_return === 4, `got ${jun?.avg_return}`);

// ── Shape: the UI and the mobile app read these keys ────────────────────────
const keys = ["month", "month_num", "win_rate", "avg_return", "median_return",
              "positive_years", "negative_years", "best", "worst", "data_points"];
ok("row shape matches what the MCP returned", keys.every(k => k in jun),
   `missing ${keys.filter(k => !(k in jun)).join(",")}`);
ok("month label is the three-letter abbreviation", jun.month === "Jun", jun.month);

// ── Months with no completed history are omitted, not zeroed ────────────────
ok("a month with only an in-progress reading is omitted",
   !seasonalityFromPrices([{ date: `${curY}-${pad(curM)}`, return_pct: 3 }])
      .some(m => m.month_num === curM));

// ── isCurrentMonth ──────────────────────────────────────────────────────────
ok("isCurrentMonth is true for this IST month", isCurrentMonth(`${curY}-${pad(curM)}`));
ok("isCurrentMonth is false for the same month last year",
   !isCurrentMonth(`${curY - 1}-${pad(curM)}`));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
