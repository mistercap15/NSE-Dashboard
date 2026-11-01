"""Offline audit of raw inputs; never fills or repairs missing observations."""

import hashlib, json
from collections import Counter, defaultdict
from pathlib import Path
from .engine import normalize, minute, stamp


def validate(raw, calendar):
    result = {}
    bad_days = set()
    for sym, rows in raw.items():
        bars = {}
        duplicates = 0
        invalid = 0
        conflicts = 0
        for r in rows:
            try:
                b = normalize(sym, r)
            except (ValueError, TypeError, IndexError):
                invalid += 1
                continue
            key = b["ts"]
            if key in bars:
                duplicates += 1
                conflicts += int(bars[key] != b)
            bars[key] = b
        ordered = sorted(bars.values(), key=lambda b: b["ts"])
        days = defaultdict(list)
        for b in ordered:
            days[b["ts"][:10]].append(b)
        missing = {}
        special = {}
        complete = 0
        if ordered:
            start = ordered[0]["ts"][:10]
            end = ordered[-1]["ts"][:10]
            for day, kind in sorted(calendar.items()):
                if not start <= day <= end:
                    continue
                obs = {minute(b["ts"]) for b in days.get(day, [])}
                if kind != "regular":
                    special[day] = len(obs)
                    continue
                absent = sorted(set(range(555, 930, 5)) - obs)
                if absent:
                    missing[day] = [f"{m//60:02d}:{m%60:02d}" for m in absent]
                    bad_days.add(day)
                else:
                    complete += 1
        gaps = []
        prior = None
        for day, bs in sorted(days.items()):
            if calendar.get(day) != "regular":
                continue
            if prior and minute(bs[0]["ts"]) == 555:
                gap = bs[0]["o"] / prior["c"] - 1
                if abs(gap) >= 0.1:
                    gaps.append(
                        {
                            "day": day,
                            "raw_gap": gap,
                            "status": "unverified economic gap / corporate action; not an adjustment factor",
                        }
                    )
            prior = bs[-1]
        result[sym] = {
            "raw_rows": len(rows),
            "valid_unique_rows": len(ordered),
            "earliest": ordered[0]["ts"] if ordered else None,
            "latest": ordered[-1]["ts"] if ordered else None,
            "duplicate_rows": duplicates,
            "conflicting_duplicates": conflicts,
            "invalid_rows": invalid,
            "zero_volume_bars": sum(b["v"] == 0 for b in ordered),
            "complete_regular_sessions": complete,
            "observed_sessions": len(days),
            "missing_regular_bars": missing,
            "missing_entire_regular_sessions": [
                d for d, ms in missing.items() if len(ms) == 75
            ],
            "special_sessions_excluded": special,
            "large_raw_discontinuities": gaps,
            "volume_quality": "nonnegative integer candle volume; no independent tick reconciliation; candle traded value and VWAP are approximations",
        }
    return {
        "stocks": result,
        "incomplete_dates_any_stock": sorted(bad_days),
        "calendar_basis": "Observed daily dates plus explicit special sessions; shared omissions cannot be detected without an authoritative exchange calendar. Not certified complete.",
        "corporate_actions": "No validated historical adjustment series supplied. Strict run quarantines all unreviewed symbol-dates.",
        "membership": "Default five-stock pilot is a current-survivor sample; historical ordinary-share eligibility and tick sizes assumed, not recovered.",
    }


def source_manifest(path):
    return [
        {
            "file": f.name,
            "bytes": f.stat().st_size,
            "sha256": hashlib.sha256(f.read_bytes()).hexdigest(),
        }
        for f in sorted(Path(path).glob("*.json"))
    ]
