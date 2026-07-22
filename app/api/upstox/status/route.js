import { NextResponse }                        from "next/server"
import { hasValidToken, setAccessToken, isTokenExpired } from "@/app/lib/upstox"
import { SESSION_COOKIE, UPSTOX_COOKIE }         from "@/app/lib/auth"

export async function GET(request) {
  const cookie = request.cookies.get("upstox_token")?.value
  if (cookie) setAccessToken(cookie)

  const expired   = isTokenExpired()
  const connected = hasValidToken() && !expired

  const res = NextResponse.json({ connected, expired })

  // Upstox expired → clear both cookies so the next navigation falls through the
  // middleware to /login, which re-runs the PIN → Upstox chain (one clean re-auth).
  if (expired && cookie) {
    res.cookies.delete(UPSTOX_COOKIE)
    res.cookies.delete(SESSION_COOKIE)
  }

  return res
}
