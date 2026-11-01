import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Badge, Card, Label, SectionHeader, StatCard, StatRow } from '@/components/ui';
import { Spacing, Type, useColors } from '@/lib/theme';
import { money } from '@/lib/gapPaper';
import pilot from '@/assets/data/gapPaperPilot.json';

export default function GapPaperHistory() {
  const c=useColors();
  return <ScrollView style={{backgroundColor:c.bg}} contentContainerStyle={{padding:Spacing.md,paddingBottom:Spacing.xxl}}>
    <Label>Archived research · through {pilot.as_of}</Label>
    <Text style={{color:c.text,fontSize:27,fontWeight:'800',marginTop:8}}>Five-stock pilot<Text style={{color:c.accent}}>.</Text></Text>
    <View style={{alignItems:'flex-start',marginTop:12}}><Badge text="HISTORICAL · NOT LIVE PICKS" color={c.amber}/></View>
    <Card tint={c.amber} style={{padding:Spacing.md,marginVertical:Spacing.md}}><Text style={{color:c.soft,fontSize:12,lineHeight:19}}>This saved replay used RELIANCE, HDFCBANK, INFY, ITC and TATASTEEL. These are historical research inputs, not a hard-coded live watchlist. The exploratory replay lost money after costs and does not establish an edge.</Text></Card>
    <StatRow><StatCard label="Net P&L" value={money(pilot.summary.net_pnl)} color={c.red}/><StatCard label="Trades" value={String(pilot.summary.trades)}/></StatRow>
    <View style={{marginTop:8}}><StatRow><StatCard label="Account return" value={`${(pilot.summary.account_return*100).toFixed(2)}%`}/><StatCard label="Max drawdown" value={money(pilot.summary.max_marked_drawdown_rupees)}/></StatRow></View>
    <SectionHeader title="Yearly results" icon="calendar-outline"/>
    {pilot.summary.annual.map(r=><Card key={r.year} style={{padding:Spacing.md,marginBottom:8}}><View style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{color:c.text,fontWeight:'800'}}>{r.year}</Text><Text style={{color:r.net_account_pnl<0?c.red:c.green,fontWeight:'800',...Type.numeric}}>{money(r.net_account_pnl)}</Text></View><Text style={{color:c.dim,fontSize:11,marginTop:6}}>{r.trades} trades · {(r.account_return*100).toFixed(2)}% capital return</Text></Card>)}
    <SectionHeader title="Research limits" icon="information-circle-outline"/>
    <Text style={{color:c.soft,fontSize:12,lineHeight:20}}>{pilot.warning}{'\n\n'}{pilot.ambiguity_warning}</Text>
  </ScrollView>;
}
