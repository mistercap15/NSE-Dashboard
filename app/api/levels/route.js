import { NextResponse } from "next/server";
import {
  getDailyCandles,
  getBatchQuotes,
  setAccessToken,
  hasValidToken,
  isTokenExpired,
} from "@/app/lib/upstox";
import { ensureInstrumentMap, keyFor } from "@/app/lib/instrumentMaster";
import { loadUniverse, monthReturns } from "@/app/lib/dataset";
import { computeSupportZones } from "@/app/lib/technicals";
import { computeLevels, seasonalityFor } from "@/app/lib/levels";
import { getCurrentMonth, getCurrentYear } from "@/app/lib/date";
import { upstoxTokenFor } from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Entry / stop / target for one or many symbols — the endpoint every screen now
// asks instead of computing its own levels. See app/lib/levels.js for the rules.
//
//   ?symbols=RELIANCE,TCS   required (or ?symbol=)
//   ?month=9                seasonality month; defaults to the current IST month
//   ?strategy=seasonal      seasonal (default) | reversion
//   ?entry=live             live (default) | open  — first trading day's open
//   ?lots=2                 optional, enables average-in and rupee risk/reward
//
// Degrades in exactly one direction: seasonality comes from the offline
// snapshot and always works, while entry/supports need Upstox. Without it the
// response still carries per-symbol seasonality and `connected:false`, and the
// levels are null rather than invented.
// ─────────────────────────────────────────────────────────────────────────────

const LOOKBACK_DAYS = 420; // enough for MA200 + a 52-week low
const CONCURRENCY = 10;
const MAX_SYMBOLS = 60;

// Daily candles only move after the close, so one build per IST day is plenty.
let CACHE = { key: null, payload: null };
const istDay = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

async function pool(items, limit, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    }),
  );
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function GET(request) {
  const token = await upstoxTokenFor(request);
  if (token) setAccessToken(token);

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("symbols") || searchParams.get("symbol") || "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  const month = parseInt(searchParams.get("month") || String(getCurrentMonth()), 10);
  const strategy = searchParams.get("strategy") === "reversion" ? "reversion" : "seasonal";
  const entryMode = searchParams.get("entry") === "open" ? "open" : "live";
  const lots = parseInt(searchParams.get("lots") || "0", 10) || 0;

  if (!symbols.length) {
    return NextResponse.json({ error: "symbols required", levels: {}, count: 0 }, { status: 400 });
  }

  const universe = loadUniverse();

  // Seasonality first — snapshot-only, so this half of the answer is available
  // whether or not Upstox is reachable.
  const seasonality = {};
  for (const sym of symbols) {
    const rec = universe.series[sym];
    seasonality[sym] = rec ? seasonalityFor(monthReturns(rec.points, month)) : null;
  }

  const cacheKey = `${istDay()}:${symbols.join(",")}:${month}:${strategy}:${entryMode}:${lots}`;
  if (CACHE.key === cacheKey && CACHE.payload) {
    return NextResponse.json({ ...CACHE.payload, cached: true });
  }

  const base = {
    month,
    strategy,
    entryMode,
    seasonality,
    levels: {},
    count: 0,
    connected: false,
  };

  // Ask the Upstox module, not just the request: the token may equally come from
  // UPSTOX_ACCESS_TOKEN or a local .upstox_token, which is how the scripts and
  // local dev work. Gating on the request alone made this route report "not
  // connected" while /api/upstox/status happily reported the opposite.
  if (!hasValidToken() || isTokenExpired()) {
    base.note = "Upstox not connected — seasonality only, no price levels.";
    return NextResponse.json(base);
  }

  try {
    await ensureInstrumentMap();

    // Entry prices. A future month has no first-day open yet, so "open" quietly
    // becomes a provisional live quote — the same rule /api/sizing/entry-prices
    // already applies.
    const curMonth = getCurrentMonth();
    const curYear = getCurrentYear();
    const year = month >= curMonth ? curYear : curYear + 1;
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const provisional = entryMode === "live" || firstOfMonth > new Date();

    let quotes = {};
    if (provisional) {
      try {
        quotes = await getBatchQuotes(symbols.map(keyFor));
      } catch {
        quotes = {};
      }
    }

    const levels = {};
    let connectedCount = 0;

    await pool(symbols, CONCURRENCY, async (sym) => {
      let candles = null;
      try {
        candles = await getDailyCandles(keyFor(sym), LOOKBACK_DAYS);
      } catch {
        candles = null;
      }
      if (!Array.isArray(candles) || candles.length < 30) return;
      connectedCount++;

      // Entry
      let entry = null;
      let entryBasis;
      if (provisional) {
        const ltp = quotes[keyFor(sym)]?.last_price;
        if (Number.isFinite(ltp) && ltp > 0) {
          entry = ltp;
          entryBasis = entryMode === "open" ? "provisional" : "live";
        } else {
          entry = candles[candles.length - 1]?.close ?? null;
          entryBasis = "last-close";
        }
      } else {
        const first = candles
          .filter((c) => c.date.startsWith(prefix))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        if (first && Number.isFinite(first.open) && first.open > 0) {
          entry = first.open;
          entryBasis = "first-day-open";
        } else {
          entry = candles[candles.length - 1]?.close ?? null;
          entryBasis = "last-close";
        }
      }
      if (!Number.isFinite(entry) || entry <= 0) return;

      // Supports + the mean a reversion target aims at.
      const support = computeSupportZones(candles, entry);
      const closes = candles.map((c) => c.close);
      const ma200 = closes.length >= 200 ? mean(closes.slice(-200)) : null;
      const reversionTarget = Math.max(ma200 || 0, mean(closes)) || null;

      const computed = computeLevels({
        entry,
        entryBasis,
        supports: support.zones,
        seasonality: seasonality[sym],
        reversionTarget,
        strategy,
        lotSize: universe.lotSize?.[sym] ?? null,
        lots,
      });

      if (computed) {
        levels[sym] = {
          ...computed,
          sector: universe.sectors?.[sym] ?? null,
          lotSize: universe.lotSize?.[sym] ?? null,
          ma200: ma200 ? Math.round(ma200 * 100) / 100 : null,
          supports: support.zones.slice(0, 4),
          seasonality: seasonality[sym],
        };
      }
    });

    const payload = {
      ...base,
      levels,
      count: Object.keys(levels).length,
      connected: connectedCount > 0,
      cached: false,
    };

    if (payload.connected) CACHE = { key: cacheKey, payload };
    return NextResponse.json(payload);
  } catch (e) {
    // Never throw: a screen without levels still has seasonality to show.
    return NextResponse.json({ ...base, error: e.message });
  }
}
