import { NextResponse } from "next/server";
import { getDailyCandles, getBatchQuotes, setAccessToken } from "@/app/lib/upstox";
import { toInstrumentKey } from "@/app/lib/instruments";
import { getCurrentMonth, getCurrentYear } from "@/app/lib/date";
import { upstoxTokenFor } from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Entry-price sourcing for the /sizing page.
// Entry = OPENING PRICE OF THE FIRST TRADING DAY of the selected month.
//   • current/past month → first-day open from daily candles (holiday-safe: only
//     trading days produce candles, so the earliest candle of the month IS it).
//   • future month (no first-day open yet) → provisional live quote (batched).
// Batches server-side so the client makes one round-trip instead of N calls.
// Degrades quietly: on any Upstox failure it returns whatever it got (possibly
// {}), never throws — the sizing engine must work with or without prices.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request) {
  const token = await upstoxTokenFor(request);
  if (token) setAccessToken(token);

  const { searchParams } = new URL(request.url);
  const month = parseInt(searchParams.get("month") || String(getCurrentMonth()));
  const symbols = (searchParams.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const curMonth = getCurrentMonth();
  const curYear = getCurrentYear();
  // Resolve the nearest current-or-future occurrence of the selected month.
  const year = month >= curMonth ? curYear : curYear + 1;
  const prefix = `${year}-${String(month).padStart(2, "0")}`;

  // Is the 1st of the target month still ahead of today? → no open yet → live.
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const now = new Date();
  const provisionalMonth = firstOfMonth > now;

  const base = { prices: {}, count: 0, month, year, provisionalMonth };
  if (!symbols.length) return NextResponse.json(base);

  const prices = {};
  try {
    if (provisionalMonth) {
      // Future month → provisional live LTP for every symbol in one batch call.
      const quotes = await getBatchQuotes(symbols.map(toInstrumentKey));
      symbols.forEach((sym) => {
        const q = quotes[toInstrumentKey(sym)];
        const ltp = q?.last_price;
        if (Number.isFinite(ltp) && ltp > 0) prices[sym] = { entry: ltp, provisional: true };
      });
    } else {
      // Current/past month → first trading day's open. Look back far enough to
      // reach into the target month (calendar gap + buffer), capped at ~400d.
      const gapDays = Math.ceil((now - firstOfMonth) / 86400000);
      const days = Math.min(Math.max(gapDays + 40, 40), 400);
      const results = await Promise.allSettled(
        symbols.map((sym) => getDailyCandles(toInstrumentKey(sym), days))
      );
      results.forEach((r, i) => {
        const sym = symbols[i];
        if (r.status !== "fulfilled" || !Array.isArray(r.value)) return;
        const first = r.value
          .filter((c) => c.date.startsWith(prefix))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        if (first && Number.isFinite(first.open) && first.open > 0) {
          prices[sym] = { entry: first.open, provisional: false, date: first.date };
        }
      });
    }
  } catch (e) {
    // Upstox down / not connected / token expired — return what we have.
    return NextResponse.json({ ...base, prices, count: Object.keys(prices).length, error: e.message });
  }

  return NextResponse.json({ ...base, prices, count: Object.keys(prices).length });
}
