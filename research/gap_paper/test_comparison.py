"""Shared forward observations, divergent thresholds, isolated capital and restart safety."""
import copy, json, tempfile, threading, unittest
from pathlib import Path
from unittest.mock import patch
from .comparison import ComparisonService, variant_config
from .storage import update, read, metadata, dashboard
from .engine import stamp
from .test_engine import bar, evt, ts, DAY


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.s = object.__new__(ComparisonService)
        self.s.root = Path(self.tmp.name)
        self.s.db = self.s.root / 'paper.sqlite'
        self.s.cfg = json.loads(Path(__file__).with_name('config.live.json').read_text())
        self.s.bundle = {'day': DAY, 'manifest': {'members': [{'symbol': 'A', 'key': 'A', 'from': '2020-01-01', 'to': '2030-01-01', 'segment': 'NSE_EQ', 'ordinary_share': True, 'eligible': True, 'suspended': False, 'tick_size': .05}], 'comparable': {'A': {DAY: True}}}, 'calendar': {'2026-09-25': 'regular', DAY: 'regular'}}
        self.s.lock = threading.RLock()
        self.s.health = {}
        self.s.gap_day = None
        self.s.selected_day = None
        self.s.last_quote = None
        for module in ['comparison', 'market_service', 'service']:
            mock = patch('research.gap_paper.' + module + '.now', return_value=stamp(ts('09:20')))
            mock.start(); self.addCleanup(mock.stop)
        update(self.s.db, self.s.cfg, self.s.bundle['manifest'], self.s.bundle['calendar'])
        self.s.initialize_variants()

    def opening(self):
        stock = {'ema': 102, 'count': 100, 'values': [2e8] * 20, 'prior_close': 100,
                 'prior_day': '2026-09-25', 'minutes': list(range(555,930,5)),
                 'pv': 2e8, 'prev_close': 100}
        result = {**self.s.bundle, 'profiles': [{'symbol':'A','stock':stock,'as_of':'2026-09-25','checked_at':ts('09:00')}],
                  'bars': [bar('09:15',o=102,h=102.5,l=102,c=102.35)]}
        self.s.seed_variants(result, stamp(ts('09:20')))
        self.s.select_opening(result, stamp(ts('09:20')), ts('09:20'), DAY)
        self.s.finish_variants()

    def pullback(self):
        for b in [bar('09:20',o=102.35,h=102.4,l=102.15,c=102.25),
                  bar('09:25',o=102.25,h=102.3,l=102.10,c=102.20)]:
            self.s.ingest(evt([b]))

    def quote(self, hm, bid, ask):
        return {'kind':'quotes','at':ts(hm),'quotes':[{'symbol':'A','source_at':ts(hm),
                'requested_at':ts(hm),'bid':bid,'ask':ask,'bid_size':10000,'ask_size':10000 if ask else 0}]}

    def test_only_threshold_changes_and_preopening_has_no_history(self):
        other = variant_config(self.s.cfg)
        self.assertEqual({k for k in other if other[k] != self.s.cfg[k]}, {'version','advance'})
        initial = self.s.snapshot(DAY)
        self.assertNotEqual(initial['account_id'], initial['variants']['v2']['account_id'])
        self.assertEqual(initial['variants']['v2']['equity'], 200000)
        self.assertIsNone(initial['variants']['v2']['daily'])
        self.assertFalse(initial['comparison']['paired_day'])
        self.s.ingest_v2(self.quote('09:31',103,103.1))
        self.assertIsNone(read(self.s.v2_db)['last_event'])

    def test_v2_qualifies_v1_does_not_and_later_quote_pnl_is_isolated(self):
        self.opening()
        a,b = read(self.s.db),read(self.s.v2_db)
        self.assertEqual(a['shortlist'], b['shortlist'])
        self.assertEqual(a['stocks']['A']['phase'],'selected')
        self.assertEqual(b['stocks']['A']['phase'],'advanced')
        self.pullback()
        self.assertEqual(len(read(self.s.db)['signals']),0)
        self.assertEqual(len(read(self.s.v2_db)['signals']),1)
        self.assertEqual(read(self.s.v2_db)['positions'],{})
        self.s.ingest(self.quote('09:31',102.35,102.4))
        self.assertEqual(read(self.s.db)['positions'],{})
        self.assertIn('A',read(self.s.v2_db)['positions'])
        self.s.ingest(self.quote('09:32',105,0))
        v2 = dashboard(self.s.v2_db,DAY)
        self.assertEqual(v2['daily']['closed_trades'],1)
        self.assertAlmostEqual(v2['daily']['net_pnl'],v2['day_records']['trades'][0]['pnl'])
        self.assertEqual(dashboard(self.s.db,DAY)['daily']['net_pnl'],0)
        self.assertTrue(self.s.snapshot(DAY)['comparison']['paired_day'])
        aid = read(self.s.v2_db)['account_id']
        self.s.initialize_variants()
        self.assertEqual(read(self.s.v2_db)['account_id'],aid)
        self.assertEqual(len(read(self.s.v2_db)['trades']),1)

    def test_pause_and_daily_risk_are_independent_and_reset_is_rejected(self):
        self.opening(); self.pullback()
        self.s.control_variant('pause','v2')
        self.assertFalse(read(self.s.db)['paused'])
        self.assertTrue(read(self.s.v2_db)['paused'])
        self.assertEqual(read(self.s.v2_db)['positions'],{})
        with self.assertRaises(ValueError): self.s.control_variant('reset','v2')
        with self.assertRaises(ValueError): self.s.control_variant('resume','unknown')
        self.s.control_variant('resume','v2')
        self.s.control_variant('pause','v1')
        self.s.ingest(self.quote('09:32',102.35,102.4))
        self.assertIn('A',read(self.s.v2_db)['positions'])
        self.assertTrue(read(self.s.db)['paused'])

    def test_shared_feed_halt_blocks_v2_and_interrupted_commit_is_not_replayed(self):
        self.opening(); self.pullback()
        self.s.gap_day = DAY
        self.s.ingest(self.quote('09:31',102.35,102.4))
        self.assertFalse(read(self.s.v2_db)['positions'])
        metadata(self.s.db,'comparison_pending',{'at':ts('09:31')})
        self.s.gap_day = None
        self.s.initialize_variants()
        self.assertEqual(self.s.gap_day, DAY)
        self.assertIn('Interrupted comparison',self.s.health['entry_halt_reason'])
