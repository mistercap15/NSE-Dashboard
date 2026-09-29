import copy, json, tempfile, unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from .market import resolve_catalog, classify, build_profile, member_manifest, read_profile, profile_path
from .storage import update, read, seed_session, dashboard
from .engine import IST, process, fresh, valid_quote
from . import test_engine as fixtures


class MarketTests(unittest.TestCase):
    def test_after_close_combines_actual_intraday_with_prior_history(self):
        end = datetime(2026, 9, 29, 16, tzinfo=IST)
        days = [(end - timedelta(days=n)).date().isoformat()
                for n in range(35) if (end - timedelta(days=n)).weekday() < 5]
        def candles(day):
            return [[f"{day}T{m//60:02}:{m%60:02}:00+05:30",100,101,99,100,10000,0]
                    for m in range(555,930,5)]
        m = {"symbol":"A","key":"NSE_EQ|A","isin":"A","entry_eligible":True,"tick_size":0.05}
        with tempfile.TemporaryDirectory() as d, patch('research.gap_paper.market.Client') as C, patch('research.gap_paper.market.datetime', wraps=datetime) as clock:
            clock.now.return_value = end
            C.return_value.get.return_value = {"data":[]}
            C.return_value.history.side_effect = lambda key, first, last, **kw: [r for day in days if first<=day<=last and day<days[0] for r in candles(day)]
            C.return_value.intraday.return_value = candles(days[0])
            p = build_profile(d,m,{"calendar":{day:"regular" for day in days}},days[0],fixtures.CFG)
            self.assertTrue(p['complete'])
            self.assertEqual(p['sessions'],20)
            self.assertEqual(p['prior_close'],100)
            C.return_value.intraday.assert_called_once()

    def test_matching_session_with_stale_action_check_is_not_eligible(self):
        with tempfile.TemporaryDirectory() as d:
            m = {"key": "NSE_EQ|A"}
            path = profile_path(d, m["key"])
            path.parent.mkdir()
            p = {"key": m["key"], "as_of": "2026-09-28",
                 "checked_at": (datetime.now(IST) - timedelta(hours=19)).isoformat()}
            path.write_text(json.dumps(p))
            self.assertIsNone(read_profile(d, m, "2026-09-28"))
            p["checked_at"] = datetime.now(IST).isoformat()
            path.write_text(json.dumps(p))
            self.assertIsNotNone(read_profile(d, m, "2026-09-28"))

    def test_all_equities_not_index_members_and_series_identity(self):
        equities = [
            {"SYMBOL": s, " ISIN NUMBER": s, " SERIES": "EQ", "NAME OF COMPANY": s}
            for s in ["SMALLCO", "LARGECO"]
        ]
        master = [
            {
                "segment": "NSE_EQ",
                "instrument_type": "EQ",
                "isin": s,
                "instrument_key": "NSE_EQ|" + s,
                "security_type": "NORMAL",
                "tick_size": 5,
                "lot_size": 1,
            }
            for s in ["SMALLCO", "LARGECO"]
        ]
        members, excluded = resolve_catalog(
            equities, master, [{**master[0], "instrument_type": "BE"}]
        )
        self.assertEqual(len(members), 2)
        self.assertTrue(all(m["entry_eligible"] for m in members))
        self.assertFalse(excluded)
        members, excluded = resolve_catalog(equities, master, [master[0]])
        self.assertEqual(
            next(m for m in members if m["symbol"] == "SMALLCO")["exclusion"],
            "suspended",
        )

    def test_history_unknown_never_eligible_even_with_large_gap(self):
        self.assertEqual(
            classify(
                {"exclusion": None}, {"gap": 0.05}, None, "2026-09-29", fixtures.CFG
            ),
            "history_pending",
        )
        p = {
            "complete": True,
            "sessions": 20,
            "blocked_days": ["2026-09-29"],
            "median_value": 2e8,
        }
        self.assertEqual(
            classify({"exclusion": None}, {"gap": 0.05}, p, "2026-09-29", fixtures.CFG),
            "corporate_action_quarantine",
        )

    def test_month_chunks_terminate_at_partial_last_month(self):
        member = {
            "symbol": "A",
            "key": "NSE_EQ|A",
            "isin": "A",
            "entry_eligible": True,
            "tick_size": 0.05,
        }
        cat = {"calendar": {"2026-09-28": "regular"}}
        with tempfile.TemporaryDirectory() as d, patch(
            "research.gap_paper.market.Client"
        ) as C:
            C.return_value.get.return_value = {"data": []}
            C.return_value.history.return_value = []
            p = build_profile(d, member, cat, "2026-09-28", fixtures.CFG)
            self.assertEqual(C.return_value.history.call_count, 2)
            self.assertEqual(C.return_value.history.call_args.args[-1], "2026-09-28")
            self.assertFalse(p["complete"])
            self.assertEqual(p["sessions"], 0)

    def test_quote_clock_skew_is_bounded(self):
        q = {"source_at": "2026-09-29T09:30:01+05:30", "bid": 100, "ask": 101}
        self.assertTrue(valid_quote(q, "2026-09-29T09:30:00+05:30"))
        q["source_at"] = "2026-09-29T09:30:03+05:30"
        self.assertFalse(valid_quote(q, "2026-09-29T09:30:00+05:30"))


class MarketCausalityTests(unittest.TestCase):
    setUp = fixtures.EngineTests.setUp
    ready = fixtures.EngineTests.ready

    def test_request_before_signal_cannot_fill_even_if_received_after(self):
        self.c["execution"] = "quote"
        self.s = fresh(self.c, self.m, self.cal)
        self.ready()
        q = {
            "symbol": "A",
            "bid": 104,
            "ask": 104.1,
            "source_at": fixtures.ts("09:36"),
            "requested_at": fixtures.ts("09:34"),
        }
        process(
            self.s,
            {"kind": "quote", "at": fixtures.ts("09:36"), "quote": q},
            self.c,
            self.m,
            self.cal,
        )
        self.assertFalse(self.s["positions"])
        q["requested_at"] = fixtures.ts("09:36")
        q["source_at"] = fixtures.ts("09:37")
        process(
            self.s,
            {"kind": "quote", "at": fixtures.ts("09:37"), "quote": q},
            self.c,
            self.m,
            self.cal,
        )
        self.assertIn("A", self.s["positions"])

    def test_seed_preserves_cash_and_uses_only_prior_session(self):
        x = self.ready()
        x["minutes"] = list(range(555, 930, 5))
        x["pv"] = 2e8
        p = {
            "symbol": "A",
            "as_of": "2026-09-25",
            "checked_at": "2026-09-28T08:00:00+05:30",
            "stock": copy.deepcopy(x),
        }
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "paper.sqlite"
            before = update(db, self.c, self.m, self.cal)
            seed_session(
                db, self.c, self.m, self.cal, [p], fixtures.DAY, fixtures.ts("09:20")
            )
            after = read(db)
            self.assertEqual(before["account_id"], after["account_id"])
            self.assertEqual(after["cash"], 200000)
            self.assertEqual(after["trades"], [])
            self.assertIsNone(after["stocks"]["A"]["pending"])
            self.assertFalse(after["ranked"])
            p["checked_at"] = fixtures.ts("09:21")
            with self.assertRaises(ValueError):
                seed_session(
                    db,
                    self.c,
                    self.m,
                    self.cal,
                    [p],
                    fixtures.DAY,
                    fixtures.ts("09:20"),
                )
