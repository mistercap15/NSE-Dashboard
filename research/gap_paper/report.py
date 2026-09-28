import csv, json, hashlib
from pathlib import Path
from collections import defaultdict


def stats(trades):
    pnls = [t["pnl"] for t in trades]
    wins = [x for x in pnls if x > 0]
    loss = [x for x in pnls if x <= 0]
    return {
        "trades": len(trades),
        "net_pnl": sum(pnls),
        "win_rate": len(wins) / len(pnls) if pnls else None,
        "avg_win": sum(wins) / len(wins) if wins else None,
        "avg_loss": sum(loss) / len(loss) if loss else None,
        "expectancy": sum(pnls) / len(pnls) if pnls else None,
        "profit_factor": sum(wins) / -sum(loss) if sum(loss) < 0 else None,
    }


def export(s, out, config):
    p = Path(out)
    p.mkdir(parents=True, exist_ok=True)
    for key in [
        "trades",
        "signals",
        "rejections",
        "cashflows",
        "equity_curve",
        "events",
        "daily_scans",
    ]:
        rs = s[key]
        if key == "daily_scans" and s["session"]:
            rs = rs + [
                {
                    "day": s["session"],
                    "shortlist": s["shortlist"],
                    "states": {
                        sym: {
                            k: x.get(k)
                            for k in ["phase", "reason", "gap", "median_value", "count"]
                        }
                        for sym, x in s["stocks"].items()
                    },
                }
            ]
        with (p / (key + ".csv")).open("w", newline="") as f:
            fields = sorted(set().union(*(r.keys() for r in rs))) if rs else ["status"]
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for r in rs:
                w.writerow(
                    {
                        k: json.dumps(v) if isinstance(v, (dict, list)) else v
                        for k, v in r.items()
                    }
                )
    years = {}
    prev = config["initial_capital"]
    for row in s["equity_curve"]:
        years[row["at"][:4]] = row["equity"]
    annual = []
    for y, eq in sorted(years.items()):
        annual.append(
            {
                "year": y,
                **stats([t for t in s["trades"] if t["exit_at"][:4] == y]),
                "net_account_pnl": eq - prev,
                "net_realized_pnl": sum(
                    t["pnl"] for t in s["trades"] if t["exit_at"][:4] == y
                ),
                "account_return": eq / prev - 1 if prev else None,
                "end_equity": eq,
            }
        )
        prev = eq
    costs = defaultdict(float)
    for flow in s["cashflows"]:
        for k, v in flow["fees"].items():
            costs[k] += v
    result = {
        **stats(s["trades"]),
        "ending_equity": s["equity"],
        "account_return": s["equity"] / config["initial_capital"] - 1,
        "max_marked_drawdown_rupees": s["drawdown"],
        "max_marked_drawdown_fraction": s.get("max_drawdown_fraction", 0),
        "open_positions": s["positions"],
        "annual": annual,
        "by_stock": {
            sym: stats([t for t in s["trades"] if t["symbol"] == sym])
            for sym in sorted(s["stocks"])
        },
        "costs": dict(costs),
        "largest_five_pnl_sum": sum(
            sorted([t["pnl"] for t in s["trades"]], reverse=True)[:5]
        ),
        "ambiguous_trades": sum(t["ambiguous"] for t in s["trades"]),
        "delayed_exits": sum(t["delayed"] for t in s["trades"]),
        "turnover": sum(t["qty"] * (t["entry"] + t["exit"]) for t in s["trades"]),
        "average_capital_utilization": sum(
            r["exposure"] / r["equity"] if r["equity"] else 0 for r in s["equity_curve"]
        )
        / max(1, len(s["equity_curve"])),
        "exposed_bar_count": sum(r["exposure"] > 0 for r in s["equity_curve"]),
        "config_hash": s["hash"],
        "missing_events": len(s["events"]),
    }
    result["by_stock_year"] = {
        f"{sym}:{y}": stats(
            [t for t in s["trades"] if t["symbol"] == sym and t["exit_at"][:4] == y]
        )
        for sym in s["stocks"]
        for y in years
    }
    (p / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
    (p / "config.json").write_text(json.dumps(config, indent=2) + "\n")
    base = Path(__file__).parent
    (p / "research_code_hashes.json").write_text(
        json.dumps(
            {
                f.name: hashlib.sha256(f.read_bytes()).hexdigest()
                for f in sorted(base.iterdir())
                if f.suffix == ".py" or f.name in ["config.json", "RULES_FROZEN.md"]
            },
            indent=2,
        )
    )
    return result
