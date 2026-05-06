// ── Moving averages ───────────────────────────────────────────────
export function sma(closes, period) {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

// ── Swing low detection ───────────────────────────────────────────
// A swing low is a candle whose low is lower than
// the 'lookback' candles before AND after it
export function findSwingLows(candles, lookback = 3) {
  const lows    = candles.map(c => c.low)
  const swings  = []
  for (let i = lookback; i < lows.length - lookback; i++) {
    const window = lows.slice(i - lookback, i + lookback + 1)
    const pivot  = lows[i]
    if (pivot === Math.min(...window)) {
      swings.push({ price: pivot, date: candles[i].date, index: i })
    }
  }
  // Return last 3 swing lows, most recent first
  return swings.slice(-3).reverse()
}

// ── Support zone computation ──────────────────────────────────────
export function computeSupportZones(candles, currentPrice) {
  if (!candles || candles.length < 20) {
    return { zones: [], nearest: null, isNearSupport: false }
  }

  const closes  = candles.map(c => c.close)
  const lows    = candles.map(c => c.low)
  const zones   = []

  // MA20 (~4 weeks)
  const ma20 = sma(closes, Math.min(20, closes.length))
  if (ma20) zones.push({ price: Math.round(ma20 * 100) / 100, type: "MA20", strength: "MEDIUM" })

  // MA50 (~10 weeks) — strongest support
  const ma50 = sma(closes, Math.min(50, closes.length))
  if (ma50) zones.push({ price: Math.round(ma50 * 100) / 100, type: "MA50", strength: "STRONG" })

  // MA10 (~2 weeks) — short term
  const ma10 = sma(closes, Math.min(10, closes.length))
  if (ma10) zones.push({ price: Math.round(ma10 * 100) / 100, type: "MA10", strength: "WEAK" })

  // Previous month low (last 22 trading days)
  const prevMonthLows  = lows.slice(-22)
  const prevMonthLow   = Math.min(...prevMonthLows)
  zones.push({ price: prevMonthLow, type: "PREV_MONTH_LOW", strength: "STRONG" })

  // 52-week low zone
  const yearLow = Math.min(...lows.slice(-252))
  zones.push({ price: yearLow, type: "52W_LOW", strength: "VERY_STRONG" })

  // Swing lows
  const swings = findSwingLows(candles)
  swings.forEach(s => {
    zones.push({ price: s.price, type: "SWING_LOW", strength: "STRONG", date: s.date })
  })

  // Filter: only zones BELOW current price (support, not resistance)
  // and not more than 20% below (irrelevant if too far)
  const supportZones = zones
    .filter(z => z.price <= currentPrice && z.price >= currentPrice * 0.80)
    .sort((a, b) => b.price - a.price) // closest below first

  // Distance from current price to nearest support
  const nearest = supportZones[0] || null
  const distancePct = nearest
    ? ((currentPrice - nearest.price) / currentPrice * 100)
    : null

  return {
    zones:          supportZones,
    nearest,
    second:         supportZones[1] || null,
    distancePct:    distancePct ? Math.round(distancePct * 10) / 10 : null,
    isNearSupport:  distancePct !== null && distancePct <= 3.0,
    isAtSupport:    distancePct !== null && distancePct <= 0.8,
  }
}

// ── Price context ─────────────────────────────────────────────────
export function computePriceContext(candles, currentPrice) {
  if (!candles || candles.length < 10) return null

  const closes = candles.map(c => c.close)

  const ma10  = sma(closes, Math.min(10, closes.length))
  const ma20  = sma(closes, Math.min(20, closes.length))
  const ma50  = sma(closes, Math.min(50, closes.length))

  // Momentum: recent 5 days vs previous 5 days
  const recent5  = sma(closes.slice(-5),  5)
  const prev5    = sma(closes.slice(-10, -5), 5)
  const momentum = prev5 ? ((recent5 - prev5) / prev5 * 100) : 0

  // Position in monthly range
  const monthCloses  = closes.slice(-22)
  const monthHigh    = Math.max(...candles.slice(-22).map(c => c.high))
  const monthLow     = Math.min(...candles.slice(-22).map(c => c.low))
  const monthRange   = monthHigh - monthLow
  const posInRange   = monthRange > 0
    ? ((currentPrice - monthLow) / monthRange * 100)
    : 50

  // From 52-week high
  const yearHigh    = Math.max(...candles.slice(-252).map(c => c.high))
  const pctFromHigh = ((currentPrice - yearHigh) / yearHigh * 100)

  return {
    ma10, ma20, ma50,
    momentum:         Math.round(momentum * 100) / 100,
    positionInRange:  Math.round(posInRange),
    pctFromMa20:      ma20 ? Math.round((currentPrice - ma20) / ma20 * 1000) / 10 : null,
    pctFromMa50:      ma50 ? Math.round((currentPrice - ma50) / ma50 * 1000) / 10 : null,
    pctFromYearHigh:  Math.round(pctFromHigh * 10) / 10,
    isAboveMa20:      ma20 ? currentPrice > ma20 : null,
    isAboveMa50:      ma50 ? currentPrice > ma50 : null,
    isBelowMa20:      ma20 ? currentPrice < ma20 : null,
    isBelowMa50:      ma50 ? currentPrice < ma50 : null,
    monthHigh, monthLow,
  }
}

// ── Signal scoring ────────────────────────────────────────────────
export function computeSignalScore(seasonality, context, support, dipType) {
  let score   = 0
  const reasons = []

  // Seasonality component (max 40 pts)
  const nextWR    = seasonality.nextMonth?.win_rate || 0
  const currentWR = seasonality.currentMonth?.win_rate || 50

  if (nextWR >= 90)      { score += 40; reasons.push(`Very strong next month: ${nextWR}% WR`) }
  else if (nextWR >= 80) { score += 32; reasons.push(`Strong next month: ${nextWR}% WR`) }
  else if (nextWR >= 75) { score += 24; reasons.push(`Good next month: ${nextWR}% WR`) }
  else if (nextWR >= 65) { score += 14; reasons.push(`Moderate next month: ${nextWR}% WR`) }

  if (currentWR <= 35)   { score += 10; reasons.push("Current month very weak — dip expected") }
  else if (currentWR <= 50) { score += 6; reasons.push("Current month weak") }
  else if (currentWR <= 60) { score += 3; reasons.push("Current month neutral") }

  // Technical component (max 40 pts)
  if (support?.isAtSupport) {
    const s = support.nearest?.strength
    if (s === "VERY_STRONG") { score += 20; reasons.push(`At very strong support: ${support.nearest.type}`) }
    else if (s === "STRONG") { score += 16; reasons.push(`At strong support: ${support.nearest.type}`) }
    else                     { score += 10; reasons.push(`Near support: ${support.nearest.type}`) }
  } else if (support?.isNearSupport) {
    score += 8
    reasons.push(`Approaching support: ${support.nearest?.type} (${support.distancePct}% away)`)
  }

  if (context?.isBelowMa20) { score += 8; reasons.push("Below MA20 — discounted entry") }
  if (context?.isBelowMa50) { score += 6; reasons.push("Below MA50 — strong value zone") }

  if (context?.momentum >= -1 && context?.momentum < 0) {
    score += 6; reasons.push("Selling momentum slowing")
  } else if (context?.momentum >= 0) {
    score += 3; reasons.push("Momentum turning positive")
  }

  if (context?.positionInRange <= 20)      { score += 10; reasons.push("Near monthly low") }
  else if (context?.positionInRange <= 40) { score += 5;  reasons.push("Lower half of monthly range") }

  // Dip type bonus (max 20 pts)
  const dipScores = {
    RESULTS_DIP_GOOD:   { pts: 20, label: "⭐ Post-results dip on good numbers" },
    SECTOR_ROTATION:    { pts: 14, label: "Sector rotation — stock-specific fine" },
    MARKET_SELLOFF:     { pts: 10, label: "Broad market fear — macro driven" },
    RANDOM_DRIFT:       { pts: 6,  label: "Normal monthly drift" },
    NO_DIP:             { pts: 2,  label: "No significant dip yet" },
    FUNDAMENTAL_ISSUE:  { pts: 0,  label: "⚠ Fundamental concern" },
  }
  const dip = dipScores[dipType] || dipScores.RANDOM_DRIFT
  score += dip.pts
  reasons.push(dip.label)

  // Cap fundamental concern at 55
  if (dipType === "FUNDAMENTAL_ISSUE") score = Math.min(score, 55)

  // Grade
  const grade =
    score >= 85 ? { label: "A+", action: "STRONG BUY — Enter full 1 lot now",   color: "green"  } :
    score >= 75 ? { label: "A",  action: "BUY — Enter 1 lot",                    color: "green"  } :
    score >= 65 ? { label: "B+", action: "BUY HALF — Enter, add on dip",         color: "amber"  } :
    score >= 55 ? { label: "B",  action: "WATCH — Set price alert",              color: "amber"  } :
    score >= 40 ? { label: "C",  action: "MONITOR — Below entry threshold",      color: "orange" } :
                  { label: "D",  action: "SKIP — Conditions not met",            color: "red"    }

  return { score, grade, reasons }
}
