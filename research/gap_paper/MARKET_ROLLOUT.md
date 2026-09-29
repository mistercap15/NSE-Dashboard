# Whole-NSE gap scanner — 29 September 2026

The earlier live observer was dynamically selecting from Nifty 50, which was the wrong scope. Separately, the historical five-stock pilot was displayed too prominently and could be mistaken for today's picks. This release replaces the active discovery universe with the full official NSE equity list and moves the saved pilot into an explicitly historical view.

## Verified data and behavior

- NSE list: 2,587 equity listings; all 2,587 matched to current Upstox instruments and returned real quotes in the server probe. The first full scan took 12.15 seconds. Of these, 2,314 meet instrument-level entry eligibility; the others remain visible with exclusions.
- Last retained market snapshot on 29 September, 15:39:48 IST: 2,587 quoted, 1,134 positive gaps and 7 eligible candidates at that snapshot's preparation stage. Counts may change while previous-close history becomes verified. These are actual API observations, not constants in the UI.
- Every positive gap is searchable. V1 subsequently watches only the top five verified 1–10% gaps, ranked at the opening decision. The five-stock cap is a strategy rule, not a discovery restriction. Numeric V1 thresholds were not tuned.
- No timely whole-market opening decision existed on the rollout day, so no retrospective paper trades were created. The existing ₹200,000 account and ledger were retained. Today's recorded entries and closed trades were zero.
- History preparation is ongoing. Missing, incomplete or stale history/action checks cannot qualify. This release does not claim the full universe is ready for tomorrow.
- An after-close defect was found and fixed: historical candles still ended yesterday. The preparer now adds actual current-day intraday candles after 15:45 and rejects conflicting overlaps. A real RELIANCE check verified session 2026-09-29, all 75 bars, 20 complete liquidity sessions, and final five-minute close ₹1,182.00. No interpolation or invented candles.

## Interface

Mobile uses the application's shared cards, spacing, typography, badges and theme. Scanner, Paper trades and How it works are separate tabs. Scanner shows quoted coverage, eligibility progress, searchable gap rows and expandable provenance; the trade view shows daily net P&L, entries, closed trades, fees, current positions and signal activity. The historical pilot has a separate route and does not establish an edge.

Visual checks at 390×844 used the actual recorded 14:45 API snapshot in an isolated local preview. Verified search, range filtering, tab navigation and P&L layout. Preview-only authentication bypass and snapshot adapter are outside both repositories and are not part of the release. Screenshots: `data/exports/gap_paper/verification/mobile-market-scanner.png` and `mobile-paper-pnl.png`. Android bundling is checked separately; this visual check is a React Native web preview, not an on-device screenshot.

## Verification and isolation

54 Python checks passed, including late-source causality, bounded clock skew, prior-session seeding, stale profile rejection and current-day intraday completion. 13 dashboard API checks passed. Mobile TypeScript and 86 existing tests passed; production dashboard build and Android export passed before publication.

Only the already-authorized `nserank-gap-paper.service` was updated. Nifty hourly, Nifty five-minute and crypto trading service MainPIDs and active states remained unchanged across paper deployments. No exchange order endpoint was used. The paper service remains quote-sampled simulation, not tick-perfect or guaranteed exchange fills; see OPERATIONS.md for execution and coverage limits.

Raw responses, references, profiles and opening snapshots remain under `/var/lib/nserank-gap-paper` on the separate paper service. The local sanitized UI snapshot is under `data/exports/gap_paper/market_setup/paper-ui-snapshot.json`. Data and credentials are excluded from the source release.
