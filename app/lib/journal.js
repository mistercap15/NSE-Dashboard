import { readFile, writeFile, mkdir } from "fs/promises"
import { join } from "path"

const JOURNAL_FILE = join(process.cwd(), "data", "journal.json")

export async function loadJournal() {
  try {
    const content = await readFile(JOURNAL_FILE, "utf-8")
    return JSON.parse(content)
  } catch { return [] }
}

export async function saveJournal(entries) {
  await mkdir(join(process.cwd(), "data"), { recursive: true })
  await writeFile(JOURNAL_FILE, JSON.stringify(entries, null, 2), "utf-8")
}

// ── Entry types ───────────────────────────────────────────────────
// AUTO_SIGNAL : scanner fired BUY/BUY_HALF — you may or may not enter
// LIVE        : you added to Monitor as real trade
// TEST        : you added to Monitor marked as test/paper

// ── Create entry from scanner signal ─────────────────────────────
export function createSignalEntry(signal, targetMonth) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun",
                  "Jul","Aug","Sep","Oct","Nov","Dec"]
  return {
    id:             `signal_${signal.symbol}_${targetMonth}_${Date.now()}`,
    type:           "AUTO_SIGNAL",
    status:         "SIGNAL_OPEN",
    // SIGNAL_OPEN    → signal fired, waiting to see if entered
    // SIGNAL_MISSED  → month ended, never entered
    // SIGNAL_TAKEN   → converted to LIVE trade
    // LIVE_OPEN      → active real trade
    // LIVE_CLOSED    → trade completed, graded
    // TEST_OPEN      → test trade active
    // TEST_CLOSED    → test trade completed, not graded

    symbol:         signal.symbol,
    sector:         signal.sector || "",
    direction:      "LONG",
    targetMonth,
    targetMonthName: MONTHS[targetMonth - 1],

    // Signal details at time of scan
    signalScore:    signal.signal?.score || null,
    signalGrade:    signal.signal?.grade?.label || null,
    signalStatus:   signal.status, // BUY or BUY_HALF
    checklistResult: signal.checklist?.result || null,
    winRate:        signal.nextMonth?.win_rate || null,
    medianReturn:   signal.nextMonth?.median_return || null,
    avgReturn:      signal.nextMonth?.avg_return || null,
    supportPrice:   signal.support?.nearest?.price || null,
    supportType:    signal.support?.nearest?.type || null,
    currentPriceAtScan: signal.price?.current || null,

    // Entry details (filled if you enter)
    entryDate:   null,
    entryPrice:  null,
    lotSize:     null,
    lots:        null,
    notional:    null,
    positionId:  null, // links to Monitor position

    // Exit details (filled when closed)
    exitDate:    null,
    exitPrice:   null,
    exitReason:  null,

    // Outcome (computed after exit or month end)
    returnPct:      null,
    profitLoss:     null,
    medianCapture:  null,
    daysHeld:       null,
    priceAtMonthEnd: null, // for missed signals

    // Grades (computed after close)
    tradeGrade:    null,
    decisionGrade: null,

    // Meta
    notes:     "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

// ── Create entry from Monitor position ───────────────────────────
export function createPositionEntry(position, isTest = false) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun",
                  "Jul","Aug","Sep","Oct","Nov","Dec"]
  return {
    id:             `pos_${position.id}_${Date.now()}`,
    type:           isTest ? "TEST" : "LIVE",
    status:         isTest ? "TEST_OPEN" : "LIVE_OPEN",

    symbol:         position.symbol,
    sector:         position.sector || "",
    direction:      position.direction || "LONG",
    targetMonth:    position.targetMonth,
    targetMonthName: MONTHS[(position.targetMonth || 1) - 1],

    // No signal details — manual entry
    signalScore:    null,
    signalGrade:    null,
    signalStatus:   "MANUAL",
    checklistResult: null,
    winRate:        position.winRate     || null,
    medianReturn:   position.medianReturn || null,
    avgReturn:      position.avgReturn   || null,
    supportPrice:   null,
    supportType:    null,
    currentPriceAtScan: null,

    // Entry details
    entryDate:   position.entryDate,
    entryPrice:  position.entryPrice,
    lotSize:     position.lotSize,
    lots:        1,
    notional:    position.entryPrice * position.lotSize,
    positionId:  position.id,

    // Exit (filled on close)
    exitDate:    null,
    exitPrice:   null,
    exitReason:  null,

    returnPct:      null,
    profitLoss:     null,
    medianCapture:  null,
    daysHeld:       null,
    priceAtMonthEnd: null,

    tradeGrade:    null,
    decisionGrade: null,

    notes:     "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

// ── Convert signal entry to live trade (when you enter) ──────────
export function convertSignalToLive(entry, position) {
  return {
    ...entry,
    type:        "LIVE",
    status:      "LIVE_OPEN",
    signalStatus: entry.signalStatus, // keep original BUY/BUY_HALF
    entryDate:   position.entryDate,
    entryPrice:  position.entryPrice,
    lotSize:     position.lotSize,
    lots:        1,
    notional:    position.entryPrice * position.lotSize,
    positionId:  position.id,
    updatedAt:   new Date().toISOString(),
  }
}

// ── Close a live entry ────────────────────────────────────────────
export function closeLiveEntry(entry, exitPrice, exitReason) {
  const entryPrice   = entry.entryPrice
  const lotSize      = entry.lotSize || 0
  const direction    = entry.direction
  const medianReturn = entry.medianReturn || 0

  const priceDiff  = direction === "LONG"
    ? exitPrice - entryPrice
    : entryPrice - exitPrice
  const returnPct  = (priceDiff / entryPrice) * 100
  const profitLoss = priceDiff * lotSize

  const medianCapture = medianReturn > 0
    ? (returnPct / medianReturn) * 100 : 0

  const entryDate = new Date(entry.entryDate)
  const exitDate  = new Date()
  const daysHeld  = Math.floor(
    (exitDate - entryDate) / (1000 * 60 * 60 * 24)
  )

  const tradeGrade    = computeTradeGrade(medianCapture, returnPct, exitReason)
  const decisionGrade = computeDecisionGrade(
    entry.signalScore, medianCapture, exitReason, daysHeld
  )

  return {
    ...entry,
    status:     "LIVE_CLOSED",
    exitDate:   exitDate.toISOString().slice(0, 10),
    exitPrice,
    exitReason,
    returnPct:     Math.round(returnPct * 100) / 100,
    profitLoss:    Math.round(profitLoss),
    medianCapture: Math.round(medianCapture),
    daysHeld,
    tradeGrade,
    decisionGrade,
    updatedAt: new Date().toISOString(),
  }
}

// ── Mark signal as missed (called at month end or manually) ───────
export function markSignalMissed(entry, priceAtMonthEnd) {
  const actualMove = entry.currentPriceAtScan
    ? ((priceAtMonthEnd - entry.currentPriceAtScan)
       / entry.currentPriceAtScan * 100)
    : null

  return {
    ...entry,
    status:          "SIGNAL_MISSED",
    priceAtMonthEnd,
    returnPct:       actualMove ? Math.round(actualMove * 100) / 100 : null,
    missedProfitLoss: actualMove && entry.currentPriceAtScan && entry.lotSize
      ? Math.round(
          (actualMove / 100) * entry.currentPriceAtScan * (entry.lotSize || 0)
        )
      : null,
    updatedAt: new Date().toISOString(),
  }
}

// ── Deduplicate signal entries ────────────────────────────────────
// Same stock + same target month = don't create new entry
// Just update the signal score if it improved
export function findExistingSignalEntry(entries, symbol, targetMonth) {
  return entries.find(e =>
    e.symbol === symbol &&
    e.targetMonth === targetMonth &&
    (e.status === "SIGNAL_OPEN" || e.status === "LIVE_OPEN")
  ) || null
}

// ── Grade functions ───────────────────────────────────────────────
export function computeTradeGrade(medianCapture, returnPct, exitReason) {
  if (exitReason === "STOP_LOSS" || returnPct < 0) return {
    grade: "F", label: "Loss", color: "red",
    detail: exitReason === "STOP_LOSS"
      ? "Stop loss hit — full loss"
      : `Negative return: ${returnPct?.toFixed(1)}%`
  }
  if (medianCapture >= 120) return { grade: "A+", label: "Exceptional",   color: "green",  detail: `Captured ${Math.round(medianCapture)}% of median — beat expectations` }
  if (medianCapture >= 90)  return { grade: "A",  label: "On Target",     color: "green",  detail: `Captured ${Math.round(medianCapture)}% of median — system worked` }
  if (medianCapture >= 70)  return { grade: "B+", label: "Good",          color: "blue",   detail: `Captured ${Math.round(medianCapture)}% of median — solid` }
  if (medianCapture >= 50)  return { grade: "B",  label: "Acceptable",    color: "amber",  detail: `Captured ${Math.round(medianCapture)}% of median` }
  if (medianCapture >= 25)  return { grade: "C",  label: "Below Target",  color: "amber",  detail: `Only ${Math.round(medianCapture)}% captured — exited too early?` }
  return                           { grade: "D",  label: "Poor",          color: "red",    detail: `Only ${Math.round(medianCapture)}% captured` }
}

export function computeDecisionGrade(
  signalScore, medianCapture, exitReason, daysHeld
) {
  let score = 100
  const notes = []

  if (signalScore !== null) {
    if (signalScore < 55) {
      score -= 25
      notes.push("Entered below recommended threshold (55+)")
    } else if (signalScore < 65) {
      score -= 10
      notes.push("Borderline signal — B grade entry")
    } else if (signalScore >= 75) {
      notes.push("Strong signal — system confirmed entry")
    }
  } else {
    notes.push("Manual entry — no signal score")
  }

  if (exitReason === "STOP_LOSS")      { notes.push("Stop loss respected — good discipline") }
  else if (exitReason === "MEDIAN_REACHED") { score += 10; notes.push("Exited at median — textbook") }
  else if (exitReason === "AVG_REACHED")    { score += 15; notes.push("Held to average — exceptional") }
  else if (exitReason === "TIME_STOP")      { notes.push("Time stop — good risk management") }
  else if (exitReason === "MANUAL") {
    if (medianCapture >= 90)      { score += 5;  notes.push("Manual exit near target — good instinct") }
    else if (medianCapture < 40)  { score -= 15; notes.push("Exited too early — left gains behind") }
    else                          { notes.push("Manual exit — partial capture") }
  }

  if (daysHeld > 25) { score -= 10; notes.push("Held past monthly window") }

  const grade =
    score >= 95 ? { grade: "A+", label: "Perfect",   color: "green" } :
    score >= 85 ? { grade: "A",  label: "Good",       color: "green" } :
    score >= 70 ? { grade: "B+", label: "Solid",      color: "blue"  } :
    score >= 55 ? { grade: "B",  label: "Acceptable", color: "amber" } :
    score >= 40 ? { grade: "C",  label: "Improve",    color: "amber" } :
                  { grade: "D",  label: "Poor",        color: "red"   }

  return { ...grade, score, notes }
}

// ── Compute stats (only LIVE trades) ─────────────────────────────
export function computeStats(entries) {
  // Only grade LIVE closed trades in stats
  const live = entries.filter(e => e.status === "LIVE_CLOSED")
  const signals = entries.filter(e =>
    e.type === "AUTO_SIGNAL" &&
    (e.status === "SIGNAL_MISSED" || e.status === "SIGNAL_TAKEN" ||
     e.status === "LIVE_CLOSED")
  )
  const missed  = entries.filter(e => e.status === "SIGNAL_MISSED")
  const open    = entries.filter(e =>
    e.status === "LIVE_OPEN" || e.status === "SIGNAL_OPEN"
  )
  const tests   = entries.filter(e =>
    e.status === "TEST_OPEN" || e.status === "TEST_CLOSED"
  )

  if (live.length === 0) return {
    hasData: false, live, signals, missed, open, tests
  }

  const wins      = live.filter(e => (e.returnPct || 0) > 0)
  const losses    = live.filter(e => (e.returnPct || 0) <= 0)
  const totalPnL  = live.reduce((s, e) => s + (e.profitLoss || 0), 0)
  const avgCap    = live.reduce((s, e) => s + (e.medianCapture || 0), 0) / live.length

  // Missed opportunity cost
  const missedPnL = missed.reduce((s, e) => s + (e.missedProfitLoss || 0), 0)

  // Signal accuracy by grade
  const byGrade = {}
  live.filter(e => e.signalGrade).forEach(e => {
    const g = e.signalGrade
    if (!byGrade[g]) byGrade[g] = []
    byGrade[g].push(e.medianCapture || 0)
  })
  const signalAccuracy = Object.entries(byGrade).map(([grade, caps]) => ({
    grade,
    trades: caps.length,
    avgCapture: Math.round(caps.reduce((s,c) => s+c, 0) / caps.length),
  }))

  // Monthly breakdown
  const byMonth = {}
  live.forEach(e => {
    const key = e.targetMonthName
    if (!byMonth[key]) byMonth[key] = []
    byMonth[key].push(e)
  })

  const grades = {"A+":0,"A":0,"B+":0,"B":0,"C":0,"D":0,"F":0}
  live.forEach(e => {
    if (e.tradeGrade?.grade) grades[e.tradeGrade.grade]++
  })

  const sortedByReturn = [...live].sort((a,b) => (b.returnPct||0)-(a.returnPct||0))

  return {
    hasData:         true,
    totalLive:       live.length,
    wins:            wins.length,
    losses:          losses.length,
    winRate:         Math.round((wins.length / live.length) * 100),
    totalPnL:        Math.round(totalPnL),
    avgMedianCapture: Math.round(avgCap),
    missedPnL:       Math.round(missedPnL),
    grades,
    signalAccuracy,
    byMonth,
    bestTrade:       sortedByReturn[0] || null,
    worstTrade:      sortedByReturn[sortedByReturn.length - 1] || null,
    live, signals, missed, open, tests,
  }
}
