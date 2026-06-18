import { NextResponse } from "next/server";
import { loadUniverse } from "../../lib/dataset";
import { runBacktest } from "../../lib/backtest";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const direction = (searchParams.get("direction") || "LONG").toUpperCase();
  const topN      = Math.max(1, Math.min(20, parseInt(searchParams.get("topN") || "5")));
  const startYear = searchParams.get("startYear") ? parseInt(searchParams.get("startYear")) : undefined;

  try {
    const universe = loadUniverse();
    if (!universe.symbols.length) {
      return NextResponse.json(
        { error: "Universe snapshot not built yet. Run: node scripts/build-universe.mjs" },
        { status: 503 }
      );
    }
    const result = runBacktest(universe, { direction, topN, startYear });
    return NextResponse.json({
      ...result,
      universe: { symbols: universe.symbols.length, from: universe.minYear, to: universe.maxYear, generatedAt: universe.generatedAt },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
