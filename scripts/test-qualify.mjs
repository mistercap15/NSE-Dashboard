// Unit checks for the qualifier layer. Run: npm run test:qualify
//
// Same .mjs copy trick as the other test scripts: the lib is ESM but
// package.json has no "type": "module", so bare node parses it as CommonJS.
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, ".qualify.tmp.mjs");
cpSync(join(here, "..", "app", "lib", "qualify.js"), tmp);
process.on("exit", () => {
  try { rmSync(tmp); } catch {}
});

const { qualify, turnoverProfile, daysBetween, promoterActivity, LIQUIDITY } = await import(tmp);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const TODAY = "2026-08-15";
const cand = { symbol: "TEST" };

/** Liquid candles: 120 days at ₹1,000 × 50,000 shares = ₹5cr/day. */
const liquidCandles = (n = 120, vol = 50000, close = 1000) =>
  Array.from({ length: n }, () => ({ close, volume: vol }));

const ctx = (over = {}) => ({
  candles: liquidCandles(),
  filings: null,
  today: TODAY,
  holdEndsOn: "2026-09-24",
  ...over,
});

// ── Date helper ─────────────────────────────────────────────────────────────
ok("daysBetween counts forward", daysBetween("2026-08-15", "2026-08-25") === 10);
ok("daysBetween goes negative backwards", daysBetween("2026-08-25", "2026-08-15") === -10);
ok("daysBetween is null on junk", daysBetween("nonsense", TODAY) === null);
ok("daysBetween is null on missing", daysBetween(null, TODAY) === null);

// ── Fail-open contract: the single most important property here ─────────────
const empty = qualify(cand, { today: TODAY });
ok("no data at all → no rejects", empty.rejects.length === 0, JSON.stringify(empty.rejects));
ok("no data at all → no warnings", empty.warnings.length === 0);

const noFilings = qualify(cand, ctx({ filings: null }));
ok("liquid but no filings → clean", noFilings.rejects.length === 0 && noFilings.warnings.length === 0);

const emptyFilings = qualify(cand, ctx({ filings: { pit: [], holding: [], announcements: [], boardMeetings: [], resultsHistory: [] } }));
ok("empty filing arrays → clean", emptyFilings.rejects.length === 0 && emptyFilings.warnings.length === 0);

// ── Liquidity ───────────────────────────────────────────────────────────────
const tp = turnoverProfile(liquidCandles());
ok("turnover uses traded VALUE not share count", tp.recent === 1000 * 50000, `got ${tp.recent}`);
ok("turnover is null on short history", turnoverProfile(liquidCandles(30)) === null);
ok("turnover is null on junk", turnoverProfile(null) === null);

// ₹50 × 10,000 = ₹5 lakh/day, well under the ₹2cr floor.
const thin = qualify(cand, ctx({ candles: liquidCandles(120, 10000, 50) }));
ok("illiquid name is rejected", thin.rejects.some((r) => r.code === "illiquid"), JSON.stringify(thin.rejects));
ok("...and says why in rupees", thin.rejects.some((r) => /cr traded a day/.test(r.message)));

// Was ₹15cr/day, now ₹4cr/day → ratio 0.27. Both sides stay above the ₹2cr
// absolute floor on purpose, so this tests the RELATIVE rule in isolation.
const collapsing = [...liquidCandles(100, 150000), ...liquidCandles(20, 40000)];
const dried = qualify(cand, ctx({ candles: collapsing }));
ok("collapsed turnover is rejected", dried.rejects.some((r) => r.code === "liquidity_collapse"),
   JSON.stringify(dried.rejects));

// VEDL's real case: turnover fell 65%, but to Rs 334cr/day. Still deeply
// liquid, so the relative rule must stay quiet.
const hugeButQuieter = [
  ...liquidCandles(100, 4000000, 250),  // ~Rs 100cr/day
  ...liquidCandles(20, 1200000, 250),   // ~Rs 30cr/day, ratio 0.30
];
ok("a big fall that is still hugely liquid does NOT reject",
   !qualify(cand, ctx({ candles: hugeButQuieter })).rejects.length,
   "Rs 30cr/day can absorb any exit");

// A 20% decline is normal drift and must not trip the gate.
const mildlyQuieter = [...liquidCandles(100, 50000), ...liquidCandles(20, 42000)];
ok("ordinary volume drift is not a rejection",
   !qualify(cand, ctx({ candles: mildlyQuieter })).rejects.some((r) => r.code === "liquidity_collapse"));

// ── Pledge invocation ───────────────────────────────────────────────────────
const promoterInvoke = { pit: [{ date: "2026-07-20", type: "pledge_invoke", who: "promoter", market: false, shares: 1, value: 1, pctAfter: 0 }] };
const invoked = qualify(cand, ctx({ filings: promoterInvoke }));
ok("promoter pledge invocation rejects", invoked.rejects.some((r) => r.code === "pledge_invoked"),
   JSON.stringify(invoked.rejects));

// The real snapshot's only two invocations belong to employees at HCLTECH and
// NAUKRI — cash-rich IT firms in no distress at all.
const employeeInvoke = { pit: [{ date: "2026-07-20", type: "pledge_invoke", who: "other", market: false, shares: 1, value: 1, pctAfter: 0 }] };
ok("EMPLOYEE pledge invocation does NOT reject",
   !qualify(cand, ctx({ filings: employeeInvoke })).rejects.some((r) => r.code === "pledge_invoked"));

const staleInvoke = { pit: [{ date: "2025-01-05", type: "pledge_invoke", who: "promoter", market: false, shares: 1, value: 1, pctAfter: 0 }] };
ok("a year-old invocation has expired",
   !qualify(cand, ctx({ filings: staleInvoke })).rejects.some((r) => r.code === "pledge_invoked"));

// ── Distress filings ────────────────────────────────────────────────────────
const auditorGone = { announcements: [{ date: "2026-07-01", category: "Resignation of Statutory Auditor", text: "auditor has resigned" }] };
ok("auditor RESIGNATION rejects",
   qualify(cand, ctx({ filings: auditorGone })).rejects.some((r) => r.code === "distress_filing"));

// Statutory rotation is mandatory in India -- HAL, Bharti Airtel and Cummins
// all filed one in the live snapshot, none of them in any distress.
const auditorRotation = { announcements: [{ date: "2026-07-01", category: "Change in Auditors", text: "informed the Exchange regarding Change in Auditors" }] };
ok("a routine auditor CHANGE does not reject",
   !qualify(cand, ctx({ filings: auditorRotation })).rejects.length);

// The killer bug: every Indian filing cites SEBI (LODR) in its boilerplate.
const contractWin = { announcements: [{ date: "2026-08-01", category: "Bagging/Receiving of orders/contracts", text: "Disclosure under Regulation 30 of SEBI (LODR) Regulations, 2015- Letter of Acceptance from East Central Railway" }] };
ok("a contract win citing SEBI boilerplate does NOT reject",
   !qualify(cand, ctx({ filings: contractWin })).rejects.length, "this rejected 180/181 names before");

// A small exchange fine is not distress.
const smallFine = { announcements: [{ date: "2026-08-01", category: "Action(s) taken or orders passed", text: "Imposition of fine by NSE for the quarter ended 31st March" }] };
ok("a routine exchange fine does not reject",
   !qualify(cand, ctx({ filings: smallFine })).rejects.length);

// NCLT appears in merger paperwork far more often than in insolvency.
const merger = { announcements: [{ date: "2026-08-01", category: "Scheme of Arrangement", text: "Scheme of Arrangement - NCLT convened meeting of shareholders" }] };
ok("a merger scheme mentioning NCLT does not reject",
   !qualify(cand, ctx({ filings: merger })).rejects.length);

const subsidiaryWindUp = { announcements: [{ date: "2026-08-01", category: "Winding up", text: "Update on voluntary liquidation & dissolution of a wholly owned subsidiary" }] };
ok("winding up a SUBSIDIARY does not reject",
   !qualify(cand, ctx({ filings: subsidiaryWindUp })).rejects.length);

const ownInsolvency = { announcements: [{ date: "2026-08-01", category: "Insolvency", text: "corporate insolvency resolution process initiated against the Company" }] };
ok("insolvency against the company ITSELF rejects",
   qualify(cand, ctx({ filings: ownInsolvency })).rejects.some((r) => r.code === "distress_filing"));

// NSE's licence category is named "Granting/withdrawal/surrender/cancellation/
// suspension of key licenses", so its own label contains every outcome word.
// Matching the refinement against category+text rejected four healthy financials.
const LICENCE_CAT = "Granting/withdrawal/surrender/cancellation/suspension of key licenses/ regulatory approvals";
const licenceGranted = { announcements: [{ date: "2026-08-01", category: LICENCE_CAT, text: "informed the Exchange about receipt of approval from Development Commissioner, GIFT SEZ and IFSCA" }] };
ok("a licence being GRANTED does not reject",
   !qualify(cand, ctx({ filings: licenceGranted })).rejects.length,
   "the category label alone must not satisfy the text refinement");

const licencePulled = { announcements: [{ date: "2026-08-01", category: LICENCE_CAT, text: "the Reserve Bank has cancelled the company's registration certificate" }] };
ok("a licence being CANCELLED rejects",
   qualify(cand, ctx({ filings: licencePulled })).rejects.some((r) => r.code === "distress_filing"));

const ratingRoutine = { announcements: [{ date: "2026-08-01", category: "Credit Rating", text: "rating reaffirmed at AA+ stable" }] };
ok("a routine rating reaffirmation does NOT reject",
   !qualify(cand, ctx({ filings: ratingRoutine })).rejects.length, "reaffirmations are not news");

const ratingCut = { announcements: [{ date: "2026-08-01", category: "Credit Rating", text: "rating downgrade to A- from AA" }] };
ok("a rating DOWNGRADE rejects",
   qualify(cand, ctx({ filings: ratingCut })).rejects.some((r) => r.code === "distress_filing"));

const oldDistress = { announcements: [{ date: "2025-06-01", category: "Resignation of Statutory Auditor", text: "x" }] };
ok("distress older than the window has expired",
   !qualify(cand, ctx({ filings: oldDistress })).rejects.length);

// ── Event window ────────────────────────────────────────────────────────────
const resultsSoon = { boardMeetings: [{ date: "2026-09-02", purpose: "Financial Results", desc: "approve Q2" }] };
const warned = qualify(cand, ctx({ filings: resultsSoon }));
ok("results inside the window warn", warned.warnings.some((w) => w.code === "earnings"), JSON.stringify(warned.warnings));
ok("...and never reject", warned.rejects.length === 0);

const resultsAfter = { boardMeetings: [{ date: "2026-11-20", purpose: "Financial Results", desc: "" }] };
ok("results beyond the exit do not warn",
   !qualify(cand, ctx({ filings: resultsAfter })).warnings.some((w) => w.code === "earnings"));

const resultsPast = { boardMeetings: [{ date: "2026-07-01", purpose: "Financial Results", desc: "" }] };
ok("results already past do not warn",
   !qualify(cand, ctx({ filings: resultsPast })).warnings.some((w) => w.code === "earnings"));

// ── Results cadence (the estimated fallback) ────────────────────────────────
// Quarterly reporter, last results 2026-05-20 → next due about 2026-08-19.
const cadence = { resultsHistory: ["2025-08-14", "2025-11-12", "2026-02-11", "2026-05-20"] };
const est = qualify(cand, ctx({ filings: cadence }));
ok("cadence estimates upcoming results", est.warnings.some((w) => w.code === "earnings_estimated"),
   JSON.stringify(est.warnings));
ok("...and is worded as an estimate", est.warnings.some((w) => /likely|overdue|cadence/.test(w.message)));

// A real intimation must suppress the guess rather than duplicate it.
const both = { ...cadence, boardMeetings: [{ date: "2026-09-02", purpose: "Financial Results", desc: "" }] };
const bothOut = qualify(cand, ctx({ filings: both }));
ok("a real intimation suppresses the estimate",
   bothOut.warnings.filter((w) => w.code === "earnings_estimated").length === 0);
ok("...and keeps the real one", bothOut.warnings.some((w) => w.code === "earnings"));

// Reported last month, next due in ~3 months — well past a 40-day hold.
const justReported = { resultsHistory: ["2025-08-14", "2025-11-12", "2026-02-11", "2026-08-10"] };
ok("a company that just reported does not warn",
   !qualify(cand, ctx({ filings: justReported })).warnings.some((w) => w.code === "earnings_estimated"));

ok("too little history to infer cadence stays silent",
   !qualify(cand, ctx({ filings: { resultsHistory: ["2026-05-20"] } })).warnings.length);

// ── Promoter stake trend ────────────────────────────────────────────────────
const falling = { holding: [
  { date: "2026-06-30", promoterPct: 48.2 },
  { date: "2026-03-31", promoterPct: 49.4 },
  { date: "2025-12-31", promoterPct: 50.1 },
] };
const fell = qualify(cand, ctx({ filings: falling }));
ok("a falling promoter stake warns", fell.warnings.some((w) => w.code === "stake_falling"), JSON.stringify(fell.warnings));
ok("...and never rejects", fell.rejects.length === 0);

const drift = { holding: [
  { date: "2026-06-30", promoterPct: 50.01 },
  { date: "2026-03-31", promoterPct: 50.08 },
  { date: "2025-12-31", promoterPct: 50.13 },
] };
ok("sub-point drift is not a warning (RELIANCE's real pattern)",
   !qualify(cand, ctx({ filings: drift })).warnings.some((w) => w.code === "stake_falling"));

const rising = { holding: [
  { date: "2026-06-30", promoterPct: 51.5 },
  { date: "2026-03-31", promoterPct: 50.4 },
  { date: "2025-12-31", promoterPct: 49.9 },
] };
ok("a rising stake never warns",
   !qualify(cand, ctx({ filings: rising })).warnings.some((w) => w.code === "stake_falling"));

// ── Promoter activity (shadow) ──────────────────────────────────────────────
const activity = promoterActivity({ pit: [
  { date: "2026-07-10", type: "buy",  who: "promoter", market: true,  shares: 1000, value: 5000000, pctAfter: 0 },
  { date: "2026-07-12", type: "buy",  who: "promoter", market: true,  shares: 500,  value: 2500000, pctAfter: 0 },
  { date: "2026-07-15", type: "sell", who: "promoter", market: true,  shares: 200,  value: 1000000, pctAfter: 0 },
  { date: "2026-07-16", type: "buy",  who: "other",    market: true,  shares: 900,  value: 9000000, pctAfter: 0 },
  { date: "2026-07-17", type: "buy",  who: "promoter", market: false, shares: 900,  value: 9000000, pctAfter: 0 },
] }, TODAY);
ok("shadow counts only promoter open-market buys", activity.buys === 2, `got ${activity.buys}`);
ok("shadow excludes employee buys and off-market transfers", activity.buyValue === 7500000, `got ${activity.buyValue}`);
ok("shadow nets buys against sells", activity.netValue === 6500000, `got ${activity.netValue}`);
ok("shadow is labelled as shadow", activity.shadow === true);
ok("shadow is null when there's nothing to show", promoterActivity({ pit: [] }, TODAY) === null);
ok("shadow is null on missing data", promoterActivity(null, TODAY) === null);

// ── A broken qualifier must not take the Playbook down ──────────────────────
const hostile = qualify(cand, { candles: [{ close: null, volume: undefined }], filings: { pit: "not an array", holding: 42 }, today: TODAY });
ok("hostile input produces no crash and no rejects", hostile.rejects.length === 0, JSON.stringify(hostile.rejects));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
