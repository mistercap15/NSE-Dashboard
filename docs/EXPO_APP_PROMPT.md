# Build Prompt — NSERank Mobile (Expo / React Native)

> Paste this whole document to Claude (or your dev) as the spec for building a mobile app that mirrors the existing **NSERank** web dashboard. It is self-contained.

---

## 0. What you're building

A native mobile app (iOS + Android, via **Expo**) that reproduces the **exact functionality** of the existing NSERank web dashboard — a personal F&O (Futures & Options) seasonality + trading tool for Indian (NSE) stocks. It ranks ~181 F&O stocks by historical monthly seasonal edge and layers on live-price tooling (position sizing, swing-low mean-reversion screener, early-entry scanning) using the Upstox broker API. Single-owner app, gated behind a 6-digit PIN.

**Golden rule: do NOT rebuild the backend or the analytics.** Reuse the existing Next.js API deployed on Vercel (`https://<the-vercel-domain>`). The mobile app is a **native front-end over the same `/api/*` endpoints**. This keeps secrets (Upstox API secret, PIN, JWT secret) and the seasonality dataset server-side, and guarantees the app and web show identical numbers. Only small, additive backend changes are needed (see §4).

---

## 1. Recommended tech stack

- **Expo (SDK 51+)** with **Expo Router** (file-based navigation).
- **NativeWind** (Tailwind for React Native) — the web app is Tailwind with CSS-variable tokens; NativeWind lets you port the exact token/color system 1:1 (see §7).
- **TanStack Query (React Query)** for all server data (caching, refetch, loading/error states).
- **expo-secure-store** for the PIN session JWT.
- **expo-web-browser** + **expo-linking** for the Upstox OAuth flow (deep-link redirect).
- **victory-native (XL, Skia)** or **react-native-gifted-charts** for charts (recharts is web-only — do not use it). Line charts (price history, backtest equity) + simple bars.
- **@expo/vector-icons** (Lucide set via `lucide-react-native`) to match the web icons.
- **react-native-svg** for any custom viz (seasonality heatmap).
- TypeScript recommended (web is JS, but the mobile app is a fresh build — TS is fine and better here).

---

## 2. Data architecture (identical to web — for your understanding)

Three data sources, all already wired in the backend:

1. **`data/universe.json` snapshot** — precomputed **monthly return history** (2009→now) for ~181 F&O symbols. Powers all seasonality analytics (win rate, median, significance, regime). Monthly %, not prices. Server-side only; the app never sees the raw file — it consumes computed results via API.
2. **NSE MCP server** (JSON-RPC) — live monthly ranking data (GOOGLEFINANCE-backed). Backend calls it; slow for whole-universe, so heavy analytics read the snapshot instead.
3. **Upstox API** — live/historical **daily OHLC** + quotes for real price levels. Powers swing-low, sizing entry prices, early-entry, sentiment. Requires OAuth (§3).

> Seasonality = monthly-% snapshot. Anything needing real price levels = Upstox daily candles. The app doesn't need to know which — it just calls the endpoints.

---

## 3. Authentication (critical — read fully)

Two layers, mirroring web: **PIN gate** + **compulsory Upstox connection**.

### 3a. PIN login
- Screen: 6-digit PIN entry (auto-submit on 6th digit).
- `POST /api/auth/login` with `{ pin, next }` → on success sets an `app_session` **JWT**. On web it's an HttpOnly cookie; **for mobile, request the token in the response body** (small backend change, §4) and store it in **expo-secure-store**.
- Send it on every API call as `Authorization: Bearer <jwt>`.
- Brute-force: backend already locks out after 5 wrong attempts (429 with `retryAfter`). Handle the 429 in the UI (show cooldown).
- Session expires at the next **03:30 IST** (tied to Upstox token life). On any `401`, drop the stored token and return to the PIN screen.

### 3b. Upstox OAuth (the part with no shortcut)
There is **no way to reuse the logged-in Upstox mobile app session** — Upstox forbids app-to-app login ("all logins handled by upstox.com; no public endpoint to directly log the customer"). No refresh token exists. So:
- Flow: app opens the Upstox authorization dialog in an in-app browser via `WebBrowser.openAuthSessionAsync(url, redirectUri)`.
- The **redirect URI must point at the backend** (the token exchange needs the API secret, which must never live in the app). Backend exchanges code→token, stores the Upstox token **server-side** (single-owner app), then redirects to the app's **deep link** (e.g. `nserank://upstox/connected`) to signal success.
- Carry the app's return target through Upstox's `state` param (backend already supports `state`/`next`).
- The app itself **never holds the raw Upstox token** — the backend proxies all Upstox calls. The app only holds the PIN-session JWT.
- **Daily reality:** the Upstox token dies ~03:30 IST daily; the user re-taps "Connect Upstox" once a day. On the same phone this is quick (Upstox auto-reads OTP / offers biometric). Make the re-connect prompt friendly (a banner + one tap), exactly like the web's "Connect Upstox" banner.
- `GET /api/upstox/status` → `{ connected, expired }` — poll on app foreground; show the connect banner when not connected.

### 3c. Graceful degradation
Every screen must render **without** Upstox: seasonality, rankings, sizing grades/scores and capital math all work token-free; only live-price columns (entry/target/stop, swing-low prices) show "—" and a "Connect Upstox" banner. The sizing engine and rankings must never hard-depend on Upstox.

---

## 4. Backend changes required (small, additive — do these first)

These are the ONLY backend edits; keep them backward-compatible so web keeps working:
1. **Accept `Authorization: Bearer <jwt>`** in `middleware.js` and the auth check, in addition to the `app_session` cookie (read the header, fall back to cookie).
2. **Return the JWT in the login response body** (`/api/auth/login`) so the mobile app can store it (web ignores the body and uses the cookie).
3. **Upstox callback → app deep link:** when the OAuth `state`/`next` indicates a mobile return (e.g. a `nserank://` scheme), redirect there after storing the token, instead of to a web path.
4. (Optional) A tiny `GET /api/auth/session` returning `{ ok: true }` for the app to validate the token on launch.

Everything else — rankings, swing-low, sizing/entry-prices, analysis, backtest, upstox/candles, upstox/quotes, upstox/status — is consumed **as-is**.

---

## 5. API endpoints the app consumes (contracts)

All under the Vercel base URL. All require `Authorization: Bearer <jwt>` except `/api/auth/login`.

| Endpoint | Method | Returns |
|---|---|---|
| `/api/auth/login` | POST `{pin,next}` | `{ok, next}` + JWT (body, per §4) |
| `/api/auth/logout` | POST | clears session |
| `/api/upstox/login?next=` | GET | 302 → Upstox dialog (open in WebBrowser) |
| `/api/upstox/status` | GET | `{connected, expired}` |
| `/api/rankings?month=<1-12>&sector=ALL&top=50` | GET | `{ top_stocks[], avoid_stocks[], short_candidates[], regime, sentiment, calendar, month, month_name }` |
| `/api/swing-low[?refresh=1]` | GET | `{ atSwingLow[], approaching[], scanned, universeSize, nextMonthName, ... }` (heavy first call/day; cached) |
| `/api/sizing/entry-prices?month=<n>&symbols=A,B,C` | GET | `{ prices: {SYM:{entry, provisional}}, provisionalMonth, year }` |
| `/api/analysis?symbol=SYM` (+ month) | GET | single-stock seasonality + price deep-dive |
| `/api/backtest?...` | GET/POST | backtest metrics over the snapshot |
| `/api/upstox/candles?symbol=SYM&days=N` | GET | `{ candles:[{date,open,high,low,close,volume}], ... }` |
| `/api/upstox/quotes?symbols=A,B` | GET | `{ quotes:{SYM:{ltp,open,high,low,prevClose,...}} }` |
| `/api/stock/[symbol]` | GET | per-symbol data |
| `/api/strategies`, `/api/portfolio` | GET/POST | strategy picks / risk-parity portfolio |

**Per-stock ranking object shape** (in `top_stocks`): `{ symbol, win_rate, avg_return, median_return, best, worst, signal, sector, lot_size, data_points, positive_years, negative_years, score, sig?, trend? }`.

---

## 6. Screens (map every web page → a mobile screen)

Navigation: a **bottom tab bar** for the primary areas + a **stack** for detail screens. Group like the web sidebar (Overview / Seasonality / Trade Setups / Research). Suggested tabs: **Home**, **Rankings**, **Setups** (Sizing + Swing Low + Early Entry via a segmented control or sub-list), **Research** (Analysis + Screener + Sector Rotation + Calendar + Backtest). Login is a modal/root gate.

| Web page | Mobile screen | Must include |
|---|---|---|
| `/login` | PIN gate (root) | 6-box PIN, lockout handling, then Upstox connect |
| `/` Overview | Home | summary, current month, quick links, Upstox status banner |
| `/rankings` | Rankings | month selector, long/short toggle, StatCards row, ranked list; significance ✓/≈, regime + sentiment banners |
| `/sizing` | Sizing | capital/reserve/avg-lot inputs (persist via SecureStore/AsyncStorage), usable-capital math, ranked lots table with Entry/Target/Stop/Average-in, reserve & below-bar sections, thin-month note |
| `/swing-low` | Swing Low | "Scan" button, filters (sector/min-R:R/min-touches/in-season), Prime/Strong/Watch **tier badges**, expandable rows with trade math, ⭐ Prime count |
| `/analysis` | Stock Analysis | search, seasonality heatmap, price chart, best/worst months, lot size |
| `/early-entry` | Early Entry | next-month picks vs live price/support, pre-trade checklist, market sentiment panel |
| `/calendar` | Calendar | seasonal calendar |
| `/sector-rotation` | Sector Rotation | sector view |
| `/screener` | Screener | filterable list |
| `/stock/[symbol]` | Stock detail | per-symbol page (push from any list) |

Reproduce these **shared components** as RN components: `StatCard` (`{label, value, sub, color}`), ranking row, tier badge, signal badge, seasonality heatmap, connection banner, PIN input.

---

## 7. Design system (port the tokens exactly)

The web uses Tailwind with **CSS-variable color tokens**, dark default + light override, and now **plain system fonts** (no custom web fonts — use the platform default sans-serif; numbers are also sans-serif). Define these as a NativeWind theme (or a JS theme object) and support light/dark:

**Dark (default) — RGB:**
`bg 9 14 26` · `surface 14 21 37` · `card 19 29 48` · `border 30 45 69` · `text 226 232 240` · `dim 100 116 139` · `soft 148 163 184` · `muted 51 65 85` · `accent 77 159 255` · `green 34 197 94` · `red 248 113 113` · `amber 252 211 77` · `purple 139 92 246`

**Light overrides — RGB:**
`bg 245 245 240` · `surface 238 238 232` · `card 255 255 255` · `border 212 212 200` · `text 26 26 26` · `dim 102 102 96` · `soft 153 153 144` · `muted 153 153 144` · `accent 29 111 232` · `green 21 128 61` · `red 220 38 38` · `amber 180 83 9` · `purple 109 40 217`

**Conventions to keep:** cards use `card` bg + `border`; positive/up = `green`, negative/down = `red`, warnings/amber tier = `amber`, links/accent = `accent`, dim labels = `dim`/`muted`. Rupees formatted Indian-grouped: `₹${n.toLocaleString("en-IN")}`. Tier badges: Prime = green, Strong = accent, Watch = amber. Grade colors: A+ green, A accent, B amber.

---

## 8. Feature logic reference (lives server-side — for parity checks only)

You consume these via API, but here's what the numbers mean so the UI labels them right:

**Position Sizing** — conviction score 0–100 = win-rate (≤40) + median-return (≤25) + data-years (≤20) + worst-case (≤15). Base lots: ≥82→3 (A+), ≥68→2 (A), ≥55→1 (B), else skip. Hard caps (reduce to 1 lot): years<7, worst≤−10%, or WR<80. Capital: `usable = capital − reserve`, `maxLots = floor(usable/avgLotCost)`, allocate by score desc; overflow → reserve list. Levels from entry (first-trading-day open, or provisional live quote): Target = `entry×(1+median%)`, Stop = `worst×1.2` below entry, Average-in = midpoint of entry & stop (2+ lot plans only).

**Swing Low** — floors = clustered multi-touch swing lows (`touches` = strength); bounce stats = how often price rebounded ≥8% within ~40d of entering the band. Composite score: floor lens 45 (proximity + touches + sample-weighted bounce) + oversold 30 (RSI, below MA50/200, drawdown) + reward:risk 15 (target capped at +30% so crashed names don't show fantasy R:R) + seasonality 10 (next-month WR, min 4 yrs). Confidence **tier**: Prime = proven floor (≥4 touches, ≥2 bounce samples, ≥50% bounce) + R:R≥2 + score≥70; Strong = ≥3 touches, R:R≥1.3, score≥58; else Watch. List sorts by tier then score. Show sample sizes inline (`n=`).

**Rankings** — monthly ranked list + t-test significance (✓ significant / ≈ not) + market regime (risk-on/off + breadth) + real-time sentiment (price action/breadth/spreads/volume/volatility).

---

## 9. Build order (milestones)

1. **Backend tweaks** (§4) — Bearer auth + JWT in body + deep-link callback.
2. **Shell**: Expo Router, NativeWind theme (§7), light/dark, bottom tabs.
3. **Auth**: PIN screen → SecureStore JWT → Upstox OAuth via WebBrowser → status banner + graceful degradation.
4. **Rankings** (validates the data/query/StatCard/list patterns) — use as the template screen.
5. **Swing Low** (scan button, tiers, filters, expandable rows) and **Sizing** (inputs, persistence, level columns).
6. **Analysis / Stock detail** (search + charts + heatmap).
7. **Early Entry, Calendar, Sector Rotation, Screener, Backtest, Home**.
8. Polish: pull-to-refresh, skeletons, offline/again-later states, EAS build for iOS/Android.

---

## 10. Non-negotiables

- Reuse the existing backend; don't duplicate scoring or bundle the dataset.
- Secrets (Upstox secret, PIN, JWT secret) never ship in the app.
- Every screen works without Upstox (prices degrade to "—" + connect banner).
- Numbers must match the web exactly (same endpoints, same source).
- Respect the daily Upstox re-auth; make it one friendly tap.
- Match the color tokens and Indian rupee formatting.
```
