"""Whole-NSE discovery and bounded, resumable prior-session preparation.

Opening snapshots are market data, not paper fills. Unknown eligibility stays explicit.
"""

import calendar as months
import copy
import csv
import gzip
import io
import json
import math
import statistics
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from .data import Client, DataError
from .engine import IST, fresh, process, digest, stamp
from .cli import events
from .references import public, MASTER, SUSPENDED, calendar_from_holidays, action_days

EQUITIES = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
SCHEMA = "nse-equities-v2"


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", dir=path.parent, prefix=path.stem + "-", suffix=".tmp", delete=False
    ) as out:
        json.dump(value, out)
        tmp = Path(out.name)
    tmp.replace(path)


def resolve_catalog(equities, instruments, suspended):
    suspended = {
        (r["instrument_key"], r.get("instrument_type"))
        for r in suspended
        if r.get("segment") == "NSE_EQ"
    }
    by_isin = {}
    for r in instruments:
        if r.get("segment") == "NSE_EQ":
            by_isin.setdefault(r.get("isin"), []).append(r)
    members = []
    excluded = []
    for raw in equities:
        row = {k.strip(): v.strip() for k, v in raw.items() if k}
        sym, isin = row.get("SYMBOL"), row.get("ISIN NUMBER")
        series = row.get("SERIES")
        matches = [
            r for r in by_isin.get(isin, []) if r.get("instrument_type") == series
        ]
        if not matches:
            excluded.append(
                {
                    "symbol": sym,
                    "reason": "not_in_broker_active_master",
                    "series": series,
                }
            )
            continue
        if len(matches) != 1:
            excluded.append(
                {"symbol": sym, "reason": "ambiguous_identity", "series": series}
            )
            continue
        r = matches[0]
        tick = float(r.get("tick_size", 0)) / 100
        reasons = []
        if (r["instrument_key"], series) in suspended:
            reasons.append("suspended")
        if series != "EQ":
            reasons.append("non_regular_series")
        if r.get("security_type") != "NORMAL":
            reasons.append("restricted_security_type")
        if r.get("lot_size") != 1:
            reasons.append("non_single_share_lot")
        if not math.isfinite(tick) or tick <= 0:
            reasons.append("unknown_tick")
        members.append(
            {
                "symbol": sym,
                "name": row.get("NAME OF COMPANY", r.get("name", "")),
                "isin": isin,
                "key": r["instrument_key"],
                "series": series,
                "tick_size": tick,
                "entry_eligible": not reasons,
                "exclusion": ", ".join(reasons) or None,
            }
        )
    keys = [m["key"] for m in members]
    if len(keys) != len(set(keys)):
        raise DataError("Duplicate cash-equity identity in catalogue")
    return sorted(members, key=lambda m: m["symbol"]), excluded


def catalog(root, day):
    folder = Path(root) / "market_references" / day.isoformat()
    cached = folder / "catalog.json"
    if cached.exists():
        return json.loads(cached.read_text())
    folder.mkdir(parents=True, exist_ok=True)
    raw = public(EQUITIES)
    (folder / "EQUITY_L.csv").write_bytes(raw)
    equities = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    if len(equities) < 1000:
        raise DataError("Full NSE equity list unavailable")
    raw = public(MASTER)
    (folder / "NSE.json.gz").write_bytes(raw)
    instruments = json.loads(gzip.decompress(raw))
    raw = public(SUSPENDED)
    (folder / "suspended.json.gz").write_bytes(raw)
    suspended = json.loads(gzip.decompress(raw))
    members, excluded = resolve_catalog(equities, instruments, suspended)
    holidays = Client(Path(root) / "market_reference_cache").get(
        "v2/market/holidays", ttl=3600
    )
    save(folder / "holidays.json", holidays)
    result = {
        "schema": SCHEMA,
        "day": day.isoformat(),
        "source": EQUITIES,
        "broker_source": MASTER,
        "exchange_listed": len(equities),
        "members": members,
        "unavailable": excluded,
        "calendar": calendar_from_holidays(holidays["data"], day.year),
    }
    save(cached, result)
    return result


def profile_path(root, key):
    return Path(root) / "market_profiles" / (digest(key) + ".json")


def read_profile(root, member, prior):
    p = profile_path(root, member["key"])
    if not p.exists():
        return None
    value = json.loads(p.read_text())
    if value.get("as_of") != prior or value.get("key") != member["key"]:
        return None
    # A matching prior session alone is insufficient over holidays or a failed
    # refresh: corporate-action verification must also be recent.
    try:
        age = (datetime.now(IST) - stamp(value["checked_at"])).total_seconds()
    except (KeyError, ValueError, TypeError):
        return None
    if not 0 <= age < 18 * 3600:
        return None
    return value


def previous_session(cal, day):
    return max((d for d, k in cal.items() if k == "regular" and d < day), default=None)


def member_manifest(member, first, day, blocked):
    return {
        "label": "All NSE ordinary cash shares; eligibility verified before selection",
        "members": [
            {
                "symbol": member["symbol"],
                "key": member["key"],
                "isin": member["isin"],
                "from": first,
                "to": day,
                "segment": "NSE_EQ",
                "ordinary_share": True,
                "eligible": member["entry_eligible"],
                "suspended": False,
                "tick_size": member["tick_size"],
            }
        ],
        "comparable": {member["symbol"]: blocked},
    }


def build_profile(root, member, cat, as_of, cfg):
    """Only data through as_of. Same indicator/session engine, permanently paused."""
    client = Client(Path(root) / "market_history_cache")
    today = datetime.now(IST)
    old = read_profile(root, member, as_of)
    if old and old.get("profile_version") == 2 and (
        old["complete"] or (today - stamp(old["checked_at"])).total_seconds() < 3600
    ):
        return old
    actions = client.get(
        f"v2/fundamentals/{member['isin']}/corporate-actions", ttl=3600
    )
    blocked = action_days(actions["data"])
    end = datetime.fromisoformat(as_of).date()
    start = end - timedelta(days=50)
    # Fixed calendar-month chunks reuse immutable prior months across nightly runs.
    cursor = start.replace(day=1)
    raw = []
    while cursor <= end:
        finish = min(
            end, cursor.replace(day=months.monthrange(cursor.year, cursor.month)[1])
        )
        raw.extend(
            client.history(member["key"], cursor.isoformat(), finish.isoformat(),
                           ttl=3600 if finish >= today.date() - timedelta(days=1) else None)
        )
        if finish == end:
            break
        cursor = (finish + timedelta(days=1)).replace(day=1)
    # The historical endpoint can end yesterday even after today's close.
    # Fetch today's actual intraday bars only after the full regular session;
    # overlapping records are validated by events(), never silently replaced.
    if end == today.date() and (today.hour, today.minute) >= (15, 45):
        raw.extend(client.intraday(member["key"], ttl=3600))
    batches, invalid = events({member["symbol"]: raw})
    batches = [e for e in batches if start.isoformat() <= e["at"][:10] <= as_of]
    factors = {
        d: 0 if d in blocked else 1
        for d, k in cat["calendar"].items()
        if k == "regular"
    }
    manifest = member_manifest(member, start.isoformat(), as_of, factors)
    s = fresh(cfg, manifest, cat["calendar"])
    s["paused"] = True
    for e in batches:
        process(s, e, cfg, manifest, cat["calendar"])
        for k in [
            "trades",
            "signals",
            "rejections",
            "cashflows",
            "equity_curve",
            "events",
            "daily_scans",
        ]:
            s[k] = []
    x = s["stocks"].get(member["symbol"])
    complete = bool(
        x and s["session"] == as_of and x["minutes"] == list(range(555, 930, 5))
    )
    values = (x["values"] + [x["pv"]])[-20:] if complete else []
    result = {
        "profile_version": 2,
        "key": member["key"],
        "symbol": member["symbol"],
        "as_of": as_of,
        "checked_at": today.isoformat(),
        "stock": x,
        "session": s["session"],
        "complete": complete,
        "sessions": len(values),
        "median_value": statistics.median(values) if len(values) >= 20 else None,
        "prior_close": x["prev_close"] if complete else None,
        "blocked_days": sorted(blocked),
        "issues": invalid,
        "source": "Upstox five-minute candles; typical price × volume",
    }
    save(profile_path(root, member["key"]), result)
    return result


def classify(member, row, profile, day, cfg):
    reason = member.get("exclusion")
    if not reason and not profile:
        reason = "history_pending"
    if not reason and (
        not profile["complete"] or profile["sessions"] < cfg["liquidity_sessions"]
    ):
        reason = "insufficient_complete_history"
    if not reason and day in profile["blocked_days"]:
        reason = "corporate_action_quarantine"
    if not reason and profile["median_value"] < cfg["median_value_min"]:
        reason = "below_10_crore_liquidity"
    if not reason and not cfg["gap_min"] <= row["gap"] <= cfg["gap_max"]:
        reason = "outside_1_to_10_percent"
    return reason or "eligible"


def scan(root, cat, cfg, at=None):
    start = at or datetime.now(IST)
    day = start.date().isoformat()
    prior = previous_session(cat["calendar"], day)
    client = Client(Path(root) / "market_quote_cache")
    rows = []
    missing = []
    selection_missing = []
    for offset in range(0, len(cat["members"]), 200):
        batch = cat["members"][offset : offset + 200]
        response = client.quotes([m["key"] for m in batch])
        received = datetime.now(IST)
        mapping = {
            r.get("instrument_token"): r for r in response.get("data", {}).values()
        }
        for m in batch:
            r = mapping.get(m["key"])
            p = read_profile(root, m, prior)
            try:
                o = float(r["ohlc"]["open"])
                prev = float(r["prev_close_price"])
                last = float(r["last_price"])
                source = stamp(r["timestamp"])
                rawts = r["ohlc"]["ts"]
                candle_day = (
                    datetime.fromtimestamp(float(rawts) / 1000, IST).date().isoformat()
                )
                if (
                    candle_day != day
                    or not -2 <= (received - source).total_seconds() < 60
                    or min(o, prev, last) <= 0
                    or not all(map(math.isfinite, [o, prev, last]))
                ):
                    raise ValueError()
                # The engine uses the last complete five-minute session close, not a later daily auction close.
                comparable = p["prior_close"] if p and p.get("prior_close") else prev
                gap = o / comparable - 1
                row = {
                    "symbol": m["symbol"],
                    "name": m["name"],
                    "open": o,
                    "previous_close": comparable,
                    "gap": gap,
                    "raw_quote_gap": o / prev - 1,
                    "last_price": last,
                    "volume": r.get("volume"),
                    "quote_at": r["timestamp"],
                    "received_at": received.isoformat(),
                    "median_value": p.get("median_value") if p else None,
                    "gap_basis": (
                        "verified_prior_candle_close"
                        if p and p.get("prior_close")
                        else "broker_previous_close_unverified"
                    ),
                    "history_sessions": p.get("sessions", 0) if p else 0,
                }
                row["eligibility"] = classify(m, row, p, day, cfg)
                rows.append(row)
            except (ValueError, TypeError, KeyError, OverflowError):
                if (
                    m["entry_eligible"]
                    and p
                    and p["complete"]
                    and p["sessions"] >= 20
                    and p["median_value"] >= cfg["median_value_min"]
                    and day not in p["blocked_days"]
                ):
                    selection_missing.append(m["symbol"])
                missing.append(
                    {"symbol": m["symbol"], "reason": "missing_or_stale_session_quote"}
                )
    rows.sort(key=lambda r: (-r["gap"], -(r["median_value"] or 0), r["symbol"]))
    result = {
        "schema": SCHEMA,
        "day": day,
        "started_at": start.isoformat(),
        "completed_at": datetime.now(IST).isoformat(),
        "source": "Upstox live full-market quotes + NSE equity list",
        "exchange_listed": cat["exchange_listed"],
        "requested": len(cat["members"]),
        "quoted": len(rows),
        "gap_up": sum(r["gap"] > 0 for r in rows),
        "in_strategy_range": sum(
            cfg["gap_min"] <= r["gap"] <= cfg["gap_max"] for r in rows
        ),
        "eligible": sum(r["eligibility"] == "eligible" for r in rows),
        "rows": rows,
        "unavailable": cat["unavailable"] + missing,
        "selection_missing": selection_missing,
        "selection_note": "All gap-ups are visible. Only the top five eligible 1–10% gaps are monitored by V1.",
    }
    save(Path(root) / "market_scans" / f"{day}-latest.json", result)
    return result
