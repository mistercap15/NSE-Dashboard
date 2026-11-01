import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { ApiError, request } from "./client";
import { saveSession } from "./session";
import type {
  AnalysisResponse,
  LevelsResponse,
  UniverseResponse,
  PlaybookResponse,
  BacktestResponse,
  CandlesResponse,
  BotSyncResponse,
  BotTokenStatus,
  CryptoFibResponse,
  EarlyEntryResponse,
  BotStatusResponse,
  MarketRegimeResponse,
  FibSignalResponse,
  EntryPricesResponse,
  QuotesResponse,
  RankingsResponse,
  SessionResponse,
  StrategiesResponse,
  SwingLowResponse,
  UpstoxStatus,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Every server read goes through here. Cache times are set per endpoint by how
// often the underlying data actually moves:
//   • seasonality (rankings, analysis, calendar) — from a monthly snapshot, so
//     it's effectively static within a session.
//   • daily candles (swing-low, sizing entries) — change only after the close.
//   • quotes — live, so short.
// ─────────────────────────────────────────────────────────────────────────────

const MINUTE = 60_000;

export const queryKeys = {
  session: ["session"] as const,
  upstoxStatus: ["upstox", "status"] as const,
  rankings: (month: number, sector: string, top: number) =>
    ["rankings", month, sector, top] as const,
  swingLow: (refresh: boolean) => ["swing-low", refresh] as const,
  entryPrices: (month: number, symbols: string[]) =>
    ["entry-prices", month, symbols.join(",")] as const,
  analysis: (symbol: string, month?: number) => ["analysis", symbol, month ?? null] as const,
  stock: (symbol: string) => ["stock", symbol] as const,
  candles: (symbol: string, days: number) => ["candles", symbol, days] as const,
  quotes: (symbols: string[]) => ["quotes", symbols.join(",")] as const,
  earlyEntry: ["early-entry"] as const,
  universe: ["universe"] as const,
  playbook: (month: number, params: Record<string, number>, top: number) =>
    ["playbook", month, params, top] as const,
  levels: (symbols: string[], month: number | undefined, strategy: string, lots: number) =>
    ["levels", symbols.join(","), month ?? null, strategy, lots] as const,
  backtest: (params: Record<string, unknown>) => ["backtest", params] as const,
  strategies: ["strategies"] as const,
  fibSignal: (underlying: string) => ["fib-signal", underlying] as const,

  fib5mSignal: (underlying: string) => ["fib5m-signal", underlying] as const,


  botStatus: () => ["bot-status"] as const,
  botToken: ["bot", "token-status"] as const,
  cryptoFibSignal: (symbol: string) => ["crypto-fib-signal", symbol] as const,
  marketRegime: ["market-regime"] as const,
};

// ── Auth ────────────────────────────────────────────────────────────────────

interface LoginResult {
  ok: boolean;
  next: string;
  token: string;
}

/** PIN login. The 429 lockout surfaces as ApiError.retryAfter. */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pin: string) => {
      const res = await request<LoginResult>("/api/auth/login", {
        method: "POST",
        body: { pin },
        anonymous: true,
        timeoutMs: 20_000,
      });
      // A backend still on the pre-mobile code accepts the PIN and sets a
      // cookie, but returns no bearer token — which the app can't use. Say so,
      // rather than failing later on a missing Authorization header.
      if (!res.token) {
        throw new ApiError(
          "This server doesn't support app logins yet — deploy the latest backend.",
          501,
        );
      }
      await saveSession(res.token);
      return res;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useSession(enabled = true) {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => request<SessionResponse>("/api/auth/session", { timeoutMs: 15_000 }),
    enabled,
    retry: false,
    staleTime: 5 * MINUTE,
  });
}

// ── Upstox ──────────────────────────────────────────────────────────────────

export function useUpstoxStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.upstoxStatus,
    queryFn: () => request<UpstoxStatus>("/api/upstox/status", { timeoutMs: 15_000 }),
    enabled,
    retry: false,
    // Re-checked on app foreground by the connection banner.
    staleTime: MINUTE,
  });
}

/** Fetches the Upstox authorization URL (state pre-signed by the backend). */
export function useUpstoxAuthUrl() {
  return useMutation({
    mutationFn: () =>
      request<{ url: string }>("/api/upstox/mobile-login", { timeoutMs: 15_000 }),
  });
}

// ── Seasonality / rankings ──────────────────────────────────────────────────

export function useRankings(month: number, sector = "ALL", top = 50) {
  return useQuery({
    queryKey: queryKeys.rankings(month, sector, top),
    queryFn: () =>
      request<RankingsResponse>("/api/rankings", {
        params: { month, sector, top },
        timeoutMs: 45_000,
      }),
    staleTime: 30 * MINUTE,
  });
}

export function useAnalysis(symbol: string | null, month?: number) {
  return useQuery({
    queryKey: queryKeys.analysis(symbol ?? "", month),
    queryFn: () =>
      request<AnalysisResponse>("/api/analysis", {
        params: { symbol, month },
        timeoutMs: 45_000,
      }),
    enabled: Boolean(symbol),
    staleTime: 30 * MINUTE,
  });
}

export function useStock(symbol: string | null) {
  return useQuery({
    queryKey: queryKeys.stock(symbol ?? ""),
    queryFn: () =>
      request<Record<string, unknown>>(`/api/stock/${encodeURIComponent(symbol!)}`, {
        timeoutMs: 45_000,
      }),
    enabled: Boolean(symbol),
    staleTime: 30 * MINUTE,
  });
}

// ── Trade setups ────────────────────────────────────────────────────────────

/**
 * Whole-universe scan. The first call of the day does real work (~180 symbols
 * of daily candles) and the backend caches it until the next close, so this is
 * manual-trigger only — `enabled` is driven by the screen's Scan button.
 */
export function useSwingLow(enabled: boolean, refresh = false) {
  return useQuery({
    queryKey: queryKeys.swingLow(refresh),
    queryFn: () =>
      request<SwingLowResponse>("/api/swing-low", {
        params: refresh ? { refresh: 1 } : undefined,
        timeoutMs: 180_000,
      }),
    enabled,
    retry: false,
    staleTime: 30 * MINUTE,
  });
}

export function useEntryPrices(month: number, symbols: string[], enabled = true) {
  return useQuery({
    queryKey: queryKeys.entryPrices(month, symbols),
    queryFn: () =>
      request<EntryPricesResponse>("/api/sizing/entry-prices", {
        params: { month, symbols: symbols.join(",") },
        timeoutMs: 90_000,
      }),
    enabled: enabled && symbols.length > 0,
    retry: false,
    staleTime: 10 * MINUTE,
  });
}

export function useEarlyEntry(enabled = true) {
  return useQuery({
    queryKey: queryKeys.earlyEntry,
    queryFn: () => request<EarlyEntryResponse>("/api/early-entry", { timeoutMs: 180_000 }),
    enabled,
    retry: false,
    staleTime: 15 * MINUTE,
  });
}

// ── Universe + trade levels ─────────────────────────────────────────────────

/**
 * The full F&O symbol list. Snapshot-derived and effectively static, so it is
 * fetched once and kept for the session — search needs all 181 names, not just
 * whichever ones happen to be in this month's rankings.
 */
export function useUniverse() {
  return useQuery({
    queryKey: queryKeys.universe,
    queryFn: () => request<UniverseResponse>("/api/universe", { timeoutMs: 30_000 }),
    staleTime: 24 * 60 * MINUTE,
    gcTime: 24 * 60 * MINUTE,
  });
}

/**
 * Entry / stop / target from the backend's shared engine. One symbol or many;
 * `strategy` picks which target basis applies (the stop rule is the same
 * either way). Returns seasonality even when Upstox is down.
 */
export function useLevels(
  symbols: string[],
  opts: { month?: number; strategy?: "seasonal" | "reversion"; lots?: number; enabled?: boolean } = {},
) {
  const { month, strategy = "seasonal", lots = 0, enabled = true } = opts;
  return useQuery({
    queryKey: queryKeys.levels(symbols, month, strategy, lots),
    queryFn: () =>
      request<LevelsResponse>("/api/levels", {
        params: { symbols: symbols.join(","), month, strategy, lots: lots || undefined },
        timeoutMs: 120_000,
      }),
    enabled: enabled && symbols.length > 0,
    retry: false,
    staleTime: 10 * MINUTE,
  });
}

/**
 * The month's highest-conviction trades. Heavy on the first call of the day
 * (candles for the shortlist) and cached server-side until the next close.
 */
export function usePlaybook(
  month: number,
  money: {
    capital: number;
    reserve: number;
    avgLotCost: number;
    riskPerTradePct: number;
    maxPortfolioRiskPct: number;
  },
  top = 6,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.playbook(month, money, top),
    queryFn: () =>
      request<PlaybookResponse>("/api/playbook", {
        params: { month, ...money, top },
        timeoutMs: 240_000,
      }),
    enabled,
    retry: false,
    staleTime: 15 * MINUTE,
  });
}

// ── Market data ─────────────────────────────────────────────────────────────

export function useCandles(symbol: string | null, days = 260) {
  return useQuery({
    queryKey: queryKeys.candles(symbol ?? "", days),
    queryFn: () =>
      request<CandlesResponse>("/api/upstox/candles", {
        params: { symbol, days },
        timeoutMs: 45_000,
      }),
    enabled: Boolean(symbol),
    retry: false,
    staleTime: 30 * MINUTE,
  });
}

export function useQuotes(symbols: string[], enabled = true) {
  return useQuery({
    queryKey: queryKeys.quotes(symbols),
    queryFn: () =>
      request<QuotesResponse>("/api/upstox/quotes", {
        params: { symbols: symbols.join(",") },
        timeoutMs: 30_000,
      }),
    enabled: enabled && symbols.length > 0,
    retry: false,
    staleTime: MINUTE,
  });
}

// ── Research ────────────────────────────────────────────────────────────────

export function useBacktest(params: Record<string, unknown>, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.backtest(params),
    queryFn: () => request<BacktestResponse>("/api/backtest", { params, timeoutMs: 90_000 }),
    enabled,
    retry: false,
    staleTime: 30 * MINUTE,
  });
}

export function useStrategies(enabled = true) {
  return useQuery({
    queryKey: queryKeys.strategies,
    queryFn: () => request<StrategiesResponse>("/api/strategies", { timeoutMs: 60_000 }),
    enabled,
    retry: false,
    staleTime: 30 * MINUTE,
  });
}

export type QueryOpts<T> = Omit<UseQueryOptions<T>, "queryKey" | "queryFn">;

// ── Fib Bot ─────────────────────────────────────────────────────────────────

/**
 * Live Fibonacci signal for the front-month Nifty future.
 *
 * Polls while mounted because the underlying data is an hourly bar — a new one
 * can only appear once an hour, so a minute's interval is already generous and
 * anything faster would just burn battery. `staleTime` is deliberately short:
 * unlike the seasonality endpoints this answer really does change intraday.
 *
 * Never throws on a disconnected Upstox — the route answers 200 with
 * `tokenValid: false` and a reason, which the screen renders as a Connect
 * prompt rather than an error.
 */
export function useFibSignal(underlying = "NIFTY", enabled = true) {
  return useQuery({
    queryKey: queryKeys.fibSignal(underlying),
    queryFn: () =>
      request<FibSignalResponse>("/api/fib/signal", {
        params: { underlying },
        timeoutMs: 60_000,
      }),
    enabled,
    retry: false,
    staleTime: MINUTE,
    refetchInterval: MINUTE,
  });
}

/**
 * Push the order-capable Upstox token to the bot droplet.
 *
 * A mutation, not a query: it has a side effect on another machine and must only
 * ever run when the button is pressed. The backend verifies the token belongs to
 * the trading account before it forwards anything, and answers with a plain
 * `synced` flag — the token itself is never in the response, so nothing here
 * ever holds it.
 *
 * Invalidates the Upstox status afterwards because a failed sync often means the
 * login lapsed, and the screen decides which button to show from that.
 */
/**
 * Does the droplet hold a live token? Asked of the droplet via the backend, so
 * the app and the web show the same answer — syncing from the dashboard is
 * reflected here without the app having logged in at all.
 */

/**
 * Live swing-Fib signal on a Delta perpetual. Same shape as useFibSignal because
 * it is the same engine — the screens differ only in what they say about the
 * instrument.
 *
 * Crypto trades 24/7, so this keeps polling at all hours rather than idling
 * outside a session.
 */
/**
 * Live swing-Fib signal on 5-minute Nifty futures bars.
 *
 * Same engine and same response shape as useFibSignal — only the candle feed
 * differs — so the screen can reuse FibSignalResponse verbatim.
 *
 * Polls faster than the hourly hook because a 5-minute bar closes twelve times
 * an hour; a one-minute refresh on an hourly signal is generous, on this one it
 * is the minimum that keeps up.
 */
/**
 * What the bots on the droplet actually believe — holding, armed, paused,
 * halted, and who owns the contract claim.
 *
 * Never throws: /api/bot/status always answers 200 with `reachable` and a
 * reason, so a droplet that is rebooting shows as "cannot reach the bots"
 * rather than an error state. retry is off for the same reason — a failure
 * here is information, not something to paper over.
 */
export function useBotStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.botStatus(),
    queryFn: () => request<BotStatusResponse>("/api/bot/status", { timeoutMs: 20_000 }),
    enabled,
    retry: false,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}


export function useFib5mSignal(underlying = "NIFTY", enabled = true) {
  return useQuery({
    queryKey: queryKeys.fib5mSignal(underlying),
    queryFn: () =>
      request<FibSignalResponse>("/api/fib-5m/signal", {
        params: { underlying },
        timeoutMs: 60_000,
      }),
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}


export function useCryptoFibSignal(symbol = "ETH", enabled = true) {
  return useQuery({
    queryKey: queryKeys.cryptoFibSignal(symbol),
    queryFn: () =>
      request<CryptoFibResponse>("/api/crypto-fib/signal", {
        params: { symbol },
        timeoutMs: 60_000,
      }),
    enabled,
    retry: false,
    staleTime: MINUTE,
    refetchInterval: MINUTE,
  });
}

export function useBotTokenStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.botToken,
    queryFn: () => request<BotTokenStatus>("/api/bot/sync", { timeoutMs: 20_000 }),
    enabled,
    retry: false,
    staleTime: 2 * MINUTE,
  });
}

export function useBotSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<BotSyncResponse>("/api/bot/sync", { method: "POST", timeoutMs: 30_000 }),
    // A 4xx here is a real answer ("wrong account", "no login"), not a transport
    // failure, so it arrives as ApiError with the body attached rather than
    // throwing away the reason.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.upstoxStatus });
      qc.invalidateQueries({ queryKey: queryKeys.botToken });
    },
  });
}

// ── Market Mood ─────────────────────────────────────────────────────────────

/**
 * Where the Nifty sits versus its own trailing high — context for reading the
 * seasonal picks, nothing more. It does not feed sizing, conviction or the
 * ranking order on either client.
 *
 * Never throws: /api/market-regime answers 200 even when Upstox is unreachable,
 * carrying regime_label "Unknown" plus an `error` string. retry is off for the
 * same reason as useBotStatus — a failure here is information, not something to
 * paper over with three more round trips on a card that is pure decoration.
 *
 * Daily closes move once a day, so an hour of staleness is free.
 */
export function useMarketRegime(enabled = true) {
  return useQuery({
    queryKey: queryKeys.marketRegime,
    queryFn: () => request<MarketRegimeResponse>("/api/market-regime"),
    enabled,
    retry: false,
    staleTime: 60 * MINUTE,
  });
}
