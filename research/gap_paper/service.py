"""Standalone read-only-market-data paper service. No broker order API exists here."""

import argparse, copy, hmac, json, math, os, signal, threading, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from .data import Client, DataError
from .engine import IST, stamp, digest, valid_quote
from .cli import events
from .references import prepare
from .storage import read, update, metadata, dashboard


def now():
    return datetime.now(IST)


def closed_slot(t):
    return t.replace(minute=t.minute // 5 * 5, second=0, microsecond=0)


def quote_batch(response, members, received):
    mapping = {m["key"]: m["symbol"] for m in members}
    quotes = []
    issues = []
    for row in response.get("data", {}).values():
        key = row.get("instrument_token")
        sym = mapping.get(key)
        if not sym:
            continue
        try:
            buy = row["depth"]["buy"][0]
            sell = row["depth"]["sell"][0]
            q = {
                "symbol": sym,
                "source_at": stamp(row["timestamp"]).isoformat(),
                "requested_at": response.get("_request_started_at", received),
                "bid": float(buy["price"]),
                "ask": float(sell["price"]),
                "bid_size": float(buy["quantity"]),
                "ask_size": float(sell["quantity"]),
            }
            if not -2 <= (stamp(received) - stamp(q["source_at"])).total_seconds() <= 5:
                raise ValueError("stale")
            if any(not math.isfinite(q[k]) or q[k] < 0 for k in ["bid", "ask", "bid_size", "ask_size"]):
                raise ValueError("invalid depth")
            if any((q[side] == 0) != (q[side + "_size"] == 0) for side in ["bid", "ask"]):
                raise ValueError("inconsistent depth")
            if q["bid"] == 0 or q["ask"] == 0:
                reason = "empty_book" if q["bid"] == q["ask"] == 0 else "no_ask" if q["ask"] == 0 else "no_bid"
                issues.append({"symbol": sym, "reason": reason, "source_at": q["source_at"]})
                if valid_quote(q, received, side="bid"):
                    quotes.append(q)  # A real bid can close a long; absent ask cannot buy.
            elif valid_quote(q, received):
                quotes.append(q)
            else:
                raise ValueError("crossed")
        except (KeyError, IndexError, TypeError, ValueError):
            issues.append({"symbol": sym, "reason": "unusable_quote"})
    return quotes, issues


def missing_feed_symbols(wanted, quotes, issues):
    # Fresh zero-sided depth is an observed market state, not missing feed data.
    observed = {q["symbol"] for q in quotes} | {
        x["symbol"] for x in issues if x["reason"] in {"no_ask", "no_bid", "empty_book"}
    }
    return wanted - observed


class PaperService:
    def __init__(self, root, cfg):
        if (
            cfg["mode"] != "paper"
            or cfg["execution"] != "quote"
            or cfg["telegram_delivery"]
        ):
            raise ValueError(
                "Service requires quote paper mode with messaging disabled"
            )
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = self.root / "paper.sqlite"
        self.cfg = cfg
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.pool = ThreadPoolExecutor(max_workers=2)
        self.reference_future = None
        self.candle_future = None
        self.bootstrap_future = None
        self.bootstrap_done = False
        self.requested_slot = None
        self.retry_after = 0
        self.bundle = metadata(self.db, "references")
        self.client = Client(self.root / "quotes_cache")
        self.health = metadata(self.db, "health") or {}
        self.health.update(
            status="starting",
            started_at=now().isoformat(),
            message="Preparing paper-only market observation",
        )
        self.gap_day = self.health.get("entry_halt_day")
        self.last_quote = self.health.get("last_quote_received")
        self.references_ready = False

    def status(self, status, message=None, **extra):
        self.health.update(
            status=status,
            heartbeat_at=now().isoformat(),
            execution="quote-modeled",
            entry_halt_day=self.gap_day,
            **extra
        )
        if message is not None:
            self.health["message"] = message
        metadata(self.db, "health", self.health)

    def ingest(self, event):
        with self.lock:
            return update(
                self.db,
                self.cfg,
                self.bundle["manifest"],
                self.bundle["calendar"],
                events=[event],
            )

    def control(self, action):
        with self.lock:
            if not self.bundle:
                raise ValueError("References are still preparing")
            s = read(self.db)
            if action == "reset" and s and s["positions"]:
                raise ValueError("Close paper positions before resetting")
            if action in ["pause", "resume", "reset"]:
                metadata(self.db, "manual_pause", action != "resume")
            update(
                self.db,
                self.cfg,
                self.bundle["manifest"],
                self.bundle["calendar"],
                action=action,
            )
            if action == "reset":
                update(
                    self.db,
                    self.cfg,
                    self.bundle["manifest"],
                    self.bundle["calendar"],
                    action="pause",
                )
                self.bootstrap_done = False
                self.gap_day = now().date().isoformat()

    def load_history(self, bundle):
        client = Client(self.root / "history_cache")
        raw = {}
        today = now().date()
        for member in bundle["manifest"]["members"]:
            cs = []
            d = max(
                today - timedelta(days=100),
                datetime.fromisoformat(member["from"]).date(),
            )
            while d < today:
                end = min(today - timedelta(days=1), d + timedelta(days=24))
                cs.extend(client.history(member["key"], d.isoformat(), end.isoformat()))
                d = end + timedelta(days=1)
            # Include today's actually completed bars in warmup; never fabricate trades.
            cs.extend(client.intraday(member["key"]))
            raw[member["symbol"]] = cs
        cutoff = now().isoformat()
        history = [e for e in events(raw)[0] if e["at"] <= cutoff]
        if not history:
            raise DataError("No completed warmup candles available")
        return history

    def fetch_candles(self, bundle, target):
        client = Client(self.root / "candles_cache")
        raw = {}
        issues = []
        for m in bundle["manifest"]["members"]:
            try:
                raw[m["symbol"]] = client.intraday(m["key"])
            except DataError:
                raw[m["symbol"]] = []
                issues.append(
                    {"symbol": m["symbol"], "reason": "candle_request_failed"}
                )
        batches, invalid = events(raw)
        return (
            target,
            [e for e in batches if e["at"] <= target and e["at"][:10] == target[:10]],
            issues + invalid,
        )

    def candle_symbols(self, state):
        return {m["symbol"] for m in self.bundle["manifest"]["members"]}

    def apply_candles(self, result):
        target, batches, issues = result
        s = read(self.db)
        last = s.get("last_candle")
        members = self.candle_symbols(s)
        applied = 0
        for e in batches:
            if last and e["at"] <= last:
                continue
            received = now()
            late = (received - stamp(e["at"])).total_seconds() > 90
            missing = members - {b["symbol"] for b in e["bars"]}
            selected = {r["symbol"] for r in s.get("shortlist", [])}
            first = stamp(e["at"]).hour == 9 and stamp(e["at"]).minute == 20
            if received.hour < 11 and (
                late or (missing and (first or selected & missing))
            ):
                self.gap_day = received.date().isoformat()
            update(
                self.db,
                self.cfg,
                self.bundle["manifest"],
                self.bundle["calendar"],
                operational_halt=self.gap_day == received.date().isoformat(),
            )
            e.update(
                closed_at=e["at"],
                at=received.isoformat(),
                received_at=received.isoformat(),
            )
            s = self.ingest(e)
            last = s.get("last_candle")
            applied += 1
            issues.extend(
                {
                    "symbol": sym,
                    "reason": "missing_completed_bar",
                    "closed_at": e["closed_at"],
                }
                for sym in sorted(missing)
            )
        if (not batches or not last or last < target) and now().hour < 11:
            self.gap_day = now().date().isoformat()
        self.health.update(
            last_candle_received=now().isoformat(),
            last_completed_candle=last,
            candle_issues=issues[:100],
            candle_batches_processed=applied,
        )

    def tick(self):
        t = now()
        day = t.date().isoformat()
        minutes = t.hour * 60 + t.minute
        # References refresh before the open, never silently reuse yesterday's eligibility.
        need_refs = (
            not self.references_ready or not self.bundle or self.bundle["day"] != day
        )
        if (
            need_refs
            and not self.reference_future
            and time.monotonic() >= self.retry_after
            and (minutes >= 510 or not self.bundle)
        ):
            self.references_ready = False
            self.reference_future = self.pool.submit(prepare, self.root, t.date())
            self.status(
                "preparing", "Checking current universe, calendar and corporate actions"
            )
        if self.reference_future and self.reference_future.done():
            task = self.reference_future
            self.reference_future = None
            try:
                new = task.result()
                s = read(self.db)
                if (
                    s
                    and s["positions"]
                    and self.bundle
                    and digest(new) != digest(self.bundle)
                ):
                    self.retry_after = time.monotonic() + 60
                    self.status(
                        "recovering",
                        "Closing carried paper positions before reference rollover",
                    )
                else:
                    with self.lock:
                        update(
                            self.db,
                            self.cfg,
                            new["manifest"],
                            new["calendar"],
                            refresh_references=True,
                        )
                        self.bundle = new
                        metadata(self.db, "references", new)
                        metadata(
                            self.db,
                            "universe",
                            {
                                "label": new["manifest"]["label"],
                                "members": len(new["manifest"]["members"]),
                                "exclusions": new["exclusions"],
                                "reference_day": day,
                                "source_policy": new["source_policy"],
                            },
                        )
                    self.references_ready = True
                    if self.gap_day != day:
                        self.gap_day = None
            except Exception as e:
                self.retry_after = time.monotonic() + 300
                self.status(
                    "reference_error",
                    "Daily reference checks failed; new entries blocked",
                    error_type=type(e).__name__,
                )
        if not self.bundle:
            return
        s = read(self.db)
        if not s["stocks"] and not self.bootstrap_future and self.references_ready:
            update(
                self.db,
                self.cfg,
                self.bundle["manifest"],
                self.bundle["calendar"],
                action="pause",
            )
            self.bootstrap_future = self.pool.submit(
                self.load_history, copy.deepcopy(self.bundle)
            )
            self.status(
                "warming_up",
                "Loading 100 calendar days of completed candles; no historical entries",
            )
        if self.bootstrap_future:
            if not self.bootstrap_future.done():
                self.status("warming_up")
                return
            task = self.bootstrap_future
            self.bootstrap_future = None
            history = task.result()
            for e in history:
                e["bootstrap"] = True
            update(
                self.db,
                self.cfg,
                self.bundle["manifest"],
                self.bundle["calendar"],
                events=history,
            )
            if metadata(self.db, "manual_pause") is not True:
                update(
                    self.db,
                    self.cfg,
                    self.bundle["manifest"],
                    self.bundle["calendar"],
                    action="resume",
                )
            self.bootstrap_done = True
            if 555 <= minutes < 930:
                self.gap_day = day
            self.status("ready", "Warmup complete. Forward observation only.")
            s = read(self.db)
        if s["stocks"]:
            self.bootstrap_done = True
        active = self.bundle["calendar"].get(day) == "regular" and 555 <= minutes < 940
        halt = (
            not self.references_ready
            or self.bundle["day"] != day
            or self.gap_day == day
        )
        update(
            self.db,
            self.cfg,
            self.bundle["manifest"],
            self.bundle["calendar"],
            operational_halt=halt,
        )
        if self.candle_future and self.candle_future.done():
            task = self.candle_future
            self.candle_future = None
            self.apply_candles(task.result())
            s = read(self.db)
        if not active:
            self.status(
                "market_closed" if self.references_ready else "reference_error",
                "Paper service running; waiting for a regular NSE session",
                entry_halt=halt,
            )
            return
        target = closed_slot(t).isoformat()
        if (
            560 <= minutes < 940
            and self.requested_slot != target
            and not self.candle_future
        ):
            self.requested_slot = target
            self.candle_future = self.pool.submit(
                self.fetch_candles, copy.deepcopy(self.bundle), target
            )
        # Full-quote requests only for the frozen shortlist/positions; one heartbeat symbol otherwise.
        wanted = set(s["positions"]) | {r["symbol"] for r in s.get("shortlist", [])}
        members = [
            m for m in self.bundle["manifest"]["members"] if m["symbol"] in wanted
        ]
        if not members:
            members = self.bundle["manifest"]["members"][:1]
        response = self.client.quotes([m["key"] for m in members])
        received = now()
        quotes, issues = quote_batch(response, members, received.isoformat())
        expected = {m["symbol"] for m in members}
        missing = expected - {q["symbol"] for q in quotes}
        interrupted = (
            self.last_quote
            and self.last_quote[:10] == day
            and (received - stamp(self.last_quote)).total_seconds() > 30
        )
        if minutes < 660 and (missing or interrupted):
            self.gap_day = day
        update(
            self.db,
            self.cfg,
            self.bundle["manifest"],
            self.bundle["calendar"],
            operational_halt=not self.references_ready or self.gap_day == day,
        )
        if quotes:
            self.ingest(
                {"kind": "quotes", "at": received.isoformat(), "quotes": quotes}
            )
        self.last_quote = received.isoformat() if not missing else self.last_quote
        self.status(
            "entry_halted" if self.gap_day == day else "observing",
            "Quote estimates only; exchange orders are never sent.",
            last_quote_received=self.last_quote,
            quote_issues=issues,
            quote_interval_seconds=5,
            entry_halt=self.gap_day == day,
        )

    def run(self):
        try:
            while not self.stop.is_set():
                try:
                    self.tick()
                except Exception as e:
                    if self.bundle:
                        t = now()
                        if 555 <= t.hour * 60 + t.minute < 660:
                            self.gap_day = t.date().isoformat()
                        update(
                            self.db,
                            self.cfg,
                            self.bundle["manifest"],
                            self.bundle["calendar"],
                            operational_halt=True,
                        )
                    self.status(
                        "data_error",
                        "Market data interrupted; new entries blocked. Paper exits need the next valid quote.",
                        error_type=type(e).__name__,
                    )
                self.stop.wait(5)
        finally:
            self.status("stopped", "Paper observation stopped")
            self.pool.shutdown(wait=False, cancel_futures=True)


def handler(service, secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, value):
            raw = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def authorized(self):
            return hmac.compare_digest(self.headers.get("X-Paper-Secret", ""), secret)

        def do_GET(self):
            if not self.authorized():
                return self.send(403, {"error": "Forbidden"})
            parsed = urlsplit(self.path)
            if parsed.path not in ["/state", "/health"]:
                return self.send(404, {"error": "Not found"})
            if parsed.path == "/health":
                return self.send(200, service.health)
            day = parse_qs(parsed.query).get("day", [now().date().isoformat()])[0]
            try:
                datetime.strptime(day, "%Y-%m-%d")
            except ValueError:
                return self.send(400, {"error": "Invalid day"})
            try:
                result = dashboard(service.db, day)
                health = result["service"]
                heartbeat = health.get("heartbeat_at")
                quote = health.get("last_quote_received")
                health["heartbeat_age_seconds"] = (
                    (now() - stamp(heartbeat)).total_seconds() if heartbeat else None
                )
                health["quote_age_seconds"] = (
                    (now() - stamp(quote)).total_seconds() if quote else None
                )
                return self.send(200, result)
            except Exception:
                return self.send(503, {"error": "Paper ledger temporarily unavailable"})

        def do_POST(self):
            if not self.authorized():
                return self.send(403, {"error": "Forbidden"})
            if self.path != "/control":
                return self.send(404, {"error": "Not found"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 1024:
                    raise ValueError("Invalid request size")
                body = json.loads(self.rfile.read(size))
                action = body.get("action")
                if action not in ["pause", "resume", "reset"]:
                    raise ValueError("Paper controls only")
                if action == "reset" and body.get("confirm") != "RESET PAPER ACCOUNT":
                    raise ValueError("Explicit reset confirmation required")
                service.control(action)
                return self.send(200, dashboard(service.db, now().date().isoformat()))
            except (ValueError, TypeError):
                return self.send(
                    409,
                    {
                        "error": "Paper control rejected; check account state and confirmation"
                    },
                )
            except Exception:
                return self.send(
                    503,
                    {
                        "error": "Paper control unavailable; reload status before retrying"
                    },
                )

    return Handler


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
        raise SystemExit(
            "A dedicated paper HTTP secret of at least 32 characters is required"
        )
    service = PaperService(args.root, json.loads(Path(args.config).read_text()))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler(service, secret))
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    def stop(*_):
        service.stop.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        service.run()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
