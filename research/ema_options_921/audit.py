"""Independent pandas EMA and raw-candle fill audit; offline, no credentials."""
import csv
import hashlib
import json
from pathlib import Path
from urllib.parse import unquote

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data/exports/ema_options_921_15m'


def run():
    results = json.loads((OUT / 'results.json').read_text())
    spot = {}
    options = {}
    for file in (OUT / 'cache').glob('*.json'):
        assert hashlib.sha256(file.read_bytes()).hexdigest() == results['raw_data_hashes'][file.name]
        payload = json.loads(file.read_text())
        path = payload['path']
        if path.startswith('v3/historical-candle/'):
            spot.update({row[0]: row[1:6] for row in payload['response']['data']['candles']})
        elif path.startswith('v2/expired-instruments/historical-candle/'):
            key = unquote(path.split('historical-candle/')[1].split('/1minute/')[0])
            options[key] = {row[0]: row[1:6] for row in payload['response']['data']['candles']}
    frame = pd.DataFrame.from_dict(spot, orient='index', columns=['open', 'high', 'low', 'close', 'volume'])
    frame.index = pd.to_datetime(frame.index, utc=True).tz_convert('Asia/Kolkata')
    frame = frame.sort_index()
    regular = frame.between_time('09:15', '15:29')
    counts = regular.groupby(regular.index.date).size()
    regular = regular[[counts[day] == 375 for day in regular.index.date]]
    fifteen = regular.resample('15min', origin='start_day', offset='9h15min').agg(
        {'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last'}).dropna()
    fast = fifteen.close.ewm(span=9, adjust=False).mean()
    slow = fifteen.close.ewm(span=21, adjust=False).mean()
    relation = (fast > slow).astype(int) - (fast < slow).astype(int)
    previous = relation.replace(0, float('nan')).ffill().shift(1)
    crossings = (relation != 0) & previous.notna() & (relation != previous)
    signals = {}
    for i, stamp in enumerate(fifteen.index):
        if i >= 99 and crossings.loc[stamp]:
            signals[(stamp + pd.Timedelta(minutes=15)).isoformat()] = (int(relation.loc[stamp]), float(fast.loc[stamp]), float(slow.loc[stamp]))
    checked = 0
    for mode in ['ITM5_BUY', 'ATM_BUY', 'ATM_SELL']:
        with (OUT / f'trades_{mode}.csv').open() as stream:
            trades = list(csv.DictReader(stream))
        for trade in trades:
            direction, ema9, ema21 = signals[trade['entry']]
            assert int(trade['direction']) == direction
            assert abs(float(trade['ema9']) - ema9) < 1e-7
            assert abs(float(trade['ema21']) - ema21) < 1e-7
            candles = options[trade['instrument_key']]
            assert float(trade['raw_entry']) == float(candles[trade['entry']][0])
            assert float(trade['raw_exit']) == float(candles[trade['exit']][0])
            assert candles[trade['entry']][4] > 0 and candles[trade['exit']][4] > 0
            assert trade['entry'] < trade['exit']
            assert trade['exit'][11:16] <= '15:00'
            assert trade['expiry'] >= trade['entry'][:10]
            assert abs(float(trade['gross']) - float(trade['slippage']) - float(trade['fees']) - float(trade['net'])) < 1e-7
            checked += 1
        expected = next(row for row in results['baseline'] if row['mode'] == mode)
        assert abs(sum(float(row['net']) for row in trades) - expected['net']) < 1e-7
    audit = {'pandas': pd.__version__, 'independent_15m_bars': len(fifteen),
             'audited_baseline_trades': checked, 'all_raw_hashes_verified': True,
             'independent_ema_signals_match': True, 'fills_match_actual_option_minute_opens': True,
             'cost_and_ledger_reconciliation': True}
    (OUT / 'audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    print(json.dumps(audit, indent=2))


if __name__ == '__main__':
    run()
