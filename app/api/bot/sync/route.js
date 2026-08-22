import { NextResponse } from "next/server";
import { upstoxTokenFor, nextTokenExpiryMs } from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Push the trading account's Upstox token to the droplet that runs the bot.
//
// WHY PUSH AND NOT PULL. The obvious design is "store the token, let the droplet
// fetch it", which needs somewhere to keep a live broker credential (Vercel has
// no database) and a GET endpoint whose entire purpose is handing that
// credential out — one leaked secret from being drained by anyone. Pushing
// inverts it: the token exists on Vercel for the duration of one request and is
// at rest only on the machine that needs it. Nothing is stored here.
//
// THIS ROUTE FAILS CLOSED, which is the opposite of every other route in this
// app. Elsewhere a missing token means "show seasonality and carry on"; here it
// means "we are about to hand someone's broker credential to a server", so every
// uncertainty — network error, malformed response, non-200, wrong account —
// returns 403 and pushes nothing. There is no degraded mode.
//
// WHICH TOKEN. upstoxTokenFor(request) reads the caller's own OAuth cookie (or
// the mobile session's encrypted `ut` claim). It is deliberately NOT
// resolveAccessToken(): that prefers UPSTOX_ANALYTICS_TOKEN, which is read-only,
// belongs to a different concern, and cannot place an order. It is also not the
// `_accessToken` module global, which any concurrent request can overwrite — on
// a shared warm instance that could mean syncing the wrong person's token.
// ─────────────────────────────────────────────────────────────────────────────

const PROFILE_URL = "https://api.upstox.com/v2/user/profile";

/** The droplet is a small server on a home-grade link; don't hang a Vercel
 *  function on it. Long enough for a TLS handshake plus the profile check. */
const DROPLET_TIMEOUT_MS = 10000;
const PROFILE_TIMEOUT_MS = 8000;

/** Refuse rather than guess when the deployment is half-configured. */
function config() {
  return {
    accountId: process.env.BOT_ACCOUNT_ID || "",
    syncUrl: process.env.DROPLET_SYNC_URL || "",
    secret: process.env.BOT_SYNC_SECRET || "",
  };
}

const deny = (error, status = 403) =>
  NextResponse.json({ synced: false, error }, { status });

async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — is the droplet armed, and until when?
//
// The state both clients render from. "Am I logged in" is per-browser and
// per-device, so the web and the app will always disagree about it; whether the
// droplet holds a live token is one global fact, and it is the one that decides
// whether the bot can actually trade. Asking the droplet is what makes the two
// screens agree.
//
// Returns no credential — the receiver's /token-status reports presence and
// expiry only, and this passes that through unchanged.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  const { syncUrl, secret } = config();
  const unknown = (reason) =>
    NextResponse.json({ present: false, expiresAt: null, account: null, expired: false, reason });

  if (!syncUrl || !secret) return unknown("Sync is not configured on the server.");

  // The status URL sits beside the sync URL on the same receiver.
  const statusUrl = syncUrl.replace(/\/sync-token\/?$/, "/token-status");

  try {
    const res = await fetchWithTimeout(
      statusUrl,
      { headers: { "X-Sync-Secret": secret } },
      DROPLET_TIMEOUT_MS,
    );
    if (!res.ok) return unknown(`Droplet returned ${res.status}.`);
    const body = await res.json();
    return NextResponse.json({
      present: body.present === true,
      expiresAt: body.expiresAt ?? null,
      account: body.account ?? null,
      expired: body.expired === true,
      reason: null,
    });
  } catch (e) {
    // A droplet that can't be reached is reported as unknown rather than as
    // "no token" — the bot may well be running fine on a token this request
    // simply couldn't see, and a false "not synced" would prompt a needless
    // re-sync every morning.
    return unknown(`Could not reach the droplet: ${e.message}`);
  }
}

export async function POST(request) {
  const { accountId, syncUrl, secret } = config();

  // Misconfiguration is a refusal, not a default. Without the expected account
  // id there is no identity gate at all, and syncing to an unset URL with an
  // empty secret would be worse than doing nothing.
  if (!accountId || !syncUrl || !secret) {
    return deny(
      "Sync is not configured on the server (needs BOT_ACCOUNT_ID, DROPLET_SYNC_URL, BOT_SYNC_SECRET).",
      503,
    );
  }

  // ── 1. The caller's own OAuth token ───────────────────────────────────────
  const token = await upstoxTokenFor(request);
  if (!token) {
    return deny(
      "No Upstox login found. Connect Upstox as the trading account first — the analytics token can't place orders and is never synced.",
    );
  }

  // ── 2. Identity gate. Prove the token belongs to the trading account ──────
  // Deliberately a raw fetch rather than upstoxGet(): that helper resolves its
  // own credential and would ask Upstox who the ANALYTICS token belongs to,
  // which is a different account and would either wrongly pass or wrongly fail.
  let userId = null;
  try {
    const res = await fetchWithTimeout(
      PROFILE_URL,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
      PROFILE_TIMEOUT_MS,
    );
    if (!res.ok) {
      // 403 UDAPI1154 here would mean Upstox has started applying static-IP
      // rules to account reads, so Vercel can no longer identify the token.
      // Still a refusal: unverified is unverified.
      return deny(`Could not verify the account (Upstox returned ${res.status}). Nothing was synced.`);
    }
    const body = await res.json();
    userId = body?.data?.user_id ?? null;
  } catch (e) {
    return deny(`Could not reach Upstox to verify the account: ${e.message}. Nothing was synced.`);
  }

  if (!userId) return deny("Upstox did not return a user id. Nothing was synced.");
  if (userId !== accountId) {
    // Names the account that WAS found so a wrong-login is obvious, without
    // revealing anything the caller doesn't already own.
    return deny(
      `This token belongs to account ${userId}, not the trading account. Log in as the trading account and try again.`,
    );
  }

  // ── 3. Push ───────────────────────────────────────────────────────────────
  // Upstox tokens die at 03:30 IST regardless of when they were issued, so the
  // droplet is told when this one stops being usable rather than having to
  // re-derive it.
  const expiresAt = nextTokenExpiryMs();

  try {
    const res = await fetchWithTimeout(
      syncUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Secret": secret,
        },
        body: JSON.stringify({ token, expiresAt, account: userId }),
      },
      DROPLET_TIMEOUT_MS,
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return deny(`Droplet rejected the sync (${res.status}). ${detail.slice(0, 160)}`, 502);
    }
  } catch (e) {
    return deny(`Could not reach the droplet: ${e.message}`, 502);
  }

  // The token is never echoed back. The caller already has it in their cookie;
  // putting it in a response body would put it in browser devtools, any logging
  // proxy, and the Vercel function log.
  return NextResponse.json({
    synced: true,
    account: userId,
    expiresAt,
    expiresAtIso: new Date(expiresAt).toISOString(),
  });
}
