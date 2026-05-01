"use client";
import { useState, useRef, useEffect } from "react";
import { Search } from "lucide-react";

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
];

export default function StockSearch({ onSelect, defaultValue = "", loading = false }) {
  const [query, setQuery]           = useState(defaultValue);
  const [open, setOpen]             = useState(false);
  const [activeIdx, setActiveIdx]   = useState(-1);
  const inputRef                    = useRef(null);
  const containerRef                = useRef(null);

  // Sync if parent updates defaultValue (e.g. back-navigation)
  useEffect(() => { setQuery(defaultValue); }, [defaultValue]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query.length >= 1
    ? FO_SYMBOLS.filter(s => s.includes(query.toUpperCase())).slice(0, 8)
    : [];

  const select = (symbol) => {
    setQuery(symbol);
    setOpen(false);
    setActiveIdx(-1);
    onSelect(symbol);
  };

  const handleKeyDown = (e) => {
    if (!open || filtered.length === 0) {
      if (e.key === "Enter" && query.trim()) {
        onSelect(query.trim().toUpperCase());
        setOpen(false);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(prev => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0) {
        select(filtered[activeIdx]);
      } else if (query.trim()) {
        onSelect(query.trim().toUpperCase());
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  return (
    <div ref={containerRef} className="flex gap-3 relative">

      {/* Input wrapper */}
      <div className="relative flex-1">
        <Search
          size={16}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-dim pointer-events-none"
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => query.length >= 1 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search stock... e.g. HINDUNILVR, TITAN, DIVISLAB"
          disabled={loading}
          className="w-full bg-card border border-border rounded-lg pl-11 pr-4 py-3.5 font-mono text-sm text-text placeholder-muted focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
        />

        {/* Autocomplete dropdown */}
        {open && filtered.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-xl overflow-hidden z-50">
            {filtered.map((sym, i) => (
              <button
                key={sym}
                onMouseDown={(e) => { e.preventDefault(); select(sym); }}
                className={`w-full text-left px-4 py-2.5 font-mono text-sm transition-colors ${
                  i === activeIdx
                    ? "bg-accent/10 text-accent"
                    : "text-text hover:bg-white/[0.04]"
                }`}
              >
                {sym}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Analyse button */}
      <button
        onClick={() => query.trim() && select(query.trim().toUpperCase())}
        disabled={loading || !query.trim()}
        className="font-mono text-sm bg-accent/15 border border-accent/30 text-accent px-6 rounded-lg hover:bg-accent/25 transition-colors disabled:opacity-40 whitespace-nowrap"
      >
        {loading ? "Loading…" : "Analyse →"}
      </button>
    </div>
  );
}
