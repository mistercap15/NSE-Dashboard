import { NextResponse } from "next/server"

const MCP_URL = process.env.MCP_URL || "https://nse-data-mcp.vercel.app/mcp"

async function callMCP(toolName, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args }
    }),
    next: { revalidate: 3600 } // cache 1 hour
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.result?._raw
}

// ── Classification logic ──────────────────────────────────────────────────────
// Data quality filter: only trust stocks with 10+ years of per-month data.
// This prevents recently listed stocks (SWIGGY, HYUNDAI with 1-2 years)
// from corrupting the signals.
// We check BOTH data_points AND positive_years + negative_years >= MIN_DATA_POINTS
// because data_points alone can be the total monthly records count.

const MIN_DATA_POINTS = 10  // minimum years of data to trust a signal
const LONG_THRESHOLD  = 75  // win rate >= 75% → tradeable long
const SHORT_THRESHOLD = 35  // win rate <= 35% → tradeable short

function classifyMonth(topStocks, avoidStocks, monthNum) {
  // Filter for data quality — only stocks with 10+ years of history per month
  const qualityLongs = (topStocks || []).filter(s => {
    const totalYears = (s.positive_years || 0) + (s.negative_years || 0)
    return totalYears >= MIN_DATA_POINTS && (s.data_points || 0) >= MIN_DATA_POINTS
  })
  const qualityShorts = (avoidStocks || []).filter(s => {
    const totalYears = (s.positive_years || 0) + (s.negative_years || 0)
    return totalYears >= MIN_DATA_POINTS && (s.data_points || 0) >= MIN_DATA_POINTS
  })

  // Find best long candidates (win_rate >= LONG_THRESHOLD)
  const strongLongs = qualityLongs.filter(s => (s.win_rate || 0) >= LONG_THRESHOLD)

  // Find best short candidates (win_rate <= SHORT_THRESHOLD)
  const strongShorts = qualityShorts.filter(s => (s.win_rate || 0) <= SHORT_THRESHOLD)

  // Also check bottom of top_stocks for shorts
  const weakFromTop = qualityLongs.filter(s => (s.win_rate || 0) <= SHORT_THRESHOLD)
  const allShortCandidates = [
    ...strongShorts,
    ...weakFromTop,
  ].filter((s, i, arr) => arr.findIndex(x => x.symbol === s.symbol) === i)
   .sort((a, b) => (a.win_rate || 0) - (b.win_rate || 0))

  // Results months (Jan/Apr/Jul/Oct) — quarterly results declared
  const isResultsMonth = [1, 4, 7, 10].includes(monthNum)

  // Determine primary action
  let action = "FLAT"
  if (strongLongs.length >= 2) action = "LONG"
  else if (strongShorts.length >= 2 && strongLongs.length === 0) action = "SHORT"
  else if (strongLongs.length >= 1 && allShortCandidates.length >= 1) action = "PAIRED"
  else if (strongLongs.length === 1) action = "LONG"
  else action = "FLAT"

  // Determine dominant sector of the top long picks
  const sectorCount = {}
  strongLongs.slice(0, 5).forEach(s => {
    sectorCount[s.sector] = (sectorCount[s.sector] || 0) + 1
  })
  const dominantSector = Object.entries(sectorCount)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "Mixed"

  // Build paired trade if applicable
  let pairedTrade = null
  if (action === "PAIRED" || (action === "LONG" && allShortCandidates.length >= 1)) {
    const longLeg  = strongLongs[0]
    const shortLeg = allShortCandidates[0]
    if (longLeg && shortLeg && longLeg.symbol !== shortLeg.symbol) {
      pairedTrade = {
        long:  longLeg,
        short: shortLeg,
        longWinProb:  longLeg.win_rate || 0,
        shortWinProb: 100 - (shortLeg.win_rate || 0),
        combinedEdge: `Long ${longLeg.symbol} wins ${longLeg.win_rate}% of ${(longLeg.positive_years||0)+(longLeg.negative_years||0)} years. Short ${shortLeg.symbol} wins ${(100 - (shortLeg.win_rate || 0)).toFixed(1)}% of ${(shortLeg.positive_years||0)+(shortLeg.negative_years||0)} years.`
      }
    }
  }

  // Build results amplifier if results month
  let resultsAmplifier = null
  if (isResultsMonth && strongLongs.length > 0) {
    const best = strongLongs[0]
    resultsAmplifier = {
      symbol:        best.symbol,
      winRate:       best.win_rate,
      avgReturn:     best.avg_return,
      lot:           best.lot_size,
      entryTiming:   "Enter 7-10 days before results announcement",
      exitStrategy:  `Exit 50% before results. Hold 50% through if ${best.symbol} beats estimates.`,
      note:          `Pre-results drift captures ~60-70% of the monthly move. Don't wait for results to enter.`
    }
  }

  // Compute quality score for the month using per-month year counts
  const avgDataPoints = qualityLongs.slice(0, 5).reduce((a, s) => {
    const totalYears = (s.positive_years || 0) + (s.negative_years || 0)
    return a + totalYears
  }, 0) / Math.max(qualityLongs.slice(0, 5).length, 1)
  const avgWinRate    = strongLongs.slice(0, 3).reduce((a, s) => a + (s.win_rate || 0), 0) /
                        Math.max(strongLongs.slice(0, 3).length, 1)
  const qualityScore  = Math.round((avgDataPoints / 17 * 50) + (avgWinRate / 100 * 50))

  return {
    action,
    dominantSector,
    strongLongs:        strongLongs.slice(0, 3),
    strongShorts:       allShortCandidates.slice(0, 3),
    allQualityLongs:    qualityLongs.slice(0, 10),
    allQualityShorts:   allShortCandidates.slice(0, 5),
    pairedTrade,
    resultsAmplifier,
    isResultsMonth,
    qualityScore,
    dataQualityWarning: avgDataPoints < 10
      ? `⚠ Most top picks have < 10 years of data this month. Signals are less reliable.`
      : null,
    totalQualityStocks:  qualityLongs.length,
    shortCandidateCount: allShortCandidates.length,
  }
}

// Generate plain-English reason for the month's action
function generateReason(monthNum, classification) {
  const { action, dominantSector, strongLongs, strongShorts, isResultsMonth } = classification

  const reasons = {
    1:  "Post-budget anxiety. FII year-end repositioning. No seasonal catalyst for most sectors. Jan is typically the weakest month across stocks with long data history.",
    2:  "FII rebalancing after January. Some defensive stocks begin recovery. Mixed signals — paired trades work better than pure directional bets.",
    3:  "Pre-summer infrastructure pickup. Fiscal year-end government capex deployment. Capital goods and chemicals sectors lead.",
    4:  "Q4 results month. Companies report full-year numbers. Pre-results drift in strong performers. Pharma and defence order books peak.",
    5:  "Summer demand peak. FMCG volumes surge. Monsoon forecast released — strong forecast is positive catalyst for rural consumption stocks.",
    6:  "Post-monsoon onset consumer spending. Pharma prescription volumes rise. Rural demand recovery narrative begins.",
    7:  "Q1 results month. Post-monsoon construction activity picks up. Chemicals and building materials benefit from housing/infra activity.",
    8:  "Historically weak month across most long-history stocks. Most August top picks are recently listed with insufficient data. Capital preservation month.",
    9:  "Best month of the year. Pre-festive season production ramp. Navratri/Dussehra demand buildup. Auto sector leads with highest conviction.",
    10: "Festive season peak. Q2 results month. PSU banks benefit from festive lending volumes. Retail and consumer stocks surge.",
    11: "Post-festive cooldown. FII year-end profit booking begins. Mixed signals — few clean setups with reliable data.",
    12: "Year-end government capex push. Infrastructure spending before March fiscal year-end. Metals benefit from construction activity surge.",
  }

  let base = reasons[monthNum] || ""

  if (action === "FLAT") {
    base += " No stocks clear the 75% win rate threshold with 10+ years of data this month."
  } else if (action === "SHORT" && strongShorts.length > 0) {
    base += ` ${strongShorts[0]?.symbol} has only ${strongShorts[0]?.win_rate}% win rate — ${(100 - strongShorts[0]?.win_rate).toFixed(1)}% short probability.`
  } else if (action === "LONG" && strongLongs.length > 0) {
    base += ` ${strongLongs[0]?.symbol} leads with ${strongLongs[0]?.win_rate}% win rate over ${(strongLongs[0]?.positive_years||0)+(strongLongs[0]?.negative_years||0)} years.`
  }

  if (isResultsMonth) {
    base += " Results month — enter positions 7-10 days before announcement to capture pre-results drift."
  }

  return base
}

// Macro check message per month
function getMacroCheck(monthNum) {
  const checks = {
    1:  "Confirm Nifty 50 below 200 DMA before entering shorts. If above — reduce short size by 50%.",
    2:  "Paired trade reduces market risk. Still set stop losses on both legs independently.",
    3:  "Check fiscal year-end government spending data. Delayed capex → reduce position size.",
    4:  "Enter 7-10 days before results. Exit 50% before announcement. Never hold full position through results.",
    5:  "Watch IMD monsoon forecast (released late May). Strong monsoon = hold longs. Deficient = reduce.",
    6:  "Monsoon progress report mid-June. Normal progress = hold. Deficient = reduce FMCG/rural longs.",
    7:  "Q1 results — enter before announcement on strongest name. Exit 50% before results.",
    8:  "No trades this month for most stocks with reliable data. Prepare September entry plans.",
    9:  "If Nifty above 200 DMA → full position. If below → half position. Never skip this month entirely.",
    10: "Enter Oct 1-3. Exit by Oct 22 before Q2 results. FII festive season selling can override.",
    11: "FII year-end selling pressure. Keep positions small if entering. Better to wait for December.",
    12: "Check steel/infra order book data in November. Strong orders → full metals position in Dec.",
  }
  return checks[monthNum] || "Always confirm Nifty 50 above 200 DMA before long positions."
}

export async function GET() {
  try {
    const MONTH_FULL = ["January","February","March","April","May","June",
      "July","August","September","October","November","December"]

    // Fetch all 12 months in parallel
    const monthPromises = Array.from({ length: 12 }, (_, i) =>
      callMCP("get_monthly_ranking", { month: i + 1, top: 100, sector: "ALL" })
        .catch(err => ({ error: err.message, top_stocks: [], avoid_stocks: [] }))
    )
    const allMonthData = await Promise.all(monthPromises)

    // Build full strategy data for each month
    const strategies = allMonthData.map((monthData, i) => {
      const monthNum       = i + 1
      const monthName      = MONTH_FULL[i]
      const topStocks      = monthData?.top_stocks   || []
      const avoidStocks    = monthData?.avoid_stocks || []
      const classification = classifyMonth(topStocks, avoidStocks, monthNum)
      const reason         = generateReason(monthNum, classification)
      const macroCheck     = getMacroCheck(monthNum)

      return {
        month:               monthNum,
        monthName,
        totalScanned:        monthData?.total_stocks || 0,
        lastUpdated:         monthData?.last_updated  || null,
        action:              classification.action,
        dominantSector:      classification.dominantSector,
        reason,
        macroCheck,
        isResultsMonth:      classification.isResultsMonth,
        qualityScore:        classification.qualityScore,
        dataQualityWarning:  classification.dataQualityWarning,
        totalQualityStocks:  classification.totalQualityStocks,
        // Trade recommendations
        longTrades:          classification.strongLongs,
        shortTrades:         classification.strongShorts,
        pairedTrade:         classification.pairedTrade,
        resultsAmplifier:    classification.resultsAmplifier,
        // All quality stocks for detailed view
        allQualityLongs:     classification.allQualityLongs,
        allQualityShorts:    classification.allQualityShorts,
      }
    })

    return NextResponse.json({
      strategies,
      generated_at:    new Date().toISOString(),
      min_data_points: MIN_DATA_POINTS,
      long_threshold:  LONG_THRESHOLD,
      short_threshold: SHORT_THRESHOLD,
    })

  } catch (err) {
    console.error("Strategies API error:", err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
