// 입고 · OEM출고 · 3PL출고 — receipt_logs 기반 부분입고
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { store, formatNumber } from '@/lib/store';
import { phase1, type ReceiptLogType } from '@/lib/phase1';
import { fetchOrders } from '@/lib/supabaseQueries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Package, Truck, Warehouse } from 'lucide-react';

const LOG_LABELS: Record<ReceiptLogType, string> = {
  inbound: '입고',
  outbound_oem: 'OEM 직출고',
  outbound_3pl: '3PL 입고',
};

export default function ReceivingShipping() {
  const queryClient = useQueryClient();
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
  const [filter, setFilter] = useState<'all' | 'pending' | 'partial' | 'done'>('all');
  const [logFilter, setLogFilter] = useState<ReceiptLogType | 'all'>('all');
  const [modal, setModal] = useState<{ orderId: string; logType: ReceiptLogType } | null>(null);
  const [form, setForm] = useState({ qty: 0, defectQty: 0, defectNote: '', date: new Date().toISOString().split('T')[0], memo: '' });
  const [, tick] = useState(0);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); tick(n => n + 1); };

  const enriched = useMemo(() => orders.map(o => {
    const sum = phase1.getOrderReceiptSummary(o.id, o.qty);
    return { ...o, ...sum };
  }), [orders, tick]);

  const filtered = useMemo(() => enriched.filter(o => {
    if (filter === 'pending') return o.remaining > 0 && o.receivedQty === 0;
    if (filter === 'partial') return o.receivedQty > 0 && o.remaining > 0;
    if (filter === 'done') return o.remaining <= 0;
    return true;
  }), [enriched, filter]);

  const allLogs = useMemo(() => {
    const logs = phase1.getReceiptLogs().sort((a, b) => b.receivedDate.localeCompare(a.receivedDate));
    return logFilter === 'all' ? logs : logs.filter(l => l.logType === logFilter);
  }, [logFilter, tick]);

  const openModal = (orderId: string, logType: ReceiptLogType) => {
    const o = orders.find(x => x.id === orderId);
    const sum = phase1.getOrderReceiptSummary(orderId, o?.qty || 0);
    const remain = logType === 'inbound' ? o!.qty - sum.receivedQty : o!.qty - sum.shippedQty;
    setForm({ qty: Math.max(0, remain), defectQty: 0, defectNote: '', date: new Date().toISOString().split('T')[0], memo: '' });
    setModal({ orderId, logType });
  };

  const submitLog = () => {
    if (!modal || form.qty <= 0) { toast.error('수량을 입력하세요'); return; }
    const o = orders.find(x => x.id === modal.orderId);
    if (!o) return;
    phase1.addReceiptLog({
      orderId: o.id,
      orderNo: o.orderNo,
      projectNo: (o as { projectNo?: string }).projectNo,
      logType: modal.logType,
      qty: form.qty,
      defectQty: form.defectQty,
      defectNote: form.defectNote,
      receivedDate: form.date,
      memo: form.memo,
    });
    const sum = phase1.getOrderReceiptSummary(o.id, o.qty);
    const newReceived = sum.receivedQty;
    const newShipped = sum.shippedQty + (modal.logType !== 'inbound' ? form.qty : 0);
    const updates: Record<string, unknown> = {
      receivedQty: newReceived,
      defectQty: sum.defectQty,
      receivedDate: form.date,
      shippedQty: newShipped,
    };
    if (newReceived >= o.qty) updates.status = '입고완료';
    store.updateOrder(o.id, updates as Partial<typeof o>);
    if (form.defectQty > 0 && modal.logType === 'inbound') {
      const unit = o.factoryUnitPriceKrw || 0;
      phase1.addDefectCarryover({
        styleNo: o.styleNo,
        orderNo: o.orderNo,
        projectNo: (o as { projectNo?: string }).projectNo,
        vendorId: o.vendorId,
        vendorName: o.vendorName,
        amountKrw: unit * form.defectQty,
        reason: form.defectNote || '입고 불량',
        defectDate: form.date,
      });
    }
    toast.success(`${LOG_LABELS[modal.logType]} ${form.qty}개 기록`);
    setModal(null);
    refresh();
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-800">입고 · 출고</h1>
        <p className="text-sm text-stone-500">부분입고 · OEM 직출고 · 3PL 입고 (receipt_logs)</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'pending', 'partial', 'done'] as const).map(f => (
          <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'}
            onClick={() => setFilter(f)}>
            {f === 'all' ? '전체' : f === 'pending' ? '미입고' : f === 'partial' ? '부분입고' : '완료'}
          </Button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-xs text-stone-500">
            <tr>
              <th className="text-left px-4 py-2">발주번호</th>
              <th className="text-right px-4 py-2">발주</th>
              <th className="text-right px-4 py-2">입고</th>
              <th className="text-right px-4 py-2">출고</th>
              <th className="text-right px-4 py-2">잔량</th>
              <th className="px-4 py-2">처리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(o => (
              <tr key={o.id} className="border-t border-stone-100 hover:bg-stone-50">
                <td className="px-4 py-3 font-mono text-xs">{o.orderNo}</td>
                <td className="px-4 py-3 text-right">{formatNumber(o.qty)}</td>
                <td className="px-4 py-3 text-right text-green-700">{formatNumber(o.receivedQty)}</td>
                <td className="px-4 py-3 text-right text-blue-700">{formatNumber(o.shippedQty)}</td>
                <td className="px-4 py-3 text-right font-semibold">{formatNumber(o.remaining)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openModal(o.id, 'inbound')}>
                      <Package className="w-3 h-3 mr-1" />입고
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openModal(o.id, 'outbound_oem')}>
                      <Truck className="w-3 h-3 mr-1" />OEM출고
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openModal(o.id, 'outbound_3pl')}>
                      <Warehouse className="w-3 h-3 mr-1" />3PL
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-semibold text-stone-700">입출고 이력</h2>
          <Select value={logFilter} onValueChange={v => setLogFilter(v as ReceiptLogType | 'all')}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="inbound">입고</SelectItem>
              <SelectItem value="outbound_oem">OEM출고</SelectItem>
              <SelectItem value="outbound_3pl">3PL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
          {allLogs.length === 0 ? (
            <p className="p-6 text-sm text-stone-400 text-center">이력 없음</p>
          ) : allLogs.slice(0, 30).map(l => (
            <div key={l.id} className="px-4 py-3 flex justify-between text-sm">
              <div>
                <span className="font-mono text-xs">{l.orderNo}</span>
                <span className="mx-2 text-stone-300">·</span>
                <span className="text-stone-600">{LOG_LABELS[l.logType]}</span>
                {l.destination === 'korea' && <span className="ml-1 text-[10px] text-amber-700">한국</span>}
                {l.destination === 'china' && <span className="ml-1 text-[10px] text-blue-700">중국{l.color ? `·${l.color}` : ''}</span>}
                {l.isAdvance && <span className="ml-1 text-[10px] text-orange-600">선입</span>}
                {l.orderNo && <span className="ml-2 text-xs text-stone-400">{l.orderNo}</span>}
              </div>
              <div className="text-right">
                <span className="font-semibold">{formatNumber(l.qty)}</span>
                {l.defectQty > 0 && <span className="text-red-500 text-xs ml-2">불량 {l.defectQty}</span>}
                <span className="text-stone-400 text-xs ml-2">{l.receivedDate}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={!!modal} onOpenChange={() => setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{modal ? LOG_LABELS[modal.logType] : ''} 등록</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>수량</Label><Input type="number" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: +e.target.value }))} /></div>
            {modal?.logType === 'inbound' && (
              <>
                <div><Label>불량 수량</Label><Input type="number" value={form.defectQty} onChange={e => setForm(f => ({ ...f, defectQty: +e.target.value }))} /></div>
                <div><Label>불량 사유</Label><Input value={form.defectNote} onChange={e => setForm(f => ({ ...f, defectNote: e.target.value }))} /></div>
              </>
            )}
            <div><Label>일자</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div><Label>메모</Label><Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>취소</Button>
            <Button onClick={submitLog}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
