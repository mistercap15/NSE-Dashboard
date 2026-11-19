// Unit checks for the t-test and the Benjamini-Hochberg adjustment layered on it.
// Run: node scripts/test-stats.mjs
//
// A month tests ~180 symbols. An unadjusted p < 0.05 will crown a few of them
// by chance. The q-value is the family-wise correction; `significant` stays the
// single-test flag and `significantFdr` is the one that survives the month.
//
// Same .mjs copy trick as the other suites.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, ".stats.tmp");
mkdirSync(tmp, { recursive: true });
process.on("exit", () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

cpSync(join(here, "..", "app", "lib", "stats.js"), join(tmp, "stats.mjs"));
const {
  significance,
  benjaminiHochberg,
  applyBenjaminiHochberg,
  returnsForMonth,
} = await import(join(tmp, "stats.mjs"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

// ── BH q-values, hand-worked ─────────────────────────────────────────────────
// p = [0.01, 0.04, 0.03], m = 3. Sorted 0.01, 0.03, 0.04.
// q from the right: 0.04, min(0.045, 0.04)=0.04, min(0.03, 0.04)=0.03.
const three = benjaminiHochberg([0.01, 0.04, 0.03]);
ok("q follows the input order",
  near(three[0].q, 0.03) && near(three[1].q, 0.04) && near(three[2].q, 0.04),
  three.map((x) => x.q).join(","));
ok("all three survive FDR at 0.05", three.every((x) => x.significantFdr));

// One modest p buried in nine nulls. Unadjusted it is "significant"; the
// family q is 0.40, so FDR does not agree.
const buried = benjaminiHochberg([0.04, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
ok("a lone p=0.04 is not FDR-significant among 10 tests",
  near(buried[0].q, 0.4) && buried[0].significantFdr === false,
  `q=${buried[0].q}`);
ok("the nulls keep q=0.5", buried.slice(1).every((x) => near(x.q, 0.5) && !x.significantFdr));

// q is monotone in the sorted p-values, and never below the raw p.
const messy = [0.2, 0.001, 0.04, 0.9, 0.03, 1, 0.5];
const adj = benjaminiHochberg(messy);
const sorted = messy.map((p, i) => ({ p, q: adj[i].q })).sort((a, b) => a.p - b.p);
ok("q is non-decreasing in p", sorted.every((row, i) => i === 0 || row.q >= sorted[i - 1].q - 1e-12));
ok("q is at least the raw p and at most 1",
  adj.every((row, i) => row.q >= messy[i] - 1e-12 && row.q <= 1));

ok("an empty family adjusts nothing", benjaminiHochberg([]).length === 0);
ok("a single p=0.04 has q=0.04", near(benjaminiHochberg([0.04])[0].q, 0.04)
  && benjaminiHochberg([0.04])[0].significantFdr);
ok("a non-finite p is treated as 1", near(benjaminiHochberg([NaN])[0].q, 1));

// ── Unadjusted p stays beside the q-value ────────────────────────────────────
const series = applyBenjaminiHochberg([
  { p: 0.01, significant: true, n: 10 },
  { p: 0.04, significant: true, n: 10 },
  { p: 0.03, significant: true, n: 10 },
]);
ok("apply keeps the unadjusted p and significant flag",
  series[0].p === 0.01 && series[0].significant === true
  && series[1].p === 0.04 && near(series[1].q, 0.04) && series[1].significantFdr);
ok("significance() itself does not invent a q-value",
  !("q" in significance([1, 2, 3, 4, 5])) && !("significantFdr" in significance([1, 2, 3, 4, 5])));

// A clearly positive series is significant on its own. That flag is p < 0.05,
// not the family decision.
const strong = significance([4, 5, 6, 3, 7, 5, 4, 6]);
ok("unadjusted significance is still p < 0.05",
  strong.significant === true && strong.p < 0.05 && strong.p > 0, `p=${strong.p}`);

// ── The in-progress month is not a data point ────────────────────────────────
const points = [
  { ym: "2024-11", year: 2024, month: 11, ret: 5 },
  { ym: "2025-11", year: 2025, month: 11, ret: -2 },
  { ym: "2026-11", year: 2026, month: 11, ret: -9 }, // still trading
  { ym: "2026-12", year: 2026, month: 12, ret: 8 },  // not this month, and later
  { ym: "2026-10", year: 2026, month: 10, ret: 3 },
  { ym: "2019-11", year: 2019, month: 11, ret: 900 }, // corporate-action junk
];
const nov = returnsForMonth(points, 11, "2026-11");
ok("November drops the open month and the junk print",
  nov.length === 2 && nov.includes(5) && nov.includes(-2) && !nov.includes(-9) && !nov.includes(900),
  JSON.stringify(nov));
ok("October of the same year is already closed",
  returnsForMonth(points, 10, "2026-11").length === 1);
ok("no cutoff keeps every sane November",
  returnsForMonth(points, 11).length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
