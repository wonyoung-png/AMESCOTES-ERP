// 미지급 · 불량 차감 이월
import { useMemo, useState } from 'react';
import { phase1 } from '@/lib/phase1';
import { store, formatKRW } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

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

  const stats = useMemo(() => ({
    pending: payables.filter(p => p.status === 'pending').reduce((s, p) => s + p.amountKrw - p.paidAmountKrw, 0),
    defectPending: defects.filter(d => d.status === 'pending').reduce((s, d) => s + d.amountKrw, 0),
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">미지급 잔액</p>
          <p className="text-2xl font-bold text-[var(--system-red)]">{formatKRW(stats.pending)}</p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">불량 차감 대기</p>
          <p className="text-2xl font-bold text-[var(--system-orange)]">{formatKRW(stats.defectPending)}</p>
        </div>
      </div>

      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">미지급 목록</div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-[13px] font-semibold text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">거래처</th>
              <th className="text-left px-4 py-2">결제경로</th>
              <th className="text-left px-4 py-2">project_no</th>
              <th className="text-right px-4 py-2">금액</th>
              <th className="text-right px-4 py-2">지급</th>
              <th className="text-left px-4 py-2">상태</th>
              <th className="px-4 py-2">지급처리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {payables.map(p => (
              <tr key={p.id} className="hover:bg-[var(--fill-quaternary)]">
                <td className="px-4 py-3">{p.vendorName}</td>
                <td className="px-4 py-3">
                  {p.payeeType === 'china_corp' ? (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">중국법인</span>
                  ) : p.payeeType === 'factory_direct' ? (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--fill-quaternary)] text-[var(--system-orange)] border border-border">공장 다이렉트</span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{p.projectNo || '—'}</td>
                <td className="px-4 py-3 text-right">{formatKRW(p.amountKrw)}</td>
                <td className="px-4 py-3 text-right text-[var(--system-green)]">{formatKRW(p.paidAmountKrw)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${p.status === 'paid' ? 'bg-[var(--fill-quaternary)] text-[var(--system-green)]' : p.status === 'partial' ? 'bg-[var(--fill-quaternary)] text-[var(--system-orange)]' : 'bg-[var(--fill-quaternary)] text-muted-foreground'}`}>
                    {p.status === 'paid' ? '완료' : p.status === 'partial' ? '부분' : '대기'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {p.status !== 'paid' && (
                    <div className="flex gap-1 items-center">
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
        <table className="w-full text-sm min-w-[560px]">
          <thead className="text-[13px] font-semibold text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">발주</th>
              <th className="text-left px-4 py-2">거래처</th>
              <th className="text-right px-4 py-2">차감액</th>
              <th className="text-left px-4 py-2">사유</th>
              <th className="text-left px-4 py-2">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {defects.map(d => (
              <tr key={d.id} className="hover:bg-[var(--fill-quaternary)]">
                <td className="px-4 py-3 font-mono text-xs">{d.orderNo}</td>
                <td className="px-4 py-3">{d.vendorName}</td>
                <td className="px-4 py-3 text-right text-[var(--system-red)]">{formatKRW(d.amountKrw)}</td>
                <td className="px-4 py-3 text-muted-foreground">{d.reason}</td>
                <td className="px-4 py-3">
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
