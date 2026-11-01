import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from '@react-navigation/native';
import { router } from 'expo-router';
import { Badge, Card, EmptyState, ErrorState, Label, SectionHeader, StatCard, StatRow } from '@/components/ui';
import { SkeletonCard } from '@/components/Skeleton';
import { GapComparison } from '@/components/GapComparison';
import { GapSessionStatus } from '@/components/GapSessionStatus';
import { request } from '@/lib/client';
import { Radius, Spacing, Type, useColors } from '@/lib/theme';
import { GapRow, PaperAccount, Trade, istTime, money, reasonLabel, stageLabel } from '@/lib/gapPaper';

const today = () => new Date(Date.now()+19800000).toISOString().slice(0,10);
const tabs = ['Scanner','Paper trades','How it works'] as const;
const filters = ['All gap-ups','1–10%','Eligible','Watching'] as const;

function TradeCard({trade, open=false}:{trade:Trade;open?:boolean}) {
  const c=useColors(); const pnl=open ? (Number(trade.mark)-trade.entry)*trade.qty-Object.values(trade.entry_costs || {}).reduce((a,b)=>a+b,0) : trade.pnl;
  return <Card style={{padding:Spacing.md,marginBottom:Spacing.sm}} stripe={(pnl || 0)>=0?c.green:c.red}>
    <View style={{flexDirection:'row',justifyContent:'space-between',gap:8}}><Text style={{color:c.text,fontSize:16,fontWeight:'800'}}>{trade.symbol}</Text><Text style={{color:(pnl || 0)>=0?c.green:c.red,fontWeight:'800',...Type.numeric}}>{money(pnl)}</Text></View>
    <Text style={{color:c.dim,fontSize:11,marginTop:5}}>{trade.qty} shares · {istTime(trade.entry_at)}{open?' · Open position':` → ${istTime(trade.exit_at)}`}</Text>
    <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:12}}>{[['Entry',trade.entry],[open?'Mark':'Exit',open?trade.mark:trade.exit],['Stop',trade.stop]].map(([label,value])=><View key={String(label)}><Label style={{fontSize:9}}>{label}</Label><Text style={{color:c.text,fontSize:12,marginTop:4,...Type.numeric}}>{money(value as number)}</Text></View>)}</View>
    <Text style={{color:c.soft,fontSize:11,marginTop:10}}>{open?`Target ${money(trade.target)} · includes entry charges`:reasonLabel(trade.reason)}</Text>
  </Card>;
}

export default function GapPaperScreen() {
  const c=useColors(); const focused=useIsFocused(); const [tab,setTab]=useState<typeof tabs[number]>('Scanner');
  const [filter,setFilter]=useState<typeof filters[number]>('All gap-ups'); const [search,setSearch]=useState(''); const [day,setDay]=useState(today);
  const [expanded,setExpanded]=useState<string|null>(null);
  const account=useQuery({queryKey:['gap-paper-account',day],queryFn:()=>request<PaperAccount>(`/api/research/gap-paper?day=${day}`),enabled:focused,refetchInterval:focused?15000:false,retry:1});
  const [variant,setVariant]=useState<'v1'|'v2'>('v1');
  const root=account.data;
  const a=variant==='v2'?(root?.variants?.v2?{...root.variants.v2,scanner:root.scanner,preparation:root.preparation}:undefined):root; const scan=a?.scanner; const d=a?.daily;
  const shortlist=a?.session===day && a?.selection?.day===day ? a?.shortlist || [] : [];
  const watched=new Map(shortlist.map(r=>[r.symbol,r.rank]));
  const stale=!!account.error || Number(a?.service?.heartbeat_age_seconds)>30 || (a?.service?.status!=='market_closed' && scan && Date.now()-Date.parse(scan.completed_at)>180000);
  const tint=stale?c.red:a?.service?.entry_halt?c.amber:c.accent;
  const title=stale?'Data needs attention':a?.service?.status==='market_closed'?'Market closed':scan?'Scanning NSE cash equities':'Waiting for the NSE scan';
  const rows=useMemo(()=> (scan?.rows || []).filter(r=>r.gap>0 && (r.symbol+' '+r.name).toLowerCase().includes(search.toLowerCase()) &&
    (filter==='All gap-ups' || filter==='1–10%' && r.gap>=.01 && r.gap<=.1 || filter==='Eligible' && r.eligibility==='eligible' || filter==='Watching' && shortlist.some(s=>s.symbol===r.symbol))),[scan,search,filter,shortlist]);
  const changeDay=(n:number)=>setDay(new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10));
  const top=<View>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8}}><Label>NSE · Gap & first pullback</Label><Badge text="PAPER" color={c.amber} small/></View>
    <Text style={{color:c.text,fontSize:28,fontWeight:'800',letterSpacing:-.8,marginTop:8}}>Find the opening gaps<Text style={{color:c.accent}}>.</Text></Text>
    <Text style={{color:c.soft,fontSize:12,lineHeight:18,marginTop:5}}>Scan the market. Follow the first pullback. Track simulated trades.</Text>
    <View style={{flexDirection:'row',backgroundColor:c.card,borderRadius:Radius.md,padding:4,marginTop:Spacing.lg}}>{tabs.map(t=><Pressable accessibilityRole="tab" accessibilityState={{selected:tab===t}} key={t} onPress={()=>{setTab(t);if(t==='Scanner')setDay(today());}} style={{flex:1,paddingVertical:11,borderRadius:Radius.sm,backgroundColor:tab===t?c.accentBg:'transparent'}}><Text style={{color:tab===t?c.accent:c.dim,textAlign:'center',fontSize:11,fontWeight:'700'}}>{t}</Text></Pressable>)}</View>
    <GapComparison comparison={account.data?.comparison} variant={variant} onSelect={setVariant}/>
    {tab!=='How it works' && <Card tint={tint} stripe={tint} style={{padding:Spacing.md,marginTop:Spacing.md}}>
      <View style={{flexDirection:'row',alignItems:'center',gap:9}}><Ionicons name={stale?'alert-circle-outline':'radio-outline'} size={19} color={tint}/><Text style={{color:c.text,fontSize:15,fontWeight:'800',flex:1}}>{title}</Text></View>
      <Text style={{color:c.dim,fontSize:11,lineHeight:17,marginTop:7}}>{scan?`${scan.quoted.toLocaleString('en-IN')} / ${scan.exchange_listed.toLocaleString('en-IN')} shares quoted · ${istTime(scan.completed_at)}`:'No complete market scan received. This is not a saved stock list.'}</Text>
      {a?.service?.entry_halt && <Text style={{color:c.amber,fontSize:11,lineHeight:17,marginTop:7}}>{a.service.entry_halt_reason || 'New paper entries paused by data checks.'}</Text>}
    </Card>}
    {account.isPending && <View style={{marginTop:14}}><SkeletonCard height={100}/></View>}
    {account.error && <ErrorState message="Could not refresh the paper scanner. Retained results may be stale." onRetry={account.refetch}/>}
    {tab==='Scanner' && <>
      <View style={{marginTop:Spacing.sm}}><StatRow><StatCard label="Gap-ups" value={scan?String(scan.gap_up):'—'} sub="across the scanned market" color={c.green}/><StatCard label="Eligible" value={scan?String(scan.eligible):'—'} sub="1–10% + history + liquidity"/><StatCard label="Watching" value={String(shortlist.length)} sub={`up to 5 ${variant.toUpperCase()} setups`} color={c.accent}/></StatRow></View>
      {a?.preparation && a.preparation.ready<a.preparation.total && <Card style={{padding:Spacing.md,marginTop:Spacing.sm}}><Text style={{color:c.text,fontSize:12,fontWeight:'700'}}>Eligibility checks: {a.preparation.checked.toLocaleString()} / {a.preparation.total.toLocaleString()}</Text><View style={{height:4,backgroundColor:c.border,borderRadius:4,marginTop:9}}><View style={{height:4,borderRadius:4,backgroundColor:c.accent,width:`${Math.min(100,a.preparation.checked/Math.max(1,a.preparation.total)*100)}%`}}/></View><Text style={{color:c.dim,fontSize:11,lineHeight:17,marginTop:7}}>{a.preparation.ready.toLocaleString()} have enough history · {a.preparation.failed} failed checks. {a.preparation.status==='authentication_required'?'Preparation stopped: broker authentication needs attention.':a.preparation.status==='complete'?'Checks complete; incomplete histories remain excluded.':'Prior candles and corporate actions are being checked.'} Unverified stocks cannot become paper entries.</Text></Card>}
      {!!shortlist.length && <><SectionHeader title={`${variant.toUpperCase()} watchlist`} icon="eye-outline"/><View style={{gap:8}}>{shortlist.map(r=><Card key={r.symbol} tint={c.accent} style={{padding:Spacing.md}}><View style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{color:c.text,fontWeight:'800'}}>{r.rank}. {r.symbol}</Text><Text style={{color:c.green,...Type.numeric}}>+{(r.gap*100).toFixed(2)}%</Text></View><Text style={{color:c.soft,fontSize:12,marginTop:6}}>{stageLabel(a?.stocks?.[r.symbol])}</Text>{a?.stocks?.[r.symbol]?.pending && <Text style={{color:c.dim,fontSize:11,marginTop:5}}>Buy above {money(a.stocks[r.symbol].pending?.trigger)} · stop {money(a.stocks[r.symbol].pending?.stop)}</Text>}</Card>)}</View></>}
      <SectionHeader title="Market gap-ups" icon="trending-up-outline" right={<Text style={{color:c.dim,fontSize:11}}>{rows.length} matches</Text>}/>
      <View style={{flexDirection:'row',alignItems:'center',gap:8,borderWidth:1,borderColor:c.border,borderRadius:Radius.md,paddingHorizontal:12,backgroundColor:c.card}}><Ionicons name="search-outline" size={17} color={c.dim}/><TextInput accessibilityLabel="Search gap-up stocks" placeholder="Search symbol or company" placeholderTextColor={c.dim} value={search} onChangeText={setSearch} autoCapitalize="characters" style={{color:c.text,flex:1,paddingVertical:12,fontSize:13}}/></View>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:6,marginVertical:12}}>{filters.map(f=><Pressable accessibilityRole="button" key={f} onPress={()=>setFilter(f)} style={{paddingHorizontal:10,paddingVertical:8,borderRadius:Radius.sm,borderWidth:1,borderColor:filter===f?c.accent:c.border,backgroundColor:filter===f?c.accentBg:c.card}}><Text style={{color:filter===f?c.accent:c.soft,fontSize:10,fontWeight:'700'}}>{f}</Text></Pressable>)}</View>
      <Text style={{color:c.dim,fontSize:10,lineHeight:16,marginBottom:12}}>Opening gap = session open vs previous close. It stays fixed as prices move. Tap a stock for its source and eligibility checks.</Text>
    </>}
    {tab==='Paper trades' && <>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginVertical:Spacing.md}}><Pressable accessibilityLabel="Previous day" onPress={()=>changeDay(-1)} style={{padding:8}}><Ionicons name="chevron-back" size={20} color={c.accent}/></Pressable><Text style={{color:c.text,fontWeight:'700'}}>{day}</Text><Pressable accessibilityLabel="Next day" onPress={()=>changeDay(1)} style={{padding:8}}><Ionicons name="chevron-forward" size={20} color={c.accent}/></Pressable></View>
      <GapSessionStatus diagnostics={a?.session_diagnostics} day={day}/>
      <Card tint={d&&d.net_pnl<0?c.red:c.green} style={{padding:Spacing.lg}}><Label>{variant.toUpperCase()} net paper P&L · {day}</Label><Text style={{color:d&&d.net_pnl<0?c.red:c.green,fontSize:34,fontWeight:'800',letterSpacing:-1,marginTop:8,...Type.numeric}}>{money(d?.net_pnl)}</Text><Text style={{color:c.dim,fontSize:11,marginTop:5}}>{d?`${d.entries} entries · ${d.closed_trades} closed trades · fees included`:'No forward observations recorded for this date.'}</Text></Card>
      <View style={{marginTop:8}}><StatRow><StatCard label="Realized" value={money(d?.realized_pnl)}/><StatCard label="Open P&L change" value={money(d?.unrealized_change)}/></StatRow></View>
      <View style={{marginTop:8}}><StatRow><StatCard label="Current equity" value={money(a?.equity)}/><StatCard label="Fees paid" value={money(d?.fees)}/></StatRow></View>
      <SectionHeader title="Current open positions" icon="briefcase-outline"/>
      {!Object.keys(a?.positions || {}).length ? <EmptyState emoji="◌" title="No open positions" hint="The bot waits for a qualifying first pullback; a gap alone is not a trade."/> : Object.values(a?.positions || {}).map(p=><TradeCard key={p.symbol} trade={p} open/>)}
      <SectionHeader title="Closed trades" icon="checkmark-done-outline"/>
      {!(a?.day_records?.trades || []).length?<EmptyState emoji="—" title="No closed trades this day" hint="Only forward simulated fills appear here."/>:a?.day_records?.trades?.map((t,i)=><TradeCard key={i} trade={t}/>)}
      <SectionHeader title="Signal activity" icon="pulse-outline"/>
      {(a?.day_records?.signals || []).map((s,i)=><Card key={i} style={{padding:Spacing.md,marginBottom:8}}><Text style={{color:c.text,fontWeight:'700'}}>{s.symbol} · {istTime(s.at)}</Text><Text style={{color:c.dim,fontSize:12,marginTop:5}}>Trigger {money(s.trigger)} · stop {money(s.stop)}</Text></Card>)}
      {(a?.day_records?.rejections || []).slice(-20).map((r,i)=><Text key={i} style={{color:c.dim,fontSize:11,lineHeight:18}}>{r.symbol} · {reasonLabel(r.reason)}</Text>)}
      <Text style={{color:c.dim,fontSize:11,lineHeight:17,marginTop:14}}>Daily net P&L includes realized P&L and the change in open P&L. Future exit fees are not yet deducted from open positions.</Text>
    </>}
    {tab==='How it works' && <>
      <SectionHeader title="From market scan to paper trade" icon="git-branch-outline"/>
      {[['01','Scan NSE shares','Read the full NSE equity list and fetch live opening prices from Upstox. Show every positive gap, with missing quotes and excluded instruments accounted for.'],['02','Verify eligibility','Require a 1–10% gap, 20 complete prior sessions, median traded-value proxy of at least ₹10 crore, and valid instrument/corporate-action checks.'],['03','Freeze the top five','After the 09:20 candle closes, rank eligible stocks by gap, then liquidity. These five are monitored; the scanner still shows the rest of the market.'],['04','Wait for the first pullback','After a completed candle closes 0.5% (V1) or 0.25% (V2) above the open by 10:00, require a 2–5-candle first pullback near EMA9 or session VWAP, above the session open.'],['05','Simulate the trade','Buy only on a later ask above the trigger. Risk 0.25% of the paper account, target 2R, no new entry after 11:00, and square off at 15:15.']].map(([n,h,note])=><Card key={n} style={{padding:Spacing.md,marginBottom:8}}><View style={{flexDirection:'row',gap:12}}><Text style={{color:c.accent,fontWeight:'800',fontSize:18,...Type.numeric}}>{n}</Text><View style={{flex:1}}><Text style={{color:c.text,fontWeight:'700',fontSize:14}}>{h}</Text><Text style={{color:c.soft,fontSize:12,lineHeight:18,marginTop:5}}>{note}</Text></View></View></Card>)}
      <Card tint={c.amber} style={{padding:Spacing.md,marginTop:8}}><Text style={{color:c.amber,fontWeight:'700'}}>Simulation, not exchange orders</Text><Text style={{color:c.soft,fontSize:12,lineHeight:18,marginTop:7}}>The service runs independently of this app. Quotes are sampled about every five seconds; touches and full fills are not guaranteed. Spread, assumed slippage and fees are included. Unknown data blocks entries.</Text></Card>
      <Pressable onPress={()=>router.push('/research/gap-paper-history' as never)} style={{paddingVertical:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><View><Text style={{color:c.accent,fontWeight:'700'}}>Historical five-stock pilot</Text><Text style={{color:c.dim,fontSize:11,marginTop:4}}>Separate research — not today’s scanner</Text></View><Ionicons name="chevron-forward" color={c.accent} size={18}/></Pressable>
    </>}
  </View>;
  return <FlatList style={{backgroundColor:c.bg}} contentContainerStyle={{padding:Spacing.md,paddingBottom:Spacing.xxl}} data={tab==='Scanner'?rows:[]} keyExtractor={r=>r.symbol} ListHeaderComponent={top} initialNumToRender={20} windowSize={7}
    refreshControl={<RefreshControl refreshing={account.isRefetching} onRefresh={account.refetch} tintColor={c.accent}/>}
    ListEmptyComponent={tab==='Scanner'&&!account.isPending?<EmptyState emoji="⌕" title={scan?'No stocks match this filter':'Waiting for the full-market scan'} hint={scan?'Try another filter or search.':'Live results will appear after actual quotes are received.'}/>:null}
    ListFooterComponent={tab==='Scanner'?<Text style={{color:c.dim,fontSize:10,lineHeight:16,marginTop:14}}>{scan?.source || 'Source: NSE equity master and authenticated Upstox market data'}{scan?.unavailable.length?` · ${scan.unavailable.length} stocks have unavailable data.`:''}{'\n'}PAPER — NO LIVE ORDERS</Text>:null}
    renderItem={({item:r})=><Pressable accessibilityRole="button" accessibilityState={{expanded:expanded===r.symbol}} onPress={()=>setExpanded(expanded===r.symbol?null:r.symbol)}><Card style={{padding:Spacing.md,marginBottom:Spacing.sm}} stripe={watched.has(r.symbol)?c.accent:undefined}>
      <View style={{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10}}><View style={{flex:1,minWidth:0}}><Text style={{color:c.text,fontSize:15,fontWeight:'800'}}>{r.symbol}</Text><Text numberOfLines={1} style={{color:c.dim,fontSize:10,marginTop:4}}>{r.name}</Text></View><View style={{alignItems:'flex-end'}}><Text style={{color:c.green,fontSize:20,fontWeight:'800',letterSpacing:-.4,...Type.numeric}}>+{(r.gap*100).toFixed(2)}%</Text><Text style={{color:c.dim,fontSize:9}}>opening gap</Text></View></View>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:12,gap:8}}><Text style={{color:c.soft,fontSize:11,...Type.numeric}}>Open {money(r.open)}</Text><Badge text={watched.has(r.symbol)?`WATCHING #${watched.get(r.symbol)}`:reasonLabel(r.eligibility)} color={watched.has(r.symbol)?c.accent:r.eligibility==='eligible'?c.green:c.dim} small/></View>
      {expanded===r.symbol && <View style={{marginTop:12,paddingTop:12,borderTopWidth:1,borderColor:c.border,gap:6}}><Text style={{color:c.soft,fontSize:12}}>Previous close {money(r.previous_close)} · last {money(r.last_price)}</Text><Text style={{color:c.soft,fontSize:12}}>History: {r.history_sessions} complete sessions · median value {r.median_value==null?'not verified':`₹${(r.median_value/1e7).toFixed(2)} cr`}</Text><Text style={{color:c.dim,fontSize:11}}>Quote {istTime(r.quote_at)} · received {istTime(r.received_at)}</Text><Text style={{color:c.dim,fontSize:11}}>{r.gap_basis==='verified_prior_candle_close'?'Previous close verified from candles.':'Indicative gap; previous close and corporate actions still need verification.'}</Text></View>}
    </Card></Pressable>}/>;
}
