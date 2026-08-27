#!/usr/bin/env python3
"""Download NIFTY 2-minute candles from Upstox v3 into a backtest CSV.

Data source
-----------
The series is NIFTY SPOT (``NSE_INDEX|Nifty 50``), not futures. A 2-minute
backtest spanning 2022→today crosses ~55 monthly contracts, and a raw futures
key dies with its expiry, so a continuous futures series has to be stitched —
each splice injecting a fake gap at the roll. The strategy this feeds is
intraday-only (no overnight holds), so spot is a clean, gap-free approximation
and the roll problem disappears entirely.

WHAT SPOT COSTS YOU, and it is not nothing:
  • VOLUME IS ZERO on the index. Any volume filter in the strategy is dead.
  • No futures basis, so entries/exits are index points, not tradeable prices.
The front-month futures resolver lives below (--resolve-futures) if you later
want to spot-check a stretch of index data against the actual contract.

Endpoint, and its limits
------------------------
  GET /v3/historical-candle/{key}/minutes/2/{to_date}/{from_date}
Sub-daily data begins 2022-01-01; earlier dates return nothing. The per-request cap is
one calendar month for a 2-minute interval (probed — see WINDOW_START_DAYS), so
this pages BACKWARD in 28-day windows, halving if a range error ever appears.
Backward so an interrupted run still holds the RECENT bars — the same reasoning
as getHourlyCandles() in app/lib/upstox.js.

Resumable: every window is appended to a .partial.jsonl checkpoint as it
lands, so a failure 3 hours in costs one window, not the run. Re-running
resumes below the last cursor. --restart throws the checkpoint away.

Usage
-----
  python3 scripts/fetch_nifty_2min.py                  # full 2022-01-01 → today
  python3 scripts/fetch_nifty_2min.py --from 2024-01-01
  python3 scripts/fetch_nifty_2min.py --verify-only    # re-run the checks on the CSV
  python3 scripts/fetch_nifty_2min.py --resolve-futures

Token: UPSTOX_ANALYTICS_TOKEN, else .env.local, else UPSTOX_ACCESS_TOKEN, else
.upstox_token — the same order app/lib/upstox.js resolves in.
"""

import argparse
import csv
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, time as dtime, timedelta, timezone

# ── Config ───────────────────────────────────────────────────────────────────

BASE_V3 = "https://api.upstox.com/v3"
MASTER_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"

SPOT_KEY = "NSE_INDEX|Nifty 50"
INTERVAL_MINUTES = 2
V3_EPOCH = "2022-01-01"          # no sub-daily data before this

# Probed against the live endpoint, not guessed. The cap is ONE CALENDAR MONTH,
# which is not the same as 30 days and is why 28 is the number here:
#
#   2025-02-04 → 2025-03-05  (30d)  400 UDAPI1148 "Invalid date range"
#   2025-02-04 → 2025-03-04  (29d)  OK   — exactly one month
#   2024-07-09 → 2024-08-07  (30d)  OK   — 30d only fits in a LONG month
#
# A February-spanning window is the trap: "one month" from a Feb date is 28
# days, so a fixed 30-day walk sails along for a year and then trips. 28 days
# is inside one calendar month from ANY start date, so it never trips.
#
# Separately, a range over the cap but still inside a month does NOT error — it
# silently returns only the first 30 days (2025-05-15→06-14 came back ending
# 06-13). In a backward walk that would punch invisible holes, so
# _check_truncation() below watches for it regardless.
WINDOW_START_DAYS = 28
WINDOW_MIN_DAYS = 5              # below this, treat the failure as real
SLEEP_BETWEEN = 0.35             # be a good citizen; Upstox rate-limits bursts
MAX_RETRIES = 5

IST = timezone(timedelta(hours=5, minutes=30))

# NSE regular session. The 2-min grid is stamped at bar START, so the last bar
# of a day opens 15:29 and is a 1-minute stub.
SESSION_OPEN = dtime(9, 15)
SESSION_CLOSE = dtime(15, 30)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "data", "exports", "nifty_2min.csv")

USER_AGENT = "nse-dashboard-backtest-fetch/1.0"


# ── Token ────────────────────────────────────────────────────────────────────

def _from_env_file(path, key):
    """Pull one key out of a .env file. No dependency on python-dotenv."""
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
    """The window exceeded whatever the endpoint's per-request cap is."""


def _get(url, token):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    })
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf8"))


def get_with_retry(url, token):
    """GET with backoff. Range errors raise immediately — retrying won't help."""
    delay = 1.0
    last = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return _get(url, token)
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf8", "replace")[:400]
            except Exception:                                    # noqa: BLE001
                pass
            last = f"HTTP {exc.code}: {body}"

            if exc.code == 400 and _looks_like_range_error(body):
                raise RangeTooBig(body) from exc
            if exc.code in (401, 403):
                raise SystemExit(f"\n!!! Upstox rejected the token — {last}\n"
                                 f"    Historical v3 can 200 on a bad token, so a 401 here "
                                 f"is unambiguous: the credential is wrong or expired.")
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


def _looks_like_range_error(body):
    low = (body or "").lower()
    return any(s in low for s in
               ("invalid range", "date range", "interval", "from_date", "to_date", "too large"))


# ── Instrument master (futures resolver) ─────────────────────────────────────

def front_month_future(underlying="NIFTY"):
    """Nearest unexpired NSE_FO/FUT contract for an underlying.

    Same filter as buildMaps() in app/lib/instrumentMaster.js: segment NSE_FO,
    instrument_type FUT, matched on underlying_symbol, chain sorted by the
    master's own expiry epoch. No last-Thursday/Tuesday arithmetic — NSE moved
    that day once already and code that computes it goes stale silently.
    """
    print(f"Fetching instrument master … ({MASTER_URL})", flush=True)
    req = urllib.request.Request(MASTER_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as res:
        rows = json.loads(gzip.decompress(res.read()).decode("utf8"))

    want = underlying.upper()
    chain = []
    for it in rows:
        if it.get("segment") != "NSE_FO" or it.get("instrument_type") != "FUT":
            continue
        under = (it.get("underlying_symbol") or it.get("asset_symbol") or "").upper()
        if under != want or not it.get("instrument_key") or not it.get("expiry"):
            continue
        chain.append(it)

    chain.sort(key=lambda r: r["expiry"])
    now_ms = time.time() * 1000
    live = [c for c in chain if c["expiry"] >= now_ms]

    print(f"  {len(chain)} {want} futures in the master, {len(live)} unexpired")
    for c in live[:4]:
        exp = datetime.fromtimestamp(c["expiry"] / 1000, tz=IST).strftime("%Y-%m-%d")
        print(f"    {c['instrument_key']:<16} {c['trading_symbol']:<20} expires {exp} "
              f"lot {c.get('lot_size')}")
    return live[0] if live else None


# ── Download ─────────────────────────────────────────────────────────────────

def ymd(d):
    return d.strftime("%Y-%m-%d")


def candle_url(key, to_d, from_d):
    return (f"{BASE_V3}/historical-candle/{urllib.parse.quote(key, safe='')}"
            f"/minutes/{INTERVAL_MINUTES}/{ymd(to_d)}/{ymd(from_d)}")


def _check_truncation(got, window_start, window_end):
    """Warn if the API returned less than the window we asked for.

    A 31-day request comes back truncated with a 200 and no error, so the only
    way to notice is to compare what arrived against what was requested. A short
    tail is usually just a weekend or a holiday; anything wider means the walk
    is about to step over days that were never fetched.
    """
    if not got:
        return
    stamps = [datetime.fromisoformat(c[0]).astimezone(IST).date() for c in got]
    newest, oldest = max(stamps), min(stamps)
    if (window_end - newest).days > 4:
        print(f"    !!! TRUNCATED: asked to {window_end}, newest bar is {newest}. "
              f"Shrink the window — days in between were never fetched.", flush=True)
    if (oldest - window_start).days > 4:
        print(f"    note: oldest bar {oldest} vs requested {window_start} "
              f"(holiday run-in, usually harmless)", flush=True)


def load_checkpoint(part_path, prog_path):
    """Return (rows_by_ts, cursor_date_or_None)."""
    rows = {}
    try:
        with open(part_path, "r", encoding="utf8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    c = json.loads(line)
                except json.JSONDecodeError:
                    continue          # a torn last line from a hard kill
                if isinstance(c, list) and len(c) >= 6:
                    rows[c[0]] = c
    except OSError:
        return {}, None

    cursor = None
    try:
        with open(prog_path, "r", encoding="utf8") as fh:
            cur = json.load(fh).get("cursor")
            if cur:
                cursor = date.fromisoformat(cur)
    except (OSError, ValueError, json.JSONDecodeError):
        cursor = None
    return rows, cursor


def download(key, token, from_date, to_date, part_path, prog_path):
    rows, cursor = load_checkpoint(part_path, prog_path)
    if rows:
        print(f"Resuming: {len(rows):,} bars already checkpointed"
              f"{f', cursor {cursor}' if cursor else ''}\n", flush=True)

    window_end = cursor - timedelta(days=1) if cursor else to_date
    window_days = WINDOW_START_DAYS
    requests_made = 0
    empty_streak = 0

    part = open(part_path, "a", encoding="utf8")
    try:
        while window_end >= from_date:
            window_start = max(from_date, window_end - timedelta(days=window_days - 1))

            try:
                data = get_with_retry(candle_url(key, window_end, window_start), token)
            except RangeTooBig as exc:
                if window_days <= WINDOW_MIN_DAYS:
                    raise SystemExit(f"\n!!! Range rejected even at {window_days}d — {exc}")
                window_days = max(WINDOW_MIN_DAYS, window_days // 2)
                print(f"  range too big, shrinking window to {window_days}d and retrying",
                      flush=True)
                continue                       # same window_end, smaller bite

            requests_made += 1
            got = (data or {}).get("data", {}).get("candles") or []
            fresh = 0
            for c in got:
                if isinstance(c, list) and len(c) >= 6 and c[0] not in rows:
                    rows[c[0]] = c
                    part.write(json.dumps(c) + "\n")
                    fresh += 1
            part.flush()
            os.fsync(part.fileno())

            with open(prog_path, "w", encoding="utf8") as fh:
                json.dump({"cursor": ymd(window_start), "instrument": key,
                           "rows": len(rows)}, fh)

            _check_truncation(got, window_start, window_end)
            print(f"  {ymd(window_start)} → {ymd(window_end)}  "
                  f"{len(got):>6,} bars ({fresh:,} new)   total {len(rows):,}", flush=True)

            # 2022 windows can legitimately be thin, but a long empty streak
            # means we are below the data's real start — stop wasting calls.
            empty_streak = empty_streak + 1 if not got else 0
            if empty_streak >= 4:
                print("  4 empty windows in a row — assuming we are past the "
                      "earliest available data, stopping", flush=True)
                break

            if window_start <= from_date:
                break
            window_end = window_start - timedelta(days=1)
            time.sleep(SLEEP_BETWEEN)
    finally:
        part.close()

    print(f"\nDownload finished: {requests_made} requests, {len(rows):,} unique bars")
    return rows


# ── CSV ──────────────────────────────────────────────────────────────────────

def write_csv(rows, out_path):
    """Ascending, deduped, IST wall-clock timestamps."""
    parsed = []
    for ts, o, h, l, c, v, *_ in rows.values():
        dt = datetime.fromisoformat(ts).astimezone(IST)
        parsed.append((dt, float(o), float(h), float(l), float(c), int(v or 0)))
    parsed.sort(key=lambda r: r[0])

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf8") as fh:
        w = csv.writer(fh)
        w.writerow(["time", "open", "high", "low", "close", "volume"])
        for dt, o, h, l, c, v in parsed:
            w.writerow([dt.strftime("%Y-%m-%d %H:%M:%S"), o, h, l, c, v])
    return parsed


def read_csv(out_path):
    parsed = []
    with open(out_path, "r", encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            parsed.append((datetime.strptime(r["time"], "%Y-%m-%d %H:%M:%S"),
                           float(r["open"]), float(r["high"]), float(r["low"]),
                           float(r["close"]), int(float(r["volume"]))))
    parsed.sort(key=lambda r: r[0])
    return parsed


# ── Integrity ────────────────────────────────────────────────────────────────

def expected_grid():
    """2-min bar STARTS across a regular session: 09:15 … 15:29 (188 bars)."""
    out, t = [], datetime(2000, 1, 1, SESSION_OPEN.hour, SESSION_OPEN.minute)
    end = datetime(2000, 1, 1, SESSION_CLOSE.hour, SESSION_CLOSE.minute)
    while t < end:
        out.append(t.time())
        t += timedelta(minutes=INTERVAL_MINUTES)
    return out


def verify(parsed):
    """Print the integrity report. Returns True if nothing serious was found."""
    line = "─" * 78
    print("\n" + line + "\nINTEGRITY REPORT\n" + line)

    if not parsed:
        print("!!! NO ROWS AT ALL.")
        return False

    # ── Shape ────────────────────────────────────────────────────────────
    print(f"\nRows            : {len(parsed):,}")
    print(f"First timestamp : {parsed[0][0]:%Y-%m-%d %H:%M:%S} IST")
    print(f"Last timestamp  : {parsed[-1][0]:%Y-%m-%d %H:%M:%S} IST")
    days = sorted({r[0].date() for r in parsed})
    print(f"Trading days    : {len(days):,}  ({days[0]} → {days[-1]})")

    dupes = len(parsed) - len({r[0] for r in parsed})
    print(f"Duplicate stamps: {dupes}" + ("   <-- !!!" if dupes else ""))

    lows = [r[3] for r in parsed]
    highs = [r[2] for r in parsed]
    print(f"Price min/max   : {min(lows):,.2f} / {max(highs):,.2f}")

    vol_total = sum(r[5] for r in parsed)
    print(f"Volume total    : {vol_total:,}")
    if vol_total == 0:
        print("    !!! VOLUME IS ZERO ON EVERY BAR. Expected for the spot index —")
        print("    !!! it has no traded quantity. Any volume filter in the strategy")
        print("    !!! will silently do nothing. Use futures if you need volume.")

    # ── Bad candles ──────────────────────────────────────────────────────
    bad = []
    for dt, o, h, l, c, _v in parsed:
        why = []
        if h < l:
            why.append("high<low")
        if h < o or h < c:
            why.append("high<open/close")
        if l > o or l > c:
            why.append("low>open/close")
        if why:
            bad.append((dt, o, h, l, c, ",".join(why)))

    print(f"\nBad OHLC bars   : {len(bad)}")
    if bad:
        print("    !!! THESE ARE STRUCTURALLY IMPOSSIBLE CANDLES — DO NOT BACKTEST ON THEM")
        for dt, o, h, l, c, why in bad[:25]:
            print(f"    !!! {dt:%Y-%m-%d %H:%M}  O{o} H{h} L{l} C{c}  [{why}]")
        if len(bad) > 25:
            print(f"    !!! … and {len(bad) - 25} more")

    # ── Spikes, intraday only ────────────────────────────────────────────
    # Compared against the previous bar's close WITHIN a day. Day boundaries are
    # excluded and counted separately: an overnight gap is not a bad tick.
    spikes, overnight = [], []
    for i in range(1, len(parsed)):
        prev, cur = parsed[i - 1], parsed[i]
        pc = prev[4]
        if pc <= 0:
            continue
        dev = max(abs(cur[2] - pc), abs(cur[3] - pc)) / pc * 100
        if prev[0].date() != cur[0].date():
            if dev > 5:
                overnight.append((cur[0], dev, pc, cur[2], cur[3]))
        elif dev > 5:
            spikes.append((cur[0], dev, pc, cur[2], cur[3]))

    print(f"\nIntraday spikes >5% : {len(spikes)}")
    if spikes:
        print("    !!! INTRADAY NIFTY DOES NOT MOVE 5% IN 2 MINUTES — LIKELY BAD TICKS")
        for dt, dev, pc, h, l in spikes[:25]:
            print(f"    !!! {dt:%Y-%m-%d %H:%M}  prev close {pc:,.2f}  H{h:,.2f} L{l:,.2f}"
                  f"  dev {dev:.2f}%")
        if len(spikes) > 25:
            print(f"    !!! … and {len(spikes) - 25} more")
    print(f"Overnight gaps >5%  : {len(overnight)}   (informational — not bad ticks)")
    for dt, dev, pc, h, l in overnight[:10]:
        print(f"      {dt:%Y-%m-%d %H:%M}  prev close {pc:,.2f}  dev {dev:.2f}%")

    # ── Session gaps ─────────────────────────────────────────────────────
    grid = expected_grid()
    full = len(grid)
    by_day = defaultdict(set)
    off_session = []
    for dt, *_rest in parsed:
        by_day[dt.date()].add(dt.time())
        if not (SESSION_OPEN <= dt.time() < SESSION_CLOSE):
            off_session.append(dt)

    short_days = []
    for d in days:
        missing = [t for t in grid if t not in by_day[d]]
        if missing:
            short_days.append((d, len(by_day[d]), missing))

    print(f"\nExpected bars/day   : {full}  (09:15 → 15:29, last is a 1-min stub)")
    print(f"Days short of that  : {len(short_days)} of {len(days)}")

    # A handful of missing bars is normal (thin 2-min prints, halts). Days
    # missing a big chunk are the ones worth eyeballing.
    severe = [s for s in short_days if len(s[2]) > 10]
    minor = len(short_days) - len(severe)
    print(f"  minor (≤10 bars)  : {minor}")
    print(f"  SEVERE (>10 bars) : {len(severe)}" + ("   <-- !!!" if severe else ""))
    for d, have, missing in severe[:30]:
        span = f"{missing[0]:%H:%M}–{missing[-1]:%H:%M}"
        print(f"    !!! {d}  has {have:>3}/{full}  missing {len(missing):>3}  first/last {span}")
    if len(severe) > 30:
        print(f"    !!! … and {len(severe) - 30} more short days")

    if off_session:
        print(f"\nBars outside 09:15–15:30 : {len(off_session)}  "
              f"(Muhurat/special sessions — informational)")
        for dt in off_session[:10]:
            print(f"      {dt:%Y-%m-%d %H:%M}")

    # ── Verdict ──────────────────────────────────────────────────────────
    serious = bool(bad or spikes or dupes)
    print("\n" + line)
    if serious:
        print("VERDICT: !!! PROBLEMS FOUND — see the !!! lines above before backtesting.")
    else:
        print("VERDICT: no bad candles, no duplicate stamps, no intraday spikes.")
        print("         Session gaps above are the only thing left to eyeball.")
    print(line)
    return not serious


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--instrument", default=SPOT_KEY,
                    help=f'instrument key (default "{SPOT_KEY}")')
    ap.add_argument("--from", dest="from_date", default=V3_EPOCH, help="YYYY-MM-DD")
    ap.add_argument("--to", dest="to_date", default=None, help="YYYY-MM-DD (default today)")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--restart", action="store_true", help="discard the checkpoint")
    ap.add_argument("--verify-only", action="store_true", help="re-check an existing CSV")
    ap.add_argument("--resolve-futures", action="store_true",
                    help="print the front-month NIFTY futures key and exit")
    args = ap.parse_args()

    if args.resolve_futures:
        c = front_month_future("NIFTY")
        print(f"\nFront month: {c['instrument_key']}  ({c['trading_symbol']})"
              if c else "\nNo unexpired NIFTY future found.")
        return

    if args.verify_only:
        print(f"Verifying {args.out}")
        sys.exit(0 if verify(read_csv(args.out)) else 1)

    from_date = date.fromisoformat(args.from_date)
    epoch = date.fromisoformat(V3_EPOCH)
    if from_date < epoch:
        print(f"Clamping --from to {V3_EPOCH}: v3 has no sub-daily data before it.")
        from_date = epoch
    to_date = date.fromisoformat(args.to_date) if args.to_date else datetime.now(IST).date()

    token, source = resolve_token()
    if not token:
        raise SystemExit(
            "!!! No Upstox token. Set UPSTOX_ANALYTICS_TOKEN (env or .env.local), "
            "or UPSTOX_ACCESS_TOKEN, or drop one in .upstox_token.")

    part_path = os.path.splitext(args.out)[0] + ".partial.jsonl"
    prog_path = os.path.splitext(args.out)[0] + ".progress.json"
    if args.restart:
        for p in (part_path, prog_path):
            try:
                os.remove(p)
            except OSError:
                pass
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    print(f"Instrument : {args.instrument}")
    print(f"Interval   : {INTERVAL_MINUTES} minute")
    print(f"Range      : {from_date} → {to_date}")
    print(f"Token      : {source}")
    print(f"Output     : {args.out}\n")

    rows = download(args.instrument, token, from_date, to_date, part_path, prog_path)
    if not rows:
        raise SystemExit("!!! Nothing downloaded.")

    parsed = write_csv(rows, args.out)
    print(f"Wrote {len(parsed):,} rows → {args.out}")
    ok = verify(parsed)
    print(f"\nCheckpoint kept at {part_path}\n(delete it, or pass --restart, "
          f"to force a clean re-download)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
