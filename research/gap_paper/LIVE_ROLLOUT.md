# Forward paper rollout — 28 September 2026

The user explicitly authorized a separate persistent paper-only droplet service. This supersedes the initial implementation-only activation restriction; frozen V1 numerical strategy parameters and the historical pilot are unchanged.

- Dedicated `nserank-gap-paper.service` installed and enabled; dedicated user and protected data/environment directories. Loopback 8791, separately authenticated HTTPS listener on 8443.
- Existing Nifty hourly, Nifty five-minute and crypto service process IDs remained 1192771, 1192766 and 1279994 respectively. No existing executor was restarted or changed, and no exchange order call was made.
- Initial current Nifty 50 universe: 50 ordinary cash-share identities admitted by official constituents, current broker master, series-specific suspension and corporate-action checks. Strategy liquidity/history/setup eligibility is additional.
- Warmup completed through 28 September 2026 15:30 IST for all 50 observed stocks. Service reports `market_closed`, entries unpaused, no data-health halt, cash/equity ₹200,000, zero trades and no fabricated daily rows. It is waiting for the next regular NSE session.
- Paper account begins at ₹200,000. Historical warmup creates no trades or daily performance. Forward fills use approximately five-second bid/ask sampling with the frozen costs and slippage model; full-size exchange fills are not proven.
- Dashboard: https://nse-dashboard-gamma.vercel.app/research/gap-paper
- Dashboard follow-up PR: https://github.com/mistercap15/NSE-Dashboard/pull/6 (previous PR #5 was already merged).
- Mobile PR: https://github.com/mistercap15/nse-mobile/pull/1
- Android OTA: preview channel, runtime 1.0.0, group `77df8932-868e-41ff-aaae-f8eacf701820`, update `01a0e919-84db-7137-95e7-07a5913d8139`, commit `0c9dc24`.
- OTA: https://expo.dev/accounts/khilanpatel15/projects/nse-mobile/updates/77df8932-868e-41ff-aaae-f8eacf701820

## Checks completed

46 Python engine/data/service tests, 13 authenticated local dashboard checks, existing dashboard tests, production dashboard build, mobile TypeScript, 86 mobile tests and Android bundle export passed. External paper API rejects unauthenticated access with HTTP 403. Authenticated production dashboard API successfully returned the isolated paper account. Mobile OTA publication confirmed compatible runtime/channel. The browser visual check was interrupted by an automatic approval-review timeout; authenticated API and local page-rendering checks succeeded.

Local sanitized evidence: `data/exports/gap_paper/verification/live-service-health.json`, `production-paper-api.json`, and `live-python-tests.log`. Service ledger: `/var/lib/nserank-gap-paper/paper.sqlite` on the droplet; raw responses and references are alongside it. See `OPERATIONS.md` for execution limits, backups and stopping only this paper service.

No full live market session has yet been observed by this service; successful deployment is not evidence of strategy profitability or fill accuracy. First-session signals, quote timing, costs and end-of-day reconciliation still require review after actual forward observations.
