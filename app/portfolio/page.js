"use client"
import { useState, Fragment } from "react"
import Sidebar from "../components/Sidebar"
import StopLossCard from "../components/StopLossCard"

// ── F&O symbols list ──────────────────────────────────────────────────────────

const FO_SYMBOLS = [
  "360ONE","ABB","ABCAPITAL","ADANIENSOL","ADANIENT","ADANIGREEN","ADANIPORTS",
  "ADANIPOWER","ALKEM","AMBER","AMBUJACEM","ANGELONE","APLAPOLLO","APOLLOHOSP",
  "ASHOKLEY","ASIANPAINT","ASTRAL","AUBANK","AUROPHARMA","AXISBANK","BAJAJ-AUTO",
  "BAJAJFINSV","BAJAJHLDNG","BAJFINANCE","BANDHANBNK","BANKBARODA","BANKINDIA",
  "BDL","BEL","BHARATFORG","BHARTIARTL","BHEL","BIOCON","BLUESTARCO","BOSCHLTD",
  "BPCL","BRITANNIA","BSE","CAMS","CANBK","CDSL","CGPOWER","CHOLAFIN","CIPLA",
  "COALINDIA","COCHINSHIP","COFORGE","COLPAL","CONCOR","CROMPTON","CUMMINSIND",
  "DABUR","DALBHARAT","DELHIVERY","DIVISLAB","DIXON","DLF","DMART","DRREDDY",
  "EICHERMOT","ETERNAL","EXIDEIND","FEDERALBNK","FORCEMOT","FORTIS","GAIL",
  "GLENMARK","GMRAIRPORT","GODFRYPHLP","GODREJCP","GODREJPROP","GRASIM","HAL",
  "HAVELLS","HCLTECH","HDFCAMC","HDFCBANK","HDFCLIFE","HEROMOTOCO","HINDALCO",
  "HINDPETRO","HINDUNILVR","HINDZINC","HYUNDAI","ICICIBANK","ICICIGI","ICICIPRULI",
  "IDFCFIRSTB","IEX","INDHOTEL","INDIANB","INDIGO","INDUSINDBK","INDUSTOWER",
  "INFY","INOXWIND","IOC","IREDA","IRFC","ITC","JINDALSTEL","JIOFIN","JSWENERGY",
  "JSWSTEEL","JUBLFOOD","KALYANKJIL","KAYNES","KEI","KFINTECH","KOTAKBANK",
  "KPITTECH","LAURUSLABS","LICHSGFIN","LICI","LODHA","LT","LTF","LTM","LUPIN",
  "M&M","MANAPPURAM","MANKIND","MARICO","MARUTI","MAXHEALTH","MAZDOCK","MCX",
  "MFSL","MOTHERSON","MOTILALOFS","MPHASIS","MUTHOOTFIN","NAM-INDIA","NATIONALUM",
  "NAUKRI","NBCC","NESTLEIND","NHPC","NMDC","NTPC","NUVAMA","NYKAA","OBEROIRLTY",
  "OFSS","OIL","ONGC","PAGEIND","PATANJALI","PAYTM","PERSISTENT","PETRONET",
  "PHOENIXLTD","PIDILITIND","PIIND","POLICYBZR","POLYCAB","POWERGRID","PFC",
  "PNBHOUSING","PNB","PRESTIGE","RBLBANK","RECLTD","RELIANCE","RVNL","SAIL",
  "SBICARD","SBILIFE","SHREECEM","SHRIRAMFIN","SIEMENS","SOLARINDS","SONACOMS",
  "SRF","SBIN","SUNPHARMA","SUPREMEIND","SUZLON","SWIGGY","TATACONSUM","TATAMOTORS",
  "TATAPOWER","TATASTEEL","TCS","TATAELXSI","TECHM","TIINDIA","TITAN","TORNTPHARM",
  "TRENT","TVSMOTOR","ULTRACEMCO","UNIONBANK","UNOMINDA","UPL","UNITDSPR","VBL",
  "VEDL","VOLTAS","WIPRO","ZYDUSLIFE",
]

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
const MONTH_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
]

const currentMonth = new Date().getMonth() + 1
const currentYear  = new Date().getFullYear()

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSignalLabel(wr) {
  if (wr === 100) return "PERFECT"
  if (wr >= 93)   return "EXCELLENT"
  if (wr >= 80)   return "BULLISH"
  if (wr >= 65)   return "MILD BULL"
  if (wr >= 50)   return "NEUTRAL"
  if (wr >= 40)   return "WEAK"
  return "AVOID"
}

function getSignalClass(wr) {
  if (wr >= 93)  return "badge-perfect"
  if (wr >= 80)  return "badge-excellent"
  if (wr >= 65)  return "badge-bullish"
  if (wr >= 50)  return "badge-mild"
  if (wr >= 40)  return "badge-weak"
  return "badge-avoid"
}

function fmt(n) {
  const abs = Math.abs(Math.round(n))
  return n >= 0 ? `+₹${abs.toLocaleString("en-IN")}` : `-₹${abs.toLocaleString("en-IN")}`
}

// ── Auto-fetch stock data from API ────────────────────────────────────────────

async function fetchStockForPortfolio(symbol) {
  const res = await fetch(`/api/stock/${symbol}`)
  if (!res.ok) throw new Error(`Could not fetch data for ${symbol}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)

  const seasonality  = data.seasonality || []
  const monthData    = seasonality[currentMonth - 1] || {}
  const prices       = data.prices || []
  const lastPrice    = prices[prices.length - 1]?.close || 0

  const worstReturn  = monthData.worst || 0
  const rawSL        = Math.abs(worstReturn) * 1.2
  const suggestedSL  = Math.min(Math.max(rawSL, 3), 15)

  return {
    symbol:         data.symbol,
    lot_size:       data.lot_size,
    last_price:     lastPrice,
    win_rate:       monthData.win_rate       || 0,
    avg_return:     monthData.avg_return     || 0,
    best:           monthData.best           || 0,
    worst:          monthData.worst          || 0,
    data_points:    monthData.data_points    || 0,
    positive_years: monthData.positive_years || 0,
    signal:         getSignalLabel(monthData.win_rate || 0),
    suggested_sl:   suggestedSL,
    seasonality,
  }
}

// ── Page component ────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [positions,  setPositions]  = useState([])
  const [symbol,     setSymbol]     = useState("")
  const [price,      setPrice]      = useState("")
  const [lots,       setLots]       = useState("1")
  const [dropdown,   setDropdown]   = useState([])
  const [fetching,   setFetching]   = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [selected,   setSelected]   = useState(null)

  const handleSymbolChange = (val) => {
    const v = val.toUpperCase()
    setSymbol(v)
    setDropdown(v.length >= 1 ? FO_SYMBOLS.filter(s => s.includes(v)).slice(0, 8) : [])
  }

  const selectSymbol = (sym) => {
    setSymbol(sym)
    setDropdown([])
  }

  const addPosition = async () => {
    if (!symbol || !price) return
    setFetching(true)
    setFetchError(null)
    try {
      const stockData   = await fetchStockForPortfolio(symbol)
      const entryPrice  = parseFloat(price)
      const lotMult     = parseInt(lots) || 1
      const lotSize     = stockData.lot_size || 100
      const totalShares = lotSize * lotMult
      const notional    = entryPrice * totalShares

      const bearPnl  = notional * (stockData.avg_return * 0.3) / 100
      const basePnl  = notional * stockData.avg_return          / 100
      const bullPnl  = notional * (stockData.avg_return * 1.5) / 100
      const slAmount = notional * stockData.suggested_sl        / 100
      const slPrice  = entryPrice * (1 - stockData.suggested_sl / 100)
      const rrRatio  = stockData.suggested_sl > 0
        ? stockData.avg_return / stockData.suggested_sl
        : 0

      setPositions(prev => [...prev, {
        id:             Date.now(),
        symbol,
        entry_price:    entryPrice,
        lot_size:       lotSize,
        lot_multiplier: lotMult,
        total_shares:   totalShares,
        notional,
        win_rate:       stockData.win_rate,
        avg_return:     stockData.avg_return,
        best:           stockData.best,
        worst:          stockData.worst,
        data_points:    stockData.data_points,
        positive_years: stockData.positive_years,
        signal:         stockData.signal,
        suggested_sl:   stockData.suggested_sl,
        sl_price:       slPrice,
        sl_amount:      slAmount,
        rr_ratio:       rrRatio,
        bear_pnl:       bearPnl,
        base_pnl:       basePnl,
        bull_pnl:       bullPnl,
        seasonality:    stockData.seasonality,
        last_price:     stockData.last_price,
      }])
      setSymbol("")
      setPrice("")
      setLots("1")
    } catch (e) {
      setFetchError(e.message)
    } finally {
      setFetching(false)
    }
  }

  const removePosition = (id) => {
    setPositions(prev => prev.filter(p => p.id !== id))
    if (selected === id) setSelected(null)
  }

  const totals = positions.reduce((acc, p) => ({
    notional: acc.notional + p.notional,
    bear:     acc.bear     + p.bear_pnl,
    base:     acc.base     + p.base_pnl,
    bull:     acc.bull     + p.bull_pnl,
    maxLoss:  acc.maxLoss  + p.sl_amount,
  }), { notional: 0, bear: 0, base: 0, bull: 0, maxLoss: 0 })

  const portfolioWinProb = positions.length > 0
    ? positions.reduce((a, p) => a * (p.win_rate / 100), 1) * 100
    : 0

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">

        {/* HEADER */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">
            F&O Portfolio
          </div>
          <h1 className="font-display text-3xl font-bold text-text">
            Portfolio Tracker<span className="text-accent">.</span>
          </h1>
          <p className="font-body text-sm text-dim mt-1">
            Add your futures positions — win rate, P&L and stop loss are auto-fetched from real data.
          </p>
          <div className="font-mono text-[11px] text-accent mt-1">
            {MONTH_FULL[currentMonth - 1]} {currentYear} · Monthly series
          </div>
        </div>

        {/* ADD POSITION FORM */}
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <h2 className="font-display text-sm font-semibold text-text mb-4">Add Position</h2>

          <div className="flex gap-4 items-end flex-wrap">

            {/* Symbol with autocomplete */}
            <div className="relative flex-1 min-w-[180px]">
              <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-1.5">
                Stock Symbol
              </label>
              <input
                value={symbol}
                onChange={e => handleSymbolChange(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addPosition() }}
                placeholder="e.g. TITAN"
                className="w-full bg-bg border border-border rounded-lg px-4 py-2.5 font-mono text-sm text-text placeholder-muted focus:border-accent focus:outline-none transition-colors"
              />
              {dropdown.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-lg overflow-hidden shadow-xl">
                  {dropdown.map(sym => (
                    <button
                      key={sym}
                      onClick={() => selectSymbol(sym)}
                      className="w-full text-left px-4 py-2.5 font-mono text-sm text-dim hover:text-text hover:bg-accent/5 transition-colors border-b border-border last:border-0"
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Entry price */}
            <div className="flex-1 min-w-[140px]">
              <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-1.5">
                Entry Price ₹
              </label>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addPosition() }}
                placeholder="e.g. 4410"
                className="w-full bg-bg border border-border rounded-lg px-4 py-2.5 font-mono text-sm text-text placeholder-muted focus:border-accent focus:outline-none transition-colors"
              />
            </div>

            {/* Lots */}
            <div className="w-[120px]">
              <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-1.5">
                Lots
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLots(l => String(Math.max(1, parseInt(l) - 1)))}
                  className="w-9 h-10 bg-bg border border-border rounded-lg text-dim hover:text-text font-mono text-lg transition-colors"
                >−</button>
                <input
                  type="number"
                  value={lots}
                  onChange={e => setLots(e.target.value)}
                  min="1"
                  className="flex-1 w-12 bg-bg border border-border rounded-lg px-2 py-2.5 font-mono text-sm text-text text-center focus:border-accent focus:outline-none"
                />
                <button
                  onClick={() => setLots(l => String(parseInt(l) + 1))}
                  className="w-9 h-10 bg-bg border border-border rounded-lg text-dim hover:text-text font-mono text-lg transition-colors"
                >+</button>
              </div>
            </div>

            {/* Add button */}
            <button
              onClick={addPosition}
              disabled={fetching || !symbol || !price}
              className="h-10 px-6 bg-accent/15 border border-accent/30 text-accent font-mono text-sm rounded-lg hover:bg-accent/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {fetching ? (
                <>
                  <div className="w-3.5 h-3.5 border border-accent border-t-transparent rounded-full animate-spin" />
                  Fetching...
                </>
              ) : "Add Position"}
            </button>
          </div>

          {fetchError && (
            <div className="mt-3 font-mono text-xs text-red bg-red/10 border border-red/20 rounded px-3 py-2">
              {fetchError}
            </div>
          )}

          <p className="font-mono text-[10px] text-muted mt-3">
            Win rate · avg return · lot size · stop loss are automatically fetched
            from real NSE historical data for {MONTHS[currentMonth - 1]}
          </p>
        </div>

        {/* PORTFOLIO SUMMARY + TABLE */}
        {positions.length > 0 && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
              {[
                { label: "Total Notional",    value: `₹${(totals.notional / 100000).toFixed(2)}L`, color: "text-text" },
                { label: "Bear P&L",          value: fmt(totals.bear),    color: "text-amber" },
                { label: "Base P&L",          value: fmt(totals.base),    color: "text-green" },
                { label: "Bull P&L",          value: fmt(totals.bull),    color: "text-accent" },
                {
                  label: "Portfolio Win Prob",
                  value: `${portfolioWinProb.toFixed(1)}%`,
                  color: portfolioWinProb > 70 ? "text-green" : "text-amber",
                },
              ].map(st => (
                <div key={st.label} className="bg-card border border-border rounded-lg p-4">
                  <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">{st.label}</div>
                  <div className={`font-mono text-lg font-medium ${st.color}`}>{st.value}</div>
                </div>
              ))}
            </div>

            <div className="bg-card border border-border rounded-lg overflow-hidden mb-6">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold text-text">
                  {positions.length} Open Position{positions.length > 1 ? "s" : ""}
                </h2>
                <span className="font-mono text-[10px] text-dim">
                  Click a row to see stop loss detail
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {[
                        "Symbol","Entry ₹","Lots","Notional",
                        "Win Rate","Avg Return","Bear","Base","Bull",
                        "Suggested SL","SL Price","R:R","Signal","",
                      ].map(h => (
                        <th
                          key={h}
                          className="text-right first:text-left py-2.5 px-3 font-mono text-[10px] text-dim font-normal whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(p => (
                      <Fragment key={p.id}>
                        <tr
                          onClick={() => setSelected(selected === p.id ? null : p.id)}
                          className={`table-row cursor-pointer transition-colors ${selected === p.id ? "bg-accent/5" : ""}`}
                        >
                          <td className="py-3 px-3 font-mono text-[13px] font-medium text-accent">{p.symbol}</td>
                          <td className="py-3 px-3 font-mono text-[12px] text-right">
                            ₹{p.entry_price.toLocaleString("en-IN")}
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-right text-dim">
                            {p.lot_multiplier} × {p.lot_size.toLocaleString("en-IN")}
                          </td>
                          <td className="py-3 px-3 font-mono text-[12px] text-right">
                            ₹{(p.notional / 100000).toFixed(2)}L
                          </td>
                          <td className="py-3 px-3 font-mono text-[12px] text-right">
                            <span className={p.win_rate >= 80 ? "text-green" : p.win_rate >= 60 ? "text-amber" : "text-red"}>
                              {p.win_rate.toFixed(1)}%
                            </span>
                            <span className="text-muted text-[10px] ml-1">
                              ({p.positive_years}/{p.data_points})
                            </span>
                          </td>
                          <td className={`py-3 px-3 font-mono text-[12px] text-right font-medium ${p.avg_return >= 0 ? "text-green" : "text-red"}`}>
                            {p.avg_return >= 0 ? "+" : ""}{p.avg_return.toFixed(2)}%
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-right text-amber">{fmt(p.bear_pnl)}</td>
                          <td className="py-3 px-3 font-mono text-[12px] text-right text-green font-medium">{fmt(p.base_pnl)}</td>
                          <td className="py-3 px-3 font-mono text-[11px] text-right text-accent">{fmt(p.bull_pnl)}</td>
                          <td className="py-3 px-3 font-mono text-[12px] text-right text-red">
                            -{p.suggested_sl.toFixed(1)}%
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-right text-red">
                            ₹{p.sl_price.toFixed(1)}
                          </td>
                          <td className={`py-3 px-3 font-mono text-[11px] text-right ${p.rr_ratio >= 2 ? "text-green" : p.rr_ratio >= 1 ? "text-amber" : "text-red"}`}>
                            {p.rr_ratio.toFixed(2)}:1
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className={`badge ${getSignalClass(p.win_rate)}`}>{p.signal}</span>
                          </td>
                          <td className="py-3 px-3">
                            <button
                              onClick={e => { e.stopPropagation(); removePosition(p.id) }}
                              className="font-mono text-[11px] text-muted hover:text-red transition-colors px-1"
                            >✕</button>
                          </td>
                        </tr>

                        {selected === p.id && (
                          <tr>
                            <td colSpan={14} className="px-4 pb-4 bg-accent/[0.02]">
                              <StopLossCard
                                seasonality={p.seasonality}
                                currentMonth={currentMonth}
                                entryPrice={p.entry_price}
                                symbol={p.symbol}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>

                  {positions.length > 1 && (
                    <tfoot>
                      <tr className="border-t-2 border-border">
                        <td colSpan={3} className="py-3 px-3 font-mono text-[11px] text-dim">PORTFOLIO TOTAL</td>
                        <td className="py-3 px-3 font-mono text-[12px] text-right text-soft">
                          ₹{(totals.notional / 100000).toFixed(2)}L
                        </td>
                        <td colSpan={2} />
                        <td className="py-3 px-3 font-mono text-[11px] text-right text-amber font-medium">{fmt(totals.bear)}</td>
                        <td className="py-3 px-3 font-mono text-[12px] text-right text-green font-medium">{fmt(totals.base)}</td>
                        <td className="py-3 px-3 font-mono text-[11px] text-right text-accent font-medium">{fmt(totals.bull)}</td>
                        <td colSpan={5} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* MAX LOSS WARNING */}
            <div className="bg-red/5 border border-red/20 rounded-lg px-5 py-3 flex items-center justify-between mb-6">
              <div>
                <div className="font-mono text-[10px] text-red uppercase tracking-widest mb-1">
                  Maximum portfolio loss (if all SLs hit simultaneously)
                </div>
                <div className="font-mono text-lg font-medium text-red">
                  -₹{Math.round(totals.maxLoss).toLocaleString("en-IN")}
                </div>
              </div>
              <div className="font-mono text-[11px] text-dim text-right">
                <div>Win probability: {portfolioWinProb.toFixed(1)}%</div>
                <div className="text-muted mt-1">all positions profitable</div>
              </div>
            </div>
          </>
        )}

        {/* EMPTY STATE */}
        {positions.length === 0 && (
          <div className="text-center py-20 border border-border rounded-lg">
            <div className="font-display text-2xl text-dim mb-2">No positions yet</div>
            <div className="font-mono text-[12px] text-muted">
              Type a stock symbol above and add your entry price
            </div>
            <div className="font-mono text-[11px] text-muted mt-1">
              Win rate, P&L and stop loss are fetched automatically
            </div>
          </div>
        )}

        {/* FOOTER */}
        <div className="border-t border-border pt-4 flex items-center justify-between mt-4">
          <div className="font-mono text-[10px] text-muted">
            All P&L based on real historical {MONTHS[currentMonth - 1]} seasonality data
          </div>
          <div className="font-mono text-[10px] text-muted">
            Crafted by <span className="text-accent">Khilan Patel</span>
          </div>
        </div>

      </main>
    </div>
  )
}
