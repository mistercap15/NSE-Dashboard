import { NextResponse }        from "next/server"
import { headers }             from "next/headers"
import { sendWatchlistAlert }  from "@/app/lib/email"

const CRON_SECRET = process.env.CRON_SECRET || "nse-cron-2026"
const MCP_URL     = process.env.MCP_URL     || "https://nse-data-mcp.vercel.app/mcp"

async function callMCP(toolName, args) {
  const res = await fetch(MCP_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      jsonrpc: "2.0", id: Date.now(),
      method:  "tools/call",
      params:  { name: toolName, arguments: args },
    }),
  })
  const data = await res.json()
  return data.result?._raw
}

export async function GET(request) {
  const headersList = await headers()
  const cronHeader  = headersList.get("x-vercel-cron")
  const authHeader  = headersList.get("authorization")
  const isVercel    = cronHeader === "1"
  const hasSecret   = authHeader === `Bearer ${CRON_SECRET}`

  if (!isVercel && !hasSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const now       = new Date()
    // Target = next calendar month (the month we're scanning entry for)
    const nextMonth = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2

    // Get top stocks for next month directly from MCP — no Upstox needed
    const rankings = await callMCP("get_monthly_ranking", {
      month:  nextMonth,
      top:    20,
      sector: "ALL",
    })

    const candidates = (rankings?.top_stocks || []).filter(s => {
      const totalYears = (s.positive_years || 0) + (s.negative_years || 0)
      return totalYears >= 5 && (s.win_rate || 0) >= 75
    }).slice(0, 15)

    if (candidates.length === 0) {
      return NextResponse.json({
        success:     true,
        scannedAt:   new Date().toISOString(),
        targetMonth: nextMonth,
        candidates:  0,
        email:       { sent: false, reason: "No qualifying stocks for this month" },
      })
    }

    const emailResult = await sendWatchlistAlert(candidates, nextMonth)

    return NextResponse.json({
      success:     true,
      scannedAt:   new Date().toISOString(),
      targetMonth: nextMonth,
      candidates:  candidates.length,
      email:       emailResult,
    })

  } catch (e) {
    console.error("Early entry cron error:", e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
