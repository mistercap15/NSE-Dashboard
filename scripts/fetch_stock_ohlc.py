#!/usr/bin/env python3
"""Download daily OHLC for the F&O stock universe from Upstox into a CSV.

Feeds a consolidation-breakout backtest, which needs real highs and lows — not
just closes — so this keeps the full candle plus volume.

WHAT IT FETCHES
---------------
The CASH/equity series for each F&O name (NSE_EQ|<isin>), not the futures. A
breakout is a fact about the underlying: futures carry basis that rolls to zero
at expiry and gaps at every contract change, which would invent range
compressions and breakouts that never happened in the market being measured.

  GET /v2/historical-candle/{instrument_key}/day/{to}/{from}

Probed against the live endpoint rather than assumed:

  2021-01-01 -> today   (5.7y)   OK, 1407 candles in ONE request
  ~9 years                       OK, 2232 candles
  10 years                       400 UDAPI1148 "Invalid date range"

So the default range needs a single call per symbol and the paging below never
fires. It exists for an arbitrary --from, and halves its window on a range
error, the same shape as fetch_nifty_2min.py.

INSTRUMENT KEYS
---------------
From Upstox's published instrument master, not a hardcoded map. The dashboard
learned this the hard way — app/lib/instruments.js notes that 34 F&O names were
missing from its ISIN_MAP, and app/lib/instrumentMaster.js exists to self-heal
exactly that. A symbol the master cannot resolve is REPORTED, never guessed at:
NSE_EQ|SYMBOL is not a valid key and would fetch nothing while looking fine.

Resumable: each symbol's rows are appended to a .partial.csv as they land and
the symbol is recorded done, so a failure 150 symbols in costs one symbol.
Re-running continues; --restart starts over.

Usage
-----
  python3 scripts/fetch_stock_ohlc.py                 # 2021-01-01 -> today
  python3 scripts/fetch_stock_ohlc.py --from 2018-01-01
  python3 scripts/fetch_stock_ohlc.py --verify-only   # re-check the CSV
  python3 scripts/fetch_stock_ohlc.py --cross-check   # vs the existing JSON export

Token: UPSTOX_ANALYTICS_TOKEN, else .env.local, else UPSTOX_ACCESS_TOKEN, else
.upstox_token — the order app/lib/upstox.js resolveAccessToken() uses.
"""

import argparse
import csv
import glob
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

# ── Config ───────────────────────────────────────────────────────────────────

BASE_V2 = "https://api.upstox.com/v2"
MASTER_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"

START = "2021-01-01"
WINDOW_YEARS = 8            # under the ~10y cap with slack; one call for the default range
WINDOW_MIN_DAYS = 180
SLEEP_BETWEEN = 0.25
MAX_RETRIES = 4

# Upstox sits behind Cloudflare, which blocks Python's default User-Agent with
# error 1010 before the request reaches Upstox at all. Every call needs one.
# (upstox_orders.py on the droplet carries the same note.)
USER_AGENT = "nse-dashboard-backtest-fetch/1.0"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIVERSE = os.path.join(ROOT, "data", "universe.json")
OUT_DIR = os.path.join(ROOT, "data", "exports")
DEFAULT_OUT = os.path.join(OUT_DIR, "stock_ohlc.csv")

SPIKE_PCT = 25.0            # |high or low - prev close| beyond this is suspicious
COVERAGE_MIN = 0.80         # below this share of trading days, a symbol is "patchy"


# ── Token ────────────────────────────────────────────────────────────────────

def _from_env_file(path, key):
    try:
        with open(path, encoding="utf8") as fh:
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
        with open(os.path.join(ROOT, ".upstox_token"), encoding="utf8") as fh:
            tok = fh.read().strip()
            if tok:
                return tok, ".upstox_token file"
    except OSError:
        pass
    return None, None


# ── HTTP ─────────────────────────────────────────────────────────────────────

class RangeTooBig(Exception):
    """The window exceeded the endpoint's per-request cap."""


def _looks_like_range_error(body):
    low = (body or "").lower()
    return any(s in low for s in ("invalid date range", "date range", "udapi1148", "too large"))


def get_with_retry(url, token):
    delay, last = 1.0, None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            })
            with urllib.request.urlopen(req, timeout=90) as res:
                return json.loads(res.read().decode("utf8"))
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf8", "replace")[:300]
            except Exception:                                    # noqa: BLE001
                pass
            last = f"HTTP {exc.code}: {body}"
            if exc.code == 400 and _looks_like_range_error(body):
                raise RangeTooBig(body) from exc
            if exc.code in (401, 403):
                raise SystemExit(
                    f"\n!!! Upstox rejected the credential — {last}\n"
                    f"    A 403 with a Cloudflare 1010 body means the User-Agent was "
                    f"stripped; a 401 means the token is wrong or expired.")
            if exc.code == 429:
                time.sleep(delay * 4)
            elif 500 <= exc.code < 600:
                time.sleep(delay)
            else:
                # 404-ish on one symbol should not kill a 181-symbol run.
                return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = str(exc)
            time.sleep(delay)
        delay = min(delay * 2, 20)
    print(f"    gave up after {MAX_RETRIES} attempts — {last}", flush=True)
    return None


# ── Instrument master ────────────────────────────────────────────────────────

def equity_keys():
    """{TRADING_SYMBOL: NSE_EQ|ISIN} for NSE cash equities.

    Same filter as buildMaps() in app/lib/instrumentMaster.js. No ISIN-style
    fallback on purpose: NSE_EQ|SYMBOL is not a valid instrument key, and
    inventing one turns "this symbol is unresolvable" into "this symbol has no
    data", which is a far harder thing to notice.
    """
    print(f"Fetching instrument master … ({MASTER_URL})", flush=True)
    req = urllib.request.Request(MASTER_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=180) as res:
        rows = json.loads(gzip.decompress(res.read()).decode("utf8"))
    out = {}
    for it in rows:
        if it.get("segment") == "NSE_EQ" and it.get("instrument_type") == "EQ":
            sym = (it.get("trading_symbol") or it.get("tradingsymbol") or "").upper()
            if sym and it.get("instrument_key"):
                out[sym] = it["instrument_key"]
    if len(out) < 1000:
        raise SystemExit(f"!!! instrument master looks incomplete ({len(out)} equities)")
    print(f"  {len(out)} NSE cash equities in the master\n")
    return out


# ── Fetch ────────────────────────────────────────────────────────────────────

def ymd(d):
    return d.strftime("%Y-%m-%d")


def fetch_symbol(token, key, from_date, to_date):
    """All daily candles for one instrument, oldest→newest, deduped.

    Pages backward only if the range is refused; the default range fits in one
    request, so this normally makes exactly one call.
    """
    rows, window_days = {}, WINDOW_YEARS * 365
    window_end = to_date
    while window_end >= from_date:
        window_start = max(from_date, window_end - timedelta(days=window_days - 1))
        url = (f"{BASE_V2}/historical-candle/{urllib.parse.quote(key, safe='')}"
               f"/day/{ymd(window_end)}/{ymd(window_start)}")
        try:
            data = get_with_retry(url, token)
        except RangeTooBig:
            if window_days <= WINDOW_MIN_DAYS:
                raise
            window_days = max(WINDOW_MIN_DAYS, window_days // 2)
            continue                                   # same end, smaller bite
        for c in ((data or {}).get("data", {}).get("candles") or []):
            if isinstance(c, list) and len(c) >= 6:
                rows[c[0][:10]] = c
        if window_start <= from_date:
            break
        window_end = window_start - timedelta(days=1)
    return [rows[d] for d in sorted(rows)]


def load_progress(prog_path):
    try:
        with open(prog_path, encoding="utf8") as fh:
            p = json.load(fh)
            return set(p.get("done", [])), p.get("unresolved", []), p.get("empty", [])
    except (OSError, ValueError):
        return set(), [], []


def download(symbols, keys, token, from_date, to_date, paths, restart=False):
    done, unresolved, empty = load_progress(paths["progress"])
    if restart:
        done, unresolved, empty = set(), [], []
    if done:
        print(f"Resuming: {len(done)} symbols already fetched\n", flush=True)

    fresh = not os.path.exists(paths["partial"]) or restart
    fh = open(paths["partial"], "w" if fresh else "a", newline="", encoding="utf8")
    w = csv.writer(fh)
    if fresh:
        w.writerow(["symbol", "date", "open", "high", "low", "close", "volume"])

    todo = [s for s in symbols if s not in done]
    try:
        for i, sym in enumerate(todo, 1):
            key = keys.get(sym)
            if not key:
                # Reported, never guessed. See equity_keys().
                unresolved.append(sym)
                done.add(sym)
                print(f"  [{i}/{len(todo)}] {sym:<14} !!! no instrument key in the master")
                continue

            candles = fetch_symbol(token, key, from_date, to_date)
            for c in candles:
                w.writerow([sym, c[0][:10], c[1], c[2], c[3], c[4], int(c[5] or 0)])
            fh.flush()
            os.fsync(fh.fileno())

            if not candles:
                empty.append(sym)
            done.add(sym)
            with open(paths["progress"], "w", encoding="utf8") as pf:
                json.dump({"done": sorted(done), "unresolved": unresolved,
                           "empty": empty}, pf)

            flag = "   !!! NO DATA" if not candles else ""
            span = f"{candles[0][0][:10]} → {candles[-1][0][:10]}" if candles else ""
            print(f"  [{i}/{len(todo)}] {sym:<14} {len(candles):>5} rows  {span}{flag}",
                  flush=True)
            time.sleep(SLEEP_BETWEEN)
    finally:
        fh.close()

    return unresolved, empty


# ── CSV ──────────────────────────────────────────────────────────────────────

def finalise(partial, out_path):
    """Dedupe on (symbol, date); sort by symbol then date."""
    seen = {}
    with open(partial, encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            seen[(r["symbol"], r["date"])] = r
    rows = sorted(seen.values(), key=lambda r: (r["symbol"], r["date"]))
    with open(out_path, "w", newline="", encoding="utf8") as fh:
        w = csv.DictWriter(fh, fieldnames=["symbol", "date", "open", "high",
                                           "low", "close", "volume"])
        w.writeheader()
        w.writerows(rows)
    return rows


def read_csv(path):
    with open(path, encoding="utf8") as fh:
        return sorted(csv.DictReader(fh), key=lambda r: (r["symbol"], r["date"]))


# ── Integrity ────────────────────────────────────────────────────────────────

def verify(rows, symbols, unresolved, empty):
    line = "─" * 78
    print("\n" + line + "\nINTEGRITY REPORT\n" + line)
    ok = True

    if not rows:
        print("!!! NO ROWS AT ALL.")
        return False

    dates = sorted({r["date"] for r in rows})
    by_sym = defaultdict(list)
    for r in rows:
        by_sym[r["symbol"]].append(r)

    print(f"\nRows            : {len(rows):,}")
    print(f"Date range      : {dates[0]} → {dates[-1]}  ({len(dates):,} trading days)")
    print(f"Symbols covered : {len(by_sym)} of {len(symbols)}")
    dupes = len(rows) - len({(r["symbol"], r["date"]) for r in rows})
    print(f"Duplicate rows  : {dupes}" + ("   <-- !!!" if dupes else ""))
    if dupes:
        ok = False

    # ── Symbols that failed outright ─────────────────────────────────────
    if unresolved:
        ok = False
        print(f"\n!!! {len(unresolved)} SYMBOLS HAD NO INSTRUMENT KEY in the master")
        print("    (renamed, delisted, or not an NSE cash equity — NOT fetched)")
        for s in unresolved:
            print(f"    !!! {s}")
    if empty:
        ok = False
        print(f"\n!!! {len(empty)} SYMBOLS RETURNED NO CANDLES")
        for s in empty:
            print(f"    !!! {s}")

    missing = [s for s in symbols if s not in by_sym]
    if missing:
        ok = False
        print(f"\n!!! {len(missing)} SYMBOLS ABSENT FROM THE CSV")
        for s in missing[:20]:
            print(f"    !!! {s}")

    # ── Coverage against the market calendar the data itself implies ─────
    # The denominator is the union of all dates seen, not a synthetic calendar:
    # it needs no holiday list and cannot drift from the exchange.
    total_days = len(dates)
    patchy = sorted(((s, len(v)) for s, v in by_sym.items()
                     if len(v) < COVERAGE_MIN * total_days), key=lambda x: x[1])
    print(f"\nCoverage (of {total_days:,} trading days seen across the universe)")
    print(f"    symbols under {COVERAGE_MIN:.0%}: {len(patchy)}")
    for s, n in patchy[:40]:
        print(f"        {s:<14} {n:>5} days  ({n / total_days * 100:>3.0f}%)")
    if len(patchy) > 40:
        print(f"        … and {len(patchy) - 40} more")

    # ── Structurally impossible candles ──────────────────────────────────
    bad = []
    for r in rows:
        try:
            o, h, l, c = float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"])
        except (TypeError, ValueError):
            bad.append((r["symbol"], r["date"], "unparseable"))
            continue
        why = []
        if h < l:            why.append("high<low")
        if h < o or h < c:   why.append("high<open/close")
        if l > o or l > c:   why.append("low>open/close")
        if why:
            bad.append((r["symbol"], r["date"], ",".join(why)))
    print(f"\nBad OHLC rows   : {len(bad)}")
    if bad:
        ok = False
        print("    !!! STRUCTURALLY IMPOSSIBLE CANDLES — DO NOT BACKTEST ON THESE")
        for s, d, why in bad[:25]:
            print(f"    !!! {s:<14} {d}  [{why}]")
        if len(bad) > 25:
            print(f"    !!! … and {len(bad) - 25} more")

    # ── Spikes ───────────────────────────────────────────────────────────
    # Upstox daily candles are NOT adjusted for corporate actions, so a split or
    # bonus shows up as a genuine-looking 50% gap. Those are the expected cause
    # of most hits here — they are real prices, but a breakout backtest will
    # read them as enormous moves unless handled.
    spikes = []
    for sym, rs in by_sym.items():
        prev = None
        for r in rs:
            try:
                h, l, c = float(r["high"]), float(r["low"]), float(r["close"])
            except (TypeError, ValueError):
                prev = None
                continue
            if prev and prev > 0:
                dev = max(abs(h - prev), abs(l - prev)) / prev * 100
                if dev > SPIKE_PCT:
                    spikes.append((sym, r["date"], round(dev, 1), prev, h, l))
            prev = c
    print(f"\nDays moving >{SPIKE_PCT:.0f}% from the prior close : {len(spikes)}")
    if spikes:
        print("    !!! CHECK THESE — most will be unadjusted splits/bonuses, which are")
        print("    !!! real prices but read as huge moves in a breakout test.")
        worst = sorted(spikes, key=lambda x: -x[2])[:20]
        for s, d, dev, p, h, l in worst:
            print(f"    !!! {s:<14} {d}  {dev:>6.1f}%  prev {p:>10,.2f}  H {h:>10,.2f} L {l:>10,.2f}")
        if len(spikes) > 20:
            print(f"    !!! … and {len(spikes) - 20} more")
        hit = Counter(s for s, *_ in spikes).most_common(8)
        print(f"    symbols most affected: {', '.join(f'{s}({n})' for s, n in hit)}")

    # ── Eyeball sample ───────────────────────────────────────────────────
    print("\nPrice range for a few symbols — sanity-check these against reality:")
    for sym in [s for s in ("RELIANCE", "TCS", "HDFCBANK", "MARUTI", "TIINDIA")
                if s in by_sym][:5]:
        lows = [float(r["low"]) for r in by_sym[sym]]
        highs = [float(r["high"]) for r in by_sym[sym]]
        last = by_sym[sym][-1]
        print(f"    {sym:<12} low {min(lows):>10,.2f}   high {max(highs):>10,.2f}"
              f"   last close {float(last['close']):>10,.2f} on {last['date']}")

    print("\n" + line)
    if ok and not spikes:
        print("VERDICT: clean — no bad candles, no duplicates, no unexplained spikes.")
    elif ok:
        print("VERDICT: structurally clean; the >25% days above need an eye before use.")
    else:
        print("VERDICT: !!! PROBLEMS FOUND — read the !!! lines before backtesting.")
    print(line)
    return ok


def cross_check(rows):
    """Compare against the existing JSON export, if one is present.

    A second, independently fetched copy of the same underlying is a far
    stronger check than anything this script can say about itself.
    """
    files = sorted(glob.glob(os.path.join(OUT_DIR, "daily_candles_export_*.json")))
    if not files:
        print("\n(no daily_candles_export_*.json to cross-check against — skipped)")
        return
    path = files[-1]
    print(f"\n{'─' * 78}\nCROSS-CHECK vs {os.path.basename(path)}\n{'─' * 78}")
    with open(path, encoding="utf8") as fh:
        old = json.load(fh).get("candles") or {}

    mine = defaultdict(dict)
    for r in rows:
        mine[r["symbol"]][r["date"]] = r

    compared = agree = 0
    worst = []
    for sym, bars in old.items():
        if sym not in mine:
            continue
        for b in bars:
            d = b.get("date")
            r = mine[sym].get(d)
            if not r:
                continue
            compared += 1
            try:
                a, c = float(b["close"]), float(r["close"])
            except (TypeError, ValueError, KeyError):
                continue
            if a and abs(a - c) / a < 0.001:
                agree += 1
            else:
                worst.append((sym, d, a, c, abs(a - c) / a * 100 if a else 0))
    if not compared:
        print("  no overlapping (symbol, date) rows — nothing to compare")
        return
    print(f"  overlapping rows compared : {compared:,}")
    print(f"  closes agreeing to 0.1%   : {agree:,}  ({agree / compared * 100:.3f}%)")
    if worst:
        print(f"  disagreements             : {len(worst):,}")
        for s, d, a, c, pct in sorted(worst, key=lambda x: -x[4])[:10]:
            print(f"    !!! {s:<14} {d}  export {a:>10,.2f}  this run {c:>10,.2f}  ({pct:.1f}%)")


# ── Main ─────────────────────────────────────────────────────────────────────

def load_symbols(path):
    with open(path, encoding="utf8") as fh:
        u = json.load(fh)
    syms = u.get("symbols") or sorted(u.get("series", {}).keys())
    return sorted({s.strip().upper() for s in syms if s and s.strip()})


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="start", default=START)
    ap.add_argument("--to", dest="end", default=None)
    ap.add_argument("--universe", default=UNIVERSE)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--restart", action="store_true")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--cross-check", action="store_true",
                    help="also compare against the existing JSON export")
    args = ap.parse_args()

    symbols = load_symbols(args.universe)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    paths = {
        "partial": os.path.splitext(args.out)[0] + ".partial.csv",
        "progress": os.path.splitext(args.out)[0] + ".progress.json",
    }

    if args.verify_only:
        rows = read_csv(args.out)
        _done, unresolved, empty = load_progress(paths["progress"])
        good = verify(rows, symbols, unresolved, empty)
        if args.cross_check:
            cross_check(rows)
        sys.exit(0 if good else 1)

    token, source = resolve_token()
    if not token:
        raise SystemExit(
            "!!! No Upstox token. Set UPSTOX_ANALYTICS_TOKEN (env or .env.local), "
            "or UPSTOX_ACCESS_TOKEN, or put one in .upstox_token.")

    from_date = date.fromisoformat(args.start)
    to_date = date.fromisoformat(args.end) if args.end else datetime.now().date()

    print(f"Symbols  : {len(symbols)} (from {os.path.relpath(args.universe, ROOT)})")
    print(f"Range    : {from_date} → {to_date}")
    print(f"Token    : {source}")
    print(f"Output   : {args.out}\n")

    keys = equity_keys()
    unresolved, empty = download(symbols, keys, token, from_date, to_date,
                                 paths, restart=args.restart)

    rows = finalise(paths["partial"], args.out)
    print(f"\nWrote {len(rows):,} rows → {args.out}")
    good = verify(rows, symbols, unresolved, empty)
    cross_check(rows)
    print(f"\nCheckpoint kept at {paths['progress']} (--restart to refetch)")
    sys.exit(0 if good else 1)


if __name__ == "__main__":
    main()
