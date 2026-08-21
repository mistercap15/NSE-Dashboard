import { NextResponse } from "next/server";
import { verifySession, sessionToken } from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Route gate. ONE question is asked here: does this request carry a valid PIN
// session?
//   • Pages:  no session → /login?next=…
//   • API:    no session → 401 JSON
//
// The session arrives as the `app_session` cookie (web) or an `Authorization:
// Bearer` header (native app) — `sessionToken` accepts either.
//
// WHY THERE IS NO LONGER AN UPSTOX GATE HERE. The `upstox_token` cookie used to
// be checked on every page load, redirecting into the OAuth chain when missing.
// That made one cookie serve two unrelated jobs: proving the visitor is allowed
// in, and carrying a credential Upstox calls need. Because Upstox tokens die at
// 03:30 IST daily, the access half expired every night and forced a login just
// to look at a chart.
//
// The two jobs are now separate, and only the first belongs in middleware:
//   • AUTHORISATION — the PIN session, enforced below. Unchanged, and the only
//     thing standing between the internet and this dashboard.
//   • UPSTOX ACCESS — a credential concern, resolved per call in
//     app/lib/upstox.js (resolveAccessToken). Market data comes from a
//     long-lived analytics token in env, so no user login is involved.
//
// Removing the Upstox gate removes access to NOTHING: it never authorised
// anyone, it only forced an OAuth round-trip. /api/upstox/login and /callback
// stay public and fully working for the deliberate account login the bot-token
// sync will need — that flow is now opt-in rather than compulsory.
//
// It also removes a redirect loop that existed while both jobs shared a cookie:
// a failed token exchange redirected to /?upstox_error=…, which had no Upstox
// cookie, which bounced straight back into /api/upstox/login.
// ─────────────────────────────────────────────────────────────────────────────

// Reachable without a session (the login chain itself + Upstox OAuth round-trip).
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/upstox/login",
  "/api/upstox/callback",
]);

export async function middleware(request) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const session = await verifySession(sessionToken(request));
  const isApi = pathname.startsWith("/api/");

  // PIN session required everywhere. This is the whole gate.
  if (!session) {
    if (isApi) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Session is valid → the page is allowed, with or without an Upstox cookie.
  // Routes that need prices resolve their own credential and degrade on their
  // own terms; none of that is an access-control question.
  return NextResponse.next();
}

// Run on everything except Next internals and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
