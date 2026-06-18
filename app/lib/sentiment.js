// ── Market Sentiment Engine ─────────────────────────────────────
// Real-time market mood detector: bullish/bearish/neutral scoring
// Combines price action, breadth, spreads, volume, volatility
// Used to gate seasonal trades: boost conviction when sentiment aligns,
// reduce when it contradicts

import { getDailyCandles, getBatchQuotes } from "./upstox.js";
import { loadUniverse } from "./dataset.js";

// ── Scoring functions ──────────────────────────────────────────

// Score index momentum: 5D MA vs 20D MA slope
async function scoreIndexTrend() {
  try {
    // Fetch 60 days of Nifty 50 candles
    const candles = await getDailyCandles("NSE_EQ|NIFTYBEESDIRECT", 60);
    if (candles.length < 20) return 50; // Insufficient data, neutral

    // Calculate 5-day and 20-day moving averages
    const last5 = candles.slice(-5).map(c => c.close);
    const last20 = candles.slice(-20).map(c => c.close);

    const ma5 = last5.reduce((a, b) => a + b) / 5;
    const ma20 = last20.reduce((a, b) => a + b) / 20;

    // Position: is price above/below MA?
    const latest = candles[candles.length - 1].close;
    const aboveMA5 = latest > ma5;

    // Slope: is MA5 above MA20? (uptrend indicator)
    const ma5AboveMA20 = ma5 > ma20;

    // Score: max 100 if both conditions met, scale down otherwise
    let score = 50;
    if (aboveMA5 && ma5AboveMA20) {
      // Strong uptrend
      const strength = (ma5 - ma20) / ma20; // % difference
      score = Math.min(85 + strength * 200, 100);
    } else if (!aboveMA5 && !ma5AboveMA20) {
      // Strong downtrend
      const strength = (ma20 - ma5) / ma20;
      score = Math.max(15 - strength * 200, 0);
    } else if (aboveMA5) {
      score = 65; // Above MA but weak
    } else {
      score = 35; // Below MA but weak
    }

    return Math.round(score);
  } catch (e) {
    console.error("scoreIndexTrend error:", e.message);
    return 50; // Default neutral on error
  }
}

// Score breadth: % of stocks up vs down
async function scoreBreadth() {
  try {
    const universe = loadUniverse();
    const symbols = universe.symbols || [];

    if (symbols.length === 0) return 50;

    // Batch fetch quotes for all symbols
    const instrumentKeys = symbols.map((sym) => `NSE_EQ|${sym}`);
    const quotes = await getBatchQuotes(instrumentKeys);

    let upsCount = 0;
    let downsCount = 0;

    for (const [key, quote] of Object.entries(quotes)) {
      if (!quote) continue;
      const change = quote.net_change_percentage || 0;
      if (change > 0) upsCount++;
      else if (change < 0) downsCount++;
    }

    const total = upsCount + downsCount;
    if (total === 0) return 50;

    // Convert breadth to score (>60% ups = bullish)
    const breadthPct = (upsCount / total) * 100;
    // Score: 60% ups → 70, 80% ups → 90, 40% ups → 30
    const score = breadthPct > 50 ? 50 + (breadthPct - 50) : 50 - (50 - breadthPct);

    return Math.round(score);
  } catch (e) {
    console.error("scoreBreadth error:", e.message);
    return 50;
  }
}

// Score bid-ask spreads: tightness indicates market conviction
async function scoreBidAskSpreads() {
  try {
    const universe = loadUniverse();
    const symbols = universe.symbols || [];

    if (symbols.length === 0) return 50;

    // Batch fetch quotes (which include bid/ask if available)
    const instrumentKeys = symbols.map((sym) => `NSE_EQ|${sym}`);
    const quotes = await getBatchQuotes(instrumentKeys);

    let totalSpread = 0;
    let countWithSpread = 0;

    for (const [key, quote] of Object.entries(quotes)) {
      if (!quote) continue;
      const bid = quote.bid;
      const ask = quote.ask;
      const ltp = quote.last_price;

      if (bid && ask && ltp) {
        const spreadPct = ((ask - bid) / ltp) * 100;
        totalSpread += spreadPct;
        countWithSpread++;
      }
    }

    if (countWithSpread === 0) return 50; // No spread data, neutral

    const avgSpread = totalSpread / countWithSpread;

    // Tight spread (<0.3%) = high conviction = 80-100
    // Wide spread (>0.7%) = low conviction = 0-30
    // Map: <0.3% → 90, 0.5% → 50, >0.7% → 10
    let score = 50;
    if (avgSpread < 0.3) {
      score = 85 + (0.3 - avgSpread) * 500; // Up to 90+
    } else if (avgSpread > 0.7) {
      score = 30 - (avgSpread - 0.7) * 100; // Down to 10
    } else {
      // Linear interpolation between 0.3 and 0.7
      score = 85 - ((avgSpread - 0.3) / 0.4) * 70;
    }

    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (e) {
    console.error("scoreBidAskSpreads error:", e.message);
    return 50;
  }
}

// Score volume participation: today's vol vs 20-day average
async function scoreVolume() {
  try {
    const universe = loadUniverse();
    const symbols = universe.symbols || [];

    if (symbols.length === 0) return 50;

    const instrumentKeys = symbols.map((sym) => `NSE_EQ|${sym}`);

    // Fetch candles for volume comparison
    const volRatios = [];
    for (const key of instrumentKeys) {
      try {
        const candles = await getDailyCandles(key, 25);
        if (candles.length >= 20) {
          const todayVol = candles[candles.length - 1].volume;
          const last20Vols = candles.slice(-20).map((c) => c.volume);
          const avgVol = last20Vols.reduce((a, b) => a + b) / 20;

          if (avgVol > 0) {
            volRatios.push(todayVol / avgVol);
          }
        }
      } catch {
        // Skip symbols with errors
      }
    }

    if (volRatios.length === 0) return 50;

    const avgVolRatio = volRatios.reduce((a, b) => a + b) / volRatios.length;

    // vol_ratio 1.2+ = surging = 70-100
    // vol_ratio 1.0 = normal = 50
    // vol_ratio 0.8 = declining = 20-40
    let score = 50;
    if (avgVolRatio >= 1.2) {
      score = 70 + (avgVolRatio - 1.2) * 200; // Up to 90-100
    } else if (avgVolRatio < 0.8) {
      score = 30 - (0.8 - avgVolRatio) * 200; // Down to 10-20
    } else {
      // Linear interpolation
      score = 50 + (avgVolRatio - 1.0) * 100;
    }

    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (e) {
    console.error("scoreVolume error:", e.message);
    return 50;
  }
}

// Score volatility regime: elevated vol = fear, low vol = greed
async function scoreVolatility() {
  try {
    // Use Nifty 50 for volatility baseline
    const candles = await getDailyCandles("NSE_EQ|NIFTYBEESDIRECT", 65);
    if (candles.length < 20) return 50;

    // Calculate 20-day ATR (Average True Range) as volatility proxy
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

    // vol_ratio: current 20-day ATR vs 60-day baseline
    const volRatio = atr20 / atr60;

    // Elevated vol (>1.2x) = fear = lower bullish score
    // Low vol (<0.9x) = greed = lower bearish score (inverted in main function)
    let score = 50;
    if (volRatio > 1.2) {
      // Elevated volatility (fear)
      score = 50 - (volRatio - 1.2) * 200; // Down to 20-30
    } else if (volRatio < 0.9) {
      // Low volatility (complacency)
      score = 50 + (0.9 - volRatio) * 200; // Up to 70-80
    } else {
      // Normal volatility
      score = 50 - (volRatio - 1.0) * 100;
    }

    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (e) {
    console.error("scoreVolatility error:", e.message);
    return 50;
  }
}

// ── Reason generation ──────────────────────────────────────────

function generateReasonChips(factors) {
  const reasons = [];

  if (factors.priceAction > 75) reasons.push("📈 Strong uptrend momentum");
  else if (factors.priceAction > 60)
    reasons.push("📈 Uptrend confirmed");
  else if (factors.priceAction < 25)
    reasons.push("📉 Strong downtrend momentum");
  else if (factors.priceAction < 40)
    reasons.push("📉 Downtrend confirmed");

  if (factors.breadth > 70)
    reasons.push("📊 Broad-based participation (>70% up)");
  else if (factors.breadth < 30)
    reasons.push("⚠ Weak breadth (<30% up)");

  if (factors.volumeParticipation > 75)
    reasons.push("💪 Volume surging above avg");
  else if (factors.volumeParticipation < 30)
    reasons.push("⚠ Volume declining");

  if (factors.bidAskSpread > 75)
    reasons.push("✓ Tight spreads (confidence)");
  else if (factors.bidAskSpread < 35)
    reasons.push("⚠ Wide spreads (uncertainty)");

  if (factors.volatilityRegime > 70)
    reasons.push("⚠ Elevated volatility (fear)");
  else if (factors.volatilityRegime < 35)
    reasons.push("😴 Very low volatility (complacency)");

  return reasons;
}

// ── Main sentiment calculation ─────────────────────────────────

export async function calculateSentiment() {
  const startTime = performance.now();

  try {
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

    // Weighted average (tuned weights)
    const bullishScore = Math.round(
      0.3 * priceAction +
        0.25 * breadth +
        0.15 * bidAskSpread +
        0.2 * volumeParticipation +
        0.1 * (100 - volatilityRegime) // Invert: low vol = more bullish
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
    console.error("calculateSentiment error:", e.message);
    // Return safe neutral on error
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
      reasons: ["⚠ Error computing sentiment, defaulting to neutral"],
      lastUpdated: new Date(),
      error: e.message,
    };
  }
}
