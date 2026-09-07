import { NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// What the bots on the droplet actually believe.
//
//   GET /api/bot/status
//
// The signal routes say what the STRATEGY thinks. This says what the BOTS
// think — holding or flat, armed, paused, halted, which one owns the contract.
// The two can disagree, and on 7 Sep 2026 they did: the signals were perfectly
// normal while the hourly bot had adopted the 5-min bot's position and both
// were bracketing the same lots. No screen could have shown that, because the
// fault was in what the bots believed. This is the fix for that blind spot.
//
// A THIN PROXY, AND NOTHING MORE. The droplet's bot_status.py does the reading
// and is physically incapable of writing (its systemd unit grants no writable
// path at all). This route exists for one reason: BOT_SYNC_SECRET must not
// reach the browser, so the call is made server-side.
//
// FAILS OPEN, ALWAYS 200. A droplet that is unreachable — rebooting, DNS,
// Caddy renewing a certificate — must not take the dashboard down with it. The
// payload always has the same shape and carries `reachable` plus a reason, so
// the pages render "cannot reach the bots" rather than an error boundary.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

/** Derived from DROPLET_SYNC_URL's origin rather than needing its own variable —
 *  the two endpoints are served by the same Caddy site. An explicit override is
 *  honoured if the deployment ever splits them. */
function statusUrl() {
  const explicit = (process.env.DROPLET_STATUS_URL || "").trim();
  if (explicit) return explicit;
  const sync = (process.env.DROPLET_SYNC_URL || "").trim();
  if (!sync) return null;
  try {
    return new URL("/bot-status", sync).toString();
  } catch {
    return null;
  }
}

export async function GET() {
  const base = { reachable: false, at: null, bots: null, claim: null, error: null };

  const url = statusUrl();
  const secret = process.env.BOT_SYNC_SECRET || "";
  if (!url || !secret) {
    return NextResponse.json({
      ...base,
      error: "Bot status is not configured on the server (needs DROPLET_SYNC_URL and BOT_SYNC_SECRET).",
    });
  }

  try {
    // Short timeout on purpose: this is polled from a page, and a droplet that
    // is slow to answer should show as unreachable quickly rather than holding
    // the request open and stalling the screen.
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(url, {
      headers: { "X-Sync-Secret": secret, Accept: "application/json" },
      cache: "no-store",
      signal: ctl.signal,
    });
    clearTimeout(t);

    if (!res.ok) {
      return NextResponse.json({
        ...base,
        error: res.status === 403
          ? "The droplet refused the shared secret — BOT_SYNC_SECRET does not match."
          : `The droplet answered ${res.status}.`,
      });
    }

    const data = await res.json();
    return NextResponse.json({ ...base, ...data, reachable: true });
  } catch (e) {
    const aborted = e?.name === "AbortError";
    return NextResponse.json({
      ...base,
      error: aborted
        ? "The droplet did not answer within 8 seconds."
        : `Could not reach the droplet: ${e?.message || "unknown error"}`,
    });
  }
}
