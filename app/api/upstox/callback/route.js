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

    // Store token in env for this session
    // In production: save to Vercel KV or encrypted cookie
    process.env.UPSTOX_ACCESS_TOKEN = tokenData.access_token

    // Redirect to dashboard with success message
    return NextResponse.redirect(
      new URL("/?upstox_connected=true", request.url)
    )
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/?upstox_error=${encodeURIComponent(e.message)}`, request.url)
    )
  }
}
