import {NextResponse} from 'next/server';
import {ensureInstrumentMap,futuresChain,putChain,keyFor,masterAgeMs} from '@/app/lib/instrumentMaster';
import {getBatchQuotes,getDailyCandles} from '@/app/lib/upstox';
import {loadUniverse} from '@/app/lib/dataset';
import {recommendTarget,buildProtection,quoteState,VERSION} from '@/app/lib/protection.mjs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const today=()=>new Date(Date.now()+19800000).toISOString().slice(0,10);
export async function GET(request) {
  const s=new URL(request.url).searchParams; const symbol=(s.get('symbol')||'HINDUNILVR').trim().toUpperCase();
  if(!/^[A-Z0-9&-]{1,30}$/.test(symbol)) return NextResponse.json({error:'Choose a valid NSE symbol.'},{status:400});
  try {
    await ensureInstrumentMap();
    if(masterAgeMs()>12*3600000) return NextResponse.json({error:'Current instrument master unavailable. Contract guesses are disabled.'},{status:503});
    const contracts=futuresChain(symbol).filter(c=>c.expiryDate>=today());
    if(!s.has('entry')) return NextResponse.json({contracts,symbol});
    const contract=contracts.find(c=>c.instrumentKey===s.get('contract'));
    const entry=Number(s.get('entry')),lots=Number(s.get('lots')),capital=Number(s.get('capital')),costs=Number(s.get('costs'));
    if(!contract || !(entry>0&&entry<1e7) || !Number.isInteger(lots)||lots<1||lots>100 || !(capital>0&&capital<=1e10)||!Number.isFinite(costs)||costs<0||costs>1e8) return NextResponse.json({error:'Select a listed contract and valid entry, whole lots, capital and cost allowance.'},{status:400});
    const qty=lots*contract.lotSize;
    const options=putChain(symbol).filter(p=>p.expiryDate===contract.expiryDate&&p.lotSize===contract.lotSize);
    const spotKey=keyFor(symbol);
    const [base,candles]=await Promise.all([getBatchQuotes([spotKey,contract.instrumentKey]),getDailyCandles(spotKey,400)]);
    const spot=Number(base[spotKey]?.last_price); if(!(spot>0)) throw new Error('PRICE_UNAVAILABLE');
    // Bounded quote batch; show the sampled strike range rather than claiming global optimization.
    const sample=options.filter(p=>p.strike>=spot*0.85&&p.strike<=spot*1.05).sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot)).slice(0,40);
    const quotes=sample.length?await getBatchQuotes(sample.map(p=>p.instrumentKey)):{};
    const universe=loadUniverse();
    const target=recommendTarget({points:universe.series[symbol]?.points||[],candles,spot,expiryDate:contract.expiryDate,today:today(),mode:s.get('mode')==='rebound'?'rebound':'seasonal'});
    const position={symbol,entry,lots,qty,capital,costs,expiryDate:contract.expiryDate,contract:contract.tradingSymbol,lotSize:contract.lotSize};
    const result=buildProtection({position,options:sample,quotes,target});
    const fq=base[contract.instrumentKey]; const fmark=Number(fq?.last_price)||null;
    const evidence=[target.weak?'Stock below its completed-day SMA20: weakness warrants reviewing protection.':'Trend evidence does not establish safety without protection.', 'OI level alone cannot establish long/short sentiment. Historical OI changes and verified news feed are not connected; no timing recommendation is fabricated.'];
    return NextResponse.json({version:VERSION,asOf:new Date().toISOString(),position,spot,futuresMark:fmark,futuresQuote:quoteState(fq),futuresOi:Number(fq?.oi)||null,target,...result,evidence,coverage:{sampled:sample.length,available:options.length,range:'85–105% of spot; nearest 40 listed strikes'},stress:{unhedged10pct:qty*(spot*0.9-entry)-costs,grossMtm10pct:fmark?qty*fmark*0.1:null},warnings:['Payoffs are at matched expiry, not a pre-expiry liquidation estimate.','Cost allowance is user-specified, not verified brokerage/taxes. Margin and delivery obligations are unverified.','Saved plans are local to this device; no orders, automatic hedge or background alerts.','Targets use spot history; futures basis converges only at matched expiry. Seasonal returns are not a probability forecast.']});
  } catch { return NextResponse.json({error:'Market data unavailable. Check the configured Upstox analytics connection and retry; no synthetic quotes were substituted.'},{status:503}); }
}
