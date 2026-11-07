import unittest
from datetime import timedelta

from .backtest import IST
from .test_backtest import stamp
from .tweaks import features, permits, select, simulate


def example(mode='ATM_BUY'):
    base = {'entry': stamp().isoformat(), 'exit': stamp(11).isoformat(), 'reason': 'OPPOSITE_CROSS',
            'direction': '1', 'spot': '25000', 'cross': '1', 'ema9': '25001', 'ema21': '25000',
            'mode': mode, 'instrument_key': 'TEST', 'symbol': 'TEST', 'expiry': '2026-01-06',
            'lot_size': '75', 'strike': '25000'}
    history = {stamp() + timedelta(minutes=i): (100, 101, 99, 100, 10) for i in range(62)}
    return base, history


class TweakTests(unittest.TestCase):
    def test_both_touched_resolves_stop(self):
        base, history = example()
        history[stamp(10, 5)] = (100, 160, 70, 110, 10)
        trade = simulate(base, history, 'sl20_tp40')
        self.assertEqual(trade['reason'], 'PREMIUM_STOP')
        self.assertAlmostEqual(trade['raw_exit'], 101 * .8)
        self.assertEqual(trade['exit'], stamp(10, 6).isoformat())

    def test_adverse_gap_uses_open_not_stop_level(self):
        base, history = example()
        history[stamp(10, 5)] = (60, 65, 55, 62, 10)
        trade = simulate(base, history, 'sl20')
        self.assertEqual(trade['raw_exit'], 60)
        self.assertEqual(trade['exit'], stamp(10, 5).isoformat())

    def test_target_gap_does_not_get_favorable_open(self):
        base, history = example()
        history[stamp(10, 5)] = (180, 190, 170, 180, 10)
        trade = simulate(base, history, 'sl20_tp40')
        self.assertEqual(trade['reason'], 'PREMIUM_TARGET')
        self.assertAlmostEqual(trade['raw_exit'], 101 * 1.4)

    def test_short_stop_has_correct_direction(self):
        base, history = example('ATM_SELL')
        history[stamp(10, 5)] = (150, 160, 140, 150, 10)
        trade = simulate(base, history, 'sl20')
        self.assertEqual(trade['reason'], 'PREMIUM_STOP')
        self.assertEqual(trade['raw_exit'], 150)
        self.assertLess(trade['net'], 0)

    def test_no_stop_activation_before_actual_delayed_entry(self):
        base, history = example()
        history[stamp()] = (100, 110, 10, 100, 10)
        trade = simulate(base, history, 'sl20', delay=1)
        self.assertEqual(trade['reason'], 'OPPOSITE_CROSS')
        self.assertEqual(trade['entry'], stamp(10, 1).isoformat())

    def test_missing_monitoring_minute_rejected(self):
        base, history = example()
        del history[stamp(10, 5)]
        with self.assertRaises(ValueError):
            simulate(base, history, 'sl20')

    def test_actual_lot_and_cost_identity(self):
        base, history = example()
        trade = simulate(base, history, 'original', actual_lot=True)
        self.assertEqual(trade['quantity'], 75)
        self.assertAlmostEqual(trade['gross'] - trade['slippage'] - trade['fees'], trade['net'])

    def test_max60_and_squareoff_cap(self):
        base, history = example()
        base['exit'] = stamp(12).isoformat()
        history[stamp(12)] = (100, 101, 99, 100, 10)
        trade = simulate(base, history, 'max60')
        self.assertEqual(trade['exit'], stamp(11).isoformat())
        self.assertEqual(trade['reason'], 'MAX_HOLD')

    def test_opening_range_unavailable_before_complete(self):
        base, _ = example()
        self.assertFalse(permits('opening_range', base, {'close': 25000}))
        self.assertFalse(permits('no_expiry', {**base, 'expiry': base['entry'][:10]}, {'close': 25000}))

    def test_features_do_not_use_future_sessions_or_hours(self):
        beginning = stamp(9, 15)
        history = {beginning + timedelta(minutes=i): (100 + i / 100, 102 + i / 100, 99 + i / 100, 101 + i / 100, 1) for i in range(375)}
        original = features(history)
        tomorrow = {t + timedelta(days=1): tuple(v * 2 if n < 4 else v for n, v in enumerate(row)) for t, row in history.items()}
        expanded = features({**history, **tomorrow})
        self.assertNotIn('or_high', original[stamp(9, 30)])
        self.assertIn('or_high', original[stamp(9, 45)])
        self.assertTrue(original[stamp(10)]['hour_ema21'] != original[stamp(10)]['hour_ema21'])
        self.assertEqual(original[stamp(10, 15)]['hour_ema21'], 101.59)
        for t, row in original.items():
            for key, value in row.items():
                if value == value:
                    self.assertAlmostEqual(value, expanded[t][key])

    def test_selection_uses_training_only_and_minimum_sample(self):
        data = {'a': {'trades': 25, 'net': 10000, 'profit_factor': 1.5, 'closed_trade_drawdown': 5000},
                'b': {'trades': 5, 'net': 1000000, 'profit_factor': 10, 'closed_trade_drawdown': 0}}
        self.assertEqual(select(data), 'a')
        self.assertIsNone(select({'x': {'trades': 30, 'net': -10, 'profit_factor': .9, 'closed_trade_drawdown': 100}}))


if __name__ == '__main__':
    unittest.main()
