import { NextResponse }        from "next/server"
import { headers }             from "next/headers"
import { sendEarlyEntryAlert } from "@/app/lib/email"
import fs   from "fs"
import path from "path"

const CRON_SECRET = process.env.CRON_SECRET || "nse-cron-2026"
const TOKEN_FILE  = path.join(process.cwd(), ".upstox_token")

function readStoredToken() {
  try { return fs.readFileSync(TOKEN_FILE, "utf8").trim() || null } catch { return null }
}

export async function GET() {
  const headersList = await headers()
  const isVercel    = headersList.get("x-vercel-cron") === "1"
  const hasSecret   = headersList.get("authorization") === `Bearer ${CRON_SECRET}`

  if (!isVercel && !hasSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ── Token check ──────────────────────────────────────────────────
  const token = process.env.UPSTOX_ACCESS_TOKEN || readStoredToken()
  if (!token) {
    return NextResponse.json({
      success: false,
      message: "No Upstox token found. Please log in to the dashboard first — the cron will work once you authenticate for the day.",
      emailSent: false,
    })
  }

  try {
    const now       = new Date()
    const nextMonth = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2
    const appUrl    = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

    const res  = await fetch(`${appUrl}/api/early-entry?month=${nextMonth}`, {
      headers: { "x-upstox-token": token },
    })
    const data = await res.json()

    if (data.error) {
      // TOKEN_EXPIRED comes through as an error from early-entry
      if (data.error.includes("TOKEN_EXPIRED") || data.error.includes("expired")) {
        return NextResponse.json({
          success:   false,
          message:   "Upstox token expired. Please log in to the dashboard to get a fresh token for today.",
          emailSent: false,
        })
      }
      throw new Error(data.error)
    }

    const signals = (data.results || []).filter(s =>
      s.status === "BUY" || s.status === "BUY_HALF" || s.status === "WATCH"
    )

    if (signals.length === 0) {
      return NextResponse.json({
        success:     true,
        scannedAt:   new Date().toISOString(),
        targetMonth: nextMonth,
        candidates:  data.totalCandidates || 0,
        message:     "Scan complete — no BUY/WATCH signals found for this month.",
        emailSent:   false,
      })
    }

    const emailResult = await sendEarlyEntryAlert(signals)

    return NextResponse.json({
      success:     true,
      scannedAt:   new Date().toISOString(),
      targetMonth: nextMonth,
      candidates:  data.totalCandidates || 0,
      signalsFound: signals.length,
      buyCount:    signals.filter(s => s.status === "BUY").length,
      watchCount:  signals.filter(s => s.status === "WATCH").length,
      emailSent:   emailResult.sent,
      emailError:  emailResult.error,
    })

  } catch (e) {
    console.error("Early entry cron error:", e.message)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
