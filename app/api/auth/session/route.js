import { NextResponse } from "next/server";
import { verifySession, sessionToken, upstoxTokenFor } from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Session probe. The native app calls this on launch to decide whether its
// stored token is still good before rendering anything — a 401 here means the
// 03:30 IST boundary has passed and it should drop the token and show the PIN.
//
// Middleware already rejects an invalid session, so reaching the handler means
// the token verified; we re-read it only to report whether Upstox is attached.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request) {
  const session = await verifySession(sessionToken(request));
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    upstox: Boolean(await upstoxTokenFor(request)),
    expiresAt: session.exp ? session.exp * 1000 : null,
  });
}
