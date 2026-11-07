"""Reproducible 15m NIFTY option study using real one-minute Upstox OHLC.

Only allowlisted market-data GET endpoints exist here. No account/order APIs.
"""
import argparse
import csv
import hashlib
import json
import math
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, time as clock, timedelta, timezone
from pathlib import Path

from research.gap_paper.data import Client, token

IST = timezone(timedelta(hours=5, minutes=30))
ROOT = Path(__file__).resolve().parents[2]
MODES = ('ITM5_BUY', 'ATM_BUY', 'ATM_SELL')
STARTS = (570, 600, 630)
CUTOFFS = tuple(range(690, 871, 30))
BASELINE = (570, 870)
CAPITAL = 200000


class MarketData:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.requests = 0

    def get(self, path):
        allowed = ('v3/historical-candle/', 'v2/expired-instruments/expiries?',
                   'v2/expired-instruments/option/contract?', 'v2/expired-instruments/historical-candle/')
        if not path.startswith(allowed):
            raise ValueError('Not an allowlisted market-data endpoint')
        cache = self.directory / (hashlib.sha256(path.encode()).hexdigest() + '.json')
        if cache.exists():
            return json.loads(cache.read_text())['response']
        for attempt in range(5):
            Client.wait_for_request(path)
            request = urllib.request.Request('https://api.upstox.com/' + path, headers={
                'Authorization': 'Bearer ' + token(), 'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0'}, method='GET')
            try:
                with urllib.request.urlopen(request, timeout=40) as response:
                    result = json.load(response)
                if result.get('status') != 'success':
                    raise RuntimeError('Unsuccessful market-data response')
                payload = {'path': path, 'retrieved_at': datetime.now(IST).isoformat(), 'response': result}
                temporary = cache.with_suffix('.tmp')
                temporary.write_text(json.dumps(payload))
                temporary.replace(cache)
                self.requests += 1
                return result
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504):
                    raise RuntimeError(f'Market-data request rejected HTTP {error.code}; no credential logged') from None
            except (urllib.error.URLError, TimeoutError):
                pass
            time.sleep(2 ** attempt)
        raise RuntimeError('Market-data retries exhausted')


def minute(ts):
    return ts.hour * 60 + ts.minute


def bars(raw):
    result = {}
    for item in raw:
        ts = datetime.fromisoformat(item[0])
        if ts.utcoffset() is None:
            raise ValueError('Timezone required')
        ts = ts.astimezone(IST)
        values = tuple(float(v) for v in item[1:6])
        if ts.second or not all(math.isfinite(v) for v in values):
            raise ValueError('Invalid candle timestamp or number')
        op, high, low, close, volume = values
        if min(op, high, low, close) < 0 or not low <= min(op, close) <= max(op, close) <= high or volume < 0:
            raise ValueError('Invalid candle OHLC/volume')
        if ts in result and result[ts] != values:
            raise ValueError('Conflicting candle overlap')
        result[ts] = values
    return result


def resample(spot):
    """Require all 375 regular minutes; no silent gap-filling/special sessions."""
    days = defaultdict(dict)
    for ts, candle in spot.items():
        days[ts.date()][minute(ts)] = candle
    complete, excluded = [], []
    for day, candles in sorted(days.items()):
        if not all(m in candles for m in range(555, 930)):
            excluded.append(str(day))
            continue
        for start in range(555, 930, 15):
            segment = [candles[m] for m in range(start, start + 15)]
            stamp = datetime.combine(day, clock(start // 60, start % 60), IST)
            complete.append((stamp, (segment[0][0], max(b[1] for b in segment), min(b[2] for b in segment), segment[-1][3])))
    return complete, excluded


def crosses(series):
    fast = slow = None
    relation = 0
    output = defaultdict(list)
    ordinals = Counter()
    for count, (stamp, candle) in enumerate(series, 1):
        close = candle[3]
        fast = close if fast is None else fast + 2 / 10 * (close - fast)
        slow = close if slow is None else slow + 2 / 22 * (close - slow)
        side = 1 if fast > slow else -1 if fast < slow else 0
        if count >= 100 and side and relation and side != relation:
            end = stamp + timedelta(minutes=15)
            ordinals[stamp.date()] += 1
            output[stamp.date()].append({'time': end, 'direction': side, 'spot': close,
                                         'cross': ordinals[stamp.date()], 'ema9': fast, 'ema21': slow})
        if side:
            relation = side
    return output


def plan(events, day, start, cutoff):
    result, position = [], None
    for event in events:
        at = minute(event['time'])
        if at >= 900:
            break
        if position is not None:
            if event['direction'] == position['direction']:
                continue
            result.append({**position, 'exit': event['time'], 'exit_spot': event['spot'], 'reason': 'OPPOSITE_CROSS'})
            position = None
        if start <= at <= cutoff:
            position = {'entry': event['time'], 'direction': event['direction'], 'spot': event['spot'],
                        'cross': event['cross'], 'ema9': event['ema9'], 'ema21': event['ema21']}
    if position:
        result.append({**position, 'exit': datetime.combine(day, clock(15), IST), 'exit_spot': None, 'reason': 'SQUARE_OFF'})
    return result


def choose_contract(contracts, spot, direction, mode):
    kind = ('CE' if direction == 1 else 'PE') if mode != 'ATM_SELL' else ('PE' if direction == 1 else 'CE')
    selected = sorted((c for c in contracts if c['instrument_type'] == kind), key=lambda c: c['strike_price'])
    if not selected:
        raise ValueError('Missing contract side')
    atm = min(range(len(selected)), key=lambda i: (abs(selected[i]['strike_price'] - spot), -selected[i]['strike_price']))
    index = atm + (-5 if kind == 'CE' else 5) if mode == 'ITM5_BUY' else atm
    if not 0 <= index < len(selected):
        raise ValueError('Insufficient listed ITM strikes')
    return selected[index]


def slipped(price, buy, fixed=.5, fraction=.005):
    adverse = price * (1 + fraction) + fixed if buy else max(0, price * (1 - fraction) - fixed)
    # Buy up, sell down; never allow a negative sell price.
    ticks = math.ceil(adverse / .05 - 1e-9) if buy else math.floor(adverse / .05 + 1e-9)
    return round(ticks * .05, 2)


def charges(buy_value, sell_value, day):
    total = buy_value + sell_value
    exchange = total * (.0003503 if day < date(2026, 3, 1) else .0003553)
    ipft = total * (.000005 if day < date(2026, 3, 1) else 0)
    sebi = total * .000001
    brokerage = 40.0
    return {'brokerage': brokerage, 'stt': sell_value * (.001 if day < date(2026, 4, 1) else .0015),
            'exchange': exchange, 'ipft': ipft, 'sebi': sebi, 'stamp': buy_value * .00003,
            'gst': .18 * (brokerage + exchange + ipft + sebi)}


def priced_trade(planned, contract, history, mode, fixed=.5, quantity=65, delay=0):
    ent, ext = planned['entry'] + timedelta(minutes=delay), planned['exit'] + timedelta(minutes=delay)
    # Square-off is always first 15:00 minute, irrespective of crossover-delay sensitivity.
    if planned['reason'] == 'SQUARE_OFF':
        ext = planned['exit']
    if ent >= ext:
        raise ValueError('Fill delay leaves no holding interval')
    if ent not in history or ext not in history:
        raise ValueError('Missing exact entry/exit minute')
    if any(history[t][0] <= 0 or history[t][4] <= 0 for t in (ent, ext)):
        raise ValueError('Nonpositive price or no traded volume at fill')
    raw_entry, raw_exit = history[ent][0], history[ext][0]
    buying = mode != 'ATM_SELL'
    entry, exit = slipped(raw_entry, buying, fixed), slipped(raw_exit, not buying, fixed)
    sign = 1 if buying else -1
    gross = sign * (raw_exit - raw_entry) * quantity
    executed = sign * (exit - entry) * quantity
    fees = charges((entry if buying else exit) * quantity, (exit if buying else entry) * quantity, ent.date())
    fee_total = sum(fees.values())
    return {**planned, 'entry': ent.isoformat(), 'exit': ext.isoformat(), 'mode': mode,
            'instrument_key': contract['instrument_key'], 'symbol': contract['trading_symbol'],
            'strike': contract['strike_price'], 'expiry': contract['expiry'], 'lot_size': contract['lot_size'],
            'dte': (date.fromisoformat(contract['expiry']) - ent.date()).days, 'quantity': quantity,
            'raw_entry': raw_entry, 'raw_exit': raw_exit, 'fill_entry': entry, 'fill_exit': exit,
            'gross': gross, 'slippage': gross - executed, **fees, 'fees': fee_total,
            'net': executed - fee_total, 'whipsaw': planned['reason'] == 'OPPOSITE_CROSS' and (ext - ent).total_seconds() <= 1800}


def metrics(trades):
    wins = [t['net'] for t in trades if t['net'] > 0]
    losses = [t['net'] for t in trades if t['net'] < 0]
    equity = peak = CAPITAL
    dd = pct = 0
    for trade in trades:
        equity += trade['net']
        peak = max(peak, equity)
        dd = max(dd, peak - equity)
        pct = max(pct, (peak - equity) / peak * 100)
    total = sum(t['net'] for t in trades)
    return {'trades': len(trades), 'win_rate': len(wins) / len(trades) * 100 if trades else None,
            'gross': sum(t['gross'] for t in trades), 'slippage': sum(t['slippage'] for t in trades),
            'fees': sum(t['fees'] for t in trades), 'net': total,
            'profit_factor': sum(wins) / -sum(losses) if losses else None,
            'payoff': (sum(wins) / len(wins)) / (-sum(losses) / len(losses)) if wins and losses else None,
            'expectancy': total / len(trades) if trades else None,
            'closed_trade_drawdown': dd, 'closed_trade_drawdown_pct': pct,
            'worst_trade': min((t['net'] for t in trades), default=None),
            'best_trade': max((t['net'] for t in trades), default=None)}


def marked_drawdown(trades, histories, fixed=.5):
    """Sampled 1m-close liquidation equity, not tick-level/intrabar drawdown."""
    realized = 0
    peak = CAPITAL
    drawdown = percent = 0
    missing_marks = 0
    points = []
    for trade in trades:
        ent, ext = datetime.fromisoformat(trade['entry']), datetime.fromisoformat(trade['exit'])
        buying = trade['mode'] != 'ATM_SELL'
        quantity = trade['quantity']
        history = histories[trade['instrument_key']]
        at = ent
        while at < ext:
            if at not in history or history[at][4] <= 0:
                missing_marks += 1
                at += timedelta(minutes=1)
                continue
            mark = slipped(history[at][3], not buying, fixed)
            fees = charges((trade['fill_entry'] if buying else mark) * quantity,
                           (mark if buying else trade['fill_entry']) * quantity, at.date())
            unrealized = (1 if buying else -1) * (mark - trade['fill_entry']) * quantity - sum(fees.values())
            equity = CAPITAL + realized + unrealized
            peak = max(peak, equity)
            drawdown = max(drawdown, peak - equity)
            percent = max(percent, (peak - equity) / peak * 100)
            points.append({'timestamp': (at + timedelta(minutes=1)).isoformat(), 'equity': equity})
            at += timedelta(minutes=1)
        realized += trade['net']
        equity = CAPITAL + realized
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
        percent = max(percent, (peak - equity) / peak * 100)
        points.append({'timestamp': ext.isoformat(), 'equity': equity})
    return {'sampled_mtm_drawdown': drawdown, 'sampled_mtm_drawdown_pct': percent, 'missing_mtm_minutes': missing_marks}, points


def write_csv(path, rows):
    if not rows:
        path.write_text('')
        return
    with path.open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def block_bootstrap(trades, days, draws=2000):
    """Exploratory 5-session block interval; not selection-adjusted significance."""
    daily = {str(day): 0.0 for day in days}
    for trade in trades:
        daily[trade['entry'][:10]] += trade['net']
    values = list(daily.values())
    if not values:
        return None
    rng = random.Random(92115)
    totals = []
    for _ in range(draws):
        sample = []
        while len(sample) < len(values):
            i = rng.randrange(len(values))
            sample.extend(values[(i + j) % len(values)] for j in range(5))
        totals.append(sum(sample[:len(values)]))
    totals.sort()
    return {'method': '2000 circular block resamples; 5 sessions; seed 92115; not selection adjusted',
            'total_net_95pct_low': totals[int(draws * .025)], 'total_net_95pct_high': totals[int(draws * .975)]}


def run(args):
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    client = MarketData(out / 'cache')
    encoded = urllib.parse.quote('NSE_INDEX|Nifty 50', safe='')
    expiries = client.get(f'v2/expired-instruments/expiries?instrument_key={encoded}')['data']
    end = min(date.fromisoformat(args.end), date.fromisoformat(expiries[-1]))
    start = date.fromisoformat(args.start)
    spot = {}
    cursor = start - timedelta(days=35)
    while cursor <= end:
        finish = min(end, cursor + timedelta(days=27))
        path = f'v3/historical-candle/{encoded}/minutes/1/{finish}/{cursor}'
        incoming = bars(client.get(path)['data']['candles'])
        if set(spot) & set(incoming):
            raise ValueError('Unexpected overlapping spot download windows')
        spot.update(incoming)
        cursor = finish + timedelta(days=1)
    series, excluded_days = resample(spot)
    signals = crosses(series)
    days = sorted({stamp.date() for stamp, _ in series if start <= stamp.date() <= end})
    plans = {(s, c): [p for day in days for p in plan(signals[day], day, s, c)] for s in STARTS for c in CUTOFFS}
    chains, selections, errors, spans = {}, {}, [], {}
    for values in plans.values():
        for p in values:
            day = p['entry'].date().isoformat()
            expiry = next((e for e in expiries if e >= day), None)
            if expiry is None:
                raise ValueError('No listed historical expiry for session')
            if expiry not in chains:
                chains[expiry] = client.get(f'v2/expired-instruments/option/contract?instrument_key={encoded}&expiry_date={expiry}')['data']
                print(f'Contract discovery: {expiry}', flush=True)
            for mode in MODES:
                ident = (p['entry'], p['direction'], mode)
                if ident in selections:
                    continue
                contract = choose_contract(chains[expiry], p['spot'], p['direction'], mode)
                selections[ident] = contract
                key = contract['instrument_key']
                if key not in spans:
                    spans[key] = [p['entry'].date(), p['exit'].date()]
                else:
                    spans[key][0] = min(spans[key][0], p['entry'].date())
                    spans[key][1] = max(spans[key][1], p['exit'].date())
    histories = {}
    for i, (key, (a, b)) in enumerate(spans.items(), 1):
        path = f'v2/expired-instruments/historical-candle/{urllib.parse.quote(key, safe="")}/1minute/{b}/{a}'
        histories[key] = bars(client.get(path)['data']['candles'])
        if i % 25 == 0 or i == len(spans):
            print(f'Option candle downloads: {i}/{len(spans)}; network requests={client.requests}', flush=True)
    summary, ledgers = [], {}
    for (s, c), values in plans.items():
        for mode in MODES:
            trades = []
            for p in values:
                contract = selections[(p['entry'], p['direction'], mode)]
                try:
                    trade = priced_trade(p, contract, histories[contract['instrument_key']], mode)
                    trade['exit_spot'] = spot[p['exit']][0]
                    trades.append(trade)
                except ValueError as error:
                    errors.append({'start': s, 'cutoff': c, 'mode': mode, 'entry': p['entry'].isoformat(), 'error': str(error)})
            ledgers[(s, c, mode)] = trades
            development = metrics([t for t in trades if t['entry'][:10] < '2026-08-01'])
            holdout = metrics([t for t in trades if t['entry'][:10] >= '2026-08-01'])
            summary.append({'start': s, 'cutoff': c, 'mode': mode, 'planned': len(values),
                            'excluded_trades': len(values) - len(trades), **metrics(trades),
                            **{'development_' + k: development[k] for k in ('net', 'trades', 'profit_factor')},
                            **{'holdout_' + k: holdout[k] for k in ('net', 'trades', 'profit_factor')}})
    write_csv(out / 'windows.csv', summary)
    baseline = []
    periods = []
    stress = []
    for mode in MODES:
        trades = ledgers[(*BASELINE, mode)]
        write_csv(out / f'trades_{mode}.csv', trades)
        dd, equity = marked_drawdown(trades, histories)
        write_csv(out / f'equity_{mode}.csv', equity)
        baseline.append({'mode': mode, 'no_trade_sessions': len(days) - len({t['entry'][:10] for t in trades}), **metrics(trades), **dd})
        for name, predicate in [('development', lambda t: t['entry'][:10] < '2026-08-01'),
                                ('holdout', lambda t: t['entry'][:10] >= '2026-08-01')]:
            periods.append({'mode': mode, 'period': name, **metrics([t for t in trades if predicate(t)])})
        for month in sorted({t['entry'][:7] for t in trades}):
            periods.append({'mode': mode, 'period': month, **metrics([t for t in trades if t['entry'].startswith(month)])})
        for fixed, delay, sizing in [(0, 0, 'fixed65'), (1, 0, 'fixed65'), (2, 0, 'fixed65'), (.5, 1, 'fixed65'), (.5, 0, 'actual_lot')]:
            variant, missing = [], 0
            for p in plans[BASELINE]:
                ct = selections[(p['entry'], p['direction'], mode)]
                try:
                    variant.append(priced_trade(p, ct, histories[ct['instrument_key']], mode, fixed=fixed, delay=delay,
                                                quantity=ct['lot_size'] if sizing == 'actual_lot' else 65))
                except ValueError:
                    missing += 1
            stress.append({'mode': mode, 'fixed_points': fixed, 'delay_minutes': delay, 'sizing': sizing,
                           'excluded_trades': missing, **metrics(variant)})
    write_csv(out / 'periods.csv', periods)
    write_csv(out / 'sensitivity.csv', stress)
    write_csv(out / 'excluded_trades.csv', errors)
    selected = []
    for mode in MODES:
        # Select using development data ONLY; evaluate the later partition separately.
        winner = max((row for row in summary if row['mode'] == mode), key=lambda row: row['development_net'])
        trades = ledgers[(winner['start'], winner['cutoff'], mode)]
        write_csv(out / f'trades_development_selected_{mode}.csv', trades)
        delayed = []
        for p in plans[(winner['start'], winner['cutoff'])]:
            ct = selections[(p['entry'], p['direction'], mode)]
            delayed.append(priced_trade(p, ct, histories[ct['instrument_key']], mode, delay=1))
        variants = []
        for fixed, actual in [(1, False), (2, False), (.5, True)]:
            variant = []
            for p in plans[(winner['start'], winner['cutoff'])]:
                ct = selections[(p['entry'], p['direction'], mode)]
                variant.append(priced_trade(p, ct, histories[ct['instrument_key']], mode, fixed=fixed,
                                            quantity=ct['lot_size'] if actual else 65))
            variants.append({'fixed_points': fixed, 'sizing': 'actual_lot' if actual else 'fixed65',
                             'net': metrics(variant)['net'],
                             'holdout_net': metrics([t for t in variant if t['entry'][:10] >= '2026-08-01'])['net']})
        dd, equity = marked_drawdown(trades, histories)
        write_csv(out / f'equity_development_selected_{mode}.csv', equity)
        top_five = sorted(trades, key=lambda t: t['net'], reverse=True)[:5]
        selected.append({**winner, **dd, 'selection_rule': 'highest development net among 21 windows; mode fixed',
                         'net_without_best_five_trades': winner['net'] - sum(t['net'] for t in top_five),
                         'bootstrap': block_bootstrap(trades, days), 'sensitivity': variants,
                         'delayed_net': metrics(delayed)['net'],
                         'delayed_holdout_net': metrics([t for t in delayed if t['entry'][:10] >= '2026-08-01'])['net']})
    manifest = {'start': str(start), 'end': str(end), 'complete_sessions': len(days),
                'spot_minutes_including_warmup': len(spot), 'excluded_spot_days': excluded_days,
                'option_contracts': len(histories), 'option_minutes': sum(map(len, histories.values())),
                'baseline': baseline, 'periods': periods, 'sensitivity': stress,
                'all_windows': summary, 'development_selected': selected, 'exclusions': len(errors),
                'historical_lot_sizes': dict(Counter(c['lot_size'] for c in selections.values())),
                'new_network_requests': client.requests, 'reference_capital': CAPITAL,
                'raw_data_hashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((out / 'cache').glob('*.json'))}}
    (out / 'results.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps({'sessions': len(days), 'baseline': baseline, 'exclusions': len(errors)}, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', default='2025-11-04')
    parser.add_argument('--end', default='2026-11-03')
    parser.add_argument('--output', default=str(ROOT / 'data/exports/ema_options_921_15m'))
    run(parser.parse_args())
