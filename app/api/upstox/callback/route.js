import { NextResponse } from "next/server"
import { exchangeCodeForToken } from "@/app/lib/upstox"
import {
  sessionMaxAge,
  safeNext,
  createMobileSession,
  verifyLinkToken,
  isMobileState,
  MOBILE_STATE_PREFIX,
  MOBILE_RETURN,
} from "@/app/lib/auth"

// ─────────────────────────────────────────────────────────────────────────────
// Upstox OAuth callback. Two return paths, told apart by `state`:
//   • web    — state is a relative path; store the token in an HttpOnly cookie
//              and redirect back to the page the user came from.
//   • mobile — state is "m:<linkToken>"; the app has no cookie jar, so re-mint
//              its session with the Upstox token as an encrypted claim and hand
//              it back over the app's deep link.
//
// This route is public (Upstox has to reach it), so the mobile branch mints a
// session ONLY against a valid link token — itself only obtainable from an
// authenticated /api/upstox/mobile-login call. Without that check anyone who
// knew the URL could complete OAuth and be handed a session past the PIN.
// ─────────────────────────────────────────────────────────────────────────────

// Deep link back into the app, carrying either the new session or an error.
// `to` comes from the verified link token (so a dev client returns to its own
// exp:// URL); it falls back to the standalone app's scheme.
const appRedirect = (params, to = MOBILE_RETURN) =>
  NextResponse.redirect(`${to}?${new URLSearchParams(params)}`)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get("code")
  const error = searchParams.get("error")
  const state = searchParams.get("state")

  const mobile = isMobileState(state)
  // `state` is the page the user was heading to before the OAuth round-trip.
  const next = safeNext(state)

  if (error) {
    return mobile
      ? appRedirect({ error })
      : NextResponse.redirect(new URL(`/?upstox_error=${error}`, request.url))
  }

  if (!code) {
    return mobile
      ? appRedirect({ error: "No auth code received" })
      : NextResponse.json({ error: "No auth code received" }, { status: 400 })
  }

  // Mobile: prove this round-trip was started by an authenticated app session,
  // and take the return deep link from the signed token rather than the query.
  let appReturn = MOBILE_RETURN
  if (mobile) {
    const link = await verifyLinkToken(state.slice(MOBILE_STATE_PREFIX.length))
    if (!link) return appRedirect({ error: "Link expired — please try again" })
    appReturn = link.ret || MOBILE_RETURN
  }

  try {
    const tokenData = await exchangeCodeForToken(code)

    if (mobile) {
      // Re-mint the app's session with the Upstox token sealed inside it. Same
      // 03:30 IST expiry, so session and Upstox access lapse together.
      const session = await createMobileSession({ sub: "owner" }, tokenData.access_token)
      return appRedirect({ session }, appReturn)
    }

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
    return mobile
      ? appRedirect({ error: e.message }, appReturn)
      : NextResponse.redirect(new URL(`/?upstox_error=${encodeURIComponent(e.message)}`, request.url))
  }
}
