"""Build a concise report from actual saved replay metrics; never invent results."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "data/exports/gap_paper/pilot"


def num(v):
    return "n/a" if v is None else f"{v:,.2f}"


def pct(v):
    return "n/a" if v is None else f"{v*100:.3f}%"


def main():
    names = [
        "strict",
        "continuity-assumption",
        "stress",
        "exclude-ambiguous",
        "complete-only",
    ]
    summaries = {n: json.loads((BASE / n / "summary.json").read_text()) for n in names}
    s = summaries["continuity-assumption"]
    audit = json.loads(
        (BASE / "continuity-assumption/data_validation.json").read_text()
    )
    lines = [
        "# Exploratory five-stock pilot — frozen V1",
        "",
        "The conservative continuity-assumption replay loses after costs. This five-stock run does not establish a profitable strategy or test a market-wide scanner. Strict corporate-action review permits no trades because reviewed comparable closes are absent. The exploratory runs are unverified current-survivor research, not a deployable performance claim.",
        "",
        "| Scenario | Trades | Net P&L ₹ | Account return | Profit factor | Maximum marked DD ₹ |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for n, r in summaries.items():
        lines.append(
            f"| {n} | {r['trades']} | {num(r['net_pnl'])} | {pct(r['account_return'])} | {num(r['profit_factor'])} | {num(r['max_marked_drawdown_rupees'])} |"
        )
    lines += [
        "",
        "**The ambiguity-exclusion row is an ex-post observation-quality diagnostic, not a causal trading variant.** It drops ambiguous entry/stop bars after seeing their ranges. Its favorable result cannot be used as evidence that those losses could be avoided live. Baseline instead charges the possible stop, and never credits an unknown-order entry-bar target. Complete-only excludes every day with a missing sample-stock candle and rebuilds warmup; unchanged P&L means only that the observed omissions did not change these trades, not that shared missing sessions do not exist.",
        "",
        f"Continuity baseline: win rate {pct(s['win_rate'])}; average win ₹{num(s['avg_win'])}; average loss ₹{num(s['avg_loss'])}; net expectancy ₹{num(s['expectancy'])}/trade. Maximum sampled marked-equity drawdown {pct(s['max_marked_drawdown_fraction'])}. Ending equity ₹{num(s['ending_equity'])}; terminal open positions {len(s['open_positions'])}.",
        f"Average observed-bar capital utilization {pct(s['average_capital_utilization'])}; {s['exposed_bar_count']} bar-close observations with exposure. Two-sided turnover ₹{num(s['turnover'])} ({s['turnover']/200000:.2f}× initial capital). This utilization omits positions entered and exited wholly inside an interval; it is not measured time-weighted exchange exposure.",
        f"Largest five trades contribute ₹{num(s['largest_five_pnl_sum'])}; all remaining trades contribute ₹{num(s['net_pnl']-s['largest_five_pnl_sum'])}. Ambiguous closed trades: {s['ambiguous_trades']}; delayed exits: {s['delayed_exits']}. Marked drawdown samples available opens/closes, not unseen tick paths.",
        "",
        "## Annual account results — continuity assumption",
        "",
        "| Year | Trades | Net cash/account P&L ₹ | Return on year-start equity | Profit factor |",
        "|---|---:|---:|---:|---:|",
    ]
    for r in s["annual"]:
        lines.append(
            f"| {r['year']} | {r['trades']} | {num(r['net_account_pnl'])} | {pct(r['account_return'])} | {num(r['profit_factor'])} |"
        )
    lines += [
        "",
        "Account returns use equity, never sums of trade percentages. All year-end observations in this pilot are flat, so cash/account P&L coincide; 2026 is partial through 25 September. The earlier 41-trade pilot was not fitted or replicated. These periods have already been studied; no untouched out-of-sample designation.",
        "",
        "## By stock — continuity assumption",
        "",
        "| Stock | Trades | Net P&L ₹ | Profit factor |",
        "|---|---:|---:|---:|",
    ]
    for sym, r in s["by_stock"].items():
        lines.append(
            f"| {sym} | {r['trades']} | {num(r['net_pnl'])} | {num(r['profit_factor'])} |"
        )
    lines += [
        "",
        "Stock-by-year metrics are also in `summary.json` (`by_stock_year`). These are contributions to a shared cash account, not separate account backtests.",
        "",
        "## Itemized fees — continuity assumption",
        "",
        "| Component | Rupees |",
        "|---|---:|",
    ]
    for k, v in s["costs"].items():
        lines.append(f"| {k} | {num(v)} |")
    charges = sum(s["costs"].values())
    lines += [
        "",
        f"Total explicit charges ₹{num(charges)}; gross P&L after modeled slippage but before these charges ₹{num(s['net_pnl']+charges)}. Slippage is embedded in prices, not subtracted again. The small opportunity count, transaction costs, and three ambiguous entry/stop outcomes prevent a convincing edge; the 10bp/side plus double-fee stress worsens the loss. No parameters were optimized.",
        "",
        "## Actual input coverage",
        "",
        "| Stock | Five-minute rows | Earliest | Latest | Zero-volume bars | Incomplete regular sessions |",
        "|---|---:|---|---|---:|---:|",
    ]
    for sym, r in audit["stocks"].items():
        lines.append(
            f"| {sym} | {r['valid_unique_rows']} | {r['earliest']} | {r['latest']} | {r['zero_volume_bars']} | {len(r['missing_regular_bars'])} |"
        )
    lines += [
        "",
        "No 2021 five-minute coverage is asserted. Each scenario includes `data_validation.json`, missing-bar lists, excluded special sessions, input SHA-256s and exact code hashes. Shared missing 7 March 2022 09:30 and delayed starts on RELIANCE 20 July 2023 / ITC 6 January 2025 are retained as gaps. HDFCBANK 25 June 2024 09:15 is additionally rejected because its reported low exceeds its open (one invalid candle). Historical corporate-action and tick metadata remain unverified. Calendar is based on observed daily dates and cannot certify that entirely absent shared sessions are complete.",
        "",
        "## Completed and next steps",
        "",
        "Implemented one causal engine, shared paper cash account, conservative candle execution, quote-event adapter, transactional recovery, dashboard and separate paper controls, tests, five-stock replay, validation/ledgers and resumable broader downloader. Read-only analytics quote probe succeeded. No bot, exchange order, droplet, deployment or persistent recorder was touched.",
        "",
        "The candidate master contains 2,680 current records, all disabled pending review. A 100-stock Jan 2022–Sep 2026 study needs up to 5,700 monthly requests before cache reuse; no bulk download was run. Historical replay accepts a broader dated manifest. Forward candle polling is capped at 60 reviewed members; a larger forward universe requires a batched/streaming adapter.",
        "",
        "Before collecting paper signals: verify ordinary-share eligibility/suspensions, dated ticks, comparable closes and a complete calendar (including warmup); bootstrap the local account paused; inspect exclusions; enable the local dashboard, explicitly resume paper entries, then run the foreground observer. Exact commands and stopping instructions are in `README.md`. No activation was performed.",
        "",
        "Do not move to live trading on this evidence. Future paper collection should retain received timestamps, spreads/depth, missed observations and rejected signals for a genuinely forward evaluation. Any subsequent strategy experiment must freeze its new rules before examining results.",
        "",
    ]
    report = "\n".join(lines)
    (BASE / "REPORT.md").write_text(report)
    (Path(__file__).parent / "PILOT_REPORT.md").write_text(report)
    print(BASE / "REPORT.md")


if __name__ == "__main__":
    main()
