"""Personal advisory inbox. Market-data HTTP GET only; no broker/account/order API.
SQLite persists watches, append-only evidence and deduplicated unread events.
"""
import hashlib,hmac,json,os,re,sqlite3,threading,time,urllib.request,urllib.parse
from datetime import datetime,timezone
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
DB=os.environ.get('HEDGE_DB','/var/lib/nserank-hedge-inbox/inbox.sqlite')
SECRET=os.environ.get('HEDGE_INBOX_SECRET','')
WORKER=os.environ.get('HEDGE_WORKER_SECRET','')
BASE=os.environ.get('HEDGE_API_BASE','https://nse-dashboard-gamma.vercel.app')

@contextmanager
def db():
 c=sqlite3.connect(DB,timeout=15);c.row_factory=sqlite3.Row;c.execute('PRAGMA journal_mode=WAL')
 try:
  with c:yield c
 finally:c.close()

def init():
 with db() as c:
  c.executescript('CREATE TABLE IF NOT EXISTS health(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS watches(id TEXT PRIMARY KEY,payload TEXT NOT NULL,enabled INTEGER NOT NULL,last_poll REAL DEFAULT 0,fingerprint TEXT); CREATE TABLE IF NOT EXISTS evidence(id INTEGER PRIMARY KEY,watch_id TEXT,at REAL,payload TEXT); CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY,watch_id TEXT,at REAL,title TEXT,detail TEXT,unread INTEGER DEFAULT 1); CREATE INDEX IF NOT EXISTS evidence_watch ON evidence(watch_id,at);')
  if 'selected_put' not in [r[1] for r in c.execute('PRAGMA table_info(watches)')]:c.execute('ALTER TABLE watches ADD COLUMN selected_put TEXT')

def validate_selection(b):
 selection=b.get('selectedPut') or None
 if selection is not None and (not isinstance(selection,str) or not re.fullmatch(r'NSE_FO\|[A-Za-z0-9]+',selection)):raise ValueError('Invalid selected put')
 return selection

def validate(b):
 p=b.get('position',{});s=p.get('symbol','');k=p.get('contract','');entry=float(p.get('entry',0));lots=int(p.get('lots',0))
 if not re.fullmatch(r'[A-Z0-9&-]{1,30}',s) or not re.fullmatch(r'NSE_FO\|[A-Za-z0-9]+',k) or not 0<entry<1e7 or not 1<=lots<=100 or float(p.get('lots',0))!=lots:raise ValueError('Invalid position')
 expiry=p.get('expiryDate','')
 datetime.strptime(expiry,'%Y-%m-%d')
 if expiry<datetime.now(timezone.utc).strftime('%Y-%m-%d'):raise ValueError('Expired contract')
 return {'symbol':s,'contract':k,'entry':entry,'lots':lots,'expiryDate':expiry}

def action(b):
 op=b.get('action');now=time.time()
 with db() as c:
  c.execute('BEGIN IMMEDIATE')
  if op=='watch':
   p=validate(b);selected=validate_selection(b);ident=hashlib.sha256(json.dumps(p,sort_keys=True).encode()).hexdigest()[:24]
   if c.execute('SELECT count(*) FROM watches WHERE enabled=1').fetchone()[0]>=20 and not c.execute('SELECT 1 FROM watches WHERE id=? AND enabled=1',(ident,)).fetchone():raise ValueError('Limit 20 watches')
   c.execute('INSERT INTO watches(id,payload,enabled,selected_put) VALUES(?,?,1,?) ON CONFLICT(id) DO UPDATE SET enabled=1,last_poll=0,selected_put=excluded.selected_put',(ident,json.dumps(p),selected));return {'id':ident,'enabled':True}
  if op=='unwatch':c.execute('UPDATE watches SET enabled=0 WHERE id=?',(str(b.get('id','')),));return {'ok':True}
  if op=='read':c.execute('UPDATE alerts SET unread=0 WHERE id=?',(int(b['id']),));return {'ok':True}
  raise ValueError('Invalid action')

def state():
 with db() as c:
  watches=[dict(r) for r in c.execute('SELECT id,payload,enabled,last_poll,selected_put FROM watches ORDER BY enabled DESC,rowid DESC LIMIT 50')]
  for w in watches:
   w['position']=json.loads(w.pop('payload'))
   latest=c.execute('SELECT payload FROM evidence WHERE watch_id=? ORDER BY at DESC LIMIT 1',(w['id'],)).fetchone()
   w['latest']=json.loads(latest['payload']) if latest and w['last_poll'] else None
  return {'health':dict(c.execute('SELECT key,value FROM health').fetchall()),'mode':'advisory-only','watches':watches,'alerts':[dict(r) for r in c.execute('SELECT * FROM alerts ORDER BY id DESC LIMIT 100')],'intervalSeconds':300,'now':time.time()}

_UNSET=object()
def record(ident,result,expected_selection=_UNSET):
 # Headline identity changes only, never quote prices or volatile fetch timestamps.
 advice=result.get('advice',{});news=advice.get('news',{});sector=advice.get('sector',{})
 summary={'status':advice.get('status','Data unavailable'),'exit':advice.get('exit'),'newsStatus':news.get('status'),'sectorStatus':sector.get('status'),'sectorWeak':sector.get('weak'),'news':sorted(x.get('url','') for x in news.get('items',[])),'missing':advice.get('missing',[])}
 fingerprint=hashlib.sha256(json.dumps(summary,sort_keys=True).encode()).hexdigest();now=time.time()
 with db() as c:
  w=c.execute('SELECT * FROM watches WHERE id=? AND enabled=1',(ident,)).fetchone()
  if not w:return
  if expected_selection is not _UNSET and w['selected_put']!=expected_selection:return
  p=json.loads(w['payload'])
  compact={k:result.get(k) for k in ['advice','summary','asOf','position','spot','spotQuote','futuresMark','futuresQuote','futuresOi','simple','target']}
  compact['candidates']=sorted(result.get('candidates',[]),key=lambda x:abs(x.get('strike',0)-(result.get('spot') or 0)))[:4]
  c.execute('INSERT INTO evidence(watch_id,at,payload) VALUES(?,?,?)',(ident,now,json.dumps(compact)))
  c.execute('DELETE FROM evidence WHERE at<? OR id IN (SELECT id FROM evidence ORDER BY id DESC LIMIT -1 OFFSET 50000)',(now-90*86400,))
  c.execute('DELETE FROM alerts WHERE at<?',(now-90*86400,))
  if fingerprint!=w['fingerprint']:
   detail=json.dumps({'summary':summary,'reasons':advice.get('reasons',[]),'asOf':advice.get('asOf'),'ruleVersion':advice.get('version'),'headlines':news.get('items',[])})
   c.execute('INSERT INTO alerts(watch_id,at,title,detail) VALUES(?,?,?,?)',(ident,now,p['symbol']+' · '+summary['status'],detail))
  c.execute('UPDATE watches SET fingerprint=?,last_poll=? WHERE id=?',(fingerprint,now,ident))

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError("Redirect refused")

def cycle():
 with db() as c:rows=c.execute('SELECT id,payload,selected_put FROM watches WHERE enabled=1 AND last_poll<?',(time.time()-300,)).fetchall()
 for row in rows:
  p=json.loads(row['payload'])
  if p['expiryDate']<datetime.now(timezone.utc).strftime('%Y-%m-%d'):
   record(row['id'],{'advice':{'status':'Contract expired — monitoring stopped','reasons':['Review settlement; no automatic contract roll.']}})
   with db() as c:c.execute('UPDATE watches SET enabled=0 WHERE id=?',(row['id'],))
   continue
  try:
   params={k:p[k] for k in ['symbol','contract','entry','lots']}|{'simple':'1'}
   if row['selected_put']:params['preferredPut']=row['selected_put']
   query=urllib.parse.urlencode(params)
   req=urllib.request.Request(BASE+'/api/protection?'+query,headers={'X-Hedge-Worker':WORKER,'Accept':'application/json'})
   with urllib.request.build_opener(NoRedirect).open(req,timeout=75) as response:
    raw=response.read(2000001)
    if len(raw)>2000000:raise ValueError("Response too large")
    result=json.loads(raw)
   if result.get('advice',{}).get('version')!='daily-hedge-v2' or (row['selected_put'] and result.get('trackingVersion')!=2):raise ValueError('API rollout pending')
   record(row['id'],result,row['selected_put'])
  except Exception:
   record(row['id'],{'advice':{'status':'Data unavailable','reasons':['Market-data/API connection failed or matching API deployment is pending. No safe-to-trade inference.']}},row['selected_put'])
  time.sleep(1)

def loop():
 while True:
  try:
   cycle()
   with db() as c:c.execute('INSERT OR REPLACE INTO health VALUES(?,?)',('last_success',str(time.time())));c.execute('INSERT OR REPLACE INTO health VALUES(?,?)',('error',''))
  except Exception:
   with db() as c:c.execute('INSERT OR REPLACE INTO health VALUES(?,?)',('error','Worker cycle failed; inspect advisory service.'))
  time.sleep(30)

class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def reply(self,code,data):
  data=json.dumps(data).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def authorized(self):return len(SECRET)>=32 and hmac.compare_digest(self.headers.get('X-Inbox-Secret',''),SECRET)
 def do_GET(self):
  if not self.authorized():return self.reply(403,{'error':'Forbidden'})
  if self.path!='/state':return self.reply(404,{'error':'Not found'})
  self.reply(200,state())
 def do_POST(self):
  if not self.authorized():return self.reply(403,{'error':'Forbidden'})
  try:
   length=int(self.headers.get('Content-Length','0'))
   if not 0<length<=8192:raise ValueError()
   b=json.loads(self.rfile.read(length))
   if not isinstance(b,dict):raise ValueError()
   if self.path!='/'+b.get('action',''):raise ValueError()
   self.reply(200,action(b))
  except (ValueError,KeyError,TypeError,OverflowError):self.reply(400,{'error':'Invalid request'})

if __name__=='__main__':
 if len(SECRET)<32 or len(WORKER)<32 or not BASE.startswith('https://'):raise SystemExit('Required service configuration missing')
 init();threading.Thread(target=loop,daemon=True).start();ThreadingHTTPServer(('127.0.0.1',8792),Handler).serve_forever()
