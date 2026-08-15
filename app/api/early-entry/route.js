import { NextResponse } from "next/server"
import { getDailyCandles, getQuote, setAccessToken } from "@/app/lib/upstox"
import { ensureInstrumentMap, keyFor } from "@/app/lib/instrumentMaster"
import { computeSupportZones, computePriceContext, computeSignalScore } from "@/app/lib/technicals"
import { getNextMonth } from "@/app/lib/date"
import { loadUniverse } from "@/app/lib/dataset"
import { marketRegime } from "@/app/lib/regime"
import { runPreTradeChecklist } from "@/app/lib/checklist"
import { upstoxTokenFor } from "@/app/lib/auth"

const MCP_URL   = process.env.MCP_URL || "https://nse-data-mcp.vercel.app/mcp"
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

// Fetch market-proxy daily candles. Tries the Nifty 50 index key; if that
// returns nothing (key format issue), falls back to RELIANCE — whose ISIN
// key is proven to work in the early-entry price fetch above.
async function getMarketProxyCandles(days) {
  let candles = await getDailyCandles("NSE_INDEX|Nifty 50", days)
  if (!candles?.length) {
    candles = await getDailyCandles(keyFor("RELIANCE"), days)
  }
  return candles
}

// ── Sentiment calculation (uses same Upstox token as early-entry) ────────
async function calculateSentiment() {
  try {
    console.log("[sentiment] Starting...")

    // Price action: Nifty trend
    let priceAction = 50
    try {
      const candles = await getMarketProxyCandles(60)
      if (candles?.length >= 20) {
        const ma5 = candles.slice(-5).map(c => c.close).reduce((a,b) => a+b) / 5
        const ma20 = candles.slice(-20).map(c => c.close).reduce((a,b) => a+b) / 20
        const latest = candles[candles.length - 1].close
        if (latest > ma5 && ma5 > ma20) priceAction = Math.min(85 + ((ma5-ma20)/ma20)*300, 100)
        else if (latest < ma5 && ma5 < ma20) priceAction = Math.max(15 - ((ma20-ma5)/ma20)*300, 0)
        else if (latest > ma5) priceAction = 65
        else priceAction = 35
      }
    } catch (e) { console.log("[sentiment] priceAction:", e.message) }

    // Breadth + Volume share ONE basket fetch of daily candles (candles are the
    // proven-reliable Upstox call — same one early-entry uses for prices).
    // 40 calendar days ≈ 28 trading days, safely above the 20-day lookback.
    let breadth = 50
    let volume = 50
    try {
      const universe = loadUniverse()
      const symbols = universe.symbols.slice(0, 40)
      const results = await Promise.allSettled(symbols.map(s => getDailyCandles(keyFor(s), 40)))

      let ups = 0, downs = 0
      const volRatios = []
      results.forEach(r => {
        if (r.status !== "fulfilled" || !r.value || r.value.length < 21) return
        const c = r.value
        const today = c[c.length - 1]
        const prev  = c[c.length - 2]
        // Advance/decline from close-over-close
        const chg = ((today.close - prev.close) / prev.close) * 100
        if (chg > 0.1) ups++
        else if (chg < -0.1) downs++
        // Volume ratio: today vs trailing 20-day average
        const avg20 = c.slice(-21, -1).map(x => x.volume).reduce((a, b) => a + b, 0) / 20
        if (avg20 > 0) volRatios.push(today.volume / avg20)
      })

      const total = ups + downs
      if (total > 10) breadth = Math.max(0, Math.min(100, 50 + ((ups - downs) / total) * 100))

      if (volRatios.length > 0) {
        const avg = volRatios.reduce((a, b) => a + b, 0) / volRatios.length
        if (avg >= 1.3) volume = Math.min(100, 75 + (avg - 1.3) * 200)
        else if (avg < 0.7) volume = Math.max(0, 25 - (0.7 - avg) * 200)
        else volume = 50 + (avg - 1) * 100
      }
      console.log(`[sentiment] breadth: ${ups}up/${downs}down, volRatios: ${volRatios.length}`)
    } catch (e) { console.log("[sentiment] breadth/volume:", e.message) }

    // Bid-ask spreads (live only — needs live market depth, so only
    // measurable while the market is open; ask price is 0 after close)
    let bidAskSpread = 50
    let spreadAvailable = false
    try {
      const universe = loadUniverse()
      const symbols = universe.symbols.slice(0, 20)
      const results = await Promise.allSettled(symbols.map(s => getQuote(keyFor(s))))
      let spreadSum = 0, count = 0
      results.forEach(r => {
        if (r.status === "fulfilled" && r.value?.bid && r.value?.ask && r.value?.ltp) {
          const spread = ((r.value.ask - r.value.bid) / r.value.ltp) * 100
          spreadSum += spread
          count++
        }
      })
      if (count > 0) {
        spreadAvailable = true
        const avg = spreadSum / count
        if (avg < 0.2) bidAskSpread = 90
        else if (avg < 0.5) bidAskSpread = 50 + ((0.5-avg)/0.3)*40
        else bidAskSpread = Math.max(10, 50 - ((avg-0.5)*100))
      }
      console.log(`[sentiment] spreads: ${count} with bid/ask (available=${spreadAvailable})`)
    } catch (e) { console.log("[sentiment] spreads:", e.message) }

    // Volatility
    let volatility = 50
    try {
      const candles = await getMarketProxyCandles(65)
      if (candles?.length >= 20) {
        const atr20 = candles.slice(-20).map((c,i,arr) => {
          if (i === 0) return 0
          return Math.max(c.high - c.low, Math.abs(c.high - arr[i-1].close), Math.abs(c.low - arr[i-1].close))
        }).reduce((a,b) => a+b) / 20
        const atr60 = candles.map((c,i,arr) => {
          if (i === 0) return 0
          return Math.max(c.high - c.low, Math.abs(c.high - arr[i-1].close), Math.abs(c.low - arr[i-1].close))
        }).reduce((a,b) => a+b) / candles.length
        const ratio = atr60 > 0 ? atr20 / atr60 : 1
        if (ratio > 1.3) volatility = Math.max(0, 50 - (ratio-1.3)*200)
        else if (ratio < 0.8) volatility = Math.min(100, 50 + (0.8-ratio)*200)
      }
    } catch (e) { console.log("[sentiment] volatility:", e.message) }

    // Weighted score over only the factors we could actually measure.
    // Spreads drop out when the market is closed (no live depth) — its weight
    // is redistributed across the rest so an unmeasured factor never drags the
    // score toward a fake neutral.
    const contributions = [
      { weight: 0.30, value: priceAction },
      { weight: 0.25, value: breadth },
      { weight: 0.20, value: volume },
      { weight: 0.10, value: 100 - volatility },
      ...(spreadAvailable ? [{ weight: 0.15, value: bidAskSpread }] : []),
    ]
    const totalWeight = contributions.reduce((s, c) => s + c.weight, 0)
    const bullishScore = Math.round(
      contributions.reduce((s, c) => s + c.weight * c.value, 0) / totalWeight
    )
    const sentiment = bullishScore > 65 ? "BULLISH" : bullishScore < 35 ? "BEARISH" : "NEUTRAL"
    const liveCount = 4 + (spreadAvailable ? 1 : 0)

    console.log(`[sentiment] Result: ${sentiment} ${bullishScore} (${liveCount}/5 live)`)

    return {
      bullishScore,
      bearishScore: 100 - bullishScore,
      sentiment,
      confidence: bullishScore > 80 || bullishScore < 20 ? "High" : "Medium",
      liveCount,
      marketOpen: spreadAvailable,
      factors: {
        priceAction:  Math.round(priceAction),
        breadth:      Math.round(breadth),
        bidAskSpread: spreadAvailable ? Math.round(bidAskSpread) : null,
        volume:       Math.round(volume),
        volatility:   Math.round(volatility),
      }
    }
  } catch (e) {
    console.error("[sentiment] Error:", e.message)
    return { bullishScore: 50, bearishScore: 50, sentiment: "NEUTRAL", confidence: "Low", factors: {} }
  }
}


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
  const token      = await upstoxTokenFor(request)
  const cronToken  = request.headers.get("x-upstox-token")
  if (token)      setAccessToken(token)
  else if (cronToken) setAccessToken(cronToken)

  // Resolve instrument keys from Upstox's master (self-healing vs hardcoded map).
  await ensureInstrumentMap()

  const { searchParams } = new URL(request.url)
  const targetMonth = parseInt(searchParams.get("month") || String(getNextMonth())) // next month default
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
          const instrumentKey = keyFor(stock.symbol)
          candles = await getDailyCandles(instrumentKey, 65)

          const lastCandle = candles[candles.length - 1]
          const todayIST   = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
          const lastCandleIsToday = lastCandle?.date === todayIST

          if (lastCandleIsToday) {
            // Today's completed candle has the official NSE closing price (call auction)
            currentPrice = lastCandle.close
          } else {
            // Today's candle not yet finalised — market likely still open, use live LTP
            try {
              const quote  = await getQuote(instrumentKey)
              currentPrice = quote.ltp
            } catch (quoteErr) {
              console.error(`[early-entry] getQuote failed for ${stock.symbol}:`, quoteErr.message)
              priceError = quoteErr.message
              currentPrice = lastCandle?.close
            }
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

        // Pre-trade checklist
        const checklist = runPreTradeChecklist(
          {
            nextMonth: {
              win_rate:       stock.win_rate,
              avg_return:     stock.avg_return,
              median_return:  stock.median_return,
              positive_years: stock.positive_years,
              negative_years: stock.negative_years,
              monthName:      MONTH_NAMES[targetMonth - 1],
            },
            currentMonth: { win_rate: currentMonthWR },
          },
          context,
          candles
        )

        const adjustedScore = Math.max(0, Math.min(100, (signal.score || 0) - checklist.scorePenalty))
        const adjustedStatus =
          adjustedScore >= 75 ? "BUY"      :
          adjustedScore >= 65 ? "BUY_HALF" :
          adjustedScore >= 55 ? "WATCH"    :
          adjustedScore >= 40 ? "MONITOR"  : "SKIP"

        return {
          symbol:   stock.symbol,
          sector:   stock.sector,
          lot_size: stock.lot_size,
          // Seasonality
          nextMonth: {
            month:          targetMonth,
            win_rate:       stock.win_rate,
            avg_return:     stock.avg_return,
            median_return:  stock.median_return,
            data_points:    stock.data_points,
          },
          currentMonth: {
            month:    currentMonth,
            win_rate: currentMonthWR,
            is_weak:  currentMonthWR < 55,
          },
          // Live price data
          price: {
            current: currentPrice,
            error:   priceError,
            candles: candles.slice(-5),
          },
          // Technical
          support,
          context,
          // Checklist
          checklist,
          // Signal (score already adjusted by checklist penalty)
          signal: {
            ...signal,
            score:         adjustedScore,
            originalScore: signal.score,
            scorePenalty:  checklist.scorePenalty,
          },
          status: adjustedStatus,
        }
      })
    )

    // Collect successful results and sort by score
    const scanResults = results
      .filter(r => r.status === "fulfilled")
      .map(r => r.value)
      .sort((a, b) => (b.signal?.score || 0) - (a.signal?.score || 0))

    // Calculate market sentiment (uses same token, won't fail)
    const sentiment = await calculateSentiment()

    return NextResponse.json({
      targetMonth,
      currentMonth,
      scannedAt:       new Date().toISOString(),
      totalCandidates: candidates.length,
      results:         scanResults,
      buySignals:      scanResults.filter(s => s.status === "BUY" || s.status === "BUY_HALF").length,
      watchlist:       scanResults.filter(s => s.status === "WATCH").length,
      sentiment,
    })

  } catch (e) {
    console.error("Early entry scan error:", e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
