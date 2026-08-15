"use client";
import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import { getCurrentMonth } from "../lib/date";
import { MONTH_FULL } from "../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Playbook — the month's few highest-conviction trades, ready to act on.
//
// Every other page answers a narrower question: /rankings has the seasonal
// edge, /swing-low the structural setup, /early-entry the timing. This is the
// page that says which handful of names all three agree on, what to pay, where
// to stop out, and how many lots that is against real capital.
//
// All scoring is server-side in app/lib/conviction.js and shared with the app,
// so the two clients can never rank the same month differently. This file is
// only presentation.
// ─────────────────────────────────────────────────────────────────────────────

const fmtINR = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const fmtCompact = (n) => {
  const v = Math.abs(n || 0);
  if (v >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return fmtINR(n);
};
const pct = (n, d = 1) => (Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(d)}%` : "—");

const BAND = {
  HIGH: { text: "text-green", bg: "bg-green/10", border: "border-green/40", bar: "bg-green" },
  GOOD: { text: "text-accent", bg: "bg-accent/10", border: "border-accent/40", bar: "bg-accent" },
  FAIR: { text: "text-amber", bg: "bg-amber/10", border: "border-amber/40", bar: "bg-amber" },
  LOW: { text: "text-dim", bg: "bg-muted/10", border: "border-border", bar: "bg-muted" },
};

function ConvictionBars({ components }) {
  const rows = [
    ["Edge", components.edge, "bg-accent"],
    ["Setup", components.structure, "bg-purple"],
    ["Timing", components.timing, "bg-green"],
  ];
  return (
    <div className="space-y-1.5">
      {rows.map(([label, value, bar]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-dim w-12">{label}</span>
          <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
            <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(2, value)}%` }} />
          </div>
          <span className="font-mono text-[10px] text-soft w-6 text-right">{Math.round(value)}</span>
        </div>
      ))}
    </div>
  );
}

function PickCard({ pick, rank }) {
  const [open, setOpen] = useState(false);
  const band = BAND[pick.band] || BAND.LOW;
  const lv = pick.levels;

  return (
    <div className={`rounded-xl border ${band.border} bg-card overflow-hidden`}>
      {/* Conviction stripe down the left edge */}
      <div className="flex">
        <div className={`w-1 ${band.bar}`} />
        <div className="flex-1 min-w-0">
          <button onClick={() => setOpen((o) => !o)} className="w-full text-left p-4 hover:bg-surface/40 transition-colors">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg ${band.bg} border ${band.border} grid place-items-center shrink-0`}>
                <span className={`font-mono text-[13px] font-bold ${band.text}`}>{rank}</span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-lg font-bold text-text">{pick.symbol}</span>
                  <span className={`font-mono text-[9px] px-2 py-0.5 rounded-full border ${band.border} ${band.bg} ${band.text}`}>
                    {pick.band}
                  </span>
                  {pick.sources >= 3 && (
                    <span className="font-mono text-[9px] px-2 py-0.5 rounded-full border border-purple/40 bg-purple/10 text-purple">
                      ★ ALL 3
                    </span>
                  )}
                </div>
                <div className="font-mono text-[10px] text-dim mt-0.5">
                  {pick.sector || "—"} · lot {pick.lotSize?.toLocaleString("en-IN")} ·{" "}
                  {pick.checklist.result.toLowerCase()}
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className={`font-mono text-2xl font-bold ${band.text}`}>
                  {Math.round(pick.conviction)}
                </div>
                <div className="font-mono text-[9px] text-dim tracking-widest">CONVICTION</div>
              </div>
            </div>

            {/* The trade */}
            <div className="grid grid-cols-4 gap-3 mt-4 pt-3 border-t border-border">
              <Level label="Entry" value={lv ? fmtINR(lv.entry.price) : "—"} tone="text-text" />
              <Level
                label="Stop"
                value={lv ? fmtINR(lv.stop.price) : "—"}
                sub={lv ? `−${lv.stop.pct}%` : null}
                tone="text-red"
              />
              <Level
                label="Target"
                value={lv?.target ? fmtINR(lv.target.price) : "—"}
                sub={lv?.target ? pct(lv.target.pct) : null}
                tone="text-green"
              />
              <Level
                label="Lots"
                value={String(pick.lots || 0)}
                sub={pick.lots ? fmtCompact(pick.capitalUsed) : "no capital"}
                tone={pick.lots ? "text-accent" : "text-dim"}
              />
            </div>

            {pick.reasons?.[0] && (
              <div className="flex gap-2 mt-3">
                <span className={`${band.text} text-xs leading-5`}>✦</span>
                <p className="font-body text-[12px] text-soft leading-5">{pick.reasons[0]}</p>
              </div>
            )}

            <div className="font-mono text-[10px] text-dim mt-3">
              {open ? "Hide" : `${pick.reasons.length} reasons · full plan`} {open ? "▲" : "▼"}
            </div>
          </button>

          {open && (
            <div className="px-4 pb-4 border-t border-border pt-3">
              <div className="font-mono text-[10px] text-dim uppercase tracking-widest">Why this trade</div>
              <ul className="mt-2 space-y-1.5">
                {pick.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={band.text}>•</span>
                    <span className="font-body text-[12px] text-soft leading-5">{r}</span>
                  </li>
                ))}
              </ul>

              <div className="grid md:grid-cols-2 gap-6 mt-4">
                <div>
                  <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">
                    Conviction breakdown
                  </div>
                  <ConvictionBars components={pick.components} />
                </div>

                <div className="space-y-1">
                  <Row k="Stop sits under" v={lv ? lv.stop.basis.replace(/_/g, " ").toLowerCase() : "—"} />
                  <Row
                    k="Risk : reward"
                    v={lv?.riskReward != null ? `${lv.riskReward.toFixed(1)}×` : "—"}
                    tone={lv?.riskReward >= 2 ? "text-green" : "text-amber"}
                  />
                  <Row k="Risk at stop" v={pick.lots ? fmtINR(pick.riskAmount) : "—"} tone="text-red" />
                  <Row k="Reward at target" v={pick.lots ? fmtINR(pick.rewardAmount) : "—"} tone="text-green" />
                  {pick.swingLow?.floor && (
                    <Row
                      k="Support floor"
                      v={`${fmtINR(pick.swingLow.floor.low)} · ${pick.swingLow.floor.touches} touches`}
                    />
                  )}
                  <Row
                    k="Pre-trade checks"
                    v={`${pick.checklist.passCount}/${pick.checklist.totalChecks} — ${pick.checklist.result}`}
                  />
                  {pick.seasonality && (
                    <Row
                      k="Seasonality"
                      v={`${pick.seasonality.winRate}% WR · median ${pct(pick.seasonality.medianReturn)} (n=${pick.seasonality.n})`}
                    />
                  )}
                </div>
              </div>

              {pick.lots === 0 && (
                <div className="mt-4 p-3 rounded-lg border border-amber/30 bg-amber/5">
                  <p className="font-mono text-[11px] text-amber">
                    Capital ran out before this one. One lot needs {fmtINR(pick.lotCost)} — raise
                    capital on the Capital page or trade fewer names.
                  </p>
                </div>
              )}

              <a
                href={`/stock/${pick.symbol}`}
                className="inline-block mt-4 font-mono text-[11px] text-accent hover:underline"
              >
                Open {pick.symbol} →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Level({ label, value, sub, tone }) {
  return (
    <div>
      <div className="font-mono text-[9px] text-dim tracking-widest">{label.toUpperCase()}</div>
      <div className={`font-mono text-sm font-bold mt-0.5 ${tone}`}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-dim mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ k, v, tone = "text-text" }) {
  return (
    <div className="flex justify-between items-center gap-3 py-0.5">
      <span className="font-mono text-[11px] text-dim">{k}</span>
      <span className={`font-mono text-[11px] font-semibold ${tone} text-right`}>{v}</span>
    </div>
  );
}

export default function PlaybookPage() {
  const month = getCurrentMonth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Same localStorage keys the Capital page writes.
  const [capital, setCapital] = useState(1500000);
  const [reserve, setReserve] = useState(250000);
  const [avgLotCost, setAvgLotCost] = useState(150000);

  useEffect(() => {
    const c = Number(window.localStorage.getItem("ps.capital"));
    const r = Number(window.localStorage.getItem("ps.reserve"));
    if (Number.isFinite(c) && c > 0) setCapital(c);
    if (Number.isFinite(r) && r >= 0) setReserve(r);
    const a = Number(window.localStorage.getItem("ps.avgLotCost"));
    if (Number.isFinite(a) && a > 0) setAvgLotCost(a);
  }, []);

  const build = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/playbook?month=${month}&capital=${capital}&reserve=${reserve}&avgLotCost=${avgLotCost}&top=6`,
      );
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [month, capital, reserve, avgLotCost]);

  const cap = data?.capital;
  const picks = data?.picks || [];

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-0 md:ml-[200px] flex-1 min-w-0 p-4 md:p-8">
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">
            Playbook · {MONTH_FULL[month - 1]}
          </div>
          <h1 className="font-display text-3xl font-bold text-text">
            Top conviction<span className="text-accent">.</span>
          </h1>
          <p className="font-body text-sm text-dim mt-2 max-w-2xl">
            Where the seasonal edge, the chart and the timing all agree — scored, ranked and sized
            to your capital. One number per trade, and the reasoning behind it.
          </p>
        </div>

        {!data && !loading && (
          <button
            onClick={build}
            className="px-5 py-2.5 rounded-full bg-accent text-bg font-mono text-[12px] font-bold hover:opacity-90 transition-opacity"
          >
            Build my playbook
          </button>
        )}

        {loading && (
          <div className="space-y-3">
            <p className="font-mono text-[11px] text-dim">
              Scoring the shortlist across seasonality, structure and timing…
            </p>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-surface animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg border border-red/30 bg-red/5">
            <p className="font-mono text-[12px] text-red">{error}</p>
          </div>
        )}

        {data?.note && (
          <div className="mb-6 p-4 rounded-lg border border-amber/30 bg-amber/5">
            <p className="font-mono text-[12px] text-amber">{data.note}</p>
          </div>
        )}

        {cap && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <StatCard label="Usable" value={fmtCompact(cap.usable)} sub="capital − reserve" mono />
            <StatCard label="Deployed" value={`${cap.deployedPct}%`} sub={fmtCompact(cap.deployed)} color="text-accent" mono />
            <StatCard label="Exposure" value={fmtCompact(cap.notional)} sub="contract notional" color="text-purple" mono />
            <StatCard label="Risk if all stop" value={fmtINR(cap.totalRisk)} sub={`${cap.riskPctOfCapital}% of capital`} color="text-red" mono />
            <StatCard label="Reward if all hit" value={fmtINR(cap.totalReward)} color="text-green" mono />
          </div>
        )}

        {picks.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-[11px] text-dim uppercase tracking-widest">
                {picks.length} trades to take
              </div>
              <button onClick={build} className="font-mono text-[11px] text-accent hover:underline">
                Rebuild
              </button>
            </div>
            <div className="space-y-3">
              {picks.map((p, i) => (
                <PickCard key={p.symbol} pick={p} rank={i + 1} />
              ))}
            </div>
          </>
        )}

        {data && !picks.length && !data.shortlist && (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">🪙</div>
            <p className="font-body text-sm text-soft">Nothing cleared the bar</p>
            <p className="font-mono text-[11px] text-dim mt-2 max-w-md mx-auto">
              Of {data.considered ?? 0} candidates, none passed every gate this month. That is a
              legitimate answer — sitting out is a position.
            </p>
          </div>
        )}

        {data?.rejected?.length > 0 && (
          <div className="mt-8">
            <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-3">
              Considered but rejected
            </div>
            <div className="rounded-xl border border-border bg-card p-4 space-y-1">
              {data.rejected.slice(0, 10).map((r) => (
                <div key={r.symbol} className="flex gap-3 py-1">
                  <span className="font-mono text-[11px] text-soft font-bold w-24 shrink-0">
                    {r.symbol}
                  </span>
                  <span className="font-mono text-[10px] text-dim">{r.why.join(" · ")}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data?.shortlist?.length > 0 && (
          <div className="mt-8">
            <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-3">
              Seasonal shortlist
            </div>
            <div className="rounded-xl border border-border bg-card p-4 space-y-1">
              {data.shortlist.slice(0, 12).map((s) => (
                <div key={s.symbol} className="flex items-center gap-3 py-1">
                  <span className="font-mono text-[12px] text-text font-bold flex-1">{s.symbol}</span>
                  <span className="font-mono text-[10px] text-dim">edge {s.edge}</span>
                  <span className="font-mono text-[11px] text-green w-16 text-right">
                    {pct(s.medianReturn)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data && (
          <p className="font-mono text-[10px] text-dim mt-8 leading-5 max-w-3xl">
            Conviction blends three independent measurements — the seasonal edge (45%), the
            structural setup (30%) and the entry timing (25%) — and adds a small bonus when more
            than one screener surfaces the same name. It is a ranking of historical evidence, not a
            forecast, and every stop here is a level worth honouring.
          </p>
        )}
      </main>
    </div>
  );
}
