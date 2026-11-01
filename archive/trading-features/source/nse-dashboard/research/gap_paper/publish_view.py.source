"""Package sanitized research results for read-only dashboard/mobile viewing."""

import argparse, csv, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "data/exports/gap_paper/pilot"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mobile-output")
    args = parser.parse_args()
    names = [
        "strict",
        "continuity-assumption",
        "stress",
        "exclude-ambiguous",
        "complete-only",
    ]
    summaries = {
        name: json.loads((BASE / name / "summary.json").read_text()) for name in names
    }
    audit = json.loads(
        (BASE / "continuity-assumption/data_validation.json").read_text()
    )
    trades = []
    for row in csv.DictReader((BASE / "continuity-assumption/trades.csv").open()):
        trades.append(
            {
                k: (
                    json.loads(row[k])
                    if k in ["entry_costs", "exit_costs"]
                    else (
                        float(row[k])
                        if k in ["qty", "entry", "exit", "pnl", "stop", "target"]
                        else row[k]
                    )
                )
                for k in [
                    "symbol",
                    "qty",
                    "entry_at",
                    "exit_at",
                    "entry",
                    "exit",
                    "pnl",
                    "stop",
                    "target",
                    "reason",
                    "entry_costs",
                    "exit_costs",
                ]
            }
        )
    months = {}
    for row in csv.DictReader((BASE / "continuity-assumption/equity_curve.csv").open()):
        months[row["at"][:7]] = {"at": row["at"], "equity": float(row["equity"])}
    result = {
        "version": "gap-first-pullback-v1",
        "as_of": "2026-09-25",
        "label": "Exploratory five-stock pilot · current-survivor sample",
        "warning": "No proven edge. Continuity and historical tick sizes are assumptions; strict corporate-action review permits no trades. These years were previously examined.",
        "summary": summaries["continuity-assumption"],
        "scenarios": [
            {
                "scenario": name,
                **{
                    k: s[k]
                    for k in [
                        "trades",
                        "net_pnl",
                        "account_return",
                        "profit_factor",
                        "max_marked_drawdown_rupees",
                    ]
                },
            }
            for name, s in summaries.items()
        ],
        "coverage": [
            {
                "symbol": sym,
                **{
                    k: r[k]
                    for k in [
                        "earliest",
                        "latest",
                        "valid_unique_rows",
                        "invalid_rows",
                        "zero_volume_bars",
                    ]
                },
            }
            for sym, r in audit["stocks"].items()
        ],
        "trades": trades,
        "equity_curve": list(months.values()),
        "equity_sampling": "Month-end observations; not the full drawdown path.",
        "ambiguity_warning": "Excluding ambiguous bars is an ex-post diagnostic, not an executable trading rule.",
        "config_hash": summaries["continuity-assumption"]["config_hash"],
    }
    target = ROOT / "app/lib/gapPaperPilot.json"
    target.write_text(json.dumps(result, indent=2) + "\n")
    print(target)
    if args.mobile_output:
        mobile = Path(args.mobile_output)
        mobile.parent.mkdir(parents=True, exist_ok=True)
        mobile.write_text(target.read_text())
        print(mobile)


if __name__ == "__main__":
    main()
