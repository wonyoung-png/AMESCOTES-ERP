// 미지급 · 불량 차감 이월
import { useMemo, useState } from 'react';
import { phase1 } from '@/lib/phase1';
import { store, formatKRW } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Link } from 'wouter';

export default function PayablesManagement() {
  const [, tick] = useState(0);
  const refresh = () => tick(n => n + 1);
  const payables = phase1.getPayables();
  const defects = phase1.getDefectCarryovers();
  const vendors = store.getVendors();

  const [payModal, setPayModal] = useState(false);
  const [payForm, setPayForm] = useState({
    vendorId: '', vendorName: '', projectNo: '', amountKrw: 0, dueDate: '', memo: '',
  });
  const [payAmount, setPayAmount] = useState<Record<string, number>>({});

  // ── 필터 ── 거래처·상태·검색. 요약 카드와 목록이 같은 기준으로 움직인다.
  const [fVendor, setFVendor] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [fSearch, setFSearch] = useState('');

  const payableVendors = useMemo(
    () => Array.from(new Set(payables.map(p => p.vendorName).filter(Boolean))),
    [payables, tick],
  );
  const matches = (vendorName: string, status: string, text: string) =>
    (fVendor === 'all' || vendorName === fVendor) &&
    (fStatus === 'all' || status === fStatus) &&
    (!fSearch || text.toLowerCase().includes(fSearch.toLowerCase()));

  const shownPayables = useMemo(
    () => payables.filter(p => matches(p.vendorName, p.status, `${p.vendorName} ${p.projectNo || ''} ${p.memo || ''}`)),
    [payables, fVendor, fStatus, fSearch, tick],
  );
  const shownDefects = useMemo(
    () => defects.filter(d => matches(d.vendorName, d.status === 'applied' ? 'paid' : 'pending', `${d.vendorName} ${d.orderNo} ${d.reason || ''}`)),
    [defects, fVendor, fStatus, fSearch, tick],
  );
  const filterOn = fVendor !== 'all' || fStatus !== 'all' || !!fSearch;
  const resetFilters = () => { setFVendor('all'); setFStatus('all'); setFSearch(''); };

  const stats = useMemo(() => ({
    pending: payables.filter(p => p.status === 'pending').reduce((s, p) => s + p.amountKrw - p.paidAmountKrw, 0),
    defectPending: defects.filter(d => d.status === 'pending').reduce((s, d) => s + d.amountKrw, 0),
    partial: payables.filter(p => p.status === 'partial').length,
    overdue: payables.filter(p => p.status !== 'paid' && p.dueDate && p.dueDate < new Date().toISOString().split('T')[0]).length,
  }), [payables, defects, tick]);

  const addPayable = () => {
    if (!payForm.vendorName || payForm.amountKrw <= 0) { toast.error('거래처와 금액 필수'); return; }
    phase1.addPayable({
      vendorId: payForm.vendorId,
      vendorName: payForm.vendorName,
      projectNo: payForm.projectNo || undefined,
      sourceType: 'manual',
      amountKrw: payForm.amountKrw,
      dueDate: payForm.dueDate || new Date().toISOString().split('T')[0],
      memo: payForm.memo,
    });
    toast.success('미지급 등록');
    setPayModal(false);
    refresh();
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">미지급 · 불량차감</h1>
          <p className="text-sm text-muted-foreground">매입 미지급 · 불량 차감 이월 (다음 명세 자동 반영)</p>
        </div>
        <Button onClick={() => setPayModal(true)}>+ 미지급 등록</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">미지급 잔액</p>
          <p className="text-2xl font-bold text-[var(--system-red)] tabular-nums">{formatKRW(stats.pending)}</p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">불량 차감 대기</p>
          <p className="text-2xl font-bold text-[var(--system-orange)] tabular-nums">{formatKRW(stats.defectPending)}</p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">부분 지급</p>
          <p className="text-2xl font-bold tabular-nums">{stats.partial}<span className="text-sm font-normal text-muted-foreground ml-1">건</span></p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">지급 기한 초과</p>
          <p className={`text-2xl font-bold tabular-nums ${stats.overdue > 0 ? 'text-[var(--system-red)]' : ''}`}>{stats.overdue}<span className="text-sm font-normal text-muted-foreground ml-1">건</span></p>
        </div>
      </div>

      {/* 필터 — 거래처·상태·검색이 미지급 목록과 불량 차감에 함께 걸린다 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={fSearch} onChange={e => setFSearch(e.target.value)}
          placeholder="거래처 · 발주번호 · 사유 검색" className="h-9 w-full sm:w-64" />
        <select value={fVendor} onChange={e => setFVendor(e.target.value)}
          className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          <option value="all">거래처 전체</option>
          {payableVendors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}
          className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          <option value="all">상태 전체</option>
          <option value="pending">대기</option>
          <option value="partial">부분 지급</option>
          <option value="paid">완료</option>
        </select>
        {filterOn && (
          <button onClick={resetFilters} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            필터 초기화
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          미지급 {shownPayables.length}/{payables.length} · 차감 {shownDefects.length}/{defects.length}
        </span>
      </div>

      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">미지급 목록</div>
        <div className="overflow-x-auto">
        <table className="data-table min-w-[760px]">
          <thead>
            <tr>
              <th>거래처</th>
              <th>결제경로</th>
              <th>발주번호</th>
              <th className="num">금액</th>
              <th className="num">지급액</th>
              <th className="num">잔액</th>
              <th>상태</th>
              <th className="act">지급처리</th>
            </tr>
          </thead>
          <tbody>
            {shownPayables.map(p => (
              <tr key={p.id} className="hover:bg-[var(--fill-quaternary)]">
                <td className="font-medium">{p.vendorName}</td>
                <td>
                  {p.payeeType === 'china_corp' ? (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">중국법인</span>
                  ) : p.payeeType === 'factory_direct' ? (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--fill-quaternary)] text-[var(--system-orange)] border border-border">공장 다이렉트</span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">—</span>
                  )}
                </td>
                <td className="font-mono text-xs text-muted-foreground">{p.projectNo || '—'}</td>
                <td className="num">{formatKRW(p.amountKrw)}</td>
                <td className="num text-[var(--system-green)]">{p.paidAmountKrw > 0 ? formatKRW(p.paidAmountKrw) : '—'}</td>
                <td className="num font-semibold">{formatKRW(p.amountKrw - p.paidAmountKrw)}</td>
                <td>
                  <span className={`text-xs px-2 py-0.5 rounded ${p.status === 'paid' ? 'bg-[var(--fill-quaternary)] text-[var(--system-green)]' : p.status === 'partial' ? 'bg-[var(--fill-quaternary)] text-[var(--system-orange)]' : 'bg-[var(--fill-quaternary)] text-muted-foreground'}`}>
                    {p.status === 'paid' ? '완료' : p.status === 'partial' ? '부분' : '대기'}
                  </span>
                </td>
                <td className="act">
                  {p.status !== 'paid' && (
                    <div className="flex gap-1 items-center justify-end">
                      <Input className="h-7 w-24 text-xs" type="number"
                        value={payAmount[p.id] ?? ''}
                        onChange={e => setPayAmount(a => ({ ...a, [p.id]: +e.target.value }))}
                        placeholder="금액" />
                      <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => {
                        const amt = payAmount[p.id];
                        if (!amt || amt <= 0) return;
                        phase1.recordPayablePayment(p.id, amt);
                        toast.success('지급 기록');
                        refresh();
                      }}>지급</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">불량 차감 이월</div>
        <div className="overflow-x-auto">
        <table className="data-table min-w-[560px]">
          <thead>
            <tr>
              <th>발주번호</th>
              <th>거래처</th>
              <th className="num">차감액</th>
              <th>사유</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {shownDefects.map(d => (
              <tr key={d.id} className="hover:bg-[var(--fill-quaternary)]">
                <td>
                  <Link href={`/orders?order=${encodeURIComponent(d.orderNo)}`}
                    className="font-mono text-xs underline underline-offset-2 decoration-border hover:decoration-foreground hover:text-foreground text-muted-foreground"
                    title="발주 상세 열기">
                    {d.orderNo}
                  </Link>
                </td>
                <td className="font-medium">{d.vendorName}</td>
                <td className="num text-[var(--system-red)]">{formatKRW(d.amountKrw)}</td>
                <td className="text-muted-foreground">{d.reason}</td>
                <td>
                  <span className={`text-xs px-2 py-0.5 rounded ${d.status === 'applied' ? 'bg-[var(--fill-quaternary)] text-[var(--system-green)]' : 'bg-[var(--fill-quaternary)] text-[var(--system-orange)]'}`}>
                    {d.status === 'applied' ? '반영됨' : '대기'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={payModal} onOpenChange={setPayModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>미지급 등록</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>거래처</Label>
              <select className="w-full border rounded-md h-9 px-2 text-sm"
                value={payForm.vendorId}
                onChange={e => {
                  const v = vendors.find(x => x.id === e.target.value);
                  setPayForm(f => ({ ...f, vendorId: e.target.value, vendorName: v?.name || '' }));
                }}>
                <option value="">선택</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div><Label>project_no</Label><Input value={payForm.projectNo} onChange={e => setPayForm(f => ({ ...f, projectNo: e.target.value }))} /></div>
            <div><Label>금액 (KRW)</Label><Input type="number" value={payForm.amountKrw || ''} onChange={e => setPayForm(f => ({ ...f, amountKrw: +e.target.value }))} /></div>
            <div><Label>지급예정일</Label><Input type="date" value={payForm.dueDate} onChange={e => setPayForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
            <div><Label>메모</Label><Input value={payForm.memo} onChange={e => setPayForm(f => ({ ...f, memo: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayModal(false)}>취소</Button>
            <Button onClick={addPayable}>등록</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
