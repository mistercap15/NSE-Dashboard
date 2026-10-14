"""Auditable read-only NIFTY futures downloader; analytics token stays in memory."""
import argparse, datetime as dt, gzip, hashlib, json, math, time
from pathlib import Path
import urllib.request, urllib.error, urllib.parse
from collections import defaultdict
from research.gap_paper.data import token

BASE='https://api.upstox.com/'
UNDER='NSE_INDEX|Nifty 50'
IST=dt.timezone(dt.timedelta(hours=5,minutes=30))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

class AccessFailure(Exception): pass

class Fetcher:
    def __init__(self,root):
        self.root=Path(root);(self.root/'raw').mkdir(parents=True,exist_ok=True)
        self.secret=token();self.last=0;self.opener=urllib.request.build_opener(NoRedirect)
    def get(self,path):
        allowed=('v2/expired-instruments/expiries?','v2/expired-instruments/future/contract?',
                 'v2/expired-instruments/historical-candle/','v3/historical-candle/')
        if not path.startswith(allowed):raise ValueError('Read-only futures path required')
        file=self.root/'raw'/(hashlib.sha256(path.encode()).hexdigest()+'.json')
        if file.exists():return json.loads(file.read_text())['response']
        for attempt in range(5):
            time.sleep(max(0,1.05-(time.monotonic()-self.last)));self.last=time.monotonic()
            req=urllib.request.Request(BASE+path,headers={'Authorization':'Bearer '+self.secret,'Accept':'application/json','User-Agent':'Mozilla/5.0'},method='GET')
            try:
                with self.opener.open(req,timeout=30) as r:data=json.load(r)
                if data.get('status')!='success':raise AccessFailure('Unsuccessful Upstox response')
                value={'path':path,'retrieved_at':dt.datetime.now(IST).isoformat(),'response':data}
                tmp=file.with_suffix('.tmp');tmp.write_text(json.dumps(value));tmp.replace(file)
                return data
            except urllib.error.HTTPError as error:
                try:body=json.loads(error.read())
                except Exception:body={}
                errors=[{'code':x.get('errorCode',x.get('error_code')),'message':str(x.get('message','')).replace(self.secret,'[REDACTED]')} for x in body.get('errors',[])]
                if error.code in (401,403) or any(x['code']=='UDAPI1149' for x in errors):
                    raise AccessFailure(json.dumps({'http_status':error.code,'errors':errors})) from None
                if error.code==429 or error.code>=500:
                    time.sleep(min(2**attempt,16));continue
                raise AccessFailure(json.dumps({'http_status':error.code,'errors':errors})) from None
            except (urllib.error.URLError,TimeoutError):
                time.sleep(min(2**attempt,16))
        raise AccessFailure('Retries exhausted; download stopped')


def contract(row,live=False):
    if row.get('segment')!='NSE_FO' or row.get('instrument_type')!='FUT':return None
    if not (row.get('underlying_key')==UNDER or row.get('underlying_symbol')=='NIFTY' or row.get('name')=='NIFTY'):return None
    expiry=row['expiry']
    if isinstance(expiry,(int,float)):expiry=dt.datetime.fromtimestamp(expiry/1000,IST).date().isoformat()
    key=row.get('expired_instrument_key') or row.get('instrument_key')
    lot=row.get('lot_size')
    if not key or not isinstance(lot,(int,float)) or lot<=0 or int(lot)!=lot:raise ValueError('Missing contract key or lot size')
    return {'symbol':row.get('trading_symbol'),'expiry':expiry,'key':key,'lot_size':int(lot),'tick_size_provider':row.get('tick_size'),'live':live}


def download(root,to):
    out=Path(root); f=Fetcher(out)
    exps=f.get('v2/expired-instruments/expiries?instrument_key='+urllib.parse.quote(UNDER,safe=''))['data']
    groups=defaultdict(list)
    for d in sorted(set(exps)):
        if '2024-01-01'<=d<=to:groups[d[:7]].append(d)
    contracts=[];unresolved=[]
    for month,dates in sorted(groups.items()):
        found=[]
        for expiry in reversed(dates):
            rows=f.get('v2/expired-instruments/future/contract?instrument_key='+urllib.parse.quote(UNDER,safe='')+'&expiry_date='+expiry)['data']
            found=[c for r in rows if (c:=contract(r))]
            if found:
                if len(found)!=1 or found[0]['expiry']!=expiry:raise ValueError('Ambiguous future contract resolution')
                contracts+=found;break
        if not found:unresolved.append(month)
        print('Resolved',month,found[0]['symbol'] if found else 'no futures',flush=True)
    req=urllib.request.Request('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz',headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(req,timeout=40) as r:rows=json.loads(gzip.decompress(r.read()))
    live=[c for r in rows if (c:=contract(r,True))]
    (out/'live_contract_metadata.json').write_text(json.dumps([r for r in rows if r.get('instrument_key') in {c['key'] for c in live}],indent=2))
    contracts+=live;contracts.sort(key=lambda c:c['expiry'])
    (out/'contracts.json').write_text(json.dumps(contracts,indent=2))
    result=[];coverage=[];issues=[];previous=None
    for c in contracts:
        end=min(c['expiry'],to)
        start=(dt.date.fromisoformat(previous)+dt.timedelta(days=1)).isoformat() if previous else (dt.date.fromisoformat(c['expiry'])-dt.timedelta(days=31)).isoformat()
        uncertain=previous is None;previous=c['expiry']
        if start>end:continue
        raw=[];cursor=dt.date.fromisoformat(start)
        while cursor.isoformat()<=end:
            until=min(dt.date.fromisoformat(end),cursor+dt.timedelta(days=6))
            key=urllib.parse.quote(c['key'],safe='')
            path=(f'v3/historical-candle/{key}/minutes/5/{until}/{cursor}' if c['live'] else f'v2/expired-instruments/historical-candle/{key}/5minute/{until}/{cursor}')
            raw+=f.get(path)['data']['candles'];cursor=until+dt.timedelta(days=1)
        unique={}
        for row in raw:
            at=dt.datetime.fromisoformat(row[0]).astimezone(IST)
            if not start<=at.date().isoformat()<=end:
                issues.append({'key':c['key'],'timestamp':row[0],'reason':'outside_request'});continue
            if at.isoformat() in unique and unique[at.isoformat()]!=row:
                raise ValueError('Conflicting duplicate candle '+c['symbol']+' '+row[0])
            unique[at.isoformat()]=row
        sessions=defaultdict(list)
        for at,row in sorted(unique.items()):
            time_=dt.datetime.fromisoformat(at);minute=time_.hour*60+time_.minute
            nums=row[1:7]
            valid=len(nums)==6 and all(isinstance(x,(int,float)) and math.isfinite(x) for x in nums)
            valid=valid and min(nums[:4])>0 and row[3]<=min(row[1],row[4])<=max(row[1],row[4])<=row[2] and min(nums[4:])>=0
            grid=555<=minute<930 and minute%5==0 and time_.second==0
            flags=[]
            if not valid:flags.append('invalid_ohlcv_oi')
            if not grid:flags.append('outside_regular_grid')
            if time_.date().isoformat()<'2025-06-15':flags.append('pre_20250615_vendor_warning')
            if uncertain:flags.append('first_contract_front_month_boundary_unverified')
            if len(row)>6 and row[6]==0:flags.append('zero_oi')
            result.append({**c,'timestamp':at,'open':row[1],'high':row[2],'low':row[3],'close':row[4],'volume':row[5],'open_interest':row[6] if len(row)>6 else None,'flags':flags})
            sessions[at[:10]].append(minute)
        gaps=[{'day':d,'missing_minutes':sorted(set(range(555,930,5))-set(ms))} for d,ms in sessions.items() if set(range(555,930,5))-set(ms)]
        coverage.append({**c,'requested_from':start,'requested_to':end,'rows':len(unique),'first':min(unique,default=None),'last':max(unique,default=None),'observed_days':len(sessions),'incomplete_observed_sessions':gaps,'duplicates_identical':len(raw)-len(unique)})
        print('Downloaded',c['symbol'],len(unique),'five-minute bars',flush=True)
    (out/'candles.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in result))
    validation={'as_of':to,'rows':len(result),'first':min((r['timestamp'] for r in result),default=None),'last':max((r['timestamp'] for r in result),default=None),'contracts':coverage,'unresolved_months':unresolved,'issues':issues,'missing_entire_sessions':'Not certified until independently reconciled with historical exchange calendar','source':'Upstox authenticated API; no spot substitution'}
    (out/'validation.json').write_text(json.dumps(validation,indent=2))
    print(json.dumps({k:validation[k] for k in ['rows','first','last']}),flush=True)

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--out',required=True);a.add_argument('--to',default='2026-10-13');args=a.parse_args()
    try:download(args.out,args.to)
    except AccessFailure as error:
        Path(args.out,'access_error.json').write_text(json.dumps({'error':str(error)}));raise SystemExit(str(error))
