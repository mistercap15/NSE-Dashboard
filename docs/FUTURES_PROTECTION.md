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

## Release 2 — actual contract and quote selection

The discovery response now supplies Upstox-listed futures, their LTP/bid/ask snapshots, all listed PE contracts and actual PE expiry dates. Web and mobile allow independent futures, PE expiry and exact PE strike selection. Selecting a future defaults the PE expiry to match; changing PE expiry clears the prior strike. Automatic comparisons remain an optional selection, not a replacement for the exact contract chooser.

New plans use a refreshed futures best ask; if unavailable, an LTP fallback is explicitly indicative. Existing positions retain the user's actual fill. Both futures and selected put expose feed time and best-ask quantity. Missing quotes show unavailable, not a fabricated price. Market-source entry freshness/depth failures make the whole package indicative, even if the option alone passes its checks.

Mismatched expiries remain inspectable, but no combined protected terminal payoff is produced. Non-divisible lot quantities also block combined protection. This avoids claiming a floor across an expired hedge or assigning a fabricated time value to a later-dated put.

Validation: existing pure tests plus entry-source checks; authenticated read-only API checked HINDUNILVR October/November/December futures and 82 PE contracts, exact October 1900 PE and November-versus-October mismatch. Local web UI verified the selector lists and actual quoted prices. Prices observed after hours are not executable recommendations. No account orders or service changes.

## Release 3 — four-input workflow

The default web/mobile flow now asks only for stock, actual listed futures contract month, lots and the existing purchase price. Contracts load automatically on stock selection. PE expiry and share quantity are matched automatically. Capital, fee allowance, target mode and option-chain choices are removed from this flow.

`simple=1` preserves the entered fill, ignores any supplied market-entry or mismatched-option parameters, and applies no extra cost allowance. The UI labels all payoff numbers before brokerage, taxes and funding, with put premium included. Internal account percentage fields are not used to select the put and are not displayed. No sizing recommendation is made.

One suggestion: nearest-to-spot put within 5%, with a positive uncrossed bid/ask; executable-quality quotes are preferred over indicative ones. This is a transparent near-ATM protection heuristic, not an optimized-return claim. When no nearby valid quote exists, show unavailable. After-hours/insufficient-depth suggestions are visibly indicative. Supporting target/quote methodology lives in a collapsed details panel rather than the primary flow.

The web layout places four controls above a single put summary and payoff graph. Mobile uses the same hierarchy with tappable month chips and scenario buttons. Existing device-local saved-plan records are not deleted, although the saved-plan management UI is removed from the simplified flow.

Validated pure recommendation selection and fee-free simple API integration: HUL 5 lots × 300 shares, actual entry ₹1,900 retained, 1900 PE, quoted debit ₹40,050 and matched-expiry loss ₹40,050 before fees. This was after-hours indicative data. Web screenshots inspected, Next build, mobile TypeScript and Android export passed. Native-device visual QA remains separate.

## Daily hedge guidance and strike comparison (v1)

Advisory only; rules are not calibrated probabilities or a proven trading edge. Original four inputs remain. All completed daily evidence excludes today, including after the close (conservative one-session delay). Require 51 valid stock candles with latest age <=4 calendar days; holiday calendars are not inferred. Support/resistance: preceding 20-session low/high, excluding signal day. Trend: SMA20/50. Wilder ATR14 seeds from initial available true ranges. Prepare when support breaks, both averages fail, or price is within one ATR of support. Protection warranted only when a completed daily support break has volume >=1.5x prior20 average, NIFTY below both averages, or same-contract price down/OI up >=2% confirmation. No rolled-contract OI comparison. Last hourly bars from two completed sessions represent futures changes; missing/zero OI is unknown. NIFTY is never replaced with a single stock.

Recovery review requires close above SMA20 and previous high, higher low, known NIFTY/OI context and neither bearish confirmation. No put-profit threshold triggers an exit. Within five calendar days of expiry, review the hedge and future together. Live news, sector sentiment and options-flow signals are NOT connected. Existing dated filings are displayed as context only; missing or stale coverage does not imply safety. No background service, alerts, or automatic execution. Refresh explicitly to reassess.

All available quoted strikes can be selected; the selected one and three nearest alternatives are compared. Web shows a full expiry scenario table; mobile compares four at the selected scenario. Both offer +/-1,2,3,4 percent alongside larger stress moves. Percentages are relative to current spot; P&L is relative to actual futures entry and new put ask. Premium included; fees excluded. These are conditional expiry payoffs, not expected profits or pre-expiry option valuations.

Optional actual put fill is stored per contract/strike/full quantity on device. Hedge P&L uses fresh two-sided bid and combined mark needs fresh futures quote. Depth/fees remain unverified. Partial hedge records, cross-device sync, position list, live news integration and background monitoring are not implemented in this release. Clearing the saved fill removes tracking; it never sends an order.

Validation: `node scripts/test-hedge-advice.mjs`, existing protection tests, dashboard production build, mobile typecheck/Android export. Tests cover incomplete-candle exclusion, stale/insufficient data, missing market/OI and expiry handling.
