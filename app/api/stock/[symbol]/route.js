import { NextResponse } from "next/server";

const MCP_URL = process.env.MCP_URL || "https://nse-data-mcp.vercel.app/mcp";

async function callMCPTool(toolName, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    next: { revalidate: 3600 }, // cache 1 hour for stock detail
  });

  if (!res.ok) throw new Error(`MCP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

export async function GET(request, { params }) {
  const symbol = params.symbol?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: "Symbol required" }, { status: 400 });

  try {
    const result = await callMCPTool("get_stock_data", {
      symbol,
      start_year: 2009,
      interval: "MONTHLY",
      exchange: "NSE",
    });

    const raw = result?._raw;
    if (!raw) return NextResponse.json({ error: "No data found for " + symbol }, { status: 404 });

    return NextResponse.json(raw);
  } catch (e) {
    console.error(`Stock API error [${symbol}]:`, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
