import { NextResponse } from "next/server";
import { calculateSentiment } from "../../lib/sentiment";

export async function GET(request) {
  try {
    const sentiment = await calculateSentiment();
    return NextResponse.json(sentiment, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
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
