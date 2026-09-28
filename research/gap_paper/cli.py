"""python3 -m research.gap_paper.cli --help"""

import argparse, copy, json, os, sys, time, calendar as monthcal
from pathlib import Path
from datetime import date, datetime, timedelta
from collections import defaultdict
from .engine import fresh, normalize, process, IST, stamp, digest
from .storage import read, update
from .report import export
from .validation import validate, source_manifest
from .data import Client, DataError, master

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "research/gap_paper"
DEFAULT = ROOT / "data/exports/gap_paper"


def load(p):
    return json.loads(Path(p).read_text())


def events(raw):
    batches = defaultdict(dict)
    issues = []
    for sym, cs in raw.items():
        for r in cs:
            try:
                b = normalize(sym, r)
            except (ValueError, TypeError, IndexError):
                issues.append({"symbol": sym, "reason": "invalid_candle"})
                continue
            at = (stamp(b["ts"]) + timedelta(minutes=5)).isoformat()
            if sym in batches[at]:
                if batches[at][sym] != b:
                    raise ValueError("Conflicting duplicate candle " + sym + " " + at)
                issues.append({"symbol": sym, "at": at, "reason": "duplicate_dropped"})
                continue
            batches[at][sym] = b
    return [
        {"kind": "candles", "at": at, "bars": list(bs.values())}
        for at, bs in sorted(batches.items())
    ], issues


def pilot_inputs(path):
    raw = {}
    metadata = load(path / "selected_instruments.json")
    calendar = {}
    for sym in metadata:
        cs = []
        for f in sorted(path.glob(sym + "_5m_*.json")):
            cs.extend(load(f).get("data", {}).get("candles", []))
        raw[sym] = cs
        for f in sorted(path.glob(sym + "_daily_*.json")):
            for row in load(f).get("data", {}).get("candles", []):
                d = row[0][:10]
                calendar[d] = (
                    "regular" if date.fromisoformat(d).weekday() < 5 else "special"
                )
    for d in ["2022-10-24", "2023-11-12", "2024-11-01", "2025-10-21"]:
        calendar[d] = "special"
    manifest = {
        "label": "current-survivor sample; illustrative metadata, not historical universe",
        "comparable": {},
        "members": [
            {
                "symbol": sym,
                "key": rows[0]["instrument_key"],
                "from": "2021-01-01",
                "to": "2026-09-26",
                "segment": "NSE_EQ",
                "ordinary_share": True,
                "eligible": True,
                "suspended": False,
                "tick_size": 0.05,
                "metadata_basis": "five-stock research assumption; historical tick changes unverified",
            }
            for sym, rows in metadata.items()
        ],
    }
    return raw, manifest, calendar


def trimmed(s):
    if not s:
        return {
            "mode": "paper",
            "data_status": "not_initialized",
            "message": "Configure reference files and initialize local paper storage; no worker is running automatically.",
        }
    o = {
        k: v
        for k, v in s.items()
        if k
        not in [
            "equity_curve",
            "cashflows",
            "signals",
            "trades",
            "rejections",
            "events",
            "daily_scans",
        ]
    }
    o["stocks"] = {
        sym: {k: v for k, v in x.items() if k not in ["values", "minutes", "member"]}
        for sym, x in s["stocks"].items()
    }
    for k in [
        "equity_curve",
        "cashflows",
        "signals",
        "trades",
        "rejections",
        "events",
        "daily_scans",
    ]:
        o[k] = s[k][-100:]
    o["universe_size"] = len(s["stocks"])
    o["excluded_stocks"] = sum(
        x.get("phase") == "invalid" for x in s["stocks"].values()
    )
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "command",
        choices=[
            "replay",
            "status",
            "pause",
            "resume",
            "reset",
            "observe",
            "download-plan",
            "download",
            "prepare-universe",
            "ingest-events",
        ],
    )
    ap.add_argument("--events-json")
    ap.add_argument("--out", default=str(DEFAULT))
    ap.add_argument("--config", default=str(BASE / "config.json"))
    ap.add_argument("--manifest")
    ap.add_argument("--calendar")
    ap.add_argument(
        "--raw", default=str(ROOT / "data/exports/nse_cash_coverage_20260927/raw")
    )
    ap.add_argument("--db", default=str(DEFAULT / "paper.sqlite"))
    ap.add_argument(
        "--variant",
        choices=[
            "strict",
            "continuity-assumption",
            "stress",
            "exclude-ambiguous",
            "complete-only",
        ],
        default="strict",
    )
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--confirm-reset", action="store_true")
    ap.add_argument("--from-date", default="2022-01-01")
    ap.add_argument("--to-date", default="2026-09-26")
    args = ap.parse_args()
    cfg = load(args.config)
    out = Path(args.out)
    if cfg["mode"] != "paper" or cfg["telegram_delivery"]:
        raise ValueError("Only paper with delivery disabled is supported")
    if args.command == "status":
        print(json.dumps(trimmed(read(args.db))))
        return
    if args.command == "prepare-universe":
        rows = master()
        out.mkdir(parents=True, exist_ok=True)
        # EQ alone does not establish ordinary-share status. Review candidates before admission.
        candidates = [
            {
                "symbol": r["trading_symbol"],
                "key": r["instrument_key"],
                "segment": r["segment"],
                "ordinary_share": None,
                "eligible": False,
                "suspended": None,
                "tick_size": float(r.get("tick_size", 0)) / 100,
                "from": str(date.today()),
                "to": "9999-12-31",
                "name": r.get("name"),
                "metadata_basis": "current master candidate; review type/suspension before eligibility",
            }
            for r in rows
            if r.get("segment") == "NSE_EQ" and r.get("instrument_type") == "EQ"
        ]
        (out / "universe_candidates.json").write_text(
            json.dumps(
                {
                    "label": "current-survivor candidates; not historical membership",
                    "members": candidates,
                    "comparable": {},
                },
                indent=2,
            )
        )
        print(json.dumps({"candidates": len(candidates), "eligible": 0}))
        return
    if args.command == "replay":
        raw, manifest, cal = pilot_inputs(Path(args.raw))
        manifest = load(args.manifest) if args.manifest else manifest
        cal = load(args.calendar) if args.calendar else cal
        if args.variant != "strict":
            cfg["corporate_action_policy"] = "continuity-assumption"
        if args.variant == "stress":
            cfg["slippage_bps"] = 10
            cfg["cost_multiplier"] = 2
        if args.variant == "exclude-ambiguous":
            cfg["exclude_ambiguous_entries"] = True
        audit = validate(raw, cal)
        if args.variant == "complete-only":
            for day in audit["incomplete_dates_any_stock"]:
                cal[day] = "data-gap-excluded"
        evs, issues = events(raw)
        s = fresh(cfg, manifest, cal)
        for i, e in enumerate(evs):
            process(s, e, cfg, manifest, cal)
            if i % 20000 == 0:
                print("Processed", i, "batches", file=sys.stderr)
        summary = export(s, out, cfg)
        out.mkdir(parents=True, exist_ok=True)
        (out / "data_validation.json").write_text(json.dumps(audit, indent=2))
        (out / "input_files.json").write_text(
            json.dumps(source_manifest(Path(args.raw)), indent=2)
        )
        (out / "coverage.json").write_text(
            json.dumps(
                {
                    "sample": manifest["label"],
                    "variant": args.variant,
                    "normalized_batches": len(evs),
                    "input_issues": issues,
                    "calendar": "daily observed dates, weekdays with known specials excluded; not independently complete exchange calendar",
                    "corporate_actions": "strict excludes unreviewed date-symbols; exploratory continuity is an unverified assumption",
                    "tick_sizes": "historical tick sizes assumed 0.05 in default five-stock pilot",
                    "snapshot_ends": max(
                        (v["latest"] or "" for v in audit["stocks"].values()),
                        default=None,
                    ),
                    "account_hash": s["hash"],
                },
                indent=2,
            )
        )
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
        (out / "calendar.json").write_text(json.dumps(cal, indent=2))
        print(
            json.dumps(
                {
                    k: summary[k]
                    for k in [
                        "trades",
                        "net_pnl",
                        "account_return",
                        "max_marked_drawdown_rupees",
                    ]
                }
            )
        )
        return
    if not args.manifest or not args.calendar:
        raise ValueError(
            "--manifest and --calendar are required; no inferred live eligibility"
        )
    manifest = load(args.manifest)
    cal = load(args.calendar)
    if args.command == "ingest-events":
        if not args.events_json:
            raise ValueError("--events-json is required")
        print(
            json.dumps(
                trimmed(
                    update(args.db, cfg, manifest, cal, events=load(args.events_json))
                )
            )
        )
        return
    if args.command in ["pause", "resume", "reset"]:
        if args.command == "reset" and not args.confirm_reset:
            raise ValueError(
                "Reset requires --confirm-reset; old account remains archived"
            )
        print(
            json.dumps(
                trimmed(update(args.db, cfg, manifest, cal, action=args.command))
            )
        )
        return
    if args.command in ["download-plan", "download"]:
        windows = []
        d = date.fromisoformat(args.from_date)
        end = date.fromisoformat(args.to_date)
        while d <= end:
            last = min(
                end, date(d.year, d.month, monthcal.monthrange(d.year, d.month)[1])
            )
            windows.append((str(d), str(last)))
            d = last + timedelta(days=1)
        members = [
            r
            for r in manifest["members"]
            if r.get("ordinary_share")
            and r.get("eligible")
            and r.get("suspended") is False
        ]
        out.mkdir(parents=True, exist_ok=True)
        plan = {
            "stocks": len(members),
            "unreviewed_candidates": len(manifest["members"]) - len(members),
            "illustrative_100_stock_requests": 100 * len(windows),
            "all_manifest_rows_upper_bound_requests": len(manifest["members"])
            * len(windows),
            "windows": len(windows),
            "max_requests": len(members) * len(windows),
            "pacing_seconds": 1,
            "label": manifest.get("label"),
            "cached_data_reused": True,
        }
        (out / "download_plan.json").write_text(json.dumps(plan, indent=2))
        print(json.dumps(plan))
        if args.command == "download-plan":
            return
        client = Client(out / "http_cache")
        coverage = []
        metadata = {}
        for r in members:
            metadata.setdefault(r["symbol"], []).append({"instrument_key": r["key"]})
        (out / "selected_instruments.json").write_text(json.dumps(metadata, indent=2))
        for r in members:
            for a, b in windows:
                if a > r.get("to", "9999") or b < r.get("from", "0000"):
                    continue
                start = max(a, r.get("from", a))
                end = min(b, r.get("to", b))
                rows = client.history(r["key"], start, end)
                coverage.append(
                    {
                        "symbol": r["symbol"],
                        "key": r["key"],
                        "from": start,
                        "to": end,
                        "rows": len(rows),
                    }
                )
                # Same raw cache naming accepted by replay, preserves empty coverage explicitly.
                (
                    out
                    / f"{r['symbol']}_5m_{start.replace('-','_')}_{end.replace('-','_')}_{digest(r['key'])[:12]}.json"
                ).write_text(json.dumps({"data": {"candles": rows}}))
                (out / "download_coverage.json").write_text(
                    json.dumps(coverage, indent=2)
                )
        return
    if cfg["execution"] != "candle":
        raise ValueError(
            "Polling observer is candle-modeled. Quote execution accepts recorded events through the engine; live quote scheduling is not enabled."
        )
    if sum(bool(r.get("eligible")) for r in manifest["members"]) > 60:
        raise ValueError(
            "Polling observer limited to 60 reviewed members; broader observation requires a batched/streaming adapter. Historical downloader has no such cap."
        )
    client = Client(out / "http_cache")
    out.mkdir(parents=True, exist_ok=True)
    # Bootstrap only indicators/history by pausing entries; never backfill hypothetical entries as live observations.
    s = read(args.db)
    if s is None or not s["stocks"]:
        update(args.db, cfg, manifest, cal, action="pause")
        now = datetime.now(IST)
        raw = {}
        for r in manifest["members"]:
            if not r.get("eligible"):
                continue
            cs = []
            d = now.date() - timedelta(days=65)
            while d < now.date():
                end = min(now.date() - timedelta(days=1), d + timedelta(days=24))
                cs.extend(client.history(r["key"], d.isoformat(), end.isoformat()))
                d = end + timedelta(days=1)
            raw[r["symbol"]] = cs
        evs, _ = events(raw)
        # Single transaction to bootstrap, paused. Explicit resume via dashboard after review.
        update(args.db, cfg, manifest, cal, events=evs)
    while True:
        now = datetime.now(IST)
        raw = {}
        for r in manifest["members"]:
            if r.get("eligible") and r.get(
                "from", "0000"
            ) <= now.date().isoformat() <= r.get("to", "9999"):
                raw[r["symbol"]] = client.intraday(r["key"])
        now = datetime.now(IST)
        evs, issues = events(raw)
        s = read(args.db)
        recent = [
            e
            for e in evs
            if stamp(e["at"]) <= now
            and (not s["last_event"] or e["at"] > s["last_event"])
        ]
        # Delayed polls cannot silently earn hindsight fills: block new entries when >90 seconds late.
        for e in recent:
            if (now - stamp(e["at"])).total_seconds() > 90:
                update(args.db, cfg, manifest, cal, action="pause")
            e["received_at"] = now.isoformat()
            update(args.db, cfg, manifest, cal, events=[e])
        print(
            json.dumps(
                {
                    "processed": len(recent),
                    "mode": "paper",
                    "execution": "candle",
                    "at": now.isoformat(),
                }
            ),
            flush=True,
        )
        if not args.loop:
            break
        time.sleep(20)


if __name__ == "__main__":
    try:
        main()
    except (DataError, ValueError, KeyError) as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
