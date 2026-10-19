import { NextResponse } from 'next/server';
import { ensureInstrumentMap, futuresChain, putChain, keyFor, masterAgeMs, companyNameFor } from '@/app/lib/instrumentMaster';
import { getBatchQuotes, getDailyCandles, getHourlyCandles } from '@/app/lib/upstox';
import { loadUniverse } from '@/app/lib/dataset';
import { recommendTarget, buildProtection, quoteState, resolveEntry, simpleRecommendation, VERSION } from '@/app/lib/protection.mjs';
import {companyNews, sectorBreadth} from '@/app/lib/hedgeContext.mjs';
import { hedgeAdvice } from '@/app/lib/hedgeAdvice.mjs';
import { filingsFor, snapshotMeta } from '@/app/lib/promoter';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const quoteView = q => ({ ...quoteState(q), last: Number(q?.last_price) || null });

export async function GET(request) {
  const s = new URL(request.url).searchParams;
  const symbol = (s.get('symbol') || 'HINDUNILVR').trim().toUpperCase();
  if (!/^[A-Z0-9&-]{1,30}$/.test(symbol)) return reply({ error: 'Choose a valid NSE symbol.' }, 400);
  try {
    await ensureInstrumentMap();
    if (masterAgeMs() > 12 * 3600000) return reply({ error: 'Current instrument master unavailable. Contract guesses are disabled.' }, 503);
    const contracts = futuresChain(symbol).filter(c => c.expiryDate >= today());
    const allPuts = putChain(symbol).filter(p => p.expiryDate >= today()).sort((a,b) => a.expiryDate.localeCompare(b.expiryDate) || a.strike-b.strike);
    // Metadata remains available when quotes fail. No invented price or default lot size.
    if (!s.has('entry')) {
      let quotes = {}, quoteError = null;
      try { if (contracts.length) quotes = await getBatchQuotes(contracts.map(c => c.instrumentKey)); }
      catch { quoteError = 'Upstox quotes unavailable. Listed contracts are shown without prices.'; }
      return reply({ symbol, simpleAvailable: true, asOf: new Date().toISOString(), contracts: contracts.map(c => ({ ...c, quote: quoteView(quotes[c.instrumentKey]) })), putContracts: allPuts, putExpiries: [...new Set(allPuts.map(p => p.expiryDate))], quoteError });
    }
    const contract = contracts.find(c => c.instrumentKey === s.get('contract'));
    const simple = s.get('simple') === '1';
    const lots = Number(s.get('lots')), capital = simple ? 2000000 : Number(s.get('capital')), costs = simple ? 0 : Number(s.get('costs'));
    const entrySource = !simple && s.get('entrySource') === 'market' ? 'market' : 'existing';
    const originalEntry = Number(s.get('entry'));
    if (!contract || !Number.isInteger(lots) || lots < 1 || lots > 100 || !(capital > 0 && capital <= 1e10) || !Number.isFinite(costs) || costs < 0 || costs > 1e8 || (entrySource === 'existing' && !(originalEntry > 0 && originalEntry < 1e7))) return reply({ error: 'Select a listed contract and valid entry, whole lots, capital and cost allowance.' }, 400);
    const putExpiry = simple ? contract.expiryDate : s.get('putExpiry') || contract.expiryDate;
    const manualPut = !simple && s.get('putContract') ? allPuts.find(p => p.instrumentKey === s.get('putContract') && p.expiryDate === putExpiry) : null;
    if ((!simple && s.get('putContract') && !manualPut) || !allPuts.some(p => p.expiryDate === putExpiry)) return reply({ error: 'Select a listed PE expiry and contract for this stock.' }, 400);
    const qty = lots * contract.lotSize;
    const options = allPuts.filter(p => p.expiryDate === putExpiry);
    const spotKey = keyFor(symbol);
    const universe=loadUniverse(), sectorName=universe.sectors[symbol];
    const peers=universe.symbols.filter(x=>x!==symbol&&sectorName&&universe.sectors[x]===sectorName).sort().slice(0,6);
    const contextPromise=Promise.all([companyNews(companyNameFor(symbol)),Promise.all(peers.map(async peer=>{try{return {symbol:peer,candles:await getDailyCandles(keyFor(peer),100)};}catch{return {symbol:peer,candles:[]};}}))]);
    const [base, history, market, oi] = await Promise.allSettled([getBatchQuotes([spotKey, contract.instrumentKey]), getDailyCandles(spotKey, 400), getDailyCandles("NSE_INDEX|Nifty 50", 120), getHourlyCandles(contract.instrumentKey, {days:14})]);
    if (base.status !== 'fulfilled') throw Error('QUOTES_UNAVAILABLE');
    const candles = history.status === 'fulfilled' ? history.value : [];
    const spot = Number(base.value[spotKey]?.last_price);
    if (!(spot > 0)) throw Error('PRICE_UNAVAILABLE');
    const fq = base.value[contract.instrumentKey];
    const entryInfo = resolveEntry({ source: entrySource, originalEntry, quote: fq, qty });
    if (!entryInfo.price) return reply({ error: 'Selected futures contract has no usable Upstox ask or last price. Refresh, or enter the actual fill price for an existing position.' }, 503);
    const sample = manualPut ? [manualPut] : options.filter(p => p.strike >= spot*.85 && p.strike <= spot*1.05).sort((a,b) => Math.abs(a.strike-spot)-Math.abs(b.strike-spot)).slice(0,40);
    const quotes = sample.length ? await getBatchQuotes(sample.map(p => p.instrumentKey)) : {};
    const target = recommendTarget({ points: loadUniverse().series[symbol]?.points || [], candles, spot, expiryDate: contract.expiryDate, today: today(), mode: s.get('mode') === 'rebound' ? 'rebound' : 'seasonal' });
    const position = { symbol, contractKey: contract.instrumentKey, entry: entryInfo.price, entrySource, entryBasis: entryInfo.basis, entryIssues: entryInfo.issues, lots, qty, capital, costs, expiryDate: contract.expiryDate, contract: contract.tradingSymbol, lotSize: contract.lotSize };
    const matchedExpiry = putExpiry === contract.expiryDate;
    const result = buildProtection({ position, options: sample, quotes, target });
    if (entrySource === 'market' && entryInfo.issues.length) {
      result.choices = [];
      result.comparisons = result.comparisons.map(p => ({ ...p, eligible: false, label: `Indicative · ${p.label.replace(/^Indicative · /,'')}`, issues: [...p.issues, ...entryInfo.issues.map(i=>`Futures: ${i}`)] }));
    }
    const selectedPut = manualPut ? { ...manualPut, quote: quoteView(quotes[manualPut.instrumentKey]), quantityMatched: qty % manualPut.lotSize === 0 } : null;
    const warning = !matchedExpiry ? 'Expiry mismatch: there is no single combined terminal payoff or guaranteed loss floor. An earlier put leaves later futures exposure unprotected; a later put retains unknown time value when the future expires. Choose matching expiries for the combined graph.' : selectedPut && !selectedPut.quantityMatched ? 'Lot sizes do not match the futures share quantity. No whole-lot combined protection is calculated.' : null;
    if (warning) result.note = warning;
    const evidence = [target.weak ? 'Stock below its completed-day SMA20: weakness warrants reviewing protection.' : 'Trend evidence does not establish safety without protection.', 'OI and headline evidence are contextual, not calibrated directional probabilities.'];
    const [news,peerRows]=await contextPromise;
    const sector={name:sectorName||null,...sectorBreadth(peerRows,today())};
    const advice = hedgeAdvice({candles, market:market.status==='fulfilled'?market.value:[], futures:oi.status==='fulfilled'?oi.value:[], today:today(), expiryDate:contract.expiryDate});
    advice.news=news;advice.sector=sector;
    advice.missing=advice.missing.filter(x=>!x.startsWith('Live news'));
    if(news.status!=='available')advice.missing.push('Live company news unavailable.');
    if(sector.status!=='available')advice.missing.push('Sector peer breadth unavailable.');
    const eventReview=news.items.some(x=>x.eventReview&&Date.now()-Date.parse(x.publishedAt)<2*86400000);
    if(advice.support&&sector.weak&&candles.filter(x=>x.date<today()).at(-1)?.close<advice.support){advice.status='Protection warranted';advice.reasons.push('Completed support break confirmed by weak sampled sector breadth.');}
    if(eventReview){advice.reasons.push('Recent company headline contains an event-risk term. Read the source; headline tags do not establish bearish news.');if(advice.status==='Monitor')advice.status='Review event risk';}
    if(sector.weak||eventReview)advice.exit='Review active sector/event risk before removing an existing hedge. A headline tag is not a direction forecast.';
    advice.version='daily-hedge-v2';
    advice.filings = {asOf:snapshotMeta().generatedAt, items:(filingsFor(symbol)?.announcements||[]).filter(a=>a.date<=today()&&Date.parse(today())-Date.parse(a.date)<=30*86400000).slice(0,5).map(a=>({date:a.date,text:String(a.text||a.category||'Announcement').slice(0,500)}))};
    const fmark = Number(fq?.last_price) || null;
    return reply({ advice, version: VERSION, simple: simple ? {recommendation: simpleRecommendation(result.candidates, spot), feesIncluded:false, method:'Nearest-to-spot listed put with a valid two-sided quote; fresh, sufficiently deep quotes preferred. Same underlying, expiry and share quantity. Not a guaranteed best-return strike.'} : null, asOf: new Date().toISOString(), position, spot, spotQuote: quoteView(base.value[spotKey]), futuresMark: fmark, futuresQuote: quoteView(fq), futuresOi: Number(fq?.oi) || null, selectedPut, putExpiry, matchedExpiry, mismatchWarning: warning, target, ...result, evidence, coverage: { sampled: sample.length, available: options.length, range: manualPut ? 'Your selected listed PE contract' : '85–105% of spot; nearest 40 listed strikes' }, stress: { unhedged10pct: qty*(spot*.9-position.entry)-costs, grossMtm10pct: fmark ? qty*fmark*.1 : null }, warnings: ['Payoffs are at matched expiry, not a pre-expiry liquidation estimate.', 'Cost allowance is user-specified, not verified brokerage/taxes. Margin and delivery obligations are unverified.', 'Actual put fills are device-local. Only explicitly saved futures watches receive background inbox updates; no orders or automatic hedges.', 'Targets use spot history; futures basis converges only at matched expiry. Seasonal returns are not a probability forecast.'] });
  } catch { return reply({ error: 'Market data unavailable. Check the configured Upstox analytics connection and retry; no synthetic quotes were substituted.' }, 503); }
}
