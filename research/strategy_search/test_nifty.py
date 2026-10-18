import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from research.strategy_search.nifty_screen import fees,stop_or_target,run

class FuturesTests(unittest.TestCase):
    def test_dated_stt_and_one_sided_tax(self):
        self.assertAlmostEqual(fees(22000,65,'sell','2026-03-31')['stt'],286)
        self.assertAlmostEqual(fees(22000,65,'sell','2026-04-01')['stt'],715)
        self.assertEqual(fees(22000,65,'buy','2026-04-01')['stt'],0)
    def test_stops_gaps_and_collisions_both_sides(self):
        p={'side':1,'stop':99,'target':104}
        self.assertEqual(stop_or_target(p,{'open':98,'high':105,'low':97}),(98,'stop_gap'))
        self.assertEqual(stop_or_target(p,{'open':101,'high':105,'low':98}),(99,'stop_and_target_stop_first'))
        self.assertEqual(stop_or_target({'side':-1,'stop':104,'target':99},{'open':101,'high':105,'low':98}),(104,'stop_and_target_stop_first'))
    def test_completed_signal_next_open_whole_lots_and_capital_reconcile(self):
        rows=[]
        for i,m in enumerate(range(555,930,5)):
            rows.append({'timestamp':f'2026-06-16T{m//60:02}:{m%60:02}:00+05:30','symbol':'TEST FUT','key':'TEST','expiry':'2026-06-30','lot_size':65,'tick_size_provider':10,'open':22000,'high':22001,'low':21999,'close':22000,'volume':10000,'flags':[]})
        rows[6].update(high=22003,close=22002)
        rows[7].update(open=22003,high=22050,low=21980,close=22000)
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder);data=p/'candles.jsonl';data.write_text('\n'.join(json.dumps(r) for r in rows))
            s=run(data,'orb30',2,.2,p/'out')
            trades=json.loads((p/'out/trades.json').read_text())
            self.assertTrue(trades)
            t=trades[0]
            self.assertEqual(t['signal_at'],'2026-06-16T09:50:00+05:30')
            self.assertEqual(t['entry_at'],'2026-06-16T09:50:00+05:30')
            self.assertGreater(t['entry'],rows[7]['open'])
            self.assertEqual(t['qty']%65,0)
            self.assertLessEqual(t['planned_risk'],2500)
            self.assertLess(t['pnl'],0)
            self.assertAlmostEqual(s['ending_equity']-s['initial_capital'],sum(x['pnl'] for x in trades))
            # Smaller capital cannot buy a fractional futures lot to fabricate a trade.
            with patch('research.strategy_search.nifty_screen.CAPITAL',1000):
                small=run(data,'orb30',2,.2,p/'small')
                self.assertEqual(small['trades'],0)
