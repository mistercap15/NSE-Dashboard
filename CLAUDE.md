# NSE Dashboard — Project Context

**NSERank** — a personal F&O (Futures & Options) seasonality and trading dashboard for Indian (NSE) stocks. It ranks ~180 F&O stocks by historical monthly seasonal edge, and layers on live-price tooling (position sizing, swing-low mean-reversion, early-entry scanning) using the Upstox broker API. Single-owner app, deployed on Vercel, gated behind a 6-digit PIN.

- **Repo:** github.com/mistercap15/NSE-Dashboard (branch: `master`, auto-deploys to Vercel on push)
- **Owner:** solo user; pushes go **directly to `master`** (no feature branches) unless stated otherwise.
- **Mobile:** a self-contained spec to build an Expo/React-Native version (reusing this backend) lives at [docs/EXPO_APP_PROMPT.md](docs/EXPO_APP_PROMPT.md).

---

## Tech stack

- **Next.js 14.2.5** (App Router, JavaScript — not TypeScript despite `typescript` being a devDep)
- **React 18**, **Tailwind CSS 3.4** (CSS-variable theme tokens), **lucide-react** icons, **recharts** charts
- **next-themes** (dark/light), **@react-pdf/renderer** (PDF reports), **resend** (email), **jose** (auth JWTs)
- Node runtime for API routes; **Edge runtime** for `middleware.js`
- No database. State = a bundled JSON snapshot + cookies + in-memory caches.

---

## Core architecture — three data sources

1. **`data/universe.json`** — precomputed snapshot of **monthly return history** (2009–2026) for ~181 F&O symbols. Built offline by `scripts/build-universe.mjs` (pulls from the MCP server, slow, run monthly). Shape:
   ```
   { generatedAt, minYear, maxYear, symbols:[...], sectors:{SYM:sector},
     lotSize:{SYM:n}, series:{ SYM: { "YYYY-MM": returnPct, ... } } }
   ```
   Loaded server-side via `app/lib/dataset.js` (`loadUniverse()`), built into an in-memory model once per instance. This is the source for all seasonality analytics (win rate, median, significance, regime) — it is **monthly %, not daily prices**.

2. **NSE MCP server** (`https://nse-data-mcp.vercel.app/mcp`, JSON-RPC) — live GOOGLEFINANCE-backed ranking data. Tools: `get_monthly_ranking`, `get_all_rankings`, `get_stock_data`, `get_seasonality_summary`, `get_lot_size`, `get_batch_data`. Called from `app/lib/api.js` and directly in some routes. `result._raw` holds structured data. Per-stock ranking objects carry: `symbol, win_rate, avg_return, median_return, best, worst, signal, sector, lot_size, data_points, positive_years, negative_years, score`.

3. **Upstox API** (`https://api.upstox.com/v2`) — live/historical **daily OHLC** and quotes for actual price levels. Requires OAuth (see Auth). Wrapped in `app/lib/upstox.js`. Historical daily candles power swing-low, sizing entry prices, early-entry technicals, and sentiment.

> **Key distinction:** seasonality/rankings = monthly-% snapshot + MCP. Anything needing real price levels = Upstox daily candles.

---

## Pages (routes) — all under `app/`

| Route | File | Purpose |
|---|---|---|
| `/` | `page.js` | Overview / home |
| `/rankings` | `rankings/page.js` | **Monthly ranked stock list** for a chosen month (from `/api/rankings`). Long + short candidates, significance, regime, sentiment |
| `/backtest` | `backtest/page.js` | Backtest engine over the snapshot |
| `/sizing` | `sizing/page.js` | **Position-sizing engine** — recommends 1/2/3 lots per stock (see below) |
| `/swing-low` | `swing-low/page.js` | **Mean-reversion screener** — stocks at a proven support floor (see below) |
| `/analysis` | `analysis/page.js` | Single-stock deep dive (seasonality + price) |
| `/calendar` | `calendar/page.js` | Seasonal calendar |
| `/sector-rotation` | `sector-rotation/page.js` | Sector rotation view |
| `/early-entry` | `early-entry/page.js` | Scans next-month picks vs live price/support zones; computes market sentiment |
| `/screener` | `screener/page.js` | Filterable screener |
| `/stock/[symbol]` | `stock/[symbol]/page.js` | Per-symbol page |
| `/login` | `login/page.js` | 6-digit PIN gate (no sidebar) |

All pages are `"use client"` and render `<Sidebar />` themselves (the root layout does NOT include the sidebar). Structural template for a data-heavy page: `rankings/page.js` (Sidebar + `<main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">` + controls + `<StatCard>` row + table).

---

## API routes — `app/api/`

| Route | Purpose |
|---|---|
| `rankings/route.js` | Monthly ranked list from MCP `get_monthly_ranking`, enriched with significance (t-test), regime, short candidates, sentiment |
| `analysis/route.js` | Single-stock deep dive |
| `backtest/route.js` | Backtest over snapshot |
| `strategies/route.js` | Strategy/best-pick logic |
| `portfolio/route.js` | `POST {symbols, capital, riskPct}` → risk-parity sizing + correlation (`lib/portfolio.js`) |
| `sizing/entry-prices/route.js` | Batched **entry prices** for /sizing: first-trading-day open (past/current month via candles) or provisional live quote (future month) |
| `swing-low/route.js` | Scans ~180 F&O universe for swing-low setups (see below); in-memory same-day cache |
| `stock/[symbol]/route.js` | Per-symbol data |
| `upstox/login` · `callback` · `status` · `candles` · `quotes` | Upstox OAuth + market data |
| `auth/login` · `auth/logout` | PIN auth (see below) |

---

## Library modules — `app/lib/`

- **`api.js`** — MCP client (`callMCP`), `getMonthlyRanking`, `getSeasonalitySummary`, etc.; signal label/color helpers; `MONTHS`, `MONTH_FULL`, `SECTORS` constants.
- **`dataset.js`** — loads `universe.json` into a model; `loadUniverse()`, `monthReturns(points, month, beforeYear)`, `returnAt()`.
- **`stats.js`** — pure stats: mean/median/stdDev, Student-t significance + CI, backtest metrics (CAGR, Sharpe, Sortino, max drawdown, profit factor), Pearson correlation. `RETURN_SANITY_CAP=150` filters corporate-action artifacts.
- **`upstox.js`** — Upstox OAuth (`getLoginUrl(state)`, `exchangeCodeForToken`), token storage (in-memory + `.upstox_token` file + cookie), `getDailyCandles(key, days)`, `getQuote(key)`, `getBatchQuotes(keys)`, `hasValidToken`, `isTokenExpired`, `setAccessToken`.
- **`instruments.js`** — hardcoded `ISIN_MAP` (symbol→ISIN), `toInstrumentKey(symbol)` → `NSE_EQ|<ISIN>` (fallback `NSE_EQ|SYMBOL`), `WATCHLIST`, futures-key helpers.
- **`instrumentMaster.js`** — **self-healing instrument resolver**. Fetches Upstox's published NSE instrument master (`assets.upstox.com/.../NSE.json.gz`, cached ~12h in-memory), builds `trading_symbol→instrument_key`. `ensureInstrumentMap()` (async, call once per request), `keyFor(symbol)` (sync; master first, `toInstrumentKey` fallback). Used by all live-Upstox routes. Fixed a gap where 34 F&O names weren't in `ISIN_MAP`.
- **`technicals.js`** — `sma`, `findSwingLows`, `computeSupportZones` (MA10/20/50, prev-month low, 52w low, swing lows), `computePriceContext` (momentum, position-in-range, %-from-MA/high), `computeSignalScore`.
- **`swinglow.js`** — pure swing-low engine (see below).
- **`portfolio.js`** — `analyzePortfolio()`: inverse-vol (risk-parity) weights, correlation matrix, diversification score, VaR.
- **`backtest.js`**, **`regime.js`** (market regime/breadth), **`events.js`** (calendar), **`aiSuggest.js`** (rule-based pick suggestions), **`date.js`** (IST-aware `getCurrentMonth/Year`, `getNextMonth`).
- **`auth.js`** — PIN session (jose JWT), cookie names, `nextTokenExpiryMs`/`sessionMaxAge` (03:30 IST boundary), `createSession`/`verifySession`, `safeEqual`, `safeNext`. Edge-safe (no node:crypto).

---

## Feature: Position Sizing (`/sizing`)

Recommends how many lots (1/2/3) to enter per stock, capped by real capital. Pure logic in the page (`scoreStock`, `allocateLots`, `computeLevels`).

- **Conviction score (0–100):** win rate (max 40) + median return (25) + data-years (20) + worst-case (15).
- **Base lots:** score ≥82→3 (A+), ≥68→2 (A), ≥55→1 (B), else skip.
- **Hard risk caps** (reduce only): data-years<7, worst≤−10%, or win_rate<80 → cap at 1 lot.
- **Capital constraint:** `usable = capital − reserve`; `maxLots = floor(usable / avgLotCost)`; allocate by score desc until budget exhausted (partial for the overflow stock; the rest go to a "reserve list").
- **Price levels** from entry (first-trading-day open, or provisional live quote via `/api/sizing/entry-prices`): Target = `entry×(1+median%)`; Stop = `worst×1.2` below entry; Average-in = midpoint of entry & stop (2+ lot plans only).
- Persists `ps.capital`, `ps.reserve`, `ps.avgLotCost` to `localStorage`. Degrades gracefully without Upstox (shows "—" for price columns).

## Feature: Swing Low (`/swing-low`)

Finds F&O stocks at a **proven multi-touch support floor** while oversold — low-risk/high-reward mean-reversion. Engine in `lib/swinglow.js` (pure, unit-tested), orchestrated by `/api/swing-low`.

- Fetches ~3yr daily candles for the whole universe (batched concurrency 10, same-day in-memory cache).
- **`detectFloors`** clusters all swing-low pivots into price bands (`touches` = strength). **`bounceStats`** measures how often price rebounded ≥8% within ~40 days of entering a band. Reward:risk from upside-to-MA200 vs downside-to-floor.
- **Composite score:** floor lens 45 (proximity + touches + bounce rate) + oversold 30 (RSI, below MA50/200, drawdown) + reward:risk 15 + seasonality confirmation 10 (next-month win rate from the snapshot).
- Buckets: "at swing low" and "approaching". Needs Upstox connected.

---

## Authentication (PIN gate) + Upstox access (separate concern)

**These are two unrelated things and must stay that way.** The `upstox_token` cookie used to serve as both the "you may view this app" gate and the "we can call Upstox" credential; because Upstox tokens die at 03:30 IST daily, that forced a login just to look at a chart.

- **Authorisation — `middleware.js`.** Gates every route on the **PIN session only**. Pages without one redirect to `/login?next=…`; API routes get `401 JSON`. This is the only thing making the dashboard private. Public paths: `/login`, `/api/auth/*`, `/api/upstox/login`, `/api/upstox/callback`. **Middleware never checks the Upstox cookie and never redirects to Upstox OAuth** — re-adding that would restore the daily-login requirement and the `/?upstox_error=…` → `/api/upstox/login` redirect loop.
- **Flow:** visit page → no session → `/login` → 6-digit PIN → session set → page loads. No Upstox step.
- **Upstox access — `app/lib/upstox.js`.** `resolveAccessToken()` is the single choke-point every market-data call funnels through. It prefers `UPSTOX_ANALYTICS_TOKEN` (long-lived, read-only, market-data-only, works from any IP) and falls back to the per-request OAuth token when that env var is absent, so local dev and any un-migrated environment behave as before.
- **`isTokenExpired()` only ever describes the OAuth token.** An analytics token is valid for a year, so it never reports expired. This matters: `expired` makes `AuthWatcher.js` bounce every open tab to `/login`, and makes `/api/upstox/status` clear **both** cookies. A 401 on the analytics token is a config error (`ANALYTICS_TOKEN_REJECTED`), not a stale session, and must not set that sticky process-global flag.
- **`/api/upstox/status`** returns `{ connected, expired, source }` where `source` is `"analytics" | "oauth" | null` — UI should name the credential rather than implying a login happened.
- **OAuth is kept, but opt-in.** `/api/upstox/login` + `/callback` still work for the deliberate account login the bot-token sync needs. Nothing forces it.
- **PIN:** plaintext env `APP_PIN`, timing-safe compare, per-IP brute-force lockout (5 wrong → escalating 30s+ lockout, in-memory). Logout via sidebar → `/api/auth/logout`.
- **Gotcha:** v3 `/historical-candle/*` returns 200 even with a garbage bearer — it does not validate the token. v2 `/market-quote/quotes` does 401. So candle-only features can appear to work with a broken token; test credentials against quotes.

---

## Styling / design system

- Tailwind with **CSS-variable tokens** defined in `styles/globals.css` (`:root` dark default, `.light` overrides), mapped to Tailwind names in `tailwind.config.js`.
- Color tokens: `bg, surface, card, border, text, dim, soft, muted, accent, green, red, amber, purple` — always use these, **no hardcoded colors** (light/dark both work).
- Fonts: `font-display` (Cabinet Grotesk), `font-body` (Satoshi), `font-mono` (JetBrains Mono). **Numbers use `font-mono`.**
- Rupees formatted `₹${n.toLocaleString("en-IN")}` (Indian grouping). No shared formatter util — inlined per page.
- Shared components: `Sidebar` (200px fixed rail, collapsible nav groups: Seasonality / Trade Setups / Research + Overview), `StatCard` (`{label, value, sub, color, mono}`), `RankingsTable`, `ShortCandidatesTable`, `SignalBadge`, `SeasonalityHeatmap`, `StockSearch`, `StatCard`, PDF components in `components/pdf/`.

---

## Environment variables (`.env.local`, and Vercel Project Settings)

```
MCP_URL=https://nse-data-mcp.vercel.app/mcp
UPSTOX_API_KEY=...
UPSTOX_API_SECRET=...
UPSTOX_REDIRECT_URI=<prod callback URL>   # 127.0.0.1:3000/api/upstox/callback for local
UPSTOX_ANALYTICS_TOKEN=<1-year read-only token>  # market data, no daily login. NEVER add to next.config.js `env`
APP_PIN=<6-digit pin>                      # app login PIN (plaintext)
AUTH_SECRET=<long random hex>              # signs the session JWT
```
`.env.local` and `.env.example` are gitignored (never committed). **Vercel must have `APP_PIN` + `AUTH_SECRET` set or the live login 500s and locks everyone out** (env changes require a redeploy).

---

## Dev / build / deploy

- `npm run dev` (Next dev), `npm run build`, `npm start`.
- Deploys to **Vercel on push to `master`** — so **run `npm run build` locally before pushing** (a broken build breaks the live deploy).
- No ESLint installed (skipped during Vercel builds — not fatal).
- **Refresh the seasonality snapshot (do this on the 1st of each month):** with Upstox connected, run `npm run refresh-data` — it fetches fresh Upstox daily candles for all ~181 F&O stocks (`scripts/export-backtest-data.mjs`) then regenerates `data/universe.json`'s monthly-return series from them (`scripts/rebuild-universe-from-export.mjs`, 2009+, month-over-month close returns). Then commit `data/universe.json`. Needs a valid Upstox token: `UPSTOX_ACCESS_TOKEN=<token> npm run refresh-data`, or a local `.upstox_token` file (written by logging into the app locally). Seasonality is completed monthly returns, so a monthly refresh is sufficient — it only gains a new data point when a month closes.
- Legacy: `node scripts/build-universe.mjs` rebuilt the snapshot from the MCP/GOOGLEFINANCE feed, but that source had corrupted returns — prefer `npm run refresh-data` (Upstox-sourced) instead.

## Conventions & gotchas

- The `.upstox_token` **file** store is unreliable on Vercel (ephemeral serverless FS) — the `upstox_token` **cookie** is the real source of truth.
- In-memory caches (instrument master, swing-low day cache, rate-limit counters) are **per serverless instance** on Vercel — best-effort, not shared across instances.
- MCP can be slow/rate-limited (live GOOGLEFINANCE); that's why heavy analytics read the offline snapshot instead.
- Upstox needs the **ISIN-based** instrument key; always resolve via `keyFor()` (master) rather than assuming the symbol works.
- Not TypeScript — plain JS with JSX. Match existing file style (comment density, `font-mono` numbers, token colors).
