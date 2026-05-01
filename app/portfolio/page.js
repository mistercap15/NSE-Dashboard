"use client";
import { useState } from "react";
import Sidebar from "../components/Sidebar";
import SignalBadge from "../components/SignalBadge";
import { MONTHS } from "../lib/api";

const CURRENT_MONTH = new Date().getMonth() + 1;

const COMMON_LOTS = {
  TITAN:150, HINDUNILVR:300, ASIANPAINT:250, DIVISLAB:100,
  BRITANNIA:125, NESTLEIND:500, POWERGRID:1900, BEL:1425,
  RELIANCE:250, TCS:150, INFY:400, HDFCBANK:550, ICICIBANK:700,
  KOTAKBANK:2000, SBIN:1500, BAJFINANCE:750, SUNPHARMA:350,
  DRREDDY:625, CIPLA:375, ITC:1600, MARUTI:50, TATAMOTORS:2850,
};

function PnlRow({ pos, onRemove }) {
  const notional   = pos.price * pos.lot;
  const bearPnl    = notional * (pos.avgRet * 0.3) / 100;
  const basePnl    = notional * pos.avgRet / 100;
  const bullPnl    = notional * (pos.avgRet * 1.5) / 100;
  const maxLoss    = notional * (-4.0) / 100;

  return (
    <tr className="table-row">
      <td className="py-2.5 px-3 font-mono text-[12px] text-accent">{pos.symbol}</td>
      <td className="py-2.5 px-3 font-mono text-[11px] text-dim">{MONTHS[pos.month-1]}</td>
      <td className="py-2.5 px-3 font-mono text-[11px] text-right">
        ₹{pos.price?.toLocaleString("en-IN")}
      </td>
      <td className="py-2.5 px-3 font-mono text-[11px] text-right text-dim">{pos.lot?.toLocaleString("en-IN")}</td>
      <td className="py-2.5 px-3 font-mono text-[11px] text-right">
        ₹{(notional/100000).toFixed(2)}L
      </td>
      <td className="py-2.5 px-3 font-mono text-[11px] text-right">
        <span className={pos.winRate >= 80 ? "text-green" : pos.winRate >= 60 ? "text-amber" : "text-red"}>
          {pos.winRate}%
        </span>
      </td>
      <td className="py-2.5 px-3 font-mono text-[11px] text-right text-amber">
        {bearPnl >= 0 ? "+" : ""}₹{Math.round(Math.abs(bearPnl)).toLocaleString("en-IN")}
      </td>
      <td className="py-2.5 px-3 font-mono text-[11px] text-right text-green font-medium">
        {basePnl >= 0 ? "+" : ""}₹{Math.round(Math.abs(basePnl)).toLocaleString("en-IN")}
      </td>
      <td className="py-2.5 px-3 font-mono text-[11px] text-right text-accent">
        {bullPnl >= 0 ? "+" : ""}₹{Math.round(Math.abs(bullPnl)).toLocaleString("en-IN")}
      </td>
      <td className="py-2.5 px-3 font-mono text-[11px] text-right text-red">
        -₹{Math.round(Math.abs(maxLoss)).toLocaleString("en-IN")}
      </td>
      <td className="py-2.5 px-3">
        <button onClick={() => onRemove(pos.id)}
          className="font-mono text-[10px] text-muted hover:text-red transition-colors px-1">
          ✕
        </button>
      </td>
    </tr>
  );
}

export default function PortfolioPage() {
  const [positions, setPositions] = useState([]);
  const [form, setForm]  = useState({
    symbol: "", price: "", lot: "", winRate: "", avgRet: "", month: CURRENT_MONTH,
  });

  const addPosition = () => {
    if (!form.symbol || !form.price || !form.lot) return;
    const symbol = form.symbol.toUpperCase();
    const lot    = parseInt(form.lot)    || COMMON_LOTS[symbol] || 100;
    const winRate = parseFloat(form.winRate) || 65;
    const avgRet  = parseFloat(form.avgRet)  || 2.5;

    setPositions(prev => [...prev, {
      id: Date.now(), symbol,
      price: parseFloat(form.price),
      lot, winRate, avgRet,
      month: parseInt(form.month),
    }]);
    setForm({ symbol:"", price:"", lot:"", winRate:"", avgRet:"", month: CURRENT_MONTH });
  };

  const remove = (id) => setPositions(prev => prev.filter(p => p.id !== id));

  const totals = positions.reduce((acc, pos) => {
    const notional = pos.price * pos.lot;
    acc.notional += notional;
    acc.bear     += notional * (pos.avgRet * 0.3)  / 100;
    acc.base     += notional * pos.avgRet           / 100;
    acc.bull     += notional * (pos.avgRet * 1.5)  / 100;
    acc.maxLoss  += notional * 4.0                  / 100;
    return acc;
  }, { notional:0, bear:0, base:0, bull:0, maxLoss:0 });

  const portfolioWinProb = positions.length > 0
    ? positions.reduce((a, p) => a * (p.winRate / 100), 1) * 100
    : 0;

  const fmt = n => n >= 0
    ? `+₹${Math.round(n).toLocaleString("en-IN")}`
    : `-₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="ml-[200px] flex-1 p-8">

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-[11px] text-dim uppercase tracking-widest mb-2">F&O Portfolio</div>
          <h1 className="font-display text-3xl font-bold text-text">
            P&L Calculator<span className="text-accent">.</span>
          </h1>
          <p className="font-body text-sm text-dim mt-1">
            Add your futures positions. Get expected P&L in bear/base/bull scenarios based on real seasonality.
          </p>
        </div>

        {/* Add position form */}
        <div className="bg-card border border-border rounded-lg p-5 mb-6">
          <h2 className="font-display text-sm font-semibold text-text mb-4">Add Position</h2>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {[
              { key:"symbol",  label:"Symbol",    placeholder:"TITAN" },
              { key:"price",   label:"Entry ₹",   placeholder:"4410" },
              { key:"lot",     label:"Lot size",   placeholder:"auto" },
              { key:"winRate", label:"Win Rate %", placeholder:"64.7" },
              { key:"avgRet",  label:"Avg Return %",placeholder:"4.34" },
            ].map(f => (
              <div key={f.key}>
                <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-1">
                  {f.label}
                </label>
                <input
                  value={form[f.key]}
                  onChange={e => {
                    const val = f.key === "symbol" ? e.target.value.toUpperCase() : e.target.value;
                    const updates = { [f.key]: val };
                    // Auto-fill lot size when symbol is typed
                    if (f.key === "symbol" && COMMON_LOTS[val]) {
                      updates.lot = String(COMMON_LOTS[val]);
                    }
                    setForm(prev => ({ ...prev, ...updates }));
                  }}
                  placeholder={f.placeholder}
                  className="w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm text-text placeholder-muted focus:border-accent focus:outline-none transition-colors"
                />
              </div>
            ))}
            <div>
              <label className="font-mono text-[10px] text-dim uppercase tracking-wider block mb-1">Month</label>
              <select
                value={form.month}
                onChange={e => setForm(prev => ({ ...prev, month: e.target.value }))}
                className="w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm text-text focus:border-accent focus:outline-none transition-colors"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i+1}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button onClick={addPosition}
              className="font-mono text-sm bg-accent/15 border border-accent/30 text-accent px-5 py-2 rounded hover:bg-accent/25 transition-colors">
              Add Position
            </button>
            <span className="font-mono text-[10px] text-muted">
              Tip: Win Rate and Avg Return auto-fill from Rankings page data
            </span>
          </div>
        </div>

        {/* Portfolio summary */}
        {positions.length > 0 && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
              {[
                { label: "Total notional", value: `₹${(totals.notional/100000).toFixed(2)}L`, color: "text-text" },
                { label: "Bear case",      value: fmt(totals.bear),  color: "text-amber" },
                { label: "Base case",      value: fmt(totals.base),  color: "text-green" },
                { label: "Bull case",      value: fmt(totals.bull),  color: "text-accent" },
                { label: "All-profit prob",value: `${portfolioWinProb.toFixed(1)}%`, color: portfolioWinProb > 70 ? "text-green" : "text-amber" },
              ].map(s => (
                <div key={s.label} className="bg-card border border-border rounded-lg p-4">
                  <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">{s.label}</div>
                  <div className={`font-mono text-lg font-medium ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Positions table */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h2 className="font-display text-sm font-semibold text-text">
                  {positions.length} Position{positions.length > 1 ? "s" : ""} · Max loss: -₹{Math.round(totals.maxLoss).toLocaleString("en-IN")} (4% SL)
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {["Symbol","Month","Entry","Lot","Notional","Win Rate","Bear","Base","Bull","Max Loss",""].map(h => (
                        <th key={h} className="text-right first:text-left py-2.5 px-3 font-mono text-[11px] text-dim font-normal">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(pos => <PnlRow key={pos.id} pos={pos} onRemove={remove} />)}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border">
                      <td colSpan={4} className="py-2.5 px-3 font-mono text-[11px] text-dim">TOTAL</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-right text-soft">₹{(totals.notional/100000).toFixed(2)}L</td>
                      <td />
                      <td className="py-2.5 px-3 font-mono text-[11px] text-right text-amber font-medium">{fmt(totals.bear)}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-right text-green font-medium">{fmt(totals.base)}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-right text-accent font-medium">{fmt(totals.bull)}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-right text-red">-₹{Math.round(totals.maxLoss).toLocaleString("en-IN")}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}

        {positions.length === 0 && (
          <div className="text-center py-16 border border-border rounded-lg">
            <div className="font-mono text-sm text-dim mb-2">No positions added yet</div>
            <div className="font-mono text-[11px] text-muted">
              Add a position above to see P&L scenarios
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
