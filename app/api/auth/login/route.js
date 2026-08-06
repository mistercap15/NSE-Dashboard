import { NextResponse } from "next/server";
import {
  createSession,
  createMobileSession,
  sessionCookieOptions,
  safeEqual,
  safeNext,
  SESSION_COOKIE,
} from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// PIN login. Verifies a 6-digit PIN (plaintext APP_PIN env), sets the signed
// session cookie, and returns the post-login redirect target. Middleware then
// chains into Upstox OAuth if it isn't connected yet.
//
// The native app can't use cookies, so the response body also carries an
// encrypted session token for it to hold. The web ignores `token` and rides the
// cookie exactly as before.
//
// Brute-force guard: a 6-digit PIN is only 1e6 combos on a public URL, so we
// throttle per-IP — a fixed delay on every failure plus an escalating lockout.
// In-memory (per serverless instance → best-effort on Vercel), but enough to
// make online guessing impractical.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;        // failures before a lockout kicks in
const BASE_LOCK_MS = 30_000;   // first lockout; escalates ×strike
const FAIL_DELAY_MS = 400;     // constant delay on every wrong attempt

const attempts = new Map(); // ip -> { count, strikes, lockUntil }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clientIp = (req) =>
  (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
  req.headers.get("x-real-ip") ||
  "unknown";

export async function POST(request) {
  const ip = clientIp(request);
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, strikes: 0, lockUntil: 0 };

  if (rec.lockUntil > now) {
    const retryAfter = Math.ceil((rec.lockUntil - now) / 1000);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${retryAfter}s.`, retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let pin, next;
  try {
    const body = await request.json();
    pin = String(body.pin ?? "");
    next = body.next;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const expected = process.env.APP_PIN || "";
  if (!expected) {
    return NextResponse.json({ error: "Server not configured (APP_PIN missing)" }, { status: 500 });
  }

  if (safeEqual(pin, expected)) {
    attempts.delete(ip); // reset on success
    const token = await createSession({ sub: "owner" });
    // Bearer session for the native app — no Upstox token yet, the OAuth
    // callback re-mints this with one attached.
    const bearer = await createMobileSession({ sub: "owner" });
    const res = NextResponse.json({ ok: true, next: safeNext(next), token: bearer });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  }

  // Wrong PIN — record, maybe lock, always delay.
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.strikes += 1;
    rec.lockUntil = now + BASE_LOCK_MS * rec.strikes;
    rec.count = 0;
  }
  attempts.set(ip, rec);
  await sleep(FAIL_DELAY_MS);

  if (rec.lockUntil > Date.now()) {
    const retryAfter = Math.ceil((rec.lockUntil - Date.now()) / 1000);
    return NextResponse.json(
      { error: `Too many attempts. Locked for ${retryAfter}s.`, retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  return NextResponse.json(
    { error: "Incorrect PIN", remaining: MAX_ATTEMPTS - rec.count },
    { status: 401 }
  );
}
