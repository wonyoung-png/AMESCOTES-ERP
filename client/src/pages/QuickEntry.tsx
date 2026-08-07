// 간편등록 — 밖에서 최소 정보만 넣고 저장, 상세는 자리에서 마감.
// 발주는 '초안' 상태로 저장되고, 생산발주 화면에서 확정하면 정식 발주번호가 붙는다.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { genId, type Item, type Vendor, type ProductionOrder } from '@/lib/store';
import { fetchItems, fetchVendors, fetchOrders, upsertOrder } from '@/lib/supabaseQueries';
import { phase1 } from '@/lib/phase1';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Factory, Package, AlertTriangle, ChevronRight, Search, Check } from 'lucide-react';

type Mode = 'menu' | 'order' | 'receive' | 'defect';

export default function QuickEntry() {
  const queryClient = useQueryClient();
  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: fetchItems });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });

  const [mode, setMode] = useState<Mode>('menu');
  const [saving, setSaving] = useState(false);

  const factories = useMemo(
    () => (vendors as Vendor[]).filter(v => v.type === '공장' || v.type === '해외공장'),
    [vendors],
  );
  const drafts = useMemo(
    () => (orders as ProductionOrder[]).filter(o => o.status === '초안'),
    [orders],
  );

  // ── 발주 초안 ──
  const [q, setQ] = useState('');
  const [pickedItem, setPickedItem] = useState<Item | null>(null);
  const [qty, setQty] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [delivery, setDelivery] = useState('');
  const [memo, setMemo] = useState('');

  const candidates = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return (items as Item[]).slice(0, 8);
    return (items as Item[])
      .filter(i => `${i.styleNo} ${i.name}`.toLowerCase().includes(t))
      .slice(0, 12);
  }, [items, q]);

  const resetOrder = () => {
    setQ(''); setPickedItem(null); setQty(''); setFactoryId(''); setDelivery(''); setMemo('');
  };

  const saveDraftOrder = async () => {
    if (!pickedItem) { toast.error('스타일을 고르세요'); return; }
    if (!Number(qty)) { toast.error('수량을 넣으세요'); return; }
    setSaving(true);
    const factory = factories.find(f => f.id === factoryId);
    const draft = {
      id: genId(),
      orderNo: `임시-${pickedItem.styleNo}-${new Date().toISOString().slice(5, 10).replace('-', '')}`,
      workspace: 'OEM',
      styleId: pickedItem.id,
      styleNo: pickedItem.styleNo,
      styleName: pickedItem.name,
      season: pickedItem.season,
      qty: Number(qty),
      colorQtys: [],
      vendorId: factoryId || '',
      vendorName: factory?.name || '',
      orderDate: new Date().toISOString().split('T')[0],
      deliveryDate: delivery || undefined,
      status: '초안',
      memo: memo || undefined,
      attachments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as ProductionOrder;

    try {
      await upsertOrder(draft);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.success('초안 저장됨 — PC에서 확정하세요');
      resetOrder();
      setMode('menu');
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── 입고 / 불량 메모 ──
  const [logOrderNo, setLogOrderNo] = useState('');
  const [logQty, setLogQty] = useState('');
  const [logNote, setLogNote] = useState('');

  const saveReceive = () => {
    if (!logOrderNo.trim() || !Number(logQty)) { toast.error('발주번호와 수량을 넣으세요'); return; }
    const target = (orders as ProductionOrder[]).find(o => o.orderNo === logOrderNo.trim());
    phase1.addReceiptLog({
      orderId: target?.id || '',
      orderNo: logOrderNo.trim(),
      logType: 'inbound',
      qty: Number(logQty),
      defectQty: 0,
      receivedDate: new Date().toISOString().split('T')[0],
      memo: logNote || undefined,
      destination: 'korea',
    });
    toast.success('입고 기록됨');
    setLogOrderNo(''); setLogQty(''); setLogNote(''); setMode('menu');
  };

  const saveDefect = () => {
    if (!logOrderNo.trim() || !Number(logQty)) { toast.error('발주번호와 금액을 넣으세요'); return; }
    const order = (orders as ProductionOrder[]).find(o => o.orderNo === logOrderNo.trim());
    phase1.addDefectCarryover({
      orderNo: logOrderNo.trim(),
      vendorId: order?.vendorId || '',
      vendorName: order?.vendorName || '',
      amountKrw: Number(logQty),
      reason: logNote || '입고 불량',
    } as any);
    toast.success('불량 차감 기록됨');
    setLogOrderNo(''); setLogQty(''); setLogNote(''); setMode('menu');
  };

  // ── 화면 ──
  const Tile = ({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) => (
    <button onClick={onClick}
      className="w-full flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-[var(--fill-quaternary)] text-left transition-colors">
      <span className="w-11 h-11 rounded-lg bg-[var(--fill-tertiary)] flex items-center justify-center shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{desc}</span>
      </span>
      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
    </button>
  );

  return (
    <div className="p-4 md:p-6 max-w-xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">간편등록</h1>
        <p className="text-sm text-muted-foreground mt-0.5">밖에서 최소한만 입력하고, 상세는 자리에서 마무리합니다</p>
      </div>

      {drafts.length > 0 && (
        <Link href="/orders"
          className="flex items-center gap-3 p-3 rounded-lg border border-[var(--system-orange)]/30 bg-[var(--system-orange)]/10">
          <AlertTriangle className="w-4 h-4 text-[var(--system-orange)] shrink-0" />
          <span className="text-sm flex-1">확정 안 된 초안 <b>{drafts.length}건</b></span>
          <span className="text-xs text-muted-foreground">생산발주에서 마감 →</span>
        </Link>
      )}

      {mode === 'menu' && (
        <div className="space-y-2.5">
          <Tile icon={<Factory className="w-5 h-5" />} title="발주 초안" desc="스타일 · 수량 · 공장 · 납기만" onClick={() => setMode('order')} />
          <Tile icon={<Package className="w-5 h-5" />} title="입고 기록" desc="발주번호 · 수량" onClick={() => { setMode('receive'); }} />
          <Tile icon={<AlertTriangle className="w-5 h-5" />} title="불량 차감" desc="발주번호 · 금액 · 사유" onClick={() => { setMode('defect'); }} />
        </div>
      )}

      {mode === 'order' && (
        <div className="space-y-4">
          {!pickedItem ? (
            <div className="space-y-2">
              <Label>스타일</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="스타일번호 · 품명" className="pl-9 h-11 text-base" />
              </div>
              <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                {candidates.length === 0 && <p className="p-4 text-sm text-muted-foreground">결과 없음</p>}
                {candidates.map(i => (
                  <button key={i.id} onClick={() => setPickedItem(i)}
                    className="w-full text-left px-4 py-3 hover:bg-[var(--fill-quaternary)]">
                    <span className="block text-sm font-medium">{i.styleNo}</span>
                    <span className="block text-xs text-muted-foreground">{i.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--fill-tertiary)]">
                <Check className="w-4 h-4 shrink-0" />
                <span className="text-sm flex-1 min-w-0">
                  <b>{pickedItem.styleNo}</b> <span className="text-muted-foreground">{pickedItem.name}</span>
                </span>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPickedItem(null)}>변경</Button>
              </div>

              <div className="space-y-1.5">
                <Label>수량 (PCS) *</Label>
                <Input type="number" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} className="h-11 text-base" placeholder="0" />
              </div>

              <div className="space-y-1.5">
                <Label>공장</Label>
                <select value={factoryId} onChange={e => setFactoryId(e.target.value)}
                  className="w-full h-11 rounded-md border border-border bg-card px-3 text-base">
                  <option value="">나중에 지정</option>
                  {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>납기</Label>
                <Input type="date" value={delivery} onChange={e => setDelivery(e.target.value)} className="h-11 text-base" />
              </div>

              <div className="space-y-1.5">
                <Label>메모</Label>
                <Input value={memo} onChange={e => setMemo(e.target.value)} className="h-11 text-base" placeholder="컬러·조건 등 기억할 것" />
              </div>

              <p className="text-xs text-muted-foreground">
                컬러별 수량·단가·BOM은 비워둡니다. 초안으로 저장되고 발주번호는 확정할 때 붙습니다.
              </p>
            </>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => { resetOrder(); setMode('menu'); }}>취소</Button>
            <Button className="flex-1 h-11" disabled={saving || !pickedItem} onClick={saveDraftOrder}>
              {saving ? '저장 중…' : '초안 저장'}
            </Button>
          </div>
        </div>
      )}

      {(mode === 'receive' || mode === 'defect') && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>발주번호 *</Label>
            <Input autoFocus value={logOrderNo} onChange={e => setLogOrderNo(e.target.value)}
              className="h-11 text-base font-mono" placeholder="LLL2607HB92-R1" />
          </div>
          <div className="space-y-1.5">
            <Label>{mode === 'receive' ? '입고 수량 *' : '차감 금액 (원) *'}</Label>
            <Input type="number" inputMode="numeric" value={logQty} onChange={e => setLogQty(e.target.value)} className="h-11 text-base" placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label>{mode === 'receive' ? '메모' : '사유'}</Label>
            <Input value={logNote} onChange={e => setLogNote(e.target.value)} className="h-11 text-base"
              placeholder={mode === 'receive' ? '박스 수량 등' : '입고 불량'} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => { setLogOrderNo(''); setLogQty(''); setLogNote(''); setMode('menu'); }}>취소</Button>
            <Button className="flex-1 h-11" onClick={mode === 'receive' ? saveReceive : saveDefect}>저장</Button>
          </div>
        </div>
      )}
    </div>
  );
}
