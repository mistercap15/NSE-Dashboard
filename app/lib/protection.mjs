// Shared server calculation: pure, deterministic, no order/account endpoints.
export const VERSION = 'protection-2';
const med = a => { const s=[...a].sort((a,b)=>a-b); return s.length ? (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2 : null; };
export function recommendTarget({points=[],candles=[],spot,expiryDate,today,mode="seasonal"}) {
  const [year,month]=expiryDate.split('-').map(Number);
  const history=points.filter(p=>p.month===month && p.year<year && p.ym<today.slice(0,7) && Number.isFinite(p.ret));
  const returns=history.map(p=>p.ret); const median=med(returns);
  const daily=candles.filter(c=>c.date<today && Number.isFinite(c.close) && c.high>=c.close).sort((a,b)=>a.date.localeCompare(b.date));
  const last=daily.at(-1); const age=last?(Date.parse(today)-Date.parse(last.date))/86400000:Infinity;
  const horizon=Math.ceil((Date.parse(expiryDate)-Date.parse(today))/86400000);
  const missing=[];
  if(!(spot>0)) missing.push('spot price missing');
  if(mode==='seasonal' && returns.length<5) missing.push('fewer than five seasonal years');
  if(mode==='seasonal' && !(median>0)) missing.push('historical median is not positive');
  if(daily.length<60) missing.push('fewer than 60 daily bars');
  if(age>7) missing.push('daily history is stale');
  if(horizon<=0||horizon>40||expiryDate.slice(0,7)!==today.slice(0,7)) missing.push('target model supports only remaining days of the current calendar month');
  if(missing.length) return {price:null,reason:'Target unavailable: '+missing.join('; ')+'. No bullish target fabricated.',samples:returns.length,median,asOf:last?.date||null};
  const remaining=Math.min(1,horizon/30);
  const seasonal=spot*(1+Math.min(median,30)*remaining/100);
  const sma50=daily.slice(-50).reduce((s,c)=>s+c.close,0)/50;
  const resistance=Math.max(...daily.slice(-60).map(c=>c.high));
  const reference=mode==='rebound'?sma50:seasonal;
  if(!(reference>spot)) return {price:null,samples:returns.length,reason:'No upside target: the 50-session mean is not above the current price.',asOf:last.date};
  const price=resistance>spot*1.005?Math.min(reference,resistance):reference;
  const sma20=daily.slice(-20).reduce((s,c)=>s+c.close,0)/20;
  return {price, samples:returns.length, median, winRate:100*returns.filter(x=>x>0).length/returns.length, asOf:last.date, horizon, resistance, sma20, weak:spot<sma20, reason:mode==='rebound'?'Rebound scenario: prior 50-session average, capped at overhead 60-session high. Not a forecast that the mean will be reached before expiry.': 'Historical expiry-month median, scaled by remaining calendar days / 30, capped at the prior 60-session high when overhead. Transparent heuristic; not a calibrated forecast or probability. Latest incomplete daily candle excluded.'};
}
export function quoteState(q={},now=Date.now()) {
  const raw=q.timestamp; const t=Number(raw)||Date.parse(raw); const age=now-t;
  const bid=Number(q.depth?.buy?.[0]?.price)||0, ask=Number(q.depth?.sell?.[0]?.price)||0;
  return {bid,ask,askQty:Number(q.depth?.sell?.[0]?.quantity)||0,at:Number.isFinite(t)?new Date(t).toISOString():null,fresh:Number.isFinite(age)&&age>=-5000&&age<=120000,spread:ask>0?(ask-bid)/ask:null};
}
export function payoff(price,{entry,qty,costs},put=null) {return qty*(price-entry+(put?Math.max(put.strike-price,0)-put.premium:0))-costs;}
export function buildProtection({position,options,quotes,target,now=Date.now()}) {
  const {entry,qty,costs,capital,expiryDate}=position;
  const candidates=options.filter(o=>o.expiryDate===expiryDate&&o.lotSize>0&&qty%o.lotSize===0).map(o=>{
    const q=quoteState(quotes[o.instrumentKey],now); const premium=q.ask;
    const issues=[];
    const ist=new Date(now+19800000); const minute=ist.getUTCHours()*60+ist.getUTCMinutes();
    if(ist.getUTCDay()===0||ist.getUTCDay()===6||minute<555||minute>=930) issues.push('Outside regular NSE session');
    if(!q.fresh) issues.push('Stale or missing quote time');
    if(!(q.bid>0&&premium>0&&premium>=q.bid)) issues.push('Missing or crossed bid/ask');
    if(q.spread>0.1) issues.push('Spread exceeds 10%');
    if(q.askQty<qty) issues.push('Displayed ask quantity does not cover position');
    if(!(premium>0)) return null;
    const put={...o,premium,quote:q,optionLots:qty/o.lotSize};
    const maxLoss=Math.max(0,qty*(entry-o.strike+premium)+costs);
    const reward=target.price?payoff(target.price,position,put):null;
    return {...put,issues,eligible:issues.length===0,premiumTotal:premium*qty,maxLoss,lossPct:100*maxLoss/capital,breakEven:entry+premium+costs/qty>=o.strike?entry+premium+costs/qty:null,reward,ratio:reward!=null&&maxLoss>0?reward/maxLoss:null};
  }).filter(Boolean);
  const valid=candidates.filter(c=>c.eligible);
  const illustrative=candidates.filter(c=>c.quote.bid>0 && c.premium>=c.quote.bid);
  const pool=valid.length?valid:illustrative;
  const ranked=[...pool].sort((a,b)=>a.maxLoss-b.maxLoss);
  const strong=ranked[0];
  const balanced=[...pool].filter(c=>c.reward>0).sort((a,b)=>(b.ratio??-1)-(a.ratio??-1))[0];
  const cheap=[...pool].sort((a,b)=>a.premiumTotal-b.premiumTotal)[0];
  const selected=[];
  for(const [label,p] of [['Strong protection',strong],['Balanced reward / risk',balanced],['Lower premium',cheap]]) if(p&&!selected.some(s=>s.instrumentKey===p.instrumentKey)) selected.push({...p,label});
  return {choices:valid.length?selected:[],comparisons:selected.map(p=>({...p,label:valid.length?p.label:`Indicative · ${p.label}`})),candidates,unhedgedTarget:target.price?payoff(target.price,position):null,unhedgedZero:payoff(0,position),note:!valid.length?'No executable protection suggestion: refresh during market hours or reduce quantity. Indicative quotes below are not recommendations.':'Choices compare only the inspected same-expiry strikes. No claim of portfolio affordability.'};
}

export function resolveEntry({source,originalEntry,quote,qty,now=Date.now()}) {
  if(source!=='market') return {price:originalEntry>0?originalEntry:null,basis:'Your actual existing futures fill',issues:[]};
  const q=quoteState(quote,now); const last=Number(quote?.last_price)||0;
  const price=q.ask>0?q.ask:last>0?last:null;
  const issues=[];
  if(!q.ask) issues.push('Ask unavailable; last trade used only as an indicative scenario');
  if(!q.fresh) issues.push('Stale or missing quote timestamp');
  if(q.askQty<qty) issues.push('Displayed futures ask depth does not cover your quantity');
  if(q.bid>q.ask && q.ask>0) issues.push('Crossed futures quote');
  const ist=new Date(now+19800000),minute=ist.getUTCHours()*60+ist.getUTCMinutes();
  if([0,6].includes(ist.getUTCDay())||minute<555||minute>=930) issues.push('Outside regular NSE session');
  return {price,basis:q.ask>0?'Upstox best ask snapshot':'Upstox last trade — indicative only',issues};
}

// Simple planner: no account sizing or hidden fee allowance. Prefer a liquid,
// two-sided quote nearest to spot; never recommend a distant cheap put as full protection.
export function simpleRecommendation(candidates,spot) {
  const quoted=candidates.filter(p=>Math.abs(p.strike-spot)/spot<=0.05&&p.premium>0&&p.quote.bid>0&&p.premium>=p.quote.bid);
  const executable=quoted.filter(p=>p.eligible);
  const pool=executable.length?executable:quoted;
  return [...pool].sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot)||a.premium-b.premium)[0]||null;
}
