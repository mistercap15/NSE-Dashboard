# Paper-trade audit — 8 October 2026

The paper ledger recorded zero signals and zero entries on October 6, 7 and through the October 8 audit at approximately 10:45 IST. The UI was not hiding executed trades. Opening selection completed in 24.06, 26.30 and 21.99 seconds respectively.

An in-memory diagnostic replay used each saved session seed and recorded completed-candle events with their actual receipt times. It omitted quotes, created no fills and made no ledger changes. It also produced zero entry signals on all three dates. Evidence: `data/exports/gap_paper/verification/signal-audit-oct8.json`.

| Date | Watched stocks and setup outcome |
| --- | --- |
| October 6 | TRENT and DHAMPURSUG: first pullback ended before two lower closes. RENUKA: pullback fell to/below the open. SMCGLOBAL and TRIVENI: no qualifying closing advance by 10:00. |
| October 7 | MOBIKWIK and PVRINOX: pullback fell to/below the open. PTCIL: first pullback ended early. ESDS: advance timeout. STLNETWORK: entry window ended without a qualifying pullback trigger. |
| October 8 | SENCO: first pullback ended early. IBULLSLTD, ESDS, INDIAGLYCO and SUNDRMFAST: advance timeout. |

## Confirmed defects

1. A fresh one-sided book was classified as missing feed data and blocked the whole account for the day. ESDS at 10:44:26 IST had bid 1426.90/quantity 67,360 and ask 0/quantity 0. This is an untradeable buy, not proof the other stocks' fresh data is missing. The blanket halt could suppress future valid entries, but does not explain the absence of signals in these three recorded sessions.
2. Setup invalidations lived in stock state, while the Paper trades view only listed entry signals and rejected entry attempts. With no signal, it appeared blank instead of explaining the rejected setups.
3. Candle diagnostics listed all original candidates as missing even though only the selected five were intentionally fetched. Those extra names were misleading; the actual halt condition already checked selected names.
4. Quote execution required both sides even to sell an existing long. A valid bid can now support an exit without inventing an ask or permitting a buy.

## Fixes and verification

Classify fresh empty/one-sided depth separately, preserve instrument-level restrictions, retain global halts for genuine feed failures, and show daily selected-stock outcomes in web and mobile. No watchlist replacements, strategy-parameter changes, fabricated trades, retrospective fills, or live exchange calls. Existing day halts remain latched through that session.

60 Python tests pass, including an integration test from qualifying candles to a later paper entry, exit, saved trade and reconciled daily P&L. Additional tests verify stale/missing data still fails closed, a one-sided stock cannot buy, valid bids can exit, historical date selection uses that day's stocks, and follow-up candles use the selected scope. Production trade counts remain zero unless a real future signal qualifies.
