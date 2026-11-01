export type GapRow = {
  symbol: string; name: string; open: number; previous_close: number; gap: number;
  last_price: number; volume: number; quote_at: string; received_at: string;
  eligibility: string; median_value: number | null; history_sessions: number; gap_basis: string;
};
export type Trade = { symbol: string; qty: number; entry: number; exit?: number; pnl?: number; entry_at: string; exit_at?: string; stop: number; target: number; mark?: number; reason?: string; entry_costs?: Record<string, number>; exit_costs?: Record<string, number> };
export type Setup = { phase?: string; reason?: string; pending?: {trigger: number; stop: number}; proposed_quantity?: number; proposed_target?: number; ema?: number; vwap?: number };
export type PaperComparison = {day:string; paired_day:boolean; started_at:string; accounts:{variant:'v1'|'v2';label:string;observed:boolean;net_pnl:number|null;entries:number|null;closed_trades:number|null;return_fraction:number|null;max_drawdown:number|null}[]};
export type PaperAccount = {
  variant?: 'v1'|'v2'; advance_fraction?: number; comparison?: PaperComparison; variants?: {v2?:PaperAccount};
  session_diagnostics?: {day:string;summary:string;setups:({symbol:string;rank:number;gap:number}&Setup)[];signals:number;entries:number;entry_halted?:boolean;halt_reason?:string;quote_issues:{symbol:string;reason:string}[];last_observation?:string};
  selection?: {day?: string;scope?:string}; session?: string; paused?: boolean; operational_halt?: boolean; halted?: boolean; equity?: number; cash?: number;
  shortlist?: {symbol: string; rank: number; gap: number}[]; stocks?: Record<string,Setup>; positions?: Record<string,Trade>;
  daily?: { net_pnl: number; realized_pnl: number; unrealized_change: number; fees: number; entries: number; closed_trades: number; max_drawdown: number };
  day_records?: { trades?: Trade[]; signals?: {symbol:string;at:string;trigger:number;stop:number}[]; rejections?: {symbol:string;at:string;reason:string}[] };
  service?: { status?: string; heartbeat_age_seconds?: number; entry_halt_reason?: string; entry_halt?: boolean; last_quote_received?: string; last_completed_candle?: string; scan_error?: string };
  scanner?: { day: string; started_at: string; completed_at: string; source: string; requested: number; quoted: number; exchange_listed: number; gap_up: number; in_strategy_range: number; eligible: number; rows: GapRow[]; unavailable: {symbol:string;reason:string}[] };
  preparation?: { total: number; checked: number; ready: number; failed: number; status: string; as_of: string };
};
export const reasonLabel = (reason?: string): string => ({
  advance_timeout: 'Required closing advance not reached by 10:00',
  first_pullback_ended_early: 'First pullback ended before two lower-close candles',
  pullback_below_open: 'Pullback touched or fell below the session open',
  first_pullback_proximity_failed: 'Pullback too far from EMA9 and VWAP',
  sixth_pullback_candle: 'Pullback exceeded five candles',
  no_ask: 'No sell offers — buy unavailable', no_bid: 'No buy bids — sell unavailable',
  empty_book: 'No executable bids or offers', unusable_quote: 'Quote failed data checks',
  eligible: 'Eligible for paper selection', history_pending: 'History check pending', insufficient_complete_history: 'Needs 20 complete sessions',
  corporate_action_quarantine: 'Corporate action — excluded', below_10_crore_liquidity: 'Below ₹10 cr liquidity', outside_1_to_10_percent: 'Outside 1–10% range',
  non_regular_series: 'Restricted trading series', restricted_security_type: 'Restricted security', history_warmup: 'History not ready',
  gap_outside_range: 'Outside 1–10% range', shortlist_limit: 'Outside top five', liquidity: 'Below liquidity requirement',
  missing_candle: 'Candle data missing', pending_expired: 'Entry trigger expired', entry_cutoff: 'Entry window closed',
  missing_prior_session: 'Prior session missing', corporate_action_unresolved: 'Corporate action unresolved',
}[reason || ''] || (reason || '').replaceAll('_',' ') || 'Waiting');
export const stageLabel = (setup?: Setup): string => {
  if (setup?.pending) return 'Trigger armed';
  if (setup?.phase === 'invalid') return reasonLabel(setup.reason);
  return ({selected:'Waiting for advance', advanced:'Watching first pullback', pullback:'Pullback forming', entered:'Paper position opened'}[setup?.phase || ''] || 'Waiting for setup');
};
export const istTime = (value?: string) => value ? new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false})+' IST' : 'Not received';
export const money = (value?: number | null) => value == null ? '—' : '₹'+value.toLocaleString('en-IN',{maximumFractionDigits:2,minimumFractionDigits:2});
