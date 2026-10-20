'use client';
import {TrendingUp,TrendingDown,Minus,ShieldAlert,Clock3} from 'lucide-react';
const tones={green:'border-green/30 bg-green/10 text-green',red:'border-red/30 bg-red/10 text-red',amber:'border-amber/30 bg-amber/10 text-amber',blue:'border-accent/30 bg-accent/10 text-accent',muted:'border-border bg-bg text-soft'};
export default function ActionCard({summary,compact=false}){
 const s=summary||{tone:'muted',direction:'unknown',directionLabel:'Assessment pending',action:'Waiting for first check',reason:'Your position is saved. The first background check will appear here.'};
 const Icon=s.direction==='bullish'?TrendingUp:s.direction==='bearish'?TrendingDown:Minus;
 return <div className={`rounded-2xl border p-5 md:p-6 ${tones[s.tone]||tones.muted}`}>
  <div className="flex justify-between items-center gap-3"><span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><Icon size={18}/>{s.directionLabel}</span>{s.code==='protect'?<ShieldAlert size={20}/>:<Clock3 size={18}/>}</div>
  <h2 className={`${compact?'text-xl':'text-2xl md:text-3xl'} text-text font-semibold tracking-tight mt-4`}>{s.action}</h2>
  <p className="text-soft text-sm mt-2 leading-relaxed">{s.reason}</p>
  {!compact&&<><div className="grid grid-cols-3 gap-2 mt-5">{s.chips?.map(x=><div className="rounded-xl bg-card/70 p-3" key={x.label}><p className="text-[10px] uppercase tracking-wider text-dim">{x.label}</p><p className="text-xs text-text font-medium mt-1">{x.value}</p></div>)}</div>{s.trigger&&<p className="mt-4 text-xs text-soft">{s.trigger}</p>}{s.quoteNote&&<p className="mt-2 text-xs text-soft">{s.quoteNote}</p>}</>}
  <p className="text-[11px] text-dim mt-4">{s.asOf?`Daily evidence: ${s.asOf}`:'No reliable daily assessment yet'}{s.partial?' · Some inputs unavailable':''}</p>
 </div>;
}
