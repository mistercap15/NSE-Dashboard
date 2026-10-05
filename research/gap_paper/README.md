> Forward paper service rollout: see [OPERATIONS.md](OPERATIONS.md) and [LIVE_ROLLOUT.md](LIVE_ROLLOUT.md). These document the subsequently authorized isolated activation and daily web/mobile views. Original pilot instructions below describe the initial offline implementation.

# Gap and first pullback — local paper research

This is a mechanical adaptation, not a reproduction of Ross Cameron's discretionary trading or a demonstrated edge. **PAPER — NO LIVE ORDERS.** No order client, executor import, service control, Telegram delivery, deployment, or background recorder is included. Existing live systems are independent.

## Implementation and verification

- `engine.py`: pure causal state machine, eligibility/ranking, closed-candle indicators, execution models, cash portfolio and risk limits. Replay and observation use the same `process` function.
- `data.py`: analytics-only environment/`.env.local` loading following the existing historical downloader. Authenticated GETs restricted to Upstox market-data paths; public instrument master separately. Does not import the OAuth helper that can update bot token files. Five bounded retries, 1 request/second, backoff, atomic JSON cache, sanitized errors. Run one downloader/observer at a time; other applications share provider limits.
- `cli.py`: offline replay, resumable download, candidate preparation, opt-in candle observation, recorded-event ingestion, account controls.
- `storage.py`: Python standard-library SQLite, WAL, `BEGIN IMMEDIATE`, atomic complete-event snapshots. Restart retains positions, indicators, pending orders, shortlist, counters, cash, watermark and config/reference hash. Exact duplicate latest event is a no-op; earlier/conflicting events fail. A failed batch rolls back. Reset archives the prior account row. Stop the observer before resetting or changing references.
- `validation.py` and `report.py`: raw-file hashes, coverage anomalies, CSV ledgers and account metrics. No interpolation. No fabricated end-of-sample liquidation.
- `app/research/gap-paper/page.js` and `app/api/research/gap-paper/route.js`: dashboard plus pause/resume and separately confirmed reset. Existing PIN middleware protects both; mutations require same origin. Local Python/SQLite support is opt-in and disabled by default. No observer can be started by the API.
- `test_engine.py`, `test_data.py`: synthetic execution, causality, persistence and data-access failure tests.

No new Python runtime dependencies. Python 3.10+ and the existing Node/Next dependencies are sufficient. SQLite files belong on a persistent local filesystem, not a serverless deployment. Multi-host databases and streaming orchestration are outside this local version.

## Reproduce the research

From the repository root:

```sh
python3 -m unittest discover -s research/gap_paper -t . -v
python3 -m research.gap_paper.cli replay --variant strict --out data/exports/gap_paper/pilot/strict
python3 -m research.gap_paper.cli replay --variant continuity-assumption --out data/exports/gap_paper/pilot/continuity-assumption
python3 -m research.gap_paper.cli replay --variant stress --out data/exports/gap_paper/pilot/stress
python3 -m research.gap_paper.cli replay --variant exclude-ambiguous --out data/exports/gap_paper/pilot/exclude-ambiguous
python3 -m research.gap_paper.cli replay --variant complete-only --out data/exports/gap_paper/pilot/complete-only
python3 -m research.gap_paper.pilot_report
```

Default source: `data/exports/nse_cash_coverage_20260927/raw`. Each variant writes trades, signals, rejections, cashflows, equity curve, event anomalies, daily scans, summary, configuration, universe/calendar copies, data validation, input-file hashes and research-code hashes. Outputs are deliberately ignored by Git; keep them with the source commit for reproducibility. The earlier reported 41-trade pilot was not treated as a target or reproduced; this implementation applies the newly frozen V1 rules and does not reconcile that earlier trade list.

Strict is the default. Continuity assumes missing corporate-action factors equal one and historical tick size ₹0.05; it is **exploratory, unverified economic-gap evidence**. `exclude-ambiguous` is an **ex-post data-ambiguity diagnostic, not an executable strategy**: its favorable result cannot justify filtering live trades by a future candle's low. `complete-only` excludes all dates with any missing sample-stock bar. Parameters are not optimized. 2022–2026 have already been examined; no untouched out-of-sample claim.

## Reference contracts

A reviewed manifest is JSON:

```json
{
  "label": "date-effective reviewed universe; describe source and limitations",
  "members": [{
    "symbol": "RELIANCE", "key": "NSE_EQ|INE002A01018",
    "from": "2026-07-01", "to": "2026-10-31", "segment": "NSE_EQ",
    "ordinary_share": true, "eligible": true, "suspended": false,
    "tick_size": 0.1, "metadata_basis": "replace with verified dated source"
  }],
  "comparable": {"RELIANCE": {"2026-09-28": 1.0}}
}
```

**Example values are not an approved universe or tick-size assertion.** Each regular symbol-date needs a reviewed factor: 1 means no adjustment needed; another positive factor scales the previous close and EMA into current units. Unknown/invalid factors quarantine the day and reset warmup. Preserve the evidence for each factor. Do not label an adjusted historical series as raw without verification. Manifest dates must include warmup history; non-overlapping member records support identity/tick changes. A changed instrument identity resets history. Unknown share type, suspension or eligibility excludes the member.

Calendar JSON maps actual exchange dates to `"regular"` or `"special"`; unknown dates cannot create setups. Supply an authoritative regular-session calendar including warmup and the intended future observation period. The pilot's calendar, inferred from observed daily candles with known special sessions excluded, is not independently certified. Full shared missing sessions may be invisible to it. An incomplete prior session restarts the 20-session history, a deliberately stricter exclusion. Config/manifest/calendar hash changes require an explicit new account; this prototype does not hot-apply reference corrections into an existing paper ledger.

## Prepare a broader replay before downloading

```sh
python3 -m research.gap_paper.cli prepare-universe --out data/exports/gap_paper/broad_universe
python3 -m research.gap_paper.cli download-plan --manifest /absolute/reviewed_manifest.json --calendar /absolute/calendar.json --from-date 2022-01-01 --to-date 2026-09-25 --out data/exports/gap_paper/broad_raw
# Only after reviewing eligibility, history bias and the request estimate:
python3 -m research.gap_paper.cli download --manifest /absolute/reviewed_manifest.json --calendar /absolute/calendar.json --from-date 2022-01-01 --to-date 2026-09-25 --out data/exports/gap_paper/broad_raw
python3 -m research.gap_paper.cli replay --raw data/exports/gap_paper/broad_raw --manifest /absolute/reviewed_manifest.json --calendar /absolute/calendar.json --out data/exports/gap_paper/broad_strict
```

`prepare-universe` saves review candidates, **none eligible automatically**. EQ alone does not prove ordinary shares. Verify ETF/other-type exclusions and the provider's suspended list, historical identity/tick changes, comparable closes and membership dates. Current master is a current-survivor sample, not historical membership. Download windows are clipped to each member's validity; filenames include key hash and dates. Cache is resumed in the same output folder, empty successful responses remain explicit, auth failure stops. To reuse a previous HTTP cache, keep that output directory; never overwrite a research package with different references. Monthly five-minute requests: 57 per stock for Jan 2022–Sep 2026, 5,700 for 100 stocks (~95 minutes minimum at this client's pacing, excluding latency/retries). The 2,680 unreviewed candidates would imply up to 152,760 requests; that bulk download was not run. No subscription purchase.

## Begin paper observation — manual, after review

1. Supply the reviewed manifest and calendar described above, including at least 20 complete prior sessions and corporate-action review. Choose a manageable universe (maximum 60 rows for the polling observer). A broader forward scanner needs a batched/streaming adapter; the historical downloader/replay is not capped.
2. Keep the already configured analytics token local; the program reads `UPSTOX_ANALYTICS_TOKEN` from the environment or `.env.local`. Never paste it in a command or chat. Review fees and market-data freshness. Authentication must work before observation.
3. Bootstrap once. This command fetches warmup **paused**, then polls once and exits; it is not a service:

```sh
python3 -m research.gap_paper.cli observe --manifest /absolute/reviewed_manifest.json --calendar /absolute/calendar.json
```

4. Review local status and exclusions. Enable the local dashboard by passing `GAP_PAPER_LOCAL=1`, `GAP_PAPER_MANIFEST=/absolute/reviewed_manifest.json`, `GAP_PAPER_CALENDAR=/absolute/calendar.json` to the dashboard process. Optionally set `GAP_PAPER_DB` (default `data/exports/gap_paper/paper.sqlite`) and `GAP_PAPER_PYTHON`. Start the dashboard locally with the project's normal `npm run dev`, then sign in and open `/research/gap-paper`. These variables only enable paper storage; they do not start observation. No environment file was changed during implementation.
5. Resume paper entries explicitly after reviewing the warmup. Start a **foreground**, manually supervised observation loop with the same command plus `--loop`. Stop it with Ctrl-C. Dashboard pause blocks entries but keeps paper exits active; stopping the observer means no observations/exits until restarted. Missing square-off observations remain delayed and visible. The observer never places exchange orders.

Polling batches over 90 seconds late pause new entries. Actual receipt times are retained. A signal received partway into a candle is not eligible until the next full interval, preventing backward fills. Intraday candle polling is an approximation, not a measured execution feed. Quotes were successfully probed, but no quote streamer/recorder was started. Broad polling latency is a real limitation, hence the explicit 60-member cap.

For separately recorded quote experiments, copy the configuration, set `execution` to `quote`, reset a distinct paper database, and ingest chronological JSON events using `ingest-events --events-json /absolute/events.json --config ... --manifest ... --calendar ... --db ...`. Candles and quote receipts must be strictly ordered, canonical ISO IST timestamps. Quote schema: `{ "kind":"quote", "at":"2026-09-28T09:40:01+05:30", "quote": { "symbol":"RELIANCE", "source_at":"2026-09-28T09:40:00+05:30", "bid":100, "ask":100.05, "bid_size":1000, "ask_size":1000 } }`. Missing/stale/crossed prices reject; full quantity fills remain hypothetical and depth violations are flagged. Do not substitute last-trade time for quote freshness. The REST probe's timestamp alone does not certify exchange-level depth freshness.

No deployment was performed. A later deployment review must provide Python, persistent writable SQLite, one observer process, authentication, retention/backups and a reviewed data universe. Do not reuse or modify existing trading service units.

## Dashboard and mobile viewing

Open **Research → Gap Pullback · Paper** on either client. The dashboard route is `/research/gap-paper`; the native Expo route uses the same path. The historical pilot is visibly separate from the current paper account. The mobile screen is read-only; pause/reset remain on the dashboard. Viewing never starts an observer.

`GET /api/research/gap-paper/pilot` exposes the committed, sanitized pilot snapshot behind the existing session gate; it needs neither Python nor an active observer. `GET /api/research/gap-paper` remains the independently refreshed current-account source. Failed account reads are shown explicitly. Mobile carries an identical dated backend snapshot as an offline/older-server fallback and labels when it is in use; it contains no strategy computation or live account state.

Regenerate both presentation snapshots from the saved replay exports (no new backtest):

```sh
python3 -m research.gap_paper.publish_view --mobile-output ../nse-mobile/assets/data/gapPaperPilot.json
```

Both copies must remain byte-identical. Research assumptions, strict zero-trade results and the ex-post nature of ambiguity exclusion are included. Equity history is sampled at month end and labelled accordingly; the maximum drawdown metric still comes from the complete replay.

These interface changes are local until the dashboard and mobile app updates are published through the project's normal release process. No release or persistent activation is performed by the generator or view.
