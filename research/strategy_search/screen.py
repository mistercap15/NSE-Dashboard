"""Offline fixed candidate screen. Never imported by the paper service or live bots."""
import argparse, copy, hashlib, json
from pathlib import Path
from datetime import timedelta
from unittest.mock import patch
from research.gap_paper import engine
from research.gap_paper.cli import pilot_inputs, events
from research.gap_paper.validation import validate, source_manifest
from research.gap_paper.report import export

ROOT = Path(__file__).resolve().parents[2]


def orb_transition(s, x, b, cfg, day, received_at=None):
    if x['phase'] != 'selected':
        return
    m = engine.minute(b['ts'])
    if x.get('orb_day') != day:
        x.update(orb_day=day, orb_bars=[])
    if m in (555,560,565):
        x['orb_bars'].append({k:b[k] for k in ('ts','h','l')})
    if m != 565:
        return
    rows = x['orb_bars']
    if [engine.minute(r['ts']) for r in rows] != [555,560,565] or not x['vwap'] or b['c'] <= x['vwap']:
        engine.invalidate(x,'orb_range_or_vwap_failed')
        return
    close = (engine.stamp(b['ts'])+timedelta(minutes=5)).isoformat()
    observed = received_at or close
    x['pending'] = {'trigger':engine.tick_up(max(r['h'] for r in rows)+x['tick'],x['tick']),
                    'stop':engine.tick_down(min(r['l'] for r in rows)-x['tick'],x['tick']),
                    'created':close,'observed_at':observed,'eligible_from':observed,'original_created':close}
    x['phase']='armed'
    s['signals'].append({'symbol':b['symbol'],'at':close,**x['pending'],'rank':x['rank']})


def run(candidate, scenario, output):
    rawpath=ROOT/'data/exports/nse_cash_coverage_20260927/raw'
    raw,manifest,cal=pilot_inputs(rawpath)
    audit=validate(raw,cal)
    batches,issues=events(raw)
    cfg=json.loads((ROOT/'research/gap_paper/config.json').read_text())
    cfg['corporate_action_policy']='continuity-assumption'
    if candidate=='v2': cfg.update(version='gap-first-pullback-v2-advance025',advance=.0025)
    if candidate=='orb15': cfg.update(version='gap-orb15-screen-v1',pending_bars=18)
    if scenario=='stress': cfg.update(slippage_bps=10,cost_multiplier=2)
    state=engine.fresh(cfg,manifest,cal)
    transition=orb_transition if candidate=='orb15' else engine.transition
    with patch.object(engine,'transition',transition):
        for e in batches: engine.process(state,e,cfg,manifest,cal)
    out=Path(output);out.mkdir(parents=True,exist_ok=True)
    result=export(state,out,cfg)
    for name,value in [('data_validation',audit),('input_files',source_manifest(rawpath)),('manifest',manifest),('calendar',cal),('normalization_issues',issues)]:
        (out/(name+'.json')).write_text(json.dumps(value,indent=2))
    files=[Path(__file__),ROOT/'research/strategy_search/PROTOCOL_2026-10-14.md',ROOT/'research/gap_paper/engine.py']
    (out/'screen_provenance.json').write_text(json.dumps({str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},indent=2))
    print(json.dumps({'candidate':candidate,'scenario':scenario,**{k:result[k] for k in ['trades','net_pnl','profit_factor','account_return','max_marked_drawdown_rupees']}}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate',choices=['v1','v2','orb15'],required=True);p.add_argument('--scenario',choices=['base','stress'],required=True);p.add_argument('--out',required=True);a=p.parse_args();run(a.candidate,a.scenario,a.out)
