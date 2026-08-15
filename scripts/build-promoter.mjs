// ─────────────────────────────────────────────────────────────────────────────
// Promoter & filings collector → data/promoter.json
//
//   node scripts/build-promoter.mjs
//
// WHY THIS IS AN OFFLINE SCRIPT AND NOT AN API ROUTE.
// NSE blocks datacenter traffic. Requests from Vercel fail intermittently and
// silently, which is the worst possible failure mode for something that gates a
// trade. So this runs on a residential connection, like refresh-data, and the
// snapshot is committed. Nothing here is fast-moving — shareholding is
// quarterly and filings trickle in over days — so a daily snapshot loses
// nothing versus a live call.
//
// Like the other scripts in here it does NOT import app/lib/*.js: those are ESM
// transpiled by Next, and a plain Node run can't read their named exports.
//
// Four sources, all official exchange filings:
//   1. corporates-pit          insider/promoter trades   (per symbol)
//   2. corporate-share-holdings-master  quarterly stake   (per symbol)
//   3. corporate-announcements universe-wide filings      (one sweep)
//   4. corporate-board-meetings FORTHCOMING meetings      (one sweep)
//
// (4) is deliberately separate from (3). The announcements feed carries
// "Outcome of Board Meeting" — results that have ALREADY been declared, which
// is backwards for a gate meant to warn about an earnings date landing inside
// an open position. The board-meetings endpoint carries real forward dates.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UNIVERSE = join(ROOT, "data", "universe.json");
const OUT = join(ROOT, "data", "promoter.json");

const BASE = "https://www.nseindia.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const PIT_DAYS = 400;   // ~13 months of insider filings
const ANN_DAYS = 120;   // announcements only matter for the current window
const BM_DAYS = 75;         // forthcoming board meetings, comfortably past one expiry
const BM_HISTORY_DAYS = 450; // past results meetings, for learning each name's cadence
const CONCURRENCY = 3;  // NSE is rate-sensitive; politeness beats speed here
const RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ddmmyyyy = (d) =>
  `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

// ── Session ──────────────────────────────────────────────────────────────────
// NSE hands out cookies on the HTML pages and rejects bare API calls without
// them. It also 403s the homepage itself sometimes; that's fine, the Set-Cookie
// still arrives, so the status is deliberately not checked.
let COOKIE = "";

async function primeSession() {
  const pages = ["/", "/companies-listing/corporate-filings-insider-trading"];
  for (const p of pages) {
    try {
      const res = await fetch(BASE + p, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
      });
      const set = res.headers.getSetCookie?.() ?? [];
      if (set.length) {
        const jar = new Map(COOKIE ? COOKIE.split("; ").map((c) => c.split("=").slice(0, 2)) : []);
        for (const c of set) {
          const [k, v] = c.split(";")[0].split("=");
          if (k && v) jar.set(k, v);
        }
        COOKIE = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      }
    } catch {
      /* keep whatever cookies we have */
    }
    await sleep(400);
  }
}

async function api(path, { referer = "/companies-listing/corporate-filings-insider-trading" } = {}) {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        headers: {
          "User-Agent": UA,
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: BASE + referer,
          ...(COOKIE ? { Cookie: COOKIE } : {}),
        },
      });
      if (res.status === 401 || res.status === 403) {
        await primeSession();
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === RETRIES - 1) throw e;
      await sleep(700 * (attempt + 1));
    }
  }
  return null;
}

async function pool(items, limit, worker) {
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try {
          await worker(item);
        } catch {
          /* a single symbol failing must not sink the run */
        }
        done++;
        if (done % 20 === 0) process.stdout.write(`   ${done}/${items.length}\n`);
        await sleep(250);
      }
    }),
  );
}

// ── Normalisers ──────────────────────────────────────────────────────────────
const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** "13-Feb-2026" → "2026-02-13". Returns null for anything unparseable. */
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function isoDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * Collapse NSE's person categories to the three that matter.
 *
 * "Promoter" and "Promoter Group" are the signal. Immediate relatives are
 * adjacent but noisy — in the RELIANCE sample they were 16 of 20 filings,
 * mostly tiny off-market transfers. Everything else is employees and is
 * dominated by mechanical ESOP vesting.
 */
function personClass(raw) {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("promoter")) return "promoter";
  if (s.includes("immediate relative")) return "relative";
  if (s.includes("director") || s.includes("key managerial")) return "insider";
  return "other";
}

/** Buy / Sell / Pledge / Pledge Revoke / Pledge Invoke → a small closed set. */
function txnClass(raw) {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("invoke")) return "pledge_invoke";
  if (s.includes("revoke")) return "pledge_revoke";
  if (s.includes("pledge")) return "pledge";
  if (s.includes("buy")) return "buy";
  if (s.includes("sell")) return "sell";
  return "other";
}

const isMarketMode = (raw) => /market/i.test(String(raw ?? "")) && !/off\s*market/i.test(String(raw ?? ""));

// ── Fetchers ─────────────────────────────────────────────────────────────────
async function fetchPit(symbol) {
  const from = ddmmyyyy(daysAgo(PIT_DAYS));
  const to = ddmmyyyy(new Date());
  const j = await api(
    `/api/corporates-pit?index=equities&symbol=${encodeURIComponent(symbol)}&from_date=${from}&to_date=${to}`,
  );
  const rows = j?.data ?? [];
  return rows
    .map((r) => ({
      date: isoDate(r.acqfromDt) || isoDate(r.intimDt) || isoDate(r.date),
      type: txnClass(r.tdpTransactionType),
      who: personClass(r.personCategory),
      market: isMarketMode(r.acqMode),
      shares: num(r.secAcq),
      value: num(r.secVal),
      pctAfter: num(r.afterAcqSharesPer),
    }))
    .filter((r) => r.date && r.type !== "other")
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

async function fetchHolding(symbol) {
  const j = await api(`/api/corporate-share-holdings-master?index=equities&symbol=${encodeURIComponent(symbol)}`, {
    referer: "/companies-listing/corporate-filings-shareholding-pattern",
  });
  const rows = Array.isArray(j) ? j : (j?.data ?? []);
  return rows
    .map((r) => ({ date: isoDate(r.date), promoterPct: num(r.pr_and_prgrp) }))
    .filter((r) => r.date && r.promoterPct > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 24); // the qualifier needs 3 quarters; the backtest wants all ~6 years
}

async function fetchAnnouncements() {
  const from = ddmmyyyy(daysAgo(ANN_DAYS));
  const to = ddmmyyyy(new Date());
  const j = await api(`/api/corporate-announcements?index=equities&from_date=${from}&to_date=${to}`, {
    referer: "/companies-listing/corporate-filings-announcements",
  });
  return Array.isArray(j) ? j : (j?.data ?? []);
}

/** Board meetings for an arbitrary window. */
async function fetchBoardMeetings(from, to) {
  const j = await api(
    `/api/corporate-board-meetings?index=equities&from_date=${ddmmyyyy(from)}&to_date=${ddmmyyyy(to)}`,
    { referer: "/companies-listing/corporate-filings-board-meetings" },
  );
  return Array.isArray(j) ? j : (j?.data ?? []);
}

/**
 * Past results meetings, swept in chunks.
 *
 * Companies only intimate a board meeting a week or two ahead, so the forward
 * feed is nearly empty between reporting seasons — 0 rows for Sep→Nov when
 * checked in mid-August. The PAST feed is dense (434 of our names in six
 * weeks), so the reliable way to know when results are due is to learn each
 * company's own cadence and project it forward.
 */
async function fetchResultsHistory(wanted) {
  const bySymbol = {};
  const chunks = Math.ceil(BM_HISTORY_DAYS / 45);
  for (let i = 0; i < chunks; i++) {
    const to = daysAgo(i * 45);
    const from = daysAgo(Math.min((i + 1) * 45, BM_HISTORY_DAYS));
    let rows = [];
    try {
      rows = await fetchBoardMeetings(from, to);
    } catch {
      continue; // a missing chunk narrows the estimate, it doesn't break it
    }
    for (const b of rows) {
      const sym = b.bm_symbol;
      if (!wanted.has(sym)) continue;
      if (!/financial result|quarterly result|audited result/i.test(`${b.bm_purpose} ${b.bm_desc}`)) continue;
      const date = isoDate(b.bm_date);
      if (!date) continue;
      (bySymbol[sym] ??= new Set()).add(date);
    }
    process.stdout.write(`   chunk ${i + 1}/${chunks}\n`);
    await sleep(500);
  }
  const out = {};
  for (const [k, set] of Object.entries(bySymbol)) {
    out[k] = [...set].sort().slice(-8); // oldest→newest, last two years
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const universe = JSON.parse(await readFile(UNIVERSE, "utf8"));
  const symbols = universe.symbols ?? Object.keys(universe.series ?? {});
  if (!symbols.length) throw new Error("no symbols in data/universe.json");

  console.log(`Promoter snapshot for ${symbols.length} symbols`);
  console.log("Priming NSE session…");
  await primeSession();
  if (!COOKIE) console.log("  (no cookies returned — continuing, NSE sometimes allows this)");

  // 1. Announcements: one sweep for the whole market.
  console.log(`\nAnnouncements (last ${ANN_DAYS}d)…`);
  let announcements = [];
  try {
    announcements = await fetchAnnouncements();
    console.log(`   ${announcements.length} filings`);
  } catch (e) {
    console.log(`   FAILED: ${e.message} — continuing without announcements`);
  }

  const wanted = new Set(symbols);
  const annBySymbol = {};
  for (const a of announcements) {
    const sym = a.symbol;
    if (!wanted.has(sym)) continue;
    const date = isoDate(a.an_dt) || (a.sort_date ? a.sort_date.slice(0, 10) : null);
    if (!date) continue;
    (annBySymbol[sym] ??= []).push({
      date,
      category: a.desc ?? "",
      text: String(a.attchmntText ?? "").slice(0, 260),
    });
  }
  for (const k of Object.keys(annBySymbol)) {
    annBySymbol[k].sort((a, b) => (a.date < b.date ? 1 : -1));
    annBySymbol[k] = annBySymbol[k].slice(0, 40);
  }

  // 1b. Forthcoming board meetings.
  console.log(`\nForthcoming board meetings (next ${BM_DAYS}d)…`);
  const bmBySymbol = {};
  try {
    const bms = await fetchBoardMeetings(new Date(), new Date(Date.now() + BM_DAYS * 86400000));
    for (const b of bms) {
      const sym = b.bm_symbol;
      if (!wanted.has(sym)) continue;
      const date = isoDate(b.bm_date);
      if (!date) continue;
      (bmBySymbol[sym] ??= []).push({
        date,
        purpose: String(b.bm_purpose ?? "").slice(0, 120),
        desc: String(b.bm_desc ?? "").slice(0, 200),
      });
    }
    for (const k of Object.keys(bmBySymbol)) bmBySymbol[k].sort((a, b) => (a.date < b.date ? -1 : 1));
    console.log(`   ${bms.length} meetings, ${Object.keys(bmBySymbol).length} in our universe`);
  } catch (e) {
    console.log(`   FAILED: ${e.message} — continuing without board meetings`);
  }

  // 1c. Past results meetings → each name's reporting cadence.
  console.log(`\nPast results meetings (last ${BM_HISTORY_DAYS}d)…`);
  let resultsHistory = {};
  try {
    resultsHistory = await fetchResultsHistory(wanted);
    console.log(`   cadence known for ${Object.keys(resultsHistory).length} symbols`);
  } catch (e) {
    console.log(`   FAILED: ${e.message} — continuing without cadence`);
  }

  // 2 & 3. Per-symbol insider filings and shareholding.
  console.log(`\nInsider filings + shareholding (${CONCURRENCY} at a time)…`);
  const bySymbol = {};
  let withPit = 0;
  let withHolding = 0;

  await pool(symbols, CONCURRENCY, async (sym) => {
    const [pit, holding] = await Promise.all([
      fetchPit(sym).catch(() => []),
      fetchHolding(sym).catch(() => []),
    ]);
    if (pit.length) withPit++;
    if (holding.length) withHolding++;
    bySymbol[sym] = {
      pit,
      holding,
      announcements: annBySymbol[sym] ?? [],
      boardMeetings: bmBySymbol[sym] ?? [],
      resultsHistory: resultsHistory[sym] ?? [],
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    windows: { pitDays: PIT_DAYS, announcementDays: ANN_DAYS },
    coverage: {
      symbols: symbols.length,
      withPit,
      withHolding,
      withAnnouncements: Object.keys(annBySymbol).length,
      withBoardMeetings: Object.keys(bmBySymbol).length,
      withResultsCadence: Object.keys(resultsHistory).length,
    },
    symbols: bySymbol,
  };

  await writeFile(OUT, JSON.stringify(payload));
  const mb = (JSON.stringify(payload).length / 1048576).toFixed(2);

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`  insider filings   ${withPit}/${symbols.length} symbols`);
  console.log(`  shareholding      ${withHolding}/${symbols.length} symbols`);
  console.log(`  announcements     ${Object.keys(annBySymbol).length}/${symbols.length} symbols`);
  console.log(`  board meetings    ${Object.keys(bmBySymbol).length}/${symbols.length} symbols (intimated)`);
  console.log(`  results cadence   ${Object.keys(resultsHistory).length}/${symbols.length} symbols`);
  console.log(`  → data/promoter.json (${mb} MB)`);

  if (withPit < symbols.length * 0.4) {
    console.log(`\n  WARNING: insider coverage is thin. The distress gates will`);
    console.log(`  simply not fire for uncovered names — they fail open, never closed.`);
  }
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
