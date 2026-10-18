# NIFTY futures research — 14 October 2026

**No deployable profitable strategy has been identified in this fixed screen.** The main constraint is whole-lot risk at the user-selected ₹5 lakh capital and 0.5% planned risk limit. No risk limit was raised to force trades.

## Verified data

Repaired the existing probe’s undefined `monthly_expiries` call; authenticated expiry access and the probe then succeeded. No subscription purchase. Downloaded 37,641 real five-minute futures records from 30 September 2024 through 13 October 2026. Resolved 27 contract metadata records (including current/future-listed contracts); 25 requested front-month contract windows through the cutoff, of which December2024 returned zero bars. Each row retains contract symbol, real expiry, instrument key, lot size, raw provider tick size, OHLCV/OI and warning flags. Raw authenticated API responses exclude authorization headers and are cached by exact endpoint/date window for resume.

Observed lot sizes: 25 through January2025 expiry, 75 from February–December2025, 65 from January2026 onward. These came from each resolved contract, not today’s lot retroactively applied. The December2024 request was freshly rechecked and still empty.

12,854 records precede15June2025 and remain quarantined from primary inference. 1,329 records are outside the regular five-minute grid (includes historical shifted or extra session bars); retained but excluded. 151 records have zeroOI; these strategies do not use OI. The first contract’s initial front-month boundary is approximate and flagged. No interpolation or spot substitution. Entire-session completeness is not certified against an independent exchange calendar. Extra timestamps extend to15:35; these are never treated as ordinary intraday bars.

Fresh five-minute aggregation matches all four OHLC values within0.11 points for11,479 matched bars in the old fifteen-minute export. This is same-vendor consistency, not independent price certification.

## Frozen futures screen

Primary sample:329 complete regular observed sessions,16June2025–13October2026. This is a conditional data-quality subset: excluding incomplete sessions after seeing coverage is not a live trading oracle. EMA warmup resets on rolls or weekday date gaps (including holidays conservatively); it never bridges a missing session or a contract roll. Whole lots, actual contract identity, next-bar entries, adverse gaps, stop-first collisions, paid fees and capital constraints are enforced. Margin20% is an assumption, with30% sensitivity; historical SPAN/ELM and broker liquidation remain unverified, so capital-return figures are conditional. Tick sizes are interpreted from provider paise units. No untouched out-of-sample claim.

| Candidate | Cost each side | Margin assumption | Trades | Net P&L ₹ | Return on ₹5L | PF | Max marked DD ₹ | Rejected entries |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| orb30 | 2bp | 20% | 0 | 0.00 | 0.000% | n/a | 0.00 | 377 |
| orb30 | 5bp | 20% | 0 | 0.00 | 0.000% | n/a | 0.00 | 377 |
| orb30 | 2bp | 30% | 0 | 0.00 | 0.000% | n/a | 0.00 | 377 |
| ema9_15 | 2bp | 20% | 1 | -553.87 | -0.111% | 0.00 | 1,398.74 | 255 |
| ema9_15 | 5bp | 20% | 0 | 0.00 | 0.000% | n/a | 0.00 | 256 |
| ema9_15 | 2bp | 30% | 0 | 0.00 | 0.000% | n/a | 0.00 | 256 |

Zero trades is not evidence of robustness or profitability. In the base margin case every ORB30 rejection exceeded the risk budget; EMA had only one admissible trade and therefore provides no reliable expectancy estimate.
- orb30: median planned loss for ONE lot among rejected entries ₹8,169.70, compared with an initial ₹2,500 budget. Minimum rejected one-lot planned loss ₹3,690.15. This includes modeled stop execution and fees; gaps can exceed planned risk.
- ema9_15: median planned loss for ONE lot among rejected entries ₹4,097.63, compared with an initial ₹2,500 budget. Minimum rejected one-lot planned loss ₹2,603.22. This includes modeled stop execution and fees; gaps can exceed planned risk.

## Base-cost yearly results

| Candidate | Year | Trades | Net P&L ₹ | Year-start capital return |
|---|---|---:|---:|---:|
| orb30 | 2025 | 0 | 0.00 | 0.000% |
| orb30 | 2026 | 0 | 0.00 | 0.000% |
| ema9_15 | 2025 | 1 | -553.87 | -0.111% |
| ema9_15 | 2026 | 0 | 0.00 | 0.000% |

## Next decision

Reject these two candidates for deployment under the frozen capital/risk rules. Do not loosen risk or invent fractional futures lots to make a backtest trade. More data does not solve an indivisible-lot risk mismatch. A subsequent strategy must have an independently justified stop/holding structure that fits a real lot, and must be registered as a new experiment before results are inspected. The current historical evidence does not justify any live deployment.

The approved V1/V2 cash-equity forward comparison is separate and remains paper-only; its interface release does not deploy either NIFTY candidate. Future live work requires separately approved risk/capital and a verified executable margin model, broader independent data checks, and forward validation under the frozen protocol.

## Reproduce

`python3 -m research.strategy_search.futures_data --out data/exports/nifty_futures_priority_20261014 --to 2026-10-13` resumes exact cached windows, using only a locally configured analytics token. Do not put tokens in chat.

`python3 -m research.strategy_search.nifty_screen --data data/exports/nifty_futures_priority_20261014/candles.jsonl --out data/exports/nifty_futures_priority_20261014/screen` runs all six fixed candidate/cost/margin combinations from local data without network calls. Each scenario stores trades, daily totals, equity, rejections with minimum lot risk, excluded observations, year/quarter/contract metrics and input/code/protocol hashes.

Sources: [Upstox contract metadata](https://upstox.com/developer/api-documentation/get-expired-future-contracts/) and [dated published charges](https://upstox.com/brokerage-charges/). Costs are a published research model, not verified account-specific billing.
