// ── Universe dataset loader (server-side) ────────────────────────────────────
// Reads the precomputed snapshot at data/universe.json (built monthly by
// scripts/build-universe.mjs). The MCP batch endpoint live-fetches GOOGLEFINANCE
// (~30s per 6 symbols), far too slow for request time — so we read the bundled
// snapshot instantly. Returns change only monthly, matching the seasonal cadence.

import { sanitizeReturns } from "./stats";
import snapshot from "../../data/universe.json";

// Build the in-memory model once per server instance.
let _model = null;

function build() {
  if (_model) return _model;
  const { series = {}, sectors = {}, lotSize = {}, minYear, maxYear, symbols = [], generatedAt } = snapshot;

  const model = {};
  for (const sym of Object.keys(series)) {
    const points = [];
    for (const [ym, ret] of Object.entries(series[sym])) {
      const [year, month] = ym.split("-").map(Number);
      points.push({ ym, year, month, ret });
    }
    points.sort((a, b) => a.ym.localeCompare(b.ym));
    model[sym] = { symbol: sym, sector: sectors[sym] || "—", lotSize: lotSize[sym] || null, points };
  }

  _model = {
    symbols: symbols.length ? symbols : Object.keys(model),
    series: model,
    sectors,
    minYear,
    maxYear,
    generatedAt,
  };
  return _model;
}

export function loadUniverse() {
  return build();
}

// All sanitized returns for a given calendar month (1-12), optionally restricted
// to years strictly before `beforeYear` (for lookahead-free backtesting).
export function monthReturns(points, month, beforeYear = Infinity) {
  return sanitizeReturns(points.filter(p => p.month === month && p.year < beforeYear).map(p => p.ret));
}

// Realized return for a specific (year, month), or null if missing.
export function returnAt(points, year, month) {
  const p = points.find(pt => pt.year === year && pt.month === month);
  return p ? p.ret : null;
}
