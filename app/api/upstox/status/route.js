import { NextResponse } from "next/server"
import {
  hasValidToken,
  setAccessToken,
  isTokenExpired,
  hasAnalyticsToken,
} from "@/app/lib/upstox"
import { SESSION_COOKIE, UPSTOX_COOKIE, upstoxTokenFor } from "@/app/lib/auth"

// ─────────────────────────────────────────────────────────────────────────────
// Whether the app can fetch market data right now, and on whose credential.
//
// This used to mean "did you complete the Upstox OAuth dance today". It now
// reports the actual state, because market data comes from a long-lived
// analytics token in env and normally involves no user login at all:
//
// `oauthLinked` is a separate question from `connected`, and both are needed.
// Market data works off the analytics token, so `connected` is true whether or
// not anyone has ever logged in — which makes it useless for deciding whether to
// offer a login. `oauthLinked` answers only "does THIS request carry a personal
// Upstox token", which is what the bot-token sync actually requires.
//
//   source "analytics" — UPSTOX_ANALYTICS_TOKEN is set. Connected, and it stays
//                        connected: a year-long token has no daily expiry, so
//                        `expired` is always false and nothing should ever
//                        prompt for a login.
//   source "oauth"     — no analytics token; running on a per-session OAuth
//                        token exactly as before, daily expiry included.
//   source null        — neither. Price features degrade; seasonality is fine.
//
// `expired` is load-bearing beyond the banners: AuthWatcher redirects every open
// tab to /login when it sees it, and the branch below clears BOTH cookies. That
// is correct for a dead OAuth session and quite wrong for an analytics token,
// which is why isTokenExpired() never reports one as expired.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request) {
  // Cookie (web) or the encrypted claim in the bearer session (mobile). Still
  // honoured so a deliberate OAuth login keeps working, and so nothing changes
  // in an environment without the analytics token.
  const cookie = await upstoxTokenFor(request)
  if (cookie) setAccessToken(cookie)

  const analytics = hasAnalyticsToken()
  const expired   = isTokenExpired()
  const connected = hasValidToken() && !expired
  const source    = analytics ? "analytics" : connected ? "oauth" : null

  // The OAuth cookie carries the same 03:30 IST maxAge as the session, so the
  // browser drops it when it dies — presence is a good enough proxy for
  // validity, and a stale one still fails loudly at the sync itself.
  const oauthLinked = Boolean(cookie)

  const res = NextResponse.json({ connected, expired, source, oauthLinked })

  // OAuth expired → clear both cookies so the next navigation falls through the
  // middleware to /login. Only reachable on the OAuth path: with an analytics
  // token `expired` is never true, so a working env token can never log anyone
  // out or destroy their PIN session.
  if (expired && cookie) {
    res.cookies.delete(UPSTOX_COOKIE)
    res.cookies.delete(SESSION_COOKIE)
  }

  return res
}
