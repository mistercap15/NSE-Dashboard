import unittest
from unittest.mock import patch
from research.gap_paper import engine, test_engine as f
from research.strategy_search.screen import orb_transition

class ORBTests(unittest.TestCase):
    setUp=f.EngineTests.setUp
    ready=f.EngineTests.ready
    def test_range_cannot_fill_itself_and_next_bar_stop_is_conservative(self):
        x=self.ready();x.update(phase='waiting',pending=None,minutes=[],last_minute=None,opening=None,pv=0,vol=0,prev_close=100)
        self.s['ranked']=False
        with patch.object(engine,'transition',orb_transition):
            for b in [f.bar('09:15',o=102,h=103,l=102,c=102.4),f.bar('09:20',o=102.4,h=103.2,l=102.3,c=102.6),f.bar('09:25',o=102.6,h=103.3,l=102.5,c=103.2)]:
                engine.process(self.s,f.evt([b]),self.c,self.m,self.cal)
                self.assertEqual(self.s['day_entries'],0)
            self.assertEqual(self.s['signals'][0]['eligible_from'],f.ts('09:30'))
            engine.process(self.s,f.evt([f.bar('09:30',o=103.2,h=108,l=101,c=104)]),self.c,self.m,self.cal)
            self.assertEqual(self.s['day_entries'],1)
            self.assertEqual(len(self.s['trades']),1)
            self.assertLess(self.s['trades'][0]['pnl'],0)
            self.assertEqual(self.s['trades'][0]['entry_at'],f.ts('09:30'))
