"use client";
import { useState, useEffect, useCallback } from "react";
import { Layers, AlertTriangle, ShieldCheck } from "lucide-react";

const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

// Correlation cell color: red = highly correlated (concentration risk), blue = diversifying.
function corrColor(r) {
  if (r >= 0.999) return "rgba(100,116,139,0.25)";          // self
  if (r >= 0) return `rgba(248,113,113,${0.12 + r * 0.55})`; // positive → red
  return `rgba(77,159,255,${0.12 + Math.abs(r) * 0.45})`;    // negative → blue
}

export default function PortfolioPanel({ symbols }) {
  const [capital, setCapital] = useState(1000000);
  const [riskPct, setRiskPct] = useState(1);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const fetchPortfolio = useCallback(async (cap, risk) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols, capital: cap, riskPct: risk }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }, [symbols]);

  useEffect(() => { fetchPortfolio(capital, riskPct); /* eslint-disable-next-line */ }, []);

  const divColor = (s) => s >= 70 ? "text-green" : s >= 45 ? "text-amber" : "text-red";

  return (
    <div className="animate-fade-in">
      {/* Inputs */}
      <div className="flex items-end gap-4 flex-wrap mb-5">
        <div>
          <label className="block font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Capital</label>
          <input
            type="number" value={capital} min={10000} step={50000}
            onChange={(e) => setCapital(Math.max(10000, Number(e.target.value)))}
            className="bg-bg border border-border rounded-lg px-3 py-1.5 font-mono text-[12px] text-text w-36 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="block font-mono text-[10px] text-dim uppercase tracking-widest mb-1">Risk / trade</label>
          <select value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))}
            className="bg-bg border border-border rounded-lg px-3 py-1.5 font-mono text-[12px] text-dim w-24 focus:border-accent focus:outline-none cursor-pointer">
            {[0.5, 1, 1.5, 2, 3].map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </div>
        <button
          onClick={() => fetchPortfolio(capital, riskPct)}
          className="font-mono text-[11px] px-4 py-2 rounded-lg border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
        >
          Recompute
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-3 py-10 justify-center">
          <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
          <span className="font-mono text-sm text-dim">Sizing positions…</span>
        </div>
      )}
      {error && <div className="bg-red/10 border border-red/20 rounded-lg p-3 font-mono text-[12px] text-red">{error}</div>}

      {!loading && data && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-bg border border-border rounded-lg p-3">
              <div className="font-mono text-[9px] text-dim uppercase tracking-widest mb-1">Diversification</div>
              <div className={`font-display text-xl font-bold ${divColor(data.diversification)}`}>{data.diversification}<span className="text-dim text-sm">/100</span></div>
            </div>
            <div className="bg-bg border border-border rounded-lg p-3">
              <div className="font-mono text-[9px] text-dim uppercase tracking-widest mb-1">Avg correlation</div>
              <div className="font-display text-xl font-bold text-soft">{data.avgCorr}</div>
            </div>
            <div className="bg-bg border border-border rounded-lg p-3">
              <div className="font-mono text-[9px] text-dim uppercase tracking-widest mb-1">Risk budget / trade</div>
              <div className="font-display text-xl font-bold text-amber">{inr(data.riskBudget)}</div>
            </div>
          </div>

          {/* Portfolio risk */}
          {data.risk && (
            <div className="bg-bg border border-border rounded-lg p-4 mb-5">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={13} className="text-accent" />
                <h4 className="font-display text-sm font-semibold text-text">Portfolio Risk</h4>
                <span className="font-mono text-[10px] text-dim">monthly, correlation-adjusted</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="font-mono text-[9px] text-dim uppercase tracking-widest mb-0.5">Exp. return</div>
                  <div className={`font-mono text-[15px] font-semibold ${data.risk.expMonthlyPct >= 0 ? "text-green" : "text-red"}`}>
                    {data.risk.expMonthlyPct >= 0 ? "+" : ""}{data.risk.expMonthlyPct}%
                  </div>
                  <div className="font-mono text-[9px] text-muted">{inr(data.risk.expMonthlyAmount)}/mo</div>
                </div>
                <div>
                  <div className="font-mono text-[9px] text-dim uppercase tracking-widest mb-0.5">Volatility</div>
                  <div className="font-mono text-[15px] font-semibold text-soft">{data.risk.volMonthlyPct}%</div>
                  <div className="font-mono text-[9px] text-muted">{data.risk.volAnnualPct}% annual</div>
                </div>
                <div>
                  <div className="font-mono text-[9px] text-dim uppercase tracking-widest mb-0.5">95% VaR</div>
                  <div className="font-mono text-[15px] font-semibold text-amber">−{data.risk.var95Pct}%</div>
                  <div className="font-mono text-[9px] text-muted">≤ {inr(data.risk.var95Amount)} risk</div>
                </div>
                <div>
                  <div className="font-mono text-[9px] text-dim uppercase tracking-widest mb-0.5">Diversif. benefit</div>
                  <div className="font-mono text-[15px] font-semibold text-accent">−{data.risk.diversificationBenefitPct}%</div>
                  <div className="font-mono text-[9px] text-muted">vol cut vs naive</div>
                </div>
              </div>
              <p className="font-mono text-[9px] text-muted mt-2">
                In a typical bad month you can expect to lose up to <span className="text-amber">{inr(data.risk.var95Amount)}</span> (95% confidence), driven by correlated drawdowns.
              </p>
            </div>
          )}

          {data.excluded?.length > 0 && (
            <div className="font-mono text-[10px] text-muted mb-3">
              Excluded (insufficient history): {data.excluded.join(", ")}
            </div>
          )}

          {/* Flags */}
          <div className="flex flex-col gap-1.5 mb-5">
            {data.flags.map((f, i) => {
              const warn = f.includes("together") || f.includes("concentrated") || f.includes("High average");
              return (
                <div key={i} className={`flex items-start gap-2 font-mono text-[11px] px-3 py-2 rounded-lg border ${
                  warn ? "border-amber/25 bg-amber/5 text-amber" : "border-green/25 bg-green/5 text-green"
                }`}>
                  {warn ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <ShieldCheck size={13} className="mt-0.5 shrink-0" />}
                  <span>{f}</span>
                </div>
              );
            })}
          </div>

          {/* Position sizing */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Layers size={13} className="text-accent" />
              <h4 className="font-display text-sm font-semibold text-text">Position Sizing</h4>
              <span className="font-mono text-[10px] text-dim">inverse-volatility · risk parity</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] min-w-[420px]">
                <thead>
                  <tr className="border-b border-border font-mono text-[10px] text-dim">
                    <th className="text-left py-2 px-2 font-normal">Symbol</th>
                    <th className="text-left py-2 px-2 font-normal">Sector</th>
                    <th className="text-right py-2 px-2 font-normal">Ann. Vol</th>
                    <th className="text-right py-2 px-2 font-normal">Weight</th>
                    <th className="text-right py-2 px-2 font-normal">Allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.symbol} className="border-b border-border/50">
                      <td className="py-2 px-2 font-mono text-accent font-medium">{it.symbol}</td>
                      <td className="py-2 px-2 font-body text-dim text-[11px]">{it.sector}</td>
                      <td className="py-2 px-2 font-mono text-right text-soft">{it.vol}%</td>
                      <td className="py-2 px-2 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <div className="w-12 h-1 rounded-full bg-muted/40 overflow-hidden hidden sm:block">
                            <div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(it.weight * 2.5, 100)}%` }} />
                          </div>
                          <span className="font-mono text-soft tabular-nums">{it.weight}%</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 font-mono text-right text-text">{inr(it.alloc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Correlation matrix */}
          <div>
            <h4 className="font-display text-sm font-semibold text-text mb-2">Correlation Matrix</h4>
            <div className="overflow-x-auto">
              <table className="border-collapse">
                <tbody>
                  <tr>
                    <td className="w-14" />
                    {data.symbols.map(sym => (
                      <td key={sym} className="font-mono text-[8px] text-dim px-0.5 pb-1 align-bottom" style={{ writingMode: "vertical-rl" }}>{sym}</td>
                    ))}
                  </tr>
                  {data.matrix.map((row, i) => (
                    <tr key={i}>
                      <td className="font-mono text-[9px] text-dim pr-1 text-right whitespace-nowrap">{data.symbols[i]}</td>
                      {row.map((r, j) => (
                        <td key={j} className="text-center" style={{ background: corrColor(r), width: 26, height: 22 }}>
                          <span className="font-mono text-[8.5px] text-text/80">{i === j ? "" : r.toFixed(1)}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 mt-2 font-mono text-[9px] text-muted">
              <span className="flex items-center gap-1"><span className="w-3 h-3 inline-block" style={{ background: corrColor(0.8) }} /> correlated (risk)</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 inline-block" style={{ background: corrColor(-0.6) }} /> diversifying</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
