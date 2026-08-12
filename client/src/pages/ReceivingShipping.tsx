// 입고 · OEM출고 · 3PL출고 — receipt_logs 기반 부분입고
import { useMemo, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { store, formatNumber, genId } from '@/lib/store';
import { phase1, type DeliveryMarket, type ReceiptLogType } from '@/lib/phase1';
import { fetchOrders } from '@/lib/supabaseQueries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { CheckCircle2, Package, Plane, Ship, Truck, Warehouse } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { confirmShippingPlan, fetchShippingPlans, upsertShippingPlan, type ShippingMethod } from '@/lib/shippingPlans';

const LOG_LABELS: Record<ReceiptLogType, string> = {
  inbound: '입고',
  outbound_oem: 'OEM 직출고',
  outbound_3pl: '3PL 입고',
};

export default function ReceivingShipping() {
  const queryClient = useQueryClient();
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
  const today = new Date().toISOString().slice(0, 10);
  const { data: shippingPlans = [] } = useQuery({ queryKey: ['shippingPlans'], queryFn: () => fetchShippingPlans(), retry: false });
  const [filter, setFilter] = usePersistedState<'all' | 'pending' | 'partial' | 'done'>('receiving.filter', 'all');
  const [search, setSearch] = usePersistedState('receiving.search', '');
  const [logFilter, setLogFilter] = useState<ReceiptLogType | 'all'>('all');
  const [modal, setModal] = useState<{ orderId: string; logType: ReceiptLogType } | null>(null);
  const [form, setForm] = useState({ qty: 0, defectQty: 0, defectNote: '', date: new Date().toISOString().split('T')[0], memo: '', deliveryMarket: 'domestic' as DeliveryMarket });
  const [shippingOpen, setShippingOpen] = useState(false);
  const [shippingForm, setShippingForm] = useState({ shipDate: today, method: 'air' as ShippingMethod, orderNo: '', description: '', qty: 0, memo: '' });
  const [, tick] = useState(0);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); tick(n => n + 1); };

  const enriched = useMemo(() => orders.map(o => {
    const sum = phase1.getOrderReceiptSummary(o.id, o.qty);
    return { ...o, ...sum };
  }), [orders, tick]);

  const filtered = useMemo(() => enriched.filter(o => {
    if (o.status === '초안') return false;   // 확정 전 발주는 입고 대상이 아니다
    const t = search.trim().toLowerCase();
    if (t && !`${o.orderNo} ${o.styleNo} ${o.styleName} ${o.vendorName || ''}`.toLowerCase().includes(t)) return false;
    if (filter === 'pending') return o.remaining > 0 && o.receivedQty === 0;
    if (filter === 'partial') return o.receivedQty > 0 && o.remaining > 0;
    if (filter === 'done') return o.remaining <= 0;
    return true;
  }), [enriched, filter, search]);

  const stats = useMemo(() => ({
    pending: enriched.filter(o => o.status !== '초안' && o.remaining > 0 && o.receivedQty === 0).length,
    partial: enriched.filter(o => o.receivedQty > 0 && o.remaining > 0).length,
    remainQty: enriched.filter(o => o.status !== '초안').reduce((s2, o) => s2 + Math.max(0, o.remaining), 0),
    defectQty: enriched.reduce((s2, o) => s2 + (o.defectQty || 0), 0),
  }), [enriched]);

  const allLogs = useMemo(() => {
    const logs = phase1.getReceiptLogs().sort((a, b) => b.receivedDate.localeCompare(a.receivedDate));
    return logFilter === 'all' ? logs : logs.filter(l => l.logType === logFilter);
  }, [logFilter, tick]);

  const openModal = (orderId: string, logType: ReceiptLogType) => {
    const o = orders.find(x => x.id === orderId);
    const sum = phase1.getOrderReceiptSummary(orderId, o?.qty || 0);
    const remain = logType === 'inbound' ? o!.qty - sum.receivedQty : o!.qty - sum.shippedQty;
    setForm({ qty: Math.max(0, remain), defectQty: 0, defectNote: '', date: new Date().toISOString().split('T')[0], memo: '', deliveryMarket: logType === 'outbound_oem' ? 'b2b' : 'domestic' });
    setModal({ orderId, logType });
  };

  const submitLog = () => {
    if (!modal || form.qty <= 0) { toast.error('수량을 입력하세요'); return; }
    const o = orders.find(x => x.id === modal.orderId);
    if (!o) return;
    const cur = phase1.getOrderReceiptSummary(o.id, o.qty);
    const already = modal.logType === 'inbound' ? cur.receivedQty : cur.shippedQty;
    if (already + form.qty > o.qty) {
      toast.error(`발주수량을 넘습니다 — 남은 수량 ${formatNumber(Math.max(0, o.qty - already))}개`);
      return;
    }
    if (form.defectQty > form.qty) { toast.error('불량수량이 입고수량보다 많습니다'); return; }
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
      deliveryMarket: modal.logType === 'inbound' ? undefined : form.deliveryMarket,
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

  const savePlan = async () => {
    if (!shippingForm.description.trim()) return toast.error('발송 내용을 입력하세요');
    await upsertShippingPlan({ id: genId(), ...shippingForm, description: shippingForm.description.trim() });
    await queryClient.invalidateQueries({ queryKey: ['shippingPlans'] }); setShippingOpen(false);
  };
  const checkPlan = async (id: string) => { await confirmShippingPlan(id, getCurrentUser()?.name || '담당자'); await queryClient.invalidateQueries({ queryKey: ['shippingPlans'] }); };
  const upcomingPlans = shippingPlans.filter(p => p.shipDate >= today).slice(0, 20);
  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">입고 · 출고</h1>
        <p className="text-sm text-muted-foreground">부분입고 · OEM 직출고 · 3PL 입고 (receipt_logs)</p>
      </div>

      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between gap-2 mb-3"><div><h2 className="font-semibold">중국 발송 일정</h2><p className="text-xs text-muted-foreground">오늘·예정 항공/해상 발송 공유</p></div><Button size="sm" onClick={() => setShippingOpen(true)}>발송 예정 등록</Button></div>
        <div className="grid gap-2 md:grid-cols-2">{upcomingPlans.map(p => <div key={p.id} className="rounded-lg border p-3 flex justify-between gap-2"><div className="flex gap-2">{p.method === 'air' ? <Plane className="w-4 h-4" /> : <Ship className="w-4 h-4" />}<div><p className="text-sm font-medium">{p.shipDate === today ? '오늘' : p.shipDate} · {p.description}</p><p className="text-xs text-muted-foreground">{p.orderNo || '발주번호 없음'}{p.qty ? ` · ${formatNumber(p.qty)}개` : ''}</p></div></div>{p.status === 'confirmed' ? <span className="text-xs text-[var(--system-green)]"><CheckCircle2 className="inline w-4 h-4" /> {p.confirmedBy}</span> : <Button size="sm" variant="outline" onClick={() => checkPlan(p.id)}>확인</Button>}</div>)}{upcomingPlans.length === 0 && <p className="text-sm text-muted-foreground">예정된 발송이 없습니다.</p>}</div>
      </section>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">미입고</p>
          <p className="text-2xl font-bold tabular-nums">{stats.pending}<span className="text-sm font-normal text-muted-foreground ml-1">건</span></p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">부분입고</p>
          <p className="text-2xl font-bold tabular-nums text-[var(--system-orange)]">{stats.partial}<span className="text-sm font-normal text-muted-foreground ml-1">건</span></p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">미입고 수량</p>
          <p className="text-2xl font-bold tabular-nums">{formatNumber(stats.remainQty)}</p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">불량 누계</p>
          <p className={`text-2xl font-bold tabular-nums ${stats.defectQty > 0 ? 'text-[var(--system-red)]' : ''}`}>{formatNumber(stats.defectQty)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="발주번호 · 스타일 · 공장 검색" className="h-9 w-full sm:w-72" />
        {(['all', 'pending', 'partial', 'done'] as const).map(f => (
          <Button key={f} size="sm" variant={filter === f ? 'secondary' : 'outline'}
            onClick={() => setFilter(f)}>
            {f === 'all' ? '전체' : f === 'pending' ? '미입고' : f === 'partial' ? '부분입고' : '완료'}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{filtered.length}건</span>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-x-auto">
        <table className="data-table w-full text-sm min-w-[640px]">
          <thead className="text-[13px] font-semibold text-muted-foreground">
            <tr>
              <th className="nw">발주번호</th>
              <th>스타일</th>
              <th className="num">발주</th>
              <th className="num">입고</th>
              <th className="num">출고</th>
              <th className="num">잔량</th>
              <th>처리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{search || filter !== 'all' ? '조건에 맞는 발주가 없습니다' : '입고 대상 발주가 없습니다 — 생산발주에서 먼저 등록하세요'}</p>
              </td></tr>
            )}
            {filtered.map(o => (
              <tr key={o.id} className="hover:bg-[var(--fill-quaternary)]">
                <td className="nw font-mono text-xs">{o.orderNo}</td>
                <td>
                  <p className="font-medium">{o.styleNo}</p>
                  <p className="text-xs text-muted-foreground">{o.styleName}{o.vendorName ? ` · ${o.vendorName}` : ''}</p>
                </td>
                <td className="num">{formatNumber(o.qty)}</td>
                <td className="num text-[var(--system-green)]">{formatNumber(o.receivedQty)}</td>
                <td className="num text-primary">{formatNumber(o.shippedQty)}</td>
                <td className="num font-semibold">{formatNumber(o.remaining)}</td>
                <td>
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
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="font-semibold text-foreground">입출고 이력</h2>
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
        <div className="bg-card rounded-lg border border-border divide-y divide-border">
          {allLogs.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">이력 없음</p>
          ) : allLogs.slice(0, 30).map(l => (
            <div key={l.id} className="px-4 py-3 flex flex-wrap justify-between gap-x-2 gap-y-1 text-sm">
              <div>
                <span className="font-mono text-xs">{l.orderNo}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="text-muted-foreground">{LOG_LABELS[l.logType]}</span>
                {l.destination === 'korea' && <span className="ml-1 text-[11px] text-muted-foreground">한국</span>}
                {l.destination === 'china' && <span className="ml-1 text-[11px] text-primary">중국{l.color ? `·${l.color}` : ''}</span>}
                {l.isAdvance && <span className="ml-1 text-[11px] text-[var(--system-orange)]">선입</span>}
                {l.orderNo && <span className="ml-2 text-xs text-muted-foreground">{l.orderNo}</span>}
              </div>
              <div className="text-right">
                <span className="font-semibold">{formatNumber(l.qty)}</span>
                {l.defectQty > 0 && <span className="text-[var(--system-red)] text-xs ml-2">불량 {l.defectQty}</span>}
                <span className="text-muted-foreground text-xs ml-2">{l.receivedDate}</span>
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
            <div><Label>수량</Label><Input type="number" min="0" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: +e.target.value }))} /></div>
            {modal?.logType === 'inbound' && (
              <>
                <div><Label>불량 수량</Label><Input type="number" min="0" value={form.defectQty} onChange={e => setForm(f => ({ ...f, defectQty: +e.target.value }))} /></div>
                <div><Label>불량 사유</Label><Input value={form.defectNote} onChange={e => setForm(f => ({ ...f, defectNote: e.target.value }))} /></div>
              </>
            )}
            {modal?.logType !== 'inbound' && <div><Label>배송 판매처</Label><Select value={form.deliveryMarket} onValueChange={v => setForm(f => ({ ...f, deliveryMarket: v as DeliveryMarket }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="domestic">국내</SelectItem><SelectItem value="b2b">B2B</SelectItem><SelectItem value="overseas">해외</SelectItem></SelectContent></Select></div>}            <div><Label>일자</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div><Label>메모</Label><Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>취소</Button>
            <Button onClick={submitLog}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={shippingOpen} onOpenChange={setShippingOpen}><DialogContent><DialogHeader><DialogTitle>중국 발송 예정 등록</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>발송일</Label><Input type="date" value={shippingForm.shipDate} onChange={e => setShippingForm(f => ({...f, shipDate:e.target.value}))} /></div><div><Label>방식</Label><Select value={shippingForm.method} onValueChange={v => setShippingForm(f => ({...f, method:v as ShippingMethod}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="air">항공</SelectItem><SelectItem value="sea">해상</SelectItem></SelectContent></Select></div><div><Label>내용</Label><Input value={shippingForm.description} onChange={e => setShippingForm(f => ({...f, description:e.target.value}))} /></div><div><Label>발주번호</Label><Input value={shippingForm.orderNo} onChange={e => setShippingForm(f => ({...f, orderNo:e.target.value}))} /></div><div><Label>수량</Label><Input type="number" value={shippingForm.qty} onChange={e => setShippingForm(f => ({...f, qty:Number(e.target.value)}))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setShippingOpen(false)}>취소</Button><Button onClick={savePlan}>저장</Button></DialogFooter></DialogContent></Dialog>    </div>
  );
}
