import { NextResponse } from "next/server";
import { SESSION_COOKIE, UPSTOX_COOKIE, verifySession, safeNext } from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Route gate. Enforces the PIN session on every request, and (for page loads)
// that Upstox is connected — redirecting into the Upstox OAuth chain if not.
//   • Pages:  no session → /login;  session but no Upstox cookie → /api/upstox/login
//   • API:    no session → 401 JSON  (handlers already degrade if Upstox is down)
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

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith("/api/");

  // 1) PIN session required everywhere.
  if (!session) {
    if (isApi) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // 2) Upstox is compulsory for page views — chain into OAuth if it's missing.
  //    API routes are left to degrade gracefully (they handle no/expired token).
  if (!isApi && !request.cookies.get(UPSTOX_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/api/upstox/login";
    url.search = `?next=${encodeURIComponent(safeNext(pathname + search))}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Run on everything except Next internals and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
