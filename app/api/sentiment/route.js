import { NextResponse } from "next/server";
import { calculateSentiment } from "../../lib/sentiment";
import { setAccessToken } from "../../lib/upstox";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    // Extract Upstox token from cookies or headers (exact same pattern as early-entry)
    const cookie = request.cookies.get("upstox_token")?.value;
    const headerToken = request.headers.get("x-upstox-token");
    const token = cookie || headerToken;

    console.log("[sentiment-api] Token present:", !!token);

    if (token) {
      setAccessToken(token);
    }

    const sentiment = await calculateSentiment();

    // If we don't have a token, don't cache (so it picks up token when user authenticates)
    // If we do have a token, cache for 1 minute since Upstox data updates intraday
    const hasToken = !!token;
    const cacheHeader = hasToken
      ? "public, s-maxage=60, stale-while-revalidate=120"
      : "no-cache, no-store, must-revalidate"; // Don't cache when not authenticated

    return NextResponse.json(sentiment, {
      headers: {
        "Cache-Control": cacheHeader,
      },
    });
  } catch (e) {
    console.error("Sentiment API error:", e.message);
    return NextResponse.json(
      {
        error: e.message,
        sentiment: "NEUTRAL",
        bullishScore: 50,
        bearishScore: 50,
        confidence: "Low",
      },
      { status: 500 }
    );
  }
}
