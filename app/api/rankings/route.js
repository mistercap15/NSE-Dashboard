import { NextResponse } from "next/server";
import { loadUniverse } from "../../lib/dataset";
import {
  significance,
  applyBenjaminiHochberg,
  returnsForMonth,
  sanitizeReturns,
  median,
} from "../../lib/stats";
import { trendState, marketRegime } from "../../lib/regime";
import { getCalendar } from "../../lib/events";
import { getCurrentMonth, getCurrentYear } from "../../lib/date";
import { getSignalLabel } from "../../lib/api";

const MCP_URL = process.env.MCP_URL || "https://nse-data-mcp.vercel.app/mcp";
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// IST year-month that has not closed. Vercel runs in UTC; counting that month
// is the defect the Apps Script sheet still has.
function cutoffYm() {
  return `${getCurrentYear()}-${String(getCurrentMonth()).padStart(2, "0")}`;
}

function historyCount(points, cutoff) {
  const xs = [];
  for (const p of points || []) {
    if (!p || (cutoff && String(p.ym) >= cutoff)) continue;
    xs.push(p.ret);
  }
  return sanitizeReturns(xs).length;
}

function sigPayload(adjusted) {
  return {
    n: adjusted.n,
    t: Number(adjusted.t.toFixed(2)),
    p: adjusted.p,
    q: adjusted.q,
    ciLow: Number(adjusted.ciLow.toFixed(2)),
    ciHigh: Number(adjusted.ciHigh.toFixed(2)),
    significant: adjusted.significant,
    significantFdr: adjusted.significantFdr,
  };
}

// BH q-values for every symbol with a real t-test this month. The family is
// the whole tested set, so a name that does not make the top-N still tightens
// the threshold for the names that do.
function fdrBySymbol(universe, month, cutoff, sector) {
  const family = [];
  for (const sym of universe.symbols) {
    const rec = universe.series[sym];
    if (!rec) continue;
    if (sector && sector !== "ALL" && rec.sector !== sector) continue;
    const sample = returnsForMonth(rec.points, month, cutoff);
    if (sample.length < 3) continue;
    family.push({ symbol: sym, sig: significance(sample) });
  }
  const adjusted = applyBenjaminiHochberg(family.map((f) => f.sig));
  const bySymbol = new Map();
  family.forEach((f, i) => bySymbol.set(f.symbol, sigPayload(adjusted[i])));
  return bySymbol;
}

/**
 * One ranked row per symbol that has at least one *closed* observation of
 * `month`. The in-progress IST month is not a data point.
 */
function rankFromUniverse(universe, month, top, sector, cutoff) {
  const sigBySymbol = fdrBySymbol(universe, month, cutoff, sector);
  const rows = [];

  for (const sym of universe.symbols) {
    const rec = universe.series[sym];
    if (!rec) continue;
    if (sector && sector !== "ALL" && rec.sector !== sector) continue;

    const sample = returnsForMonth(rec.points, month, cutoff);
    if (!sample.length) continue;

    const positive = sample.filter((v) => v > 0).length;
    const n = sample.length;
    const avg = sample.reduce((a, v) => a + v, 0) / n;
    const sorted = [...sample].sort((a, b) => a - b);
    const win = round1((positive / n) * 100);
    const avgR = round2(avg);
    const row = {
      symbol: sym,
      sector: rec.sector || universe.sectors?.[sym] || "—",
      lot_size: universe.lotSize?.[sym] ?? rec.lotSize ?? null,
      win_rate: win,
      avg_return: avgR,
      median_return: round2(median(sorted)),
      best: round2(sorted[n - 1]),
      worst: round2(sorted[0]),
      positive_years: positive,
      negative_years: n - positive,
      // Total closed monthly observations, not the per-month count. The table
      // divides this by 12 when a name has no positive years.
      data_points: historyCount(rec.points, cutoff),
      signal: getSignalLabel(win),
      // Same composite the rankings page labels: WR×0.6 + Avg×4.
      score: round2(win * 0.6 + avgR * 4),
    };
    const sig = sigBySymbol.get(sym);
    if (sig) row.sig = sig;
    const trend = trendState(rec.points);
    if (trend) row.trend = trend;
    rows.push(row);
  }

  rows.sort((a, b) => b.score - a.score || b.win_rate - a.win_rate || a.symbol.localeCompare(b.symbol));
  const topStocks = rows.slice(0, top);
  const topNames = new Set(topStocks.map((r) => r.symbol));
  const avoidStocks = rows
    .filter((r) => !topNames.has(r.symbol))
    .sort((a, b) => a.score - b.score || a.win_rate - b.win_rate || a.symbol.localeCompare(b.symbol))
    .slice(0, 20);

  return {
    month,
    month_name: MONTH_NAMES[month - 1],
    total_stocks: rows.length,
    last_updated: universe.generatedAt || null,
    source: "universe",
    fdr_tested: sigBySymbol.size,
    top_stocks: topStocks,
    avoid_stocks: avoidStocks,
    short_candidates: shortCandidates(avoidStocks, topStocks),
    stats_coverage: true,
  };
}

function shortCandidates(avoid, top) {
  const all = [
    ...(avoid || []),
    ...(top || []).filter((s) => s.win_rate < 50),
  ];
  const seen = new Set();
  return all
    .filter((s) => {
      if (seen.has(s.symbol)) return false;
      seen.add(s.symbol);
      return true;
    })
    .sort((a, b) => (a.win_rate - b.win_rate) || (a.avg_return - b.avg_return))
    .slice(0, 20)
    .map((s) => ({
      ...s,
      short_sl_pct: Math.min(Math.max(Math.abs(s.best || 0) * 1.3, 4), 20),
      short_score: (s.win_rate * 0.6) + (s.avg_return * 4),
      short_win_prob: round1(100 - s.win_rate),
    }));
}

function stampFdr(payload, universe, month, cutoff) {
  const bySymbol = fdrBySymbol(universe, month, cutoff, "ALL");
  const apply = (stocks) => (stocks || []).map((s) => {
    const sig = bySymbol.get(s.symbol);
    const rec = universe.series[s.symbol];
    const trend = rec ? trendState(rec.points) : null;
    const out = { ...s };
    if (sig) out.sig = sig;
    if (trend) out.trend = trend;
    return out;
  });
  payload.top_stocks = apply(payload.top_stocks);
  payload.avoid_stocks = apply(payload.avoid_stocks);
  payload.short_candidates = apply(payload.short_candidates);
  payload.stats_coverage = true;
  payload.fdr_tested = bySymbol.size;
}

async function callMCPTool(toolName, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    next: { revalidate: 300 },
  });

  if (!res.ok) throw new Error(`MCP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

async function rankFromMcp(month, top, sector) {
  const result = await callMCPTool("get_monthly_ranking", { month, top, sector });
  const raw = result?._raw;
  if (!raw) {
    return {
      error: "No data from master sheet",
      top_stocks: [],
      avoid_stocks: [],
      total_stocks: 0,
      month,
      month_name: MONTH_NAMES[month - 1],
      source: "mcp",
    };
  }
  return {
    ...raw,
    source: "mcp",
    short_candidates: shortCandidates(raw.avoid_stocks, raw.top_stocks),
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const month = parseInt(searchParams.get("month") || "1", 10);
  const top = Math.max(1, parseInt(searchParams.get("top") || "25", 10) || 25);
  const sector = searchParams.get("sector") || "ALL";
  const cutoff = cutoffYm();

  let universe = null;
  try { universe = loadUniverse(); } catch { /* snapshot not built yet */ }

  let payload = null;
  try {
    if (!universe?.symbols?.length || !universe.series) {
      throw new Error("seasonality snapshot unavailable");
    }
    payload = rankFromUniverse(universe, month, top, sector, cutoff);
    try { payload.regime = marketRegime(universe); } catch { /* ignore */ }
  } catch (err) {
    // The sheet is the fallback only. It does not refresh symbols it already
    // has, and it counts the month that is still trading.
    console.error("Universe ranking failed, falling back to MCP:", err.message);
    try {
      payload = await rankFromMcp(month, top, sector);
      if (universe?.series) {
        stampFdr(payload, universe, month, cutoff);
        try { payload.regime = marketRegime(universe); } catch { /* ignore */ }
      }
    } catch (e) {
      console.error("Rankings API error:", e.message);
      return NextResponse.json(
        { error: e.message, top_stocks: [], avoid_stocks: [], total_stocks: 0 },
        { status: 500 },
      );
    }
  }

  try { payload.calendar = getCalendar(); } catch { /* ignore */ }

  // Get sentiment from early-entry endpoint (uses same Upstox token, guaranteed to work)
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:${process.env.PORT || 3000}`;

    const earlyEntryRes = await fetch(`${baseUrl}/api/early-entry`, {
      headers: request.headers,
    });
    if (earlyEntryRes.ok) {
      const earlyEntryData = await earlyEntryRes.json();
      if (earlyEntryData.sentiment) {
        payload.sentiment = earlyEntryData.sentiment;
      }
    }
  } catch (e) {
    console.log("Could not fetch sentiment from early-entry:", e.message);
  }

  return NextResponse.json(payload);
}
