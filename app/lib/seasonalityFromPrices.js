import { getCurrentMonth, getCurrentYear } from "./date";

// ─────────────────────────────────────────────────────────────────────────────
// Per-month seasonality, recomputed from the monthly price rows.
//
// WHY THIS EXISTS AT ALL — the MCP already returns a `seasonality` block, and
// this replaces it.
//
// That block counts the CURRENT, IN-PROGRESS month as a finished year. Queried
// on 2 Sep 2026, TIINDIA's September row came back as 7 positive / 2 negative
// over 9 years — 77.8% — where the ninth "year" was 2026-09 with a return of
// -1.6%. That was two days of trading, scored as a losing September.
//
// The rankings page reads a different MCP tool (get_monthly_ranking) which does
// exclude it, and reported 7/1 over 8 years — 87.5%. So the same stock, in the
// same month, showed 88% on one screen and 78% on another, and the lower number
// was the wrong one. The gap is widest in the first days of a month, when the
// partial return is pure noise, and it affects every stock in every month.
//
// A partial month is not a data point. It is excluded until it closes.
//
// The definition of a "win" is unchanged and deliberately matches the rest of
// the system: a month wins when its return is > 0. There is no threshold, no
// tolerance for small losses. Verified against 171 stocks — the MCP's
// positive_years matches the count of (return > 0) on 168 of them and the count
// of (return > -5%) on 12, so > 0 is the definition everywhere.
//
// Shape is byte-for-byte what the MCP returned, because the analysis page, the
// stock page and the mobile app all read these keys already.
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

function median(sorted) {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * True when a "YYYY-MM" row is the month currently in progress in IST.
 *
 * IST, not the server's clock: the whole dataset is NSE months, and a Vercel
 * function in UTC would disagree with the exchange for five and a half hours
 * around every month boundary — long enough to either keep a partial month or
 * drop a complete one.
 */
export function isCurrentMonth(dateStr, now = { month: getCurrentMonth(), year: getCurrentYear() }) {
  const [y, m] = String(dateStr || "").split("-").map(Number);
  return y === now.year && m === now.month;
}

/**
 * Rebuild the 12 seasonality rows from `prices`, excluding the in-progress
 * month. Returns rows in calendar order; months with no completed history are
 * omitted, matching what the MCP does for a stock with a short listing.
 *
 * @param {Array<{date: string, return_pct: number|null}>} prices monthly rows
 * @returns {Array<object>} same keys the MCP's seasonality block uses
 */
export function seasonalityFromPrices(prices) {
  const now = { month: getCurrentMonth(), year: getCurrentYear() };
  const byMonth = new Map();

  for (const row of prices || []) {
    const ret = row?.return_pct;
    // A null return is the first row of a series — there is no prior close to
    // measure from — not a flat month.
    if (ret === null || ret === undefined || !Number.isFinite(Number(ret))) continue;
    if (isCurrentMonth(row.date, now)) continue;

    const m = Number(String(row.date).split("-")[1]);
    if (!(m >= 1 && m <= 12)) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(Number(ret));
  }

  const out = [];
  for (let m = 1; m <= 12; m++) {
    const vals = byMonth.get(m);
    if (!vals || !vals.length) continue;

    const positive = vals.filter((v) => v > 0).length;
    const negative = vals.length - positive;
    const sorted = [...vals].sort((a, b) => a - b);

    out.push({
      month: MONTH_ABBR[m - 1],
      month_num: m,
      win_rate: round1((positive / vals.length) * 100),
      avg_return: round2(vals.reduce((a, v) => a + v, 0) / vals.length),
      median_return: round2(median(sorted)),
      positive_years: positive,
      negative_years: negative,
      best: round2(sorted[sorted.length - 1]),
      worst: round2(sorted[0]),
      data_points: vals.length,
    });
  }
  return out;
}

/**
 * Replace the MCP's seasonality with the corrected one, in place on the raw
 * payload. Falls back to whatever the MCP sent if there are no usable prices —
 * a stock page with slightly stale seasonality beats a stock page with none.
 */
export function withCompletedMonthsOnly(raw) {
  if (!raw || !Array.isArray(raw.prices) || !raw.prices.length) return raw;
  const seasonality = seasonalityFromPrices(raw.prices);
  if (!seasonality.length) return raw;
  return { ...raw, seasonality };
}
