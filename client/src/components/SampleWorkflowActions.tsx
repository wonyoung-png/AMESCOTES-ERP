import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resizeImage } from '@/lib/utils';
import { sampleBillable, sampleWorkflowRequest } from '@/lib/sampleWorkflow';
import { normalizeBrands, type Sample, type Vendor } from '@/lib/store';
import { announceWorkChanged } from '@/components/WorkCardActions';
import { toast } from 'sonner';

export function SampleWorkflowActions({sample,vendors,onSaved,onBill}:{sample:Sample;vendors:Vendor[];onSaved:(s:Sample)=>void;onBill:()=>void}) {
  const {data:context} = useQuery({queryKey:['sample-workflow-context'],queryFn:async()=>{
    const r=await fetch('/api/samples/workflow/context',{credentials:'include',cache:'no-store'});
    if(!r.ok)throw Error('샘플 연결 기능을 확인하지 못했습니다');return r.json();
  },retry:false});
  const [photos,setPhotos]=useState(sample.imageUrls || []);
  const [name,setName]=useState(sample.styleName);
  const [buyer,setBuyer]=useState(sample.buyerId || '');
  const [brand,setBrand]=useState(sample.brandCode || '');
  const [price,setPrice]=useState(String(sample.sampleUnitPrice ?? sample.costKrw ?? ''));
  const [busy,setBusy]=useState(false);const lock=useRef(false);
  useEffect(()=>{setPhotos(sample.imageUrls||[]);setName(sample.styleName);setBuyer(sample.buyerId||'');setBrand(sample.brandCode||'');
    setPrice(String(sample.sampleUnitPrice ?? sample.costKrw ?? ''));},[sample.id,sample.workflowVersion]);
  const canAccept=!!context && (context.isBoss || context.actorId===sample.reviewAssigneeId);
  const brands=normalizeBrands(vendors.find(v=>v.id===buyer)?.brands);
  async function act(action:'complete'|'accept') {
    if(lock.current)return;lock.current=true;setBusy(true);
    try {
      const result=await sampleWorkflowRequest(`/api/samples/${encodeURIComponent(sample.id)}/${action}`,{
        version:sample.workflowVersion??0,imageUrls:photos,styleName:name,buyerId:buyer,brandCode:brand,sampleUnitPrice:Number(price),
      });
      const row=result.sample;
      onSaved({...sample,imageUrls:row.image_urls,styleName:row.style_name,buyerId:row.buyer_id,brandCode:row.brand_code,
        sampleUnitPrice:row.sample_unit_price==null?undefined:Number(row.sample_unit_price),stage:row.stage,approvedBy:row.approved_by,
        completedAt:row.completed_at,completedBy:row.completed_by,reviewStatus:row.review_status,reviewAssigneeId:row.review_assignee_id,
        reviewCardId:row.review_card_id,acceptedAt:row.accepted_at,acceptedBy:row.accepted_by,workflowVersion:row.workflow_version});
      announceWorkChanged();toast.success(action==='complete'?'완료 저장 · 팀장 업무함에 전달했습니다':'샘플 수락 완료');
      if(result.notified===false)toast.warning('업무는 저장됐습니다. 알림은 자동 재시도 대기 중입니다.');
    } catch(e){toast.error((e as Error).message);} finally{lock.current=false;setBusy(false);}
  }
  return <section className="space-y-3 border-b border-border pb-4" aria-label="샘플 완료 및 수락">
    {!context?.ready && <p role="status" className="text-sm text-muted-foreground">서버·DB 연결 반영 전입니다. 완료·수락·청구는 아직 사용할 수 없습니다.</p>}
    {!sample.completedAt ? <>
      <Label htmlFor="sample-completion-photo">완료 사진</Label>
      <Input id="sample-completion-photo" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || !context?.ready} onChange={async e=>{
        const files=Array.from(e.target.files||[]);e.target.value='';
        if(files.some(f=>f.size>5*1024*1024)){toast.error('사진은 장당 5MB 이하로 등록해주세요');return;}
        if(files.length+photos.length>5){toast.error('완료 사진은 최대 5장입니다');return;}
        setBusy(true);try{const resized=await Promise.all(files.map(f=>resizeImage(f)));setPhotos(p=>[...p,...resized]);}
        catch{toast.error('사진을 읽지 못했습니다. 다시 선택해주세요');}finally{setBusy(false);}
      }}/>
      {!!photos.length && <div className="flex flex-wrap gap-2">{photos.map((url,i)=><div key={i} className="space-y-1"><img src={url} alt={`완료 사진 ${i+1}`} className="h-20 w-20 rounded object-cover"/><Button variant="outline" size="sm" disabled={busy} aria-label={`완료 사진 ${i+1} 삭제`} onClick={()=>setPhotos(p=>p.filter((_,index)=>index!==i))}>삭제</Button></div>)}</div>}
      <Button className="min-h-11" disabled={busy || !context?.ready || !photos.length} onClick={()=>act('complete')}>{busy?'저장 중…':'완료'}</Button>
    </> : <>
      <p className="text-sm">완료 {new Date(sample.completedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})} · {sample.reviewStatus==='accepted'?'팀장 수락 완료':'팀장 확인 대기'}</p>
      {sample.reviewStatus==='pending' && canAccept && <div className="grid gap-3">
        <div><Label htmlFor="sample-review-name">제품명</Label><Input id="sample-review-name" value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></div>
        <div><Label htmlFor="sample-review-buyer">바이어</Label><select id="sample-review-buyer" className="w-full min-h-11 rounded-md border border-input bg-background px-3 text-sm" value={buyer} disabled={busy} onChange={e=>{setBuyer(e.target.value);setBrand('');}}><option value="">선택</option>{vendors.filter(v=>v.type==='바이어').map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div><Label htmlFor="sample-review-brand">브랜드</Label><select id="sample-review-brand" className="w-full min-h-11 rounded-md border border-input bg-background px-3 text-sm" value={brand} disabled={busy} onChange={e=>setBrand(e.target.value)}><option value="">선택</option>{brands.map((b,i)=><option key={i} value={b.code||b.name}>{b.name}</option>)}</select></div>
        <div><Label htmlFor="sample-review-price">샘플 청구 금액 · KRW</Label><Input id="sample-review-price" type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)} disabled={busy}/></div>
        <Button className="min-h-11" disabled={busy || !context?.ready || !name.trim() || !buyer || price.trim()==='' || !Number.isFinite(Number(price)) || Number(price)<0 || (brands.length>0&&!brand)} onClick={()=>act('accept')}>{busy?'저장 중…':'수락'}</Button>
      </div>}
      {sampleBillable(sample) && canAccept && <Button className="min-h-11" disabled={busy||!context?.ready} onClick={onBill}>청구하기</Button>}
    </>}
  </section>;
}
