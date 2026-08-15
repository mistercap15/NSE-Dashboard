// ─────────────────────────────────────────────────────────────────────────────
// Access to the promoter/filings snapshot.
//
// The snapshot is built offline by scripts/build-promoter.mjs and committed,
// because NSE blocks datacenter traffic — a live call from Vercel fails
// intermittently and silently, which is the worst failure mode for something
// that gates a trade. Nothing in here is fast-moving, so a daily snapshot loses
// nothing.
//
// Everything returns null rather than throwing when data is absent. Callers
// treat null as "unknown", never as "clean" — see qualify.js, which fails open.
// ─────────────────────────────────────────────────────────────────────────────

import snapshot from "../../data/promoter.json";
import { promoterActivity } from "./qualify";

/** ISO date of the snapshot build, for the UI's freshness note. */
export function snapshotMeta() {
  return {
    generatedAt: snapshot?.generatedAt ?? null,
    coverage: snapshot?.coverage ?? null,
  };
}

/**
 * Filings for one symbol, or null if the snapshot doesn't cover it.
 *
 * Coverage is uneven by nature: insider filings exist for only ~47 of 181 names
 * because most large caps simply have no promoter trades in a given year, while
 * results cadence covers ~180. A null here means "we don't know", and no
 * qualifier may treat that as a reason to reject.
 */
export function filingsFor(symbol) {
  const rec = snapshot?.symbols?.[symbol];
  if (!rec) return null;
  return {
    pit: rec.pit ?? [],
    holding: rec.holding ?? [],
    announcements: rec.announcements ?? [],
    boardMeetings: rec.boardMeetings ?? [],
    resultsHistory: rec.resultsHistory ?? [],
  };
}

/**
 * The promoter block a stock-detail response carries.
 *
 * Lives here rather than in either route because TWO routes serve a stock
 * detail screen — /api/analysis for the mobile app and /api/stock/[symbol] for
 * the web dashboard. They drifted once already: the block was added to the web
 * route only, so the mobile card silently never rendered and the endpoint I
 * tested wasn't the one the app calls. One helper, both callers.
 */
export function promoterBlockFor(symbol, now = new Date()) {
  const filings = filingsFor(symbol);
  const today = new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
  return {
    activity: promoterActivity(filings, today),
    /** Newest first. */
    holding: (filings?.holding ?? []).slice(0, 8),
    asOf: snapshotMeta().generatedAt,
  };
}

/** How stale the snapshot is, in whole days. Null if it has never been built. */
export function snapshotAgeDays(now = new Date()) {
  const g = snapshot?.generatedAt;
  if (!g) return null;
  const t = new Date(g).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86400000);
}
