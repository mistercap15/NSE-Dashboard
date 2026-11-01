"""Synthetic integration checks; no broker calls or production-ledger writes."""
import json, sqlite3, tempfile, unittest
from pathlib import Path
from .test_engine import bar, evt, ts, DAY
from . import test_engine as fixtures
from .engine import fresh, valid_quote
from .storage import update, dashboard
from .service import quote_batch, missing_feed_symbols
from .market_service import MarketService


class DiagnosticsTests(unittest.TestCase):
    setUp = fixtures.EngineTests.setUp
    ready = fixtures.EngineTests.ready

    def raw_quotes(self, a_bid=103, a_ask=103.05):
        def row(sym,bid,ask):
            return {"instrument_token":sym,"timestamp":ts('09:31'),"depth":{
                "buy":[{"price":bid,"quantity":1000 if bid else 0}],
                "sell":[{"price":ask,"quantity":1000 if ask else 0}]}}
        return {"data":{"A":row('A',a_bid,a_ask),"B":row('B',200,0)},"_request_started_at":ts('09:31')}

    def test_fresh_one_sided_book_does_not_mask_actual_feed_failure(self):
        members=[{"key":s,"symbol":s} for s in 'ABC']
        quotes,issues=quote_batch(self.raw_quotes(),members,ts('09:31'))
        self.assertEqual(issues[0]['reason'],'no_ask')
        self.assertEqual(missing_feed_symbols(set('AB'),quotes,issues),set())
        self.assertEqual(missing_feed_symbols(set('ABC'),quotes,issues),{'C'})
        b=next(q for q in quotes if q['symbol']=='B')
        self.assertFalse(valid_quote(b,ts('09:31')))
        self.assertTrue(valid_quote(b,ts('09:31'),side='bid'))
        quotes,issues=quote_batch(self.raw_quotes(),members,ts('09:32'))
        self.assertEqual(missing_feed_symbols(set('AB'),quotes,issues),set('AB'))

    def test_qualifying_candles_fill_later_quote_and_record_daily_profit(self):
        self.c['execution']='quote'
        self.s=fresh(self.c,self.m,self.cal)
        x=self.ready(); x.update(phase='waiting',pending=None,minutes=[],last_minute=None,
                                opening=None,pv=0,vol=0,prev_close=100)
        self.s['ranked']=False
        with tempfile.TemporaryDirectory() as folder:
            db=Path(folder)/'paper.sqlite'
            a=update(db,self.c,self.m,self.cal)
            self.s['strategy_hash']=a['strategy_hash']
            with sqlite3.connect(db) as c:
                c.execute('update accounts set state=? where active=1',(json.dumps(self.s),))
            for b in [bar('09:15',o=102,h=103.2,l=102,c=103),
                      bar('09:20',o=103,h=103.1,l=102.7,c=102.8),
                      bar('09:25',o=102.8,h=102.9,l=102.4,c=102.6)]:
                update(db,self.c,self.m,self.cal,events=[evt([b])])
            before=dashboard(db,DAY)
            self.assertEqual(before['session_diagnostics']['signals'],1)
            self.assertEqual(before['daily']['entries'],0)
            # Another shortlisted instrument has no offer; A still has a real later ask.
            quotes,issues=quote_batch(self.raw_quotes(),[{"key":s,"symbol":s} for s in 'AB'],ts('09:31'))
            self.assertFalse(missing_feed_symbols(set('AB'),quotes,issues))
            update(db,self.c,self.m,self.cal,events=[{"kind":"quotes","at":ts('09:31'),"quotes":quotes}])
            entered=dashboard(db,DAY)
            self.assertEqual(entered['daily']['entries'],1)
            self.assertEqual(entered['daily']['closed_trades'],0)
            self.assertEqual(set(entered['positions']),{'A'})
            # A long can sell to an observed bid even when there is no sell offer.
            q={"symbol":"A","source_at":ts('09:32'),"requested_at":ts('09:32'),
               "bid":110,"ask":0,"bid_size":1000,"ask_size":0}
            update(db,self.c,self.m,self.cal,events=[{"kind":"quotes","at":ts('09:32'),"quotes":[q]}])
            closed=dashboard(db,DAY)
            self.assertEqual(closed['daily']['closed_trades'],1)
            self.assertGreater(closed['daily']['net_pnl'],0)
            self.assertEqual(len(closed['day_records']['trades']),1)
            self.assertAlmostEqual(closed['daily']['net_pnl'],closed['day_records']['trades'][0]['pnl'])

    def test_historical_setup_status_uses_saved_day_not_todays_watchlist(self):
        with tempfile.TemporaryDirectory() as folder:
            db=Path(folder)/'paper.sqlite'
            s=update(db,self.c,self.m,self.cal)
            s['daily_scans']=[{"day":DAY,"shortlist":[{"symbol":"OLD","rank":1}],
                               "states":{"OLD":{"phase":"invalid","reason":"advance_timeout"}}}]
            s['session']='2026-09-29';s['shortlist']=[{"symbol":"NEW","rank":1}]
            with sqlite3.connect(db) as c:
                c.execute('update accounts set state=? where active=1',(json.dumps(s),))
                c.execute('insert into days values(?,?,?)',(s['account_id'],DAY,json.dumps({'day':DAY,'entries':0})))
            d=dashboard(db,DAY)['session_diagnostics']
            self.assertEqual(d['setups'][0]['symbol'],'OLD')
            self.assertIn('every watched setup failed',d['summary'])

    def test_only_watched_stocks_and_positions_need_followup_candles(self):
        service=object.__new__(MarketService)
        self.assertEqual(service.candle_symbols({'positions':{'HELD':{}},'shortlist':[{'symbol':'WATCHED'}]}),{'HELD','WATCHED'})
