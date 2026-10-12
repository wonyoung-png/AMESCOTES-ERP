import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {toast} from 'sonner';

type Context={actorId:string;isBoss:boolean;ready:boolean;reviewerId:string|null;reviewerInvalid?:boolean};
type Person={id:string;name:string;team:string|null};
async function readJson<T>(url:string):Promise<T>{
 const response=await fetch(url,{credentials:'include',cache:'no-store'});
 if(!response.ok)throw new Error('샘플 수락 담당 설정을 조회하지 못했습니다. 다시 조회해주세요.');
 return response.json();
}
export default function SampleReviewerSettings(){
 const client=useQueryClient();
 const context=useQuery({queryKey:['sample-workflow-context'],queryFn:()=>readJson<Context>('/api/samples/workflow/context'),retry:false});
 const directory=useQuery({queryKey:['sample-reviewer-directory'],queryFn:()=>readJson<{items:Person[]}>('/api/users/directory'),enabled:context.data?.isBoss===true,retry:false});
 const [draft,setDraft]=useState<string>();const [busy,setBusy]=useState(false);const lock=useRef(false);
 if(context.isPending)return <p role="status" className="text-sm text-muted-foreground">샘플 수락 담당 설정 확인 중…</p>;
 if(context.isError)return <div role="status" className="text-sm text-muted-foreground">샘플 설정 조회 실패 <Button variant="outline" onClick={()=>context.refetch()}>다시 조회</Button></div>;
 if(!context.data?.isBoss)return null;
 const value=draft??context.data.reviewerId??'';
 const people=(directory.data?.items||[]).filter(p=>p.team==='제품개발'||p.id===context.data.actorId);
 const currentMissing=!directory.isPending&&!directory.isError&&!!value&&!people.some(p=>p.id===value);
 const canEdit=context.data.ready||context.data.reviewerInvalid===true;
 async function save(){
  if(lock.current||!canEdit||directory.isError||directory.isPending)return;
  lock.current=true;setBusy(true);
  let failureMessage='저장 실패 · 연결을 확인하고 다시 저장해주세요. 입력은 유지했습니다.';
  try{
   const response=await fetch('/api/samples/workflow/settings',{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewerId:value||null})});
   const result=await response.json().catch(()=>null);
   if(!response.ok||!result||result.isBoss!==true||result.ready!==true){
    failureMessage=response.status===403?'대표님만 담당자를 변경할 수 있습니다.':response.status===409?'활성 제품개발 담당자를 다시 선택해주세요.':'담당자 저장을 확인하지 못했습니다. 입력을 유지했습니다.';
    throw new Error('reviewer_save_failed');
   }
   client.setQueryData(['sample-workflow-context'],result);setDraft(undefined);toast.success('샘플 수락 담당자가 저장되었습니다.');
  }catch{toast.error(failureMessage);}finally{lock.current=false;setBusy(false);}
 }
 return <section className="space-y-3 rounded-lg border border-border bg-card p-5" aria-label="샘플 수락 담당 설정">
  <h2 className="text-base font-semibold">샘플 수락 담당</h2>
  <p className="text-sm text-muted-foreground">새로 완료하는 샘플의 확인 요청을 받을 담당자입니다. 기존 요청의 담당자·청구 기록은 변경하지 않습니다.</p>
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
   <div className="min-w-0 w-full flex-1 space-y-2"><Label htmlFor="sample-reviewer-setting">수락 담당자</Label>
    <select id="sample-reviewer-setting" className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={value} disabled={busy||directory.isPending||directory.isError||!canEdit} onChange={e=>setDraft(e.target.value)}>
     <option value="">대표 기본 담당으로 설정</option>
     {currentMissing&&<option value={value} disabled>현재 담당 계정 확인 필요</option>}
     {people.map(p=><option key={p.id} value={p.id}>{p.name} · {p.team||'대표'}</option>)}
    </select>
   </div>
   <Button className="min-h-11 w-full sm:w-auto" disabled={busy||!canEdit||directory.isPending||directory.isError||currentMissing||(draft===undefined&&!context.data.reviewerInvalid)||value===context.data.reviewerId} onClick={save}>{busy?'저장 중…':context.data.reviewerInvalid?'담당자 복구':'담당자 저장'}</Button>
  </div>
  {directory.isError&&<p role="status" className="text-sm text-muted-foreground">담당자 목록 조회 실패 <Button variant="outline" onClick={()=>directory.refetch()}>다시 조회</Button></p>}
  {directory.isPending&&<p role="status" className="text-sm text-muted-foreground">담당자 목록 조회 중…</p>}
  {context.data.reviewerInvalid&&<p role="status" className="text-sm text-muted-foreground">기존 담당자가 유효하지 않습니다. 담당자를 다시 지정하거나 대표 기본 담당으로 복구해주세요. 복구 전 샘플 완료·수락은 사용할 수 없습니다.</p>}
  {!canEdit&&<p role="status" className="text-sm text-muted-foreground">샘플 업무 연결 준비 전입니다. 저장하지 않습니다.</p>}
 </section>;
}
