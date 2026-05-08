import { NextResponse }        from "next/server"
import { headers }             from "next/headers"
import { sendEarlyEntryAlert } from "@/app/lib/email"

const CRON_SECRET = process.env.CRON_SECRET || "nse-cron-2026"

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
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

    const now       = new Date()
    const nextMonth = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2

    const res  = await fetch(
      `${appUrl}/api/early-entry?month=${nextMonth}`,
      { headers: { "x-internal": "cron" } }
    )
    const data = await res.json()

    if (data.error) throw new Error(data.error)

    const buySignals = (data.results || []).filter(s =>
      s.status === "BUY" || s.status === "BUY_HALF"
    )

    let emailResult = { sent: false, reason: "No buy signals" }
    if (buySignals.length > 0) {
      emailResult = await sendEarlyEntryAlert(buySignals)
    }

    return NextResponse.json({
      success:     true,
      scannedAt:   new Date().toISOString(),
      targetMonth: nextMonth,
      candidates:  data.totalCandidates || 0,
      buySignals:  buySignals.length,
      email:       emailResult,
    })

  } catch (e) {
    console.error("Early entry cron error:", e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
