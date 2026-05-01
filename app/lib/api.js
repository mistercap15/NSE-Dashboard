const MCP_URL    = process.env.MCP_URL    || "https://nse-data-mcp.vercel.app/mcp";
const MCP_SECRET = process.env.MCP_SECRET || "Hanuman0715";

async function callMCP(toolName, args = {}) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    next: { revalidate: 300 }, // 5-min cache
  });

  if (!res.ok) throw new Error(`MCP error ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// ── Public API functions ──────────────────────────────────────────────────────

export async function getMonthlyRanking(month, top = 25, sector = "ALL") {
  const result = await callMCP("get_monthly_ranking", { month, top, sector });
  // result._raw has the structured data
  return result._raw || parseTextResult(result);
}

export async function getAllRankings(top = 10) {
  const result = await callMCP("get_all_rankings", { top });
  return result._raw || parseTextResult(result);
}

export async function getStockData(symbol, startYear = 2009) {
  const result = await callMCP("get_stock_data", {
    symbol,
    start_year: startYear,
    interval: "MONTHLY",
    exchange: "NSE",
  });
  return result._raw || parseTextResult(result);
}

export async function getLotSize(symbol, currentPrice) {
  const args = { symbol };
  if (currentPrice) args.current_price = currentPrice;
  const result = await callMCP("get_lot_size", args);
  return result;
}

export async function getSeasonalitySummary(symbol, month) {
  const args = { symbol };
  if (month) args.month = month;
  const result = await callMCP("get_seasonality_summary", args);
  return result._raw || parseTextResult(result);
}

function parseTextResult(result) {
  // Fallback: return the text content if no _raw
  if (result?.content?.[0]?.text) return { text: result.content[0].text };
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getSignalClass(signal) {
  if (!signal) return "badge-neutral";
  const s = signal.toUpperCase();
  if (s.includes("PERFECT"))   return "badge-perfect";
  if (s.includes("EXCELLENT")) return "badge-excellent";
  if (s.includes("BULLISH"))   return "badge-bullish";
  if (s.includes("MILD"))      return "badge-mild";
  if (s.includes("AVOID"))     return "badge-avoid";
  if (s.includes("WEAK"))      return "badge-weak";
  return "badge-neutral";
}

export function getSignalLabel(winRate) {
  if (winRate === 100)  return "PERFECT";
  if (winRate >= 93)    return "EXCELLENT";
  if (winRate >= 80)    return "BULLISH";
  if (winRate >= 65)    return "MILD BULL";
  if (winRate >= 50)    return "NEUTRAL";
  if (winRate >= 40)    return "WEAK";
  return "AVOID";
}

export function getHeatmapColor(returnPct) {
  if (returnPct === null || returnPct === undefined) return "#1E2A3E";
  const v = Math.max(-15, Math.min(15, returnPct));
  if (returnPct >= 0) {
    const intensity = v / 15;
    const g = Math.round(80 + intensity * 110);
    const b = Math.round(60 + intensity * 40);
    return `rgb(0, ${g}, ${b})`;
  } else {
    const intensity = Math.abs(v) / 15;
    const r = Math.round(120 + intensity * 119);
    return `rgb(${r}, 20, 30)`;
  }
}

export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export const SECTORS = [
  "ALL","Banking","Finance","Insurance","IT","Pharma","Healthcare",
  "FMCG","Auto","Auto Ancillary","Cap Goods","Defence","Energy",
  "Oil&Gas","Utilities","Metals","Mining","Cement","Real Estate",
  "Consumer","Retail","Telecom","Chemicals","Paints","Infra",
  "Logistics","Aviation","Agri","Electronics","Cables","Tech","Fintech",
];
