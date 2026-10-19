# Advisory inbox and forward evidence

Personal, single-dashboard inbox. No broker account API, order, Telegram or email functionality. A separate Python service runs as `nserank-hedge` on loopback 8792, with its own SQLite directory `/var/lib/nserank-hedge-inbox`. HTTPS is exposed on the existing Tailscale host's **new port 10000**, with a mandatory 256-bit random inbox secret. Existing listeners and trading services are unchanged.

Dashboard users add a watched futures position explicitly. Maximum20 active watches, fixed contract, expiry and actual entry. Stop monitoring is reversible; expired contracts disable without automatic roll. Saved actual PE fills remain device-local and are not monitored in the service; inbox exit messages are conditional guidance for an existing hedge, not assertions that a put is held. It is one private account inbox, not multi-tenant storage.

Worker polls sequentially about every5minutes, including outside market hours for news; slow requests can extend this interval. Uses a separate random `HEDGE_WORKER_SECRET`, accepted **only** for GET `/api/protection`; it cannot access the inbox or any other route. No broker credentials or dashboard PIN are stored on the service. Requests refuse redirects. The production API must be deployed before watches can evaluate; until then a deduplicated data-unavailable alert appears.

Events are created on guidance, conditional exit, sector state, feed availability or headline-set changes. Unchanged price fluctuations do not spam the inbox. First evaluation creates a baseline alert. New/lost headlines can both change a feed set; no claim that every event is newly published. Data-unavailable and recovery transitions are explicit. Read/unread state and watches survive restarts and are shared between dashboard/mobile. Apps refresh the inbox while open; the worker runs without them. No OS push notifications.

Evidence stores timestamps, rule version, source-linked headlines, sector observations, position, marks and four nearby put quotes. Retained up to90days or50,000 snapshots (whichever removes older evidence first); alerts90days. Export/backup SQLite using its online backup API before changing schemas; never copy a live WAL database file alone. Credentials are environment-only, never in evidence or Git. Health state reports last successful scheduler cycle/error. `/state` unauthorized=403.

## Data meaning

Company identity comes from current Upstox master. Google News RSS provides source-linked headlines from the last7days for this personal feed reader; company-name matches, future dates, unsafe URLs and duplicate items are filtered. Feed errors are unknown, not bullish. Publisher headlines are unverified and coverage is incomplete. Event tags are broad lexical review prompts (earnings/regulation etc.), never a claim of negative sentiment or an automatic buy trigger. Official NSE RSS was attempted but timed out in the implementation environment; it is not silently described as the live source.

Sector context samples up to6 alphabetically ordered same-sector members from the existing universe, excluding the selected stock. At least3 with aligned valid completed-day history are required; weak means at least2/3 below both SMA20/50. This is disclosed sampled price breadth, not all-sector breadth or a calibrated sentiment index. Sector weakness can confirm a completed support break, and inhibits hedge-removal review. Recent event-review headlines also inhibit hedge removal pending review. No incomplete daily signal candle is used.

## Validation status and frozen forward protocol

Version `daily-hedge-v2` is now observable, not proven profitable. Unit/integration tests establish code behavior, not predictive edge. Collect actual forward observations before reviewing performance; never label retrospectively tuned periods untouched out-of-sample.

Compare unhedged futures, always-on matched put and tactical hedge over identical watched intervals. For a later replay: signals may fill only at subsequent recorded valid executable quotes, buy at ask/sell at bid, enforce whole lots/depth, deduct then-applicable fees/taxes and sensitivity slippage, track margin/expiry and exclude unobservable fills explicitly. Full intraday gap/margin fidelity and complete option paths are not guaranteed by5minute snapshots. No generated profit estimates should be presented as realized performance. This release records evidence; it does not fabricate paper fills or publish trading returns.

Review after at least60 trading sessions and30 independent hedge episodes, extending the window if sparse. Report drawdown, worst losses, hedge cost, upside retained, turnover, feed coverage and failure rates versus both baselines. These minimum observations do not establish statistical significance. Freeze any next rules version before gathering its forward record. A live decision requires separate review; no automatic deployment from these metrics.

## Operations

Start/stop only `nserank-hedge-inbox.service`. Environment file `/etc/nserank-hedge-inbox.env` is root-owned0600. Dashboard Production variables: `HEDGE_INBOX_URL`, `HEDGE_INBOX_SECRET`, `HEDGE_WORKER_SECRET`. Deploy the app through the PR merge workflow; environment additions alone do not update an existing Vercel deployment. No Preview environment access was added. The service is enabled to survive reboot. Disable public listener with `tailscale funnel --https=10000 off` if retiring it; leave ports443/8443 untouched.

Tests: `python3 research/hedge_inbox/test_service.py`, `node scripts/test-hedge-context.mjs`, `node scripts/test-hedge-advice.mjs`, existing protection tests, Next build, mobile typecheck and Android export. Production authenticated and unauthenticated endpoint checks contain no secrets in their output. At activation all three trading-service PIDs and the gap-paper service PID were unchanged. No watches were seeded on the user's behalf.
