import { NextResponse } from "next/server";
import { loadUniverse } from "@/app/lib/dataset";

// ─────────────────────────────────────────────────────────────────────────────
// The F&O symbol list, for search and pickers.
//
// Nothing exposed the universe before, so clients had to scrape symbols out of
// whatever /api/rankings happened to return — about 75 of the 181 names, which
// meant search silently had no suggestion for the other 106.
//
// Snapshot-derived and tiny (~10KB), so it needs no Upstox and is safe to cache
// hard: the list only changes when the monthly snapshot is rebuilt.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const u = loadUniverse();

    const symbols = u.symbols
      .map((s) => ({
        symbol: s,
        sector: u.sectors?.[s] || null,
        lotSize: u.lotSize?.[s] ?? null,
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    const sectors = Array.from(
      new Set(symbols.map((s) => s.sector).filter(Boolean)),
    ).sort();

    return NextResponse.json(
      {
        count: symbols.length,
        symbols,
        sectors,
        generatedAt: u.generatedAt ?? null,
        minYear: u.minYear ?? null,
        maxYear: u.maxYear ?? null,
      },
      { headers: { "Cache-Control": "s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e.message, symbols: [], count: 0 }, { status: 500 });
  }
}
