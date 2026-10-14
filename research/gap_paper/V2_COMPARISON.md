# Forward V1 / V2 experiment

Approved change: V2 requires a 0.25% closing advance from the open by 10:00; V1 retains 0.5%. The separate checked-in configurations differ only in strategy version and `advance`. Startup rejects any other difference. Pullback length/proximity, top-five selection, stops, 2R targets, entry deadline, square-off, fees and risk limits are unchanged.

One existing paper-only process polls the market and feeds both ledgers the same normalized completed candles and observed quotes. V1 keeps `/var/lib/nserank-gap-paper/paper.sqlite`; V2 uses `/var/lib/nserank-gap-paper/v2/paper.sqlite`, with a fresh ₹200,000 balance. Neither account borrows cash, risk allowance, positions, signals or P&L from the other. Pause/resume is variant-specific. V2 reset is rejected to preserve experiment identity. Shared feed outages block entries in both; each account's daily loss/capital/position limits are independent. A carried position prevents only that account's new opening selection; both accounts' held symbols remain subscribed for exits.

V2 begins only at the next complete, timely opening selection after activation. Prior indicators may seed it, never historical signals or fills. Starting mid-session shows an awaiting-session state, not a zero-performance comparison. The API reports paired observation days explicitly. Do not compare V1 lifetime P&L with V2's shorter history. The dashboard/mobile show daily entries, closed trades, net P&L, capital return and drawdown side by side, plus variant-specific setups and trade details.

Separate SQLite transactions are journaled with a persisted in-flight marker. An interrupted dual-account write blocks new entries on restart; no automatic replay manufactures missed fills. Common raw data stays in the primary root. Back up BOTH SQLite databases with the online backup API and preserve their raw/reference files. No additional broker poller, exchange endpoint, live service or order integration is introduced.

The broader candidate-screen protocol is in `research/strategy_search/PROTOCOL_2026-10-14.md`. Neither a higher trade count nor an exploratory historical profit authorizes live deployment.

## Activation — 14 October 2026

The paper-only service was updated after 64 backend tests passed. Its protected endpoint confirms distinct account IDs, preserved V1 identity, a fresh ₹200,000 V2 balance, no V2 daily history or positions, and no reconstructed comparison day. The service was market-closed at verification. All three pre-existing live trading service PIDs/states were unchanged. Local evidence: `data/exports/gap_paper/verification/v2-deployment-20261014.json` and `v2-state-20261014.json`.

The historical fixed screen did NOT find a profitable candidate: V2 lost ₹217.24 on 15 trades before the additional cost stress. This exploratory five-stock outcome does not justify live deployment; see `research/strategy_search/REPORT_2026-10-14.md` for all results and limitations.
