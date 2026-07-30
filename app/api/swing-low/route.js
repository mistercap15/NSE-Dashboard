import { NextResponse } from "next/server";
import { getDailyCandles, setAccessToken } from "@/app/lib/upstox";
import { ensureInstrumentMap, keyFor } from "@/app/lib/instrumentMaster";
import { loadUniverse, monthReturns } from "@/app/lib/dataset";
import { getNextMonth } from "@/app/lib/date";
import { analyzeSwingLow, scoreSwingLow, bucketOf, TIER_RANK } from "@/app/lib/swinglow";

// ─────────────────────────────────────────────────────────────────────────────
// Swing-low scanner. Fetches ~3yr daily candles for the whole F&O universe,
// runs the pure swing-low engine on each, blends next-month seasonality from the
// offline snapshot (no MCP), and returns stocks at / approaching a proven floor.
//
// Performance: batched concurrency + a same-IST-day in-memory cache — daily
// candles only change after the close, so the first scan of the day does the
// work and every later scan is instant. `?refresh=1` forces a rebuild.
// Degrades gracefully: if Upstox is down/disconnected, every fetch fails and we
// return connected:false with empty lists (never throws).
// ─────────────────────────────────────────────────────────────────────────────

const LOOKBACK_DAYS = 1100; // ~3 years of calendar days (~750 trading days)
const CONCURRENCY = 10;
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

let CACHE = { key: null, payload: null };

const istDay = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

// Bounded-concurrency worker pool.
async function pool(items, limit, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    })
  );
}

export async function GET(request) {
  const cookie = request.cookies.get("upstox_token")?.value;
  if (cookie) setAccessToken(cookie);

  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get("refresh") === "1";
  const limit = parseInt(searchParams.get("limit") || "0"); // 0 = whole universe (debug aid)

  const universe = loadUniverse();
  let symbols = universe.symbols;
  if (limit > 0) symbols = symbols.slice(0, limit);

  const nextMonth = getNextMonth();
  const nextMonthName = MONTH_NAMES[nextMonth - 1];
  const cacheKey = `${istDay()}:${symbols.length}:${nextMonth}`;

  if (!refresh && CACHE.key === cacheKey && CACHE.payload) {
    return NextResponse.json({ ...CACHE.payload, cached: true });
  }

  // Load Upstox's instrument master so every F&O symbol resolves to a real key
  // (the hardcoded ISIN_MAP misses ~34 names). Falls back to ISIN_MAP if it fails.
  await ensureInstrumentMap();

  // Precompute next-month seasonal win rate per symbol from the snapshot.
  const seasonalOf = (sym) => {
    const rec = universe.series[sym];
    if (!rec) return null;
    const rets = monthReturns(rec.points, nextMonth);
    if (rets.length < 4) return null;
    const wr = Math.round((rets.filter((r) => r > 0).length / rets.length) * 100);
    return { nextMonthWR: wr, nextMonthName, n: rets.length };
  };

  const at = [];
  const approaching = [];
  let scanned = 0;
  let failed = 0;

  await pool(symbols, CONCURRENCY, async (sym) => {
    let candles;
    try {
      candles = await getDailyCandles(keyFor(sym), LOOKBACK_DAYS);
    } catch {
      failed++;
      return;
    }
    if (!Array.isArray(candles) || candles.length < 120) { failed++; return; }
    scanned++;

    const a = analyzeSwingLow(candles);
    if (!a) return;
    const seasonal = seasonalOf(sym);
    const scored = scoreSwingLow(a, seasonal);
    if (!scored) return;
    const bucket = bucketOf(a, scored);
    if (bucket === "none") return;

    const row = {
      symbol: sym,
      sector: universe.sectors[sym] || "—",
      lotSize: universe.series[sym]?.lotSize || null,
      price: a.price,
      floor: a.nearestFloor,           // { low, high, mid, touches, lastTouch }
      distToFloorPct: a.distToFloorPct,
      inZone: a.inZone,
      rsi: a.rsi,
      drawdownFromHighPct: a.drawdownFromHighPct,
      ma200: a.ma200,
      bounceRate: a.bounce.bounceRate,
      bounceAvgPct: a.bounce.avgBouncePct,
      bounceSamples: a.bounce.entries,
      rr: a.rr,                        // { target, stop, upsidePct, downsidePct, ratio }
      seasonalWR: seasonal?.nextMonthWR ?? null,
      seasonalN: seasonal?.n ?? null,
      inSeason: scored.inSeason,
      score: scored.score,
      grade: scored.grade,
      tier: scored.tier,
      components: scored.components,
      reasons: scored.reasons,
    };

    (bucket === "at" ? at : approaching).push(row);
  });

  // Rank by confidence tier first (Prime → Strong → Watch), then score — so the
  // most robust, best-evidenced setups are always at the top of the list.
  const byTierThenScore = (x, y) =>
    (TIER_RANK[x.tier] - TIER_RANK[y.tier]) || (y.score - x.score);
  at.sort(byTierThenScore);
  approaching.sort(byTierThenScore);

  const payload = {
    generatedAt: new Date().toISOString(),
    connected: scanned > 0,
    universeSize: symbols.length,
    scanned,
    failed,
    nextMonth,
    nextMonthName,
    lookbackDays: LOOKBACK_DAYS,
    atSwingLow: at,
    approaching,
    cached: false,
  };

  if (scanned > 0) CACHE = { key: cacheKey, payload };
  return NextResponse.json(payload);
}
