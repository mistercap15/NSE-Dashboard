"use client"
import { useState, useEffect } from "react"
import Sidebar from "../components/Sidebar"
import {
  loadJournal, saveJournal,
  markSignalMissed, computeStats,
} from "../lib/journal"

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun",
                "Jul","Aug","Sep","Oct","Nov","Dec"]

// ── Small components ──────────────────────────────────────────────
function GradeBadge({ grade, size = "sm" }) {
  const colors = {
    "A+": "bg-green/15 text-green border-green/30",
    "A":  "bg-green/10 text-green border-green/20",
    "B+": "bg-accent/15 text-accent border-accent/30",
    "B":  "bg-amber/15 text-amber border-amber/30",
    "C":  "bg-orange-500/15 text-orange-400 border-orange-500/30",
    "D":  "bg-red/10 text-red border-red/20",
    "F":  "bg-red/15 text-red border-red/30",
  }
  const sz = size === "lg"
    ? "text-[14px] px-3 py-1 font-bold"
    : "text-[10px] px-2 py-0.5 font-bold"
  return (
    <span className={`font-mono rounded border ${sz}
      ${colors[grade] || "text-dim border-border"}`}>
      {grade}
    </span>
  )
}

function TypeBadge({ type, status }) {
  const styles = {
    AUTO_SIGNAL: "bg-accent/10 text-accent border-accent/20",
    LIVE:        "bg-green/10 text-green border-green/20",
    TEST:        "bg-amber/10 text-amber border-amber/20",
  }
  const labels = {
    AUTO_SIGNAL: "Auto Signal",
    LIVE:        "Live Trade",
    TEST:        "Paper Trade",
  }
  const statusLabels = {
    SIGNAL_OPEN:    "Watching",
    SIGNAL_MISSED:  "Missed",
    SIGNAL_TAKEN:   "Taken",
    LIVE_OPEN:      "Open",
    LIVE_CLOSED:    "Closed",
    TEST_OPEN:      "Testing",
    TEST_CLOSED:    "Done",
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className={`font-mono text-[9px] px-2 py-0.5 rounded
        border ${styles[type] || "text-dim border-border"}`}>
        {labels[type] || type}
      </span>
      <span className="font-mono text-[9px] text-dim">
        {statusLabels[status] || status}
      </span>
    </div>
  )
}

function StatCard({ label, value, sub, color = "text-text" }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="font-mono text-[10px] text-dim uppercase
        tracking-widest mb-1">{label}</div>
      <div className={`font-mono text-xl font-bold ${color}`}>
        {value}
      </div>
      {sub && (
        <div className="font-mono text-[10px] text-muted mt-1">{sub}</div>
      )}
    </div>
  )
}

function MissedCard({ entry, onMarkMissed }) {
  const [exitPrice, setExitPrice] = useState("")
  const [scanPrice, setScanPrice] = useState("")
  const needsScanPrice = !entry.currentPriceAtScan
  const canSubmit = exitPrice && (!needsScanPrice || scanPrice)
  return (
    <div className="bg-amber/5 border border-amber/20 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-mono text-sm font-bold text-accent">
            {entry.symbol}
          </span>
          <span className="font-mono text-[10px] text-dim ml-2">
            Signal fired {new Date(entry.createdAt)
              .toLocaleDateString("en-IN")} · never entered
          </span>
        </div>
        <div className="font-mono text-[10px] text-amber">
          Signal: {entry.signalScore}/100 · {entry.winRate?.toFixed(1)}% WR
        </div>
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        {needsScanPrice && (
          <input
            type="number"
            value={scanPrice}
            onChange={e => setScanPrice(e.target.value)}
            placeholder="Price when signal fired"
            className="flex-1 min-w-[160px] bg-bg border border-border rounded
              px-3 py-1.5 font-mono text-[12px] text-text
              placeholder-muted focus:border-accent focus:outline-none"
          />
        )}
        <input
          type="number"
          value={exitPrice}
          onChange={e => setExitPrice(e.target.value)}
          placeholder={`${entry.targetMonthName} end price`}
          className="flex-1 min-w-[160px] bg-bg border border-border rounded
            px-3 py-1.5 font-mono text-[12px] text-text
            placeholder-muted focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => canSubmit && onMarkMissed(
            entry.id,
            parseFloat(exitPrice),
            needsScanPrice ? parseFloat(scanPrice) : null
          )}
          disabled={!canSubmit}
          className={`font-mono text-[11px] px-3 py-1.5 rounded border
            transition-colors ${canSubmit
              ? "border-amber/30 bg-amber/10 text-amber hover:bg-amber/20 cursor-pointer"
              : "border-border text-muted cursor-not-allowed"}`}
        >
          Mark missed →
        </button>
      </div>
      <div className="font-mono text-[10px] text-muted mt-1.5">
        {needsScanPrice
          ? `Enter the price when the signal fired + ${entry.targetMonthName} end price to calculate what you would have made/lost`
          : `Enter the price at end of ${entry.targetMonthName} to calculate what you would have made/lost`}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function JournalPage() {
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState("trades")
  const [filter,    setFilter]    = useState("ALL")
  // ALL | LIVE | SIGNAL | TEST
  const [editNotes, setEditNotes] = useState(null)

  const load = () => {
    const entries = loadJournal()
    const stats   = computeStats(entries)
    setData({ entries, stats })
    setLoading(false)
  }
  useEffect(load, [])

  const entries = data?.entries || []
  const stats   = data?.stats

  const filtered = entries.filter(e => {
    if (filter === "LIVE")   return e.type === "LIVE"
    if (filter === "SIGNAL") return e.type === "AUTO_SIGNAL"
    if (filter === "TEST")   return e.type === "TEST"
    return true
  }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))

  // Open signals awaiting missed marking
  const openSignals = entries.filter(e => e.status === "SIGNAL_OPEN")

  const saveNotes = () => {
    if (!editNotes) return
    const entries = loadJournal()
    const updated = entries.map(e =>
      e.id === editNotes.id
        ? { ...e, notes: editNotes.notes, updatedAt: new Date().toISOString() }
        : e
    )
    saveJournal(updated)
    setData(prev => ({
      ...prev,
      entries: prev.entries.map(e =>
        e.id === editNotes.id ? { ...e, notes: editNotes.notes } : e
      )
    }))
    setEditNotes(null)
  }

  const markMissed = (entryId, price, scanPrice) => {
    const entries = loadJournal()
    const idx = entries.findIndex(e => e.id === entryId)
    if (idx === -1) return
    entries[idx] = markSignalMissed(entries[idx], price, scanPrice || null)
    saveJournal(entries)
    load()
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-[200px] flex-1 p-8">

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase
            tracking-widest mb-2">Trade Journal</div>
          <h1 className="font-display text-3xl font-bold text-text">
            Journal<span className="text-accent">.</span>
          </h1>
          <p className="font-body text-sm text-dim mt-1 max-w-xl">
            Auto-logged from scanner signals and Monitor positions.
            Only Live trades count toward accuracy stats.
            Paper trades and missed signals tracked separately.
          </p>
        </div>

        {/* Open signals awaiting missed mark */}
        {openSignals.length > 0 && (
          <div className="mb-6">
            <div className="font-mono text-[11px] text-amber uppercase
              tracking-widest mb-3">
              ⚠ {openSignals.length} signal{openSignals.length > 1 ? "s" : ""}
              {" "}awaiting outcome — did you enter these?
            </div>
            <div className="space-y-3">
              {openSignals.map(e => (
                <MissedCard
                  key={e.id}
                  entry={e}
                  onMarkMissed={markMissed}
                />
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-card border border-border
          rounded-lg p-1 w-fit">
          {[
            { id: "trades",   label: "All Trades" },
            { id: "stats",    label: "Stats"      },
            { id: "accuracy", label: "Accuracy"   },
            { id: "missed",   label: `Missed (${entries.filter(e=>e.status==="SIGNAL_MISSED").length})`  },
          ].map(tab => (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`font-mono text-[11px] px-4 py-1.5 rounded-md
                transition-colors ${
                activeTab === tab.id
                  ? "bg-accent/15 text-accent"
                  : "text-dim hover:text-text"
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-center py-20">
            <div className="font-mono text-sm text-dim">
              Loading journal...
            </div>
          </div>
        )}

        {/* ── TRADES TAB ─────────────────────────────────────── */}
        {!loading && activeTab === "trades" && (
          <>
            {/* Filter pills */}
            <div className="flex items-center gap-2 mb-5 flex-wrap">
              {[
                { id:"ALL",    label:"All" },
                { id:"LIVE",   label:"Live Trades" },
                { id:"SIGNAL", label:"Auto Signals" },
                { id:"TEST",   label:"Paper Trades" },
              ].map(f => (
                <button key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`font-mono text-[10px] px-3 py-1.5
                    rounded border transition-colors ${
                    filter === f.id
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border text-dim hover:text-text"
                  }`}>
                  {f.label}
                </button>
              ))}
              <div className="ml-auto font-mono text-[10px] text-dim">
                {filtered.length} entries
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-20 border border-border
                rounded-lg">
                <div className="font-display text-xl text-dim mb-2">
                  No entries yet
                </div>
                <div className="font-mono text-sm text-muted">
                  Run the Early Entry Scanner to auto-log signals.
                  Add positions to Monitor to log live trades.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map(entry => {
                  const isLiveClosed = entry.status === "LIVE_CLOSED"
                  const isOpen       = entry.status === "LIVE_OPEN" ||
                                       entry.status === "SIGNAL_OPEN" ||
                                       entry.status === "TEST_OPEN"
                  const isMissed     = entry.status === "SIGNAL_MISSED"
                  const isTest       = entry.type   === "TEST"
                  const tGrade       = entry.tradeGrade
                  const dGrade       = entry.decisionGrade
                  const isProfit     = (entry.profitLoss || 0) >= 0

                  return (
                    <div key={entry.id}
                      className={`bg-card border rounded-lg overflow-hidden
                        ${isTest ? "border-amber/20 opacity-80" :
                          isOpen  ? "border-accent/20" :
                          isMissed ? "border-border" :
                          isProfit ? "border-green/15" : "border-red/15"
                        }`}>

                      {/* Card header */}
                      <div className="px-5 py-3.5 flex items-start
                        justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${
                            isOpen   ? "bg-accent animate-pulse" :
                            isMissed ? "bg-dim" :
                            isTest   ? "bg-amber" :
                            isProfit ? "bg-green" : "bg-red"
                          }`} />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-base
                                font-bold text-accent">
                                {entry.symbol}
                              </span>
                              <TypeBadge
                                type={entry.type}
                                status={entry.status}
                              />
                              {isTest && (
                                <span className="font-mono text-[9px]
                                  text-amber bg-amber/10 border
                                  border-amber/20 px-1.5 py-0.5 rounded">
                                  EXCLUDED FROM STATS
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[10px]
                              text-dim mt-1">
                              {entry.targetMonthName} target ·
                              {entry.entryDate
                                ? ` Entry ${entry.entryDate}`
                                : " Not entered"
                              }
                              {entry.exitDate && ` → ${entry.exitDate}`}
                              {entry.daysHeld && ` · ${entry.daysHeld}d`}
                              {entry.signalScore &&
                                ` · Signal ${entry.signalScore}/100`}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 flex-wrap">
                          {/* P&L for closed trades */}
                          {isLiveClosed && entry.profitLoss !== null && (
                            <div className="text-right">
                              <div className={`font-mono text-base
                                font-bold ${isProfit
                                  ? "text-green" : "text-red"}`}>
                                {isProfit ? "+" : "-"}₹{Math.abs(
                                  entry.profitLoss
                                ).toLocaleString("en-IN")}
                              </div>
                              <div className={`font-mono text-[10px]
                                ${isProfit ? "text-green" : "text-red"}`}>
                                {isProfit ? "+" : ""}
                                {(entry.returnPct || 0).toFixed(2)}%
                              </div>
                            </div>
                          )}

                          {/* Missed signal outcome */}
                          {isMissed && entry.missedProfitLoss !== null && (
                            <div className="text-right">
                              <div className="font-mono text-[10px]
                                text-dim mb-0.5">
                                Would have made
                              </div>
                              <div className={`font-mono text-sm font-bold
                                ${(entry.missedProfitLoss||0) >= 0
                                  ? "text-green" : "text-red"}`}>
                                {(entry.missedProfitLoss||0) >= 0 ? "+" : "-"}₹{
                                  Math.abs(entry.missedProfitLoss || 0)
                                    .toLocaleString("en-IN")}
                              </div>
                            </div>
                          )}

                          {/* Median capture */}
                          {isLiveClosed && (
                            <div className="text-right">
                              <div className="font-mono text-[10px]
                                text-dim mb-0.5">Median captured</div>
                              <div className="font-mono text-sm font-bold text-soft">
                                {entry.medianCapture}%
                              </div>
                            </div>
                          )}

                          {/* Grades */}
                          {isLiveClosed && tGrade && (
                            <div className="flex flex-col gap-1 items-end">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[9px] text-dim">
                                  outcome
                                </span>
                                <GradeBadge grade={tGrade.grade} />
                              </div>
                              {dGrade && (
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[9px] text-dim">
                                    execution
                                  </span>
                                  <GradeBadge grade={dGrade.grade} />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Expanded detail for closed trades */}
                      {isLiveClosed && (tGrade || dGrade) && (
                        <div className="px-5 pb-4 border-t border-border
                          pt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">

                          {/* Outcome */}
                          {tGrade && (
                            <div className="bg-bg rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <GradeBadge grade={tGrade.grade} size="lg" />
                                <div>
                                  <div className="font-mono text-[11px]
                                    text-soft font-bold">Outcome</div>
                                  <div className="font-mono text-[10px] text-dim">
                                    {tGrade.label}
                                  </div>
                                </div>
                              </div>
                              <div className="font-body text-[11px]
                                text-dim leading-relaxed">
                                {tGrade.detail}
                              </div>
                            </div>
                          )}

                          {/* Execution */}
                          {dGrade && (
                            <div className="bg-bg rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <GradeBadge grade={dGrade.grade} size="lg" />
                                <div>
                                  <div className="font-mono text-[11px]
                                    text-soft font-bold">Execution</div>
                                  <div className="font-mono text-[10px] text-dim">
                                    {dGrade.label}
                                  </div>
                                </div>
                              </div>
                              <div className="space-y-1">
                                {(dGrade.notes || []).map((n,i) => (
                                  <div key={i} className="font-mono
                                    text-[10px] text-dim flex gap-1.5">
                                    <span className="text-accent shrink-0">
                                      →
                                    </span>
                                    {n}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Notes */}
                          <div className="bg-bg rounded-lg p-3">
                            <div className="font-mono text-[10px] text-dim
                              uppercase tracking-wider mb-2">
                              Notes
                            </div>
                            {editNotes?.id === entry.id ? (
                              <div>
                                <textarea
                                  value={editNotes.notes}
                                  onChange={e => setEditNotes(p => ({
                                    ...p, notes: e.target.value
                                  }))}
                                  rows={3}
                                  className="w-full bg-card border border-border
                                    rounded px-3 py-2 font-body text-[12px]
                                    text-text resize-none focus:border-accent
                                    focus:outline-none"
                                  placeholder="What did you learn from this trade?"
                                  autoFocus
                                />
                                <div className="flex gap-2 mt-2">
                                  <button onClick={saveNotes}
                                    className="font-mono text-[10px] px-3
                                      py-1 rounded border border-green/30
                                      text-green bg-green/10">
                                    Save
                                  </button>
                                  <button onClick={() => setEditNotes(null)}
                                    className="font-mono text-[10px] px-3
                                      py-1 rounded border border-border
                                      text-dim">
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div className="font-body text-[12px]
                                  text-dim min-h-[40px] leading-relaxed">
                                  {entry.notes || "No notes — click to add"}
                                </div>
                                <button
                                  onClick={() => setEditNotes({
                                    id:    entry.id,
                                    notes: entry.notes || ""
                                  })}
                                  className="font-mono text-[10px]
                                    text-muted hover:text-accent
                                    transition-colors mt-1">
                                  ✎ Add notes
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── STATS TAB ──────────────────────────────────────── */}
        {!loading && activeTab === "stats" && (
          <div className="space-y-6">
            {!stats?.hasData ? (
              <div className="text-center py-20 border border-border
                rounded-lg">
                <div className="font-display text-xl text-dim mb-2">
                  No closed live trades yet
                </div>
                <div className="font-mono text-sm text-muted">
                  Stats are computed from Live trades only.
                  Paper trades and signals are excluded.
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard label="Live Trades"
                    value={stats.totalLive}
                    sub={`${stats.wins}W · ${stats.losses}L`} />
                  <StatCard label="Win Rate"
                    value={stats.winRate + "%"}
                    color={stats.winRate >= 70 ? "text-green" : "text-amber"} />
                  <StatCard label="Total P&L"
                    value={(stats.totalPnL >= 0 ? "+" : "-") +
                      "₹" + Math.abs(stats.totalPnL).toLocaleString("en-IN")}
                    color={stats.totalPnL >= 0 ? "text-green" : "text-red"} />
                  <StatCard label="Avg Capture"
                    value={stats.avgMedianCapture + "%"}
                    sub="of median return"
                    color={stats.avgMedianCapture >= 80 ? "text-green" :
                           stats.avgMedianCapture >= 50 ? "text-amber" : "text-red"} />
                </div>

                {/* Missed opportunity cost */}
                {stats.missedPnL !== 0 && (
                  <div className={`p-4 rounded-lg border flex items-center
                    justify-between ${stats.missedPnL > 0
                      ? "border-amber/20 bg-amber/5"
                      : "border-green/20 bg-green/5"}`}>
                    <div>
                      <div className="font-mono text-[11px] text-amber mb-1">
                        Missed Signal Opportunity Cost
                      </div>
                      <div className="font-body text-sm text-dim">
                        {stats.missedPnL > 0
                          ? `You missed ₹${stats.missedPnL.toLocaleString("en-IN")} in gains from signals you didn't enter`
                          : `Signals you skipped would have lost ₹${Math.abs(stats.missedPnL).toLocaleString("en-IN")} — good skips`}
                      </div>
                    </div>
                    <div className={`font-mono text-xl font-bold
                      ${stats.missedPnL > 0 ? "text-amber" : "text-green"}`}>
                      {stats.missedPnL > 0 ? "+" : "-"}₹{
                        Math.abs(stats.missedPnL).toLocaleString("en-IN")}
                    </div>
                  </div>
                )}

                {/* Grade distribution */}
                <div className="bg-card border border-border rounded-lg
                  overflow-hidden">
                  <div className="px-5 py-3 border-b border-border">
                    <div className="font-mono text-[11px] text-soft font-bold">
                      Trade Grade Distribution
                    </div>
                  </div>
                  <div className="px-5 py-4">
                    <div className="flex items-end gap-3 h-20">
                      {Object.entries(stats.grades || {}).map(([g, count]) => {
                        const max = Math.max(...Object.values(stats.grades||{})) || 1
                        const h   = Math.round((count / max) * 100)
                        const col = g==="A+"||g==="A"  ? "bg-green"  :
                                    g==="B+"||g==="B"  ? "bg-accent" :
                                    g==="C"            ? "bg-amber"  : "bg-red"
                        return (
                          <div key={g} className="flex flex-col items-center
                            gap-1 flex-1">
                            <div className="font-mono text-[10px] text-dim">
                              {count}
                            </div>
                            <div className="w-full flex items-end h-14">
                              <div className={`w-full rounded-t ${col}`}
                                style={{ height: `${h}%`,
                                  minHeight: count > 0 ? "4px" : "0" }} />
                            </div>
                            <div className="font-mono text-[10px] text-dim">
                              {g}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── ACCURACY TAB ───────────────────────────────────── */}
        {!loading && activeTab === "accuracy" && (
          <div className="space-y-6">
            {!stats?.hasData ? (
              <div className="text-center py-16 border border-border
                rounded-lg">
                <div className="font-mono text-sm text-dim">
                  Need at least 5 closed live trades for accuracy analysis
                </div>
              </div>
            ) : (
              <>
                {/* Signal score accuracy */}
                {(stats.signalAccuracy || []).length > 0 && (
                  <div className="bg-card border border-border rounded-lg
                    overflow-hidden">
                    <div className="px-5 py-3 border-b border-border">
                      <div className="font-mono text-[11px] text-soft font-bold">
                        Signal Score vs Actual Returns
                      </div>
                      <div className="font-mono text-[10px] text-dim mt-0.5">
                        Do higher scores actually produce better trades?
                      </div>
                    </div>
                    <div className="divide-y divide-border">
                      {[...(stats.signalAccuracy||[])].sort((a,b) => {
                        const order = ["A+","A","B+","B","C","D"]
                        return order.indexOf(a.grade) - order.indexOf(b.grade)
                      }).map(row => (
                        <div key={row.grade} className="px-5 py-3 flex
                          items-center gap-4">
                          <GradeBadge grade={row.grade} />
                          <div className="flex-1">
                            <div className="font-mono text-[11px] text-soft">
                              {row.trades} trade{row.trades !== 1 ? "s" : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-1">
                            <div className="flex-1 h-1.5 bg-border rounded-full
                              overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  row.avgCapture >= 90 ? "bg-green" :
                                  row.avgCapture >= 60 ? "bg-accent" :
                                  row.avgCapture >= 30 ? "bg-amber" : "bg-red"
                                }`}
                                style={{ width: `${Math.min(row.avgCapture,100)}%` }}
                              />
                            </div>
                            <div className="font-mono text-[11px] font-bold
                              text-soft w-20 text-right">
                              {row.avgCapture}% captured
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="px-5 py-3 border-t border-border">
                      <div className="font-mono text-[10px] text-dim">
                        A+ signals should show 90%+ capture · D signals
                        should show &lt;30% · if they match, the scoring
                        system is validated
                      </div>
                    </div>
                  </div>
                )}

                {/* Progress toward validation */}
                <div className="bg-card border border-border rounded-lg p-5">
                  <div className="font-mono text-[11px] text-soft font-bold mb-4">
                    System Validation Progress
                  </div>
                  <div className="space-y-4">
                    {[
                      { label:"Direction accuracy", needed:20,
                        have:stats.totalLive,
                        detail:"trades to validate seasonal edge is real" },
                      { label:"Score validation",   needed:30,
                        have:stats.totalLive,
                        detail:"trades to know if signal scores predict outcomes" },
                      { label:"Full confidence",    needed:50,
                        have:stats.totalLive,
                        detail:"trades for high-confidence system assessment" },
                    ].map(item => {
                      const pct  = Math.min((item.have/item.needed)*100, 100)
                      const done = item.have >= item.needed
                      return (
                        <div key={item.label}>
                          <div className="flex justify-between mb-1">
                            <span className="font-mono text-[11px] text-dim">
                              {item.label}
                            </span>
                            <span className={`font-mono text-[11px] font-bold ${
                              done ? "text-green" : "text-amber"
                            }`}>
                              {done ? "✓ Validated" : `${item.have}/${item.needed}`}
                            </span>
                          </div>
                          <div className="h-1.5 bg-border rounded-full
                            overflow-hidden mb-1">
                            <div
                              className={`h-full rounded-full ${
                                done ? "bg-green" : "bg-amber"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="font-mono text-[10px] text-muted">
                            {item.detail}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── MISSED TAB ─────────────────────────────────────── */}
        {!loading && activeTab === "missed" && (
          <div className="space-y-4">
            <div className="font-body text-sm text-dim mb-4">
              Signals the scanner fired but you didn&apos;t enter.
              After the target month ends, enter the final price
              to see what you would have made or lost.
              This helps you calibrate when to trust the signals.
            </div>

            {entries.filter(e => e.status === "SIGNAL_MISSED").length === 0 ? (
              <div className="text-center py-16 border border-border
                rounded-lg">
                <div className="font-mono text-sm text-dim">
                  No missed signals recorded yet
                </div>
              </div>
            ) : (
              entries.filter(e => e.status === "SIGNAL_MISSED")
                .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
                .map(e => {
                  const wouldHave = e.missedProfitLoss
                  const isGoodSkip = (wouldHave || 0) < 0
                  return (
                    <div key={e.id}
                      className={`bg-card border rounded-lg p-5 ${
                        isGoodSkip ? "border-green/15" : "border-amber/15"
                      }`}>
                      <div className="flex items-start justify-between
                        gap-4 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-base font-bold
                              text-accent">
                              {e.symbol}
                            </span>
                            <span className={`font-mono text-[9px] px-2
                              py-0.5 rounded border ${
                              isGoodSkip
                                ? "bg-green/10 text-green border-green/20"
                                : "bg-amber/10 text-amber border-amber/20"
                            }`}>
                              {isGoodSkip ? "✓ Good skip" : "Missed gain"}
                            </span>
                          </div>
                          <div className="font-mono text-[10px] text-dim">
                            Signal: {e.signalScore}/100 ·
                            {e.targetMonthName} ·
                            Scan price: ₹{e.currentPriceAtScan?.toLocaleString("en-IN")} ·
                            Month-end: ₹{e.priceAtMonthEnd?.toLocaleString("en-IN")}
                          </div>
                        </div>
                        {wouldHave !== null && (
                          <div className="text-right">
                            <div className="font-mono text-[10px] text-dim mb-0.5">
                              Would have made
                            </div>
                            <div className={`font-mono text-lg font-bold ${
                              isGoodSkip ? "text-green" : "text-amber"
                            }`}>
                              {isGoodSkip ? "saved " : "missed "}
                              ₹{Math.abs(wouldHave).toLocaleString("en-IN")}
                            </div>
                            <div className="font-mono text-[10px] text-dim">
                              {(e.returnPct || 0) >= 0 ? "+" : ""}
                              {(e.returnPct || 0).toFixed(2)}% move
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
            )}
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-border pt-4 mt-8
          flex items-center justify-between">
          <div className="font-mono text-[10px] text-muted">
            Auto-logged · Live trades only in stats ·
            Paper trades excluded · Not SEBI advice
          </div>
          <div className="font-mono text-[10px] text-muted">
            Crafted by <span className="text-accent">Khilan Patel</span>
          </div>
        </div>
      </main>
    </div>
  )
}
