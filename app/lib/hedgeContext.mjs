import { XMLParser } from 'fast-xml-parser';
const parser=new XMLParser({ignoreAttributes:false,processEntities:false});
const plain=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').slice(0,400);
export function parseHeadlines(xml,company,now=Date.now()){
 if(xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Invalid feed');
 const channel=parser.parse(xml)?.rss?.channel;if(!channel)throw Error('Invalid RSS');
 const items=Array.isArray(channel.item)?channel.item:channel.item?[channel.item]:[];
 const needle=company.toLowerCase().replace(/\b(limited|ltd|ltd\.)\b/g,'').replace(/[^a-z0-9]/g,'');
 const seen=new Set();return items.map(i=>{
 const title=plain(i.title),publishedAt=new Date(i.pubDate).getTime(),url=String(i.link||'');
 let safe=false;try{const u=new URL(url);safe=u.protocol==='https:'&&u.hostname==='news.google.com';}catch{}
 if(!safe||!Number.isFinite(publishedAt)||publishedAt>now+300000||now-publishedAt>7*86400000||needle.length<4||!title.toLowerCase().replace(/[^a-z0-9]/g,'').includes(needle)||seen.has(url))return null;
 seen.add(url);return {title,url,publishedAt:new Date(publishedAt).toISOString(),source:plain(i.source?.['#text']||i.source||'Publisher'),eventReview:/\b(results?|earnings|profit warning|investigation|fraud|default|downgrade|recall|lawsuit|penalty|resigns?|resignation)\b/i.test(title)};
 }).filter(Boolean).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,8);
}
const cache=new Map();
export async function companyNews(company){
 if(!company)return {status:'unavailable',reason:'Company identity missing',items:[]};
 const cached=cache.get(company);if(cached&&Date.now()-cached.fetched<300000)return cached.value;
 try{
 const url=new URL('https://news.google.com/rss/search');url.search=new URLSearchParams({q:`"${company.replace(/\b(limited|ltd)\.?$/i,'').trim()}" when:7d`,hl:'en-IN',gl:'IN',ceid:'IN:en'}).toString();
 const res=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});if(!res.ok)throw Error('Feed unavailable');
 const xml=await res.text(),items=parseHeadlines(xml,company);const value={status:'available',checkedAt:new Date().toISOString(),items,reason:'Source-linked headlines via Google News; not verified full articles, exhaustive coverage or a directional sentiment score. Event tags require human review.'};
 if(cache.size>250)cache.clear();cache.set(company,{fetched:Date.now(),value});return value;
 }catch{return {status:'unavailable',checkedAt:new Date().toISOString(),items:[],reason:'News feed unavailable; do not infer absence of adverse news.'};}
}
export function sectorBreadth(rows,today){
 const observations=rows.map(({symbol,candles})=>{const d=candles.filter(c=>c.date<today&&Number.isFinite(c.close)&&c.close>0).sort((a,b)=>a.date.localeCompare(b.date));if(d.length<50||Date.parse(today)-Date.parse(d.at(-1).date)>4*86400000)return null;const avg=n=>d.slice(-n).reduce((s,c)=>s+c.close,0)/n;return {symbol,asOf:d.at(-1).date,weak:d.at(-1).close<avg(20)&&d.at(-1).close<avg(50)};}).filter(Boolean);
 const dates=[...new Set(observations.map(x=>x.asOf))].sort(),asOf=dates.at(-1);const aligned=observations.filter(x=>x.asOf===asOf);
 return {status:aligned.length>=3?'available':'unavailable',asOf,observations:aligned,weak:aligned.length>=3&&aligned.filter(x=>x.weak).length/aligned.length>=2/3,coverage:`${aligned.length}/${rows.length} sampled peers with aligned completed-day history; alphabetical sample, not the full sector or an official index.`};
}
