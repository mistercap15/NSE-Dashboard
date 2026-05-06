import { NextResponse } from "next/server"
import { getDailyCandles, getQuote } from "@/app/lib/upstox"
import { toInstrumentKey } from "@/app/lib/instruments"
import { computeSupportZones, computePriceContext, computeSignalScore } from "@/app/lib/technicals"

const MCP_URL = process.env.MCP_URL || "https://nse-data-mcp.vercel.app/mcp"

function detectDipType(context) {
  if (!context) return "NO_DIP"

  const pctFromMa20 = context.pctFromMa20 || 0
  const momentum    = context.momentum    || 0

  // Stock is falling and below MA20
  if (pctFromMa20 < -3 && momentum < -1) return "RANDOM_DRIFT"

  // Stock is at or below MA50 (significant dip)
  if (context.isBelowMa50) return "SECTOR_ROTATION"

  // Stock fell sharply in short time (results-like drop)
  if (pctFromMa20 < -5) return "SECTOR_ROTATION"

  // No significant dip yet
  return "NO_DIP"
}

async function callMCP(toolName, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args }
    }),
    next: { revalidate: 3600 }
  })
  const data = await res.json()
  return data.result?._raw
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const targetMonth = parseInt(searchParams.get("month") || String(new Date().getMonth() + 2)) // next month default
  const currentMonth = targetMonth === 1 ? 12 : targetMonth - 1

  try {
    // Step 1: Get next month's top stocks from MCP
    const nextMonthRankings = await callMCP("get_monthly_ranking", {
      month: targetMonth,
      top:   50,
      sector: "ALL"
    })

    // Filter: only stocks with 10+ years data and 75%+ win rate
    const candidates = (nextMonthRankings?.top_stocks || []).filter(s => {
      const totalYears = (s.positive_years || 0) + (s.negative_years || 0)
      return totalYears >= 5 && (s.win_rate || 0) >= 75
    }).slice(0, 15)

    if (candidates.length === 0) {
      return NextResponse.json({
        targetMonth,
        candidates: [],
        message: "No high-conviction candidates found for this month with 10+ years data"
      })
    }

    // Step 2: For each candidate, get current month seasonality + live prices
    const results = await Promise.allSettled(
      candidates.map(async (stock) => {
        // Current month seasonality
        const currentMonthSeasonality = await callMCP("get_seasonality_summary", {
          symbol: stock.symbol,
          month:  currentMonth,
          start_year: 2020 // 5 years
        })

        // Daily candles from Upstox
        let candles      = []
        let currentPrice = null
        let priceError   = null

        try {
          const instrumentKey = toInstrumentKey(stock.symbol)
          candles = await getDailyCandles(instrumentKey, 65)
          // Use live LTP from quote — historical candles only have yesterday's close
          try {
            const quote  = await getQuote(instrumentKey)
            currentPrice = quote.ltp
          } catch (quoteErr) {
            console.error(`[early-entry] getQuote failed for ${stock.symbol}:`, quoteErr.message)
            priceError = quoteErr.message
            currentPrice = candles[candles.length - 1]?.close
          }
        } catch (e) {
          priceError = e.message
        }

        // Technical analysis
        const support = currentPrice
          ? computeSupportZones(candles, currentPrice)
          : null
        const context = currentPrice
          ? computePriceContext(candles, currentPrice)
          : null

        // Current month WR for dip confirmation
        const currentMonthWR = currentMonthSeasonality?.seasonality?.[currentMonth - 1]?.win_rate || 50

        // Signal score
        const signal = computeSignalScore(
          {
            nextMonth:    { win_rate: stock.win_rate,  avg_return: stock.avg_return },
            currentMonth: { win_rate: currentMonthWR },
          },
          context,
          support,
          detectDipType(context)
        )

        return {
          symbol:       stock.symbol,
          sector:       stock.sector,
          lot_size:     stock.lot_size,
          // Seasonality
          nextMonth: {
            month:         targetMonth,
            win_rate:      stock.win_rate,
            avg_return:    stock.avg_return,
            median_return: stock.median_return,
            data_points:   stock.data_points,
          },
          currentMonth: {
            month:   currentMonth,
            win_rate: currentMonthWR,
            is_weak:  currentMonthWR < 55,
          },
          // Live price data
          price: {
            current:  currentPrice,
            error:    priceError,
            candles:  candles.slice(-5), // last 5 days for preview
          },
          // Technical
          support,
          context,
          // Signal
          signal,
          // Status
          status:
            signal.score >= 75 ? "BUY" :
            signal.score >= 65 ? "BUY_HALF" :
            signal.score >= 55 ? "WATCH" :
            signal.score >= 40 ? "MONITOR" : "SKIP",
        }
      })
    )

    // Collect successful results and sort by score
    const scanResults = results
      .filter(r => r.status === "fulfilled")
      .map(r => r.value)
      .sort((a, b) => (b.signal?.score || 0) - (a.signal?.score || 0))

    return NextResponse.json({
      targetMonth,
      currentMonth,
      scannedAt:       new Date().toISOString(),
      totalCandidates: candidates.length,
      results:         scanResults,
      buySignals:      scanResults.filter(s => s.status === "BUY" || s.status === "BUY_HALF").length,
      watchlist:       scanResults.filter(s => s.status === "WATCH").length,
    })

  } catch (e) {
    console.error("Early entry scan error:", e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
