"""Bounded, cached-data-only rule search. Read TWEAK_PROTOCOL.md first."""
import csv
import hashlib
import itertools
import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import unquote

import pandas as pd

from .backtest import (BASELINE, MODES, ROOT, bars, metrics, minute, priced_trade,
                       resample, slipped, write_csv)

OUT = ROOT / 'data/exports/ema_options_921_15m'
WINDOWS = ((570, 870), (600, 780), (630, 750))
FILTERS = ('none', 'ema50', 'ema50_slope', 'adx20', 'hourly', 'body_atr', 'opening_range', 'first_entry', 'no_expiry')
EXITS = {'original': (None, None, None), 'sl20': (.20, None, None),
         'sl20_tp40': (.20, .40, None), 'sl30_tp60': (.30, .60, None),
         'max60': (None, None, 60)}


def load():
    reference = json.loads((OUT / 'results.json').read_text())
    spot, options = {}, {}
    for path in (OUT / 'cache').glob('*.json'):
        assert hashlib.sha256(path.read_bytes()).hexdigest() == reference['raw_data_hashes'][path.name]
        data = json.loads(path.read_text())
        endpoint = data['path']
        if endpoint.startswith('v3/historical-candle/'):
            spot.update(bars(data['response']['data']['candles']))
        elif endpoint.startswith('v2/expired-instruments/historical-candle/'):
            key = unquote(endpoint.split('historical-candle/')[1].split('/1minute/')[0])
            options[key] = bars(data['response']['data']['candles'])
    trades = {}
    for mode in MODES:
        with (OUT / f'trades_{mode}.csv').open() as stream:
            trades[mode] = list(csv.DictReader(stream))
    return spot, options, trades


def features(spot):
    series, _ = resample(spot)
    frame = pd.DataFrame([c for _, c in series], columns=['open', 'high', 'low', 'close'],
                         index=pd.DatetimeIndex([t for t, _ in series]))
    original = frame.copy()
    previous = frame.close.shift(1)
    tr = pd.concat([frame.high - frame.low, (frame.high - previous).abs(), (frame.low - previous).abs()], axis=1).max(axis=1)
    frame['atr'] = tr.ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    up, down = frame.high.diff(), -frame.low.diff()
    plus = up.where((up > down) & (up > 0), 0).ewm(alpha=1/14, adjust=False).mean()
    minus = down.where((down > up) & (down > 0), 0).ewm(alpha=1/14, adjust=False).mean()
    denominator = (plus + minus).replace(0, float('nan'))
    frame['adx'] = (100 * (plus - minus).abs() / denominator).ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    frame['ema50'] = frame.close.ewm(span=50, adjust=False).mean()
    frame['slope50'] = frame.ema50 - frame.ema50.shift(4)
    hour = original.resample('60min', origin='start_day', offset='9h15min').agg({'close': ['last', 'count']})
    hour = hour[hour[('close', 'count')] == 4]
    hour.index += pd.Timedelta(minutes=60)
    hour_mean = hour[('close', 'last')].ewm(span=21, adjust=False).mean()
    frame.index += pd.Timedelta(minutes=15)
    frame['hour_ema21'] = hour_mean.reindex(frame.index, method='ffill')
    output = {}
    for stamp, row in frame.iterrows():
        day = original[original.index.date == stamp.date()]
        first = day.iloc[:2]
        record = row.to_dict()
        # Future opening-range data cannot authorize a 09:30 signal.
        if minute(stamp) >= 585:
            record.update(or_high=float(first.high.max()), or_low=float(first.low.min()))
        output[stamp.to_pydatetime()] = record
    return output


def permits(name, trade, feature):
    side = int(trade['direction'])
    close = feature['close']
    if name in ('none', 'first_entry'):
        return True
    if name == 'no_expiry':
        return trade['entry'][:10] != trade['expiry']
    if name == 'ema50':
        return side * (close - feature['ema50']) > 0
    if name == 'ema50_slope':
        return side * (close - feature['ema50']) > 0 and side * feature['slope50'] > 0
    if name == 'adx20':
        return feature['adx'] >= 20
    if name == 'hourly':
        return side * (close - feature['hour_ema21']) > 0
    if name == 'body_atr':
        width = feature['high'] - feature['low']
        return width > 0 and side * (close - feature['open']) / width >= .35 and width <= 1.5 * feature['atr']
    if name == 'opening_range':
        return 'or_high' in feature and (close > feature['or_high'] if side > 0 else close < feature['or_low'])
    raise ValueError('Unknown entry filter')


def simulate(base, history, profile, fixed=.5, delay=0, actual_lot=False):
    stop_fraction, target_fraction, hold = EXITS[profile]
    entry = datetime.fromisoformat(base['entry']) + timedelta(minutes=delay)
    scheduled = datetime.fromisoformat(base['exit'])
    if base['reason'] != 'SQUARE_OFF':
        scheduled += timedelta(minutes=delay)
    squareoff = entry.replace(hour=15, minute=0)
    cap = min(scheduled, squareoff)
    reason = base['reason']
    if hold and entry + timedelta(minutes=hold) < cap:
        cap = entry + timedelta(minutes=hold)
        reason = 'MAX_HOLD'
    buying = base['mode'] != 'ATM_SELL'
    fill_entry = slipped(history[entry][0], buying, fixed)
    stop = fill_entry * (1 - stop_fraction if buying else 1 + stop_fraction) if stop_fraction else None
    target = fill_entry * (1 + target_fraction if buying else 1 - target_fraction) if target_fraction else None
    at = entry
    exit_at, exit_price = cap, history[cap][0]
    while at < cap and (stop is not None or target is not None):
        if at not in history or history[at][4] <= 0:
            raise ValueError('Missing/untraded monitoring minute')
        op, high, low, _, _ = history[at]
        hit_stop = stop is not None and (low <= stop if buying else high >= stop)
        hit_target = target is not None and (high >= target if buying else low <= target)
        if hit_stop:
            gap = op <= stop if buying else op >= stop
            exit_price = op if gap else stop
            exit_at = at if gap and at > entry else at + timedelta(minutes=1)
            reason = 'PREMIUM_STOP'
            break
        if hit_target:
            exit_price = target
            exit_at = at + timedelta(minutes=1)
            reason = 'PREMIUM_TARGET'
            break
        at += timedelta(minutes=1)
    if reason not in ('PREMIUM_STOP', 'PREMIUM_TARGET') and history[exit_at][4] <= 0:
        raise ValueError('Untraded scheduled exit minute')
    planned = {'entry': entry, 'exit': exit_at, 'reason': reason, 'direction': int(base['direction']),
               'spot': float(base['spot']), 'cross': int(base['cross']), 'ema9': float(base['ema9']), 'ema21': float(base['ema21'])}
    ct = {'instrument_key': base['instrument_key'], 'trading_symbol': base['symbol'],
          'expiry': base['expiry'], 'lot_size': int(base['lot_size']), 'strike_price': float(base['strike'])}
    synthetic = {entry: history[entry], exit_at: (exit_price, exit_price, exit_price, exit_price, 1)}
    result = priced_trade(planned, ct, synthetic, base['mode'], fixed=fixed,
                          quantity=ct['lot_size'] if actual_lot else 65)
    result['base_entry'] = base['entry']
    return result


def config_key(config):
    mode, start, cutoff, rule, profile = config
    return f'{mode}:{start}-{cutoff}:{rule}:{profile}'


def select(training):
    eligible = [(key, values) for key, values in training.items()
                if values['trades'] >= 20 and values['net'] > 0 and (values['profit_factor'] or 0) >= 1.1]
    return max(eligible, key=lambda item: item[1]['net'] / (item[1]['closed_trade_drawdown'] + 5000))[0] if eligible else None


def run():
    spot, histories, source = load()
    feature = features(spot)
    sessions = sorted({t.date().isoformat() for t in feature if '2025-11-04' <= t.date().isoformat() <= '2026-11-03'})
    rejected = set()
    for mode in MODES:
        for trade in source[mode]:
            at, end = datetime.fromisoformat(trade['entry']), datetime.fromisoformat(trade['exit'])
            history = histories[trade['instrument_key']]
            while at <= end:
                if at not in history or history[at][4] <= 0:
                    rejected.add(trade['entry'])
                    break
                at += timedelta(minutes=1)
    candidates = {}
    configurations = list(itertools.product(MODES, WINDOWS, FILTERS, EXITS))
    simulation_cache = {}
    for mode, window, rule, profile in configurations:
        start, cutoff = window
        key = config_key((mode, start, cutoff, rule, profile))
        values, entered = [], set()
        for trade in source[mode]:
            at = datetime.fromisoformat(trade['entry'])
            day = trade['entry'][:10]
            if trade['entry'] in rejected or not start <= minute(at) <= cutoff or not permits(rule, trade, feature[at]):
                continue
            if rule == 'first_entry' and day in entered:
                continue
            entered.add(day)
            ident = (mode, trade['entry'], profile)
            if ident not in simulation_cache:
                simulation_cache[ident] = simulate(trade, histories[trade['instrument_key']], profile)
            values.append(simulation_cache[ident])
        candidates[key] = values
    summaries = [{'configuration': key, **metrics(values),
                  'later_net': metrics([t for t in values if t['entry'][:10] >= '2026-08-01'])['net']}
                 for key, values in candidates.items()]
    target = OUT / 'tweaks'
    target.mkdir(exist_ok=True)
    write_csv(target / 'all_configurations.csv', summaries)
    folds, selected_path, selected_base = [], [], []
    for boundary in [120, 162, 204]:
        test_end = min(boundary + 42, len(sessions)) if boundary != 204 else len(sessions)
        training = {key: metrics([t for t in values if t['entry'][:10] < sessions[boundary]]) for key, values in candidates.items()}
        winner = select(training)
        tested = [t for t in candidates[winner] if sessions[boundary] <= t['entry'][:10] <= sessions[test_end - 1]] if winner else []
        selected_path.extend(tested)
        if winner:
            mode, _, _, profile = winner.split(':')
            lookup = {t['entry']: t for t in source[mode]}
            selected_base.extend((lookup[t['base_entry']], profile) for t in tested)
        folds.append({'train_sessions': boundary, 'test_start': sessions[boundary], 'test_end': sessions[test_end - 1],
                      'selected': winner, 'training': training[winner] if winner else None, 'evaluation': metrics(tested)})
    write_csv(target / 'walkforward_trades.csv', selected_path)
    benchmarks = []
    for key in [config_key((m, *BASELINE, 'none', 'original')) for m in MODES] + [config_key(('ATM_BUY', 630, 750, 'none', 'original'))]:
        benchmarks.append({'configuration': key, **metrics([t for t in candidates[key] if t['entry'][:10] >= sessions[120]])})
    stresses = []
    for name, kwargs in [('extra_1m', {'delay': 1}), ('fixed_1_point', {'fixed': 1}), ('actual_lot', {'actual_lot': True})]:
        values, errors = [], []
        for base, profile in selected_base:
            try:
                values.append(simulate(base, histories[base['instrument_key']], profile, **kwargs))
            except (ValueError, KeyError) as error:
                errors.append({'entry': base['entry'], 'error': str(error)})
        stresses.append({'name': name, 'failed_trades': errors, **metrics(values)})
    leaders = []
    for row in sorted(summaries, key=lambda r: r['net'], reverse=True)[:5]:
        key = row['configuration']
        mode, _, _, profile = key.split(':')
        values = candidates[key]
        lookup = {t['entry']: t for t in source[mode]}
        sensitivity = []
        for name, kwargs in [('extra_1m', {'delay': 1}), ('fixed_1_point', {'fixed': 1}), ('actual_lot', {'actual_lot': True})]:
            modified, failed = [], 0
            for trade in values:
                base = lookup[trade['base_entry']]
                try:
                    modified.append(simulate(base, histories[base['instrument_key']], profile, **kwargs))
                except (ValueError, KeyError):
                    failed += 1
            sensitivity.append({'name': name, 'failed_trades': failed, **metrics(modified)})
        later = metrics([t for t in values if t['entry'][:10] >= '2026-08-01'])
        leaders.append({**row, 'later': later, 'sensitivity': sensitivity,
                        'net_without_best_five': sum(t['net'] for t in sorted(values, key=lambda t: t['net'])[:-5]),
                        'evaluation_blocks': [metrics([t for t in values if f['test_start'] <= t['entry'][:10] <= f['test_end']]) for f in folds],
                        'interpretation': 'Ranked AFTER seeing the entire sample; NOT an independent validation'})
    best = max(summaries, key=lambda r: r['net'])['configuration']
    write_csv(target / 'retrospective_leader_trades.csv', candidates[best])
    result = {'configurations': len(candidates), 'sessions': len(sessions), 'rejected_common_entries': sorted(rejected),
              'folds': folds, 'selected_path': metrics(selected_path), 'benchmarks': benchmarks, 'stress': stresses,
              'without_best_five': sum(t['net'] for t in sorted(selected_path, key=lambda t: t['net'])[:-5]),
              'all_configurations': summaries, 'retrospective_leaders': leaders,
              'reference_results_hash': hashlib.sha256((OUT / 'results.json').read_bytes()).hexdigest(),
              'limitations': ['Previously inspected period: exploratory only', '65-unit reference exposure, not always a historical whole lot',
                              'Closed-trade drawdown, not intratrade or margin-based risk', 'OHLC stop/target executions cannot establish actual bid/ask depth or latency']}
    (target / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'all_configurations'}, indent=2))


if __name__ == '__main__':
    run()
