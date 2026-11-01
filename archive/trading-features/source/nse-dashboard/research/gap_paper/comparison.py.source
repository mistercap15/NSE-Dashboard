"""Two isolated paper ledgers driven synchronously by one market-data observer."""
import copy
import json
from pathlib import Path
from .market_service import MarketService
from .service import now
from .engine import stamp
from .storage import read, update, metadata, seed_session, dashboard


def variant_config(primary):
    cfg = json.loads(Path(__file__).with_name('config.v2.json').read_text())
    changed = {k for k in primary.keys() | cfg.keys() if primary.get(k) != cfg.get(k)}
    if changed != {'version', 'advance'} or primary['advance'] != .005 or cfg['advance'] != .0025:
        raise ValueError('V2 must differ only in version and the frozen advance threshold')
    return cfg


class ComparisonService(MarketService):
    def initialize_variants(self):
        self.v2_cfg = variant_config(self.cfg)
        self.v2_db = self.root / 'v2' / 'paper.sqlite'
        self.v2_bundle = metadata(self.v2_db, 'references')
        self.v2_selected_day = metadata(self.v2_db, 'market_selected_day')
        self.comparison_started = metadata(self.v2_db, 'comparison_started')
        if not self.comparison_started:
            self.comparison_started = {'at': now().isoformat(), 'policy': 'next_timely_opening_only'}
            metadata(self.v2_db, 'comparison_started', self.comparison_started)
        if not self.v2_bundle:
            self.v2_bundle = copy.deepcopy(self.bundle) if self.bundle else {
                'manifest': {'members': [], 'comparable': {}}, 'calendar': {}, 'day': None}
            metadata(self.v2_db, 'references', self.v2_bundle)
        update(self.v2_db, self.v2_cfg, self.v2_bundle['manifest'], self.v2_bundle['calendar'],
               operational_halt=True)
        # A crash between the two ledger commits cannot authorize retrospective fills.
        pending = metadata(self.db, 'comparison_pending')
        if pending and pending.get('at'):
            self.gap_day = now().date().isoformat()
            self.health['entry_halt_reason'] = 'Interrupted comparison event; no replayed fills'

    def v2_halt(self, day):
        return self.gap_day == day or self.v2_selected_day != day

    def seed_variants(self, result, received):
        day = result['day']
        with self.lock:
            metadata(self.db, "comparison_pending", {"at": received.isoformat()})
            state = read(self.v2_db)
            if state['positions'] or self.v2_selected_day == day:
                return
            # This hook is called only for today's complete, timely 09:20 observation.
            seed_session(self.v2_db, self.v2_cfg, result['manifest'], result['calendar'],
                         result['profiles'], day, received.isoformat())
            self.v2_bundle = {k: result[k] for k in ['manifest', 'calendar', 'day']}
            metadata(self.v2_db, 'references', self.v2_bundle)
            self.v2_selected_day = day
            metadata(self.v2_db, 'market_selected_day', day)
            metadata(self.v2_db, 'selection_check:' + day, metadata(self.db, 'selection_check:' + day))
            self.ingest_v2({'kind': 'candles', 'at': received.isoformat(),
                           'received_at': received.isoformat(),
                           'closed_at': day + 'T09:20:00+05:30', 'bars': result['bars']})

    def finish_variants(self):
        metadata(self.db, "comparison_pending", {})

    def observed_candle(self, state):
        values = [state.get("last_candle"), read(self.v2_db).get("last_candle")]
        return max((v for v in values if v), default=None)

    def ingest_v2(self, event):
        # Before activation there are no V2 observations, signals or P&L to display.
        state = read(self.v2_db)
        if self.v2_selected_day != event['at'][:10] and not state['positions']:
            return
        update(self.v2_db, self.v2_cfg, self.v2_bundle['manifest'], self.v2_bundle['calendar'],
               operational_halt=self.v2_halt(event['at'][:10]), events=[copy.deepcopy(event)])

    def ingest(self, event):
        with self.lock:
            metadata(self.db, 'comparison_pending', {'at': event['at']})
            result = super().ingest(event)
            # The initial opening event may already have been committed by seed_variants.
            # Storage checks both timestamp AND hash; identical observations are idempotent.
            self.ingest_v2(event)
            metadata(self.db, 'comparison_pending', {})
            return result

    def feed_state(self, state):
        primary = super().feed_state(state)
        other = read(self.v2_db)
        picks = primary['shortlist'] + (other['shortlist'] if self.v2_selected_day == now().date().isoformat() else [])
        return {**primary, 'positions': {**primary['positions'], **other['positions']},
                'shortlist': list({p['symbol']: p for p in picks}.values())}

    def feed_bundle(self):
        bundle = copy.deepcopy(self.bundle)
        members = bundle['manifest']['members'] + self.v2_bundle['manifest']['members']
        by_symbol = {}
        for member in members:
            old = by_symbol.get(member['symbol'])
            if old and old.get('key') != member.get('key'):
                raise ValueError('Conflicting instrument identity across paper accounts')
            by_symbol[member['symbol']] = member
        bundle['manifest']['members'] = list(by_symbol.values())
        return bundle

    def candle_symbols(self, state):
        return super().candle_symbols(self.feed_state(state))

    def status(self, status, message=None, **extra):
        super().status(status, message, **extra)
        day = now().date().isoformat()
        halted = self.v2_halt(day)
        state = read(self.v2_db)
        reason = (self.health.get('entry_halt_reason') if self.gap_day == day else
                  'Carried V2 position; opening selection skipped' if state['positions'] else
                  'Waiting for the next timely opening selection')
        health = {**self.health, 'entry_halt': halted,
                  'entry_halt_day': day if halted else None,
                  'entry_halt_reason': reason if halted else None,
                  'status': 'entry_halted' if halted and status == 'observing' else
                            'observing' if not halted and status == 'entry_halted' else status,
                  'message': 'V2: 0.25% advance. Shared observations; separate paper capital and risk limits.'}
        metadata(self.v2_db, 'health', health)
        update(self.v2_db, self.v2_cfg, self.v2_bundle['manifest'], self.v2_bundle['calendar'],
               operational_halt=halted)

    def control_variant(self, action, variant='v1'):
        if variant == 'v1':
            return super().control(action)
        if variant != 'v2':
            raise ValueError('Unknown paper variant')
        # Keep the frozen experiment's identity and history. Reset would invalidate comparison.
        if action not in ['pause', 'resume']:
            raise ValueError('V2 comparison supports pause/resume only')
        with self.lock:
            return update(self.v2_db, self.v2_cfg, self.v2_bundle['manifest'],
                          self.v2_bundle['calendar'], action=action)

    def snapshot(self, day):
        with self.lock:
            primary = dashboard(self.db, day)
            other = dashboard(self.v2_db, day)
            other.pop('scanner', None)
            for key in ['heartbeat_age_seconds', 'quote_age_seconds']:
                source = other.get('service', {}).get('heartbeat_at' if key.startswith('heartbeat') else 'last_quote_received')
                other['service'][key] = (now() - stamp(source)).total_seconds() if source else None
            primary['variant'] = 'v1'
            other['variant'] = 'v2'
            primary['advance_fraction'] = self.cfg['advance']
            other['advance_fraction'] = self.v2_cfg['advance']
            primary['comparison'] = {
                'started_at': self.comparison_started['at'], 'day': day,
                'policy': 'Same feed; independent accounts. Only paired forward days are comparable.',
                'paired_day': bool(primary.get('daily') and other.get('daily')),
                'accounts': [self.summary(primary, 'V1 · 0.5%'), self.summary(other, 'V2 · 0.25%')],
            }
            primary['variants'] = {'v2': other}
            return primary

    @staticmethod
    def summary(account, label):
        d = account.get('daily')
        return {'variant': account['variant'], 'label': label,
                'advance_fraction': account['advance_fraction'], 'account_id': account.get('account_id'),
                'equity': account.get('equity'), 'observed': bool(d),
                'entries': d.get('entries') if d else None,
                'closed_trades': d.get('closed_trades') if d else None,
                'net_pnl': d.get('net_pnl') if d else None,
                'return_fraction': d.get('return_fraction') if d else None,
                'max_drawdown': d.get('max_drawdown') if d else None}
