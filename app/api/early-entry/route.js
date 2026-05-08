import { NextResponse } from "next/server"
import { getDailyCandles, getQuote, setAccessToken } from "@/app/lib/upstox"
import { toInstrumentKey } from "@/app/lib/instruments"
import { computeSupportZones, computePriceContext, computeSignalScore } from "@/app/lib/technicals"
import { sendEarlyEntryAlert } from "@/app/lib/email"

const MCP_URL   = process.env.MCP_URL || "https://nse-data-mcp.vercel.app/mcp"
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

function runPreTradeChecklist(stock, context, candles) {
  const checks = []

  // CHECK 1: Data quality — minimum 5 years per month
  const totalYears = (stock.nextMonth.positive_years || 0) +
                     (stock.nextMonth.negative_years || 0)
  const check1 = {
    name:    "Data Quality",
    desc:    `${totalYears} years of ${stock.nextMonth.monthName} data`,
    passed:  totalYears >= 5,
    warning: totalYears >= 3 && totalYears < 5,
    detail:  totalYears >= 5
      ? `✓ ${totalYears} years of real data — reliable signal`
      : totalYears >= 3
      ? `⚠ Only ${totalYears} years — treat with caution`
      : `✗ Less than 3 years — signal unreliable`,
  }
  checks.push(check1)

  // CHECK 2: Median vs Average gap
  // If avg is more than 2.5x the median, outliers are distorting the avg
  const avg    = Math.abs(stock.nextMonth.avg_return   || 0)
  const median = Math.abs(stock.nextMonth.median_return || 0)
  const gap    = median > 0 ? avg / median : 999
  const check2 = {
    name:    "Signal Reliability",
    desc:    `Avg +${stock.nextMonth.avg_return?.toFixed(1)}% vs Median +${stock.nextMonth.median_return?.toFixed(1)}%`,
    passed:  gap <= 2.5,
    warning: gap > 1.8 && gap <= 2.5,
    detail:  gap <= 1.5
      ? `✓ Avg and median are close — consistent returns`
      : gap <= 2.5
      ? `⚠ Avg higher than median — a few big years pulling it up. Use median as target.`
      : `✗ Avg is ${gap.toFixed(1)}x the median — outlier driven. Avg is misleading.`,
  }
  checks.push(check2)

  // CHECK 3: Current month weakness confirms dip setup
  const currentWR = stock.currentMonth?.win_rate || 50
  const check3 = {
    name:    "Dip Month Confirmed",
    desc:    `Current month win rate: ${currentWR}%`,
    passed:  currentWR <= 60,
    warning: currentWR > 60 && currentWR <= 70,
    detail:  currentWR <= 40
      ? `✓ Current month very weak (${currentWR}% WR) — strong dip setup`
      : currentWR <= 60
      ? `✓ Current month weak (${currentWR}% WR) — dip setup confirmed`
      : currentWR <= 70
      ? `⚠ Current month neutral (${currentWR}% WR) — weaker early entry case`
      : `✗ Current month strong (${currentWR}% WR) — not a dip month`,
  }
  checks.push(check3)

  // CHECK 4: Next month win rate minimum threshold
  const nextWR = stock.nextMonth.win_rate || 0
  const check4 = {
    name:    "Next Month Strength",
    desc:    `${stock.nextMonth.monthName} win rate: ${nextWR}%`,
    passed:  nextWR >= 75,
    warning: nextWR >= 65 && nextWR < 75,
    detail:  nextWR >= 85
      ? `✓ Very strong next month (${nextWR}% WR) — high conviction`
      : nextWR >= 75
      ? `✓ Strong next month (${nextWR}% WR) — tradeable setup`
      : nextWR >= 65
      ? `⚠ Moderate next month (${nextWR}% WR) — borderline`
      : `✗ Weak next month (${nextWR}% WR) — below threshold`,
  }
  checks.push(check4)

  // CHECK 5: Roll Opportunity — informational only
  const check5 = {
    name:            "Roll Opportunity",
    desc:            "Next-next month seasonality",
    passed:          true,
    warning:         false,
    detail:          "Check next month rankings to see if roll is possible",
    isInformational: true,
  }
  checks.push(check5)

  const hardChecks = checks.filter(c => !c.isInformational)
  const hardPassed = hardChecks.filter(c => c.passed).length
  const hasWarning = hardChecks.some(c => c.warning)

  const checklistResult =
    hardPassed === 4 && !hasWarning ? "PASS"    :
    hardPassed === 4 && hasWarning  ? "CAUTION" :
    hardPassed >= 3                 ? "CAUTION" : "FAIL"

  const scorePenalty =
    checklistResult === "FAIL"    ? 25 :
    checklistResult === "CAUTION" ? 10 : 0

  return {
    checks,
    result:      checklistResult,
    passCount:   hardPassed,
    totalChecks: hardChecks.length,
    scorePenalty,
    summary:
      checklistResult === "PASS"
        ? "All checks passed — high quality setup"
        : checklistResult === "CAUTION"
        ? "Minor concerns — trade with awareness"
        : "Setup has issues — reduced confidence",
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
  const cookie = request.cookies.get("upstox_token")?.value
  if (cookie) setAccessToken(cookie)

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

    // Fire email alert for BUY and BUY_HALF signals (non-fatal)
    const buySignals = scanResults.filter(s =>
      s.status === "BUY" || s.status === "BUY_HALF"
    )
    let emailResult = { sent: false }
    if (buySignals.length > 0) {
      try {
        emailResult = await sendEarlyEntryAlert(buySignals)
      } catch (e) {
        console.warn("Alert email failed:", e.message)
      }
    }

    return NextResponse.json({
      targetMonth,
      currentMonth,
      scannedAt:       new Date().toISOString(),
      totalCandidates: candidates.length,
      results:         scanResults,
      buySignals:      scanResults.filter(s => s.status === "BUY" || s.status === "BUY_HALF").length,
      watchlist:       scanResults.filter(s => s.status === "WATCH").length,
      emailSent:       emailResult.sent,
      emailSignals:    buySignals.length,
    })

  } catch (e) {
    console.error("Early entry scan error:", e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
