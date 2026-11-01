import React from 'react';
import {Pressable, Text, View} from 'react-native';
import {Card, Label} from '@/components/ui';
import {Spacing, Radius, Type, useColors} from '@/lib/theme';
import {PaperComparison, money} from '@/lib/gapPaper';

export function GapComparison({comparison,variant,onSelect}:{comparison?:PaperComparison;variant:'v1'|'v2';onSelect:(v:'v1'|'v2')=>void}) {
  const c=useColors();
  if(!comparison)return null;
  return <Card style={{padding:Spacing.md,marginTop:Spacing.md}}>
    <Label>Two rules. Separate paper accounts.</Label>
    <Text style={{color:c.soft,fontSize:12,lineHeight:18,marginTop:8}}>Only the closing advance changes. Both keep the 10:00 deadline, the first-pullback rules and the same risk limits.</Text>
    <View style={{flexDirection:'row',gap:8,marginTop:12}}>{comparison.accounts.map(a=><Pressable key={a.variant} accessibilityRole="button" accessibilityState={{selected:variant===a.variant}} onPress={()=>onSelect(a.variant)} style={{flex:1,padding:12,borderRadius:Radius.md,borderWidth:1,borderColor:variant===a.variant?c.accent:c.border,backgroundColor:variant===a.variant?c.accentBg:c.card}}>
      <Text style={{color:variant===a.variant?c.accent:c.text,fontSize:13,fontWeight:'800'}}>{a.label}</Text>
      <Text style={{color:a.net_pnl!=null&&a.net_pnl<0?c.red:c.text,fontSize:20,fontWeight:'800',marginTop:8,...Type.numeric}}>{money(a.net_pnl)}</Text>
      <Text style={{color:c.dim,fontSize:10,lineHeight:16,marginTop:6}}>{a.observed?`${a.entries} entries · ${a.closed_trades} closed`:'Awaiting forward session'}</Text>
      {a.return_fraction!=null&&<Text style={{color:c.dim,fontSize:10,lineHeight:16}}>{(a.return_fraction*100).toFixed(3)}% day return</Text>}
      {a.max_drawdown!=null&&<Text style={{color:c.dim,fontSize:10,lineHeight:16}}>Drawdown {money(a.max_drawdown)}</Text>}
    </Pressable>)}</View>
    <Text style={{color:c.dim,fontSize:10,lineHeight:16,marginTop:10}}>{comparison.day} · {comparison.paired_day?'Both observed. P&L includes paid fees.':'Not yet a paired day. No earlier V2 trades are reconstructed.'} Each starts with ₹2 lakh simulated capital.</Text>
    <Text style={{color:c.accent,fontSize:11,fontWeight:'700',marginTop:8}}>Viewing {variant.toUpperCase()} setups, trades and P&L below</Text>
  </Card>;
}
