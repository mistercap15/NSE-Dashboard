import tempfile
import unittest
from datetime import date, datetime, timedelta
from .backtest import (IST, MarketData, bars, charges, choose_contract, crosses,
                       marked_drawdown, metrics, plan, priced_trade, resample, slipped)


def stamp(hour=10, minute=0, day=5):
    return datetime(2026, 1, day, hour, minute, tzinfo=IST)


def event(hour, minute, side):
    return {'time': stamp(hour, minute), 'direction': side, 'spot': 25000, 'cross': 1, 'ema9': 25001, 'ema21': 25000}


def contracts():
    return [{'instrument_type': side, 'strike_price': strike, 'instrument_key': f'{side}{strike}',
             'trading_symbol': f'{side}{strike}', 'expiry': '2026-01-06', 'lot_size': 65}
            for side in ('CE', 'PE') for strike in range(24000, 26001, 50)]


class ResearchTests(unittest.TestCase):
    def test_session_alignment_and_missing_minute(self):
        first = stamp(9, 15)
        data = {first + timedelta(minutes=i): (100, 102, 99, 101, 1) for i in range(375)}
        result, excluded = resample(data)
        self.assertEqual(len(result), 25)
        self.assertEqual(result[0][0], first)
        self.assertEqual(result[0][0] + timedelta(minutes=15), stamp(9, 30))
        self.assertEqual(excluded, [])
        del data[first + timedelta(minutes=1)]
        self.assertEqual(resample(data), ([], ['2026-01-05']))

    def test_conflicting_duplicates_and_naive_time_rejected(self):
        x = [stamp().isoformat(), 100, 102, 99, 101, 10]
        self.assertEqual(len(bars([x, x])), 1)
        with self.assertRaises(ValueError):
            bars([x, [x[0], 100, 103, 99, 102, 10]])
        with self.assertRaises(ValueError):
            bars([['2026-01-05T10:00:00', 100, 102, 99, 101, 1]])

    def test_signal_prefix_is_invariant_to_future(self):
        series = [(stamp(9, 15) + timedelta(minutes=i * 15), (100, 102, 99, 100 + (i % 17))) for i in range(160)]
        prefix = crosses(series[:130])
        full = crosses(series)
        boundary = series[129][0] + timedelta(minutes=15)
        a = [e for values in prefix.values() for e in values]
        b = [e for values in full.values() for e in values if e['time'] <= boundary]
        self.assertEqual(a, b)

    def test_warmup_and_equality_no_spurious_crosses(self):
        series = [(stamp() + timedelta(minutes=i * 15), (100, 100, 100, 100)) for i in range(110)]
        self.assertEqual(dict(crosses(series)), {})
        self.assertEqual(dict(crosses(series[:90])), {})

    def test_reversal_inside_window_but_exit_only_outside(self):
        trades = plan([event(9, 30, 1), event(10, 0, -1), event(14, 45, 1)], stamp().date(), 570, 870)
        self.assertEqual(len(trades), 2)
        self.assertEqual(trades[0]['exit'], trades[1]['entry'])
        self.assertEqual(trades[1]['exit'], stamp(14, 45))

    def test_cutoff_inclusive_and_squareoff_priority(self):
        trades = plan([event(14, 30, 1), event(15, 0, -1)], stamp().date(), 570, 870)
        self.assertEqual(len(trades), 1)
        self.assertEqual(trades[0]['reason'], 'SQUARE_OFF')
        self.assertEqual(trades[0]['exit'], stamp(15, 0))
        self.assertEqual(plan([event(9, 30, 1)], stamp().date(), 600, 870), [])

    def test_strike_sides_itm_five_and_atm_tie(self):
        chain = contracts()
        self.assertEqual(choose_contract(chain, 25025, 1, 'ATM_BUY')['strike_price'], 25050)
        self.assertEqual(choose_contract(chain, 25000, 1, 'ITM5_BUY')['strike_price'], 24750)
        self.assertEqual(choose_contract(chain, 25000, -1, 'ITM5_BUY')['strike_price'], 25250)
        self.assertEqual(choose_contract(chain, 25000, 1, 'ATM_SELL')['instrument_type'], 'PE')
        self.assertEqual(choose_contract(chain, 25000, -1, 'ATM_SELL')['instrument_type'], 'CE')

    def test_adverse_tick_rounding_and_sell_floor(self):
        self.assertEqual(slipped(100, True), 101)
        self.assertEqual(slipped(100, False), 99)
        self.assertEqual(slipped(.1, False), 0)
        self.assertGreaterEqual(slipped(10.01, True), 10.01 * 1.005 + .5)
        self.assertLessEqual(slipped(10.01, False), 10.01 * .995 - .5)

    def test_fee_date_changes_and_turnover_side(self):
        before = charges(6500, 7800, date(2026, 3, 31))
        after = charges(6500, 7800, date(2026, 4, 1))
        self.assertAlmostEqual(after['stt'] / before['stt'], 1.5)
        self.assertAlmostEqual(after['stamp'], 6500 * .00003)
        self.assertEqual(after['brokerage'], 40)
        self.assertGreater(charges(6500, 7800, date(2026, 2, 28))['ipft'], 0)
        self.assertEqual(after['ipft'], 0)

    def trade(self, mode='ATM_BUY'):
        p = plan([event(10, 0, 1)], stamp().date(), 570, 870)[0]
        history = {stamp(): (100, 105, 95, 100, 10), stamp(15): (110, 115, 105, 110, 10)}
        return p, contracts()[0], history, mode

    def test_actual_next_minute_open_and_cost_identity(self):
        p, ct, history, mode = self.trade()
        t = priced_trade(p, ct, history, mode)
        self.assertEqual(t['raw_entry'], 100)
        self.assertEqual(t['gross'], 650)
        self.assertAlmostEqual(t['gross'] - t['slippage'] - t['fees'], t['net'])
        self.assertGreater(t['slippage'], 0)

    def test_short_pnl_sign_and_buyback_fees(self):
        p, ct, history, mode = self.trade('ATM_SELL')
        t = priced_trade(p, ct, history, mode)
        self.assertEqual(t['gross'], -650)
        self.assertLess(t['net'], t['gross'])
        self.assertAlmostEqual(t['stt'], t['fill_entry'] * 65 * .001)

    def test_missing_or_untraded_fill_not_interpolated(self):
        p, ct, history, mode = self.trade()
        del history[stamp(15)]
        with self.assertRaises(ValueError):
            priced_trade(p, ct, history, mode)
        history[stamp(15)] = (110, 115, 105, 110, 0)
        with self.assertRaises(ValueError):
            priced_trade(p, ct, history, mode)

    def test_delay_does_not_move_mandatory_squareoff(self):
        p, ct, history, mode = self.trade()
        history[stamp(10, 1)] = (101, 105, 95, 100, 10)
        t = priced_trade(p, ct, history, mode, delay=1)
        self.assertEqual(t['entry'], stamp(10, 1).isoformat())
        self.assertEqual(t['exit'], stamp(15).isoformat())

    def test_mtm_tracks_open_drawdown_and_missing_marks(self):
        p, ct, history, mode = self.trade()
        history[stamp(10, 1)] = (100, 101, 50, 50, 10)
        t = priced_trade(p, ct, history, mode)
        dd, points = marked_drawdown([t], {ct['instrument_key']: history})
        self.assertGreater(dd['sampled_mtm_drawdown'], 3000)
        self.assertGreater(dd['missing_mtm_minutes'], 0)
        self.assertAlmostEqual(points[-1]['equity'], 200000 + t['net'])

    def test_undefined_metrics_and_drawdown(self):
        self.assertIsNone(metrics([])['win_rate'])
        self.assertIsNone(metrics([])['profit_factor'])
        self.assertEqual(metrics([])['closed_trade_drawdown'], 0)

    def test_no_order_or_account_endpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            client = MarketData(directory)
            for path in ['v2/order/place', 'v2/user/profile', 'v2/user/get-funds-and-margin']:
                with self.assertRaises(ValueError):
                    client.get(path)


if __name__ == '__main__':
    unittest.main()
