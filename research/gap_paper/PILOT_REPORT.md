# Exploratory five-stock pilot — frozen V1

The conservative continuity-assumption replay loses after costs. This five-stock run does not establish a profitable strategy or test a market-wide scanner. Strict corporate-action review permits no trades because reviewed comparable closes are absent. The exploratory runs are unverified current-survivor research, not a deployable performance claim.

| Scenario | Trades | Net P&L ₹ | Account return | Profit factor | Maximum marked DD ₹ |
|---|---:|---:|---:|---:|---:|
| strict | 0 | 0.00 | 0.000% | n/a | 0.00 |
| continuity-assumption | 16 | -419.63 | -0.210% | 0.84 | 1,236.94 |
| stress | 16 | -2,171.04 | -1.086% | 0.40 | 2,499.05 |
| exclude-ambiguous | 13 | 512.47 | 0.256% | 1.31 | 627.10 |
| complete-only | 16 | -419.63 | -0.210% | 0.84 | 1,236.94 |

**The ambiguity-exclusion row is an ex-post observation-quality diagnostic, not a causal trading variant.** It drops ambiguous entry/stop bars after seeing their ranges. Its favorable result cannot be used as evidence that those losses could be avoided live. Baseline instead charges the possible stop, and never credits an unknown-order entry-bar target. Complete-only excludes every day with a missing sample-stock candle and rebuilds warmup; unchanged P&L means only that the observed omissions did not change these trades, not that shared missing sessions do not exist.

Continuity baseline: win rate 43.750%; average win ₹308.73; average loss ₹-286.75; net expectancy ₹-26.23/trade. Maximum sampled marked-equity drawdown 0.618%. Ending equity ₹199,580.37; terminal open positions 0.
Average observed-bar capital utilization 0.091%; 323 bar-close observations with exposure. Two-sided turnover ₹1,584,871.66 (7.92× initial capital). This utilization omits positions entered and exited wholly inside an interval; it is not measured time-weighted exchange exposure.
Largest five trades contribute ₹1,839.39; all remaining trades contribute ₹-2,259.02. Ambiguous closed trades: 3; delayed exits: 0. Marked drawdown samples available opens/closes, not unseen tick paths.

## Annual account results — continuity assumption

| Year | Trades | Net cash/account P&L ₹ | Return on year-start equity | Profit factor |
|---|---:|---:|---:|---:|
| 2022 | 9 | -782.96 | -0.391% | 0.55 |
| 2023 | 2 | 892.42 | 0.448% | n/a |
| 2024 | 1 | -315.82 | -0.158% | 0.00 |
| 2025 | 2 | 324.21 | 0.162% | n/a |
| 2026 | 2 | -537.49 | -0.269% | 0.00 |

Account returns use equity, never sums of trade percentages. All year-end observations in this pilot are flat, so cash/account P&L coincide; 2026 is partial through 25 September. The earlier 41-trade pilot was not fitted or replicated. These periods have already been studied; no untouched out-of-sample designation.

## By stock — continuity assumption

| Stock | Trades | Net P&L ₹ | Profit factor |
|---|---:|---:|---:|
| HDFCBANK | 5 | -742.32 | 0.26 |
| INFY | 2 | -84.19 | 0.73 |
| ITC | 1 | 229.15 | n/a |
| RELIANCE | 1 | -285.35 | 0.00 |
| TATASTEEL | 7 | 463.09 | 1.48 |

Stock-by-year metrics are also in `summary.json` (`by_stock_year`). These are contributions to a shared cash account, not separate account backtests.

## Itemized fees — continuity assumption

| Component | Rupees |
|---|---:|
| brokerage | 640.00 |
| exchange | 54.68 |
| sebi | 1.60 |
| ipft | 1.60 |
| gst | 125.64 |
| stamp | 23.75 |
| stt | 198.19 |

Total explicit charges ₹1,045.46; gross P&L after modeled slippage but before these charges ₹625.83. Slippage is embedded in prices, not subtracted again. The small opportunity count, transaction costs, and three ambiguous entry/stop outcomes prevent a convincing edge; the 10bp/side plus double-fee stress worsens the loss. No parameters were optimized.

## Actual input coverage

| Stock | Five-minute rows | Earliest | Latest | Zero-volume bars | Incomplete regular sessions |
|---|---:|---|---|---:|---:|
| RELIANCE | 87680 | 2022-01-03T09:15:00+05:30 | 2026-09-25T15:25:00+05:30 | 80 | 2 |
| HDFCBANK | 87688 | 2022-01-03T09:15:00+05:30 | 2026-09-25T15:25:00+05:30 | 81 | 2 |
| INFY | 87689 | 2022-01-03T09:15:00+05:30 | 2026-09-25T15:25:00+05:30 | 81 | 1 |
| ITC | 87685 | 2022-01-03T09:15:00+05:30 | 2026-09-25T15:25:00+05:30 | 85 | 2 |
| TATASTEEL | 87689 | 2022-01-03T09:15:00+05:30 | 2026-09-25T15:25:00+05:30 | 80 | 1 |

No 2021 five-minute coverage is asserted. Each scenario includes `data_validation.json`, missing-bar lists, excluded special sessions, input SHA-256s and exact code hashes. Shared missing 7 March 2022 09:30 and delayed starts on RELIANCE 20 July 2023 / ITC 6 January 2025 are retained as gaps. HDFCBANK 25 June 2024 09:15 is additionally rejected because its reported low exceeds its open (one invalid candle). Historical corporate-action and tick metadata remain unverified. Calendar is based on observed daily dates and cannot certify that entirely absent shared sessions are complete.

## Completed and next steps

Implemented one causal engine, shared paper cash account, conservative candle execution, quote-event adapter, transactional recovery, dashboard and separate paper controls, tests, five-stock replay, validation/ledgers and resumable broader downloader. Read-only analytics quote probe succeeded. No bot, exchange order, droplet, deployment or persistent recorder was touched.

The candidate master contains 2,680 current records, all disabled pending review. A 100-stock Jan 2022–Sep 2026 study needs up to 5,700 monthly requests before cache reuse; no bulk download was run. Historical replay accepts a broader dated manifest. Forward candle polling is capped at 60 reviewed members; a larger forward universe requires a batched/streaming adapter.

Before collecting paper signals: verify ordinary-share eligibility/suspensions, dated ticks, comparable closes and a complete calendar (including warmup); bootstrap the local account paused; inspect exclusions; enable the local dashboard, explicitly resume paper entries, then run the foreground observer. Exact commands and stopping instructions are in `README.md`. No activation was performed.

Do not move to live trading on this evidence. Future paper collection should retain received timestamps, spreads/depth, missed observations and rejected signals for a genuinely forward evaluation. Any subsequent strategy experiment must freeze its new rules before examining results.
