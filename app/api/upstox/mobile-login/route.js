import { NextResponse } from "next/server";
import { getLoginUrl } from "@/app/lib/upstox";
import {
  createLinkToken,
  isAllowedAppReturn,
  MOBILE_RETURN,
  MOBILE_STATE_PREFIX,
} from "@/app/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Hands the native app a ready-to-open Upstox authorization URL.
//
// The app can't set an Authorization header on a URL it opens in a browser, so
// it calls this endpoint first (authenticated, via middleware) and gets back a
// URL whose `state` already carries a 5-minute link token. The callback trusts
// that token — and only that token — when deciding to mint a mobile session.
//
// `return` lets a dev client pass its own exp:// deep link; it's validated here
// and then sealed inside the signed token so the callback never has to trust a
// URL it was handed at redirect time.
// ─────────────────────────────────────────────────────────────────────────────

// Takes no request input worth caching, and Next would otherwise prerender this
// at build time and serve one frozen (long-expired) link token forever.
export const dynamic = "force-dynamic";

export async function GET(request) {
  const requested = request.nextUrl.searchParams.get("return");
  const returnUrl = isAllowedAppReturn(requested) ? requested : MOBILE_RETURN;

  const link = await createLinkToken(returnUrl);
  return NextResponse.json({ url: getLoginUrl(`${MOBILE_STATE_PREFIX}${link}`) });
}
