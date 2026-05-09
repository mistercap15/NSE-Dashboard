import { NextResponse }      from "next/server"
import { headers }           from "next/headers"
import { getQuote, setAccessToken } from "@/app/lib/upstox"
import { toInstrumentKey }   from "@/app/lib/instruments"
import { sendPositionAlert } from "@/app/lib/email"
import fs   from "fs"
import path from "path"

const CRON_SECRET    = process.env.CRON_SECRET || "nse-cron-2026"
const TOKEN_FILE     = path.join(process.cwd(), ".upstox_token")
const POSITIONS_FILE = path.join(process.cwd(), ".positions_data.json")

function readStoredToken() {
  try { return fs.readFileSync(TOKEN_FILE, "utf8").trim() || null } catch { return null }
}

function readStoredPositions() {
  try { return JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8")) } catch { return [] }
}

function computeRecommendation({ returnPct, medianCapture, avgCapture,
  daysInTrade, daysRemaining, medianReturn, avgReturn }) {
  if (medianCapture >= 90) return {
    action: "EXIT_NOW", priority: "HIGH",
    title: "Exit Now — Median Reached",
    reason: `You have captured ${Math.round(medianCapture)}% of the expected seasonal move. Risk of reversal now exceeds remaining reward.`,
  }
  if (avgCapture >= 100) return {
    action: "EXIT_NOW", priority: "HIGH",
    title: "Exit Now — Exceeded Average Return",
    reason: `Position has exceeded the historical average return of +${avgReturn.toFixed(1)}%. Take the profit.`,
  }
  if (daysRemaining <= 3) return {
    action: "EXIT_NOW", priority: "HIGH",
    title: "Exit Now — Expiry Week",
    reason: `Only ${daysRemaining} days left. Never hold futures into expiry week. Exit regardless of P&L.`,
  }
  if (medianCapture >= 70 && daysRemaining > 3) return {
    action: "TRAIL_STOP", priority: "MEDIUM",
    title: "Trail Your Stop Loss",
    reason: `You have captured ${Math.round(medianCapture)}% of the median move with ${daysRemaining} days left. Lock in 60% of current profit.`,
  }
  if (returnPct > 5 && daysInTrade <= 5) return {
    action: "TRAIL_STOP", priority: "MEDIUM",
    title: "Move Stop to Breakeven",
    reason: `Strong early move of +${returnPct.toFixed(1)}% in just ${daysInTrade} days. Move stop to entry — free trade.`,
  }
  if (daysRemaining <= 8 && medianCapture < 50 && returnPct > 0) return {
    action: "TIME_STOP", priority: "MEDIUM",
    title: "Consider Time Stop",
    reason: `Only ${daysRemaining} days left but only ${Math.round(medianCapture)}% of median captured. Exit if no move in next 2-3 days.`,
  }
  if (daysRemaining <= 8 && returnPct <= 0) return {
    action: "EXIT_NOW", priority: "HIGH",
    title: "Exit — Time Stop Triggered",
    reason: `${daysRemaining} days left and position is not profitable. Cut losses and preserve capital for next month.`,
  }
  if (medianCapture >= 40 && daysRemaining > 8) return {
    action: "HOLD", priority: "LOW",
    title: "Hold — On Track",
    reason: `Position has captured ${Math.round(medianCapture)}% of median with ${daysRemaining} days remaining.`,
  }
  if (returnPct >= 0 && daysInTrade <= 10) return {
    action: "HOLD", priority: "LOW",
    title: "Hold — Early Stage",
    reason: `Trade is ${daysInTrade} days old and in profit. Stay patient — seasonal moves take 10-15 days.`,
  }
  if (returnPct < 0 && returnPct > -3 && daysInTrade <= 10) return {
    action: "WATCH", priority: "LOW",
    title: "Watch — Slightly Negative",
    reason: `Position is -${Math.abs(returnPct).toFixed(1)}% but still within normal range. Monitor closely.`,
  }
  return {
    action: "HOLD", priority: "LOW",
    title: "Hold",
    reason: `Seasonal setup intact. ${daysRemaining} days remaining in window.`,
  }
}

export async function GET() {
  const headersList = await headers()
  const cronHeader  = headersList.get("x-vercel-cron")
  const authHeader  = headersList.get("authorization")
  const isVercel    = cronHeader === "1"
  const hasSecret   = authHeader === `Bearer ${CRON_SECRET}`

  if (!isVercel && !hasSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const token = process.env.UPSTOX_ACCESS_TOKEN || readStoredToken()
    if (!token) {
      return NextResponse.json({
        success: false,
        message: "No Upstox token available — log in to the dashboard first",
      })
    }
    setAccessToken(token)

    const positions = readStoredPositions()
    if (!positions.length) {
      return NextResponse.json({
        success: true,
        message: "No positions saved — add positions in the dashboard first",
      })
    }

    const quotes = await Promise.all(
      positions.map(p =>
        getQuote(toInstrumentKey(p.symbol)).catch(() => null)
      )
    )

    const enriched = positions.map((p, i) => {
      const quote = quotes[i]
      if (!quote) return { ...p, livePrice: null, error: "No live data" }

      const livePrice    = quote.ltp
      const entryPrice   = p.entryPrice
      const lotSize      = p.lotSize      || 1
      const direction    = p.direction    || "LONG"
      const medianReturn = p.medianReturn || 0
      const avgReturn    = p.avgReturn    || 0

      const priceDiff     = direction === "LONG" ? livePrice - entryPrice : entryPrice - livePrice
      const totalPnL      = priceDiff * lotSize
      const returnPct     = (priceDiff / entryPrice) * 100
      const medianCapture = medianReturn > 0 ? (returnPct / medianReturn) * 100 : 0
      const avgCapture    = avgReturn    > 0 ? (returnPct / avgReturn)    * 100 : 0

      const today         = new Date()
      const entryDate     = new Date(p.entryDate)
      const daysInTrade   = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24))
      const daysRemaining = Math.max(0, 25 - today.getDate())

      const recommendation = computeRecommendation({
        returnPct, medianCapture, avgCapture,
        daysInTrade, daysRemaining, medianReturn, avgReturn,
      })

      return {
        ...p,
        livePrice,
        pnl: {
          perShare:      Math.round(priceDiff * 100) / 100,
          total:         Math.round(totalPnL),
          returnPct:     Math.round(returnPct * 100) / 100,
          medianCapture: Math.round(medianCapture),
          avgCapture:    Math.round(avgCapture),
        },
        timing: { daysInTrade, daysRemaining, entryDate: p.entryDate },
        recommendation,
      }
    })

    const validPositions = enriched.filter(p => p.livePrice !== null)
    if (!validPositions.length) {
      return NextResponse.json({
        success: false,
        message: "Upstox returned no quotes — token may have expired",
      })
    }

    const emailResult = await sendPositionAlert(validPositions)

    return NextResponse.json({
      success:   true,
      scannedAt: new Date().toISOString(),
      positions: validPositions.length,
      email:     emailResult,
    })

  } catch (e) {
    console.error("Positions cron error:", e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
