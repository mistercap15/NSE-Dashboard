// Keep exact segment boundaries so unrelated routes remain available.
export const RETIRED_TRADING_PATHS = [
  '/fib', '/fib-5m', '/crypto-fib', '/protection',
  '/api/fib', '/api/fib-5m', '/api/crypto-fib', '/api/protection',
  '/api/bot', '/api/inside-bar',
  '/research/gap-paper', '/api/research/gap-paper',
];

export function isRetiredTradingPath(pathname) {
  return RETIRED_TRADING_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'));
}
