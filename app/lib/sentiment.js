// ── Market Sentiment Engine ─────────────────────────────────────
// Real-time market mood detector combining live Upstox data + regime context
// Scores: price action, breadth, bid-ask spreads, volume, volatility
// Falls back to regime snapshot if live data unavailable

import { getDailyCandles, getBatchQuotes } from "./upstox.js";
import { loadUniverse } from "./dataset.js";
import { marketRegime } from "./regime.js";

// ── Scoring functions ──────────────────────────────────────────

// Score index momentum: 5D MA vs 20D MA slope on daily candles
async function scoreIndexTrend() {
  try {
    // Try multiple Nifty symbols in order of likelihood
    const symbols = [
      "NSE_EQ|NIFTYBEES",      // Nifty BeES ETF (most reliable)
      "NSE_EQ|NIFTYBEESDIRECT", // Alternative
    ];

    let candles = null;
    for (const sym of symbols) {
      try {
        candles = await getDailyCandles(sym, 60);
        if (candles?.length >= 20) break;
      } catch {
        continue;
      }
    }

    if (!candles || candles.length < 20) {
      // Fallback to regime data from snapshot
      const universe = loadUniverse();
      const regime = marketRegime(universe);
      return regime.riskOn ? 70 : 30; // Use regime as fallback
    }

    // Calculate 5-day and 20-day moving averages
    const last5 = candles.slice(-5).map(c => c.close);
    const last20 = candles.slice(-20).map(c => c.close);

    const ma5 = last5.reduce((a, b) => a + b) / 5;
    const ma20 = last20.reduce((a, b) => a + b) / 20;

    const latest = candles[candles.length - 1].close;
    const aboveMA5 = latest > ma5;
    const ma5AboveMA20 = ma5 > ma20;

    // Score based on dual confirmation
    let score = 50;
    if (aboveMA5 && ma5AboveMA20) {
      const strength = (ma5 - ma20) / ma20;
      score = Math.min(80 + strength * 300, 100); // Strong uptrend
    } else if (!aboveMA5 && !ma5AboveMA20) {
      const strength = (ma20 - ma5) / ma20;
      score = Math.max(20 - strength * 300, 0); // Strong downtrend
    } else if (aboveMA5) {
      score = 65; // Above MA but weak
    } else {
      score = 35; // Below MA but weak
    }

    return Math.round(score);
  } catch (e) {
    console.error("[sentiment] scoreIndexTrend:", e.message);
    // Fallback to regime
    try {
      const universe = loadUniverse();
      const regime = marketRegime(universe);
      return regime.riskOn ? 70 : 30;
    } catch {
      return 50;
    }
  }
}

// Score breadth: % of stocks up vs down (TODAY'S moves)
async function scoreBreadth() {
  try {
    const universe = loadUniverse();
    const symbols = universe.symbols || [];

    if (symbols.length === 0) return 50;

    // Fetch live quotes for all symbols
    const instrumentKeys = symbols.map((sym) => `NSE_EQ|${sym}`);
    const quotes = await getBatchQuotes(instrumentKeys);

    let upsCount = 0;
    let downsCount = 0;

    for (const [key, quote] of Object.entries(quotes)) {
      if (!quote) continue;
      const change = quote.net_change_percentage || 0;
      if (change > 0.1) upsCount++; // +0.1% threshold to ignore noise
      else if (change < -0.1) downsCount++;
    }

    const total = upsCount + downsCount;
    if (total < 10) return 50; // Not enough data

    const breadthPct = (upsCount / total) * 100;
    // >70% ups = bullish (85-100), <30% ups = bearish (0-15)
    const score = Math.max(0, Math.min(100, 50 + (breadthPct - 50)));

    console.log(`[sentiment] breadth: ${upsCount}/${total} up = ${breadthPct.toFixed(1)}% → ${Math.round(score)}`);
    return Math.round(score);
  } catch (e) {
    console.error("[sentiment] scoreBreadth:", e.message);
    return 50;
  }
}

// Score bid-ask spreads: tightness indicates conviction
async function scoreBidAskSpreads() {
  try {
    const universe = loadUniverse();
    const symbols = universe.symbols.slice(0, 50) || []; // Sample first 50

    if (symbols.length === 0) return 50;

    const instrumentKeys = symbols.map((sym) => `NSE_EQ|${sym}`);
    const quotes = await getBatchQuotes(instrumentKeys);

    let totalSpread = 0;
    let countWithSpread = 0;

    for (const [key, quote] of Object.entries(quotes)) {
      if (!quote) continue;
      const bid = quote.bid;
      const ask = quote.ask;
      const ltp = quote.last_price;

      // Only count if all fields present
      if (bid && ask && ltp && ask > bid) {
        const spreadPct = ((ask - bid) / ltp) * 100;
        totalSpread += spreadPct;
        countWithSpread++;
      }
    }

    if (countWithSpread === 0) {
      console.log("[sentiment] No bid-ask data available");
      return 50;
    }

    const avgSpread = totalSpread / countWithSpread;

    // Tight spread (<0.2%) = high conviction = 80-100
    // Wide spread (>0.5%) = low conviction = 0-30
    let score = 50;
    if (avgSpread < 0.2) {
      score = 90;
    } else if (avgSpread < 0.5) {
      score = 50 + ((0.5 - avgSpread) / 0.3) * 40;
    } else {
      score = Math.max(10, 50 - ((avgSpread - 0.5) * 100));
    }

    console.log(
      `[sentiment] bid-ask spread: avg ${avgSpread.toFixed(3)}% (${countWithSpread} stocks) → ${Math.round(score)}`
    );
    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (e) {
    console.error("[sentiment] scoreBidAskSpreads:", e.message);
    return 50;
  }
}

// Score volume participation: today's vol vs 20-day average
async function scoreVolume() {
  try {
    const universe = loadUniverse();
    const symbols = universe.symbols.slice(0, 30) || []; // Sample first 30

    if (symbols.length === 0) return 50;

    const volRatios = [];

    // Fetch candles in parallel batches (avoid rate limit)
    for (let i = 0; i < symbols.length; i += 10) {
      const batch = symbols.slice(i, i + 10);
      const results = await Promise.all(
        batch.map(async (sym) => {
          try {
            const candles = await getDailyCandles(`NSE_EQ|${sym}`, 25);
            if (candles.length >= 20) {
              const todayVol = candles[candles.length - 1].volume;
              const last20Vols = candles.slice(-20).map((c) => c.volume);
              const avgVol = last20Vols.reduce((a, b) => a + b) / 20;
              if (avgVol > 0) {
                return todayVol / avgVol;
              }
            }
          } catch {
            // Skip on error
          }
          return null;
        })
      );
      volRatios.push(...results.filter((r) => r !== null));
    }

    if (volRatios.length === 0) {
      console.log("[sentiment] No volume data available");
      return 50;
    }

    const avgVolRatio = volRatios.reduce((a, b) => a + b) / volRatios.length;

    // vol_ratio 1.3+ = surging = 80-100
    // vol_ratio 1.0 = normal = 50
    // vol_ratio 0.7 = declining = 10-30
    let score = 50;
    if (avgVolRatio >= 1.3) {
      score = Math.min(100, 75 + (avgVolRatio - 1.3) * 200);
    } else if (avgVolRatio < 0.7) {
      score = Math.max(0, 25 - (0.7 - avgVolRatio) * 200);
    } else {
      score = 50 + (avgVolRatio - 1.0) * 100;
    }

    console.log(`[sentiment] volume: avg ratio ${avgVolRatio.toFixed(2)}x (${volRatios.length} stocks) → ${Math.round(score)}`);
    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (e) {
    console.error("[sentiment] scoreVolume:", e.message);
    return 50;
  }
}

// Score volatility regime: elevated vol = fear, low vol = greed
async function scoreVolatility() {
  try {
    // Use Nifty BeES or fallback to regime
    let candles = null;
    try {
      candles = await getDailyCandles("NSE_EQ|NIFTYBEES", 65);
    } catch {
      candles = null;
    }

    if (!candles || candles.length < 20) {
      console.log("[sentiment] Using regime data for volatility");
      return 50; // Neutral if no candles
    }

    // Calculate ATR (Average True Range) as volatility proxy
    const calculateATR = (candles) => {
      const trs = [];
      for (let i = 1; i < candles.length; i++) {
        const curr = candles[i];
        const prev = candles[i - 1];
        const tr = Math.max(
          curr.high - curr.low,
          Math.abs(curr.high - prev.close),
          Math.abs(curr.low - prev.close)
        );
        trs.push(tr);
      }
      return trs.reduce((a, b) => a + b) / trs.length;
    };

    const last20 = candles.slice(-20);
    const last60 = candles;

    const atr20 = calculateATR(last20);
    const atr60 = calculateATR(last60);

    const volRatio = atr20 / atr60;

    // Elevated vol (>1.3x baseline) = fear
    // Low vol (<0.8x) = complacency
    let score = 50;
    if (volRatio > 1.3) {
      score = Math.max(0, 50 - (volRatio - 1.3) * 200);
    } else if (volRatio < 0.8) {
      score = Math.min(100, 50 + (0.8 - volRatio) * 200);
    }

    console.log(`[sentiment] volatility: ratio ${volRatio.toFixed(2)}x → ${Math.round(score)}`);
    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (e) {
    console.error("[sentiment] scoreVolatility:", e.message);
    return 50;
  }
}

// ── Reason generation ──────────────────────────────────────────

function generateReasonChips(factors) {
  const reasons = [];

  if (factors.priceAction > 75) reasons.push("📈 Strong uptrend momentum");
  else if (factors.priceAction > 60) reasons.push("📈 Uptrend confirmed");
  else if (factors.priceAction < 25) reasons.push("📉 Strong downtrend momentum");
  else if (factors.priceAction < 40) reasons.push("📉 Downtrend confirmed");

  if (factors.breadth > 70) reasons.push("📊 Broad participation (>70% up)");
  else if (factors.breadth < 30) reasons.push("⚠ Weak breadth (<30% up)");

  if (factors.volumeParticipation > 75) reasons.push("💪 Volume surge");
  else if (factors.volumeParticipation < 30) reasons.push("📉 Declining volume");

  if (factors.bidAskSpread > 75) reasons.push("✓ Tight spreads (confidence)");
  else if (factors.bidAskSpread < 35) reasons.push("⚠ Wide spreads (uncertainty)");

  if (factors.volatilityRegime > 65) reasons.push("⚠ Elevated volatility (fear)");
  else if (factors.volatilityRegime < 35) reasons.push("😴 Low volatility (complacency)");

  return reasons;
}

// ── Main sentiment calculation ─────────────────────────────────

export async function calculateSentiment() {
  const startTime = performance.now();

  try {
    console.log("[sentiment] Computing market sentiment...");

    // Score all factors in parallel
    const [priceAction, breadth, bidAskSpread, volumeParticipation, volatilityRegime] =
      await Promise.all([
        scoreIndexTrend(),
        scoreBreadth(),
        scoreBidAskSpreads(),
        scoreVolume(),
        scoreVolatility(),
      ]);

    const factors = {
      priceAction,
      breadth,
      bidAskSpread,
      volumeParticipation,
      volatilityRegime,
    };

    // Weighted average
    const bullishScore = Math.round(
      0.3 * priceAction +
        0.25 * breadth +
        0.15 * bidAskSpread +
        0.2 * volumeParticipation +
        0.1 * (100 - volatilityRegime)
    );

    const bearishScore = 100 - bullishScore;

    // Determine mood and confidence
    let sentiment = "NEUTRAL";
    let confidence = "Medium";

    if (bullishScore > 65) {
      sentiment = "BULLISH";
      confidence = bullishScore > 80 ? "High" : "Medium";
    } else if (bearishScore > 65) {
      sentiment = "BEARISH";
      confidence = bearishScore > 80 ? "High" : "Medium";
    }

    const reasons = generateReasonChips(factors);
    const elapsedMs = Math.round(performance.now() - startTime);

    console.log(`[sentiment] Result: ${sentiment} (${bullishScore}/${bearishScore}) ${confidence} confidence in ${elapsedMs}ms`);

    return {
      bullishScore,
      bearishScore,
      sentiment,
      confidence,
      factors,
      reasons,
      lastUpdated: new Date(),
      computeTimeMs: elapsedMs,
    };
  } catch (e) {
    console.error("[sentiment] Fatal error:", e.message);
    return {
      bullishScore: 50,
      bearishScore: 50,
      sentiment: "NEUTRAL",
      confidence: "Low",
      factors: {
        priceAction: 50,
        breadth: 50,
        bidAskSpread: 50,
        volumeParticipation: 50,
        volatilityRegime: 50,
      },
      reasons: ["⚠ Error computing sentiment"],
      lastUpdated: new Date(),
      error: e.message,
    };
  }
}
