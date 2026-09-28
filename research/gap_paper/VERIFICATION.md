# Verification — 28 September 2026

- `npm run test:gap-paper`: **33 passed**. Covers completed-candle causality, delayed receipt eligibility, frozen ranking, first-pullback failure/expiry, gaps, ambiguous candles, target penetration, missing square-off, shared limits, costs, reconciliation, quote freshness/depth, transactional restart/duplicate cashflows, configuration mismatch, cache isolation and bounded authentication/retry behavior.
- `npm test`: **391 passed**, zero failures across the existing suites. Live DNS checks were skipped by the existing suite without network.
- `npm run build`: **passed**; both `/research/gap-paper` and `/api/research/gap-paper` compiled.
- `npm run test:gap-paper-ui`: **11 passed**, zero failures. Temporary localhost server and synthetic account only: existing authentication, page rendering, same-origin protection, cross-origin rejection, rejection of non-paper actions, reset confirmation, reset account identity, pause/resume and initial storage. The server was stopped and the temporary account removed. This is HTTP/render verification, not a browser screenshot or complete visual/accessibility audit.
- Five final chronological replays completed. Trading engine/config/reference-code SHA-256 values match current files. Flat terminal cash reconciles to initial ₹200,000 plus realized net P&L within floating-point tolerance. Raw input hashes are saved beside outputs.
- Credential-presence scan passed for 98 text code/report/export artifacts using an in-memory comparison; no credential contents emitted. No `.env`, token file, account details or raw authentication response included in research artifacts.
- `git diff --check`: passed before commit.

Detailed logs are saved under `data/exports/gap_paper/verification/`. Read-only quote capability evidence is under `data/exports/gap_paper/capabilities/`. No trading service, order, deployment or persistent recorder was started or changed.

Remaining limitations are deliberate and visible: strict eligibility/action review blocks signals until reference inputs exist; current-survivor data and unverified historical tick/fee assumptions prevent performance certification; forward polling is capped at 60 reviewed members; no market-wide streaming observer was implemented or activated. See `README.md`, `DATA_ACCESS.md`, and `PILOT_REPORT.md`.
