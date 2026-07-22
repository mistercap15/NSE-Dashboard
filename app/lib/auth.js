// ─────────────────────────────────────────────────────────────────────────────
// App authentication — a lightweight personal gate.
// PIN → signed session cookie (jose JWT). No database. Edge-safe (jose runs in
// middleware); no node:crypto here so this can be imported from the Edge runtime.
//
// The session is deliberately tied to Upstox's daily token lifetime: Upstox
// access tokens expire at 03:30 IST, so the session is set to expire at the same
// boundary. After that the middleware bounces you to /login, which re-runs the
// PIN → Upstox OAuth chain. That's the "log in again when Upstox expires" flow.
// ─────────────────────────────────────────────────────────────────────────────
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "app_session";
export const UPSTOX_COOKIE = "upstox_token";

const secretKey = () =>
  new TextEncoder().encode(process.env.AUTH_SECRET || "dev-insecure-secret-change-me");

// Next 03:30 IST (Upstox daily token expiry) as epoch-ms. Session + Upstox cookie
// both expire here so they lapse together and force one clean re-auth per day.
export function nextTokenExpiryMs(now = Date.now()) {
  const IST = 5.5 * 3600000;
  const ist = new Date(now + IST);
  let expiry = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 3, 30) - IST;
  if (expiry <= now) expiry += 24 * 3600000;
  return expiry;
}

// Seconds until the next expiry boundary (for cookie maxAge).
export function sessionMaxAge(now = Date.now()) {
  return Math.max(60, Math.floor((nextTokenExpiryMs(now) - now) / 1000));
}

export async function createSession(payload = {}) {
  const exp = Math.floor(nextTokenExpiryMs() / 1000);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secretKey());
}

export async function verifySession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = (maxAge = sessionMaxAge()) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge,
});

// Constant-time string compare (pure JS — no node:crypto, Edge-safe).
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Only allow same-origin relative paths as post-login redirect targets.
export function safeNext(next, fallback = "/") {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
