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
import { computeSupportZones, computePriceContext } from "@/app/lib/technicals";
import { computeLevels, seasonalityFor } from "@/app/lib/levels";
import { analyzeSwingLow, scoreSwingLow, bucketOf } from "@/app/lib/swinglow";
import { runPreTradeChecklist } from "@/app/lib/checklist";
import {
  scoreEdge,
  scoreStructure,
  scoreTiming,
  convictionOf,
  bandOf,
  reasonsFor,
  buildPlaybook,
  allocateCapital,
  RISK,
} from "@/app/lib/conviction";
import { getCurrentMonth, getCurrentYear } from "@/app/lib/date";
import { upstoxTokenFor } from "@/app/lib/auth";
import { qualify, promoterActivity } from "@/app/lib/qualify";
import { filingsFor, snapshotMeta, snapshotAgeDays } from "@/app/lib/promoter";
import { lastThursday } from "@/app/lib/events";

// ─────────────────────────────────────────────────────────────────────────────
// The Playbook: the month's few highest-conviction trades, ready to act on.
//
//   ?month=9        target month (defaults to the current IST month)
//   ?capital=       &reserve=      for lot sizing
//   ?top=6          how many trades to return
//
// SHAPE OF THE WORK. Scoring all ~181 symbols through three lenses would mean
// three whole-universe scans and several minutes. Instead it narrows first:
//
//   1. Rankings gives the month's seasonal candidates (cheap, MCP-cached).
//   2. Keep a shortlist by seasonal edge alone — anything without an edge can't
//      make the cut later, whatever its chart looks like.
//   3. Fetch candles ONCE per shortlisted symbol and derive everything else
//      from them: swing-low structure, support zones, price context, levels.
//
// That is one candle fetch per shortlisted name instead of three passes over
// the universe, and every screen still reads the same engines — the swing-low
// analyser, the levels engine and the early-entry checklist are imported, not
// reimplemented, so the Playbook cannot disagree with the screens it summarises.
// ─────────────────────────────────────────────────────────────────────────────

const SHORTLIST = 28;      // how many seasonal candidates get the full treatment
const LOOKBACK_DAYS = 1100; // ~3yr, what the swing-low engine expects
const CONCURRENCY = 8;

const MCP_URL = process.env.MCP_URL || "https://nse-data-mcp.vercel.app/mcp";
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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

async function fetchRankings(month) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: "get_monthly_ranking", arguments: { month, top: 60, sector: "ALL" } },
    }),
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`MCP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result?._raw?.top_stocks ?? [];
}

export async function GET(request) {
  const token = await upstoxTokenFor(request);
  if (token) setAccessToken(token);

  const { searchParams } = new URL(request.url);
  const month = parseInt(searchParams.get("month") || String(getCurrentMonth()), 10);
  const top = Math.min(10, Math.max(1, parseInt(searchParams.get("top") || "6", 10)));
  const capital = Math.max(0, Number(searchParams.get("capital") || 500000));
  const reserve = Math.max(0, Number(searchParams.get("reserve") || 100000));
  // What one lot ties up in margin — the user's own figure from Capital.
  const avgLotCost = Math.max(0, Number(searchParams.get("avgLotCost") || 150000));
  // Risk budgets, as a share of total capital. These decide position size;
  // margin is only the final ceiling.
  const riskPerTradePct = Math.max(0.1, Number(searchParams.get("riskPerTradePct") || RISK.perTradePct));
  const maxPortfolioRiskPct = Math.max(0.1, Number(searchParams.get("maxPortfolioRiskPct") || RISK.portfolioPct));

  const universe = loadUniverse();
  const upstoxReady = hasValidToken() && !isTokenExpired();

  const cacheKey = `${istDay()}:${month}:${top}:${capital}:${reserve}:${avgLotCost}:${riskPerTradePct}:${maxPortfolioRiskPct}:${upstoxReady}`;
  if (CACHE.key === cacheKey && CACHE.payload) {
    return NextResponse.json({ ...CACHE.payload, cached: true });
  }

  const base = {
    month,
    monthName: MONTH_NAMES[month - 1],
    generatedAt: new Date().toISOString(),
    connected: upstoxReady,
    picks: [],
    rejected: [],
    capital: null,
    cached: false,
  };

  try {
    // ── 1. Seasonal candidates ────────────────────────────────────────────
    const ranked = await fetchRankings(month);
    if (!ranked.length) {
      return NextResponse.json({ ...base, note: "No ranked candidates for this month." });
    }

    // ── 2. Narrow by edge before spending any network on charts ───────────
    const withEdge = ranked
      .map((r) => ({ r, edge: scoreEdge(r) }))
      .filter((x) => x.edge.score > 0)
      .sort((a, b) => b.edge.score - a.edge.score)
      .slice(0, SHORTLIST);

    if (!upstoxReady) {
      // Seasonality alone can rank, but it can't produce a tradeable plan.
      return NextResponse.json({
        ...base,
        note: "Upstox not connected — conviction needs live prices for levels, structure and timing.",
        shortlist: withEdge.map((x) => ({
          symbol: x.r.symbol,
          sector: x.r.sector,
          edge: x.edge.score,
          winRate: x.r.win_rate,
          medianReturn: x.r.median_return,
        })),
      });
    }

    await ensureInstrumentMap();

    // Live quotes for the whole shortlist in one call.
    let quotes = {};
    try {
      quotes = await getBatchQuotes(withEdge.map((x) => keyFor(x.r.symbol)));
    } catch {
      quotes = {};
    }

    const curMonth = getCurrentMonth();
    const prevMonth = month === 1 ? 12 : month - 1;
    const nextMonthName = MONTH_NAMES[month - 1];

    // The hold runs to the month's F&O expiry — the same last-Thursday rule the
    // calendar uses. Everything date-based in the qualifiers is measured in IST
    // so a run just after midnight UTC doesn't shift the window by a day.
    const istToday = istDay();
    const expiry = lastThursday(getCurrentYear(), month);
    const holdEndsOn = `${expiry.getFullYear()}-${String(expiry.getMonth() + 1).padStart(2, "0")}-${String(expiry.getDate()).padStart(2, "0")}`;

    // ── 3. One candle fetch per symbol, everything derived from it ────────
    const candidates = [];

    await pool(withEdge, CONCURRENCY, async ({ r, edge }) => {
      const sym = r.symbol;
      let candles = null;
      try {
        candles = await getDailyCandles(keyFor(sym), LOOKBACK_DAYS);
      } catch {
        return;
      }
      if (!Array.isArray(candles) || candles.length < 120) return;

      const rec = universe.series[sym];
      const seasonality = rec ? seasonalityFor(monthReturns(rec.points, month)) : null;
      const prevSeason = rec ? seasonalityFor(monthReturns(rec.points, prevMonth)) : null;

      const ltp = quotes[keyFor(sym)]?.last_price;
      const entry =
        Number.isFinite(ltp) && ltp > 0 ? ltp : candles[candles.length - 1]?.close ?? null;
      if (!Number.isFinite(entry) || entry <= 0) return;

      // Structure — the same analyser /swing-low runs.
      const sl = analyzeSwingLow(candles, { seasonality });
      let slRow = null;
      let inSwingLowScreener = false;
      if (sl) {
        const scored = scoreSwingLow(sl, seasonality ? { nextMonthWR: seasonality.winRate, n: seasonality.n } : null);
        if (scored) {
          inSwingLowScreener = bucketOf(sl, scored) !== "none";
          slRow = {
            tier: scored.tier,
            score: scored.score,
            floor: sl.nearestFloor,
            bounceRate: sl.bounce.bounceRate,
            bounceSamples: sl.bounce.entries,
            rsi: sl.rsi,
            distToFloorPct: sl.distToFloorPct,
            inZone: sl.inZone,
            drawdownFromHighPct: sl.drawdownFromHighPct,
          };
        }
      }

      // Levels — the same engine every screen quotes.
      const support = computeSupportZones(candles, entry);
      const context = computePriceContext(candles, entry);
      const closes = candles.map((c) => c.close);
      const ma200 = closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
      const meanClose = closes.reduce((a, b) => a + b, 0) / closes.length;

      const levels = computeLevels({
        entry,
        entryBasis: Number.isFinite(ltp) && ltp > 0 ? "live" : "last-close",
        supports: support.zones,
        seasonality,
        reversionTarget: Math.max(ma200 || 0, meanClose) || null,
        strategy: "seasonal",
        lotSize: universe.lotSize?.[sym] ?? null,
      });

      // Timing — the same checklist /early-entry runs.
      const checklist = runPreTradeChecklist(
        {
          nextMonth: {
            win_rate: r.win_rate,
            avg_return: r.avg_return,
            median_return: r.median_return,
            positive_years: r.positive_years,
            negative_years: r.negative_years,
            monthName: nextMonthName,
          },
          currentMonth: { win_rate: prevSeason?.winRate ?? 50 },
        },
        context,
        candles,
      );

      const structure = scoreStructure(slRow, levels);
      const timing = scoreTiming(checklist, levels, context);

      // How many of the three screeners would independently surface this name.
      const sources =
        1 + // it came from rankings by construction
        (inSwingLowScreener ? 1 : 0) +
        (checklist.result !== "FAIL" && support.isNearSupport ? 1 : 0);

      const conviction = convictionOf({ edge, structure, timing, sources });

      // Disqualifying facts the score can't see: illiquidity, promoter
      // distress, regulatory filings, an earnings date inside the hold. Run
      // here rather than inside buildPlaybook so that stays a pure ranking
      // function and the qualifiers remain reusable by the other screens.
      const filings = filingsFor(sym);
      const gate = qualify(
        { symbol: sym, conviction },
        { candles, filings, today: istToday, holdEndsOn },
      );

      candidates.push({
        symbol: sym,
        gate,
        // Display only — never fed into conviction or sizing. See qualify.js.
        promoter: promoterActivity(filings, istToday),
        sector: r.sector ?? universe.sectors?.[sym] ?? null,
        lotSize: universe.lotSize?.[sym] ?? r.lot_size ?? null,
        conviction,
        band: bandOf(conviction),
        sources,
        components: { edge: edge.score, structure: structure.score, timing: timing.score },
        edge,
        levels,
        seasonality,
        swingLow: slRow,
        inSwingLowScreener,
        checklist: {
          result: checklist.result,
          passCount: checklist.passCount,
          totalChecks: checklist.totalChecks,
          summary: checklist.summary,
        },
        support: { nearest: support.nearest, distancePct: support.distancePct },
        context,
        reasons: reasonsFor({ edge, structure, timing, levels, sources }),
      });
    });

    // ── 4. Gate, rank, size ──────────────────────────────────────────────
    const { picks, rejected, considered } = buildPlaybook(candidates, { top });
    const capitalPlan = allocateCapital(picks, {
      capital, reserve, avgLotCost, riskPerTradePct, maxPortfolioRiskPct, maxPositions: top,
    });

    // How often the qualifiers fired, counted at the source rather than by
    // pattern-matching the reason strings. A filter that vetoes most of a month
    // is miscalibrated, and that has to be visible rather than inferred from a
    // suspiciously short list.
    const gatedOut = candidates.filter((c) => c.gate?.rejects?.length).length;
    const flagged = candidates.filter((c) => c.gate?.warnings?.length).length;

    const payload = {
      ...base,
      picks: capitalPlan.positions,
      rejected,
      considered,
      shortlisted: withEdge.length,
      filings: {
        ...snapshotMeta(),
        ageDays: snapshotAgeDays(),
        holdEndsOn,
        gatedOut,
        flagged,
      },
      capital: {
        capital,
        reserve,
        avgLotCost,
        riskPerTradePct,
        maxPortfolioRiskPct,
        perTradeBudget: capitalPlan.perTradeBudget,
        portfolioBudget: capitalPlan.portfolioBudget,
        riskBudgetLeft: capitalPlan.riskBudgetLeft,
        riskBudgetUsedPct: capitalPlan.riskBudgetUsedPct,
        tooRisky: capitalPlan.tooRisky,
        usable: capitalPlan.usable,
        notional: capitalPlan.notional,
        deployed: capitalPlan.deployed,
        dryPowder: capitalPlan.dryPowder,
        deployedPct: capitalPlan.deployedPct,
        totalRisk: capitalPlan.totalRisk,
        totalReward: capitalPlan.totalReward,
        riskPctOfCapital: capitalPlan.riskPctOfCapital,
        unaffordable: capitalPlan.unaffordable,
      },
    };

    if (picks.length) CACHE = { key: cacheKey, payload };
    return NextResponse.json(payload);
  } catch (e) {
    // Never throw: an empty playbook with a reason beats a 500.
    return NextResponse.json({ ...base, error: e.message });
  }
}
