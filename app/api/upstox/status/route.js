import { NextResponse } from "next/server"
import { hasValidToken, setAccessToken } from "@/app/lib/upstox"

export async function GET(request) {
  const cookie = request.cookies.get("upstox_token")?.value
  if (cookie) setAccessToken(cookie)
  return NextResponse.json({ connected: hasValidToken() })
}
