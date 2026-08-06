import { NextResponse } from "next/server"
import { getBatchQuotes, setAccessToken } from "@/app/lib/upstox"
import { WATCHLIST } from "@/app/lib/instruments"
import { ensureInstrumentMap, keyFor } from "@/app/lib/instrumentMaster"
import { upstoxTokenFor } from "@/app/lib/auth"

export async function GET(request) {
  const token = await upstoxTokenFor(request)
  if (token) setAccessToken(token)

  const { searchParams } = new URL(request.url)
  const symbolsParam = searchParams.get("symbols")

  const symbols = symbolsParam
    ? symbolsParam.split(",").map(s => s.trim().toUpperCase())
    : WATCHLIST

  try {
    await ensureInstrumentMap()
    const instrumentKeys = symbols.map(keyFor)
    const quotes         = await getBatchQuotes(instrumentKeys)

    // Normalize response
    const result = {}
    symbols.forEach(sym => {
      const key   = keyFor(sym)
      const quote = quotes[key]
      if (quote) {
        result[sym] = {
          symbol:    sym,
          ltp:       quote.last_price,
          change:    quote.net_change,
          changePct: quote.net_change_percentage,
          high:      quote.ohlc?.high,
          low:       quote.ohlc?.low,
          open:      quote.ohlc?.open,
          prevClose: quote.ohlc?.close,
          volume:    quote.volume,
        }
      }
    })

    return NextResponse.json({ quotes: result, count: Object.keys(result).length })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
