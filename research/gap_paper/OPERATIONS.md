# Forward paper observer

This is a separate cash-equity paper account. It never calls an exchange order API and never controls the existing Nifty or crypto services. Frozen V1 strategy/risk parameters are in `config.live.json`; only the execution adapter differs from historical candle replay.

## Observation and execution

The active `market_service` discovers the full official NSE equity list, maps it to current Upstox instruments and shows every observed positive gap. The earlier Nifty 50 restriction in the legacy reference preparer is no longer used by the installed unit. Upstox current NORMAL/EQ instruments and suspended instruments are matched by key, segment and series (an ISIN can also appear in suspended alternate series). Current instruments are only used for forward selection and indicator warmup; no historical survivorship claim is made. Sources and all reported corporate-action effective dates are saved daily. Every reported action date, including dividends, is quarantined; no guessed adjustment factors. Missing/unknown action data excludes that stock. Unreported provider actions remain a limitation.

Completed five-minute candles are collected after their close. Receipt time is recorded separately: a delayed signal cannot receive a fill from prices seen before receipt. The resumable 50-calendar-day profile load warms indicators while entries are paused; it never creates historical paper P&L. Starting after the opening decision blocks new entries for that session unless a completed selection was already persisted. No afternoon reconstruction of the morning is permitted. Reference checks refresh before the next session. A missing otherwise-qualified opening quote or eligible first-bar candidate, missing selected-stock bar, >90-second candle delay or >30-second quote interruption blocks entries for that day, while exits continue at fresh available quotes.

Quotes are sampled approximately every five seconds plus request latency. Buys use observed ask plus 5bp, sells observed bid minus 5bp. This is sampled quote paper execution, not a tick-perfect exchange simulation: touches between polls, order latency, queueing and partial fills cannot be established. Top-of-book depth shortages are flagged and full fills are explicitly unproven. Empty/crossed/stale books are rejected. Stops use the next available executable bid (including adverse gaps), not an invented trigger-price fill. There is no intrabar OHLC collision guess in quote mode. If quotes disappear at 15:15, a paper position remains open and stale until a valid exit quote, potentially the next day.

The fee model is the frozen conservative research schedule, not verified account-specific billing. Paper equity is cash plus positions marked at observed bid; open P&L deducts entry fees but not future exit charges. Daily net P&L reconciles realized P&L plus the change in open P&L. Daily peak drawdown is based on observations, so unobserved market excursions are unknown. Exchange holidays/special sessions are excluded; early-January warmup can be insufficient because the calendar reference currently covers only the current year. New constituents need sufficient complete sessions before qualifying.

## Isolated installation

Install only the `research/gap_paper` Python package and JSON configuration under `/opt/nserank-gap-paper`. Use the `nserank-gap-paper.service` unit with its dedicated `nserank-paper` user and `/var/lib/nserank-gap-paper` data directory. It runs on loopback port 8791, with restricted filesystem access and no access to `/root/fib-bot`. The environment file `/etc/nserank-gap-paper.env` must be root-owned mode 600 and contain `UPSTOX_ANALYTICS_TOKEN` and a random `GAP_PAPER_HTTP_SECRET` of at least 32 characters. Never include these in Git, reports, logs or bundles.

The authenticated paper HTTP API offers only GET `/state?day=YYYY-MM-DD`, GET `/health`, and POST `/control` with pause/resume/reset. Reset requires the literal confirmation and refuses open positions. Pause prevents entries while preserving exits. Manual resume cannot override a data-health or daily-loss halt. Reset archives the old account in the ledger and starts a paused warmup.

Use a separate Tailscale Funnel HTTPS listener on port 8443 forwarding to 8791. Preserve existing HTTPS 443 routes. Configure dashboard server-only `GAP_PAPER_URL` and `GAP_PAPER_HTTP_SECRET`; the browser/mobile never receive this secret or the analytics credential. Existing dashboard PIN/session authentication still applies. Mobile is view-only. Opening either UI never starts an observer.

## Persistence, audit and recovery

`paper.sqlite` contains transactional snapshots, full normalized event journal, saved reference refreshes, day records, and reconciled daily totals. Raw provider responses and daily reference files live alongside it. Bootstrap observations are marked and excluded from performance. Repeated identical events are idempotent; conflicting duplicates fail. Restart preserves account, pause state and journal. After downtime do not synthesize missed fills. Review stale positions and feed diagnostics; service exits only on subsequent valid quotes.

Back up with SQLite's online backup API (copying only the live main file can omit WAL changes) plus the reference/raw-response directories. Restrict backup permissions as the database contains paper-account history. To stop only paper observation, stop `nserank-gap-paper.service`; do not stop or restart any other service. Check heartbeat, last quote, last completed candle and entry-halt status before relying on the UI.

## Verification

Run `python3 -m unittest discover -s research/gap_paper -t .`, `npm run build`, and the authenticated UI checks in `test_dashboard.mjs`. Mobile requires TypeScript/tests and an Android export before OTA. Verify original trading service MainPIDs are unchanged after deployment. Activation status and exact release evidence are recorded in `LIVE_ROLLOUT.md` after installation.

Primary reference: https://upstox.com/developer/api-documentation/instruments/ (suspended instruments require segment and instrument-type matching).

## Whole-NSE discovery and preparation

The NSE EQUITY_L.csv is refreshed daily and matched by ISIN/series. Discovery includes restricted series with exclusion reasons; entry eligibility remains NORMAL/EQ, lot size one, non-suspended shares. Unmatched instruments and unavailable quotes are counted explicitly. Full quote batches contain 200 keys and run every 60 seconds during the session. The five-stock limit applies only to the frozen V1 watchlist, not the scanner.

Profiles retain raw monthly five-minute responses, corporate-action responses and the state used for the next session. Current-day completed candles are collected using the intraday endpoint after 15:45; a historical request alone can still end yesterday. Overlapping candles must agree. Recent historical responses refresh hourly to avoid caching provider publication delays forever. Every eligible profile must cover the prior regular session completely (75 bars), have 20 complete sessions for liquidity and an action check less than 18 hours old. Incomplete profiles retry after an hour. Unknown history stays visible but cannot qualify. The implementation uses a traded-value proxy, not official exchange turnover.

The opening full-market snapshot begins at 09:20. All verified candidates receive a first-candle check before the engine ranks five; a result arriving more than 90 seconds after close is rejected. If the candidate set exceeds what can be fetched within that deadline, the day is skipped, not reconstructed. Bulk history preparation pauses 08:50–11:05. Per-API rolling gates cap this service at 5 requests/second, 450/minute and 1,800/30 minutes, below the provider limits. Eight workers check the opening candidate candles concurrently, retaining every candidate and the same deadline. Historical and quote budgets are separate so background history cannot starve quote exits. Other applications sharing the credential are outside these gates. Authentication failure stops bulk preparation with an explicit status.

Quote source clocks may lead local receipt by at most two seconds; larger skew is rejected. Entry additionally requires the quote request to start after the signal was received, preventing a pre-signal request from authorizing a fill. Both source and request/receipt times are retained. These safeguards are covered by causal tests.

References: [NSE equity list](https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv), [Upstox full quotes](https://upstox.com/developer/api-documentation/get-full-market-quote-v3/), [current-day candles](https://upstox.com/developer/api-documentation/v3/get-intra-day-candle-data/), [rate limits](https://upstox.com/developer/api-documentation/rate-limiting/).
