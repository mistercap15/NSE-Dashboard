"""Daily forward universe and corporate-action checks; all source data retained."""

import csv, gzip, io, json, urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from .data import Client, DataError
from .engine import IST

NIFTY50 = "https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv"
MASTER = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
SUSPENDED = "https://assets.upstox.com/market-quote/instruments/exchange/suspended-instrument.json.gz"


def public(url):
    with urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=40
    ) as r:
        return r.read()


def calendar_from_holidays(rows, year):
    if not rows or not any(r.get("date", "").startswith(str(year)) for r in rows):
        raise DataError("Current-year holiday calendar unavailable")
    cal = {}
    d = date(year, 1, 1)
    while d.year == year:
        cal[d.isoformat()] = "regular" if d.weekday() < 5 else "closed"
        d += timedelta(days=1)
    for r in rows:
        day = r.get("date")
        closed = r.get("closed_exchanges", [])
        if day not in cal:
            continue
        if "NSE" in closed:
            cal[day] = "closed"
        elif r.get("holiday_type") == "SPECIAL_TIMING":
            cal[day] = "special"
    return cal


def action_days(rows):
    if not isinstance(rows, list):
        raise DataError("Invalid corporate-action response")
    days = set()
    for row in rows:
        raw = row.get("expiry_date", "")
        parsed = None
        for fmt in ["%d %b %Y", "%Y-%m-%d", "%d-%m-%Y"]:
            try:
                parsed = datetime.strptime(raw, fmt).date().isoformat()
                break
            except (ValueError, TypeError):
                pass
        if parsed is None:
            raise DataError("Unparseable corporate-action effective date")
        days.add(parsed)
    return days


def prepare(root, day=None):
    root = Path(root)
    day = day or datetime.now(IST).date()
    folder = root / "references" / day.isoformat()
    folder.mkdir(parents=True, exist_ok=True)
    if (folder / "bundle.json").exists():
        return json.loads((folder / "bundle.json").read_text())
    client = Client(root / "reference_http_cache")
    raw = public(NIFTY50)
    (folder / "nifty50.csv").write_bytes(raw)
    constituents = list(csv.DictReader(io.StringIO(raw.decode())))
    if not 40 <= len(constituents) <= 60:
        raise DataError("Unexpected Nifty 50 constituent count")
    raw = public(MASTER)
    (folder / "NSE.json.gz").write_bytes(raw)
    instruments = json.loads(gzip.decompress(raw))
    raw = public(SUSPENDED)
    (folder / "suspended.json.gz").write_bytes(raw)
    suspended = json.loads(gzip.decompress(raw))
    suspended_keys = {
        (r["instrument_key"], r.get("segment"), r.get("instrument_type"))
        for r in suspended
    }
    holidays = client.get("v2/market/holidays", ttl=3600)
    (folder / "holidays.json").write_text(json.dumps(holidays))
    cal = calendar_from_holidays(holidays["data"], day.year)
    manifest = {
        "label": "Current Nifty 50 ordinary cash shares; forward-only universe, not all NSE stocks",
        "comparable": {},
        "members": [],
        "reference_day": day.isoformat(),
    }
    exclusions = []
    start = max(date(day.year, 1, 1), day - timedelta(days=100)).isoformat()
    for row in constituents:
        sym = row["Symbol"]
        isin = row["ISIN Code"]
        matches = [
            r
            for r in instruments
            if r.get("isin") == isin
            and r.get("segment") == "NSE_EQ"
            and r.get("instrument_type") == "EQ"
        ]
        if len(matches) != 1 or row.get("Series") != "EQ":
            exclusions.append(
                {"symbol": sym, "reason": "ordinary_share_identity_unresolved"}
            )
            continue
        r = matches[0]
        tick = float(r.get("tick_size", 0)) / 100
        if (
            (r["instrument_key"], r["segment"], r["instrument_type"]) in suspended_keys
            or r.get("security_type") != "NORMAL"
            or not 0 < tick <= 100
        ):
            exclusions.append(
                {"symbol": sym, "reason": "suspended_or_non_normal_or_unknown_tick"}
            )
            continue
        try:
            actions = client.get(f"v2/fundamentals/{isin}/corporate-actions", ttl=3600)
            (folder / (sym + "_actions.json")).write_text(json.dumps(actions))
            blocked = action_days(actions["data"])
        except (DataError, KeyError, TypeError):
            exclusions.append(
                {"symbol": sym, "reason": "corporate_action_feed_unavailable"}
            )
            continue
        manifest["members"].append(
            {
                "symbol": sym,
                "key": r["instrument_key"],
                "isin": isin,
                "from": start,
                "to": day.isoformat(),
                "segment": "NSE_EQ",
                "ordinary_share": True,
                "eligible": True,
                "suspended": False,
                "tick_size": tick,
                "metadata_basis": "Official current Nifty50 + current Upstox NORMAL EQ master; historical data is warmup only",
            }
        )
        manifest["comparable"][sym] = {
            d: (0 if d in blocked else 1)
            for d, kind in cal.items()
            if start <= d <= day.isoformat() and kind == "regular"
        }
    if not manifest["members"]:
        raise DataError("No members passed daily reference checks")
    result = {
        "manifest": manifest,
        "calendar": cal,
        "exclusions": exclusions,
        "day": day.isoformat(),
        "source_policy": "Provider action feed checked daily. All reported ex-dates quarantined; no guessed adjustments. Unreported actions remain a provider-data risk.",
    }
    tmp = folder / "bundle.tmp"
    tmp.write_text(json.dumps(result, indent=2))
    tmp.replace(folder / "bundle.json")
    return result
