import importlib.util,json,tempfile,unittest
from unittest.mock import patch,MagicMock
from pathlib import Path
spec=importlib.util.spec_from_file_location('service',Path(__file__).with_name('service.py'));s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class InboxTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();s.DB=self.tmp.name+'/test.sqlite';s.init()
  self.pos={'symbol':'HINDUNILVR','contract':'NSE_FO|123','entry':1900,'lots':5,'expiryDate':'2099-10-27'}
 def tearDown(self):self.tmp.cleanup()
 def test_idempotent_watch_and_pause(self):
  a=s.action({'action':'watch','position':self.pos});b=s.action({'action':'watch','position':self.pos});self.assertEqual(a,b)
  s.record(a['id'],{'advice':{'status':'Monitor'}});s.record(a['id'],{'advice':{'status':'Monitor'}})
  self.assertEqual(len(s.state()['alerts']),1)
  s.action({'action':'read','id':1});self.assertEqual(s.state()['alerts'][0]['unread'],0)
  s.record(a['id'],{'advice':{'status':'Protection warranted'}});self.assertEqual(len(s.state()['alerts']),2)
  s.action({'action':'unwatch','id':a['id']});s.record(a['id'],{'advice':{'status':'Monitor'}});self.assertEqual(len(s.state()['alerts']),2)
 def test_selected_put_persists_and_reset_hides_old_assessment(self):
  ident=s.action({'action':'watch','position':self.pos,'selectedPut':'NSE_FO|456'})['id']
  s.record(ident,{'advice':{'status':'Monitor'},'simple':{'recommendation':{'instrumentKey':'NSE_FO|456'}}})
  s.init()
  self.assertEqual(s.state()['watches'][0]['selected_put'],'NSE_FO|456')
  self.assertIsNotNone(s.state()['watches'][0]['latest'])
  s.action({'action':'watch','position':self.pos,'selectedPut':'NSE_FO|789'})
  self.assertIsNone(s.state()['watches'][0]['latest'])
  self.assertEqual(len(s.state()['alerts']),1)
 def test_selected_put_requires_matching_api(self):
  s.action({'action':'watch','position':self.pos,'selectedPut':'NSE_FO|456'})
  response=MagicMock();response.__enter__.return_value=response
  response.read.return_value=json.dumps({'advice':{'version':'daily-hedge-v2','status':'Monitor'}}).encode()
  opener=MagicMock();opener.open.return_value=response
  with patch.object(s.urllib.request,'build_opener',return_value=opener),patch.object(s.time,'sleep'):s.cycle()
  self.assertIn('preferredPut=NSE_FO%7C456',opener.open.call_args.args[0].full_url)
  self.assertIn('Data unavailable',s.state()['alerts'][0]['title'])
 def test_validation(self):
  for key,value in [('contract','https://evil.test'),('lots',1.5),('entry',float('nan')),('expiryDate','2020-01-01')]:
   with self.assertRaises(ValueError):s.validate({'position':{**self.pos,key:value}})
 def test_failure_dedup_and_recovery(self):
  ident=s.action({'action':'watch','position':self.pos})['id']
  for status in ['Data unavailable','Data unavailable','Monitor']:s.record(ident,{'advice':{'status':status}})
  self.assertEqual(len(s.state()['alerts']),2)
  with s.db() as c:self.assertEqual(c.execute('SELECT count(*) FROM evidence').fetchone()[0],3)
 def test_worker_reads_only_market_endpoint(self):
  s.action({'action':'watch','position':self.pos})
  response=MagicMock();response.__enter__.return_value=response
  response.read.return_value=json.dumps({'advice':{'version':'daily-hedge-v2','status':'Monitor'}}).encode()
  opener=MagicMock();opener.open.return_value=response
  with patch.object(s.urllib.request,'build_opener',return_value=opener),patch.object(s.time,'sleep'):
   s.cycle()
  req=opener.open.call_args.args[0]
  self.assertEqual(req.get_method(),'GET')
  self.assertEqual(s.urllib.parse.urlsplit(req.full_url).path,'/api/protection')
  self.assertEqual(len(s.state()['alerts']),1)
 def test_worker_bad_data_is_not_monitor(self):
  s.action({'action':'watch','position':self.pos})
  opener=MagicMock();opener.open.side_effect=ValueError('failed')
  with patch.object(s.urllib.request,'build_opener',return_value=opener),patch.object(s.time,'sleep'):
   s.cycle()
  self.assertIn('Data unavailable',s.state()['alerts'][0]['title'])
if __name__=='__main__':unittest.main()
