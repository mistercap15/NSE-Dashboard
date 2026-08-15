// ─────────────────────────────────────────────────────────────────────────────
// Qualifiers — the disqualifying facts a conviction score can't see.
//
// Named `qualify` rather than `gates` because conviction.js already exports a
// GATES const for its numeric thresholds; these are a different thing.
//
// WHY THIS IS SEPARATE FROM THE SCORING. Three ideas were investigated as
// sources of alpha — corporate news, promoter actions, and traded volume — and
// all three landed in the same place: none reliably predicts returns, and each
// reliably identifies trades to avoid or to take with your eyes open. Volume
// was measured directly against 26 years of our own candles: at the lows,
// "accumulation on heavy volume" earned −0.09% excess in 2019-2026 (t = −0.16),
// worse than buying near-lows with no volume filter at all. So none of this
// becomes a conviction component. It becomes a veto.
//
// Two rules hold for every qualifier here:
//
//   1. FAIL OPEN. Missing data must never reject a trade. A symbol absent from
//      the snapshot is unknown, not guilty — and NSE's insider archive has real
//      gaps, so this case is common rather than theoretical.
//   2. PURE. Each takes the candidate plus a context bundle and returns
//      null | { level, code, message }. No fetching, no dates from the clock.
//      That makes every one testable without a network or a token.
//
// These are properties of the STOCK, not of the Playbook, so this module is
// deliberately not Playbook-owned — Swing Low and Early Entry can call it too.
// ─────────────────────────────────────────────────────────────────────────────

/** Reject when a name's recent traded value can't support an exit at the stop. */
export const LIQUIDITY = {
  /** Absolute floor for 20-day median traded value, in rupees. */
  minMedianTurnover: 20000000, // ₹2 crore/day
  /** ...and how far below its own 3-month norm the recent window may sit. */
  minRelativeTurnover: 0.35,
  /**
   * The relative rule only applies below this level.
   *
   * Without it the ratio test fires on names that are still hugely liquid:
   * VEDL's turnover fell 65%, but it fell to ₹334 crore a day, and you can exit
   * any futures position into that. The point of the relative rule is to catch
   * "this used to trade and now doesn't", not "this traded frantically and now
   * merely trades a lot".
   */
  relativeAppliesBelow: 150000000, // ₹15 crore/day
};

/** How long a distress filing keeps disqualifying a name. */
export const DISTRESS_WINDOW_DAYS = 120;

/**
 * Announcement categories that disqualify outright.
 *
 * MATCHED AGAINST THE CATEGORY, NOT THE NARRATIVE TEXT, and deliberately narrow.
 * The first version of this regexed the filing body and rejected 180 of 181
 * names, because every Indian filing cites "SEBI (LODR) Regulations, 2015" in
 * its boilerplate — RVNL winning a railway contract read as a regulatory
 * action. The category field is a controlled vocabulary and is safe to match;
 * the body is prose and is not.
 *
 * Three rules were dropped after reading what they actually caught:
 *   • bare /sebi/          — 778 hits, essentially all boilerplate citations
 *   • "Change in Auditors" — routine; statutory rotation is mandatory in India
 *   • "Action(s) taken or orders passed" — RVNL's small exchange fine, and
 *     eight contentless Bharti Airtel notices. 26 of 181 names, none in distress
 *   • bare /nclt|liquidat/ — Apollo's merger scheme and KPIT winding up a
 *     dormant subsidiary, neither of which is the company failing
 *
 * What's left fires almost never on an F&O universe of large caps, which is
 * correct. This is insurance against a genuinely broken company, not a filter.
 */
export const DISTRESS_PATTERNS = [
  { cat: /resignation of statutory auditor/i, label: "the statutory auditor resigned" },
  { cat: /forensic audit/i, label: "a forensic audit was ordered" },
  { cat: /fraud|misappropriat|defalcation/i, label: "a fraud disclosure" },
  {
    cat: /licen[cs]e|regulatory approval/i,
    text: /withdraw|cancel|suspen|revok/i,
    label: "a key licence was withdrawn",
  },
  {
    cat: /credit rating/i,
    text: /downgrade|revised downward|negative outlook/i,
    label: "a credit-rating downgrade",
  },
  {
    cat: /insolvency|corporate insolvency resolution|winding up/i,
    // A scheme of arrangement is a merger, and a subsidiary being wound up is
    // housekeeping. Neither is the listed company failing.
    exclude: /scheme of arrangement|subsidiar|associate|joint venture|amalgamat/i,
    label: "insolvency proceedings",
  },
];

/**
 * Board-meeting purposes worth warning about, most specific first.
 *
 * These are matched against the FORTHCOMING board-meetings feed, which carries
 * real future dates. The announcements feed was the obvious-looking source and
 * is the wrong one: its "Outcome of Board Meeting" entries describe results
 * already declared, so a gate built on them warns about the past.
 */
export const EVENT_PATTERNS = [
  { re: /financial result|quarterly result|audited result/i, code: "earnings", label: "results" },
  { re: /dividend/i, code: "dividend", label: "a dividend decision" },
  { re: /fund rais|preferential|qip|rights issue/i, code: "fundraise", label: "a fundraising decision" },
  { re: /bonus|stock split|buy ?back/i, code: "corporate_action", label: "a corporate action" },
  { re: /board meeting intimation|other business/i, code: "board_meeting", label: "a board meeting" },
];

const DAY = 86400000;
const parse = (d) => (d ? new Date(`${d}T00:00:00Z`).getTime() : NaN);

/** Whole days from `from` to `to`, both ISO yyyy-mm-dd. NaN-safe. */
export function daysBetween(from, to) {
  const a = parse(from);
  const b = parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Traded value, not share count. Volume in shares is meaningless across names
 * with 10× price differences, and it's rupee liquidity that decides whether a
 * stop fills.
 */
export function turnoverProfile(candles) {
  if (!Array.isArray(candles) || candles.length < 70) return null;
  const val = candles.map((c) => (c.close ?? 0) * (c.volume ?? 0)).filter((v) => v > 0);
  if (val.length < 70) return null;
  const recent = median(val.slice(-20));
  const norm = median(val.slice(-70, -20));
  return {
    recent,
    norm,
    ratio: norm > 0 ? recent / norm : null,
  };
}

// ── The qualifiers ───────────────────────────────────────────────────────────
// Signature: (cand, ctx) => null | { level, code, message }
//   ctx = { candles, filings, today }
//   filings = { pit: [], holding: [], announcements: [] } | null

/** Too thin to trade — the stop is a price you couldn't actually get filled at. */
function liquidityQualifier(cand, ctx) {
  const t = turnoverProfile(ctx.candles);
  if (!t) return null; // unknown → fail open

  if (t.recent < LIQUIDITY.minMedianTurnover) {
    const cr = (t.recent / 10000000).toFixed(2);
    return {
      level: "reject",
      code: "illiquid",
      message: `only ₹${cr}cr traded a day — too thin to exit at the stop`,
    };
  }
  if (
    t.ratio != null &&
    t.ratio < LIQUIDITY.minRelativeTurnover &&
    t.recent < LIQUIDITY.relativeAppliesBelow
  ) {
    return {
      level: "reject",
      code: "liquidity_collapse",
      message: `turnover has fallen to ${Math.round(t.ratio * 100)}% of normal — exits may not fill`,
    };
  }
  return null;
}

/**
 * A lender sold the PROMOTER's collateral. Structural distress, no stats needed.
 *
 * The `who === "promoter"` check is load-bearing, not defensive. The live
 * snapshot's only two invocations belong to HCLTECH and NAUKRI — both filed
 * against ordinary employees, both cash-rich IT firms with no distress
 * whatsoever. Without this check the gate rejects two perfectly good stocks and
 * looks authoritative doing it.
 */
function pledgeInvokeQualifier(cand, ctx) {
  const pit = ctx.filings?.pit;
  if (!Array.isArray(pit) || !pit.length) return null;

  const hit = pit.find(
    (f) =>
      f.type === "pledge_invoke" &&
      f.who === "promoter" &&
      (daysBetween(f.date, ctx.today) ?? 1e9) <= DISTRESS_WINDOW_DAYS,
  );
  if (!hit) return null;
  const ago = daysBetween(hit.date, ctx.today);
  return {
    level: "reject",
    code: "pledge_invoked",
    message: `pledged promoter shares were invoked ${ago}d ago — lender sold the collateral`,
  };
}

/** Auditor exits, regulatory action, insolvency, fraud. */
function distressFilingQualifier(cand, ctx) {
  const anns = ctx.filings?.announcements;
  if (!Array.isArray(anns) || !anns.length) return null;

  for (const a of anns) {
    const age = daysBetween(a.date, ctx.today);
    if (age == null || age > DISTRESS_WINDOW_DAYS || age < 0) continue;

    const category = a.category ?? "";
    const text = a.text ?? "";

    for (const p of DISTRESS_PATTERNS) {
      // Category gates the match. The `text` refinement is tested against the
      // NARRATIVE ONLY, never category+text: NSE's licence category is literally
      // named "Granting/withdrawal/surrender/cancellation/suspension of key
      // licenses", so including the category made every possible outcome match
      // its own label. That rejected CAMS, PAYTM, MOTILALOFS and ICICIPRULI for
      // filings that were all approvals being GRANTED.
      if (!p.cat.test(category)) continue;
      if (p.text && !p.text.test(text)) continue;
      if (p.exclude && p.exclude.test(`${category} ${text}`)) continue;
      return {
        level: "reject",
        code: "distress_filing",
        message: `${p.label} — filed ${age}d ago`,
      };
    }
  }
  return null;
}

/**
 * A scheduled board meeting lands inside the holding window.
 *
 * WARN, never reject. A seasonality trade held through an earnings print is a
 * legitimate trade — it just carries a risk its stop does not describe, and the
 * screen should say so rather than quietly implying the stop covers it.
 */
function eventWindowQualifier(cand, ctx) {
  const meetings = ctx.filings?.boardMeetings;
  if (!Array.isArray(meetings) || !meetings.length) return null;
  if (!ctx.holdEndsOn) return null;

  for (const m of meetings) {
    const away = daysBetween(ctx.today, m.date);
    const slack = daysBetween(m.date, ctx.holdEndsOn);
    // Inside the window means: still ahead of us, and at or before the exit.
    if (away == null || slack == null || away < 0 || slack < 0) continue;

    const hay = `${m.purpose} ${m.desc}`;
    const p = EVENT_PATTERNS.find((x) => x.re.test(hay));
    if (!p) continue;
    return {
      level: "warn",
      code: p.code,
      message:
        away === 0
          ? `${p.label} due today — inside your holding window`
          : `${p.label} due in ${away}d — inside your holding window`,
    };
  }
  return null;
}

/**
 * No intimation yet, but this company's own history says results are near.
 *
 * Needed because intimations arrive only a week or two ahead: checked in
 * mid-August, the forward feed held 0 meetings for the whole of Sep–Nov. Left
 * at that, the earnings gate would sit silent for most of the year and then
 * work brilliantly for a fortnight each quarter. Past results dates are dense,
 * so the cadence is easy to learn and project.
 *
 * Flagged as an estimate in its own wording — this is inference, not a filing,
 * and it should not read like one.
 */
function resultsCadenceQualifier(cand, ctx) {
  const hist = ctx.filings?.resultsHistory;
  if (!Array.isArray(hist) || hist.length < 3) return null;
  if (!ctx.holdEndsOn) return null;

  // Already covered by a real intimation — don't say it twice.
  const intimated = ctx.filings?.boardMeetings ?? [];
  if (intimated.some((m) => EVENT_PATTERNS.some((p) => p.re.test(`${m.purpose} ${m.desc}`)))) return null;

  const gaps = [];
  for (let i = 1; i < hist.length; i++) {
    const g = daysBetween(hist[i - 1], hist[i]);
    if (g != null && g > 45 && g < 200) gaps.push(g);
  }
  if (gaps.length < 2) return null;

  gaps.sort((a, b) => a - b);
  const typical = gaps[gaps.length >> 1];
  const sinceLast = daysBetween(hist[hist.length - 1], ctx.today);
  if (sinceLast == null || sinceLast < 0) return null;

  const dueIn = typical - sinceLast;
  const horizon = daysBetween(ctx.today, ctx.holdEndsOn);
  if (horizon == null || horizon <= 0) return null;

  // Only worth saying if it lands in the window. A week of slack either side,
  // because a projected date is never exact.
  if (dueIn < -7 || dueIn > horizon + 7) return null;

  return {
    level: "warn",
    code: "earnings_estimated",
    message:
      dueIn <= 0
        ? `results are overdue on this company's usual ${typical}d cadence — expect them inside your window`
        : `results likely in ~${dueIn}d on its usual ${typical}d cadence — probably inside your window`,
  };
}

/**
 * Promoter stake falling across consecutive quarters.
 *
 * WARN ONLY, AND PERMANENTLY SO — this was backtested and failed.
 *
 * 2,651 observations across 166 names, 2022-2026, market-neutral returns over a
 * forward quarter, with a 45-day filing lag so nothing is read before it was
 * public. Against a +2.07% baseline: a falling stake returned +1.66% and a
 * RISING stake +1.17%. Both underperform "flat", which is the signature of
 * noise rather than signal — a real directional effect would separate them.
 * Split in half, the falling-stake cell ran +2.68% then +0.85%, straddling its
 * own baseline in both directions.
 *
 * So it stays a warning: worth seeing on the card, never worth a weight. Please
 * don't promote it to a conviction component without a fresh test on a longer
 * window — the answer here was no.
 */
function stakeTrendQualifier(cand, ctx) {
  const h = ctx.filings?.holding;
  if (!Array.isArray(h) || h.length < 3) return null;

  // Sorted newest-first by the collector.
  const [q0, q1, q2] = h;
  if (!(q0?.promoterPct > 0 && q1?.promoterPct > 0 && q2?.promoterPct > 0)) return null;

  const falling = q0.promoterPct < q1.promoterPct && q1.promoterPct < q2.promoterPct;
  if (!falling) return null;

  const drop = q2.promoterPct - q0.promoterPct;
  if (drop < 0.5) return null; // sub-half-point drift is share-count noise, not intent

  return {
    level: "warn",
    code: "stake_falling",
    message: `promoter stake down ${drop.toFixed(1)}pts over three quarters (${q2.promoterPct.toFixed(1)}% → ${q0.promoterPct.toFixed(1)}%)`,
  };
}

export const QUALIFIERS = [
  liquidityQualifier,
  pledgeInvokeQualifier,
  distressFilingQualifier,
  eventWindowQualifier,
  resultsCadenceQualifier,
  stakeTrendQualifier,
];

/**
 * Run every qualifier over one candidate.
 *
 * Returns rejects and warnings separately: rejects join the existing reason
 * list in buildPlaybook, warnings ride along on picks that pass.
 */
export function qualify(cand, ctx = {}) {
  const rejects = [];
  const warnings = [];
  for (const q of QUALIFIERS) {
    let hit = null;
    try {
      hit = q(cand, ctx);
    } catch {
      // A broken qualifier must not take the Playbook down with it.
      hit = null;
    }
    if (!hit) continue;
    (hit.level === "reject" ? rejects : warnings).push(hit);
  }
  return { rejects, warnings };
}

// ── Promoter context (shadow mode) ───────────────────────────────────────────
/**
 * Recent promoter activity, for DISPLAY ONLY.
 *
 * This is the headline version of the idea — promoters buying their own stock —
 * and it is exactly the part that can't be validated: NSE's insider archive is
 * not consistently queryable backwards (RELIANCE returns 572 filings for 2018,
 * 17 for 2021 and 0 for 2024), so there is no history to calibrate against.
 * It contributes nothing to conviction or sizing until forward-collected
 * snapshots build that history.
 */
export function promoterActivity(filings, today, withinDays = 120) {
  const pit = filings?.pit;
  if (!Array.isArray(pit) || !pit.length) return null;

  const recent = pit.filter((f) => {
    const age = daysBetween(f.date, today);
    return age != null && age >= 0 && age <= withinDays;
  });
  if (!recent.length) return null;

  // Only promoters and promoter group, and only open-market trades. Off-market
  // transfers are family reshuffling, and employee filings are ESOP vesting.
  const meaningful = recent.filter((f) => f.who === "promoter" && f.market);

  const buys = meaningful.filter((f) => f.type === "buy");
  const sells = meaningful.filter((f) => f.type === "sell");
  const buyValue = buys.reduce((a, f) => a + f.value, 0);
  const sellValue = sells.reduce((a, f) => a + f.value, 0);

  const pledged = recent.filter((f) => f.type === "pledge").length;
  const revoked = recent.filter((f) => f.type === "pledge_revoke").length;

  if (!buys.length && !sells.length && !pledged && !revoked) return null;

  return {
    windowDays: withinDays,
    buys: buys.length,
    sells: sells.length,
    buyValue: Math.round(buyValue),
    sellValue: Math.round(sellValue),
    netValue: Math.round(buyValue - sellValue),
    pledged,
    revoked,
    /** Never fed into scoring — see the note above. */
    shadow: true,
  };
}
