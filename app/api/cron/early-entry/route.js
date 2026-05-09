import { NextResponse }        from "next/server"
import { headers }             from "next/headers"
import { sendEarlyEntryAlert } from "@/app/lib/email"
import fs   from "fs"
import path from "path"

const CRON_SECRET = process.env.CRON_SECRET || "nse-cron-2026"

function readStoredToken() {
  try {
    return fs.readFileSync(path.join(process.cwd(), ".upstox_token"), "utf8").trim() || null
  } catch { return null }
}

export async function GET() {
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
    const nextMonth = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2

    const appUrl    = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    const token     = process.env.UPSTOX_ACCESS_TOKEN || readStoredToken()

    const fetchHeaders = { "x-internal": "cron" }
    if (token) fetchHeaders["x-upstox-token"] = token

    const res  = await fetch(
      `${appUrl}/api/early-entry?month=${nextMonth}`,
      { headers: fetchHeaders }
    )
    const data = await res.json()

    if (data.error) throw new Error(data.error)

    // Include BUY, BUY_HALF, and WATCH — so user always gets stocks to look at
    const signals = (data.results || []).filter(s =>
      s.status === "BUY" || s.status === "BUY_HALF" || s.status === "WATCH"
    )

    let emailResult = { sent: false, reason: "No signals found" }
    if (signals.length > 0) {
      emailResult = await sendEarlyEntryAlert(signals)
    }

    return NextResponse.json({
      success:     true,
      scannedAt:   new Date().toISOString(),
      targetMonth: nextMonth,
      candidates:  data.totalCandidates || 0,
      buySignals:  (data.results || []).filter(s => s.status === "BUY").length,
      watchSignals:(data.results || []).filter(s => s.status === "WATCH").length,
      emailedCount: signals.length,
      email:       emailResult,
    })

  } catch (e) {
    console.error("Early entry cron error:", e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
