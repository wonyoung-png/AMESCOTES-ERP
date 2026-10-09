import { useEffect, useState } from 'react';
import { useSearch } from 'wouter';
import { store } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function ReorderImport({ workspace, onImported }: { workspace: string; onImported: () => void }) {
  const search = useSearch();
  const id = new URLSearchParams(search).get('reorder');
  const [source, setSource] = useState<any>(null);
  const [styleNo, setStyleNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setSource(null); setError('');
    if (!id) return;
    let active = true;
    fetch(`/api/brand-orders/reorder/${encodeURIComponent(id)}?workspace=${workspace}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; })
      .then(j => { if (active) { setSource(j); setStyleNo(store.getItems().find(i => i.styleNo === j.sku)?.styleNo || ''); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, workspace]);
  if (!id) return null;
  const save = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/brand-orders/reorder/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace, styleNo, updatedAt: source.updated_at, confirmed: true }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      toast.success(j.existing ? '이미 생성된 생산 의뢰입니다. 발주 작성에서 확인하세요.' : '생산 의뢰 초안 생성 완료 — 승인·발주는 발주 작성에서 진행하세요.');
      onImported();
    } catch (e) { setError(e instanceof Error ? e.message : '의뢰 생성 실패'); }
    finally { setBusy(false); }
  };
  return <section className="rounded-lg border bg-card p-4 space-y-3">
    <h2 className="font-semibold">리오더 추천 → 생산 의뢰</h2>
    {source ? <><p>{source.name || source.sku} · {source.qty}개 · {source.status}</p>
      <p className="text-sm text-muted-foreground">생산 품목을 확인하세요. 여기서는 초안만 생성하며 공장 발주·지급은 실행하지 않습니다.</p>
      <select className="h-9 rounded-md border bg-background px-2" aria-label="ERP 생산 품목" value={styleNo} onChange={e => setStyleNo(e.target.value)}><option value="">ERP 품목 선택</option>{store.getItems().map(i => <option key={i.id} value={i.styleNo}>{i.styleNo} · {i.name}</option>)}</select>
      <Button disabled={busy || !styleNo} onClick={save}>{busy ? '저장 중…' : '확인 후 생산 의뢰 초안 생성'}</Button></> : !error && <p>추천 조회 중…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </section>;
}
