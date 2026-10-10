// 중국창고 — 이지어드민/3PL과 분리된 ERP 장부 (품목·컬러)
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { store, formatNumber } from '@/lib/store';
import { phase1, type ChinaStockMoveType } from '@/lib/phase1';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { PackageMinus, PackagePlus, Warehouse } from 'lucide-react';
import { chinaStockRequest, type ChinaSnapshot, type ChinaTransfer } from '@/lib/chinaStock';
import { createChinaStockAttempt, type ChinaRequest, type ChinaRequestKind } from '@/lib/chinaStockAttempt';

const MOVE_LABEL: Record<ChinaStockMoveType, string> = {
  inbound: '입고',
  outbound: '출고',
  adjust: '조정',
};

export default function ChinaWarehouse() {
  const { workspace } = useWorkspace();
  const user = store.getCurrentUser();
  const userId = user?.id || user?.email || 'unknown-user';
  return <ChinaWarehouseContent key={`${workspace}:${userId}`} userId={userId} />;
}

function ChinaWarehouseContent({userId}: {userId: string}) {
  const { workspace } = useWorkspace();
  const ws = workspace === 'AETALOOF' ? 'AETALOOF' : 'LUMEN';
  const [revision, tick] = useState(0);
  const refresh = () => tick(n => n + 1);
  const [snapshot, setSnapshot] = useState<ChinaSnapshot | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const attemptRef = useRef<ReturnType<typeof createChinaStockAttempt> | null>(null);
  if (!attemptRef.current) attemptRef.current = createChinaStockAttempt({workspace:ws,userId,storage:()=>window.sessionStorage});
  const attempt = {current:attemptRef.current};
  const [attemptedKind, setAttemptedKind] = useState<ChinaRequestKind | null>(()=>attempt.current.request?.kind ?? null);
  const [storageError, setStorageError] = useState(attempt.current.storageError);
  const locked = saving || attemptedKind !== null || !!storageError;
  const [requestId, setRequestId] = useState('');
  const [transferMode, setTransferMode] = useState(false);
  const [arrival, setArrival] = useState<ChinaTransfer | null>(null);
  const [confirmationRef, setConfirmationRef] = useState('');
  const [arrivalDate, setArrivalDate] = useState(new Date().toISOString().slice(0,10));
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    let active=true; setSnapshot(null); setError('');
    if (workspace !== 'OEM') chinaStockRequest(ws).then(v=>{if(active) setSnapshot(v);}).catch(e=>{if(active) setError(e.message);});
    return ()=>{active=false;};
  }, [workspace,revision]);

  const items = store.getItems();
  const balances = snapshot?.workspace === ws ? snapshot.balances : [];
  const moves = snapshot?.workspace === ws ? snapshot.moves : [];
  const legacy = phase1.getChinaStockMoves(ws);
  const pendingLegacy = legacy.filter(m=>!moves.some(v=>v.id===m.id || m.receiptLogId && v.receiptLogId===m.receiptLogId));

  const [search, setSearch] = useState('');
  const [outOpen, setOutOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [form, setForm] = useState({
    styleNo: '', styleName: '', color: '', qty: 0,
    moveDate: new Date().toISOString().slice(0, 10), memo: '',
  });

  const filteredBalances = balances.filter(b => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return b.styleNo.toLowerCase().includes(q) || b.styleName.toLowerCase().includes(q) || b.color.toLowerCase().includes(q);
  });

  const totalOnHand = balances.reduce((s, b) => s + b.onHand, 0);
  const skuCount = balances.filter(b => b.onHand > 0).length;

  const saveAttempt = async (candidate: ChinaRequest) => {
    if (saving || attempt.current.busy) return;
    setAttemptedKind(attempt.current.request?.kind ?? candidate.kind);
    setSaving(true);
    try {
      const { result, request } = await attempt.current.run(candidate, chinaStockRequest);
      setSnapshot(result); // Use only the returned server stock, never subtract locally.
      attempt.current.clear(); setAttemptedKind(null); setStorageError('');
      const qty = Number(request.input.qty);
      toast.success(request.kind === 'receive' ? '전량 도착 확인 저장 · EZ 가용 별도 확인'
        : request.kind === 'transfer' ? `한국 이동 ${qty}개 · 운송중 반영`
        : request.kind === 'adjust' ? `재고 조정 ${qty > 0 ? '+' : ''}${qty} 서버 저장`
        : `중국창고 출고 ${qty}개 서버 저장`);
      setOutOpen(false); setAdjOpen(false); setArrival(null);
    } catch(e) {
      setStorageError(attempt.current.storageError);
      toast.error(`${(e as Error).message} · 처리 여부 미확인: 원래 요청만 재시도하세요. 새 등록은 중복 차감될 수 있습니다.`);
    } finally { setSaving(false); }
  };

  const retryPending = () => {
    const request = attempt.current.request;
    if (request) void saveAttempt(request);
  };

  const closeWarning = () => {
    if (attempt.current.request) toast.warning('창을 닫아도 처리 취소가 아닙니다. 원래 요청을 재시도하거나 서버 이력·운송 근거를 먼저 확인하세요.');
  };

  const openOutbound = (styleNo?: string, color?: string, styleName?: string) => {
    if (storageError) { toast.error(storageError); return; }
    if (attempt.current.request) { closeWarning(); return; }
    setRequestId(crypto.randomUUID()); setTransferMode(false);
    setForm({
      styleNo: styleNo || '',
      styleName: styleName || '',
      color: color || '',
      qty: 1,
      moveDate: new Date().toISOString().slice(0, 10),
      memo: '',
    });
    setOutOpen(true);
  };

  const openAdjust = () => {
    if (storageError) { toast.error(storageError); return; }
    if (attempt.current.request) { closeWarning(); return; }
    setRequestId(crypto.randomUUID());
    setForm({
      styleNo: '', styleName: '', color: '', qty: 0,
      moveDate: new Date().toISOString().slice(0, 10), memo: '',
    });
    setAdjOpen(true);
  };

  const submitOutbound = async () => {
    if (saving || !snapshot) return;
    if (attempt.current.request) { retryPending(); return; }
    if (!form.styleNo.trim() || !form.color.trim()) {
      toast.error('품목·컬러를 입력하세요');
      return;
    }
    if (!Number.isSafeInteger(form.qty) || form.qty <= 0) { toast.error('양의 정수 수량을 입력하세요'); return; }
    const item = items.find(i => i.styleNo === form.styleNo.trim());
    await saveAttempt({kind: transferMode ? 'transfer' : 'outbound', workspace: ws, action: transferMode ? 'transfer' : 'move', input: {
      id: requestId, ...(transferMode ? {action:'send'} : {}),
      workspace: ws,
      styleNo: form.styleNo.trim(),
      styleName: form.styleName || item?.name,
      color: form.color.trim(),
      qty: form.qty,
      moveType: 'outbound',
      moveDate: form.moveDate,
      memo: form.memo || '홀세일/직납 출고',
    }});
  };

  const submitAdjust = async () => {
    if (saving || !snapshot) return;
    if (attempt.current.request) { retryPending(); return; }
    if (!form.styleNo.trim() || !form.color.trim()) {
      toast.error('품목·컬러를 입력하세요');
      return;
    }
    if (!Number.isSafeInteger(form.qty) || !form.qty) { toast.error('조정 수량(+/-)을 정수로 입력하세요'); return; }
    const item = items.find(i => i.styleNo === form.styleNo.trim());
    if (!form.memo.trim()) { toast.error('조정 사유를 입력하세요'); return; }
    await saveAttempt({kind:'adjust', workspace:ws, action:'move', input:{
      id: requestId,
      workspace: ws,
      styleNo: form.styleNo.trim(),
      styleName: form.styleName || item?.name,
      color: form.color.trim(),
      qty: form.qty,
      moveType: 'adjust',
      moveDate: form.moveDate,
      memo: form.memo || '수기 조정',
    }});
  };

  if (workspace === 'OEM') return <div className="p-6 text-sm text-muted-foreground">브랜드를 선택한 후 중국창고를 관리하세요.</div>;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Warehouse className="w-6 h-6 text-primary" />
            중국창고
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ws} — 서버 공유 장부 · 국내 가용에 합산하지 않음 · 한국 도착은 근거 확인 후 처리
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory"><Button variant="outline" size="sm">전체 재고</Button></Link>
          <Link href="/brand-orders">
            <Button variant="outline" size="sm">리오더 · 오더관리</Button>
          </Link>
          <Button size="sm" variant="outline" disabled={!snapshot || saving} onClick={openAdjust}>
            <PackagePlus className="w-3.5 h-3.5 mr-1" />수기 조정
          </Button>
          <Button size="sm" disabled={!snapshot || saving} onClick={() => openOutbound()}>
            <PackageMinus className="w-3.5 h-3.5 mr-1" />출고 등록
          </Button>
        </div>
      </div>

      <div role="status" className="text-sm text-muted-foreground">{error || (!snapshot ? '서버 재고 조회 중…' : '서버 조회 완료 · 브라우저 자료는 확인 전 합산하지 않음')}</div>
      <Button variant="outline" size="sm" disabled={saving} onClick={refresh}>서버 새로 조회</Button>
      {(attemptedKind || storageError) && <div role="alert" className="border rounded-lg p-4 text-sm space-y-2">
        <p>{storageError || (saving ? '원래 요청 전송 중' : '탭 세션 보존·복원 요청 · 처리 여부 미확인')} · 요청 ID: {String(attempt.current.request?.input.id ?? requestId)}</p>
        {attempt.current.request && <p>원래 종류: {attempt.current.request.kind} · 수량: {String(attempt.current.request.input.qty ?? '전량 도착')} · 품목: {String(attempt.current.request.input.styleNo ?? '')}</p>}
        <p>처리 종류·수량·일자·본문은 첫 전송으로 고정됩니다. 창 닫기는 취소가 아닙니다. 같은 요청 재시도는 추가 차감하지 않으며, 새 요청은 중복 차감될 수 있습니다.</p>
        <p>같은 탭·계정·브랜드에서는 페이지 이동·새로고침 후 원래 요청을 복원합니다. 탭 종료·저장 자료 삭제·다른 탭/기기에는 보장되지 않습니다. 근거 확인 전 새 등록하지 마세요.</p>
        {userId === 'unknown-user' && <p>계정 식별 정보가 없어 이 탭의 미식별 계정 영역을 사용합니다. 계정 변경 전 기존 이력을 확인하세요.</p>}
        <Button disabled={saving || !!storageError || !attempt.current.request} onClick={retryPending}>원래 요청 그대로 재시도</Button>
        <Button variant="outline" disabled={saving} onClick={()=>{
          if (attempt.current.busy) return;
          if (!window.confirm('서버 이력과 운송/입고 근거로 기존 요청 처리 여부를 확인하셨습니까? 처리된 건을 새로 등록하면 중복 차감됩니다. 기존 요청 재시도 ID를 해제합니다.')) return;
          try {
            attempt.current.clear(); setAttemptedKind(null); setStorageError(''); setOutOpen(false); setAdjOpen(false); setArrival(null);
          } catch(e) { setStorageError(attempt.current.storageError); toast.error((e as Error).message); }
        }}>근거 확인 후 새 등록 허용</Button>
      </div>}
      {pendingLegacy.length>0 && <div className="border rounded-lg p-4 bg-card text-sm">
        브라우저 이력 {pendingLegacy.length}건이 서버에 없습니다. 다른 PC 이력과 중복 여부를 확인 후 가져오세요.
        <Button className="ml-2" variant="outline" size="sm" disabled={!snapshot || locked} onClick={()=>setImportOpen(true)}>기존 이력 검토·가져오기</Button>
      </div>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">현재고 합계</p>
          <p className="text-2xl font-bold text-foreground">{snapshot ? formatNumber(totalOnHand) : '미확인'}</p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">SKU·컬러 (재고 보유)</p>
          <p className="text-2xl font-bold text-foreground">{snapshot?.workspace === ws ? skuCount : '미확인'}</p>
        </div>
        <div className="bg-card rounded-lg border p-4 col-span-2 md:col-span-1">
          <p className="text-xs text-muted-foreground">입고 경로</p>
          <p className="text-sm text-foreground mt-1">오더관리 → <strong>중국입고</strong> 시 자동 반영</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          className="max-w-sm h-9"
          placeholder="스타일번호 · 품명 · 컬러 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">현재고 (품목 · 컬러)</div>
        <div className="overflow-x-auto">
        <table className="data-table w-full text-sm min-w-[640px]">
          <thead className="text-[13px] font-semibold text-muted-foreground">
            <tr>
              <th>스타일</th>
              <th>품명</th>
              <th>컬러</th>
              <th className="num">입고누계</th>
              <th className="num">출고누계</th>
              <th className="num">현재고</th>
              <th>액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredBalances.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">
                  {error ? '서버 조회 실패 — 재고 없음으로 판단하지 마세요.' : !snapshot ? '서버 재고 조회 중…' : search.trim() ? '검색 조건에 맞는 재고가 없습니다.' : '서버에 등록된 중국 재고가 없습니다. 기존 이력이 있다면 먼저 검토·가져오세요.'}
                </td>
              </tr>
            ) : filteredBalances.map(b => (
              <tr key={`${b.styleNo}-${b.color}`} className="hover:bg-[var(--fill-quaternary)]">
                <td className="nw font-mono text-xs text-primary">{b.styleNo}</td>
                <td>{b.styleName}</td>
                <td><Badge variant="outline" className="text-[11px]">{b.color}</Badge></td>
                <td className="num text-foreground">{formatNumber(b.inboundQty)}</td>
                <td className="num text-muted-foreground">{formatNumber(b.outboundQty)}</td>
                <td className={`px-4 py-3 text-right font-bold ${b.onHand < 0 ? 'text-[var(--system-red)]' : ''}`}>
                  {formatNumber(b.onHand)}
                </td>
                <td className="num">
                  <Button size="sm" variant="outline" className="h-7 text-[11px]"
                    disabled={b.onHand <= 0 || saving}
                    onClick={() => openOutbound(b.styleNo, b.color, b.styleName)}>
                    출고
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">입출고 이력</div>
        <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
          {moves.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">{snapshot?.workspace === ws ? '서버 등록 이력 없음' : '서버 이력 미확인'}</p>
          ) : moves.map(m => (
            <div key={m.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <span className={`text-[11px] px-1.5 py-0.5 rounded border border-border bg-[var(--fill-quaternary)] mr-2 ${
                  m.moveType === 'inbound' ? 'text-foreground' :
                  m.moveType === 'outbound' ? 'text-foreground' :
                  'text-muted-foreground'
                }`}>{MOVE_LABEL[m.moveType]}</span>
                <span className="font-mono text-xs text-primary">{m.styleNo}</span>
                <span className="mx-1.5 text-muted-foreground">·</span>
                <span>{m.color}</span>
                {m.orderNo && <span className="ml-2 text-xs text-muted-foreground">{m.orderNo}</span>}
                {m.memo && <span className="ml-2 text-xs text-muted-foreground">{m.memo}</span>}
              </div>
              <div className="text-right shrink-0">
                <span className={`font-semibold ${m.moveType === 'outbound' ? 'text-foreground' : m.moveType === 'adjust' && m.qty < 0 ? 'text-[var(--system-red)]' : 'text-foreground'}`}>
                  {m.moveType === 'outbound' ? '−' : m.moveType === 'adjust' && m.qty > 0 ? '+' : m.qty < 0 ? '' : '+'}
                  {formatNumber(Math.abs(m.qty))}
                </span>
                <span className="text-xs text-muted-foreground ml-2">{m.moveDate}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 출고 */}
      <div className="border rounded-lg bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">중국 → 한국 이동</h2>
        <p className="text-xs text-muted-foreground">출고확정 시 중국 보유 감소·운송중 증가. 한국 도착 확인은 운송중만 종료하며, EZ 재고를 추가 생성하지 않습니다. 전량 도착만 처리합니다.</p>
        {(snapshot?.workspace === ws ? snapshot.transfers : []).map(t=><div key={t.id} className="flex flex-wrap gap-2 items-center justify-between text-sm border-t pt-2">
          <span>{t.style_no} · {t.color} · {formatNumber(t.qty)}개 · {t.sent_date} · {t.status==='in_transit'?'운송중':`도착 확인 ${t.received_date} · ${t.confirmation_ref}`}</span>
          {t.status==='in_transit' && <Button size="sm" variant="outline" disabled={locked} onClick={()=>{setArrival(t);setConfirmationRef('');setArrivalDate(new Date().toISOString().slice(0,10));}}>한국 전량 도착 확인</Button>}
        </div>)}
        {snapshot && !snapshot.transfers.length && <p className="text-sm text-muted-foreground">등록된 이동 없음</p>}
      </div>
      <Dialog open={outOpen} onOpenChange={v=>{if(!saving) {if(!v) closeWarning(); setOutOpen(v);}}}>
        <DialogContent>
          <DialogHeader><DialogTitle>중국창고 출고</DialogTitle></DialogHeader>
          <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={transferMode} disabled={locked} onChange={e=>setTransferMode(e.target.checked)} />한국 3PL로 창고 이동 (신규 매입 아님)</label>
          {attemptedKind && <p role="alert" className="text-sm">처리 여부 미확인 · 변경 불가. 같은 본문으로 재시도하세요. 닫은 뒤 새 등록은 중복 차감 위험이 있습니다.</p>}
          <fieldset disabled={locked} className="space-y-3">
            <div>
              <Label>스타일번호</Label>
              <select
                className="w-full border rounded-md h-9 px-2 text-sm"
                value={form.styleNo}
                onChange={e => {
                  const styleNo = e.target.value;
                  const item = items.find(i => i.styleNo === styleNo);
                  setForm(f => ({ ...f, styleNo, styleName: item?.name || f.styleName }));
                }}
              >
                <option value="">선택 또는 아래 직접입력</option>
                {[...new Set(balances.map(b => b.styleNo))].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <Input className="mt-1" placeholder="직접 입력" value={form.styleNo}
                onChange={e => setForm(f => ({ ...f, styleNo: e.target.value }))} />
            </div>
            <div>
              <Label>컬러</Label>
              <Input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="필수" />
            </div>
            <div>
              <Label>수량</Label>
              <Input type="number" min="1" step="1" value={form.qty || ''} onChange={e => setForm(f => ({ ...f, qty: +e.target.value }))} />
            </div>
            <div>
              <Label>출고일</Label>
              <Input type="date" value={form.moveDate} onChange={e => setForm(f => ({ ...f, moveDate: e.target.value }))} />
            </div>
            <div>
              <Label>메모</Label>
              <Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="홀세일 / 직납 등" />
            </div>
          </fieldset>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => {closeWarning();setOutOpen(false);}}>{attemptedKind ? '닫기 (취소 아님)' : '취소'}</Button>
            <Button disabled={saving} onClick={submitOutbound}>{saving ? '서버 저장 중…' : attemptedKind ? '원래 요청 그대로 재시도' : transferMode ? '한국 이동 확정' : '출고 확정'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 수기 조정 */}
      <Dialog open={adjOpen} onOpenChange={v=>{if(!saving) {if(!v) closeWarning();setAdjOpen(v);}}}>
        <DialogContent>
          <DialogHeader><DialogTitle>수기 재고 조정</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">증가는 +, 감소는 − 수량으로 입력</p>
          {attemptedKind && <p role="alert" className="text-sm">처리 여부 미확인 · 변경 불가. 원래 요청만 재시도하세요. 새 등록은 중복 조정 위험이 있습니다.</p>}
          <fieldset disabled={locked} className="space-y-3">
            <div>
              <Label>스타일번호</Label>
              <Input value={form.styleNo} onChange={e => setForm(f => ({ ...f, styleNo: e.target.value }))} list="cn-styles" />
              <datalist id="cn-styles">
                {items.map(i => <option key={i.id} value={i.styleNo}>{i.name}</option>)}
              </datalist>
            </div>
            <div>
              <Label>컬러</Label>
              <Input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
            </div>
            <div>
              <Label>조정 수량 (+/−)</Label>
              <Input type="number" step="1" value={form.qty || ''} onChange={e => setForm(f => ({ ...f, qty: +e.target.value }))} />
            </div>
            <div>
              <Label>일자</Label>
              <Input type="date" value={form.moveDate} onChange={e => setForm(f => ({ ...f, moveDate: e.target.value }))} />
            </div>
            <div>
              <Label>사유</Label>
              <Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} />
            </div>
          </fieldset>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => {closeWarning();setAdjOpen(false);}}>{attemptedKind ? '닫기 (취소 아님)' : '취소'}</Button>
            <Button disabled={saving} onClick={submitAdjust}>{saving ? '서버 저장 중…' : attemptedKind ? '원래 요청 그대로 재시도' : '조정 반영'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!arrival} onOpenChange={v=>{if(!saving && !v) {closeWarning();setArrival(null);}}}><DialogContent>
        <DialogHeader><DialogTitle>한국 전량 도착 확인</DialogTitle></DialogHeader>
        <p className="text-sm">{arrival?.style_no} · {arrival?.color} · {arrival?.qty}개. 실제 3PL 입고를 확인한 뒤 근거를 기록하세요. 국내 EZ 수량은 변경하지 않습니다.</p>
        {attemptedKind && <p role="alert" className="text-sm">처리 여부 미확인 · 첫 도착일과 입고 근거로만 재시도합니다. 새 등록 전 이력을 확인하세요.</p>}
        <Label htmlFor="cn-arrival-date">도착일</Label><Input disabled={locked} id="cn-arrival-date" type="date" value={arrivalDate} onChange={e=>setArrivalDate(e.target.value)} />
        <Label htmlFor="cn-arrival-ref">3PL 입고증·이지 입고이력 번호</Label><Input disabled={locked} id="cn-arrival-ref" value={confirmationRef} onChange={e=>setConfirmationRef(e.target.value)} />
        <DialogFooter><Button disabled={saving || !confirmationRef.trim()} onClick={async()=>{
          if(!arrival || saving) return;
          await saveAttempt({kind:'receive',workspace:ws,action:'transfer',input:{id:arrival.id,action:'receive',receivedDate:arrivalDate,confirmationRef}});
        }}>{saving?'저장 중…':attemptedKind?'원래 요청 그대로 재시도':'전량 도착 확인 저장'}</Button></DialogFooter>
      </DialogContent></Dialog>
      <Dialog open={importOpen} onOpenChange={v=>{if(!saving) setImportOpen(v);}}><DialogContent>
        <DialogHeader><DialogTitle>기존 브라우저 이력 가져오기</DialogTitle></DialogHeader>
        <p className="text-sm">{ws} 기존 이력을 서버 원본과 대조합니다. 같은 입고 ID는 중복 생성하지 않습니다. 다른 PC의 수기 이력과 같은 재고인지 먼저 확인해주세요. 원본 브라우저 자료는 삭제하지 않습니다.</p>
        <div className="max-h-60 overflow-auto text-xs space-y-1">{pendingLegacy.map(m=><p key={m.id}>{m.moveDate} · {m.styleNo} · {m.color} · {MOVE_LABEL[m.moveType]} {m.qty} · {m.memo}</p>)}</div>
        <DialogFooter><Button disabled={saving} onClick={async()=>{
          if(saving || attempt.current.request) return;setSaving(true);
          try{setSnapshot(await chinaStockRequest(ws,'import',{moves:legacy,confirmed:true}));setImportOpen(false);toast.success('기존 이력 서버 저장 · 원본 보존');}
          catch(e){toast.error((e as Error).message);}finally{setSaving(false);}
        }}>{saving?'대조·저장 중…':'이력 확인 후 가져오기'}</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}
