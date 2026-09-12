"use client";
import { useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Market Mood — where the Nifty sits versus its own trailing high.
//
// READ-ONLY CONTEXT, AND THE PANEL SAYS SO OUT LOUD. Nothing here filters,
// re-sorts, re-sizes or hides a single pick; the rankings below are identical
// whether this reads Healthy or Correction. The footer states that in words
// because a coloured badge next to a list of trades looks like a verdict, and
// this is not one.
//
// It is the THIRD market-context reading on this page — breadth (RISK-ON) and
// sentiment (BULLISH) are the other two — and they measure different things, so
// they will sometimes disagree. Hence "Nifty price" in the heading: a reader who
// sees two labels pointing opposite ways should be able to tell why at a glance.
//
// The caveat is not optional decoration. The historical figures come from a
// 56-month sample split three ways; showing "+3.0%/mo" without "limited sample"
// would overstate what is actually known.
// ─────────────────────────────────────────────────────────────────────────────

// Fear is red and greed is green, the ordinary convention. NOTE that this is
// the emotion, not a verdict: for this system the sample says longs opened in
// "Extreme Greed" did BEST and ones opened in "Extreme Fear" did worst, so the
// green end is not a warning and the red end is not an invitation. The
// historical line under the badge carries that, which is why it is not
// optional.
const TONE = {
  "Extreme Greed": { chip: "bg-green/15 text-green", box: "border-green/25 bg-green/5", dot: "●" },
  Greed:           { chip: "bg-green/15 text-green", box: "border-green/20 bg-green/5", dot: "●" },
  Fear:            { chip: "bg-amber/15 text-amber", box: "border-amber/25 bg-amber/5", dot: "●" },
  "Extreme Fear":  { chip: "bg-red/15 text-red",     box: "border-red/25 bg-red/5",     dot: "●" },
  Unknown:         { chip: "bg-border text-soft",    box: "border-border bg-card/50",   dot: "○" },
};

const num = (n, d = 0) =>
  Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";

/** A moving-average pill. `null` means "not enough history", which is a
 *  different statement from "below" and must not be painted red. */
function MAPill({ label, above }) {
  const tone = above === null || above === undefined
    ? "border-border text-dim"
    : above ? "border-green/30 text-green" : "border-red/30 text-red";
  const word = above === null || above === undefined ? "n/a" : above ? "above" : "below";
  return (
    <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${tone}`}>
      {word} {label}
    </span>
  );
}

export default function MarketMoodPanel() {
  const [mood, setMood] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetch("/api/market-regime")
      .then((r) => r.json())
      .then((j) => { if (live) setMood(j); })
      // The route itself never throws, so this only catches the network being
      // gone. Either way the panel simply does not render — it must never take
      // the rankings down with it.
      .catch(() => { if (live) setMood(null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  if (loading || !mood) return null;

  const label = mood.regime_label || "Unknown";
  const tone  = TONE[label] || TONE.Unknown;
  const known = label !== "Unknown";

  return (
    <div className={`mb-5 rounded-lg border px-4 py-3 ${tone.box}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`font-mono text-[11px] font-semibold px-2 py-0.5 rounded shrink-0 ${tone.chip}`}>
          {tone.dot} {label.toUpperCase()}
        </span>

        <div className="min-w-0">
          <div className="font-mono text-[12px] font-semibold text-text">
            Market Mood · Nifty {known ? num(mood.nifty_price) : "—"}
          </div>
          <div className="font-mono text-[10px] text-dim">
            {known
              ? <>{num(mood.pct_off_high, 1)}% off its {mood.window_sessions}-session high of {num(mood.trailing_high)}</>
              : (mood.error || mood.reason || "Nifty data unavailable")}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:ml-auto shrink-0">
          <MAPill label="50 DMA"  above={mood.above_50dma} />
          <MAPill label="200 DMA" above={mood.above_200dma} />
        </div>
      </div>

      {known && mood.historical_context && (
        <div className="mt-2.5 pt-2.5 border-t border-border/50">
          <div className="font-mono text-[10.5px] text-soft">{mood.historical_context}</div>
          <div className="font-mono text-[9.5px] text-dim mt-1">{mood.caveat}</div>
        </div>
      )}

      <div className="font-mono text-[9.5px] text-dim mt-2">
        Nifty-price reading — context only. No pick below is filtered, re-sized or
        re-ordered by it{known && mood.source && mood.source !== "Nifty 50" ? ` · source: ${mood.source}` : ""}.
      </div>
    </div>
  );
}
