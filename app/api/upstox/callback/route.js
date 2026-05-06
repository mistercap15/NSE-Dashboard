import { NextResponse } from "next/server"
import { exchangeCodeForToken } from "@/app/lib/upstox"

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get("code")
  const error = searchParams.get("error")

  if (error) {
    return NextResponse.redirect(
      new URL(`/?upstox_error=${error}`, request.url)
    )
  }

  if (!code) {
    return NextResponse.json({ error: "No auth code received" }, { status: 400 })
  }

  try {
    const tokenData = await exchangeCodeForToken(code)

    // Store token in HttpOnly cookie — persists across Vercel serverless invocations
    const response = NextResponse.redirect(
      new URL("/?upstox_connected=true", request.url)
    )
    response.cookies.set("upstox_token", tokenData.access_token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   60 * 60 * 24, // 24 hours (Upstox tokens expire daily)
      path:     "/",
    })
    return response
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/?upstox_error=${encodeURIComponent(e.message)}`, request.url)
    )
  }
}
