"""Synthetic, manually checkable causality and account invariants; no network."""

import copy, json, tempfile, unittest, sqlite3
from pathlib import Path
from datetime import timedelta
from .engine import *
from .storage import update, read
from .cli import events

CFG = json.loads((Path(__file__).parent / "config.json").read_text())
DAY = "2026-09-28"


def ts(hm, day=DAY):
    return day + "T" + hm + ":00+05:30"


def bar(hm, o=102, h=103, l=101, c=102, v=100000, sym="A"):
    return normalize(sym, [ts(hm), o, h, l, c, v])


def evt(b):
    return {
        "kind": "candles",
        "at": (stamp(b[0]["ts"]) + timedelta(minutes=5)).isoformat(),
        "bars": b,
    }


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.c = copy.deepcopy(CFG)
        self.c["corporate_action_policy"] = "continuity-assumption"
        self.c["slippage_bps"] = 0
        self.m = {
            "members": [
                {
                    "symbol": s,
                    "from": "2020-01-01",
                    "to": "2030-01-01",
                    "segment": "NSE_EQ",
                    "ordinary_share": True,
                    "eligible": True,
                    "suspended": False,
                    "tick_size": 0.05,
                }
                for s in "ABC"
            ],
            "comparable": {},
        }
        self.cal = {"2026-09-25": "regular", DAY: "regular"}
        self.s = fresh(self.c, self.m, self.cal)

    def runbar(self, *bs):
        return process(self.s, evt(list(bs)), self.c, self.m, self.cal)

    def ready(self, sym="A", rank=1):
        self.s["session"] = DAY
        self.s["ranked"] = True
        x = {
            "ema": 102,
            "count": 100,
            "values": [2e8] * 20,
            "prior_close": 100,
            "prior_day": "2026-09-25",
            "phase": "armed",
            "pending": {
                "trigger": 103.05,
                "stop": 101.95,
                "created": ts("09:35"),
                "original_created": ts("09:35"),
            },
            "minutes": [555, 560, 565, 570],
            "pv": 4e7,
            "vol": 400000,
            "last_volume": 100000,
            "last_minute": 570,
            "prev_close": 102.5,
            "entered": False,
            "pending_age": 0,
            "opening": 101,
            "reason": "",
            "pull_count": 2,
            "pull_low": 102,
            "vwap": 102,
            "rank": rank,
            "tick": 0.05,
            "pull_ended": False,
        }
        self.s["stocks"][sym] = x
        return x

    def test_normalization_timezone_and_invalid(self):
        b = normalize("A", ["2026-09-28T03:45:00+00:00", 1, 2, 1, 2, 0])
        self.assertEqual(minute(b["ts"]), 555)
        for row in [
            [ts("09:16"), 1, 2, 1, 2, 1],
            [ts("09:15"), 1, 0, 1, 2, 1],
            [ts("09:15"), 1, 2, 1, 2, -1],
        ]:
            with self.assertRaises(ValueError):
                normalize("A", row)

    def test_no_signal_bar_fill_and_closed_indicators(self):
        x = self.ready()
        x.update(
            phase="pullback", pending=None, pull_count=1, prev_close=103, pull_low=102.1
        )
        self.runbar(bar("09:35", 102.8, 103.5, 102.1, 102.5))
        self.assertFalse(self.s["positions"])
        self.assertEqual(x["pending"]["trigger"], 103.55)
        self.assertAlmostEqual(x["ema"], 102.1)
        self.runbar(bar("09:40", 102.6, 103.6, 102.4, 103.4))
        self.assertEqual(self.s["positions"]["A"]["entry"], 103.55)
        self.assertGreaterEqual(
            self.s["positions"]["A"]["entry_at"], self.s["positions"]["A"]["signal_at"]
        )

    def test_delayed_observer_cannot_fill_elapsed_part_of_next_bar(self):
        x = self.ready()
        x.update(
            phase="pullback", pending=None, pull_count=1, prev_close=103, pull_low=102.1
        )
        e = evt([bar("09:35", 102.8, 103.5, 102.1, 102.5)])
        e["received_at"] = ts("09:41")
        process(self.s, e, self.c, self.m, self.cal)
        self.assertEqual(x["pending"]["eligible_from"], ts("09:45"))
        self.runbar(bar("09:40", 102.6, 103.6, 102.4, 103.4))
        self.assertFalse(self.s["positions"])
        self.runbar(bar("09:45", 103.6, 104, 103.5, 103.8))
        self.assertEqual(self.s["positions"]["A"]["entry"], 103.6)

    def test_old_trigger_processed_before_update(self):
        self.ready()
        self.runbar(bar("09:35", 102.9, 103.1, 102.2, 102.3))
        self.assertEqual(self.s["positions"]["A"]["entry"], 103.05)

    def test_first_failure_no_replacement(self):
        x = self.ready()
        x.update(phase="pullback", pending=None, pull_count=1, prev_close=102.5)
        self.runbar(bar("09:35", 102.5, 103, 102, 102.6))
        self.assertEqual(x["reason"], "first_pullback_ended_early")
        self.runbar(bar("09:40", 102.6, 103, 102, 102.2))
        self.runbar(bar("09:45", 102.2, 102.4, 102, 102.1))
        self.assertIsNone(x["pending"])

    def test_sixth_lower_close_invalidates(self):
        x = self.ready()
        x["pull_count"] = 5
        x["pending"]["trigger"] = 110
        self.runbar(bar("09:35", 102.5, 102.7, 102, 102.2))
        self.assertEqual(x["reason"], "sixth_pullback_candle")

    def test_three_bar_expiry_and_no_extension(self):
        x = self.ready()
        x["pending"]["trigger"] = 110
        x["pull_ended"] = True
        for hm in ["09:35", "09:40", "09:45"]:
            self.runbar(bar(hm, 102.5, 102.9, 102.2, 102.6))
        self.assertEqual(x["reason"], "pending_expired")

    def test_cutoff(self):
        x = self.ready()
        x["last_minute"] = 655
        self.runbar(bar("11:00", 104, 105, 103, 104))
        self.assertFalse(self.s["positions"])
        self.assertEqual(x["reason"], "entry_cutoff")

    def test_entry_gap_and_whole_share_reserves(self):
        x = self.ready()
        self.runbar(bar("09:35", 104, 104.5, 103.9, 104.2))
        p = self.s["positions"]["A"]
        self.assertEqual(p["entry"], 104)
        self.assertIsInstance(p["qty"], int)
        self.assertLessEqual(p["planned_risk"], 500)
        self.assertLessEqual(
            p["qty"] * 104
            + total(p["entry_costs"])
            + total(costs(p["stop"], p["qty"], "sell", self.c, DAY)),
            50000,
        )
        self.assertAlmostEqual(self.s["equity"], self.s["cash"] + p["qty"] * 104.2)

    def test_stop_gap_and_cash_reconciliation(self):
        self.ready()
        self.runbar(bar("09:35", 104, 104.5, 103.9, 104))
        p = copy.deepcopy(self.s["positions"]["A"])
        self.runbar(bar("09:40", 100, 101, 99, 100))
        t = self.s["trades"][0]
        self.assertEqual(t["exit"], 100)
        self.assertEqual(t["reason"], "stop_gap")
        self.assertAlmostEqual(self.s["cash"], 200000 + t["pnl"])
        self.assertEqual(self.s["equity"], self.s["cash"])

    def test_stop_target_collision(self):
        self.ready()
        self.runbar(bar("09:35", 104, 104.2, 103.9, 104))
        self.runbar(bar("09:40", 104, 110, 101, 104))
        t = self.s["trades"][0]
        self.assertEqual(t["reason"], "stop")
        self.assertTrue(t["ambiguous"])

    def test_unknown_entry_bar_target_not_credited(self):
        self.ready()
        self.runbar(bar("09:35", 102.9, 110, 102, 104))
        self.assertIn("A", self.s["positions"])
        self.assertFalse(self.s["trades"])

    def test_target_requires_tick_penetration(self):
        self.ready()
        self.runbar(bar("09:35", 104, 104.2, 103.9, 104))
        target = self.s["positions"]["A"]["target"]
        self.runbar(bar("09:40", 104, target, 103.9, 104))
        self.assertIn("A", self.s["positions"])
        self.runbar(bar("09:45", 104, target + 0.05, 103.9, 104))
        self.assertEqual(self.s["trades"][0]["reason"], "target")

    def test_missing_squareoff_exits_next_observed_open(self):
        self.ready()
        self.runbar(bar("09:35", 104, 104.2, 103.9, 104))
        self.runbar(bar("15:20", 105, 106, 104, 105))
        t = self.s["trades"][0]
        self.assertEqual(t["exit"], 105)
        self.assertTrue(t["delayed"])
        self.assertTrue(self.s["events"])

    def test_simultaneous_rank_limits(self):
        for sym, rank in [("A", 3), ("B", 1), ("C", 2)]:
            self.ready(sym, rank)
        self.runbar(*(bar("09:35", 104, 104.2, 103.9, 104, sym=s) for s in "ABC"))
        self.assertEqual(set(self.s["positions"]), {"B", "C"})
        self.assertEqual(self.s["rejections"][0]["symbol"], "A")
        self.assertLessEqual(
            sum(p["planned_risk"] for p in self.s["positions"].values()), 1000
        )

    def test_intrabar_exits_cannot_fund_other_entries(self):
        for sym, rank in [("A", 1), ("B", 2), ("C", 3)]:
            self.ready(sym, rank)
        self.runbar(*(bar("09:35", 104, 110, 100, 104, sym=s) for s in "ABC"))
        self.assertEqual(len(self.s["trades"]), 2)
        self.assertEqual(self.s["rejections"][0]["reason"], "position_limit")

    def test_daily_halt_still_exits(self):
        self.ready()
        self.runbar(bar("09:35", 104, 104.2, 103.9, 104))
        self.s["day_start"] = 210000
        self.runbar(bar("09:40", 100, 101, 99, 100))
        self.assertTrue(self.s["halted"])
        self.assertFalse(self.s["positions"])
        x = self.ready("B")
        q, reason = proposal(self.s, x, 104, self.c, DAY)
        self.assertEqual(reason, "daily_loss_halt")

    def test_duplicate_out_of_order_conflict(self):
        self.ready()
        e = evt([bar("09:35")])
        process(self.s, e, self.c, self.m, self.cal)
        before = copy.deepcopy(self.s)
        process(self.s, e, self.c, self.m, self.cal)
        self.assertEqual(before, self.s)
        for bad in [evt([bar("09:30")]), evt([bar("09:35", c=102.5)])]:
            with self.assertRaises(ValueError):
                process(self.s, bad, self.c, self.m, self.cal)

    def test_incomplete_close_rejected(self):
        e = evt([bar("09:35")])
        e["at"] = ts("09:38")
        with self.assertRaises(ValueError):
            process(self.s, e, self.c, self.m, self.cal)

    def test_restart_idempotency_rollback_and_reset_archive(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "x.sqlite"
            e = evt([bar("09:15")])
            a = update(db, self.c, self.m, self.cal, events=[e])
            b = update(db, self.c, self.m, self.cal, events=[e])
            self.assertEqual(a, b)
            with self.assertRaises(ValueError):
                update(db, self.c, self.m, self.cal, events=[evt([bar("09:20")]), e])
            self.assertEqual(read(db), b)
            c = update(db, self.c, self.m, self.cal, action="reset")
            self.assertNotEqual(c["account_id"], a["account_id"])
            with sqlite3.connect(db) as conn:
                self.assertEqual(
                    conn.execute("select count(*) from accounts").fetchone()[0], 2
                )

    def test_ranking_uses_prior_values_and_freezes(self):
        self.s["session"] = DAY
        for sym in "ABC":
            x = self.ready(sym)
            x.update(
                phase="waiting", pending=None, last_minute=None, minutes=[], pv=0, vol=0
            )
        self.s["ranked"] = False
        self.s["stocks"]["B"]["values"] = [3e8] * 20
        self.runbar(
            bar("09:15", 102, 103, 102, 102, sym="A"),
            bar("09:15", 102, 103, 102, 102, sym="B"),
            bar("09:15", 103, 104, 103, 103, sym="C"),
        )
        self.assertEqual([r["symbol"] for r in self.s["shortlist"]], ["C", "B", "A"])
        before = copy.deepcopy(self.s["shortlist"])
        self.runbar(bar("09:20", 102, 200, 102, 200))
        self.assertEqual(self.s["shortlist"], before)

    def test_corporate_action_quarantine(self):
        self.c["corporate_action_policy"] = "require_review"
        self.s = fresh(self.c, self.m, self.cal)
        self.runbar(bar("09:15"))
        self.assertEqual(self.s["stocks"]["A"]["reason"], "corporate_action_unresolved")

    def test_zero_volume_vwap_and_special_session(self):
        self.runbar(bar("09:15", v=0))
        self.assertIsNone(self.s["stocks"]["A"]["vwap"])
        self.cal[DAY] = "special"
        self.s = fresh(self.c, self.m, self.cal)
        self.runbar(bar("09:15"))
        self.assertEqual(self.s["stocks"]["A"]["reason"], "unknown_or_special_session")

    def test_quote_ask_bid_stale_crossed_and_depth(self):
        self.c["execution"] = "quote"
        self.s = fresh(self.c, self.m, self.cal)
        self.ready()
        for hm, q in [
            ("09:36", {"source_at": ts("09:35"), "bid": 103, "ask": 104}),
            ("09:37", {"source_at": ts("09:37"), "bid": 105, "ask": 104}),
        ]:
            process(
                self.s,
                {"kind": "quote", "at": ts(hm), "quote": {"symbol": "A", **q}},
                self.c,
                self.m,
                self.cal,
            )
        self.assertFalse(self.s["positions"])
        process(
            self.s,
            {
                "kind": "quote",
                "at": ts("09:38"),
                "quote": {
                    "symbol": "A",
                    "source_at": ts("09:38"),
                    "bid": 103.9,
                    "ask": 104,
                    "ask_size": 1,
                },
            },
            self.c,
            self.m,
            self.cal,
        )
        p = self.s["positions"]["A"]
        self.assertEqual(p["entry"], 104)
        self.assertTrue(p["details"]["depth_exceeded"])
        process(
            self.s,
            {
                "kind": "quote",
                "at": ts("09:39"),
                "quote": {
                    "symbol": "A",
                    "source_at": ts("09:39"),
                    "bid": 100,
                    "ask": 101,
                },
            },
            self.c,
            self.m,
            self.cal,
        )
        self.assertEqual(self.s["trades"][0]["exit"], 100)

    def test_cost_components_manually_checkable(self):
        self.assertEqual(
            costs(100, 100, "buy", self.c, DAY),
            {
                "brokerage": 10,
                "exchange": 0.35,
                "sebi": 0.01,
                "ipft": 0.01,
                "gst": 1.87,
                "stamp": 0.3,
                "stt": 0,
            },
        )
        self.assertAlmostEqual(total(costs(100, 100, "sell", self.c, DAY)), 14.74)

    def test_restart_entry_exit_cashflows_not_duplicated(self):
        self.ready()
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "x.sqlite"
            update(db, self.c, self.m, self.cal)
            with sqlite3.connect(db) as conn:
                conn.execute("update accounts set state=?", (json.dumps(self.s),))
            e = evt([bar("09:35", 104, 104.2, 103.9, 104)])
            first = update(db, self.c, self.m, self.cal, events=[e])
            repeat = update(db, self.c, self.m, self.cal, events=[e])
            self.assertEqual(first, repeat)
            self.assertEqual(len(repeat["cashflows"]), 1)
            e = evt([bar("09:40", 100, 101, 99, 100)])
            first = update(db, self.c, self.m, self.cal, events=[e])
            repeat = update(db, self.c, self.m, self.cal, events=[e])
            self.assertEqual(first, repeat)
            self.assertEqual(len(repeat["cashflows"]), 2)
            self.assertEqual(len(repeat["trades"]), 1)

    def test_config_mismatch_requires_explicit_reset(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "x.sqlite"
            update(db, self.c, self.m, self.cal)
            changed = copy.deepcopy(self.c)
            changed["slippage_bps"] = 10
            with self.assertRaises(ValueError):
                update(db, changed, self.m, self.cal, action="resume")

    def test_daily_entry_limit_and_pause(self):
        x = self.ready()
        self.s["day_entries"] = 3
        self.assertEqual(proposal(self.s, x, 104, self.c, DAY)[1], "daily_entry_limit")
        self.s["paused"] = True
        self.assertEqual(proposal(self.s, x, 104, self.c, DAY)[1], "paper_paused")

    def test_normalizer_duplicate_and_invalid_audit(self):
        row = [ts("09:15"), 100, 101, 99, 100, 1000]
        ev, issues = events({"A": [row, row, [ts("09:16"), 100, 101, 99, 100, 1000]]})
        self.assertEqual(len(ev), 1)
        self.assertEqual(len(issues), 2)


if __name__ == "__main__":
    unittest.main()
