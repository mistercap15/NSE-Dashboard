// ── Event calendar ───────────────────────────────────────────────────────────
// Monthly F&O expiry is computed. Macro/earnings events come from the editable
// data/events.json. Used to flag the trading window.
//
// NSE moved monthly expiry from the last Thursday to the last Tuesday starting
// September 2025. If that day is a weekend or an NSE trading holiday, the
// contract expires on the previous trading day. All of this is done in IST
// civil dates: a Vercel function runs in UTC, and the exchange's date has
// already changed for five and a half hours before UTC's has.

import calendarFile from "../../data/events.json";
import { currentFuturesContract, futuresChain } from "./instrumentMaster";

const IST_MS = 5.5 * 60 * 60 * 1000;
const TUESDAY = 2;
const THURSDAY = 4;

// Weekday NSE trading holidays (cash and F&O closed). Weekends are not listed;
// the roll-back skips them on its own. Festival dates are included only where
// an exchange circular or a listed contract confirms the closure. Republic Day
// 2027 is in the list because the January 2027 NIFTY future is already listed
// with a 25 Jan expiry — the Tuesday the 26th is not a session.
export const NSE_HOLIDAYS = [
  // 2023 — circular NSE/FAOP/54759
  "2023-01-26", // Republic Day (last Thursday → expiry Wed 25 Jan)
  "2023-03-07",
  "2023-03-30", // Ram Navami (last Thursday → expiry Wed 29 Mar)
  "2023-04-04",
  "2023-04-07",
  "2023-04-14",
  "2023-05-01",
  "2023-06-28",
  "2023-08-15",
  "2023-09-19",
  "2023-10-02",
  "2023-10-24",
  "2023-11-14",
  "2023-11-27",
  "2023-12-25",
  // 2025 — closures named on the exchange's own expiry record
  "2025-04-10",
  "2025-05-01",
  "2025-10-02",
  "2025-10-21",
  "2025-12-25",
  // 2026 — circular NSE/CMTR/71775
  "2026-01-26",
  "2026-03-03",
  "2026-03-26",
  "2026-03-31", // Mahavir Jayanti (last Tuesday → expiry Mon 30 Mar)
  "2026-04-03",
  "2026-04-14",
  "2026-05-01",
  "2026-05-28",
  "2026-06-26",
  "2026-09-14",
  "2026-10-02",
  "2026-10-20",
  "2026-11-10",
  "2026-11-24", // Guru Nanak Jayanti (last Tuesday → expiry Mon 23 Nov)
  "2026-12-25",
  // 2027 — fixed holiday, already reflected in the listed Jan contract
  "2027-01-26",
];

const NSE_HOLIDAY_SET = new Set(NSE_HOLIDAYS);

const pad = (n) => String(n).padStart(2, "0");

export function ymd({ year, month, day }) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** IST calendar date for an instant. Does not use the server's local zone. */
export function istCivil(now = new Date()) {
  const ms = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(ms)) throw new Error("bad date");
  const d = new Date(ms + IST_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function istYmd(now = new Date()) {
  return ymd(istCivil(now));
}

function holidaySet(holidays) {
  if (holidays == null) return NSE_HOLIDAY_SET;
  if (holidays instanceof Set) return holidays;
  return new Set(holidays);
}

// Last `weekday` (0=Sun … 6=Sat) of a 1-indexed month, as a civil date.
function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0)); // month is 1-12; day 0 is the last day
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return { year: last.getUTCFullYear(), month: last.getUTCMonth() + 1, day: last.getUTCDate() - back };
}

function prevDay(date) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  d.setUTCDate(d.getUTCDate() - 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function isWeekend(date) {
  const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return dow === 0 || dow === 6;
}

function addMonths(year, month, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function civilDayNumber(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function daysBetween(later, earlier) {
  return civilDayNumber(later) - civilDayNumber(earlier);
}

/** 2 = Tuesday from September 2025 onward, 4 = Thursday before that. */
export function expiryWeekday(year, month) {
  if (year > 2025 || (year === 2025 && month >= 9)) return TUESDAY;
  return THURSDAY;
}

/**
 * Monthly F&O expiry as YYYY-MM-DD.
 *
 * Last Thursday before September 2025, last Tuesday from September 2025 on.
 * Weekends and NSE holidays roll back to the previous trading day. Pass
 * `holidays` (array or Set of YYYY-MM-DD) to override the built-in calendar;
 * pass `[]` for the raw weekday with no holiday roll.
 */
export function monthlyFoExpiry(year, month, holidays) {
  if (!Number.isInteger(year) || !(month >= 1 && month <= 12)) {
    throw new Error(`bad year/month ${year}-${month}`);
  }
  const closed = holidaySet(holidays);
  let date = lastWeekday(year, month, expiryWeekday(year, month));
  // A Tuesday or Thursday is never a weekend, but the day we step back to can be.
  while (isWeekend(date) || closed.has(ymd(date))) date = prevDay(date);
  return ymd(date);
}

// Raw last Thursday, no holiday roll. Kept so older callers still resolve.
export function lastThursday(year, month) {
  return ymd(lastWeekday(year, month, THURSDAY));
}

/**
 * Listed NIFTY futures expiry (YYYY-MM-DD) when the instrument master is
 * already loaded. Null when it isn't — callers keep the computed date.
 * `expiry` on the contract is the exchange's own instant, so this follows
 * holiday shifts without a second calendar.
 */
export function listedNiftyExpiry(now = Date.now()) {
  try {
    const ms = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const contract = currentFuturesContract("NIFTY", ms);
    const date = contract?.expiryDate;
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
}

/** Listed NIFTY future whose expiry falls in a given month, if the master has it. */
export function listedNiftyExpiryFor(year, month) {
  try {
    const prefix = `${year}-${pad(month)}`;
    const hit = futuresChain("NIFTY").find((c) => typeof c?.expiryDate === "string" && c.expiryDate.startsWith(prefix));
    return hit?.expiryDate || null;
  } catch {
    return null;
  }
}

// Calendar context relative to `now`: next F&O expiry + upcoming flagged events.
// `now` defaults to the current instant, read in IST, not the server's zone.
export function getCalendar(now = new Date(), withinDays = 45) {
  const today = istCivil(now);
  const todayStr = ymd(today);

  let expiry = monthlyFoExpiry(today.year, today.month);
  let via = "nse-calendar";
  if (expiry < todayStr) {
    const next = addMonths(today.year, today.month, 1);
    expiry = monthlyFoExpiry(next.year, next.month);
  }

  // The listed near-month NIFTY future is the exchange's answer, holiday shifts
  // included. It only overlays when the master has actually been loaded.
  const listed = listedNiftyExpiry(now);
  if (listed && listed >= todayStr) {
    expiry = listed;
    via = "nifty-future";
  }

  const events = (calendarFile.events || [])
    .filter((e) => typeof e?.date === "string" && e.date >= todayStr)
    .map((e) => ({ date: e.date, label: e.label, type: e.type, daysAway: daysBetween(e.date, todayStr) }))
    .filter((e) => e.daysAway <= withinDays)
    .sort((a, b) => a.daysAway - b.daysAway);

  return {
    expiry: { date: expiry, daysAway: daysBetween(expiry, todayStr), via },
    events,
  };
}
