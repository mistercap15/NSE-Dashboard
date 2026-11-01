import React from 'react';
import {Text, View} from 'react-native';
import {Card, Label} from '@/components/ui';
import {Spacing, useColors} from '@/lib/theme';
import {PaperAccount, istTime, reasonLabel, stageLabel} from '@/lib/gapPaper';

export function GapSessionStatus({diagnostics, day}: {diagnostics:PaperAccount['session_diagnostics'];day:string}) {
  const c=useColors();
  if (!diagnostics || diagnostics.day!==day) return null;
  const d=diagnostics;
  return <Card style={{padding:Spacing.md,marginBottom:Spacing.md}}>
    <Label>Session activity</Label>
    <Text style={{color:c.text,fontSize:15,fontWeight:'700',lineHeight:21,marginTop:8}}>{d.summary}</Text>
    <Text style={{color:c.dim,fontSize:12,marginTop:6}}>{d.setups.length} watched · {d.signals} signals · {d.entries} entries</Text>
    {d.entry_halted && <Text style={{color:c.amber,fontSize:11,lineHeight:17,marginTop:10}}>Account entry halt: {d.halt_reason || 'Data-health checks blocked new entries.'}</Text>}
    {d.setups.map(s=><View key={s.symbol} style={{borderTopWidth:1,borderTopColor:c.border,marginTop:12,paddingTop:12}}>
      <Text style={{color:c.text,fontWeight:'700',fontSize:13}}>{s.rank}. {s.symbol}</Text>
      <Text style={{color:c.soft,fontSize:12,lineHeight:18,marginTop:4}}>{s.reason?reasonLabel(s.reason):stageLabel(s)}</Text>
      {d.quote_issues.filter(q=>q.symbol===s.symbol).map((q,i)=><Text key={i} style={{color:c.amber,fontSize:11,lineHeight:17,marginTop:4}}>{reasonLabel(q.reason)}</Text>)}
    </View>)}
    <Text style={{color:c.dim,fontSize:10,lineHeight:16,marginTop:12}}>A gap alone is not an entry. Updated {istTime(d.last_observation)}.</Text>
  </Card>;
}
