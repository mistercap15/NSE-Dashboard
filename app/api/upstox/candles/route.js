import { NextResponse } from "next/server"
import { getDailyCandles } from "@/app/lib/upstox"
import { toInstrumentKey } from "@/app/lib/instruments"

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get("symbol")?.toUpperCase()
  const days   = parseInt(searchParams.get("days") || "60")

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 })
  }

  try {
    const instrumentKey = toInstrumentKey(symbol)
    const candles       = await getDailyCandles(instrumentKey, days)

    return NextResponse.json({
      symbol,
      instrumentKey,
      days,
      candles,
      count: candles.length,
    }, {
      headers: { "Cache-Control": "s-maxage=3600" } // cache 1 hour
    })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
