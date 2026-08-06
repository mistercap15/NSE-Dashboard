// ─────────────────────────────────────────────────────────────────────────────
// App authentication — a lightweight personal gate.
// PIN → signed session cookie (jose JWT). No database. Edge-safe (jose runs in
// middleware); no node:crypto here so this can be imported from the Edge runtime.
//
// The session is deliberately tied to Upstox's daily token lifetime: Upstox
// access tokens expire at 03:30 IST, so the session is set to expire at the same
// boundary. After that the middleware bounces you to /login, which re-runs the
// PIN → Upstox OAuth chain. That's the "log in again when Upstox expires" flow.
//
// Two session shapes, same 03:30 IST expiry:
//   • web    — signed JWS in the `app_session` HttpOnly cookie (unchanged).
//   • mobile — encrypted JWE sent as `Authorization: Bearer`. The native app has
//     no cookie jar, so the Upstox access token rides along as an encrypted `ut`
//     claim instead of a second cookie. The app stores one opaque blob and
//     cannot read the Upstox token out of it (A256GCM under AUTH_SECRET).
// ─────────────────────────────────────────────────────────────────────────────
import { SignJWT, jwtVerify, EncryptJWT, jwtDecrypt } from "jose";

export const SESSION_COOKIE = "app_session";
export const UPSTOX_COOKIE = "upstox_token";

const secretKey = () =>
  new TextEncoder().encode(process.env.AUTH_SECRET || "dev-insecure-secret-change-me");

// A256GCM needs exactly 32 bytes; AUTH_SECRET is an arbitrary-length hex string,
// so hash it down. Web Crypto (not node:crypto) keeps this Edge-safe.
let _encKey = null;
async function encryptionKey() {
  if (!_encKey) {
    const digest = await crypto.subtle.digest("SHA-256", secretKey());
    _encKey = new Uint8Array(digest);
  }
  return _encKey;
}

// A JWE is 5 dot-separated parts, a JWS is 3 — enough to route a token to the
// right verifier without trial-decrypting.
const isEncrypted = (token) => typeof token === "string" && token.split(".").length === 5;

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

// Mobile session: same claims as the web one plus an encrypted Upstox access
// token. Minted at PIN login (without `ut`) and re-minted by the Upstox callback
// (with `ut`) once OAuth completes.
export async function createMobileSession(payload = {}, upstoxToken = null) {
  const exp = Math.floor(nextTokenExpiryMs() / 1000);
  const claims = upstoxToken ? { ...payload, ut: upstoxToken } : { ...payload };
  return new EncryptJWT(claims)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .encrypt(await encryptionKey());
}

// Accepts either session shape and returns the claims, or null if invalid/expired.
// Single-purpose tokens (see createLinkToken) are signed with the same key but
// are explicitly not sessions — reject them here so one can never be replayed as
// an `Authorization: Bearer` credential.
export async function verifySession(token) {
  if (!token) return null;
  try {
    let payload;
    if (isEncrypted(token)) {
      ({ payload } = await jwtDecrypt(token, await encryptionKey()));
    } else {
      ({ payload } = await jwtVerify(token, secretKey()));
    }
    return payload.purpose ? null : payload;
  } catch {
    return null;
  }
}

// ── Upstox OAuth link tokens ────────────────────────────────────────────────
// /api/upstox/login is a public path (the OAuth round-trip has to reach it
// unauthenticated), so the mobile callback can't mint a session just because
// OAuth succeeded — that would hand a full session to anyone who knows the URL,
// PIN and all. Instead the app trades its existing session for a short-lived,
// single-purpose token, which rides through Upstox as `state` and is what the
// callback checks before minting an Upstox-bearing session.
const LINK_TTL_SECONDS = 300;

export async function createLinkToken(returnUrl) {
  return new SignJWT({ sub: "owner", purpose: "upstox-link", ret: returnUrl || MOBILE_RETURN })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS)
    .sign(secretKey());
}

export async function verifyLinkToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload.purpose === "upstox-link" ? payload : null;
  } catch {
    return null;
  }
}

// The `Authorization: Bearer <token>` value, if present.
export function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const [scheme, value] = header.split(" ");
  if (!value || scheme.toLowerCase() !== "bearer") return null;
  return value.trim() || null;
}

// The session token for this request: Bearer header first (mobile), then the
// cookie (web). Lets every route serve both clients from one lookup.
export function sessionToken(request) {
  return bearerToken(request) || request.cookies.get(SESSION_COOKIE)?.value || null;
}

// The Upstox access token for this request, from whichever session shape is in
// play: the `upstox_token` cookie (web) or the encrypted `ut` claim (mobile).
// Returns null when Upstox isn't connected — callers already degrade on that.
export async function upstoxTokenFor(request) {
  const cookie = request.cookies.get(UPSTOX_COOKIE)?.value;
  if (cookie) return cookie;
  const bearer = bearerToken(request);
  if (!bearer || !isEncrypted(bearer)) return null;
  const claims = await verifySession(bearer);
  return claims?.ut || null;
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

// The native app's deep-link scheme (app.json `scheme`). The Upstox OAuth
// round-trip carries the return target through `state`, so the callback has to
// recognise a mobile return and hand back to the app instead of a web path.
export const MOBILE_SCHEME = "nserank://";

// Where the app is handed back after a successful Upstox connect.
export const MOBILE_RETURN = `${MOBILE_SCHEME}upstox/connected`;

// OAuth `state` marker for a mobile round-trip: "m:<linkToken>". The web sends a
// plain relative path instead, so the callback can tell the two apart.
export const MOBILE_STATE_PREFIX = "m:";

export const isMobileState = (state) =>
  typeof state === "string" && state.startsWith(MOBILE_STATE_PREFIX);

export const isMobileNext = (next) =>
  typeof next === "string" && next.startsWith(MOBILE_SCHEME);

// Which deep links the OAuth callback may hand control back to. The standalone
// app is `nserank://`, but Expo Go and dev clients serve the same app over
// `exp://<lan-ip>:8081/--/…`, so those have to be allowed too or the round-trip
// dead-ends during development.
//
// The app sends its own return URL, which is why this is validated here and
// then sealed inside the signed link token — the callback trusts only what it
// can verify, never a URL off the query string.
export function isAllowedAppReturn(url) {
  if (typeof url !== "string" || !url) return false;
  if (url.startsWith(MOBILE_SCHEME)) return true;
  return /^exp(\+[a-z0-9-]+)?:\/\//i.test(url);
}

// Redirect-target guard that also permits the app's own scheme. Kept separate
// from safeNext so web redirects stay strictly same-origin.
export function safeNextOrApp(next, fallback = "/") {
  return isMobileNext(next) ? next : safeNext(next, fallback);
}
