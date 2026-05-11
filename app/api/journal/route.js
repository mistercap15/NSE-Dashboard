import { NextResponse } from "next/server"
import {
  loadJournal, saveJournal,
  createSignalEntry, createPositionEntry,
  convertSignalToLive, closeLiveEntry,
  markSignalMissed, findExistingSignalEntry,
  computeStats,
} from "@/app/lib/journal"

// GET — all entries + stats
export async function GET() {
  try {
    const entries = await loadJournal()
    const stats   = computeStats(entries)
    return NextResponse.json({ entries, stats })
  } catch(e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST — create entry
// body: { action, ...payload }
// actions: "signal" | "position" | "convert" | "close" | "missed" | "notes"
export async function POST(request) {
  try {
    const body    = await request.json()
    const entries = await loadJournal()
    const { action } = body

    if (action === "signal") {
      // Called by early-entry scanner for each BUY/BUY_HALF signal
      const { signal, targetMonth } = body

      // Deduplication — same stock same month
      const existing = findExistingSignalEntry(entries, signal.symbol, targetMonth)
      if (existing) {
        // Update signal score if improved
        const idx = entries.findIndex(e => e.id === existing.id)
        if ((signal.signal?.score || 0) > (existing.signalScore || 0)) {
          entries[idx].signalScore   = signal.signal?.score
          entries[idx].signalGrade   = signal.signal?.grade?.label
          entries[idx].signalStatus  = signal.status
          entries[idx].updatedAt     = new Date().toISOString()
          await saveJournal(entries)
          return NextResponse.json({ entry: entries[idx], action: "updated" })
        }
        return NextResponse.json({ entry: existing, action: "exists" })
      }

      const entry = createSignalEntry(signal, targetMonth)
      entries.push(entry)
      await saveJournal(entries)
      return NextResponse.json({ entry, action: "created" })
    }

    if (action === "position") {
      // Called by Monitor when position is added
      const { position, isTest } = body

      // Check if a signal entry exists for this stock + month
      const existing = findExistingSignalEntry(
        entries, position.symbol, position.targetMonth
      )

      if (existing && !isTest) {
        // Convert signal to live trade
        const idx     = entries.findIndex(e => e.id === existing.id)
        entries[idx]  = convertSignalToLive(existing, position)
        await saveJournal(entries)
        return NextResponse.json({ entry: entries[idx], action: "signal_converted" })
      }

      // No signal entry exists — create new
      const entry = createPositionEntry(position, isTest)
      entries.push(entry)
      await saveJournal(entries)
      return NextResponse.json({ entry, action: "created" })
    }

    if (action === "close") {
      // Called by Monitor exit dialog
      const { positionId, exitPrice, exitReason } = body
      const idx = entries.findIndex(e =>
        e.positionId === positionId && e.status === "LIVE_OPEN"
      )
      if (idx === -1) {
        // Try test close
        const tidx = entries.findIndex(e =>
          e.positionId === positionId && e.status === "TEST_OPEN"
        )
        if (tidx !== -1) {
          entries[tidx].status    = "TEST_CLOSED"
          entries[tidx].exitDate  = new Date().toISOString().slice(0,10)
          entries[tidx].exitPrice = exitPrice
          entries[tidx].updatedAt = new Date().toISOString()
          await saveJournal(entries)
          return NextResponse.json({ entry: entries[tidx], action: "test_closed" })
        }
        return NextResponse.json({ error: "Entry not found" }, { status: 404 })
      }
      entries[idx] = closeLiveEntry(entries[idx], exitPrice, exitReason)
      await saveJournal(entries)
      return NextResponse.json({ entry: entries[idx], action: "closed" })
    }

    if (action === "missed") {
      // Mark a signal as missed with current market price
      const { entryId, priceAtMonthEnd } = body
      const idx = entries.findIndex(e => e.id === entryId)
      if (idx === -1) return NextResponse.json(
        { error: "Entry not found" }, { status: 404 }
      )
      entries[idx] = markSignalMissed(entries[idx], priceAtMonthEnd)
      await saveJournal(entries)
      return NextResponse.json({ entry: entries[idx], action: "missed" })
    }

    if (action === "notes") {
      const { entryId, notes } = body
      const idx = entries.findIndex(e => e.id === entryId)
      if (idx === -1) return NextResponse.json(
        { error: "Entry not found" }, { status: 404 }
      )
      entries[idx].notes     = notes
      entries[idx].updatedAt = new Date().toISOString()
      await saveJournal(entries)
      return NextResponse.json({ entry: entries[idx] })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch(e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
