import { NextResponse }                        from "next/server"
import { hasValidToken, setAccessToken, isTokenExpired } from "@/app/lib/upstox"

export async function GET(request) {
  const cookie = request.cookies.get("upstox_token")?.value
  if (cookie) setAccessToken(cookie)

  const expired   = isTokenExpired()
  const connected = hasValidToken() && !expired

  const res = NextResponse.json({ connected, expired })

  // Auto-clear the stale cookie so the UI shows the correct login state
  if (expired && cookie) {
    res.cookies.delete("upstox_token")
  }

  return res
}
