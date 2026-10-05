"""Whole-NSE discovery; V1 monitors only the top five verified opening gaps."""

import argparse, copy, json, os, signal, threading, time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from http.server import ThreadingHTTPServer
from .service import PaperService, handler, now, closed_slot, quote_batch
from .market import (
    catalog,
    scan,
    save,
    previous_session,
    read_profile,
    build_profile,
    member_manifest,
)
from .storage import metadata, read, update, seed_session
from .engine import stamp
from .cli import events
from .data import Client, DataError


class MarketService(PaperService):
    def __init__(self, root, cfg):
        super().__init__(root, cfg)
        self.cat = None
        self.catalog_future = None
        self.scan_future = None
        self.opening_future = None
        self.next_scan = 0
        self.catalog_retry = 0
        self.selected_day = metadata(self.db, "market_selected_day")
        self.opening_attempt = None
        self.profile_thread = threading.Thread(
            target=self.prepare_profiles, daemon=True
        )
        self.profile_thread.start()

    def prepare_profiles(self):
        while not self.stop.is_set():
            t = now()
            minute = t.hour * 60 + t.minute
            # Bulk preparation pauses around opening selection and the entry window.
            if not self.cat or 530 <= minute < 665:
                self.stop.wait(20)
                continue
            cat = copy.deepcopy(self.cat)
            target = (
                t.date().isoformat()
                if minute >= 945
                and cat["calendar"].get(t.date().isoformat()) == "regular"
                else previous_session(cat["calendar"], t.date().isoformat())
            )
            members = [m for m in cat["members"] if m["entry_eligible"]]
            progress = {
                "as_of": target,
                "total": len(members),
                "checked": 0,
                "ready": 0,
                "failed": 0,
                "status": "preparing",
                "started_at": t.isoformat(),
            }
            for m in members:
                if self.stop.is_set() or 530 <= now().hour * 60 + now().minute < 665:
                    break
                try:
                    p = build_profile(self.root, m, cat, target, self.cfg)
                    progress["ready"] += int(p["complete"] and p["sessions"] >= 20)
                except Exception as error:
                    if isinstance(
                        error, DataError
                    ) and "authentication/access rejected" in str(error):
                        progress.update(
                            status="authentication_required",
                            message=str(error),
                            updated_at=now().isoformat(),
                        )
                        metadata(self.db, "market_preparation", progress)
                        return
                    progress["failed"] += 1
                    save(
                        self.root / "profile_errors" / (m["symbol"] + ".json"),
                        {
                            "symbol": m["symbol"],
                            "as_of": target,
                            "reason": "history_or_action_check_failed",
                            "at": now().isoformat(),
                        },
                    )
                progress["checked"] += 1
                progress["last_symbol"] = m["symbol"]
                progress["updated_at"] = now().isoformat()
                metadata(self.db, "market_preparation", progress)
            progress["status"] = (
                "complete"
                if progress["checked"] == len(members)
                else "paused_for_market"
            )
            metadata(self.db, "market_preparation", progress)
            self.stop.wait(3600)

    def opening_bars(self, snapshot, cat):
        day = snapshot["day"]
        prior = previous_session(cat["calendar"], day)
        eligible = {
            r["symbol"] for r in snapshot["rows"] if r["eligibility"] == "eligible"
        }
        members = [m for m in cat["members"] if m["symbol"] in eligible]
        client = Client(self.root / "candles_cache")
        profiles = []
        bars = []
        missing = []
        manifest = {
            "label": "All NSE cash-equity discovery; verified V1 gap candidates",
            "members": [],
            "comparable": {},
        }
        def fetch(m):
            p = read_profile(self.root, m, prior)
            if not p:
                return m, None, None
            raw = client.intraday(m["key"])
            batch, _ = events({m["symbol"]: raw})
            first = next((e for e in batch if e["at"] == day + "T09:20:00+05:30"), None)
            return m, p, first

        # Check every eligible candidate before ranking, concurrently within the
        # shared per-API limiter. Serial one-per-second fetches cannot meet the
        # unchanged 90-second deadline on broad gap days.
        with ThreadPoolExecutor(max_workers=8) as pool:
            checked = list(pool.map(fetch, members))
        for m, p, first in checked:
            if not p or not first:
                missing.append(m["symbol"])
                continue
            profiles.append(p)
            bars.extend(first["bars"])
            single = member_manifest(m, prior, day, {day: 1})
            manifest["members"] += single["members"]
            manifest["comparable"].update(single["comparable"])
        return {
            "manifest": manifest,
            "calendar": cat["calendar"],
            "profiles": profiles,
            "bars": bars,
            "missing": missing,
            "day": day,
            "snapshot": snapshot,
        }

    def fetch_candles(self, bundle, target):
        s = read(self.db)
        wanted = set(s["positions"]) | {r["symbol"] for r in s["shortlist"]}
        subset = copy.deepcopy(bundle)
        subset["manifest"]["members"] = [
            m for m in bundle["manifest"]["members"] if m["symbol"] in wanted
        ]
        return super().fetch_candles(subset, target)

    def halt(self, reason):
        self.gap_day = now().date().isoformat()
        self.health["entry_halt_reason"] = reason

    def tick(self):
        t = now()
        day = t.date().isoformat()
        minute = t.hour * 60 + t.minute
        if (
            (not self.cat or self.cat["day"] != day)
            and not self.catalog_future
            and time.monotonic() >= self.catalog_retry
        ):
            self.catalog_future = self.pool.submit(catalog, self.root, t.date())
        if self.catalog_future and self.catalog_future.done():
            f = self.catalog_future
            self.catalog_future = None
            try:
                self.cat = f.result()
                if not metadata(self.db, "market_preparation"):
                    metadata(
                        self.db,
                        "market_preparation",
                        {
                            "total": sum(
                                m["entry_eligible"] for m in self.cat["members"]
                            ),
                            "checked": 0,
                            "ready": 0,
                            "failed": 0,
                            "status": "waiting_for_close",
                            "as_of": previous_session(self.cat["calendar"], day),
                        },
                    )
                metadata(
                    self.db,
                    "universe",
                    {
                        "label": "NSE cash equities — full exchange list",
                        "members": len(self.cat["members"]),
                        "exchange_listed": self.cat["exchange_listed"],
                        "exclusions": self.cat["unavailable"],
                        "reference_day": day,
                    },
                )
            except Exception:
                self.catalog_retry = time.monotonic() + 300
                self.status(
                    "reference_error", "NSE catalogue unavailable; entries blocked"
                )
        if not self.cat:
            self.status("preparing", "Loading the full NSE equity list")
            return
        if not self.bundle:
            self.bundle = {
                "manifest": {"members": [], "comparable": {}},
                "calendar": self.cat["calendar"],
                "day": day,
            }
            update(self.db, self.cfg, self.bundle["manifest"], self.bundle["calendar"])
        active = self.cat["calendar"].get(day) == "regular" and 555 <= minute < 940
        # Refresh market-wide rows during market hours; retain the dated last snapshot after close.
        should_scan = (
            active or not metadata(self.db, "scanner:" + day)
        ) and minute >= 555
        if should_scan and not self.scan_future and time.monotonic() >= self.next_scan:
            self.scan_future = self.pool.submit(
                scan, self.root, copy.deepcopy(self.cat), self.cfg
            )
            self.next_scan = time.monotonic() + 60
        if self.scan_future and self.scan_future.done():
            f = self.scan_future
            self.scan_future = None
            try:
                snapshot = f.result()
                self.health.pop("scan_error", None)
                metadata(self.db, "scanner:" + day, snapshot)
                # One immutable decision attempt. Never reconstruct a missed morning from afternoon prices.
                first = stamp(snapshot["started_at"])
                if (
                    self.cat["day"] == day
                    and first.hour == 9
                    and first.minute == 20
                    and self.opening_attempt != day
                    and self.selected_day != day
                ):
                    self.opening_attempt = day
                    save(self.root / "market_scans" / f"{day}-opening.json", snapshot)
                    if snapshot["selection_missing"]:
                        self.halt("Opening scan incomplete; selection skipped")
                    else:
                        self.opening_future = self.pool.submit(
                            self.opening_bars, snapshot, copy.deepcopy(self.cat)
                        )
            except Exception:
                self.health["scan_error"] = (
                    "Whole-market quotes unavailable; retained snapshot may be stale"
                )
                if 560 <= minute < 660:
                    self.halt("Whole-market scan interrupted")
        # Force a fresh opening scan, independent of the ordinary minute refresh cadence.
        if minute == 560 and self.opening_attempt != day and not self.scan_future:
            self.next_scan = 0
        if self.opening_future and self.opening_future.done():
            f = self.opening_future
            self.opening_future = None
            result = f.result()
            received = now()
            closed = day + "T09:20:00+05:30"
            selection_check = {
                "day": day,
                "received_at": received.isoformat(),
                "delay_seconds": (received - stamp(closed)).total_seconds(),
                "checked_candidates": len(result["profiles"]),
                "missing": result["missing"],
            }
            metadata(self.db, "selection_check:" + day, selection_check)
            s = read(self.db)
            if (
                result["missing"]
                or (received - stamp(closed)).total_seconds() > 90
                or s["positions"]
            ):
                self.halt(
                    "Opening candles late, incomplete, or carried position; no retrospective entries"
                )
            else:
                with self.lock:
                    seed_session(
                        self.db,
                        self.cfg,
                        result["manifest"],
                        result["calendar"],
                        result["profiles"],
                        day,
                        received.isoformat(),
                    )
                    self.bundle = {
                        "manifest": result["manifest"],
                        "calendar": result["calendar"],
                        "day": day,
                    }
                    metadata(self.db, "references", self.bundle)
                    if self.gap_day != day:
                        self.gap_day = None
                        self.health.pop("entry_halt_reason", None)
                    update(
                        self.db,
                        self.cfg,
                        self.bundle["manifest"],
                        self.bundle["calendar"],
                        operational_halt=self.gap_day == day,
                    )
                    self.ingest(
                        {
                            "kind": "candles",
                            "at": received.isoformat(),
                            "received_at": received.isoformat(),
                            "closed_at": closed,
                            "bars": result["bars"],
                        }
                    )
                    self.selected_day = day
                    metadata(self.db, "market_selected_day", day)
                    self.health["last_completed_candle"] = closed
                    self.health["last_candle_received"] = received.isoformat()
                    self.requested_slot = closed
        s = read(self.db)
        if (minute >= 562 and active and self.selected_day != day
                and self.gap_day != day):
            self.halt("No timely full-market opening selection for this session")
        halt = self.selected_day != day or self.gap_day == day
        update(
            self.db,
            self.cfg,
            self.bundle["manifest"],
            self.bundle["calendar"],
            operational_halt=halt,
        )
        if self.candle_future and self.candle_future.done():
            f = self.candle_future
            self.candle_future = None
            self.apply_candles(f.result())
            s = read(self.db)
        wanted = set(s["positions"]) | (
            {r["symbol"] for r in s["shortlist"]} if self.selected_day == day else set()
        )
        target = closed_slot(t).isoformat()
        if (
            active
            and self.selected_day == day
            and wanted
            and minute >= 565
            and self.requested_slot != target
            and not self.candle_future
        ):
            self.requested_slot = target
            self.candle_future = self.pool.submit(
                self.fetch_candles, copy.deepcopy(self.bundle), target
            )
        if active and wanted:
            members = [
                m for m in self.bundle["manifest"]["members"] if m["symbol"] in wanted
            ]
            response = self.client.quotes([m["key"] for m in members])
            received = now()
            quotes, issues = quote_batch(response, members, received.isoformat())
            missing = wanted - {q["symbol"] for q in quotes}
            interrupted = (
                self.last_quote
                and self.last_quote[:10] == day
                and (received - stamp(self.last_quote)).total_seconds() > 30
            )
            if minute < 660 and (missing or interrupted):
                self.halt("Missing or interrupted shortlisted-stock quotes")
            update(
                self.db,
                self.cfg,
                self.bundle["manifest"],
                self.bundle["calendar"],
                operational_halt=self.gap_day == day or self.selected_day != day,
            )
            if quotes:
                self.ingest(
                    {"kind": "quotes", "at": received.isoformat(), "quotes": quotes}
                )
            if not missing:
                self.last_quote = received.isoformat()
            self.health.update(last_quote_received=self.last_quote, quote_issues=issues)
        status = (
            "market_closed" if not active else "entry_halted" if halt else "observing"
        )
        self.status(
            status,
            "Scanning all broker-mapped NSE shares. V1 monitors only five verified opening-gap candidates.",
            entry_halt=halt,
            quote_interval_seconds=5,
            scanner_interval_seconds=60,
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument(
        "--config", default=str(Path(__file__).with_name("config.live.json"))
    )
    ap.add_argument("--port", type=int, default=8791)
    args = ap.parse_args()
    secret = os.environ.get("GAP_PAPER_HTTP_SECRET", "")
    if len(secret) < 32:
        raise SystemExit("Dedicated paper secret required")
    service = MarketService(args.root, json.loads(Path(args.config).read_text()))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler(service, secret))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: service.stop.set())
    signal.signal(signal.SIGINT, lambda *_: service.stop.set())
    try:
        service.run()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
