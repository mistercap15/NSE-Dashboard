import { NextResponse } from "next/server"
import { getQuote, setAccessToken } from "@/app/lib/upstox"
import { toInstrumentKey } from "@/app/lib/instruments"

export async function POST(request) {
  const cookie = request.cookies.get("upstox_token")?.value
  if (cookie) setAccessToken(cookie)

  const body      = await request.json()
  const positions = body.positions  || []

  if (positions.length === 0) {
    return NextResponse.json({ positions: [] })
  }

  try {
    // Fetch quotes in parallel using getQuote (same path as early-entry — handles key encoding)
    const quotes = await Promise.all(
      positions.map(p =>
        getQuote(toInstrumentKey(p.symbol)).catch(() => null)
      )
    )

    const enriched = positions.map((p, i) => {
      const quote = quotes[i]

      if (!quote) {
        return { ...p, livePrice: null, error: "No live data" }
      }

      const livePrice    = quote.ltp
      const entryPrice   = p.entryPrice
      const lotSize      = p.lotSize      || 1
      const direction    = p.direction    || "LONG"
      const medianReturn = p.medianReturn || 0
      const avgReturn    = p.avgReturn    || 0

      const priceDiff = direction === "LONG"
        ? livePrice - entryPrice
        : entryPrice - livePrice
      const totalPnL  = priceDiff * lotSize
      const returnPct = (priceDiff / entryPrice) * 100

      const medianCapture = medianReturn > 0 ? (returnPct / medianReturn) * 100 : 0
      const avgCapture    = avgReturn    > 0 ? (returnPct / avgReturn)    * 100 : 0

      const entryDate     = new Date(p.entryDate)
      const today         = new Date()
      const daysInTrade   = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24))
      const daysRemaining = Math.max(0, 25 - today.getDate())

      const recommendation = computeRecommendation({
        returnPct,
        medianCapture,
        avgCapture,
        daysInTrade,
        daysRemaining,
        medianReturn,
        avgReturn,
        totalPnL,
        direction,
      })

      return {
        ...p,
        livePrice,
        quote: {
          change:    quote.change,
          changePct: quote.changePct,
          high:      quote.high,
          low:       quote.low,
          open:      quote.open,
        },
        pnl: {
          perShare:      Math.round(priceDiff * 100) / 100,
          total:         Math.round(totalPnL),
          returnPct:     Math.round(returnPct * 100) / 100,
          medianCapture: Math.round(medianCapture),
          avgCapture:    Math.round(avgCapture),
        },
        timing: {
          daysInTrade,
          daysRemaining,
          entryDate: p.entryDate,
        },
        recommendation,
      }
    })

    const totalPnL = enriched.reduce((sum, p) => sum + (p.pnl?.total || 0), 0)

    return NextResponse.json({
      positions:  enriched,
      totalPnL,
      fetchedAt:  new Date().toISOString(),
    })

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

function computeRecommendation({
  returnPct, medianCapture, avgCapture,
  daysInTrade, daysRemaining,
  medianReturn, avgReturn, totalPnL, direction,
}) {
  // EXIT NOW conditions
  if (medianCapture >= 90) {
    return {
      action:   "EXIT_NOW",
      priority: "HIGH",
      color:    "green",
      title:    "Exit Now — Median Reached",
      reason:   `You have captured ${Math.round(medianCapture)}% of the expected seasonal move. This is the statistical target. Risk of reversal now exceeds remaining reward.`,
      detail:   `Remaining potential: +${(medianReturn - returnPct).toFixed(1)}% | Risk of reversal: full ${returnPct.toFixed(1)}%`,
    }
  }

  if (avgCapture >= 100) {
    return {
      action:   "EXIT_NOW",
      priority: "HIGH",
      color:    "green",
      title:    "Exit Now — Exceeded Average Return",
      reason:   `Position has exceeded the historical average return of +${avgReturn.toFixed(1)}%. You are now in exceptional territory. Take the profit.`,
      detail:   `Captured ${Math.round(avgCapture)}% of average return — outstanding result`,
    }
  }

  if (daysRemaining <= 3) {
    return {
      action:   "EXIT_NOW",
      priority: "HIGH",
      color:    "amber",
      title:    "Exit Now — Expiry Week",
      reason:   `Only ${daysRemaining} days left in the month. Never hold futures into expiry week. Exit regardless of P&L.`,
      detail:   "Time stop: expiry week rule — always exit by 25th",
    }
  }

  // TRAIL STOP conditions
  if (medianCapture >= 70 && daysRemaining > 3) {
    return {
      action:   "TRAIL_STOP",
      priority: "MEDIUM",
      color:    "accent",
      title:    "Trail Your Stop Loss",
      reason:   `You have captured ${Math.round(medianCapture)}% of the median move with ${daysRemaining} days left. Move your stop loss to lock in 60% of current profit.`,
      detail:   `Move SL to lock-in level — if hit, you keep 60% of current profit`,
    }
  }

  if (returnPct > 5 && daysInTrade <= 5) {
    return {
      action:   "TRAIL_STOP",
      priority: "MEDIUM",
      color:    "accent",
      title:    "Move Stop to Breakeven",
      reason:   `Strong early move of +${returnPct.toFixed(1)}% in just ${daysInTrade} days. Move your stop loss to entry price — you now have a free trade.`,
      detail:   "Early fast move — protect capital, let remaining run freely",
    }
  }

  // TIME STOP conditions
  if (daysRemaining <= 8 && medianCapture < 50 && returnPct > 0) {
    return {
      action:   "TIME_STOP",
      priority: "MEDIUM",
      color:    "amber",
      title:    "Consider Time Stop",
      reason:   `Only ${daysRemaining} days left but only ${Math.round(medianCapture)}% of median captured. Seasonal edge weakens after the 15th. Position may not reach target in time.`,
      detail:   `Exit if no significant move in next 2-3 days`,
    }
  }

  if (daysRemaining <= 8 && returnPct <= 0) {
    return {
      action:   "EXIT_NOW",
      priority: "HIGH",
      color:    "red",
      title:    "Exit — Time Stop Triggered",
      reason:   `${daysRemaining} days left and position is not profitable. The seasonal move has not played out. Cut losses and preserve capital for next month.`,
      detail:   "Time stop: 8 days remaining with no profit = exit signal",
    }
  }

  // HOLD conditions
  if (medianCapture >= 40 && daysRemaining > 8) {
    return {
      action:   "HOLD",
      priority: "LOW",
      color:    "green",
      title:    "Hold — On Track",
      reason:   `Position has captured ${Math.round(medianCapture)}% of median with ${daysRemaining} days remaining. Seasonal move is playing out as expected.`,
      detail:   `Target: +${medianReturn.toFixed(1)}% | Remaining: +${(medianReturn - returnPct).toFixed(1)}%`,
    }
  }

  if (returnPct >= 0 && daysInTrade <= 10) {
    return {
      action:   "HOLD",
      priority: "LOW",
      color:    "accent",
      title:    "Hold — Early Stage",
      reason:   `Trade is ${daysInTrade} days old and in profit. Seasonal moves often take 10-15 days to fully play out. Stay patient.`,
      detail:   `${daysRemaining} days remaining in the seasonal window`,
    }
  }

  // WATCH — slightly negative
  if (returnPct < 0 && returnPct > -3 && daysInTrade <= 10) {
    return {
      action:   "WATCH",
      priority: "LOW",
      color:    "amber",
      title:    "Watch — Slightly Negative",
      reason:   `Position is -${Math.abs(returnPct).toFixed(1)}% but still within normal noise range. Seasonal setup still intact. Monitor closely.`,
      detail:   `Stop loss should be set — check it is in place`,
    }
  }

  // Default HOLD
  return {
    action:   "HOLD",
    priority: "LOW",
    color:    "dim",
    title:    "Hold",
    reason:   `Seasonal setup intact. ${daysRemaining} days remaining in window.`,
    detail:   `Target: +${medianReturn.toFixed(1)}% | Current: ${returnPct.toFixed(1)}%`,
  }
}

