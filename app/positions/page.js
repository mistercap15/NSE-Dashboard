"use client"
import { useState, useEffect, useCallback } from "react"
import Sidebar from "../components/Sidebar"
import { MONTHS } from "../lib/api"

const currentMonth = new Date().getMonth() + 1
const STORAGE_KEY  = "nse_positions_v1"

const FO_SYMBOLS = [
  "360ONE","ABB","ABBOTINDIA","ABCAPITAL","ABFRL","ACC","ADANIENT","ADANIPORTS",
  "ADANIPOWER","ALKEM","AMBUJACEM","ANGELONE","APLAPOLLO","APOLLOHOSP","APOLLOTYRE",
  "ASHOKLEY","ASIANPAINT","ASTRAL","ATGL","ATUL","AUBANK","AUROPHARMA","AXISBANK",
  "BAJAJ-AUTO","BAJAJFINSV","BAJFINANCE","BALKRISIND","BALRAMCHIN","BANDHANBNK",
  "BANKBARODA","BATAINDIA","BEL","BERGEPAINT","BHARATFORG","BHARTIARTL","BHEL",
  "BIOCON","BOSCHLTD","BPCL","BRITANNIA","BSE","BSOFT","CANBK","CANFINHOME",
  "CDSL","CESC","CGPOWER","CHAMBLFERT","CHOLAFIN","CIPLA","COALINDIA","COFORGE",
  "COLPAL","CONCOR","COROMANDEL","CROMPTON","CUB","CUMMINSIND","DABUR","DALBHARAT",
  "DEEPAKNTR","DELTACORP","DEVYANI","DIVISLAB","DIXON","DLF","DMART","DRREDDY",
  "EIDPARRY","EICHERMOT","ESCORTS","ETERNAL","EXIDEIND","FEDERALBNK","FORTIS",
  "GAIL","GLENMARK","GNFC","GODREJCP","GODREJPROP","GRANULES","GRASIM","GUJGASLTD",
  "HAL","HAVELLS","HCLTECH","HDFCAMC","HDFCBANK","HDFCLIFE","HEROMOTOCO","HFCL",
  "HINDCOPPER","HINDALCO","HINDPETRO","HINDUNILVR","HONAUT","HUDCO","IBREALEST",
  "ICICIBANK","ICICIGI","ICICIPRULI","IDEA","IDFCFIRSTB","IEX","IGL","INDHOTEL",
  "INDIAMART","INDIGO","INDUSTOWER","INFY","IOC","IPCALAB","IRB","IRCTC","IRFC",
  "ITC","JKCEMENT","JSWENERGY","JSWSTEEL","JUBLFOOD","KAJARIACER","KANSAINER",
  "KOTAKBANK","LAURUSLABS","LICI","LODHA","LT","LTIM","LTM","L&TFH","LUPIN",
  "M&M","M&MFIN","MARICO","MARUTI","MAXHEALTH","MCX","METROPOLIS","MFSL","MGL",
  "MOTHERSON","MPHASIS","MRF","MUTHOOTFIN","NAUKRI","NAVINFLUOR","NESTLEIND",
  "NMDC","NTPC","OBEROIRLTY","OFSS","OIL","ONGC","PAGEIND","PEL","PERSISTENT",
  "PETRONET","PFC","PIDILITIND","PIIND","PNB","PNBHOUSING","POLYCAB","POWERGRID",
  "PVRINOX","RAMCOCEM","RBLBANK","RECLTD","RELIANCE","SAIL","SBICARD","SBILIFE",
  "SBIN","SHREECEM","SHRIRAMFIN","SIEMENS","SJVN","SKFINDIA","SRF","STARHEALTH",
  "SUNTV","SUPREMEIND","SYNGENE","TATACHEM","TATACOMM","TATACONSUM","TATAELXSI",
  "TATAMOTORS","TATAPOWER","TATASTEEL","TCS","TECHM","TIINDIA","TITAN","TORNTPHARM",
  "TORNTPOWER","TRENT","TVSMOTOR","UBL","ULTRACEMCO","UPL","VEDL","VOLTAS",
  "WIPRO","ZOMATO","ZYDUSLIFE",
]

const LOT_SIZES = {
  "360ONE":500,"ABB":125,"ABBOTINDIA":25,"ABCAPITAL":3500,"ABFRL":2500,
  "ACC":250,"ADANIENT":375,"ADANIPORTS":1250,"ADANIPOWER":2000,"ALKEM":150,
  "AMBUJACEM":1000,"ANGELONE":250,"APLAPOLLO":500,"APOLLOHOSP":125,"APOLLOTYRE":1750,
  "ASHOKLEY":5500,"ASIANPAINT":200,"ASTRAL":500,"ATGL":850,"ATUL":100,
  "AUBANK":1000,"AUROPHARMA":650,"AXISBANK":1200,"BAJAJ-AUTO":125,"BAJAJFINSV":500,
  "BAJFINANCE":125,"BALKRISIND":400,"BALRAMCHIN":2250,"BANDHANBNK":2500,"BANKBARODA":5850,
  "BATAINDIA":250,"BEL":4500,"BERGEPAINT":500,"BHARATFORG":750,"BHARTIARTL":475,
  "BHEL":5250,"BIOCON":2000,"BOSCHLTD":50,"BPCL":1800,"BRITANNIA":125,
  "BSE":250,"BSOFT":1200,"CANBK":4725,"CANFINHOME":600,"CDSL":500,
  "CESC":1500,"CGPOWER":1500,"CHAMBLFERT":2000,"CHOLAFIN":700,"CIPLA":650,
  "COALINDIA":2100,"COFORGE":150,"COLPAL":700,"CONCOR":1000,"COROMANDEL":500,
  "CROMPTON":2000,"CUB":5000,"CUMMINSIND":300,"DABUR":2750,"DALBHARAT":200,
  "DEEPAKNTR":350,"DELTACORP":5000,"DEVYANI":2500,"DIVISLAB":200,"DIXON":75,
  "DLF":1650,"DMART":150,"DRREDDY":125,"EIDPARRY":1250,"EICHERMOT":175,
  "ESCORTS":275,"ETERNAL":2800,"EXIDEIND":1800,"FEDERALBNK":10000,"FORTIS":2000,
  "GAIL":4500,"GLENMARK":650,"GNFC":1250,"GODREJCP":500,"GODREJPROP":500,
  "GRANULES":2500,"GRASIM":250,"GUJGASLTD":1250,"HAL":150,"HAVELLS":500,
  "HCLTECH":700,"HDFCAMC":200,"HDFCBANK":550,"HDFCLIFE":1100,"HEROMOTOCO":300,
  "HFCL":7500,"HINDCOPPER":5850,"HINDALCO":1400,"HINDPETRO":2100,"HINDUNILVR":300,
  "HONAUT":15,"HUDCO":5500,"IBREALEST":5000,"ICICIBANK":700,"ICICIGI":250,
  "ICICIPRULI":1500,"IDEA":70000,"IDFCFIRSTB":10000,"IEX":3750,"IGL":1375,
  "INDHOTEL":2000,"INDIAMART":75,"INDIGO":300,"INDUSTOWER":1700,"INFY":400,
  "IOC":6000,"IPCALAB":450,"IRB":5000,"IRCTC":875,"IRFC":6400,"ITC":1600,
  "JKCEMENT":125,"JSWENERGY":1500,"JSWSTEEL":900,"JUBLFOOD":500,"KAJARIACER":500,
  "KANSAINER":300,"KOTAKBANK":400,"L&TFH":6000,"LAURUSLABS":1500,"LICI":700,
  "LODHA":900,"LT":175,"LTIM":150,"LTM":150,"LUPIN":500,"M&M":700,
  "M&MFIN":2000,"MARICO":2000,"MARUTI":100,"MAXHEALTH":800,"MCX":250,
  "METROPOLIS":250,"MFSL":750,"MGL":550,"MOTHERSON":5000,"MPHASIS":300,
  "MRF":10,"MUTHOOTFIN":625,"NAUKRI":125,"NAVINFLUOR":100,"NESTLEIND":40,
  "NMDC":4500,"NTPC":2700,"OBEROIRLTY":750,"OFSS":50,"OIL":2350,"ONGC":2700,
  "PAGEIND":15,"PEL":375,"PERSISTENT":125,"PETRONET":3000,"PFC":2400,
  "PIDILITIND":250,"PIIND":250,"PNB":8000,"PNBHOUSING":1000,"POLYCAB":175,
  "POWERGRID":2700,"PVRINOX":1000,"RAMCOCEM":750,"RBLBANK":5000,"RECLTD":2400,
  "RELIANCE":250,"SAIL":7500,"SBICARD":500,"SBILIFE":750,"SBIN":1500,
  "SHREECEM":25,"SHRIRAMFIN":300,"SIEMENS":175,"SJVN":7500,"SKFINDIA":200,
  "SRF":125,"STARHEALTH":1750,"SUNTV":750,"SUPREMEIND":175,"SYNGENE":1000,
  "TATACHEM":500,"TATACOMM":500,"TATACONSUM":1100,"TATAELXSI":100,"TATAMOTORS":1350,
  "TATAPOWER":3375,"TATASTEEL":5500,"TCS":175,"TECHM":600,"TIINDIA":125,
  "TITAN":375,"TORNTPHARM":500,"TORNTPOWER":750,"TRENT":375,"TVSMOTOR":350,
  "UBL":500,"ULTRACEMCO":100,"UPL":1300,"VEDL":2750,"VOLTAS":500,
  "WIPRO":1500,"ZOMATO":2800,"ZYDUSLIFE":500,
}

function loadPositions() {
  if (typeof window === "undefined") return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
  } catch { return [] }
}

function savePositions(positions) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions))
}

function getActionStyle(action) {
  switch (action) {
    case "EXIT_NOW":   return { bg: "bg-green/10",  border: "border-green/30",  text: "text-green",  badge: "EXIT NOW"  }
    case "TRAIL_STOP": return { bg: "bg-accent/10", border: "border-accent/30", text: "text-accent", badge: "TRAIL SL"  }
    case "TIME_STOP":  return { bg: "bg-amber/10",  border: "border-amber/30",  text: "text-amber",  badge: "TIME STOP" }
    case "WATCH":      return { bg: "bg-amber/5",   border: "border-amber/20",  text: "text-amber",  badge: "WATCH"     }
    case "HOLD":       return { bg: "bg-card",      border: "border-border",    text: "text-soft",   badge: "HOLD"      }
    default:           return { bg: "bg-card",      border: "border-border",    text: "text-dim",    badge: "—"         }
  }
}

function CaptureBar({ pct }) {
  const capped = Math.min(pct, 120)
  const color  =
    pct >= 90 ? "bg-green"  :
    pct >= 60 ? "bg-accent" :
    pct >= 30 ? "bg-amber"  : "bg-red"
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="font-mono text-[9px] text-dim">Median captured</span>
        <span className={`font-mono text-[10px] font-bold ${
          pct >= 90 ? "text-green" : pct >= 60 ? "text-accent" : "text-amber"
        }`}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(capped, 100)}%` }}
        />
      </div>
    </div>
  )
}

export default function PositionsPage() {
  const [positions,   setPositions]   = useState([])
  const [enriched,    setEnriched]    = useState([])
  const [totalPnL,    setTotalPnL]    = useState(0)
  const [loading,     setLoading]     = useState(false)
  const [lastFetch,   setLastFetch]   = useState(null)
  const [showForm,        setShowForm]        = useState(false)
  const [upstoxError,     setUpstoxError]     = useState(null)
  const [symbolDropdown,  setSymbolDropdown]  = useState([])
  const [addingPosition,  setAddingPosition]  = useState(false)
  const [lotSizeLoading,  setLotSizeLoading]  = useState(false)

  const [form, setForm] = useState({
    symbol:      "",
    direction:   "LONG",
    entryPrice:  "",
    lotSize:     "",
    entryDate:   new Date().toISOString().slice(0, 10),
    medianReturn:"",
    avgReturn:   "",
    targetMonth: currentMonth === 12 ? 1 : currentMonth + 1,
  })

  useEffect(() => {
    setPositions(loadPositions())
  }, [])

  const fetchLiveData = useCallback(async (positionsToFetch) => {
    if (positionsToFetch.length === 0) return
    setLoading(true)
    setUpstoxError(null)
    try {
      const res  = await fetch("/api/positions", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ positions: positionsToFetch }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEnriched(data.positions || [])
      setTotalPnL(data.totalPnL  || 0)
      setLastFetch(new Date())
    } catch (e) {
      setUpstoxError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (positions.length > 0) {
      fetchLiveData(positions)
      const interval = setInterval(() => fetchLiveData(positions), 5 * 60 * 1000)
      return () => clearInterval(interval)
    }
  }, [positions, fetchLiveData])

  const handleSymbolChange = (val) => {
    const upper = val.toUpperCase()
    setForm(f => ({ ...f, symbol: upper, lotSize: "" }))
    setSymbolDropdown(
      val.length >= 1
        ? FO_SYMBOLS.filter(s => s.startsWith(upper)).slice(0, 8)
        : []
    )
  }

  const fetchLotSizeForSymbol = useCallback(async (sym) => {
    if (!sym) return
    setLotSizeLoading(true)
    try {
      const res = await fetch(`/api/stock/${sym}`)
      if (res.ok) {
        const data = await res.json()
        if (data?.lot_size) {
          setForm(f => ({ ...f, lotSize: String(data.lot_size) }))
        }
      }
    } catch (e) {
      console.error("Could not fetch lot size", e)
    } finally {
      setLotSizeLoading(false)
    }
  }, [])

  const selectSymbol = (sym) => {
    setForm(f => ({ ...f, symbol: sym, lotSize: "" }))
    setSymbolDropdown([])
    fetchLotSizeForSymbol(sym)
  }

  const addPosition = async () => {
    const sym = form.symbol.toUpperCase()
    if (!sym || !form.entryPrice) return

    setAddingPosition(true)
    try {
      let medianReturn  = parseFloat(form.medianReturn) || 0
      let avgReturn     = parseFloat(form.avgReturn)    || 0
      let resolvedLotSize = parseInt(form.lotSize) || LOT_SIZES[sym] || 1

      try {
        const res = await fetch(`/api/stock/${sym}`)
        if (res.ok) {
          const data = await res.json()
          // Use MCP lot size — it's always up-to-date vs the hardcoded fallback
          if (data?.lot_size) resolvedLotSize = data.lot_size
          const monthData = data?.seasonality?.[form.targetMonth - 1]
          if (monthData) {
            medianReturn = monthData.median_return || medianReturn
            avgReturn    = monthData.avg_return    || avgReturn
          }
        }
      } catch (e) {
        console.error("Could not fetch stock data", e)
      }

      if (!resolvedLotSize) return

      const newPos = {
        id:          Date.now().toString(),
        symbol:      sym,
        direction:   form.direction,
        entryPrice:  parseFloat(form.entryPrice),
        lotSize:     resolvedLotSize,
        entryDate:   form.entryDate,
        targetMonth: parseInt(form.targetMonth),
        medianReturn,
        avgReturn,
      }

      const updated = [...positions, newPos]
      setPositions(updated)
      savePositions(updated)
      setShowForm(false)
      setSymbolDropdown([])
      setForm({
        symbol: "", direction: "LONG", entryPrice: "",
        lotSize: "", entryDate: new Date().toISOString().slice(0, 10),
        medianReturn: "", avgReturn: "",
        targetMonth: currentMonth === 12 ? 1 : currentMonth + 1,
      })
      fetchLiveData(updated)
    } finally {
      setAddingPosition(false)
    }
  }

  const removePosition = (id) => {
    const updated = positions.filter(p => p.id !== id)
    setPositions(updated)
    savePositions(updated)
    setEnriched(prev => prev.filter(p => p.id !== id))
  }

  const displayPositions = enriched.length > 0
    ? enriched
    : positions.map(p => ({ ...p, pnl: null, recommendation: null }))

  const exitNowCount = displayPositions.filter(p => p.recommendation?.action === "EXIT_NOW").length
  const trailCount   = displayPositions.filter(p => p.recommendation?.action === "TRAIL_STOP").length

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-[200px] flex-1 p-8">

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">
            Live Position Monitor
          </div>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="font-display text-3xl font-bold text-text">
                Open Positions<span className="text-accent">.</span>
              </h1>
              <p className="font-body text-sm text-dim mt-1">
                Real-time P&amp;L and daily exit recommendations based on seasonal targets.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {lastFetch && (
                <span className="font-mono text-[10px] text-dim">
                  Updated {lastFetch.toLocaleTimeString("en-IN")}
                </span>
              )}
              <button
                onClick={() => fetchLiveData(positions)}
                disabled={loading || positions.length === 0}
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-border
                  text-dim hover:text-text transition-colors disabled:opacity-40"
              >
                {loading ? "Refreshing..." : "↻ Refresh"}
              </button>
              <button
                onClick={() => setShowForm(true)}
                className="font-mono text-sm px-4 py-2 rounded border border-accent/30
                  bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
              >
                + Add Position
              </button>
            </div>
          </div>
        </div>

        {/* Alert bar */}
        {(exitNowCount > 0 || trailCount > 0) && (
          <div className={`mb-6 p-4 rounded-lg border flex items-center justify-between flex-wrap gap-3 ${
            exitNowCount > 0
              ? "border-green/30 bg-green/5"
              : "border-accent/30 bg-accent/5"
          }`}>
            <div>
              <div className={`font-mono text-[11px] uppercase tracking-widest mb-1 ${
                exitNowCount > 0 ? "text-green" : "text-accent"
              }`}>
                {exitNowCount > 0
                  ? `⚡ ${exitNowCount} position${exitNowCount > 1 ? "s" : ""} ready to exit`
                  : `📊 ${trailCount} position${trailCount > 1 ? "s" : ""} — move stop loss`}
              </div>
              <div className="font-body text-sm text-dim">
                {exitNowCount > 0
                  ? "Seasonal target reached. Exit to lock in profits."
                  : "Good profit built up. Move stop loss to protect gains."}
              </div>
            </div>
          </div>
        )}

        {/* Upstox error */}
        {upstoxError && (
          <div className="mb-6 p-4 rounded-lg border border-red/20 bg-red/5
            flex items-center justify-between">
            <div>
              <div className="font-mono text-[11px] text-red mb-1">Live price unavailable</div>
              <div className="font-body text-sm text-dim">
                {upstoxError.includes("token") ? "Upstox session expired." : upstoxError}
              </div>
            </div>
            {upstoxError.includes("token") && (
              <a href="/api/upstox/login"
                className="font-mono text-[11px] px-3 py-1.5 rounded border
                  border-accent/30 bg-accent/10 text-accent">
                Reconnect →
              </a>
            )}
          </div>
        )}

        {/* Portfolio summary */}
        {displayPositions.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Open Positions", value: displayPositions.length, color: "text-text" },
              {
                label: "Total P&L",
                value: totalPnL >= 0
                  ? `+₹${Math.abs(totalPnL).toLocaleString("en-IN")}`
                  : `-₹${Math.abs(totalPnL).toLocaleString("en-IN")}`,
                color: totalPnL >= 0 ? "text-green" : "text-red",
              },
              { label: "Exit Signals", value: exitNowCount, color: exitNowCount > 0 ? "text-green" : "text-dim" },
              { label: "Trail Signals", value: trailCount,  color: trailCount  > 0 ? "text-accent" : "text-dim" },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border rounded-lg p-4">
                <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">
                  {s.label}
                </div>
                <div className={`font-mono text-xl font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Position cards */}
        <div className="space-y-4">
          {displayPositions.map(p => {
            const rec      = p.recommendation
            const style    = getActionStyle(rec?.action)
            const pnl      = p.pnl
            const isProfit = (pnl?.total || 0) >= 0

            return (
              <div key={p.id}
                className={`rounded-lg border overflow-hidden ${style.border} ${style.bg}`}>

                {/* Card header */}
                <div className="px-5 py-4 flex items-start justify-between gap-4 flex-wrap">

                  {/* Left: symbol + meta */}
                  <div className="flex items-center gap-3">
                    <div className={`font-mono text-[10px] font-bold px-2 py-1 rounded border ${
                      p.direction === "LONG"
                        ? "border-green/30 text-green bg-green/10"
                        : "border-red/30 text-red bg-red/10"
                    }`}>
                      {p.direction === "LONG" ? "↑ LONG" : "↓ SHORT"}
                    </div>
                    <div>
                      <div className="font-mono text-xl font-bold text-accent">{p.symbol}</div>
                      <div className="font-mono text-[10px] text-dim">
                        {MONTHS[(p.targetMonth - 1) % 12]} target ·{" "}
                        Entered {p.entryDate} ·{" "}
                        {p.timing?.daysInTrade ?? 0} days ago ·{" "}
                        {p.timing?.daysRemaining ?? 0} days left
                      </div>
                    </div>
                  </div>

                  {/* Right: P&L + price + badge + remove */}
                  <div className="flex items-center gap-4 flex-wrap">
                    {pnl && (
                      <div className="text-right">
                        <div className="font-mono text-[10px] text-dim mb-0.5">Live P&L</div>
                        <div className={`font-mono text-lg font-bold ${isProfit ? "text-green" : "text-red"}`}>
                          {isProfit ? "+" : "-"}₹{Math.abs(pnl.total).toLocaleString("en-IN")}
                        </div>
                        <div className={`font-mono text-[11px] ${isProfit ? "text-green" : "text-red"}`}>
                          {isProfit ? "+" : ""}{pnl.returnPct}%
                        </div>
                      </div>
                    )}

                    {p.livePrice && (
                      <div className="text-right">
                        <div className="font-mono text-[10px] text-dim mb-0.5">Current</div>
                        <div className="font-mono text-base font-bold text-text">
                          ₹{p.livePrice.toLocaleString("en-IN")}
                        </div>
                        <div className={`font-mono text-[11px] ${
                          (p.quote?.changePct || 0) >= 0 ? "text-green" : "text-red"
                        }`}>
                          {(p.quote?.changePct || 0) >= 0 ? "+" : ""}
                          {(p.quote?.changePct || 0).toFixed(2)}% today
                        </div>
                      </div>
                    )}

                    {rec && (
                      <div className={`font-mono text-[11px] font-bold px-3 py-1.5 rounded border
                        ${style.border} ${style.text} text-center min-w-[80px]`}>
                        {style.badge}
                      </div>
                    )}

                    <button
                      onClick={() => removePosition(p.id)}
                      className="font-mono text-[11px] text-muted hover:text-red transition-colors px-2"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Capture bar + recommendation detail */}
                {pnl ? (
                  <div className="px-5 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">

                    {/* Left: capture bar + stats */}
                    <div className="bg-bg rounded-lg p-4">
                      <CaptureBar pct={pnl.medianCapture} />
                      <div className="mt-3 space-y-1.5">
                        {[
                          { label: "Entry price",    value: `₹${p.entryPrice.toLocaleString("en-IN")}`, color: "text-soft" },
                          { label: "Current price",  value: `₹${(p.livePrice || 0).toLocaleString("en-IN")}`, color: isProfit ? "text-green" : "text-red" },
                          { label: "Median target",  value: `₹${Math.round(p.entryPrice * (1 + p.medianReturn / 100)).toLocaleString("en-IN")} (+${p.medianReturn}%)`, color: "text-accent" },
                          { label: "Lot size",       value: `${p.lotSize} shares`, color: "text-dim" },
                        ].map(item => (
                          <div key={item.label} className="flex justify-between">
                            <span className="font-mono text-[10px] text-dim">{item.label}</span>
                            <span className={`font-mono text-[11px] font-medium ${item.color}`}>{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: recommendation */}
                    {rec && (
                      <div className={`rounded-lg p-4 border ${style.border} ${style.bg}`}>
                        <div className={`font-mono text-[10px] uppercase tracking-widest mb-2 ${style.text}`}>
                          Today&apos;s Recommendation
                        </div>
                        <div className={`font-display text-sm font-bold mb-2 ${style.text}`}>
                          {rec.title}
                        </div>
                        <p className="font-body text-[12px] text-dim leading-relaxed mb-2">
                          {rec.reason}
                        </p>
                        <div className="font-mono text-[10px] text-muted">{rec.detail}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="px-5 pb-4">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                      {[
                        { label: "Entry Price",    value: `₹${p.entryPrice.toLocaleString("en-IN")}`,      color: "text-soft"   },
                        { label: "Lot Size",       value: `${p.lotSize} shares`,                            color: "text-dim"    },
                        { label: "Median Target",  value: p.medianReturn ? `+${p.medianReturn}%` : "—",     color: "text-accent" },
                        { label: "Avg Target",     value: p.avgReturn    ? `+${p.avgReturn}%`    : "—",     color: "text-accent" },
                      ].map(item => (
                        <div key={item.label} className="bg-bg rounded-lg p-3">
                          <div className="font-mono text-[9px] text-dim uppercase tracking-widest mb-1">{item.label}</div>
                          <div className={`font-mono text-sm font-bold ${item.color}`}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="font-mono text-[10px] text-dim">
                      {upstoxError
                        ? "Upstox unavailable — connect to see live P&L"
                        : p.error
                        ? `No live data — ${p.error === "No live data" ? "Upstox not connected or market closed" : p.error}`
                        : "Fetching live prices..."}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Add position modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-lg font-bold text-text">Add Position</h2>
                <button onClick={() => setShowForm(false)} className="text-dim hover:text-text">✕</button>
              </div>

              <div className="space-y-4">
                {/* Direction toggle */}
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {["LONG", "SHORT"].map(d => (
                    <button key={d}
                      onClick={() => setForm(f => ({ ...f, direction: d }))}
                      className={`flex-1 py-2 font-mono text-sm transition-colors ${
                        form.direction === d
                          ? d === "LONG" ? "bg-green/15 text-green" : "bg-red/15 text-red"
                          : "text-dim"
                      }`}>
                      {d === "LONG" ? "↑ Long" : "↓ Short"}
                    </button>
                  ))}
                </div>

                {/* Symbol with autocomplete */}
                <div>
                  <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-1.5">
                    Symbol
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={form.symbol}
                      onChange={e => handleSymbolChange(e.target.value)}
                      onBlur={e => {
                        const sym = e.target.value.toUpperCase()
                        if (sym && symbolDropdown.length === 0) fetchLotSizeForSymbol(sym)
                      }}
                      placeholder="HEROMOTOCO"
                      autoComplete="off"
                      className="w-full bg-bg border border-border rounded-lg px-4 py-2.5
                        font-mono text-sm text-text placeholder-muted focus:border-accent
                        focus:outline-none transition-colors"
                    />
                    {symbolDropdown.length > 0 && (
                      <div className="absolute z-10 left-0 right-0 mt-1 bg-card border border-border
                        rounded-lg overflow-hidden shadow-lg">
                        {symbolDropdown.map(sym => (
                          <button
                            key={sym}
                            type="button"
                            onMouseDown={() => selectSymbol(sym)}
                            className="w-full text-left px-4 py-2 font-mono text-sm text-text
                              hover:bg-accent/10 hover:text-accent transition-colors"
                          >
                            {sym}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Other input fields */}
                {[
                  { key: "entryPrice", label: "Entry Price ₹", placeholder: "5075", type: "number" },
                  { key: "lotSize",    label: "Lot Size",      placeholder: "150",  type: "number" },
                  { key: "entryDate",  label: "Entry Date",    placeholder: "",     type: "date"   },
                ].map(f => (
                  <div key={f.key}>
                    <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-1.5">
                      {f.label}
                    </label>
                    <input
                      type={f.type}
                      value={form[f.key]}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full bg-bg border border-border rounded-lg px-4 py-2.5
                        font-mono text-sm text-text placeholder-muted focus:border-accent
                        focus:outline-none transition-colors"
                    />
                    {f.key === "lotSize" && (
                      <p className="font-mono text-[9px] text-dim mt-1">
                        {lotSizeLoading ? "Fetching lot size from MCP..." : form.lotSize ? "From MCP — edit if needed" : ""}
                      </p>
                    )}
                  </div>
                ))}

                {/* Target month */}
                <div>
                  <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-1.5">
                    Target Month
                  </label>
                  <select
                    value={form.targetMonth}
                    onChange={e => setForm(f => ({ ...f, targetMonth: parseInt(e.target.value) }))}
                    className="w-full bg-bg border border-border rounded-lg px-4 py-2.5
                      font-mono text-sm text-text focus:border-accent focus:outline-none"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>

                <div className="font-mono text-[10px] text-dim">
                  Median return and avg return auto-fetched from your MCP server
                </div>

                <button
                  onClick={addPosition}
                  disabled={addingPosition}
                  className="w-full font-mono text-sm py-3 rounded-lg border border-accent/30
                    bg-accent/15 text-accent hover:bg-accent/25 transition-colors font-bold
                    disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {addingPosition ? (
                    <>
                      <span className="inline-block w-3.5 h-3.5 border-2 border-accent/40
                        border-t-accent rounded-full animate-spin" />
                      Adding...
                    </>
                  ) : "Add Position"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {displayPositions.length === 0 && !showForm && (
          <div className="text-center py-20 border border-border rounded-lg">
            <div className="font-display text-2xl text-dim mb-2">No open positions</div>
            <div className="font-mono text-sm text-muted mb-6">
              Add your futures positions to track live P&amp;L and get daily exit recommendations
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="font-mono text-sm px-6 py-2.5 rounded-lg border border-accent/30
                bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              + Add First Position
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-border pt-4 mt-8 flex items-center justify-between">
          <div className="font-mono text-[10px] text-muted">
            Live prices via Upstox · Recommendations based on seasonal median targets · Not SEBI advice
          </div>
          <div className="font-mono text-[10px] text-muted">
            Crafted by <span className="text-accent">Khilan Patel</span>
          </div>
        </div>
      </main>
    </div>
  )
}
