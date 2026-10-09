import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CalendarDays, CreditCard, Upload } from 'lucide-react';
import { toast } from 'sonner';

type Sub = { id:string; service_name:string; merchant_pattern:string; card_last4?:string; latest_amount:number; average_amount:number; currency:string; billing_cycle:string; next_billing_on?:string; owner_id?:string; purpose?:string; category:string; status:string; memo?:string; last_usage_result?:string };
type Candidate = { id:string; merchant_name:string; card_last4?:string; latest_amount:number; average_amount:number; currency:string; month_count:number; first_paid_on:string; last_paid_on:string };
type User = { id:string; name:string; team:string };
const money = (n:number, c='KRW') => new Intl.NumberFormat('ko-KR', { style:'currency', currency:c }).format(Number(n)||0);
const api = async (url:string, init?:RequestInit) => {
  const r = await fetch(url, { credentials:'include', headers:{ 'Content-Type':'application/json', ...(init?.headers||{}) }, ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || '처리하지 못했습니다.');
  return j;
};
const pick = (row:Record<string, unknown>, names:string[]) => {
  const key = Object.keys(row).find(k => names.some(n => k.replace(/\s/g,'').toLowerCase().includes(n)));
  return key ? row[key] : '';
};
const excelDate = (v:unknown) => {
  if (typeof v === 'number') return XLSX.SSF.format('yyyy-mm-dd', v);
  const d = new Date(String(v)); return Number.isNaN(d.valueOf()) ? '' : d.toISOString().slice(0,10);
};

export default function SubscriptionManagement() {
  const [subs,setSubs]=useState<Sub[]>([]), [candidates,setCandidates]=useState<Candidate[]>([]), [users,setUsers]=useState<User[]>([]), [busy,setBusy]=useState(false);
  const load=useCallback(()=>api('/api/subscriptions').then(j=>{setSubs(j.subscriptions||[]);setCandidates(j.candidates||[]);setUsers(j.users||[]);}).catch(e=>toast.error(e.message)),[]);
  useEffect(()=>{load();},[load]);
  const today=new Date().toISOString().slice(0,10), in7=new Date(Date.now()+7*864e5).toISOString().slice(0,10);
  const active=subs.filter(s=>s.status!=='해지됨'), krw=active.filter(s=>s.currency==='KRW').reduce((n,s)=>n+Number(s.average_amount||s.latest_amount),0);
  const cats=useMemo(()=>['AI 도구','마케팅','업무 도구','인프라'].map(category=>({category,total:active.filter(s=>s.category===category&&s.currency==='KRW').reduce((n,s)=>n+Number(s.average_amount),0)})),[subs]);
  const duplicates=new Set(active.filter((s,i,a)=>a.some((x,j)=>j!==i&&x.service_name.trim().toLowerCase()===s.service_name.trim().toLowerCase())).map(s=>s.id));
  const upload=async(file:File)=>{setBusy(true);try{const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:''});const rows=raw.map(r=>({approvedOn:excelDate(pick(r,['승인일','이용일','거래일','date'])),merchantName:String(pick(r,['가맹점','이용처','merchant'])),amount:Number(String(pick(r,['승인금액','이용금액','금액','amount'])).replace(/[^0-9.-]/g,'')),currency:String(pick(r,['통화','currency']))||'KRW',cardNumber:String(pick(r,['카드번호','카드','card']))}));const j=await api('/api/card-transactions/upload',{method:'POST',body:JSON.stringify({rows})});toast.success(`${j.accepted}건 반영 · 후보 ${j.candidates}건`);load();}catch(e){toast.error(e instanceof Error?e.message:'파일을 읽지 못했습니다.');}finally{setBusy(false);}};
  const confirm=async(c:Candidate)=>{const serviceName=prompt('서비스명을 입력하세요.',c.merchant_name);if(!serviceName)return;await api(`/api/subscriptions/candidates/${c.id}/confirm`,{method:'POST',body:JSON.stringify({serviceName})});toast.success('구독 목록에 추가했습니다.');load();};
  const patch=async(id:string,body:object)=>{await api(`/api/subscriptions/${id}`,{method:'PATCH',body:JSON.stringify(body)});load();};
  return <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
    <div className="flex flex-wrap items-center gap-3"><div><h1 className="text-xl font-bold">구독 관리</h1><p className="text-sm text-muted-foreground">반복 결제와 실제 사용 여부를 함께 확인합니다.</p></div><label className="ml-auto h-10 px-4 rounded-md bg-primary text-primary-foreground flex items-center gap-2 cursor-pointer"><Upload size={16}/>{busy?'읽는 중':'카드 내역 업로드'}<input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={busy} onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/></label></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Kpi label="월 구독 합계" value={money(krw)}/><Kpi label="검토 필요" value={`${subs.filter(s=>s.status==='검토 필요').length+candidates.length}건`}/><Kpi label="7일 안 결제" value={`${active.filter(s=>s.next_billing_on&&s.next_billing_on>=today&&s.next_billing_on<=in7).length}건`}/><Kpi label="중복 의심" value={`${duplicates.size}건`}/></div>
    <section className="grid md:grid-cols-4 gap-2">{cats.map(x=><div key={x.category} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{x.category}</p><p className="font-semibold mt-1">{money(x.total)}</p></div>)}</section>
    {candidates.length>0&&<section><h2 className="font-semibold mb-2 flex gap-2 items-center"><AlertTriangle size={16}/>구독 후보</h2><div className="rounded-lg border divide-y">{candidates.map(c=><div key={c.id} className="p-3 flex flex-wrap gap-3 items-center"><div className="flex-1 min-w-52"><b>{c.merchant_name}</b><p className="text-xs text-muted-foreground">{c.first_paid_on}~{c.last_paid_on} · {c.month_count}개월 · 카드 {c.card_last4||'미상'}</p></div><span>{money(c.average_amount,c.currency)} 평균</span><button className="h-8 px-3 rounded bg-primary text-primary-foreground text-sm" onClick={()=>confirm(c)}>확정</button><button className="h-8 px-3 rounded border text-sm" onClick={async()=>{await api(`/api/subscriptions/candidates/${c.id}/exclude`,{method:'POST'});load();}}>제외</button></div>)}</div></section>}
    <section><h2 className="font-semibold mb-2 flex gap-2 items-center"><CalendarDays size={16}/>다음 결제 달력</h2><div className="grid grid-cols-2 md:grid-cols-7 gap-2">{active.filter(s=>s.next_billing_on).sort((a,b)=>a.next_billing_on!.localeCompare(b.next_billing_on!)).slice(0,14).map(s=><div key={s.id} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{s.next_billing_on}</p><b className="text-sm">{s.service_name}</b><p className="text-xs">{money(s.latest_amount,s.currency)}</p></div>)}</div></section>
    <section><h2 className="font-semibold mb-2 flex gap-2 items-center"><CreditCard size={16}/>구독 목록</h2><div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr>{['서비스','분류','금액','다음 결제','담당자','사용 확인','상태'].map(x=><th key={x} className="p-3 whitespace-nowrap">{x}</th>)}</tr></thead><tbody>{subs.map(s=><tr key={s.id} className={`border-t ${duplicates.has(s.id)?'bg-amber-50 dark:bg-amber-950/20':''}`}><td className="p-3"><b>{s.service_name}</b>{duplicates.has(s.id)&&<span className="ml-2 text-xs text-amber-700">중복 의심</span>}<p className="text-xs text-muted-foreground">{s.merchant_pattern} · 카드 {s.card_last4||'미상'}</p></td><td className="p-3"><select value={s.category} onChange={e=>patch(s.id,{category:e.target.value})} className="bg-background border rounded p-1">{['AI 도구','마케팅','업무 도구','인프라'].map(x=><option key={x}>{x}</option>)}</select></td><td className="p-3 whitespace-nowrap">{money(s.latest_amount,s.currency)}<p className="text-xs text-muted-foreground">평균 {money(s.average_amount,s.currency)}</p></td><td className="p-3"><input type="date" value={s.next_billing_on||''} onChange={e=>patch(s.id,{nextBillingOn:e.target.value})} className="bg-background border rounded p-1"/></td><td className="p-3"><select value={s.owner_id||''} onChange={e=>patch(s.id,{ownerId:e.target.value})} className="bg-background border rounded p-1"><option value="">미지정</option>{users.map(u=><option value={u.id} key={u.id}>{u.name}</option>)}</select></td><td className="p-3">{s.last_usage_result||'미확인'}</td><td className="p-3"><select value={s.status} onChange={e=>patch(s.id,{status:e.target.value})} className="bg-background border rounded p-1">{['사용 중','검토 필요','해지 예정','해지됨'].map(x=><option key={x}>{x}</option>)}</select></td></tr>)}</tbody></table>{!subs.length&&<p className="p-8 text-center text-muted-foreground">확정된 구독이 없습니다.</p>}</div></section>
  </div>;
}
function Kpi({label,value}:{label:string;value:string}){return <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold mt-1">{value}</p></div>}
