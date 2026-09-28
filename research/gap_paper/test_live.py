import copy, json, tempfile, unittest, sqlite3
from pathlib import Path
from datetime import date
from .test_engine import bar, evt, ts, DAY
from . import test_engine as fixtures
from .engine import process, fresh, equity, stamp, digest
from .storage import update, read, dashboard, metadata
from .service import quote_batch
from .references import calendar_from_holidays, action_days


class LiveTests(unittest.TestCase):
    setUp = fixtures.EngineTests.setUp
    ready = fixtures.EngineTests.ready
    runbar = fixtures.EngineTests.runbar

    def test_delayed_closed_bar_interleaves_with_quotes(self):
        self.c["execution"] = "quote"
        self.s = fresh(self.c, self.m, self.cal)
        self.ready()
        process(
            self.s,
            {
                "kind": "quotes",
                "at": ts("09:36"),
                "quotes": [
                    {"symbol": "A", "source_at": ts("09:36"), "bid": 102, "ask": 102.1}
                ],
            },
            self.c,
            self.m,
            self.cal,
        )
        e = evt([bar("09:35")])
        e.update(closed_at=e["at"], at=ts("09:41"), received_at=ts("09:41"))
        process(self.s, e, self.c, self.m, self.cal)
        self.assertEqual(self.s["last_candle"], ts("09:40"))
        self.assertEqual(self.s["last_event"], ts("09:41"))
        e["at"] = ts("09:42")
        e["received_at"] = ts("09:42")
        with self.assertRaises(ValueError):
            process(self.s, e, self.c, self.m, self.cal)

    def test_quote_pending_expires_without_candle_arrival(self):
        self.c["execution"] = "quote"
        self.s = fresh(self.c, self.m, self.cal)
        x = self.ready()
        process(
            self.s,
            {
                "kind": "quotes",
                "at": ts("09:51"),
                "quotes": [
                    {"symbol": "A", "source_at": ts("09:51"), "bid": 104, "ask": 104.1}
                ],
            },
            self.c,
            self.m,
            self.cal,
        )
        self.assertFalse(self.s["positions"])
        self.assertEqual(x["reason"], "pending_expired")

    def test_quote_batch_rank_and_operational_halt(self):
        self.c["execution"] = "quote"
        self.s = fresh(self.c, self.m, self.cal)
        for sym, rank in [("A", 3), ("B", 1), ("C", 2)]:
            self.ready(sym, rank)
        process(
            self.s,
            {
                "kind": "quotes",
                "at": ts("09:36"),
                "quotes": [
                    {"symbol": sym, "source_at": ts("09:36"), "bid": 103.9, "ask": 104}
                    for sym in "ABC"
                ],
            },
            self.c,
            self.m,
            self.cal,
        )
        self.assertEqual(set(self.s["positions"]), {"B", "C"})
        self.s["operational_halt"] = True
        process(
            self.s,
            {
                "kind": "quotes",
                "at": ts("09:37"),
                "quotes": [
                    {"symbol": "B", "source_at": ts("09:37"), "bid": 100, "ask": 100.1}
                ],
            },
            self.c,
            self.m,
            self.cal,
        )
        self.assertEqual(
            len(self.s["trades"]), 1
        )  # exits remain enabled during feed halt

    def test_late_candle_does_not_overwrite_fresh_bid_mark(self):
        self.c["execution"] = "quote"
        self.s = fresh(self.c, self.m, self.cal)
        self.ready()
        process(
            self.s,
            {
                "kind": "quotes",
                "at": ts("09:36"),
                "quotes": [
                    {"symbol": "A", "source_at": ts("09:36"), "bid": 103.9, "ask": 104}
                ],
            },
            self.c,
            self.m,
            self.cal,
        )
        e = evt([bar("09:35", 104, 105, 102, 104.8)])
        e.update(closed_at=e["at"], at=ts("09:41"))
        process(self.s, e, self.c, self.m, self.cal)
        self.assertEqual(
            self.s["positions"]["A"]["mark"], 103.9
        )  # entry fill until next fresh bid event

    def test_daily_ledger_realized_unrealized_fees_and_idempotency(self):
        self.ready()
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "paper.sqlite"
            update(db, self.c, self.m, self.cal)
            self.s["strategy_hash"] = digest(self.c)
            with sqlite3.connect(db) as conn:
                conn.execute("update accounts set state=?", (json.dumps(self.s),))
            e = evt([bar("09:35", 104, 104.2, 103.9, 104.2)])
            a = update(db, self.c, self.m, self.cal, events=[e])
            first = dashboard(db, DAY)["daily"]
            self.assertEqual(first["entries"], 1)
            self.assertEqual(first["closed_trades"], 0)
            self.assertGreater(first["fees"], 0)
            self.assertAlmostEqual(
                first["net_pnl"], first["realized_pnl"] + first["unrealized_change"]
            )
            exit_event = evt([bar("09:40", 100, 101, 99, 100)])
            update(db, self.c, self.m, self.cal, events=[exit_event])
            update(db, self.c, self.m, self.cal, events=[e])
            report = dashboard(db, DAY)
            daily = report["daily"]
            self.assertEqual(daily["entries"], 1)
            self.assertEqual(daily["closed_trades"], 1)
            self.assertAlmostEqual(daily["net_pnl"], daily["realized_pnl"])
            self.assertEqual(len(report["day_records"]["trades"]), 1)

    def test_bootstrap_has_no_daily_performance(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "paper.sqlite"
            e = evt([bar("09:15")])
            e["bootstrap"] = True
            update(db, self.c, self.m, self.cal, events=[e])
            report = dashboard(db, DAY)
            self.assertEqual(report["daily_history"], [])
            self.assertIsNone(report["daily"])
            self.assertEqual(report["day_records"]["signals"], [])

    def test_reference_refresh_preserves_account_and_rejects_strategy_change(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "paper.sqlite"
            a = update(db, self.c, self.m, self.cal)
            cal = {**self.cal, "2026-09-29": "regular"}
            b = update(db, self.c, self.m, cal, refresh_references=True)
            self.assertEqual(a["account_id"], b["account_id"])
            self.assertEqual(a["cash"], b["cash"])
            cfg = {**self.c, "slippage_bps": 25}
            with self.assertRaises(ValueError):
                update(db, cfg, self.m, cal, refresh_references=True)


class ReferenceTests(unittest.TestCase):
    def test_calendar_settlement_holiday_is_not_trading_holiday(self):
        c = calendar_from_holidays(
            [
                {
                    "date": "2026-09-28",
                    "holiday_type": "SETTLEMENT_HOLIDAY",
                    "closed_exchanges": ["CDS"],
                },
                {
                    "date": "2026-09-29",
                    "holiday_type": "TRADING_HOLIDAY",
                    "closed_exchanges": ["NSE"],
                },
                {
                    "date": "2026-09-30",
                    "holiday_type": "SPECIAL_TIMING",
                    "closed_exchanges": [],
                },
            ],
            2026,
        )
        self.assertEqual(c["2026-09-28"], "regular")
        self.assertEqual(c["2026-09-29"], "closed")
        self.assertEqual(c["2026-09-30"], "special")

    def test_action_date_unknown_fails_closed(self):
        self.assertEqual(action_days([{"expiry_date": "29 Sep 2026"}]), {"2026-09-29"})
        with self.assertRaises(Exception):
            action_days([{"expiry_date": "unknown"}])

    def test_quote_adapter_requires_bid_ask_and_quote_timestamp(self):
        rows = {
            "data": {
                "A": {
                    "instrument_token": "NSE_EQ|A",
                    "timestamp": ts("09:36"),
                    "depth": {
                        "buy": [{"price": 100, "quantity": 2}],
                        "sell": [{"price": 101, "quantity": 3}],
                    },
                }
            }
        }
        q, errors = quote_batch(rows, [{"key": "NSE_EQ|A", "symbol": "A"}], ts("09:36"))
        self.assertEqual(q[0]["ask"], 101)
        self.assertEqual(q[0]["bid_size"], 2)
        self.assertFalse(errors)
        q, errors = quote_batch(rows, [{"key": "NSE_EQ|A", "symbol": "A"}], ts("09:37"))
        self.assertFalse(q)
        self.assertTrue(errors)


class ServiceBoundaryTests(unittest.TestCase):
    def test_http_auth_and_paper_only_controls(self):
        import io
        from types import SimpleNamespace
        from unittest.mock import Mock
        from .service import handler

        service = SimpleNamespace(health={"status": "market_closed"}, control=Mock())
        Handler = handler(service, "test-secret")
        h = object.__new__(Handler)
        h.headers = {}
        h.path = "/health"
        responses = []
        h.send = lambda status, body: responses.append((status, body))
        h.do_GET()
        self.assertEqual(responses[-1][0], 403)
        h.headers = {"X-Paper-Secret": "test-secret"}
        h.do_GET()
        self.assertEqual(responses[-1], (200, {"status": "market_closed"}))
        body = json.dumps({"action": "place_order"}).encode()
        h.path = "/control"
        h.headers["Content-Length"] = str(len(body))
        h.rfile = io.BytesIO(body)
        h.do_POST()
        self.assertEqual(responses[-1][0], 409)
        service.control.assert_not_called()
        body = json.dumps({"action": "reset"}).encode()
        h.headers["Content-Length"] = str(len(body))
        h.rfile = io.BytesIO(body)
        h.do_POST()
        self.assertEqual(responses[-1][0], 409)
        service.control.assert_not_called()

    def test_adapter_rejects_empty_depth(self):
        rows = {
            "data": {
                "A": {
                    "instrument_token": "NSE_EQ|A",
                    "timestamp": ts("09:36"),
                    "depth": {
                        "buy": [{"price": 100, "quantity": 0}],
                        "sell": [{"price": 101, "quantity": 3}],
                    },
                }
            }
        }
        q, issues = quote_batch(rows, [{"key": "NSE_EQ|A", "symbol": "A"}], ts("09:36"))
        self.assertEqual(q, [])
        self.assertTrue(issues)

    def test_restart_keeps_manual_pause_and_ledger(self):
        from .service import PaperService

        c = json.loads(Path(__file__).with_name("config.live.json").read_text())
        with tempfile.TemporaryDirectory() as d:
            first = PaperService(d, c)
            metadata(first.db, "manual_pause", True)
            first.pool.shutdown()
            second = PaperService(d, c)
            self.assertTrue(metadata(second.db, "manual_pause"))
            self.assertFalse(second.references_ready)
            second.pool.shutdown()
