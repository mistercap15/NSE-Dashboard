# Futures Protection planner — release 1

Web `/protection`; mobile Research → Futures Protection. Advisory only. No account, order or bot-control endpoints. Existing live trading services are untouched.

## Implemented

Long stock-futures input, current contract resolution from Upstox NSE master, actual lot quantities, same-expiry purchased puts, quote/depth validation, transparent computed target, expiry payoff chart, scenario prices and local saved input plans. Server calculations are shared by web and mobile. No manual target field or short-option strategy.

Seasonal target: positive historical median for expiry calendar month, minimum five completed prior years; multiply remaining calendar days / 30, capped at prior 60-session high when overhead. Rebound target: prior 50-session mean, similarly capped. Both require 60 daily bars, last bar within seven calendar days, positive upside and expiry in the current calendar month (1–40 days). These are heuristics, not calibrated forecasts. Today's daily bar is excluded. Negative/missing evidence returns no target. No forecast is manufactured to fit the user's original entry.

Quote universe: same underlying, expiry and lot size; strikes 85–105% of current spot, nearest 40 maximum. This is bounded comparison, not whole-chain optimization. Strong = least modeled terminal loss; balanced = highest positive target reward/loss among available strikes; lower premium = lowest debit. Duplicate choices collapse. No account affordability recommendation because margin is not queried.

Executable candidates require feed timestamp within 120 seconds, valid uncrossed bid/ask, spread <=10%, top ask depth covering full quantity, and regular weekday 09:15–15:30 IST. Exchange holidays are not independently checked; broker fresh quotes and actual market status must be verified before any action. Outside those checks, available quotes can still produce explicitly **indicative / hypothetical** comparisons. No suggested execution or LTP fill substitution.

The chart is matched-expiry P&L including entered total cost allowance. It is NOT pre-expiry option valuation. Existing trade P&L uses original entry; it cannot reimburse past losses. No verified broker margin, funding, settlement/tax calculation, liquidation assurance or all-in loss guarantee. Default ₹10,000 cost allowance is visibly editable and not an account-specific fee estimate.

## Timing layer and persistence limits

Completed-day SMA20 weakness and current futures OI level are displayed. OI direction/history and verified news are unavailable in this release and visibly marked; no “safe to remain unhedged” or predictive OI score. No automatic hedge, background alerts, cross-device synchronization or account position import. Saved inputs (max 30) reside in browser localStorage / device AsyncStorage and require refresh; deleting one affects only that device. No sensitive holdings are uploaded to third-party news/AI services.

## Verification

`node scripts/test-protection.mjs`: expiry payoff floor, payoff at target, whole-lot/expiry mismatch, stale/missing/crossed quotes, insufficient depth, incomplete-day and future-seasonal-data exclusion, unsupported horizons, missing target.

`npm run test:upstox`: 17 existing quote normalization checks.

`npm run build`; mobile `npm run typecheck` and Android Expo export. Live read-only probe resolved HINDUNILVR October 2026 at lot size 300 and returned 19 quoted put candidates for the five-lot example. October historical median was -1.03% over 17 samples; seasonal upside target was correctly withheld. Retrieved prices are not certified executable outside market hours.

Local web visual QA covers contract selection, indicative card warnings, negative-seasonality state and chart. No live order test is appropriate. Native device visual QA is distinct from TypeScript/export validation.

## Sources

https://upstox.com/developer/api-documentation/get-full-market-quote/
https://upstox.com/developer/api-documentation/instruments/
https://www.optionseducation.org/videolibrary/protective-put-example-breakeven-and-maximum-loss
