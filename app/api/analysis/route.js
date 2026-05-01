import { NextResponse } from "next/server";

const MCP_URL = process.env.MCP_URL || "https://nse-data-mcp.vercel.app/mcp";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: "Symbol required" }, { status: 400 });

  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: "get_stock_data",
          arguments: {
            symbol,
            start_year: 2009,
            interval: "MONTHLY",
            exchange: "NSE",
          },
        },
      }),
      next: { revalidate: 3600 },
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const raw = data.result?._raw;
    if (!raw) return NextResponse.json({ error: "No data found for " + symbol }, { status: 404 });
    return NextResponse.json(raw);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
