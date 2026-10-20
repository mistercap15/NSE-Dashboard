'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowRight,ShieldCheck,Layers,Loader2,Check} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import ActionCard from './ActionCard';
import LoadingCard from './LoadingCard';
const money=n=>n==null?'—':Number(n).toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2});
const month=d=>new Date(d+'T12:00:00').toLocaleDateString('en-IN',{month:'short',year:'numeric'});
const input='mt-2 h-12 w-full rounded-xl border border-border bg-bg px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent/40';
export default function Protection(){
 const router=useRouter();
 const [symbol,setSymbol]=useState('HINDUNILVR'),[symbols,setSymbols]=useState([]),[contracts,setContracts]=useState([]),[contract,setContract]=useState(''),[lots,setLots]=useState(''),[entry,setEntry]=useState('');
 const [data,setData]=useState(null),[selected,setSelected]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 useEffect(()=>{fetch('/api/universe').then(r=>r.json()).then(d=>setSymbols(d.symbols||[])).catch(()=>{});},[]);
 useEffect(()=>{
  const c=new AbortController();setLoading(true);setContract('');setContracts([]);setData(null);setError('');
  fetch('/api/protection?'+new URLSearchParams({symbol}),{signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);setContracts(d.contracts||[]);setContract(d.contracts?.[0]?.instrumentKey||'');if(!d.contracts?.length)setError('No listed futures for this stock.');}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();
 },[symbol]);
 const valid=!!contract&&Number.isInteger(Number(lots))&&Number(lots)>=1&&Number(lots)<=100&&Number(entry)>0;
 useEffect(()=>{
  setData(null);setSelected('');if(!valid){setBusy(false);return;}
  const c=new AbortController();setBusy(true);setError('');
  const t=setTimeout(()=>{fetch('/api/protection?'+new URLSearchParams({symbol,contract,lots,entry,simple:'1'}),{signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(!d.summary)throw Error('The new planner API is awaiting deployment.');setData(d);setSelected(d.simple?.recommendation?.instrumentKey||'');}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});},800);
  return()=>{clearTimeout(t);c.abort();};
 },[symbol,contract,lots,entry,valid]);
 const change=(setter,value)=>{setter(value);setData(null);setError('');};
 const put=data?.candidates?.find(p=>p.instrumentKey===selected)||null;
 const choices=(data?.candidates||[]).filter(p=>p.quote.bid>0&&p.premium>=p.quote.bid).sort((a,b)=>Math.abs(a.strike-data.spot)-Math.abs(b.strike-data.spot));
 async function save(){if(!data||saving)return;setSaving(true);setError('');try{
  const p=data.position;const r=await fetch('/api/protection/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'watch',selectedPut:selected||null,position:{symbol:p.symbol,contract:p.contractKey,entry:p.entry,lots:p.lots,expiryDate:p.expiryDate}})});const d=await r.json();if(!r.ok)throw Error(d.error);router.push('/protection/tracked/'+encodeURIComponent(d.id));
 }catch(e){setError(e.message);setSaving(false);}}
 return <div className="min-h-screen"><Sidebar/><main className="md:ml-[200px] px-5 pt-20 pb-14 md:p-9"><div className="max-w-5xl mx-auto">
 <div className="flex justify-between gap-4 items-center"><span className="flex gap-2 items-center text-xs uppercase tracking-widest text-accent font-semibold"><ShieldCheck size={18}/>Position protection</span><Link href="/protection/tracked" className="flex items-center gap-2 text-sm text-soft hover:text-text"><Layers size={17}/>View tracked stocks <ArrowRight size={16}/></Link></div>
 <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-7">Add your position.</h1><p className="mt-3 text-soft">Four details. A put plan. One clear next step.</p>
 <div className="grid lg:grid-cols-[1.15fr_1fr] gap-6 mt-8"><section className="rounded-2xl border border-border bg-card p-6"><p className="text-xs uppercase tracking-widest text-dim">01 · Your futures trade</p><div className="grid sm:grid-cols-2 gap-5 mt-5">
 <label className="text-sm text-soft">Stock<select disabled={saving} className={input} value={symbol} onChange={e=>change(setSymbol,e.target.value)}>{(symbols.length?symbols:[{symbol}]).map(s=><option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}</select></label>
 <label className="text-sm text-soft">Expiry<select disabled={saving||loading} className={input} value={contract} onChange={e=>change(setContract,e.target.value)}>{!contracts.length&&<option>{loading?'Loading…':'Select expiry'}</option>}{contracts.map(c=><option key={c.instrumentKey} value={c.instrumentKey}>{month(c.expiryDate)} · {c.expiryDate.slice(8)}</option>)}</select></label>
 <label className="text-sm text-soft">Lots<input disabled={saving} className={input} type="number" min="1" max="100" step="1" placeholder="e.g. 5" value={lots} onChange={e=>change(setLots,e.target.value)}/></label>
 <label className="text-sm text-soft">Buying price ₹<input disabled={saving} className={input} type="number" min="0.01" step="0.05" placeholder="Your actual fill" value={entry} onChange={e=>change(setEntry,e.target.value)}/></label></div>
 <div className="mt-7 border-t border-border pt-5"><p className="text-xs uppercase tracking-widest text-dim">02 · Suggested put</p>{busy?<p role="status" className="flex items-center gap-2 text-soft py-5"><Loader2 className="motion-safe:animate-spin" size={17}/>Checking your position…</p>:data?<><select aria-label="Selected PE" disabled={saving||!choices.length} className={input} value={selected} onChange={e=>setSelected(e.target.value)}>{!selected&&<option value="">No usable put quote</option>}{choices.map(p=><option key={p.instrumentKey} value={p.instrumentKey}>{p.strike} PE · {money(p.premium)} per share</option>)}</select><p className="text-xs text-soft mt-3">{put?`${put.optionLots} lots · ${put.expiryDate} · ${money(put.premiumTotal)} total premium`:'You can still track risk while put quotes are unavailable.'}</p><p className="text-xs text-dim mt-2">{put?.eligible?'Selected for planning; not a purchased hedge.':'Indicative quotes only. Refresh executable prices before buying.'}</p></>:<p className="text-sm text-dim py-5">Complete your trade details. We’ll preselect a matching PE automatically.</p>}</div>
 {error&&<p role="alert" className="text-red text-sm my-4">{error}</p>}<button disabled={!data||busy||saving} onClick={save} className="mt-6 w-full rounded-xl bg-accent text-white font-semibold py-4 flex justify-center items-center gap-2 disabled:opacity-40">{saving?<Loader2 className="motion-safe:animate-spin" size={18}/>:<Check size={18}/>} {saving?'Adding…':'Add to track'}</button><p className="text-[11px] text-dim text-center mt-3">Tracks the position and chosen PE. Does not place an order.</p></section>
 <div>{busy?<LoadingCard/>:data?<ActionCard summary={data.summary}/>:<div className="rounded-2xl border border-dashed border-border p-8 text-soft"><ShieldCheck size={32} className="text-accent mb-5"/><h2 className="font-semibold text-text text-xl">Know your next move</h2><p className="text-sm mt-3 leading-relaxed">Your tracked stock will show whether to wait, prepare protection or review a put—without a wall of text.</p></div>}<p className="text-xs text-dim mt-4 leading-relaxed">Advisory rules, not guaranteed outcomes. Detailed evidence and payoff scenarios live on the tracked stock’s page.</p></div></div>
 </div></main></div>;
}
