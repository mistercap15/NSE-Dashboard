"""Fixed NIFTY futures screen. Research margin assumptions, never broker orders."""
import argparse, json, math, hashlib
from pathlib import Path
from collections import defaultdict, deque
from datetime import date,timedelta

CAPITAL=500000


def fees(price,qty,side,day):
    n=price*qty
    b=min(20,n*.0005)
    exchange=n*(.0000183 if day>='2026-03-01' else .0000173)
    ipft=0 if day>='2026-03-01' else n*.000001
    sebi=n*.000001
    gst=.18*(b+exchange+ipft+sebi)
    stt=n*(.0005 if day>='2026-04-01' else .0002) if side=='sell' else 0
    stamp=n*.00002 if side=='buy' else 0
    return {'brokerage':b,'exchange':exchange,'ipft':ipft,'sebi':sebi,'gst':gst,'stt':stt,'stamp':stamp}


def rounded(price,tick,buy):
    return (math.ceil(price/tick-1e-9) if buy else math.floor(price/tick+1e-9))*tick


def execution(price,side,slip,tick):
    return rounded(price*(1+side*slip),tick,side==1)


def stop_or_target(p,b):
    d=p['side'];o=b['open'];h=b['high'];l=b['low']
    if (d==1 and o<=p['stop']) or (d==-1 and o>=p['stop']):return o,'stop_gap'
    if (d==1 and o>=p['target']) or (d==-1 and o<=p['target']):return p['target'],'target_gap_conservative'
    hit_stop=l<=p['stop'] if d==1 else h>=p['stop']
    hit_target=h>=p['target'] if d==1 else l<=p['target']
    if hit_stop:return p['stop'],'stop_and_target_stop_first' if hit_target else 'stop'
    if hit_target:return p['target'],'target'
    return None,None


def metrics(trades):
    wins=sum(max(0,t['pnl']) for t in trades); losses=-sum(min(0,t['pnl']) for t in trades)
    return {'trades':len(trades),'net_pnl':sum(t['pnl'] for t in trades),
            'profit_factor':wins/losses if losses else None,
            'win_rate':sum(t['pnl']>0 for t in trades)/len(trades) if trades else None,
            'expectancy':sum(t['pnl'] for t in trades)/len(trades) if trades else None}


def load_days(path):
    groups=defaultdict(list);excluded=[]
    for line in Path(path).read_text().splitlines():
        r=json.loads(line);day=r['timestamp'][:10]
        if day<'2025-06-15':continue
        if set(r['flags'])-{'zero_oi'}:
            excluded.append({'day':day,'timestamp':r['timestamp'],'reason':r['flags']});continue
        groups[(day,r['key'])].append(r)
    good=[]
    for (day,key),rows in sorted(groups.items()):
        rows.sort(key=lambda r:r['timestamp'])
        mins=[int(r['timestamp'][11:13])*60+int(r['timestamp'][14:16]) for r in rows]
        if mins!=list(range(555,930,5)) or any(r['volume']<=0 for r in rows):
            excluded.append({'day':day,'key':key,'reason':'incomplete_regular_grid_or_zero_volume','rows':len(rows)});continue
        good.append((day,rows))
    return good,excluded


def run(path,candidate,bps,margin,out):
    days,excluded=load_days(path);slip=bps/10000;balance=CAPITAL;peak=balance;dd=0
    trades=[];curve=[];daily=[];rejections=[];previous_day=None;previous_key=None
    closes=deque(maxlen=200);trs=deque(maxlen=14);fast=slow=atr=prev_close=None
    for day,rows in days:
        key=rows[0]['key'];nextday=date.fromisoformat(previous_day)+timedelta(days=1) if previous_day else None
        while nextday and nextday.weekday()>=5:nextday+=timedelta(days=1)
        if key!=previous_key or (nextday and nextday.isoformat()!=day):
            closes.clear();trs.clear();fast=slow=atr=prev_close=None
        previous_day=day;previous_key=key
        start=balance;position=None;pending=None;entries=0;attempted=set();halt=False
        hi=max(r['high'] for r in rows[:6]);lo=min(r['low'] for r in rows[:6])
        for i,b in enumerate(rows):
            at=b['timestamp'];minute=int(at[11:13])*60+int(at[14:16]);tick=b['tick_size_provider']/100
            if not math.isfinite(tick) or tick<=0:raise ValueError('Invalid tick metadata')
            equity_open=balance+(position['side']*(b['open']-position['entry'])*position['qty'] if position else 0)
            peak=max(peak,equity_open);dd=max(dd,peak-equity_open)
            if equity_open<=start*.99:halt=True
            exited=False
            # Pending was generated only by the previous completed candle.
            if pending and not position:
                intent=pending;pending=None
                if minute<840 and not halt and entries<2:
                    side=intent['side'];fill=execution(b['open'],side,slip,tick)
                    stop=intent['stop'] if candidate=='orb30' else fill-side*2*intent['atr']
                    stop=rounded(stop,tick,side==-1)
                    risk=side*(fill-stop);lot=b['lot_size'];qty=0
                    one_stop=execution(stop,-side,slip,tick)
                    one_risk=side*(fill-one_stop)*lot+sum(fees(fill,lot,'buy' if side==1 else 'sell',day).values())+sum(fees(one_stop,lot,'sell' if side==1 else 'buy',day).values())
                    if risk>0:
                        maxlots=min(100,int(balance/(fill*lot*margin)))
                        for lots in range(maxlots,0,-1):
                            q=lots*lot;ef=fees(fill,q,'buy' if side==1 else 'sell',day)
                            sx=execution(stop,-side,slip,tick);sf=fees(sx,q,'sell' if side==1 else 'buy',day)
                            planned=side*(fill-sx)*q+sum(ef.values())+sum(sf.values())
                            if planned<=balance*.005 and fill*q*margin+planned<=balance:
                                qty=q;break
                    if qty:
                        balance-=sum(ef.values());entries+=1
                        position={'symbol':b['symbol'],'key':key,'expiry':b['expiry'],'lot_size':lot,'qty':qty,'side':side,
                                  'entry_at':at,'signal_at':intent['signal_at'],'entry':fill,'stop':stop,'target':fill+side*2*risk,
                                  'entry_fees':ef,'planned_risk':planned,'margin_reserved':fill*qty*margin}
                    else:rejections.append({'day':day,'at':at,'reason':'whole_lot_risk_or_margin','candidate':candidate,'lot_size':lot,'minimum_lot_planned_risk':one_risk,'risk_budget':balance*.005,'minimum_lot_margin':fill*lot*margin,'equity':balance,'signal_stop_distance':risk})
            if position:
                px,reason=(b['open'],'squareoff') if minute>=915 else stop_or_target(position,b)
                if px is not None:
                    p=position;exit_=execution(px,-p['side'],slip,tick);xf=fees(exit_,p['qty'],'sell' if p['side']==1 else 'buy',day)
                    gross=p['side']*(exit_-p['entry'])*p['qty'];balance+=gross-sum(xf.values())
                    trades.append({**p,'exit_at':at,'exit':exit_,'exit_fees':xf,'gross_pnl':gross,'pnl':gross-sum(p['entry_fees'].values())-sum(xf.values()),'reason':reason})
                    position=None;exited=True
            # Indicators use this completed bar only; rolls/gaps reset above.
            oldfast,oldslow=fast,slow
            fast=b['close'] if fast is None else fast+.2*(b['close']-fast)
            slow=b['close'] if slow is None else slow+.125*(b['close']-slow)
            tr=max(b['high']-b['low'],abs(b['high']-prev_close),abs(b['low']-prev_close)) if prev_close else b['high']-b['low']
            trs.append(tr)
            atr=sum(trs)/14 if atr is None and len(trs)==14 else ((atr*13+tr)/14 if atr is not None else None)
            closes.append(b['close']);prev_close=b['close']
            eq=balance+(position['side']*(b['close']-position['entry'])*position['qty'] if position else 0)
            peak=max(peak,eq);dd=max(dd,peak-eq)
            if eq<=start*.99:halt=True
            curve.append({'at':at,'equity':eq,'drawdown':peak-eq,'margin':position['margin_reserved'] if position else 0})
            # 09:45 range completes on index5; first possible breakout signal is index6 close09:50.
            if not position and not exited and not halt and entries<2 and minute+5<840:
                side=0
                if candidate=='orb30' and i>=6:
                    side=1 if b['close']>hi else -1 if b['close']<lo else 0
                    if side in attempted:side=0
                elif candidate=='ema9_15' and len(closes)==200 and atr is not None and minute+5>=570:
                    sma=sum(closes)/200
                    side=1 if oldfast<=oldslow and fast>slow and b['close']>sma else -1 if oldfast>=oldslow and fast<slow and b['close']<sma else 0
                if side:
                    attempted.add(side)
                    pending={'side':side,'stop':lo if side==1 else hi,'atr':atr,
                             'signal_at':rows[i+1]['timestamp']}
        if position:raise AssertionError('Complete regular session must square off')
        daily.append({'day':day,'entries':entries,'net_pnl':balance-start,'equity':balance,'return_fraction':balance/start-1})
    summary={**metrics(trades),'initial_capital':CAPITAL,'ending_equity':balance,'account_return':balance/CAPITAL-1,
             'max_marked_drawdown':dd,'sessions':len(days),'first_day':days[0][0] if days else None,'last_day':days[-1][0] if days else None,
             'candidate':candidate,'slippage_bps_each_side':bps,'assumed_margin_fraction':margin,'rejected_whole_lot_entries':len(rejections),
             'yearly':{},'quarterly':{},'by_contract':{}}
    prev=CAPITAL
    for year in sorted({d['day'][:4] for d in daily}):
        end=[d['equity'] for d in daily if d['day'].startswith(year)][-1]
        summary['yearly'][year]={**metrics([t for t in trades if t['exit_at'].startswith(year)]),'capital_return':end/prev-1};prev=end
    for q in sorted({d['day'][:4]+'Q'+str((int(d['day'][5:7])-1)//3+1) for d in daily}):
        summary['quarterly'][q]=metrics([t for t in trades if t['exit_at'][:4]+'Q'+str((int(t['exit_at'][5:7])-1)//3+1)==q])
    for key in sorted({t['symbol'] for t in trades}):summary['by_contract'][key]=metrics([t for t in trades if t['symbol']==key])
    summary['total_fees']=sum(sum(t['entry_fees'].values())+sum(t['exit_fees'].values()) for t in trades)
    p=Path(out);p.mkdir(parents=True,exist_ok=True)
    for name,value in [('summary',summary),('trades',trades),('equity_curve',curve),('daily',daily),('rejections',rejections),('excluded',excluded)]:
        (p/(name+'.json')).write_text(json.dumps(value,indent=2))
    protocol=Path(__file__).with_name('NIFTY_FROZEN_2026-10-14.md')
    (p/'provenance.json').write_text(json.dumps({str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in [Path(path),Path(__file__),protocol]},indent=2))
    print(json.dumps({k:summary[k] for k in ['candidate','slippage_bps_each_side','assumed_margin_fraction','trades','net_pnl','profit_factor','account_return','max_marked_drawdown','sessions','rejected_whole_lot_entries']}))
    return summary

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--data',required=True);a.add_argument('--out',required=True);args=a.parse_args()
    for c in ['orb30','ema9_15']:
        for bps,margin in [(2,.2),(5,.2),(2,.3)]:run(args.data,c,bps,margin,Path(args.out)/f'{c}-{bps}bp-margin{int(margin*100)}')
