# Retired Trading Features

Retired on 2026-11-01 at the owner's request. The owner reports that the DigitalOcean
droplet was destroyed. Nothing in this archive is an instruction to restart trading.

## What Is Preserved

This is the central, source-only archive for both clients and the locally available
executors. `manifest.json` lists every original project/path, byte size and SHA-256.
`ORIGINS.json` records the source repository revisions for shared dependencies.
All archived source filenames end in `.source`, preventing accidental compilation,
route registration, Python execution or installation as a systemd unit.

| Directory under `source/` | Contents |
| --- | --- |
| `nse-dashboard/` | Original Fib, 5-minute Fib, Crypto Fib and Futures Protection pages; signal APIs; bot status/token-sync proxies; protection inbox worker; strategy libraries; original navigation/middleware; related tests |
| `nse-mobile/` | Original six feature screens, bot/protection components, shared queries/types, original research navigation/root stack and Expo configuration |
| `nifty-executor/` | All locally Git-tracked executor files, Python tests, service definitions, Caddy configuration, README and dry/shadow checklist |
| `crypto-bot/` | Python/Markdown source from the separate local crypto research project; not its session files, market data or logs |

The original source repositories remain available locally. The archive is a frozen
copy, not a new supported execution environment. Shared active libraries and mobile
types/hooks remain in their original projects to avoid unrelated regressions; the
retired route implementations are replaced with inert stubs.

## What Is Disabled

Dashboard navigation no longer lists Futures Protection, Fib Bot, 5-Min Fib or
Crypto Fib. Mobile Research no longer lists them and the root stack has no titled
feature registrations. No replacement marketing or unavailable-feature cards are
shown.

Dashboard middleware redirects these page prefixes to Overview:

- `/fib`, `/fib-5m`, `/crypto-fib`, `/protection` (including tracked/detail pages).

The page modules independently call `notFound()` if middleware is bypassed. These
API prefixes return HTTP 410 with `FEATURE_RETIRED`, before authentication worker
bypasses or any upstream request:

- `/api/fib`, `/api/fib-5m`, `/api/crypto-fib`, `/api/protection`.
- `/api/bot` (both token sync and live status).
- `/api/inside-bar` (the companion executor on the retired server).

Each existing API handler is also an inert 410 stub, so a stale mobile client cannot
forward a broker token to the deleted droplet. Old mobile deep links to the six
screens redirect to Research without mounting their original polling hooks.

General Upstox OAuth, analytics credentials, seasonality, research and sizing are
not removed. Gap Pullback Paper is outside the four requested features and remains
visible; its former droplet-hosted scanner is offline and is not restarted here.

## Previous Architecture

1. Dashboard signal routes fetched market candles and ran the shared Fib engine.
   Hourly and 5-minute Nifty feeds shared the strategy, but used separate executors
   and ownership locks. Crypto used Delta perpetual candles and a testnet executor.
2. Dashboard `/api/bot/sync` verified the trading account and forwarded only that
   account's short-lived Upstox credential to the token receiver. The separate
   `/api/bot/status` proxy exposed read-only executor status, not strategy intent.
3. Executors ran on the droplet under systemd. Order coordination, contract locks,
   kill switches and lifecycle tests are part of the archived executor source.
4. Futures Protection was advisory: the dashboard calculated hedge guidance and a
   separate Python inbox worker monitored explicitly tracked positions. Worker
   SQLite state was server-side; actual put fills could be device-local.
5. Mobile used the dashboard APIs and cached queries. It was not an independent
   background order executor.

Former services were `fib-executor`, `fib-5m-executor`, `fib-ib-executor`,
`crypto-executor`, `fib-token-receiver`, `fib-bot-status`,
`nserank-hedge-inbox` and `nserank-gap-paper`. All were stopped/disabled before
shutdown in the preceding maintenance task. This change does not provision hosts.

## Important Recovery Limits

This archive is NOT a droplet image or a production-state backup. The droplet was
already deleted before this archival request. No claim is made that locally
available source exactly matches its last deployed revision.

Not preserved from the destroyed disk: broker tokens, environment credentials,
open-position ownership/coordination files, live order identifiers, runtime logs,
hedge-inbox SQLite/WAL data, paper scanner runtime state, and any uncommitted code
that existed only on that server. Recover these only from a separately verified
backup or from the broker/exchange, never by inventing state from this source.

Do not restore stale ownership/position files and assume they describe the broker.
Existing orders/positions are unaffected by deleting infrastructure or hiding UI.
Do not clear device storage merely to retire these features; it may contain useful
local fill/history records.

## Configuration And Credential Cleanup

The archive intentionally excludes `.env` credentials, private keys, SQLite files,
Telegram session files, log files and generated market datasets. It includes the
Git-tracked `executor_5m.env.example` template. Literal test credentials in tests
are not production credentials.

Before any future deployment, create fresh credentials in a secret manager and
review the full archived service definitions/READMEs. Relevant former settings:

| Concern | Settings / former environment files |
| --- | --- |
| Dashboard bot proxies | `BOT_ACCOUNT_ID`, `BOT_SYNC_SECRET`, `DROPLET_SYNC_URL`, optional `DROPLET_STATUS_URL` |
| Protection inbox | `HEDGE_INBOX_URL`, `HEDGE_INBOX_SECRET`, `HEDGE_WORKER_SECRET` |
| Executors | `/root/fib-bot/executor.env`, `executor_5m.env`, `ib_executor.env`, `crypto_executor.env`, `receiver.env` |
| Protection worker | `/etc/nserank-hedge-inbox.env`; database directory formerly `/var/lib/nserank-hedge-inbox` |

Old public IPs, Tailscale/Funnel hostnames and URLs in preserved sources are
historical references, NOT valid deployment destinations. Deleted droplet IPs can
be reassigned. Never reuse them without independently verifying host ownership.
Remove obsolete bot/inbox environment values from the hosting settings and revoke
obsolete bot/exchange/notification credentials separately. Keep analytics/OAuth
settings used by the remaining app. This task does not revoke keys or change orders.

## Verification

From the dashboard repository run:

```sh
node scripts/test-retired-trading.mjs
npm test
npm run build
```

From the mobile repository run:

```sh
npm run typecheck
npm test
npx expo export --platform android --output-dir /tmp/nserank-retirement-android
```

The retirement test verifies all source hashes, absent navigation entries,
inert route handlers, segment-boundary matching and deep-link redirects. Do not
run archived executor scripts against live accounts as a validation shortcut.

Mobile UI changes require a compatible Expo update; source changes alone do not
alter an already installed app. Verified project configuration uses preview channel
and app-version runtime 1.0.0. Inspect EAS channel/build state again at release time.
Older builds may retain menu items until they receive the update, but the deployed
dashboard 410 endpoints prevent them from reaching the destroyed droplet.

## Deliberate Restoration Procedure

Restoration is a separate, explicitly authorized project, not a flag toggle.

1. Review `manifest.json`; verify hashes with the retirement test. Recover files
   from `source/<project>/<original path>.source` to a NEW review branch, removing
   only the final `.source` suffix. Do not overwrite the live repositories wholesale.
   Archived navigation/shared queries are historical context; merge feature entries
   into current files instead of replacing unrelated later improvements.
2. Audit dependencies, broker/exchange APIs, instrument mappings, candle semantics,
   trading permissions and time-zone/expiry rules. The saved lockfiles in the source
   repositories and archived package manifests are historical, not freshness claims.
3. Restore/test strategy libraries and API handlers in isolation. Reconcile all
   account positions and pending orders directly with the broker before building
   any replacement execution state.
4. Provision a new host only with explicit approval. Use fresh secrets, verified
   HTTPS destinations and firewall rules. Keep all executor units disabled. Review
   `/root/fib-bot` path assumptions and service hardening in each `.service.source`.
5. Run pure unit/lifecycle tests and the archived dry/shadow checklist first.
   Use paper/testnet mode with no live credentials. Do not run `enable --now` or
   issue test orders against a real-money account as part of restoration testing.
6. Reintroduce retired API handlers, then narrowly remove their middleware blocks.
   Preserve the PIN gate and account-specific token-sync checks. Restore read-only
   status/market-data access before considering order execution.
7. Restore client screens and navigation only after their dependencies work.
   Typecheck/build both clients, validate deep links, deploy the dashboard and publish
   a compatible mobile update. Start no executor merely to make a UI look online.
8. Obtain separate approval for enabling live trading. Recheck kill switches,
   quantity limits, ownership coordination, duplicate-order prevention and monitoring.

## Archive Maintenance

`scripts/archive-trading-features.mjs` records how this snapshot was assembled. Its
exclusive writes intentionally refuse to replace an existing archive. Do not rerun
it to refresh the snapshot from the now-inert route stubs. Add a new dated archive
for a later retirement instead. Keep this archive in Git and in normal off-machine
repository backups; do not rely on the deleted droplet as the backup.
