// ── Event calendar ───────────────────────────────────────────────────────────
// Monthly F&O expiry (last Thursday) is computed; macro/earnings events come
// from the editable data/events.json. Used to flag the trading window.

import calendarFile from "../../data/events.json";

const DAY = 86400000;

// Last Thursday of a given month (NSE monthly F&O expiry). month is 1-12.
export function lastThursday(year, month) {
  const d = new Date(year, month, 0);                 // last day of month
  const back = (d.getDay() - 4 + 7) % 7;              // Thu = 4
  d.setDate(d.getDate() - back);
  return d;
}

const daysBetween = (a, b) => Math.ceil((a.getTime() - b.getTime()) / DAY);
// Format a Date as YYYY-MM-DD using LOCAL components (toISOString shifts by tz)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Calendar context relative to `now`: next F&O expiry + upcoming flagged events.
export function getCalendar(now = new Date(), withinDays = 45) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // This month's expiry; roll to next month if already past
  let expiry = lastThursday(today.getFullYear(), today.getMonth() + 1);
  if (expiry < today) expiry = lastThursday(today.getFullYear(), today.getMonth() + 2);
  const expiryDays = daysBetween(expiry, today);

  const events = (calendarFile.events || [])
    .map(e => ({ ...e, dateObj: new Date(e.date + "T00:00:00") }))
    .filter(e => !isNaN(e.dateObj) && e.dateObj >= today)
    .map(e => ({ date: e.date, label: e.label, type: e.type, daysAway: daysBetween(e.dateObj, today) }))
    .filter(e => e.daysAway <= withinDays)
    .sort((a, b) => a.daysAway - b.daysAway);

  return {
    expiry: { date: ymd(expiry), daysAway: expiryDays },
    events,
  };
}
