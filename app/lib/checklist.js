// ─────────────────────────────────────────────────────────────────────────────
// Pre-trade checklist — the five sanity checks a seasonal setup has to survive
// before it is worth acting on: enough history, a median that isn't distorted
// by outliers, a genuinely weak current month, a genuinely strong target month,
// and a note on rolling.
//
// Lifted out of app/api/early-entry/route.js unchanged so the Playbook can run
// the same checks on its shortlist without triggering a whole-universe scan.
// One copy, so the two screens can never disagree about whether a setup passes.
// ─────────────────────────────────────────────────────────────────────────────

export function runPreTradeChecklist(stock, context, candles) {
  const checks = []

  // CHECK 1: Data quality — minimum 5 years per month
  const totalYears = (stock.nextMonth.positive_years || 0) +
                     (stock.nextMonth.negative_years || 0)
  const check1 = {
    name:    "Data Quality",
    desc:    `${totalYears} years of ${stock.nextMonth.monthName} data`,
    passed:  totalYears >= 5,
    warning: totalYears >= 3 && totalYears < 5,
    detail:  totalYears >= 5
      ? `✓ ${totalYears} years of real data — reliable signal`
      : totalYears >= 3
      ? `⚠ Only ${totalYears} years — treat with caution`
      : `✗ Less than 3 years — signal unreliable`,
  }
  checks.push(check1)

  // CHECK 2: Median vs Average gap
  // If avg is more than 2.5x the median, outliers are distorting the avg
  const avg    = Math.abs(stock.nextMonth.avg_return   || 0)
  const median = Math.abs(stock.nextMonth.median_return || 0)
  const gap    = median > 0 ? avg / median : 999
  const check2 = {
    name:    "Signal Reliability",
    desc:    `Avg +${stock.nextMonth.avg_return?.toFixed(1)}% vs Median +${stock.nextMonth.median_return?.toFixed(1)}%`,
    passed:  gap <= 2.5,
    warning: gap > 1.8 && gap <= 2.5,
    detail:  gap <= 1.5
      ? `✓ Avg and median are close — consistent returns`
      : gap <= 2.5
      ? `⚠ Avg higher than median — a few big years pulling it up. Use median as target.`
      : `✗ Avg is ${gap.toFixed(1)}x the median — outlier driven. Avg is misleading.`,
  }
  checks.push(check2)

  // CHECK 3: Current month weakness confirms dip setup
  const currentWR = stock.currentMonth?.win_rate || 50
  const check3 = {
    name:    "Dip Month Confirmed",
    desc:    `Current month win rate: ${currentWR}%`,
    passed:  currentWR <= 60,
    warning: currentWR > 60 && currentWR <= 70,
    detail:  currentWR <= 40
      ? `✓ Current month very weak (${currentWR}% WR) — strong dip setup`
      : currentWR <= 60
      ? `✓ Current month weak (${currentWR}% WR) — dip setup confirmed`
      : currentWR <= 70
      ? `⚠ Current month neutral (${currentWR}% WR) — weaker early entry case`
      : `✗ Current month strong (${currentWR}% WR) — not a dip month`,
  }
  checks.push(check3)

  // CHECK 4: Next month win rate minimum threshold
  const nextWR = stock.nextMonth.win_rate || 0
  const check4 = {
    name:    "Next Month Strength",
    desc:    `${stock.nextMonth.monthName} win rate: ${nextWR}%`,
    passed:  nextWR >= 75,
    warning: nextWR >= 65 && nextWR < 75,
    detail:  nextWR >= 85
      ? `✓ Very strong next month (${nextWR}% WR) — high conviction`
      : nextWR >= 75
      ? `✓ Strong next month (${nextWR}% WR) — tradeable setup`
      : nextWR >= 65
      ? `⚠ Moderate next month (${nextWR}% WR) — borderline`
      : `✗ Weak next month (${nextWR}% WR) — below threshold`,
  }
  checks.push(check4)

  // CHECK 5: Roll Opportunity — informational only
  const check5 = {
    name:            "Roll Opportunity",
    desc:            "Next-next month seasonality",
    passed:          true,
    warning:         false,
    detail:          "Check next month rankings to see if roll is possible",
    isInformational: true,
  }
  checks.push(check5)

  const hardChecks = checks.filter(c => !c.isInformational)
  const hardPassed = hardChecks.filter(c => c.passed).length
  const hasWarning = hardChecks.some(c => c.warning)

  const checklistResult =
    hardPassed === 4 && !hasWarning ? "PASS"    :
    hardPassed === 4 && hasWarning  ? "CAUTION" :
    hardPassed >= 3                 ? "CAUTION" : "FAIL"

  const scorePenalty =
    checklistResult === "FAIL"    ? 25 :
    checklistResult === "CAUTION" ? 10 : 0

  return {
    checks,
    result:      checklistResult,
    passCount:   hardPassed,
    totalChecks: hardChecks.length,
    scorePenalty,
    summary:
      checklistResult === "PASS"
        ? "All checks passed — high quality setup"
        : checklistResult === "CAUTION"
        ? "Minor concerns — trade with awareness"
        : "Setup has issues — reduced confidence",
  }
}
