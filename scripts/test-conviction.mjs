// Unit checks for the Playbook conviction engine. Run: npm run test:conviction
//
// Same .mjs copy trick as test-levels: the lib is ESM but package.json has no
// "type": "module", so bare node would parse it as CommonJS.
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, ".conviction.tmp.mjs");
cpSync(join(here, "..", "app", "lib", "conviction.js"), tmp);
process.on("exit", () => {
  try { rmSync(tmp); } catch {}
});

const {
  scoreEdge, scoreStructure, scoreTiming, convictionOf, bandOf,
  reasonsFor, buildPlaybook, allocateCapital, GATES,
} = await import(tmp);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// ── Fixtures ────────────────────────────────────────────────────────────────
const strongRank = {
  win_rate: 94.1, median_return: 8.19, positive_years: 16, negative_years: 1,
  sig: { significant: true, p: 0.0003, n: 17 },
};
const weakRank = {
  win_rate: 66, median_return: 1.2, positive_years: 4, negative_years: 2,
  sig: { significant: false, p: 0.41, n: 6 },
};
const primeFloor = {
  tier: "PRIME", floor: { touches: 14 }, bounceRate: 0.57, bounceSamples: 7, rsi: 35,
};
const goodLevels = {
  entry: { price: 1000 }, stop: { price: 930, pct: 7, anchorPrice: 959, exceedsSeasonalRisk: false },
  target: { price: 1090, pct: 9 }, riskReward: 2.4, lotSize: 100,
};

// ── EDGE ────────────────────────────────────────────────────────────────────
const e1 = scoreEdge(strongRank);
const e2 = scoreEdge(weakRank);
ok("strong seasonality scores high", e1.score >= 85, `got ${e1.score}`);
ok("weak seasonality scores low", e2.score <= 30, `got ${e2.score}`);
ok("edge explains itself", e1.notes.some((n) => /win rate/.test(n)) && e1.notes.some((n) => /significant/.test(n)),
   JSON.stringify(e1.notes));
ok("edge counts years", e1.years === 17, `got ${e1.years}`);
ok("missing rankings row scores 0", scoreEdge(null).score === 0);

// Significance must matter but not dominate: same stock, sig removed.
const noSig = scoreEdge({ ...strongRank, sig: { significant: false, p: 0.4 } });
ok("significance is worth 15, not the whole score", e1.score - noSig.score === 15,
   `${e1.score} vs ${noSig.score}`);

// ── STRUCTURE ───────────────────────────────────────────────────────────────
const s1 = scoreStructure(primeFloor, goodLevels);
const s2 = scoreStructure(null, goodLevels);
ok("prime floor scores high", s1.score >= 85, `got ${s1.score}`);
ok("no swing-low row caps structure low", s2.score <= 25, `got ${s2.score}`);
ok("structure cites the floor", s1.notes.some((n) => /tested 14 times/.test(n)), JSON.stringify(s1.notes));
ok("bounce rate rendered as a percentage, not a ratio",
   s1.notes.some((n) => /bounced 57%/.test(n)), JSON.stringify(s1.notes));
ok("structure knows whether swing-low saw it", s1.inSwingLow === true && s2.inSwingLow === false);

// ── TIMING ──────────────────────────────────────────────────────────────────
const t1 = scoreTiming({ result: "PASS", passCount: 4, totalChecks: 4 }, goodLevels, { momentum: 1.5 });
const t2 = scoreTiming({ result: "FAIL", passCount: 1, totalChecks: 4 }, goodLevels, { momentum: -9 });
ok("passing checklist + near support scores high", t1.score >= 80, `got ${t1.score}`);
ok("failing checklist + falling knife scores low", t2.score <= 50, `got ${t2.score}`);
// Whenever the support-distance component scores, it must explain itself —
// the exact wording tightens as the stock gets closer.
ok("timing explains the distance to support",
   t1.notes.some((n) => /above its support/.test(n)), JSON.stringify(t1.notes));
ok("wording tightens right at support",
   scoreTiming({ result: "PASS" }, { ...goodLevels, stop: { ...goodLevels.stop, anchorPrice: 990 } }, {})
     .notes.some((n) => /right on its support/.test(n)));

// ── BLEND ───────────────────────────────────────────────────────────────────
const cAll = convictionOf({ edge: e1, structure: s1, timing: t1, sources: 3 });
const cOne = convictionOf({ edge: e1, structure: s1, timing: t1, sources: 1 });
ok("confluence across 3 screeners beats 1", cAll > cOne, `${cAll} vs ${cOne}`);
ok("confluence bonus is modest (<=10%)", cAll / cOne <= 1.1001, `ratio ${(cAll / cOne).toFixed(3)}`);
ok("conviction never exceeds 100", cAll <= 100, `got ${cAll}`);
ok("a weak name stays low",
   convictionOf({ edge: e2, structure: s2, timing: t2, sources: 1 }) < GATES.minConviction);
ok("bands map correctly",
   bandOf(80) === "HIGH" && bandOf(65) === "GOOD" && bandOf(50) === "FAIR" && bandOf(20) === "LOW");

// ── REASONS ─────────────────────────────────────────────────────────────────
const rs = reasonsFor({ edge: e1, structure: s1, timing: t1, levels: goodLevels, sources: 3 });
ok("confluence is the headline reason", /all three screeners/.test(rs[0]), rs[0]);
ok("reasons are capped at 6", rs.length <= 6, `got ${rs.length}`);
const rsRisk = reasonsFor({
  edge: e1, structure: s1, timing: t1, sources: 1,
  levels: { ...goodLevels, stop: { ...goodLevels.stop, exceedsSeasonalRisk: true, pct: 12, seasonalRiskNormPct: 8 } },
});
ok("an oversized stop is called out", rsRisk.some((r) => /size down/.test(r)), JSON.stringify(rsRisk));

// ── GATES ───────────────────────────────────────────────────────────────────
const mk = (symbol, conviction, over = {}) => ({
  symbol, conviction, edge: { years: 17 }, levels: goodLevels, ...over,
});
const pb = buildPlaybook([
  mk("GOOD1", 82), mk("GOOD2", 71), mk("GOOD3", 64),
  mk("THIN", 80, { edge: { years: 3 } }),
  mk("NOLEVELS", 78, { levels: null }),
  mk("BADRR", 77, { levels: { ...goodLevels, riskReward: 0.9 } }),
  mk("NOUPSIDE", 76, { levels: { ...goodLevels, target: { price: 990, pct: -1 } } }),
  mk("LOWCONV", 30),
], { top: 6 });

ok("only qualifying trades are picked", pb.picks.map((p) => p.symbol).join(",") === "GOOD1,GOOD2,GOOD3",
   pb.picks.map((p) => p.symbol).join(","));
ok("picks are ordered by conviction", pb.picks[0].conviction >= pb.picks[1].conviction);
const why = Object.fromEntries(pb.rejected.map((r) => [r.symbol, r.why.join("; ")]));
ok("thin history rejected with a reason", /only 3y/.test(why.THIN), why.THIN);
ok("missing levels rejected", /no live price levels/.test(why.NOLEVELS), why.NOLEVELS);
ok("poor reward:risk rejected", /reward:risk/.test(why.BADRR), why.BADRR);
ok("no upside rejected", /no upside/.test(why.NOUPSIDE), why.NOUPSIDE);
ok("low conviction rejected", /conviction 30/.test(why.LOWCONV), why.LOWCONV);
ok("top-N respected", buildPlaybook([mk("A", 90), mk("B", 89), mk("C", 88)], { top: 2 }).picks.length === 2);

// A rejection has to carry the plan it would have been, or the list is just a
// verdict you can't argue with.
const rejBadRR = pb.rejected.find((r) => r.symbol === "BADRR");
ok("rejections carry their levels", rejBadRR.levels?.entry?.price === 1000, JSON.stringify(rejBadRR.levels?.entry));
ok("rejections carry conviction and lot size",
   rejBadRR.conviction === 77 && rejBadRR.levels.lotSize === 100);
ok("rejections are ordered by conviction",
   pb.rejected.every((r, i) => i === 0 || pb.rejected[i - 1].conviction >= r.conviction));
// A stock with no levels at all still has to appear, just without a plan.
ok("a levels-less rejection survives", pb.rejected.find((r) => r.symbol === "NOLEVELS").levels === null);

// ── CAPITAL — risk-based sizing ─────────────────────────────────────────────
// Lots come from what a trade LOSES at its stop, not from what margin it ties
// up. Margin is a leveraged number: Rs3L of it can carry Rs37L of contract, so
// sizing on margin can put a third of the account at risk while the screen
// cheerfully reports "24% deployed".

// goodLevels risks (1000-930) x 100 = Rs7,000/lot. On Rs10,00,000 of capital
// that is 0.7% — comfortably inside a 2% per-trade budget.
const alloc = allocateCapital(
  [mk("A", 82), mk("B", 78), mk("C", 62), mk("D", 61)],
  { capital: 1000000, reserve: 100000, avgLotCost: 150000, riskPerTradePct: 2, maxPortfolioRiskPct: 6 },
);
ok("usable capital = capital - reserve", alloc.usable === 900000, `got ${alloc.usable}`);
ok("risk per lot is computed from the stop", alloc.positions[0].riskPerLot === 7000,
   `got ${alloc.positions[0].riskPerLot}`);
ok("risk per lot reported as % of capital", alloc.positions[0].riskPerLotPct === 0.7,
   `got ${alloc.positions[0].riskPerLotPct}`);
ok("high conviction still earns 2 lots when risk allows", alloc.positions[0].lots === 2,
   `got ${alloc.positions[0].lots}`);
ok("budget headroom is reported",
   alloc.portfolioBudget === 60000 && alloc.perTradeBudget === 20000,
   `${alloc.perTradeBudget}/${alloc.portfolioBudget}`);
ok("total risk stays inside the portfolio budget", alloc.totalRisk <= alloc.portfolioBudget,
   `${alloc.totalRisk} > ${alloc.portfolioBudget}`);

// A WIDE stop is the case that matters. Real example: TVSMOTOR risked
// Rs1,81,524 on one lot — 12% of a Rs15L account — and margin-based sizing
// waved it through.
const wide = allocateCapital(
  [{ symbol: "TVS", conviction: 82, edge: { years: 17 },
     levels: { entry: { price: 4307 }, stop: { price: 4048, pct: 6 },
               target: { price: 4660, pct: 8 }, riskReward: 1.4, lotSize: 700 } }],
  { capital: 1500000, reserve: 250000, avgLotCost: 150000 },
);
ok("a stop that risks 12% of the account is refused",
   wide.positions[0].lots === 0, `got ${wide.positions[0].lots} lots`);
ok("...and says why", wide.positions[0].cappedBy === "per-trade risk",
   `got ${wide.positions[0].cappedBy}`);
ok("...and is flagged as too risky outright", wide.positions[0].tooRisky === true);
ok("...and appears in the tooRisky list", wide.tooRisky.includes("TVS"));
// A refusal has to be actionable, not a dead end.
ok("...and says what capital it would need",
   wide.positions[0].capitalNeededForOneLot === Math.round((181300 / 5) * 100),
   `got ${wide.positions[0].capitalNeededForOneLot}`);
ok("refusing it keeps total risk at zero", wide.totalRisk === 0);

// Raising the per-trade limit should let it through — the budget is the knob,
// not the stop.
const loosened = allocateCapital(
  [{ symbol: "TVS", conviction: 82, edge: { years: 17 },
     levels: { entry: { price: 4307 }, stop: { price: 4048, pct: 6 },
               target: { price: 4660, pct: 8 }, riskReward: 1.4, lotSize: 700 } }],
  { capital: 1500000, reserve: 250000, avgLotCost: 150000, riskPerTradePct: 15, maxPortfolioRiskPct: 20 },
);
ok("a wider per-trade limit lets it through", loosened.positions[0].lots >= 1,
   `got ${loosened.positions[0].lots}`);

// The portfolio ceiling has to bind across positions, not just within one.
const many = allocateCapital(
  [mk("A", 82), mk("B", 82), mk("C", 82), mk("D", 82), mk("E", 82), mk("F", 82)],
  { capital: 1000000, reserve: 0, avgLotCost: 50000, maxPortfolioRiskPct: 3 },
);
ok("portfolio risk cap binds across positions", many.totalRisk <= 30000,
   `total risk ${many.totalRisk} > budget 30000`);
ok("later positions get cut once the budget is spent",
   many.positions[many.positions.length - 1].lots <= many.positions[0].lots);
ok("something reports being capped by portfolio risk",
   many.positions.some((p) => p.cappedBy === "portfolio risk"),
   many.positions.map((p) => p.cappedBy).join(","));

// Margin remains the final ceiling even when risk is tiny.
const tightMargin = allocateCapital(
  [mk("A", 82)],
  { capital: 1000000, reserve: 900000, avgLotCost: 150000 },
);
ok("margin still caps when capital runs out", tightMargin.positions[0].lots === 0,
   `got ${tightMargin.positions[0].lots}`);
ok("...and says margin was the binding limit", tightMargin.positions[0].cappedBy === "margin",
   `got ${tightMargin.positions[0].cappedBy}`);

ok("notional is the sum of per-position notionals",
   alloc.notional === alloc.positions.reduce((a, p) => a + p.notional, 0));
ok("account risk % is reported", alloc.riskPctOfCapital > 0 && alloc.riskPctOfCapital < 100,
   `got ${alloc.riskPctOfCapital}`);
ok("risk budget usage is reported", alloc.riskBudgetUsedPct > 0 && alloc.riskBudgetUsedPct <= 100,
   `got ${alloc.riskBudgetUsedPct}`);

// Zero capital must not crash, allocate, or divide by zero.
const broke = allocateCapital([mk("A", 90)], { capital: 0, reserve: 0, avgLotCost: 150000 });
ok("zero capital allocates nothing", broke.deployed === 0 && broke.positions[0].lots === 0);
ok("zero capital reports 0% risk", broke.riskPctOfCapital === 0);
ok("zero capital doesn't produce NaN", Number.isFinite(broke.riskBudgetUsedPct));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
