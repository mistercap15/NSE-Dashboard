import { NextResponse } from "next/server";

const MCP_URL    = process.env.MCP_URL    || "https://nse-data-mcp.vercel.app/mcp";

async function callMCPTool(toolName, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id:      Date.now(),
      method:  "tools/call",
      params:  { name: toolName, arguments: args },
    }),
    next: { revalidate: 300 },
  });

  if (!res.ok) throw new Error(`MCP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const month  = parseInt(searchParams.get("month") || "1");
  const top    = parseInt(searchParams.get("top")   || "25");
  const sector = searchParams.get("sector") || "ALL";

  try {
    const result = await callMCPTool("get_monthly_ranking", { month, top, sector });

    // _raw contains the structured data from Apps Script
    const raw = result?._raw;

    if (!raw) {
      return NextResponse.json({
        error:        "No data from master sheet",
        top_stocks:   [],
        avoid_stocks: [],
        total_stocks: 0,
        month,
        month_name:   ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][month-1],
      });
    }

    // Build short candidates from avoid_stocks + bottom of top_stocks
    const allStocks = [
      ...(raw.avoid_stocks || []),
      ...(raw.top_stocks || []).filter(s => s.win_rate < 50)
    ]

    // Deduplicate by symbol
    const seen = new Set()
    const shortCandidates = allStocks
      .filter(s => {
        if (seen.has(s.symbol)) return false
        seen.add(s.symbol)
        return true
      })
      .sort((a, b) => {
        // Primary: lowest win rate first
        if (a.win_rate !== b.win_rate) return a.win_rate - b.win_rate
        // Secondary: most negative avg return first
        return a.avg_return - b.avg_return
      })
      .map(s => ({
        ...s,
        // Short SL = 1.3x the best positive month (worst case squeeze)
        short_sl_pct: Math.min(Math.max(Math.abs(s.best || 0) * 1.3, 4), 20),
        // Short score: lower is better short candidate
        short_score: (s.win_rate * 0.6) + (s.avg_return * 4),
        // Probability of profit on short = 100 - win_rate
        short_win_prob: 100 - s.win_rate,
      }))

    return NextResponse.json({
      ...raw,
      short_candidates: shortCandidates.slice(0, 20),
    });
  } catch (e) {
    console.error("Rankings API error:", e.message);
    return NextResponse.json(
      { error: e.message, top_stocks: [], avoid_stocks: [], total_stocks: 0 },
      { status: 500 }
    );
  }
}
