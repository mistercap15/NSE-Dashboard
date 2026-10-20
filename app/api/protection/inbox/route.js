import {hedgeSummary} from '@/app/lib/hedgeSummary.mjs';
import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
async function remote(path,body){
 const base=process.env.HEDGE_INBOX_URL,secret=process.env.HEDGE_INBOX_SECRET;
 if(!base||!secret)throw Error('Inbox connection not configured');
 const url=new URL(path,base);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('HTTPS required');
 const r=await fetch(url,{method:body?'POST':'GET',headers:{'X-Inbox-Secret':secret,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Inbox unavailable');return r.json();
}
export async function GET(){try{const state=await remote('/state');state.watches=state.watches.map(w=>({...w,summary:hedgeSummary(w.latest,{checkedAt:w.last_poll})}));return NextResponse.json(state);}catch{return NextResponse.json({error:'Advisory inbox is not connected yet. Monitoring is not active.'},{status:503});}}
export async function POST(req){
 const origin=req.headers.get('origin');
 if(!req.headers.get('authorization')?.startsWith('Bearer ')){let safe=false;try{safe=new URL(origin).host===req.headers.get('host')&&new URL(origin).protocol===new URL(req.url).protocol;}catch{}if(!safe)return NextResponse.json({error:'Same-origin request required'},{status:403});}
 try{const b=await req.json();if(!['watch','unwatch','read'].includes(b.action))return NextResponse.json({error:'Invalid action'},{status:400});return NextResponse.json(await remote('/'+b.action,b));}catch{return NextResponse.json({error:'Inbox update failed; refresh to verify monitoring state.'},{status:503});}
}
