import { NextResponse } from "next/server"
import { exchangeCodeForToken } from "@/app/lib/upstox"
import { sessionMaxAge, safeNext } from "@/app/lib/auth"

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get("code")
  const error = searchParams.get("error")
  // `state` is the page the user was heading to before the OAuth round-trip.
  const next  = safeNext(searchParams.get("state"))

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

    // Store token in HttpOnly cookie — persists across Vercel serverless invocations.
    // Expire it at the same 03:30 IST boundary as the session so they lapse together.
    const response = NextResponse.redirect(new URL(next, request.url))
    response.cookies.set("upstox_token", tokenData.access_token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   sessionMaxAge(),
      path:     "/",
    })
    return response
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/?upstox_error=${encodeURIComponent(e.message)}`, request.url)
    )
  }
}
