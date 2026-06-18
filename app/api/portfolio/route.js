import { NextResponse } from "next/server";
import { loadUniverse } from "../../lib/dataset";
import { analyzePortfolio } from "../../lib/portfolio";

export async function POST(request) {
  try {
    const { symbols = [], capital = 1000000, riskPct = 1 } = await request.json();
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json({ error: "No symbols provided" }, { status: 400 });
    }
    const universe = loadUniverse();
    if (!universe.symbols.length) {
      return NextResponse.json({ error: "Universe snapshot not built yet" }, { status: 503 });
    }
    const result = analyzePortfolio(universe, { symbols: symbols.slice(0, 12), capital, riskPct });
    if (!result) return NextResponse.json({ error: "No matching symbols in snapshot" }, { status: 404 });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
