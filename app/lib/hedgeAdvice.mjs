// Versioned advisory rules, not calibrated probabilities. No execution side effects.
export const HEDGE_RULES = 'daily-hedge-v1';
export function hedgeAdvice({candles=[],market=[],futures=[],today,expiryDate,now=Date.now()}) {
 const clean=rows=>rows.filter(c=>c.date<today&&[c.open,c.high,c.low,c.close].every(x=>Number.isFinite(x)&&x>0)&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close)).sort((a,b)=>a.date.localeCompare(b.date));
 const d=clean(candles),m=clean(market),last=d.at(-1),missing=['Live news and sector sentiment are not connected.'];
 const fresh=rows=>rows.length&&Date.parse(today)-Date.parse(rows.at(-1).date)<=4*86400000;
 if(d.length<51||!fresh(d))return {version:HEDGE_RULES,status:'Insufficient data',reasons:['Need at least 51 valid completed daily candles and a latest session within four calendar days.'],missing,asOf:last?.date||null,exit:'No hedge-exit signal with insufficient data.'};
 const avg=(rows,n,k='close')=>rows.slice(-n).reduce((s,c)=>s+c[k],0)/n;
 const prior=d.slice(0,-1),support=Math.min(...prior.slice(-20).map(c=>c.low)),resistance=Math.max(...prior.slice(-20).map(c=>c.high));
 let atr=d[0].high-d[0].low;d.slice(1).forEach((c,i)=>{const tr=Math.max(c.high-c.low,Math.abs(c.high-d[i].close),Math.abs(c.low-d[i].close));atr=i<13?(atr*(i+1)+tr)/(i+2):(atr*13+tr)/14;});
 const sma20=avg(d,20),sma50=avg(d,50),broken=last.close<support,weak=last.close<sma20&&last.close<sma50;
 const volume=avg(prior,20,'volume'),volumeRatio=volume>0&&last.volume>0?last.volume/volume:null;
 const marketKnown=m.length>=50&&fresh(m),marketWeak=marketKnown&&m.at(-1).close<avg(m,20)&&m.at(-1).close<avg(m,50);
 if(!marketKnown)missing.push('NIFTY trend unavailable or stale.');
 // Compare the last bars of two completed sessions in this exact contract; no roll splice.
 const sessions=new Map();for(const c of [...futures].sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp))))if(c.date<today&&c.close>0&&c.openInterest>0)sessions.set(c.date,c);
 const f=[...sessions.values()],a=f.at(-2),b=f.at(-1);const oiKnown=a&&b&&b.date===last.date&&Date.parse(b.date)-Date.parse(a.date)<=4*86400000;
 const oiChange=oiKnown?100*(b.openInterest/a.openInterest-1):null,priceChange=oiKnown?100*(b.close/a.close-1):null;
 const oiBear=oiKnown&&priceChange<0&&oiChange>=2;
 if(!oiKnown)missing.push('Comparable completed-session OI for this futures contract unavailable.');
 const recovery=last.close>sma20&&last.close>prior.at(-1).high&&last.low>prior.at(-1).low;
 const confirm=(volumeRatio>=1.5)||marketWeak||oiBear;
 const status=broken&&confirm?'Protection warranted':broken||weak||last.close-support<=atr?'Prepare protection':'Monitor';
 const reasons=[`Completed close ${last.close.toFixed(2)}; prior 20-session support ${support.toFixed(2)}.`,broken?'Support broken on a completed daily candle.':weak?'Price below both 20- and 50-day averages.':'No confirmed support breakdown.',marketKnown?`NIFTY: ${marketWeak?'below both 20- and 50-day averages':'no dual-average weakness'}.`:'NIFTY context unknown.',oiKnown?`Same-contract futures: price ${priceChange.toFixed(2)}%, OI ${oiChange.toFixed(2)}%. ${oiBear?'Consistent with short build-up, not proof of trader intent.':'No bearish OI confirmation under this rule.'}`:'OI confirmation unknown.',volumeRatio?`Volume ${volumeRatio.toFixed(2)}× prior 20-session average.`:'Volume confirmation unavailable.'];
 const days=Math.ceil((Date.parse(expiryDate)-Date.parse(today))/86400000);
 return {version:HEDGE_RULES,status,direction:last.close>sma20&&last.close>sma50?'bullish':weak?'bearish':'mixed',reasons,missing,asOf:last.date,support,resistance,sma20,sma50,atr,recovery,oiChange,priceChange,trigger:`Review protection after a daily close below ${support.toFixed(2)}, confirmed by volume ≥1.5×, NIFTY weakness or falling futures price with OI rising ≥2%.`,exit:days<=5?'Expiry within five calendar days: review closing or rolling the hedge and futures together.':recovery&&!marketWeak&&!oiBear&&marketKnown&&oiKnown?'Recovery condition met: review reducing or exiting the hedge; protection is lost on the quantity sold.':'Maintain an existing hedge pending recovery confirmation; profit alone is not an exit trigger.',caveat:'Daily rules are unvalidated heuristics. Monitor does not mean safe. A gap can occur before confirmation. Saved inbox watches poll in the background; unsaved plans refresh on demand.'};
}
