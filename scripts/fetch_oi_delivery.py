#!/usr/bin/env python3
"""Download NSE EOD delivery% and stock-futures OI for the F&O universe.

Feeds an OI + delivery FILTER layered on the seasonality strategy. Fetches raw
fields only — no buildup/covering classification, no filter logic.

Two files per trading day, both whole-market, then filtered to our symbols:

  1. EQUITY  sec_bhavdata_full — SYMBOL, CLOSE_PRICE, TTL_TRD_QNTY, DELIV_PER
     One URL shape for the entire 2021→today range.

  2. FUTURES stock futures OI — close, OPEN_INT, CHG_IN_OI, near-month contract
     TWO different sources, because NSE changed format mid-range. See below.

THE F&O FORMAT SPLIT, probed rather than assumed
------------------------------------------------
jugaad_data.nse.bhavcopy_fo_save() reads the legacy fo<DDMMMYYYY>bhav.csv.zip.
That file stops existing partway through 2024 — every call after it raises
BadZipFile (NSE serves an HTML error page, the unzipper chokes on it), which
looks like a library bug and is really a retired endpoint:

    2021-01-04  legacy OK    UDiFF 404
    2023-06-15  legacy OK    UDiFF 404
    2023-12-01  legacy OK    UDiFF 404
    2024-01-02  legacy OK    UDiFF OK     <- UDiFF begins
    2024-07-15  legacy FAIL  UDiFF OK
    2026-08-26  legacy FAIL  UDiFF OK

jugaad-data has no historical UDiFF F&O reader — its NSEDailyReports class is
documented "current day and previous day only" — so the UDiFF half is fetched
straight from the archive, reusing the library's session for its browser
User-Agent and NSE cookies. Pre-2024 stays on the library's legacy reader.

Either source can be tried if the other fails, so the 2024-01-01 boundary is a
fast path rather than a load-bearing assumption.

Near-month = the contract with the earliest expiry on or after the trade date.

Field names differ between the two and are normalised on the way in:
    legacy  INSTRUMENT=FUTSTK  SYMBOL     EXPIRY_DT  CLOSE    OPEN_INT   CHG_IN_OI
    UDiFF   FinInstrmTp=STF    TckrSymb   XpryDt     ClsPric  OpnIntrst  ChngInOpnIntrst

Resumable: every completed day is checkpointed, so a failure 900 days in costs
one day, not the run. Re-running continues; --restart starts over.

Usage
-----
  python3 scripts/fetch_oi_delivery.py                    # 2021-01-01 → today
  python3 scripts/fetch_oi_delivery.py --from 2025-01-01
  python3 scripts/fetch_oi_delivery.py --verify-only      # re-check the CSVs

Needs jugaad-data:  pip install jugaad-data
"""

import argparse
import csv
import io
import json
import os
import sys
import time
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

try:
    from jugaad_data.nse import full_bhavcopy_raw, bhavcopy_fo_raw
    from jugaad_data.nse.archives import NSEArchives
except ImportError:
    sys.exit("!!! jugaad-data is not installed.  pip install jugaad-data")

# ── Config ───────────────────────────────────────────────────────────────────

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIVERSE = os.path.join(ROOT, "data", "universe.json")
OUT_DIR = os.path.join(ROOT, "data", "exports")

START = "2021-01-01"
UDIFF_FROM = date(2024, 1, 1)     # first date the UDiFF F&O archive exists
UDIFF_FO_URL = ("https://nsearchives.nseindia.com/content/fo/"
                "BhavCopy_NSE_FO_0_0_0_{ymd}_F_0000.csv.zip")

SLEEP = 0.6                       # NSE throttles hard; be a good citizen
MAX_RETRIES = 3

# EQ and BE, not SM/ST (SME board) or GS/GB (government stock).
#
# BE is the trade-to-trade segment, and dropping it leaves invisible holes:
# ADANIPOWER and SUZLON both sat in BE in early 2024 and were promoted to EQ
# later, so an EQ-only filter loses those months entirely for two F&O names.
#
# Delivery is COMPULSORY in BE, so NSE writes DELIV_PER as "-" there rather
# than 100. Those rows therefore carry price and volume with a blank
# deliv_pct — which is honest, and better than the row not existing at all.
SERIES_KEEP = ("EQ", "BE")

# Symbols NSE renamed inside our window, old -> current. Data before the rename
# is filed under the old ticker and would otherwise be missing entirely for a
# name that has traded throughout.
#
# Only entries positively confirmed against the bhavcopy go here — a wrong
# mapping silently welds two companies' histories together, which is worse than
# a gap. Anything else shows up in the coverage section of the report.
RENAMES = {"ZOMATO": "ETERNAL"}

_session = None


def session():
    """The library's session — it carries the browser UA and NSE cookies that
    stop nsearchives returning an HTML block page instead of a zip."""
    global _session
    if _session is None:
        _session = NSEArchives().s
    return _session


# ── Helpers ──────────────────────────────────────────────────────────────────

class NseGap(Exception):
    """NSE itself has no usable file for this date. Nothing to retry.

    Three shapes of this were hit over 2021-2026, all NSE-side:
      • no F&O bhavcopy at all (2021-03-30) — the archive URL 404s / serves HTML
      • an XLSX served at the .csv URL (2022-08-08) — genuinely not a CSV
      • the previous session's file served for a special session (2021-11-04,
        Diwali Muhurat) — caught by StaleBhavcopy below
    """


class StaleBhavcopy(NseGap):
    """The file NSE served is not for the date we asked for.

    ON A TRADING HOLIDAY NSE RETURNS THE PREVIOUS SESSION'S FILE, with a 200
    and no error of any kind. Asking for 2021-01-26 (Republic Day) returns the
    25 Jan file, RELIANCE close 1941.00 and all — identical to what asking for
    the 25th returns. Stamping those rows with the requested date invents a
    trading day that never happened and duplicates the previous session's
    prices and delivery into it, roughly 30 times a year.

    So the date INSIDE the file is authoritative, never the date requested.
    """


def file_date(value):
    """Parse the date NSE stamped inside a bhavcopy row. None if unrecognised —
    an unparseable stamp must not be treated as a mismatch."""
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d-%B-%Y"):
        try:
            return datetime.strptime((value or "").strip().title(), fmt).date()
        except (ValueError, AttributeError):
            continue
    return None


def clean(row):
    """sec_bhavdata_full pads every header AND value with a space."""
    return {(k or "").strip(): (v or "").strip() for k, v in row.items()}


def num(v):
    """NSE writes '-' for absent. Return None rather than crashing or zeroing:
    a missing delivery figure is not 0% delivery."""
    v = (v or "").strip()
    if v in ("", "-", "NA"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def load_symbols(path):
    with open(path) as fh:
        return sorted({s.strip().upper() for s in json.load(fh)["symbols"] if s.strip()})


def alias_map(symbols):
    """{ticker as it appears in the file: ticker we report under}."""
    m = {s: s for s in symbols}
    for old, cur in RENAMES.items():
        if cur in m:
            m[old] = cur
    return m


def trading_weekdays(start, end):
    d = start
    while d <= end:
        if d.weekday() < 5:              # holidays show up as a missing file
            yield d
        d += timedelta(days=1)


# ── Fetch: equity ────────────────────────────────────────────────────────────

def fetch_equity(d, wanted):
    """{symbol: (close, volume, deliv_pct)} for one day, EQ series only."""
    txt = full_bhavcopy_raw(d)
    # NSE occasionally serves an XLSX at the .csv URL (seen on 2022-08-08).
    # Detected up front so the report can say that, instead of surfacing csv's
    # "new-line character seen in unquoted field", which reads like our bug.
    if txt[:2] == "PK":
        raise NseGap(f"NSE served an XLSX, not a CSV, for {d} — no delivery data")
    out = {}
    stamped = None
    for raw in csv.DictReader(io.StringIO(txt)):
        r = clean(raw)
        if stamped is None:
            stamped = file_date(r.get("DATE1"))
            if stamped is not None and stamped != d:
                raise StaleBhavcopy(
                    f"NSE served the {stamped} file for {d} — no equity data of "
                    f"its own (special/Muhurat session, or a closed day)")
        if r.get("SERIES") not in SERIES_KEEP:
            continue
        sym = wanted.get(r.get("SYMBOL", "").upper())
        if sym is None:
            continue
        out[sym] = (num(r.get("CLOSE_PRICE")), num(r.get("TTL_TRD_QNTY")),
                    num(r.get("DELIV_PER")))
    return out


# ── Fetch: futures OI, two formats ───────────────────────────────────────────

def _near_month(rows, d):
    """Earliest expiry on or after the trade date, per symbol."""
    best = {}
    for sym, expiry, close, oi, doi in rows:
        if expiry is None or expiry < d:
            continue
        cur = best.get(sym)
        if cur is None or expiry < cur[0]:
            best[sym] = (expiry, close, oi, doi)
    return {s: (c, o, dd) for s, (_e, c, o, dd) in best.items()}


def _parse_legacy(txt, wanted, d):
    rows = []
    stamped = None
    for raw in csv.DictReader(io.StringIO(txt)):
        r = clean(raw)
        if stamped is None:
            stamped = file_date(r.get("TIMESTAMP"))
            if stamped is not None and stamped != d:
                raise StaleBhavcopy(f"legacy FO file is for {stamped}, asked {d}")
        if r.get("INSTRUMENT") != "FUTSTK":
            continue
        sym = wanted.get(r.get("SYMBOL", "").upper())
        if sym is None:
            continue
        try:
            expiry = datetime.strptime(r["EXPIRY_DT"], "%d-%b-%Y").date()
        except (KeyError, ValueError):
            expiry = None
        rows.append((sym, expiry, num(r.get("CLOSE")), num(r.get("OPEN_INT")),
                     num(r.get("CHG_IN_OI"))))
    return rows


def _parse_udiff(txt, wanted, d):
    rows = []
    stamped = None
    for r in csv.DictReader(io.StringIO(txt)):
        if stamped is None:
            stamped = file_date(r.get("TradDt"))
            if stamped is not None and stamped != d:
                raise StaleBhavcopy(f"UDiFF FO file is for {stamped}, asked {d}")
        if (r.get("FinInstrmTp") or "").strip() != "STF":
            continue
        sym = wanted.get((r.get("TckrSymb") or "").strip().upper())
        if sym is None:
            continue
        try:
            expiry = datetime.strptime(r["XpryDt"].strip(), "%Y-%m-%d").date()
        except (KeyError, ValueError, AttributeError):
            expiry = None
        rows.append((sym, expiry, num(r.get("ClsPric")), num(r.get("OpnIntrst")),
                     num(r.get("ChngInOpnIntrst"))))
    return rows


def _udiff_text(d):
    r = session().get(UDIFF_FO_URL.format(ymd=f"{d:%Y%m%d}"), timeout=30)
    if r.status_code != 200:
        raise FileNotFoundError(f"UDiFF FO HTTP {r.status_code}")
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        return zf.open(zf.namelist()[0]).read().decode("utf-8")


def fetch_futures(d, wanted):
    """{symbol: (fut_close, open_interest, chg_in_oi)} for the near month.

    Tries the format that should exist for this date first, then the other —
    so the 2024 boundary being a day out cannot silently lose a day of data.
    """
    order = ([( _udiff_text, _parse_udiff), (bhavcopy_fo_raw, _parse_legacy)]
             if d >= UDIFF_FROM else
             [(bhavcopy_fo_raw, _parse_legacy), (_udiff_text, _parse_udiff)])
    last = None
    for get, parse in order:
        try:
            return _near_month(parse(get(d), wanted, d), d)
        except Exception as exc:                                # noqa: BLE001
            last = exc
    # Neither format had it. On a trading day that means NSE's archive is
    # simply missing the file (2021-03-30), not that we asked wrongly.
    raise NseGap(f"no F&O bhavcopy in either format for {d} "
                 f"(last error: {type(last).__name__})")


# ── Checkpointing ────────────────────────────────────────────────────────────

def load_progress(path):
    try:
        with open(path) as fh:
            p = json.load(fh)
            return set(p.get("done", [])), p.get("failed", {}), set(p.get("holidays", []))
    except (OSError, ValueError):
        return set(), {}, set()


def save_progress(path, done, failed, holidays):
    with open(path, "w") as fh:
        json.dump({"done": sorted(done), "failed": failed,
                   "holidays": sorted(holidays)}, fh)


# ── Download ─────────────────────────────────────────────────────────────────

def download(symbols, start, end, paths):
    wanted = alias_map(symbols)
    done, failed, holidays = load_progress(paths["progress"])
    if done or holidays:
        print(f"Resuming: {len(done)} days already fetched, "
              f"{len(holidays)} known non-trading days\n")

    fresh = not os.path.exists(paths["deliv_part"])
    fd = open(paths["deliv_part"], "a", newline="")
    ff = open(paths["fut_part"], "a", newline="")
    wd, wf = csv.writer(fd), csv.writer(ff)
    if fresh:
        wd.writerow(["symbol", "date", "close", "volume", "deliv_pct"])
        wf.writerow(["symbol", "date", "fut_close", "open_interest", "chg_in_oi"])

    days = [d for d in trading_weekdays(start, end)
            if d.isoformat() not in done and d.isoformat() not in holidays]
    print(f"{len(days)} weekdays to fetch ({start} → {end})\n")

    try:
        for i, d in enumerate(days, 1):
            iso = d.isoformat()
            eq = fo = None
            eq_err = fo_err = None

            for attempt in range(MAX_RETRIES):
                try:
                    eq = fetch_equity(d, wanted)
                    break
                except NseGap as exc:
                    eq_err = str(exc)        # a closed day; retrying cannot help
                    break
                except Exception as exc:                        # noqa: BLE001
                    eq_err = f"{type(exc).__name__}: {str(exc)[:90]}"
                    time.sleep(1.5 * (attempt + 1))

            # No equity bhavcopy at all is how an NSE holiday presents itself.
            # Recorded separately from a failure so the report can tell an
            # expected closed day from a day we genuinely lost.
            if eq is None:
                try:
                    fo = fetch_futures(d, wanted)
                except Exception:                               # noqa: BLE001
                    fo = None
                if not fo:
                    holidays.add(iso)
                    save_progress(paths["progress"], done, failed, holidays)
                    print(f"  [{i}/{len(days)}] {iso}  — no data (holiday)")
                    time.sleep(SLEEP)
                    continue
                failed[iso] = f"equity missing but futures present — {eq_err}"
                print(f"  [{i}/{len(days)}] {iso}  !!! EQUITY MISSING, futures present")
            else:
                for attempt in range(MAX_RETRIES):
                    try:
                        fo = fetch_futures(d, wanted)
                        break
                    except NseGap as exc:
                        fo_err = str(exc)
                        break
                    except Exception as exc:                    # noqa: BLE001
                        fo_err = f"{type(exc).__name__}: {str(exc)[:90]}"
                        time.sleep(1.5 * (attempt + 1))
                if fo is None:
                    failed[iso] = f"futures — {fo_err}"

            for sym, (close, vol, dp) in sorted((eq or {}).items()):
                wd.writerow([sym, iso, close, vol, dp])
            for sym, (close, oi, doi) in sorted((fo or {}).items()):
                wf.writerow([sym, iso, close, oi, doi])
            fd.flush(); ff.flush()
            os.fsync(fd.fileno()); os.fsync(ff.fileno())

            done.add(iso)
            save_progress(paths["progress"], done, failed, holidays)
            flag = "" if fo else "   !!! no futures"
            print(f"  [{i}/{len(days)}] {iso}  eq {len(eq or {}):>3}  "
                  f"fut {len(fo or {}):>3}{flag}")
            time.sleep(SLEEP)
    finally:
        fd.close(); ff.close()

    return done, failed, holidays


# ── Tidy output ──────────────────────────────────────────────────────────────

def finalise(part_path, out_path, key_cols):
    """Dedupe on (symbol, date), sort ascending by date then symbol."""
    seen = {}
    with open(part_path) as fh:
        for r in csv.DictReader(fh):
            seen[(r["symbol"], r["date"])] = r
    rows = sorted(seen.values(), key=lambda r: (r["date"], r["symbol"]))
    with open(out_path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=key_cols)
        w.writeheader()
        w.writerows(rows)
    return rows


# ── Integrity ────────────────────────────────────────────────────────────────

def verify(deliv, futs, symbols, failed, holidays):
    line = "─" * 78
    print("\n" + line + "\nINTEGRITY REPORT\n" + line)
    ok = True

    for name, rows, valcol in (("deliv.csv", deliv, "deliv_pct"),
                               ("fut_oi.csv", futs, "open_interest")):
        print(f"\n{name}")
        if not rows:
            print("    !!! EMPTY")
            ok = False
            continue
        dates = sorted({r["date"] for r in rows})
        syms = {r["symbol"] for r in rows}
        print(f"    rows      : {len(rows):,}")
        print(f"    date range: {dates[0]} → {dates[-1]}  ({len(dates):,} days)")
        print(f"    symbols   : {len(syms)} of {len(symbols)}")
        dupes = len(rows) - len({(r["symbol"], r["date"]) for r in rows})
        print(f"    duplicates: {dupes}" + ("   <-- !!!" if dupes else ""))
        if dupes:
            ok = False
        blank = sum(1 for r in rows if not (r.get(valcol) or "").strip())
        print(f"    blank {valcol}: {blank:,}"
              + (f"  ({blank / len(rows) * 100:.1f}%)" if rows else ""))

    # ── Failures ─────────────────────────────────────────────────────────
    print(f"\nNon-trading days skipped : {len(holidays)}  (no bhavcopy — holidays)")
    print(f"Days with an NSE-SIDE GAP: {len(failed)}" + ("   <-- !!!" if failed else ""))
    if failed:
        print("    (nothing to retry — NSE has no usable file. The other half of")
        print("     each day, where present, was still saved.)")
    if failed:
        ok = False
        for d, why in sorted(failed.items())[:25]:
            print(f"    !!! {d}  {why}")
        if len(failed) > 25:
            print(f"    !!! … and {len(failed) - 25} more")

    # ── Value sanity ─────────────────────────────────────────────────────
    bad_dp = [r for r in deliv
              if (r.get("deliv_pct") or "").strip()
              and not (0 <= float(r["deliv_pct"]) <= 100)]
    print(f"\ndeliv_pct outside 0–100  : {len(bad_dp)}" + ("   <-- !!!" if bad_dp else ""))
    for r in bad_dp[:10]:
        print(f"    !!! {r['symbol']} {r['date']}  {r['deliv_pct']}")
    if bad_dp:
        ok = False

    neg_oi = [r for r in futs
              if (r.get("open_interest") or "").strip() and float(r["open_interest"]) < 0]
    print(f"negative open_interest   : {len(neg_oi)}" + ("   <-- !!!" if neg_oi else ""))
    for r in neg_oi[:10]:
        print(f"    !!! {r['symbol']} {r['date']}  {r['open_interest']}")
    if neg_oi:
        ok = False
    # chg_in_oi is SIGNED — negative is unwinding, not an error. Only checked
    # for being parseable at all.
    bad_doi = sum(1 for r in futs if not (r.get("chg_in_oi") or "").strip())
    print(f"blank chg_in_oi          : {bad_doi:,}  (signed field; negative is normal)")

    # ── Per-symbol coverage ──────────────────────────────────────────────
    # Reported separately for cash and futures on purpose: a name can trade in
    # cash the whole time and only join the F&O list halfway through, which is
    # patchy futures coverage and perfectly healthy equity coverage.
    for name, rows in (("EQUITY", deliv), ("FUTURES", futs)):
        by_sym = Counter(r["symbol"] for r in rows)
        total_days = len({r["date"] for r in rows}) or 1
        missing = [s for s in symbols if s not in by_sym]
        patchy = sorted(((s, by_sym[s]) for s in symbols
                         if s in by_sym and by_sym[s] < 0.8 * total_days),
                        key=lambda x: x[1])
        print(f"\n{name} coverage (of {total_days:,} days with data)")
        print(f"    symbols with NO data : {len(missing)}"
              + ("   <-- !!!" if missing else ""))
        for s in missing:
            print(f"    !!! {s}")
        print(f"    symbols under 80%    : {len(patchy)}")
        for s, n in patchy[:40]:
            print(f"        {s:<14} {n:>5} days  ({n / total_days * 100:.0f}%)")
        if len(patchy) > 40:
            print(f"        … and {len(patchy) - 40} more")
        if missing:
            ok = False

    print("\n" + line)
    print("VERDICT: " + ("clean — no failures, no duplicates, values in range."
                         if ok else "!!! PROBLEMS ABOVE — read the !!! lines."))
    print(line)
    return ok


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="start", default=START)
    ap.add_argument("--to", dest="end", default=None)
    ap.add_argument("--universe", default=UNIVERSE)
    ap.add_argument("--out-dir", default=OUT_DIR)
    ap.add_argument("--restart", action="store_true")
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    paths = {
        "deliv": os.path.join(args.out_dir, "deliv.csv"),
        "fut": os.path.join(args.out_dir, "fut_oi.csv"),
        "deliv_part": os.path.join(args.out_dir, "deliv.partial.csv"),
        "fut_part": os.path.join(args.out_dir, "fut_oi.partial.csv"),
        "progress": os.path.join(args.out_dir, "oi_deliv.progress.json"),
    }
    symbols = load_symbols(args.universe)

    if args.verify_only:
        with open(paths["deliv"]) as fh:
            deliv = list(csv.DictReader(fh))
        with open(paths["fut"]) as fh:
            futs = list(csv.DictReader(fh))
        _done, failed, holidays = load_progress(paths["progress"])
        sys.exit(0 if verify(deliv, futs, symbols, failed, holidays) else 1)

    if args.restart:
        for k in ("deliv_part", "fut_part", "progress"):
            try:
                os.remove(paths[k])
            except OSError:
                pass

    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end) if args.end else date.today()

    print(f"Symbols  : {len(symbols)} (from {os.path.relpath(args.universe, ROOT)})")
    print(f"Range    : {start} → {end}")
    print(f"F&O split: legacy before {UDIFF_FROM}, UDiFF from {UDIFF_FROM}")
    print(f"Output   : {args.out_dir}\n")

    _done, failed, holidays = download(symbols, start, end, paths)

    deliv = finalise(paths["deliv_part"], paths["deliv"],
                     ["symbol", "date", "close", "volume", "deliv_pct"])
    futs = finalise(paths["fut_part"], paths["fut"],
                    ["symbol", "date", "fut_close", "open_interest", "chg_in_oi"])
    print(f"\nWrote {len(deliv):,} rows → {paths['deliv']}")
    print(f"Wrote {len(futs):,} rows → {paths['fut']}")

    ok = verify(deliv, futs, symbols, failed, holidays)
    print(f"\nCheckpoint kept at {paths['progress']} (use --restart to refetch)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
