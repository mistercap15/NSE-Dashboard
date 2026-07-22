"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import { SECTORS } from "../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Swing-Low screener — F&O stocks sitting at a proven support floor while
// oversold, ranked by a reward:risk-aware conviction score. Scan is heavy
// (~180 stocks), so it's an explicit button backed by a same-day server cache.
// ─────────────────────────────────────────────────────────────────────────────

const fmtINR = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

const gradeColor = (g) =>
  g === "A+" ? "text-green" : g === "A" ? "text-accent" : g === "B" ? "text-amber" : "text-dim";

const inputCls =
  "bg-card border border-border rounded-lg px-3 py-2 font-mono text-xs text-text " +
  "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 transition-colors";

function FloorCell({ floor }) {
  if (!floor) return <span className="text-muted">—</span>;
  return (
    <div className="leading-tight">
      <div className="font-mono text-[12px] text-text">{fmtINR(floor.low)}–{fmtINR(floor.high)}</div>
      <div className="font-mono text-[9px] text-dim">{floor.touches}× touched</div>
    </div>
  );
}

function Row({ s, expanded, onToggle }) {
  return (
    <>
      <tr className="table-row cursor-pointer" onClick={onToggle}>
        <td className="py-2.5 px-3 font-mono text-[13px] font-medium text-accent">{s.symbol}</td>
        <td className="py-2.5 px-3 font-body text-[12px] text-dim">{s.sector}</td>
        <td className="py-2.5 px-3 font-mono text-[12px] text-right text-text">{fmtINR(s.price)}</td>
        <td className="py-2.5 px-3 text-right"><FloorCell floor={s.floor} /></td>
        <td className="py-2.5 px-3 font-mono text-[12px] text-right">
          <span className={s.inZone ? "text-green" : "text-soft"}>
            {s.distToFloorPct != null ? `${s.distToFloorPct > 0 ? "+" : ""}${s.distToFloorPct}%` : "—"}
          </span>
        </td>
        <td className="py-2.5 px-3 font-mono text-[12px] text-right">
          <span className={s.rsi == null ? "text-muted" : s.rsi <= 35 ? "text-green" : s.rsi <= 50 ? "text-amber" : "text-dim"}>
            {s.rsi ?? "—"}
          </span>
        </td>
        <td className="py-2.5 px-3 font-mono text-[12px] text-right text-red">{s.drawdownFromHighPct}%</td>
        <td className="py-2.5 px-3 text-right">
          {s.bounceSamples >= 2 ? (
            <div className="leading-tight">
              <div className="font-mono text-[12px] text-green">{Math.round(s.bounceRate * 100)}%</div>
              <div className="font-mono text-[9px] text-dim">avg +{s.bounceAvgPct}% · n{s.bounceSamples}</div>
            </div>
          ) : <span className="font-mono text-[11px] text-muted">n{s.bounceSamples || 0}</span>}
        </td>
        <td className="py-2.5 px-3 text-right">
          <div className="leading-tight">
            <div className={`font-mono text-[12px] font-semibold ${(s.rr?.ratio ?? 0) >= 2 ? "text-green" : (s.rr?.ratio ?? 0) >= 1 ? "text-amber" : "text-dim"}`}>
              {s.rr?.ratio != null ? `${s.rr.ratio}:1` : "—"}
            </div>
            <div className="font-mono text-[9px] text-dim">+{s.rr?.upsidePct}% / −{s.rr?.downsidePct}%</div>
          </div>
        </td>
        <td className="py-2.5 px-3 font-mono text-[12px] text-right">
          {s.seasonalWR != null
            ? <span className={s.inSeason ? "text-green" : "text-dim"}>{s.seasonalWR}%</span>
            : <span className="text-muted">—</span>}
        </td>
        <td className="py-2.5 px-3 font-mono text-[12px] text-right text-soft">{s.score}</td>
        <td className={`py-2.5 px-3 font-mono text-[13px] font-bold text-center ${gradeColor(s.grade)}`}>{s.grade}</td>
      </tr>
      {expanded && (
        <tr className="bg-black/10">
          <td colSpan={11} className="px-5 py-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">Why it qualifies</div>
                <ul className="space-y-1">
                  {s.reasons.map((r, i) => (
                    <li key={i} className="font-mono text-[11px] text-soft flex gap-2">
                      <span className="text-accent">›</span>{r}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="font-mono text-[11px] text-dim space-y-1">
                <div className="text-dim uppercase tracking-widest text-[10px] mb-2">Trade math</div>
                <div>Entry (last close): <span className="text-text">{fmtINR(s.price)}</span></div>
                <div>Recovery target: <span className="text-green">{fmtINR(s.rr?.target)}</span> (+{s.rr?.upsidePct}%)</div>
                <div>Stop (under floor): <span className="text-red">{fmtINR(s.rr?.stop)}</span> (−{s.rr?.downsidePct}%)</div>
                <div>200-DMA: <span className="text-soft">{s.ma200 ? fmtINR(s.ma200) : "—"}</span></div>
                <div className="pt-1 text-[10px] text-muted">
                  Score {s.score}: floor {s.components.floor} · oversold {s.components.oversold} · R:R {s.components.rewardRisk} · seasonality {s.components.seasonality}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Table({ rows, expanded, setExpanded, emptyLabel }) {
  if (!rows.length) return <div className="text-dim font-mono text-sm p-8 text-center">{emptyLabel}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left  py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Stock</th>
            <th className="text-left  py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Sector</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Price</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Support floor</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Dist</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">RSI</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Off high</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Bounce</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">R:R</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Season</th>
            <th className="text-right py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Score</th>
            <th className="text-center py-2.5 px-3 font-mono text-[11px] text-dim font-normal">Grade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <Row key={s.symbol} s={s} expanded={expanded === s.symbol}
              onToggle={() => setExpanded(expanded === s.symbol ? null : s.symbol)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SwingLowPage() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [expanded, setExpanded] = useState(null);

  const [upstoxReady,  setUpstoxReady]  = useState(false);
  const [tokenExpired, setTokenExpired] = useState(false);

  // Filters
  const [sector,        setSector]        = useState("ALL");
  const [minRR,         setMinRR]         = useState(0);
  const [minTouches,    setMinTouches]    = useState(2);
  const [inSeasonOnly,  setInSeasonOnly]  = useState(false);

  useEffect(() => {
    fetch("/api/upstox/status").then((r) => r.json())
      .then((d) => { setUpstoxReady(!!d.connected); setTokenExpired(!!d.expired); })
      .catch(() => setUpstoxReady(false));
  }, []);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/swing-low");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const applyFilters = (rows) =>
    (rows || []).filter((s) =>
      (sector === "ALL" || s.sector === sector) &&
      (s.rr?.ratio ?? 0) >= minRR &&
      (s.floor?.touches ?? 0) >= minTouches &&
      (!inSeasonOnly || s.inSeason)
    );

  const at = useMemo(() => applyFilters(data?.atSwingLow), [data, sector, minRR, minTouches, inSeasonOnly]);
  const approaching = useMemo(() => applyFilters(data?.approaching), [data, sector, minRR, minTouches, inSeasonOnly]);

  const avgRR = at.length ? (at.reduce((a, s) => a + (s.rr?.ratio || 0), 0) / at.length).toFixed(2) : "—";
  const inSeasonCount = at.filter((s) => s.inSeason).length;
  const best = at[0];

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">Mean-Reversion</div>
          <h1 className="font-display text-3xl font-bold text-text">
            Swing Low<span className="text-accent">.</span>
          </h1>
          <p className="font-mono text-[11px] text-dim mt-2 max-w-2xl">
            F&O stocks sitting at a <span className="text-soft">proven support floor</span> — a price band they&apos;ve
            repeatedly bounced from — while oversold. Low downside to the floor, room back to the mean.
          </p>
        </div>

        {/* Upstox connection status (prices required) */}
        {tokenExpired ? (
          <div className="mb-6 p-4 rounded-lg border border-red/30 bg-red/5 flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest mb-1 text-red">✕ Upstox Session Expired</div>
              <div className="font-body text-sm text-dim">The scan needs live daily prices. Re-authenticate to run it.</div>
            </div>
            <a href="/api/upstox/login" className="font-mono text-sm px-4 py-2 rounded border border-red/30 bg-red/10 text-red hover:bg-red/20 transition-colors whitespace-nowrap">Re-authenticate →</a>
          </div>
        ) : !upstoxReady ? (
          <div className="mb-6 p-4 rounded-lg border border-amber/20 bg-amber/5 flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest mb-1 text-amber">⚠ Upstox Not Connected</div>
              <div className="font-body text-sm text-dim">This screener is built on Upstox daily OHLC — connect to run the scan.</div>
            </div>
            <a href="/api/upstox/login" className="font-mono text-sm px-4 py-2 rounded border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors whitespace-nowrap">Connect Upstox →</a>
          </div>
        ) : null}

        {/* Scan + filters */}
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={scan}
              disabled={loading}
              className="font-mono text-sm bg-accent/15 border border-accent/30 text-accent px-6 py-2.5 rounded-lg hover:bg-accent/25 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              {loading ? "Scanning…" : data ? "Re-scan" : "Scan F&O universe →"}
            </button>
            {data && (
              <span className="font-mono text-[10px] text-dim">
                {data.scanned}/{data.universeSize} scanned · {data.atSwingLow.length} at floor · {data.approaching.length} approaching
                {data.cached && <span className="text-muted"> · cached</span>}
              </span>
            )}
          </div>

          {data && (
            <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="block">
                <span className="font-mono text-[9px] text-dim uppercase tracking-widest">Sector</span>
                <select value={sector} onChange={(e) => setSector(e.target.value)} className={`${inputCls} w-full mt-1 cursor-pointer`}>
                  {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-[9px] text-dim uppercase tracking-widest">Min R:R</span>
                <select value={minRR} onChange={(e) => setMinRR(Number(e.target.value))} className={`${inputCls} w-full mt-1 cursor-pointer`}>
                  {[0, 1, 1.5, 2, 3].map((v) => <option key={v} value={v}>{v === 0 ? "Any" : `${v}:1+`}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-[9px] text-dim uppercase tracking-widest">Min floor touches</span>
                <select value={minTouches} onChange={(e) => setMinTouches(Number(e.target.value))} className={`${inputCls} w-full mt-1 cursor-pointer`}>
                  {[2, 3, 4].map((v) => <option key={v} value={v}>{v}×+</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 mt-5 cursor-pointer">
                <input type="checkbox" checked={inSeasonOnly} onChange={(e) => setInSeasonOnly(e.target.checked)}
                  className="accent-accent w-4 h-4" />
                <span className="font-mono text-[11px] text-soft">Seasonally in-season only</span>
              </label>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex flex-col items-center gap-3 py-14 justify-center">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-sm text-dim">Scanning ~{180} F&O stocks…</span>
            <span className="font-mono text-[10px] text-muted">First scan of the day pulls 3yr of candles; later scans are cached & instant.</span>
          </div>
        )}
        {error && !loading && (
          <div className="text-center py-10 border border-red/20 rounded-lg mb-6">
            <div className="font-mono text-sm text-red mb-1">Scan failed</div>
            <div className="font-mono text-[11px] text-muted">{error}</div>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
              <StatCard label="At swing low" value={at.length} sub="in / at the floor" color="text-green" />
              <StatCard label="Approaching" value={approaching.length} sub="near, not there yet" color="text-amber" />
              <StatCard label="Avg reward:risk" value={`${avgRR}${avgRR === "—" ? "" : ":1"}`} sub="of at-floor set" color="text-accent" />
              <StatCard label="In-season" value={inSeasonCount} sub={`strong in ${data.nextMonthName}`} color="text-text" />
              <StatCard label="Top pick" value={best ? best.symbol : "—"} sub={best ? `${best.grade} · score ${best.score}` : ""} color="text-accent" mono={false} />
            </div>

            {/* At swing low */}
            <div className="bg-card border border-border rounded-lg mb-6 overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green" />
                <h2 className="font-display text-base font-semibold text-text">At swing low</h2>
                <span className="font-mono text-[10px] text-dim">{at.length} stocks · click a row for the trade math</span>
              </div>
              <Table rows={at} expanded={expanded} setExpanded={setExpanded}
                emptyLabel="Nothing at a proven floor right now with these filters — that's normal; wait for dips." />
            </div>

            {/* Approaching */}
            {approaching.length > 0 && (
              <div className="bg-card border border-amber/20 rounded-lg mb-6 overflow-hidden">
                <div className="px-5 py-3 border-b border-amber/20 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-amber" />
                  <h2 className="font-display text-base font-semibold text-text">Approaching a floor</h2>
                  <span className="font-mono text-[10px] text-dim">{approaching.length} stocks · watch for entry</span>
                </div>
                <Table rows={approaching} expanded={expanded} setExpanded={setExpanded} emptyLabel="—" />
              </div>
            )}

            <div className="font-mono text-[10px] text-muted mb-6">
              Floors = clustered multi-year swing lows ({data.lookbackDays}d history). Bounce % = how often price rebounded
              ≥8% within ~2 months of entering the band. Not financial advice — news/results can break any floor.
            </div>
          </>
        )}

        {!data && !loading && !error && (
          <div className="text-center py-16 border border-border rounded-lg">
            <div className="font-mono text-sm text-dim mb-2">Ready to scan</div>
            <div className="font-mono text-[11px] text-muted">Hit “Scan F&O universe” to find stocks at their proven support floors.</div>
          </div>
        )}
      </main>
    </div>
  );
}
