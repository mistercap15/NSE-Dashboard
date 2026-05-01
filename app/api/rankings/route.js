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

    return NextResponse.json(raw);
  } catch (e) {
    console.error("Rankings API error:", e.message);
    return NextResponse.json(
      { error: e.message, top_stocks: [], avoid_stocks: [], total_stocks: 0 },
      { status: 500 }
    );
  }
}
