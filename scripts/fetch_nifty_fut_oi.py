#!/usr/bin/env python3
"""Download continuous NIFTY FUTURES intraday candles WITH OPEN INTEREST.

Two CSVs for an OI-reversal-breakout backtest:
    data/exports/nifty_fut_15m_oi.csv
    data/exports/nifty_fut_1h_oi.csv

OI is the point of this script. Every fetch path below is chosen because it
returns the 7th candle field; nothing here goes through app/lib/upstox.js's
helpers, which map candles to 6 fields and drop it.

WHAT THE DATA ACTUALLY LOOKS LIKE (measured 2026-09-05, not assumed)
--------------------------------------------------------------------
  range      2024-09-30 → 2026-09-04   NOT 2022. See (3).
  15-minute  11,525 bars over 461 trading days, 23 contracts, 22 rolls
  hourly      3,234 bars, resampled — see (2)
  OI         present on 99.57% of bars, median 14.7M, no intraday jumps >25%
  known defects, all reported by the run:
    • 2024-11-29 → 2024-12-26 MISSING — the DEC-24 contract returns zero
      candles at every interval while its neighbours return data. Upstox hole.
    • 2025-10-06 and 2025-10-07 have OI=0 on every bar with normal volume.
      The field was not populated. Exclude those days.
    • 16 bars stamped 03:30 in the APR-25 contract — before the open; artifact.
    • From 2026-08-03 the feed carries a 26th bar at 15:30. Earlier days have 25.

READ THIS BEFORE TRUSTING THE OUTPUT — three things are not what the brief assumed
---------------------------------------------------------------------------------
1. EXPIRED CONTRACTS NEED A DIFFERENT API, AND IT IS PAID.
   The instrument master (assets.upstox.com/.../NSE.json.gz) carries only
   LIVE contracts — 3 NIFTY futures, about a quarter of data between them.
   A 2022→today series therefore cannot be built from the master, which is
   what --resolve-futures in fetch_nifty_2min.py works from.

   Expired contracts live behind a separate family:
       GET /v2/expired-instruments/expiries          ?instrument_key=…
       GET /v2/expired-instruments/future/contract   ?instrument_key=…&expiry_date=…
       GET /v2/expired-instruments/historical-candle/{key}/{interval}/{to}/{from}
   and Upstox gates those behind an **Upstox Plus subscription** — without it
   they return UDAPI1149. If you are not subscribed, this script stops and
   says so rather than quietly writing three months of data and calling it
   2022→today. `--probe` tells you in one cheap call which side of that line
   you are on.

2. THERE IS NO HOURLY INTERVAL FOR EXPIRED CONTRACTS.
   v3 offers /hours/1/ for live instruments. The expired endpoint is v2 and
   accepts only 1/3/5/15/30-minute and day. So the hourly file cannot be
   fetched natively across history — it is RESAMPLED from the 15-minute
   series, which is exact for OHLCV and correct for OI (see hourly() below).
   `--probe` diffs the resampled bars against native v3 hourly on a live
   contract so you can see for yourself that the two agree.

3. THE HISTORY ONLY REACHES BACK ~2 YEARS, NOT TO 2022.
   Upstox retains expired instruments for roughly two years — the earliest
   expiry the API offers is 2024-10-31. The 2022 and 2023 contracts are GONE,
   not paywalled; no subscription recovers them. If the strategy needs a longer
   sample, futures OI from this source cannot supply it.

How the continuous series is built
----------------------------------
Front-month, rolled on expiry. For expiry E_i, the contract is used for dates
in (E_{i-1}, E_i] — i.e. the day after the previous contract dies through its
own expiry day inclusive. Monthly expiries are taken as the LAST expiry in each
calendar month rather than computed from a weekday: NSE has already moved
expiry day (Thursday → Tuesday) once, and arithmetic that encodes it goes stale
silently.

Every bar carries the contract it came from, and the first day of each contract
is flagged is_roll_day. THIS MATTERS FOR THIS STRATEGY SPECIFICALLY: open
interest belongs to a contract, not to the underlying, so it resets at every
roll. An OI series read across a roll shows a violent jump that is pure
bookkeeping. Filter on is_roll_day, or difference OI only within a contract,
or the backtest will read 22 fake reversals.

Two traps in the contract chain, both hit during development:
  • The futures expiry is NOT reliably the last expiry of its month. A weekly
    option expiry can fall after it (2025-04-30 sits after the 2025-04-24
    futures expiry), so "max of month" silently dropped April 2025 and let the
    MAY contract serve April — far-month OI posing as front-month. The chain
    probes each month's expiries instead, newest first, until one resolves.
  • The docs name expired_instrument_key as the field to use; the API returns
    it null and puts the composite key in instrument_key.

Usage
-----
  python3 scripts/fetch_nifty_fut_oi.py --probe     # check access first, ~6 calls
  python3 scripts/fetch_nifty_fut_oi.py             # full 2022-01-01 → today
  python3 scripts/fetch_nifty_fut_oi.py --from 2024-01-01
  python3 scripts/fetch_nifty_fut_oi.py --verify-only

Token: UPSTOX_ANALYTICS_TOKEN, else .env.local, else UPSTOX_ACCESS_TOKEN, else
.upstox_token — the order app/lib/upstox.js resolves in.
"""

import argparse
import csv
import gzip
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, time as dtime, timedelta, timezone

# ── Config ───────────────────────────────────────────────────────────────────

BASE_V2 = "https://api.upstox.com/v2"
BASE_V3 = "https://api.upstox.com/v3"
MASTER_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"

UNDERLYING_KEY = "NSE_INDEX|Nifty 50"   # what the expired-instruments APIs key off
UNDERLYING_SYM = "NIFTY"                # what the instrument master matches on

V3_EPOCH = "2022-01-01"                 # no sub-daily data before this

# A front-month window is about one month, so one request usually covers a whole
# contract. This is the opening bite; a range error halves it (the endpoints
# error rather than truncate on an over-long range — but see _check_truncation,
# because a range under the cap but over the page size silently returns short).
WINDOW_START_DAYS = 90
WINDOW_MIN_DAYS = 5

# NSE lists index futures three months out, so no contract has bars earlier than
# roughly this far before its expiry. Without the clamp the FIRST contract in the
# chain inherits a window starting at --from, and a 2022 --from against a 2024
# contract walks ~30 pointless pages through years the contract did not exist.
MAX_CONTRACT_LIFE_DAYS = 100

# The first contract in the chain has no predecessor to roll from — the one
# before it is outside Upstox's ~2-year retention — so its front-month start is
# approximated as this many days before its expiry.
FIRST_CONTRACT_DAYS = 31
SLEEP_BETWEEN = 0.35
MAX_RETRIES = 5

IST = timezone(timedelta(hours=5, minutes=30))

# NSE regular session. Bars are stamped at bar START, so a 15-minute grid runs
# 09:15 … 15:15 and divides the session exactly — 25 bars, no stub. The hourly
# grid does NOT divide it: 09:15…14:15 are full hours and 15:15 is a 15-minute
# stub. That asymmetry is real and is reported, not smoothed over.
SESSION_OPEN = dtime(9, 15)
SESSION_CLOSE = dtime(15, 30)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUTDIR = os.path.join(ROOT, "data", "exports")

# Cloudflare 403s Python's default UA on these hosts.
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


# ── Token ────────────────────────────────────────────────────────────────────

def _from_env_file(path, key):
    try:
        with open(path, "r", encoding="utf8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() == key:
                    return v.strip().strip('"').strip("'") or None
    except OSError:
        pass
    return None


def resolve_token():
    """Mirrors resolveAccessToken() in app/lib/upstox.js: analytics token wins."""
    tok = os.environ.get("UPSTOX_ANALYTICS_TOKEN", "").strip()
    if tok:
        return tok, "UPSTOX_ANALYTICS_TOKEN (env)"
    tok = _from_env_file(os.path.join(ROOT, ".env.local"), "UPSTOX_ANALYTICS_TOKEN")
    if tok:
        return tok, "UPSTOX_ANALYTICS_TOKEN (.env.local)"
    tok = os.environ.get("UPSTOX_ACCESS_TOKEN", "").strip()
    if tok:
        return tok, "UPSTOX_ACCESS_TOKEN (env)"
    try:
        with open(os.path.join(ROOT, ".upstox_token"), "r", encoding="utf8") as fh:
            tok = fh.read().strip()
            if tok:
                return tok, ".upstox_token file"
    except OSError:
        pass
    return None, None


# ── HTTP ─────────────────────────────────────────────────────────────────────

class RangeTooBig(Exception):
    """The window exceeded the endpoint's per-request cap."""


class PlusRequired(Exception):
    """UDAPI1149 — the expired-instruments family needs an Upstox Plus plan."""


def _get(url, token):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    })
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf8"))


def _looks_like_range_error(body):
    low = (body or "").lower()
    return any(s in low for s in
               ("invalid range", "date range", "interval", "from_date", "to_date", "too large"))


def get_with_retry(url, token, tolerate_404=False):
    """GET with backoff. Range and entitlement errors raise at once — no retry helps."""
    delay = 1.0
    last = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return _get(url, token)
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf8", "replace")[:500]
            except Exception:                                    # noqa: BLE001
                pass
            last = f"HTTP {exc.code}: {body}"

            if "UDAPI1149" in body:
                raise PlusRequired(body) from exc
            if exc.code == 400 and _looks_like_range_error(body):
                raise RangeTooBig(body) from exc
            if exc.code == 404 and tolerate_404:
                return None
            if exc.code in (401, 403):
                raise SystemExit(
                    f"\n!!! Upstox rejected the token — {last}\n"
                    f"    Note the v3 historical endpoint 200s even on a garbage bearer,\n"
                    f"    so a 401 here is unambiguous: expired or wrong credential.\n"
                    f"    Log into the dashboard to mint a fresh one, or set\n"
                    f"    UPSTOX_ANALYTICS_TOKEN (1-year, market-data only).")
            if exc.code == 429:
                wait = delay * 4
                print(f"    rate limited, sleeping {wait:.0f}s", flush=True)
                time.sleep(wait)
            elif 500 <= exc.code < 600:
                time.sleep(delay)
            else:
                raise SystemExit(f"\n!!! Unrecoverable {last}\n    url: {url}")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = str(exc)
            time.sleep(delay)
        delay = min(delay * 2, 30)
        print(f"    retry {attempt}/{MAX_RETRIES} after {last}", flush=True)
    raise SystemExit(f"\n!!! Gave up after {MAX_RETRIES} attempts — {last}")


# ── Contract discovery ───────────────────────────────────────────────────────

def live_futures():
    """Unexpired NIFTY futures from the instrument master.

    Same filter as buildMaps() in app/lib/instrumentMaster.js. These are the only
    contracts the master knows — it is a list of what is tradeable TODAY, which
    is exactly why the expired-instruments API exists.
    """
    req = urllib.request.Request(MASTER_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=180) as res:
        rows = json.loads(gzip.decompress(res.read()).decode("utf8"))

    out = []
    for it in rows:
        if it.get("segment") != "NSE_FO" or it.get("instrument_type") != "FUT":
            continue
        under = (it.get("underlying_symbol") or it.get("asset_symbol") or "").upper()
        if under != UNDERLYING_SYM or not it.get("instrument_key") or not it.get("expiry"):
            continue
        out.append({
            "key": it["instrument_key"],
            "symbol": it.get("trading_symbol") or it["instrument_key"],
            "expiry": datetime.fromtimestamp(it["expiry"] / 1000, tz=IST).date(),
            "live": True,
        })
    out.sort(key=lambda c: c["expiry"])
    return out


def expired_expiries(token):
    """All expiry dates the expired-instruments API knows for the underlying."""
    url = f"{BASE_V2}/expired-instruments/expiries?instrument_key={urllib.parse.quote(UNDERLYING_KEY, safe='')}"
    data = get_with_retry(url, token)
    return sorted({date.fromisoformat(d) for d in (data or {}).get("data", []) if d})


def resolve_monthly_futures(token, expiries, from_date, skip_expiries):
    """Find, per calendar month, the expiry that actually has a FUTURE contract.

    DO NOT shortcut this to "last expiry of the month". The expiry list is
    dominated by weekly OPTION expiries, and a weekly can fall AFTER the monthly
    futures expiry inside the same month — April 2025 carries a 2025-04-30
    weekly after the 2025-04-24 futures expiry. Taking the max picks the weekly,
    future/contract returns nothing for it, and the entire month drops out of
    the chain: April 2025 silently vanished and its dates were served by the MAY
    contract, i.e. far-month OI standing in for front-month.

    So probe instead — newest candidate first, stop at the first that resolves.
    Costs one or two calls a month and cannot go stale the way a weekday rule
    does (NSE has already moved expiry day once).
    """
    by_month = defaultdict(list)
    for e in expiries:
        by_month[(e.year, e.month)].append(e)

    out, barren = [], []
    for k in sorted(by_month):
        cands = sorted(by_month[k], reverse=True)
        if max(cands) < from_date or max(cands) in skip_expiries:
            continue
        found = None
        for e in cands:
            if e in skip_expiries:
                found = "live"
                break
            found = expired_future_contract(token, e)
            time.sleep(SLEEP_BETWEEN)
            if found:
                break
        if found and found != "live":
            out.append(found)
        elif not found:
            barren.append(k)

    if barren:
        print(f"    !!! {len(barren)} month(s) have expiries but NO future contract: "
              + ", ".join(f"{y}-{m:02d}" for y, m in barren))
        print("    !!! those months will be missing from the series entirely.")
    out.sort(key=lambda c: c["expiry"])
    return out


def expired_future_contract(token, expiry):
    """Resolve one expired future contract → its expired_instrument_key.

    Returns None when the expiry has no future (a weekly option expiry that
    slipped through, or a month with no contract).
    """
    url = (f"{BASE_V2}/expired-instruments/future/contract"
           f"?instrument_key={urllib.parse.quote(UNDERLYING_KEY, safe='')}"
           f"&expiry_date={expiry.isoformat()}")
    data = get_with_retry(url, token, tolerate_404=True)
    rows = (data or {}).get("data") or []
    for r in rows:
        # The docs name expired_instrument_key as the field to use. The API
        # actually returns it as null and puts the composite key
        # ("NSE_FO|35089|28-11-2024") in instrument_key. Read both.
        key = r.get("expired_instrument_key") or r.get("instrument_key")
        if key:
            return {
                "key": key,
                "symbol": r.get("trading_symbol") or r.get("name") or key,
                "expiry": expiry,
                "live": False,
            }
    return None


def build_chain(token, from_date, to_date):
    """The front-month schedule: one contract per month, each with its date window.

    Window for expiry E_i is (E_{i-1}, E_i] — the day after the previous contract
    expires, through this one's expiry day inclusive.
    """
    print("Resolving the contract chain …", flush=True)

    live = live_futures()
    print(f"  instrument master : {len(live)} live NIFTY futures "
          f"({', '.join(c['symbol'] for c in live) or 'none'})")

    try:
        allx = expired_expiries(token)
    except PlusRequired as exc:
        raise SystemExit(
            "\n!!! The expired-instruments API needs an Upstox Plus subscription.\n"
            f"    {str(exc)[:200]}\n\n"
            "    WHAT THIS MEANS FOR THIS SCRIPT: a continuous 2022→today futures\n"
            "    series cannot be built without it. The instrument master carries\n"
            "    only the live contracts — about a quarter of history between them —\n"
            "    because expired contracts are removed from it.\n\n"
            "    Options:\n"
            "      1. Subscribe to Upstox Plus, then re-run.\n"
            "      2. Run with --live-only for the ~3 months the live contracts\n"
            "         cover. Real OI, but nowhere near enough to backtest on.\n"
            "      3. Use NIFTY SPOT (scripts/fetch_nifty_2min.py) — full history,\n"
            "         but NO open interest and NO volume, so it cannot feed an\n"
            "         OI-reversal strategy at all.\n") from exc

    print(f"  expiries API      : {len(allx)} expiries "
          f"({allx[0]} → {allx[-1]}) — mostly weekly options")

    live_expiries = {c["expiry"] for c in live}
    print("  probing each month for its futures expiry …", flush=True)
    chain = resolve_monthly_futures(token, allx, from_date, live_expiries)
    chain.extend(c for c in live if c["expiry"] >= from_date)
    chain.sort(key=lambda c: c["expiry"])

    # Attach each contract's front-month window.
    prev_expiry = None
    scheduled = []
    for c in chain:
        if prev_expiry is None:
            # No predecessor inside the API's retention, so the real front-month
            # start is unknown. Bound it to one roll period: without this the
            # window reaches back to --from and sweeps in months when this
            # contract was the FAR month, whose OI is a different order of
            # magnitude (4,650 against a 14M front-month median) and would look
            # to the strategy like an OI collapse.
            start = max(from_date, c["expiry"] - timedelta(days=FIRST_CONTRACT_DAYS))
        else:
            start = max(from_date, prev_expiry + timedelta(days=1))
        start = max(start, c["expiry"] - timedelta(days=MAX_CONTRACT_LIFE_DAYS))
        end = min(c["expiry"], to_date)
        prev_expiry = c["expiry"]
        if start > end or end < from_date:
            continue
        c = dict(c, win_from=start, win_to=end)
        scheduled.append(c)

    print(f"  chain             : {len(scheduled)} contracts "
          f"({sum(1 for c in scheduled if c['live'])} live, "
          f"{sum(1 for c in scheduled if not c['live'])} expired)")

    if scheduled:
        reach = scheduled[0]["win_from"]
        print(f"  series covers     : {reach} → {scheduled[-1]['win_to']}")
        if reach > from_date + timedelta(days=7):
            missing = (reach - from_date).days
            print(f"\n  !!! YOU ASKED FOR {from_date}, BUT THE SERIES STARTS {reach}")
            print(f"  !!! — {missing:,} days ({missing/365.25:.1f} years) short.")
            print("  !!! Upstox retains expired instruments for roughly two years; the")
            print("  !!! contracts before that are gone from the API, not merely paywalled.")
            print("  !!! No subscription recovers them. If the backtest needs a longer")
            print("  !!! sample, futures OI from this source cannot supply it.")
    print()
    return scheduled


# ── Candles ──────────────────────────────────────────────────────────────────

def ymd(d):
    return d.strftime("%Y-%m-%d")


def candle_url(contract, interval, to_d, from_d):
    """v3 for live contracts, v2 expired-instruments for dead ones.

    They are different products with different path grammar. v3 splits unit and
    value (/minutes/15/); v2 fuses them (/15minute/). Both return the 7-field row.
    """
    key = urllib.parse.quote(contract["key"], safe="")
    if contract["live"]:
        seg = "minutes/15" if interval == "15m" else "hours/1"
        return f"{BASE_V3}/historical-candle/{key}/{seg}/{ymd(to_d)}/{ymd(from_d)}"
    if interval != "15m":
        raise ValueError("expired contracts have no hourly interval; resample instead")
    return (f"{BASE_V2}/expired-instruments/historical-candle/{key}"
            f"/15minute/{ymd(to_d)}/{ymd(from_d)}")


def _check_truncation(got, window_start, window_end, label):
    """A range under the error cap but over the page size returns short, with a 200.

    The only way to see it is to compare what arrived against what was asked for.
    A short tail is usually a weekend or holiday; a wide one means days were
    silently skipped.
    """
    if not got:
        return
    stamps = [datetime.fromisoformat(c[0]).astimezone(IST).date() for c in got]
    newest, oldest = max(stamps), min(stamps)
    if (window_end - newest).days > 4:
        print(f"    !!! TRUNCATED {label}: asked to {window_end}, newest bar {newest} — "
              f"days in between were never fetched", flush=True)
    if (oldest - window_start).days > 4:
        print(f"    note {label}: oldest bar {oldest} vs requested {window_start} "
              f"(holiday run-in, usually harmless)", flush=True)


def fetch_contract(contract, interval, token):
    """Every bar for one contract's front-month window, paging if the cap bites."""
    rows = {}
    window_end = contract["win_to"]
    window_days = WINDOW_START_DAYS

    while window_end >= contract["win_from"]:
        window_start = max(contract["win_from"], window_end - timedelta(days=window_days - 1))
        try:
            data = get_with_retry(candle_url(contract, interval, window_end, window_start), token)
        except RangeTooBig as exc:
            if window_days <= WINDOW_MIN_DAYS:
                raise SystemExit(f"\n!!! Range rejected even at {window_days}d — {exc}")
            window_days = max(WINDOW_MIN_DAYS, window_days // 2)
            print(f"    range too big, shrinking to {window_days}d", flush=True)
            continue

        got = (data or {}).get("data", {}).get("candles") or []
        for c in got:
            if isinstance(c, list) and len(c) >= 6:
                rows[c[0]] = c
        _check_truncation(got, window_start, window_end, contract["symbol"])

        if window_start <= contract["win_from"]:
            break
        window_end = window_start - timedelta(days=1)
        time.sleep(SLEEP_BETWEEN)

    return rows


def download(chain, token, part_path, restart=False):
    """15-minute bars for the whole chain, checkpointed per contract."""
    done = {}
    if not restart:
        try:
            with open(part_path, "r", encoding="utf8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue            # torn last line from a hard kill
                    done[rec["contract"]] = rec
            if done:
                print(f"Resuming: {len(done)} contracts already checkpointed\n", flush=True)
        except OSError:
            pass

    part = open(part_path, "a", encoding="utf8")
    try:
        for i, c in enumerate(chain, 1):
            tag = f"[{i}/{len(chain)}] {c['symbol']:<24}"
            if c["symbol"] in done:
                print(f"  {tag} cached ({len(done[c['symbol']]['candles']):,} bars)", flush=True)
                continue

            rows = fetch_contract(c, "15m", token)
            oi_nonzero = sum(1 for r in rows.values() if len(r) >= 7 and (r[6] or 0) > 0)
            rec = {
                "contract": c["symbol"],
                "key": c["key"],
                "expiry": c["expiry"].isoformat(),
                "live": c["live"],
                "win_from": c["win_from"].isoformat(),
                "win_to": c["win_to"].isoformat(),
                "candles": list(rows.values()),
            }
            done[c["symbol"]] = rec
            part.write(json.dumps(rec) + "\n")
            part.flush()
            os.fsync(part.fileno())

            flag = "" if oi_nonzero == len(rows) else f"   <-- {len(rows) - oi_nonzero} ZERO-OI"
            if not rows:
                flag = "   <-- !!! NO DATA AT ALL — Upstox has no candles for this contract"
            print(f"  {tag} {c['win_from']} → {c['win_to']}  {len(rows):>5,} bars, "
                  f"{oi_nonzero:,} with OI{flag}", flush=True)
            time.sleep(SLEEP_BETWEEN)
    finally:
        part.close()

    empty = [c["symbol"] for c in chain
             if c["symbol"] in done and not done[c["symbol"]]["candles"]]
    if empty:
        print(f"\n!!! {len(empty)} contract(s) returned NO candles at any interval:")
        for sym in empty:
            print(f"!!!   {sym}")
        print("!!! This is an Upstox data hole, not a request error — the same call\n"
              "!!! shape returns data for neighbouring contracts. Those weeks are\n"
              "!!! simply absent from the series; see CALENDAR HOLES below.")
    return [done[c["symbol"]] for c in chain if c["symbol"] in done]


# ── Stitching ────────────────────────────────────────────────────────────────

def dedupe_shifted_grid(candles):
    """Collapse bars Upstox returns TWICE on a one-minute-shifted grid.

    The 24 APR 25 contract comes back with two interleaved 15-minute grids —
    09:15 AND 09:16, 09:30 AND 09:31, through 15:15 AND 15:16 — 51 bars for a
    25-bar session, carrying different volumes. Both are real aggregations over
    overlapping windows, so neither is corrupt on its own, but keeping both
    double-counts every session and scrambles the bar sequence a backtest walks.

    Bucket by (date, hour, minute // 15) and keep the bar on the canonical grid.
    BUCKETING, NOT A `minute % 15` FILTER: the Muhurat session runs on its own
    anchor (18:01, 18:16, 18:31, 18:46 on 2024-11-01), and a modulo test would
    silently delete a legitimate trading session along with the duplicates.

    Returns (kept, dropped_count).
    """
    def rank(t):
        # Canonical grid first; earlier stamp breaks a tie.
        return (0 if t.minute % 15 == 0 else 1, t)

    best = {}
    for c in candles:
        ts = datetime.fromisoformat(c[0]).astimezone(IST)
        slot = (ts.date(), ts.hour, ts.minute // 15)
        cur = best.get(slot)
        if cur is None or rank(ts) < rank(datetime.fromisoformat(cur[0]).astimezone(IST)):
            best[slot] = c
    return sorted(best.values(), key=lambda c: c[0]), len(candles) - len(best)


def stitch(records):
    """One continuous ascending series, deduped, with contract + is_roll_day.

    Windows are disjoint by construction, so a duplicate timestamp means two
    contracts claimed the same bar — a chain bug, not a data quirk. It is
    counted and reported rather than silently resolved.
    """
    bars = []
    collisions = 0
    shifted = 0
    seen = {}
    for rec in records:
        candles, dropped = dedupe_shifted_grid(rec["candles"])
        if dropped:
            print(f"  !!! {rec['contract']}: dropped {dropped} duplicate bars on a "
                  f"one-minute-shifted grid")
            shifted += dropped
        for c in candles:
            ts = datetime.fromisoformat(c[0]).astimezone(IST)
            oi = int(c[6]) if len(c) >= 7 and c[6] is not None else 0
            row = {
                "ts": ts,
                "open": float(c[1]), "high": float(c[2]),
                "low": float(c[3]), "close": float(c[4]),
                "volume": int(c[5] or 0), "oi": oi,
                "contract": rec["contract"],
            }
            if ts in seen:
                collisions += 1
                continue
            seen[ts] = row
            bars.append(row)

    bars.sort(key=lambda r: r["ts"])

    # First calendar day each contract appears in the STITCHED series — which is
    # not the contract's own first trading day. What matters to the backtest is
    # where the OI level discontinuity lands in this file.
    first_day = {}
    for b in bars:
        first_day.setdefault(b["contract"], b["ts"].date())
    for b in bars:
        b["is_roll_day"] = b["ts"].date() == first_day[b["contract"]]

    return bars, collisions, shifted


def hourly(bars):
    """Resample 15-minute bars to hourly, anchored to the 09:15 session open.

    Buckets run 09:15–10:15 … 14:15–15:15, then a 15:15 stub of one 15-minute
    bar, because a 6h15m session does not divide into hours.

    OI IS TAKEN AS THE LAST VALUE IN THE BUCKET, NOT SUMMED. Open interest is a
    level — contracts outstanding at a moment — not a flow like volume. Summing
    four 15-minute OI readings would report roughly 4x the real position and
    turn every hour into a fictitious OI explosion.
    """
    buckets = defaultdict(list)
    for b in bars:
        t = b["ts"]
        mins = (t.hour * 60 + t.minute) - (SESSION_OPEN.hour * 60 + SESSION_OPEN.minute)
        if mins < 0:
            slot = t.replace(second=0, microsecond=0)        # pre-open oddity, keep as-is
        else:
            start = (SESSION_OPEN.hour * 60 + SESSION_OPEN.minute) + (mins // 60) * 60
            slot = t.replace(hour=start // 60, minute=start % 60, second=0, microsecond=0)
        buckets[slot].append(b)

    out = []
    for slot in sorted(buckets):
        group = sorted(buckets[slot], key=lambda r: r["ts"])
        out.append({
            "ts": slot,
            "open": group[0]["open"],
            "high": max(g["high"] for g in group),
            "low": min(g["low"] for g in group),
            "close": group[-1]["close"],
            "volume": sum(g["volume"] for g in group),
            "oi": group[-1]["oi"],                     # a level, not a flow
            "contract": group[-1]["contract"],
            "is_roll_day": any(g["is_roll_day"] for g in group),
        })
    return out


# ── CSV ──────────────────────────────────────────────────────────────────────

COLUMNS = ["timestamp", "date", "open", "high", "low", "close",
           "volume", "open_interest", "contract", "is_roll_day"]


def write_csv(bars, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf8") as fh:
        w = csv.writer(fh)
        w.writerow(COLUMNS)
        for b in bars:
            w.writerow([
                b["ts"].strftime("%Y-%m-%d %H:%M:%S"),
                b["ts"].strftime("%Y-%m-%d"),
                b["open"], b["high"], b["low"], b["close"],
                b["volume"], b["oi"], b["contract"],
                "true" if b["is_roll_day"] else "false",
            ])
    return path


def read_csv(path):
    bars = []
    with open(path, "r", encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            bars.append({
                "ts": datetime.strptime(r["timestamp"], "%Y-%m-%d %H:%M:%S"),
                "open": float(r["open"]), "high": float(r["high"]),
                "low": float(r["low"]), "close": float(r["close"]),
                "volume": int(float(r["volume"])), "oi": int(float(r["open_interest"])),
                "contract": r["contract"], "is_roll_day": r["is_roll_day"] == "true",
            })
    bars.sort(key=lambda b: b["ts"])
    return bars


# ── Integrity ────────────────────────────────────────────────────────────────

def expected_grid(minutes):
    out, t = [], datetime(2000, 1, 1, SESSION_OPEN.hour, SESSION_OPEN.minute)
    end = datetime(2000, 1, 1, SESSION_CLOSE.hour, SESSION_CLOSE.minute)
    while t < end:
        out.append(t.time())
        t += timedelta(minutes=minutes)
    return out


def verify(bars, label, minutes, collisions=0, shifted=0):
    line = "─" * 78
    print("\n" + line + f"\nINTEGRITY REPORT — {label}\n" + line)
    if not bars:
        print("!!! NO ROWS AT ALL.")
        return False

    days = sorted({b["ts"].date() for b in bars})
    contracts = []
    for b in bars:
        if not contracts or contracts[-1] != b["contract"]:
            contracts.append(b["contract"])

    print(f"\nRows             : {len(bars):,}")
    print(f"First / last     : {bars[0]['ts']:%Y-%m-%d %H:%M} → {bars[-1]['ts']:%Y-%m-%d %H:%M} IST")
    print(f"Trading days     : {len(days):,}  ({days[0]} → {days[-1]})")
    print(f"Contracts stitched: {len(contracts)}   rolls: {max(0, len(contracts) - 1)}")

    dupes = len(bars) - len({b["ts"] for b in bars})
    print(f"Duplicate stamps : {dupes}" + ("   <-- !!!" if dupes else ""))
    if collisions:
        print(f"    !!! {collisions} bars dropped as cross-contract timestamp collisions —")
        print("    !!! the front-month windows overlap. The chain is wrong; do not backtest.")
    if shifted:
        print(f"Shifted-grid bars: {shifted} dropped   (Upstox returned a second, "
              f"1-minute-offset\n                   15-min grid for at least one contract; "
              f"kept the canonical one)")

    # ── OI, the whole point ──────────────────────────────────────────────
    ois = [b["oi"] for b in bars]
    zero = sum(1 for o in ois if o == 0)
    pct_zero = zero / len(ois) * 100
    nonzero = [o for o in ois if o > 0]
    print(f"\nOPEN INTEREST")
    print(f"  zero-OI bars   : {zero:,} of {len(ois):,}  ({pct_zero:.2f}%)")
    if pct_zero > 5:
        print("    !!! OI IS MOSTLY/PARTLY ZERO. Either the fetch grabbed spot (which has")
        print("    !!! no OI), or the 7th field was dropped. This data CANNOT feed an")
        print("    !!! OI-reversal strategy. Do not proceed.")
    if nonzero:
        print(f"  min / median / max : {min(nonzero):,} / "
              f"{int(statistics.median(nonzero)):,} / {max(nonzero):,}")
    else:
        print("    !!! NOT A SINGLE NON-ZERO OI BAR.")

    # Zeros scattered through a day are one thing; a whole session with OI=0 on
    # every bar while volume prints normally is Upstox failing to populate the
    # field. For an OI strategy those days are unusable and must be dropped —
    # OI=0 is not "no open interest", it is "no data".
    per_day = defaultdict(list)
    for b in bars:
        per_day[b["ts"].date()].append(b["oi"])
    dead = sorted(d for d, v in per_day.items() if v and not any(v))
    if dead:
        print(f"  DAYS WITH NO OI AT ALL : {len(dead)}   <-- !!!")
        for d in dead:
            vol = sum(b["volume"] for b in bars if b["ts"].date() == d)
            print(f"    !!! {d}  every bar OI=0, yet volume {vol:,} — the field was")
            print(f"    !!!            not populated. EXCLUDE this day from the backtest.")

    # ── Roll boundaries ──────────────────────────────────────────────────
    roll_days = sorted({b["ts"].date() for b in bars if b["is_roll_day"]})
    print(f"\nROLLS")
    print(f"  is_roll_day days : {len(roll_days)}")
    idx = {}
    for i, b in enumerate(bars):
        idx.setdefault(b["contract"], i)
    starts = sorted(idx.values())[1:]        # skip the first contract
    print(f"  showing OI either side of the first 3 rolls "
          f"(a jump here is EXPECTED — it is a new contract's book):")
    for s in starts[:3]:
        print(f"\n    ── roll into {bars[s]['contract']} ──")
        for j in range(max(0, s - 2), min(len(bars), s + 3)):
            b = bars[j]
            mark = "  <== first bar of the new contract" if j == s else ""
            print(f"      {b['ts']:%Y-%m-%d %H:%M}  {b['contract']:<22} "
                  f"C{b['close']:>10,.2f}  OI {b['oi']:>12,}{mark}")

    # Within a contract, OI should evolve smoothly. A big intra-contract jump is
    # the thing that would fool the strategy, so it gets its own count.
    # Overnight and intraday are different animals. OI unwinding hard between
    # sessions as expiry nears is the market rolling out — expected. A 25% move
    # WITHIN a session is the one that would look like a signal and isn't.
    overnight, intraday = [], []
    for i in range(1, len(bars)):
        p, c = bars[i - 1], bars[i]
        if p["contract"] != c["contract"] or p["oi"] <= 0 or c["oi"] <= 0:
            continue
        chg = (c["oi"] - p["oi"]) / p["oi"] * 100      # SIGNED — a fall must read as one
        if abs(chg) > 25:
            (overnight if p["ts"].date() != c["ts"].date() else intraday).append(
                (c["ts"], p["oi"], c["oi"], chg))
    print(f"\n  intra-contract OI moves >25%")
    print(f"    across sessions : {len(overnight)}   (roll-out near expiry — expected)")
    for ts, a, b_, chg in overnight[:5]:
        print(f"      {ts:%Y-%m-%d %H:%M}  {a:,} → {b_:,}  ({chg:+.1f}%)")
    print(f"    WITHIN a session: {len(intraday)}"
          + ("   <-- !!! these would look like signals" if intraday else ""))
    for ts, a, b_, chg in intraday[:10]:
        print(f"      !!! {ts:%Y-%m-%d %H:%M}  {a:,} → {b_:,}  ({chg:+.1f}%)")

    # ── Bad candles ──────────────────────────────────────────────────────
    bad = []
    for b in bars:
        why = []
        if b["high"] < b["low"]:
            why.append("high<low")
        if b["high"] < b["open"] or b["high"] < b["close"]:
            why.append("high<open/close")
        if b["low"] > b["open"] or b["low"] > b["close"]:
            why.append("low>open/close")
        if why:
            bad.append((b, ",".join(why)))
    print(f"\nBad OHLC bars    : {len(bad)}")
    for b, why in bad[:20]:
        print(f"    !!! {b['ts']:%Y-%m-%d %H:%M}  O{b['open']} H{b['high']} "
              f"L{b['low']} C{b['close']}  [{why}]")

    # ── Session grid ─────────────────────────────────────────────────────
    grid = expected_grid(minutes)
    by_day = defaultdict(set)
    off = []
    for b in bars:
        by_day[b["ts"].date()].add(b["ts"].time())
        if not (SESSION_OPEN <= b["ts"].time() < SESSION_CLOSE):
            off.append(b["ts"])

    short = [(d, len(by_day[d]), [t for t in grid if t not in by_day[d]])
             for d in days if any(t not in by_day[d] for t in grid)]
    # A day holding only a handful of bars is a SPECIAL SESSION, not a hole:
    # Muhurat ran 18:01–18:46 on 2024-11-01 and 13:45–14:30 on 2025-10-21. Both
    # are complete sessions that happen to be an hour long. Calling them severe
    # data loss trains you to ignore the one that eventually is.
    special = [x for x in short if x[1] <= max(2, len(grid) // 3)]
    partial = [x for x in short if x not in special]
    severe = [x for x in partial if len(x[2]) > max(2, len(grid) // 5)]

    # ── Calendar holes ───────────────────────────────────────────────────
    # The grid check below only walks days present in the file, so an entire
    # missing month scores zero complaints there. This walks the calendar.
    holes = []
    for i in range(1, len(days)):
        gap = (days[i] - days[i - 1]).days
        if gap > 4:                       # a long weekend plus a holiday or two
            holes.append((days[i - 1], days[i], gap))
    print(f"\nCALENDAR HOLES (>4 days with no bars at all)")
    print(f"  count          : {len(holes)}" + ("   <-- !!!" if holes else ""))
    for a, b, g in holes[:15]:
        print(f"    !!! {a} → {b}   {g} days missing "
              f"(~{g * 5 // 7} trading days)")

    # A month whose contract is absent shows up as consecutive contracts more
    # than a roll apart. Those dates get served by a FARTHER contract, so the OI
    # is the wrong book — not merely thin.
    spans = []
    for i in range(1, len(contracts)):
        a = max(b["ts"].date() for b in bars if b["contract"] == contracts[i - 1])
        b_ = min(b["ts"].date() for b in bars if b["contract"] == contracts[i])
        if (b_ - a).days > 45:
            spans.append((contracts[i - 1], a, contracts[i], b_))
    print(f"  contract gaps  : {len(spans)}" + ("   <-- !!!" if spans else ""))
    for ca, a, cb, b_ in spans[:10]:
        print(f"    !!! {ca} ends {a}, {cb} starts {b_} — "
              f"{(b_ - a).days} days with no front-month contract")

    print(f"\nBAR ALIGNMENT")
    print(f"  expected/day   : {len(grid)}  ({grid[0]:%H:%M} … {grid[-1]:%H:%M}, "
          f"stamped at bar START)")
    if minutes == 60:
        print("  NOTE: 09:15–15:30 is 6h15m, so the 15:15 bar is a 15-MINUTE STUB,")
        print("        not a full hour. Bar-count logic in the strategy must expect 7/day.")
    else:
        print("  NOTE: 15-minute divides the session exactly — 25 bars, no stub bar.")
    print(f"  days short     : {len(short)} of {len(days)}   "
          f"special sessions: {len(special)}   SEVERE: {len(severe)}"
          + ("   <-- !!!" if severe else ""))
    for d, have, _m in special[:10]:
        times = sorted(by_day[d])
        print(f"      {d}  {have} bars {times[0]:%H:%M}–{times[-1]:%H:%M}  "
              f"(special session — complete, just short)")
    for d, have, miss in severe[:20]:
        print(f"    !!! {d}  {have}/{len(grid)}  missing {len(miss)} "
              f"({miss[0]:%H:%M}–{miss[-1]:%H:%M})")

    # The feed gained an extra closing bar partway through the sample. Bar-count
    # logic that assumes a fixed bars-per-day will break across that date.
    extra = sorted({b["ts"].date() for b in bars if b["ts"].time() == SESSION_CLOSE})
    if extra:
        regular = [d for d in extra if len(by_day[d]) > len(grid) // 2]
        print(f"\n  bars stamped exactly {SESSION_CLOSE:%H:%M} : {len(extra)} day(s)")
        if regular:
            print(f"      from {regular[0]} onward the feed carries a {len(grid) + 1}th bar "
                  f"at {SESSION_CLOSE:%H:%M};")
            print(f"      before that date it does not. Anything counting bars per day "
                  f"must handle both.")
    if off:
        by_time = defaultdict(list)
        for t in off:
            by_time[t.time()].append(t)
        print(f"  bars outside 09:15–15:30 : {len(off)}, grouped by time of day:")
        for tm in sorted(by_time):
            ds = sorted({t.date() for t in by_time[tm]})
            note = ""
            if tm < SESSION_OPEN:
                note = "  <-- !!! before the open; NSE does not trade then — artifact"
            elif tm == SESSION_CLOSE:
                note = "  (closing bar — see BAR ALIGNMENT below)"
            elif tm >= dtime(17, 0):
                note = "  (Muhurat evening session — real)"
            print(f"      {tm:%H:%M}  {len(by_time[tm]):>3} bars over {len(ds)} day(s) "
                  f"[{ds[0]} … {ds[-1]}]{note}")

    preopen = [t for t in off if t.time() < SESSION_OPEN]
    serious = bool(bad or dupes or collisions or severe or pct_zero > 5
                   or holes or spans or intraday or preopen or dead)
    print("\n" + line)
    print("VERDICT: !!! PROBLEMS FOUND — read the !!! lines before backtesting."
          if serious else
          "VERDICT: OI present throughout, no bad candles, no duplicate stamps,\n"
          "         no severe session gaps. Rolls are flagged; OI jumps at them\n"
          "         are expected and must be excluded from reversal logic.")
    print(line)
    return not serious


# ── Probe ────────────────────────────────────────────────────────────────────

def probe(token):
    """Cheap pre-flight: entitlement, history depth, OI presence, hourly alignment."""
    line = "─" * 78
    print(line + "\nPROBE\n" + line)

    live = live_futures()
    print(f"\nLive contracts in master : {len(live)}")
    for c in live:
        print(f"  {c['key']:<16} {c['symbol']:<24} expires {c['expiry']}")

    print("\nExpired-instruments entitlement …")
    try:
        exps = expired_expiries(token)
    except PlusRequired:
        print("  !!! UDAPI1149 — NOT SUBSCRIBED to Upstox Plus.")
        print("  !!! A continuous 2022→today futures series is NOT POSSIBLE on this")
        print("  !!! account: expired contracts are the only source, and they are")
        print("  !!! gated. See the module docstring for the three options.")
        return False
    monthlies = monthly_expiries(exps)
    print(f"  OK — {len(exps)} expiries, {len(monthlies)} monthly, "
          f"{monthlies[0]} → {monthlies[-1]}")
    print(f"  earliest monthly expiry is {monthlies[0]}; anything before that is "
          f"out of reach\n  regardless of subscription.")

    if not live:
        return False

    # Native v3 hourly vs 15-minute resampled, on the same live contract.
    c = live[0]
    today = datetime.now(IST).date()
    win_from, win_to = today - timedelta(days=10), today
    c = dict(c, win_from=win_from, win_to=win_to)

    print(f"\nSampling {c['symbol']} {win_from} → {win_to} …")
    m15 = fetch_contract(c, "15m", token)
    h1 = fetch_contract(c, "1h", token)
    print(f"  15-minute : {len(m15):,} bars, fields/row {len(next(iter(m15.values()), []))}")
    print(f"  hourly    : {len(h1):,} bars, fields/row {len(next(iter(h1.values()), []))}")

    oi15 = [int(r[6]) for r in m15.values() if len(r) >= 7 and r[6] is not None]
    print(f"  OI present on {len(oi15):,}/{len(m15):,} 15-min bars; "
          f"non-zero {sum(1 for o in oi15 if o > 0):,}")
    if oi15:
        print(f"  OI min/median/max {min(oi15):,} / {int(statistics.median(oi15)):,} / {max(oi15):,}")

    stitched, _, _ = stitch([{"contract": c["symbol"], "candles": list(m15.values())}])
    resampled = {b["ts"]: b for b in hourly(stitched)}
    native = {}
    for r in h1.values():
        ts = datetime.fromisoformat(r[0]).astimezone(IST)
        native[ts] = {"close": float(r[4]), "oi": int(r[6]) if len(r) >= 7 else 0}

    common = sorted(set(resampled) & set(native))
    print(f"\nHourly cross-check — resampled vs native v3 ({len(common)} shared bars):")
    mism = 0
    for ts in common[:8]:
        a, b = resampled[ts], native[ts]
        same = abs(a["close"] - b["close"]) < 0.05 and a["oi"] == b["oi"]
        mism += 0 if same else 1
        print(f"  {ts:%Y-%m-%d %H:%M}  resampled C{a['close']:>10,.2f} OI {a['oi']:>11,}"
              f"   native C{b['close']:>10,.2f} OI {b['oi']:>11,}  {'ok' if same else '<-- DIFFERS'}")
    if not common:
        print("  !!! no overlapping bars — the two grids are anchored differently.")
    print(line)
    return True


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="from_date", default=V3_EPOCH, help="YYYY-MM-DD")
    ap.add_argument("--to", dest="to_date", default=None, help="YYYY-MM-DD (default today)")
    ap.add_argument("--outdir", default=DEFAULT_OUTDIR)
    ap.add_argument("--probe", action="store_true",
                    help="check access, OI and hourly alignment in ~6 calls, then exit")
    ap.add_argument("--live-only", action="store_true",
                    help="skip expired contracts (no Plus plan) — only ~3 months of data")
    ap.add_argument("--restart", action="store_true", help="discard the checkpoint")
    ap.add_argument("--verify-only", action="store_true", help="re-check existing CSVs")
    args = ap.parse_args()

    out15 = os.path.join(args.outdir, "nifty_fut_15m_oi.csv")
    out1h = os.path.join(args.outdir, "nifty_fut_1h_oi.csv")

    if args.verify_only:
        ok = verify(read_csv(out15), "15-MINUTE", 15)
        ok = verify(read_csv(out1h), "HOURLY", 60) and ok
        sys.exit(0 if ok else 1)

    token, source = resolve_token()
    if not token:
        raise SystemExit(
            "!!! No Upstox token. Set UPSTOX_ANALYTICS_TOKEN (env or .env.local),\n"
            "    or UPSTOX_ACCESS_TOKEN, or drop one in .upstox_token.")

    if args.probe:
        sys.exit(0 if probe(token) else 1)

    from_date = date.fromisoformat(args.from_date)
    epoch = date.fromisoformat(V3_EPOCH)
    if from_date < epoch:
        print(f"Clamping --from to {V3_EPOCH}: no sub-daily data before it.")
        from_date = epoch
    to_date = date.fromisoformat(args.to_date) if args.to_date else datetime.now(IST).date()

    print(f"Underlying : {UNDERLYING_KEY}  (FUTURES — spot has no OI)")
    print(f"Range      : {from_date} → {to_date}")
    print(f"Token      : {source}")
    print(f"Output     : {out15}\n             {out1h}\n")

    if args.live_only:
        chain = [c for c in live_futures() if c["expiry"] >= from_date]
        prev = None
        sched = []
        for c in chain:
            start = from_date if prev is None else max(from_date, prev + timedelta(days=1))
            prev = c["expiry"]
            end = min(c["expiry"], to_date)
            if start <= end:
                sched.append(dict(c, win_from=start, win_to=end))
        chain = sched
        print("!!! --live-only: expired contracts skipped. This covers only what the\n"
              "!!! live contracts hold — nowhere near enough history to backtest on.\n")
    else:
        chain = build_chain(token, from_date, to_date)

    if not chain:
        raise SystemExit("!!! No contracts resolved for that range.")

    part_path = os.path.join(args.outdir, ".nifty_fut_oi.partial.jsonl")
    os.makedirs(args.outdir, exist_ok=True)
    if args.restart:
        try:
            os.remove(part_path)
        except OSError:
            pass

    print("Fetching 15-minute candles per contract …")
    records = download(chain, token, part_path, restart=args.restart)
    if not records:
        raise SystemExit("!!! Nothing downloaded.")

    bars, collisions, shifted = stitch(records)
    write_csv(bars, out15)
    print(f"\nWrote {len(bars):,} rows → {out15}")

    hrs = hourly(bars)
    write_csv(hrs, out1h)
    print(f"Wrote {len(hrs):,} rows → {out1h}   (resampled from 15-minute — the")
    print("       expired-contract endpoint has no hourly interval; see --probe)")

    ok = verify(bars, "15-MINUTE", 15, collisions, shifted)
    ok = verify(hrs, "HOURLY (resampled)", 60, collisions, shifted) and ok
    print(f"\nCheckpoint kept at {part_path}  (--restart to force a clean re-download)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
