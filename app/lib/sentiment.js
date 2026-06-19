// ── Market Sentiment Engine ─────────────────────────────────────
// Real-time market mood detector combining live Upstox data + regime context
// Uses proven early-entry patterns for Upstox calls

import { getDailyCandles, getQuote } from "./upstox.js";
import { loadUniverse } from "./dataset.js";
import { marketRegime } from "./regime.js";

// ── Scoring functions ──────────────────────────────────────────

// Score index momentum: 5D MA vs 20D MA slope
async function scoreIndexTrend() {
  try {
    const candles = await getDailyCandles("NSE_EQ|NIFTYBEES", 60);
    if (!candles || candles.length < 20) {
      console.log("[sentiment] scoreIndexTrend: Fallback to regime");
      const universe = loadUniverse();
      const regime = marketRegime(universe);
      return regime.riskOn ? 70 : 30;
    }

    const last5 = candles.slice(-5).map(c => c.close);
    const last20 = candles.slice(-20).map(c => c.close);

    const ma5 = last5.reduce((a, b) => a + b) / 5;
    const ma20 = last20.reduce((a, b) => a + b) / 20;

    const latest = candles[candles.length - 1].close;
    const aboveMA5 = latest > ma5;
    const ma5AboveMA20 = ma5 > ma20;

    let score = 50;
    if (aboveMA5 && ma5AboveMA20) {
      const strength = (ma5 - ma20) / ma20;
      score = Math.min(80 + strength * 300, 100);
    } else if (!aboveMA5 && !ma5AboveMA20) {
      const strength = (ma20 - ma5) / ma20;
      score = Math.max(20 - strength * 300, 0);
    } else if (aboveMA5) {
      score = 65;
    } else {
      score = 35;
    }

    console.log(`[sentiment] priceAction: ${Math.round(score)}`);
    return Math.round(score);
  } catch (e) {
    console.error("[sentiment] scoreIndexTrend error:", e.message);
    try {
      const universe = loadUniverse();
      const regime = marketRegime(universe);
      return regime.riskOn ? 70 : 30;
    } catch {
      return 50;
    }
  }
}

// Score breadth using individual quotes (like early-entry does)
async function scoreBreadth() {
  try {
    const universe = loadUniverse();
    const symbols = universe.symbols || [];

    if (symbols.length === 0) return 50;

    console.log(`[sentiment] scoreBreadth: Fetching ${Math.min(50, symbols.length)} stocks...`);

    let upsCount = 0;
    let downsCount = 0;
    let successCount = 0;

    // Use Promise.allSettled to get quotes for top 50 stocks (won't fail on individual errors)
    const topSymbols = symbols.slice(0, 50);
    const results = await Promise.allSettled(
      topSymbols.map(sym => getQuote(`NSE_EQ|${sym}`))
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        successCount++;
        const change = result.value.changePct || 0;
        if (change > 0.1) upsCount++;
        else if (change < -0.1) downsCount++;
      }
    }

    const total = upsCount + downsCount;
    console.log(`[sentiment] breadth: Got ${successCount}/${topSymbols.length} quotes, ${upsCount}up ${downsCount}down`);

    if (total < 10) return 50;

    const breadthPct = (upsCount / total) * 100;
    const score = Math.max(0, Math.min(100, 50 + (breadthPct - 50)));

    console.log(`[sentiment] breadth: ${breadthPct.toFixed(1)}% up → ${Math.round(score)}`);
    return Math.round(score);
  } catch (e) {
    console.error("[sentiment] scoreBreadth error:", e.message);
    return 50;
  }
}

// Score bid-ask spreads (sample 20 stocks)
async function scoreBidAskSpreads() {
  try {
    const universe = loadUniverse();
    const symbols = universe.symbols.slice(0, 20) || [];

    if (symbols.length === 0) return 50;

    console.log(`[sentiment] scoreBidAskSpreads: Sampling ${symbols.length} stocks...`);

    const results = await Promise.allSettled(
      symbols.map(sym => getQuote(`NSE_EQ|${sym}`))
    );

    let totalSpread = 0;
    let countWithSpread = 0;

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        const quote = result.value;
        const bid = quote.bid || 0;
        const ask = quote.ask || 0;
        const ltp = quote.ltp || 0;

        if (bid && ask && ltp && ask > bid) {
          const spreadPct = ((ask - bid) / ltp) * 100;
          totalSpread += spreadPct;
          countWithSpread++;
        }
      }
    }

    if (countWithSpread === 0) {
      console.log("[sentiment] spreads: No data");
      return 50;
    }

    const avgSpread = totalSpread / countWithSpread;
    let score = 50;

    if (avgSpread < 0.2) {
      score = 90;
    } else if (avgSpread < 0.5) {
      score = 50 + ((0.5 - avgSpread) / 0.3) * 40;
    } else {
      score = Math.max(10, 50 - ((avgSpread - 0.5) * 100));
    }

    console.log(`[sentiment] spreads: avg ${avgSpread.toFixed(3)}% → ${Math.round(score)}`);
    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (e) {
    console.error("[sentiment] scoreBidAskSpreads error:", e.message);
    return 50;
  }
}

// Score volume (sample 20 stocks)
async function scoreVolume() {
  try {
    const universe = loadUniverse();
    const symbols = universe.symbols.slice(0, 20) || [];

    if (symbols.length === 0) return 50;

    console.log(`[sentiment] scoreVolume: Sampling ${symbols.length} stocks...`);

    const volRatios = [];
    const results = await Promise.allSettled(
      symbols.map(async (sym) => {
        try {
          const candles = await getDailyCandles(`NSE_EQ|${sym}`, 25);
          if (candles.length >= 20) {
            const todayVol = candles[candles.length - 1].volume;
            const last20Vols = candles.slice(-20).map((c) => c.volume);
            const avgVol = last20Vols.reduce((a, b) => a + b) / 20;
            if (avgVol > 0) return todayVol / avgVol;
          }
        } catch {
          return null;
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        volRatios.push(result.value);
      }
    }

    if (volRatios.length === 0) {
      console.log("[sentiment] volume: No data");
      return 50;
    }

    const avgVolRatio = volRatios.reduce((a, b) => a + b) / volRatios.length;
    let score = 50;

    if (avgVolRatio >= 1.3) {
      score = Math.min(100, 75 + (avgVolRatio - 1.3) * 200);
    } else if (avgVolRatio < 0.7) {
      score = Math.max(0, 25 - (0.7 - avgVolRatio) * 200);
    } else {
      score = 50 + (avgVolRatio - 1.0) * 100;
    }

    console.log(`[sentiment] volume: ${avgVolRatio.toFixed(2)}x → ${Math.round(score)}`);
    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (e) {
    console.error("[sentiment] scoreVolume error:", e.message);
    return 50;
  }
}

// Score volatility
async function scoreVolatility() {
  try {
    let candles = null;
    try {
      candles = await getDailyCandles("NSE_EQ|NIFTYBEES", 65);
    } catch {
      return 50;
    }

    if (!candles || candles.length < 20) return 50;

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

    let score = 50;
    if (volRatio > 1.3) {
      score = Math.max(0, 50 - (volRatio - 1.3) * 200);
    } else if (volRatio < 0.8) {
      score = Math.min(100, 50 + (0.8 - volRatio) * 200);
    }

    console.log(`[sentiment] volatility: ${volRatio.toFixed(2)}x → ${Math.round(score)}`);
    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (e) {
    console.error("[sentiment] scoreVolatility error:", e.message);
    return 50;
  }
}

// ── Reason generation ──────────────────────────────────────────

function generateReasonChips(factors) {
  const reasons = [];

  if (factors.priceAction > 75) reasons.push("📈 Strong uptrend");
  else if (factors.priceAction > 60) reasons.push("📈 Uptrend confirmed");
  else if (factors.priceAction < 25) reasons.push("📉 Strong downtrend");
  else if (factors.priceAction < 40) reasons.push("📉 Downtrend confirmed");

  if (factors.breadth > 70) reasons.push("📊 Broad participation");
  else if (factors.breadth < 30) reasons.push("⚠ Weak breadth");

  if (factors.volumeParticipation > 75) reasons.push("💪 Volume surge");
  else if (factors.volumeParticipation < 30) reasons.push("📉 Low volume");

  if (factors.bidAskSpread > 75) reasons.push("✓ Tight spreads");
  else if (factors.bidAskSpread < 35) reasons.push("⚠ Wide spreads");

  if (factors.volatilityRegime > 65) reasons.push("⚠ Elevated volatility");
  else if (factors.volatilityRegime < 35) reasons.push("😴 Low volatility");

  return reasons;
}

// ── Main calculation ──────────────────────────────────────────

export async function calculateSentiment() {
  const startTime = performance.now();

  try {
    console.log("[sentiment] Starting calculation...");

    // Parallel computation
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

    const liveFactors = Object.values(factors).filter(f => f !== 50).length;

    const bullishScore = Math.round(
      0.3 * priceAction +
        0.25 * breadth +
        0.15 * bidAskSpread +
        0.2 * volumeParticipation +
        0.1 * (100 - volatilityRegime)
    );

    const bearishScore = 100 - bullishScore;

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

    if (liveFactors < 3) {
      reasons.push(`📊 ${liveFactors}/5 live factors`);
    }

    console.log(`[sentiment] Result: ${sentiment} ${bullishScore} [${liveFactors}/5] in ${elapsedMs}ms`);

    return {
      bullishScore,
      bearishScore,
      sentiment,
      confidence,
      factors,
      reasons,
      lastUpdated: new Date(),
      computeTimeMs: elapsedMs,
      dataQuality: `${liveFactors}/5`,
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
      dataQuality: "0/5",
    };
  }
}
