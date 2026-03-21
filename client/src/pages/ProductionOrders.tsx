// AMESCOTES ERP — 생산 발주 관리
import { useState, useMemo, useEffect } from 'react';
import {
  store, genId, calcDDay, dDayLabel, dDayColor, formatNumber, formatKRW,
  type ProductionOrder, type OrderStatus, type Season, type Item, type Bom,
  type HqSupplyItem, type OrderMilestone, type MilestoneStage, type ColorQty,
  type TradeStatement, type TradeStatementLine,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Search, Eye, Trash2, Package, ChevronRight, FileText } from 'lucide-react';

const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS'];
const ORDER_STATUSES: OrderStatus[] = ['발주생성', '샘플승인', '생산중', '선적중', '통관중', '입고완료', '지연'];
const MILESTONE_STAGES: MilestoneStage[] = ['샘플1차', '샘플승인', '생산시작', '선적', '통관', '입고완료'];

const STATUS_COLOR: Record<OrderStatus, string> = {
  '발주생성': 'bg-stone-50 text-stone-600 border-stone-200',
  '샘플승인': 'bg-blue-50 text-blue-700 border-blue-200',
  '생산중': 'bg-amber-50 text-amber-700 border-amber-200',
  '선적중': 'bg-purple-50 text-purple-700 border-purple-200',
  '통관중': 'bg-orange-50 text-orange-700 border-orange-200',
  '입고완료': 'bg-green-50 text-green-700 border-green-200',
  '지연': 'bg-red-50 text-red-600 border-red-200',
};

function newMilestones(): OrderMilestone[] {
  return MILESTONE_STAGES.map(stage => ({ stage, plannedDate: '', actualDate: '' }));
}

export default function ProductionOrders() {
  const [orders, setOrders] = useState<ProductionOrder[]>(() => store.getOrders());
  const [items] = useState<Item[]>(() => store.getItems());
  const [boms] = useState<Bom[]>(() => store.getBoms());
  const [search, setSearch] = useState('');
  const [filterBuyer, setFilterBuyer] = useState('all');
  const [buyers] = useState(() => store.getVendors().filter(v => v.type === '바이어'));
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSeason, setFilterSeason] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState<ProductionOrder | null>(null);
  const [form, setForm] = useState<Partial<ProductionOrder>>({});
  const [hqItems, setHqItems] = useState<HqSupplyItem[]>([]);
  const [colorQtys, setColorQtys] = useState<ColorQty[]>([]);

  // BOM 원가 참고 표시 (스타일 선택 시 자동 설정)
  const [selectedItemBomCost, setSelectedItemBomCost] = useState<number | null>(null);

  // 입고 처리 팝업 상태
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [receiveOrderId, setReceiveOrderId] = useState<string>('');
  const [receiveForm, setReceiveForm] = useState<{ receivedQty: number; defectQty: number; defectNote: string; receivedDate: string }>({
    receivedQty: 0, defectQty: 0, defectNote: '', receivedDate: new Date().toISOString().split('T')[0],
  });

  const refresh = () => setOrders(store.getOrders());

  const filtered = useMemo(() => {
    let list = orders;
    if (filterStatus !== 'all') list = list.filter(o => o.status === filterStatus);
    if (filterSeason !== 'all') list = list.filter(o => o.season === filterSeason);
    if (filterBuyer !== 'all') {
      // 스타일의 buyerId를 통해 필터링
      const buyerStyleIds = items.filter(i => i.buyerId === filterBuyer).map(i => i.id);
      list = list.filter(o => buyerStyleIds.includes(o.styleId));
    }
    if (search) list = list.filter(o =>
      o.orderNo.toLowerCase().includes(search.toLowerCase()) ||
      o.styleNo.toLowerCase().includes(search.toLowerCase()) ||
      o.styleName.toLowerCase().includes(search.toLowerCase())
    );
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [orders, filterStatus, filterSeason, filterBuyer, items, search]);

  const openNew = (prefillStyleId?: string) => {
    // 샘플 관리에서 prefill 데이터 확인
    const prefillRaw = localStorage.getItem('ames_prefill_order');
    let prefillStyleIdToUse = prefillStyleId;
    if (prefillRaw && !prefillStyleId) {
      try {
        const prefill = JSON.parse(prefillRaw) as { styleId: string; styleNo: string; styleName: string; season: string };
        prefillStyleIdToUse = prefill.styleId;
        localStorage.removeItem('ames_prefill_order');
      } catch { /* ignore */ }
    }

    setForm({
      season: '26SS',
      status: '발주생성',
      qty: 0,
      milestones: newMilestones(),
      hqSupplyItems: [],
      attachments: [],
    });
    setHqItems([]);
    setColorQtys([]);
    setSelectedItemBomCost(null);
    setShowModal(true);

    // prefill이 있으면 스타일 자동 선택
    if (prefillStyleIdToUse) {
      setTimeout(() => handleStyleSelect(prefillStyleIdToUse!), 0);
    }
  };

  // 샘플 관리에서 prefill 데이터가 있으면 자동으로 모달 열기
  useEffect(() => {
    const prefillRaw = localStorage.getItem('ames_prefill_order');
    if (prefillRaw) {
      openNew();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStyleSelect = (styleId: string) => {
    const item = items.find(i => i.id === styleId);
    if (!item) return;
    const revision = store.getNextRevision(item.styleNo);
    const orderNo = `${item.styleNo}-R${revision}`;
    const bom = boms.find(b => b.styleId === styleId);
    const hqFromBom: HqSupplyItem[] = bom
      ? bom.lines.filter(l => l.isHqProvided).map(l => ({
          bomLineId: l.id,
          itemName: l.itemName,
          spec: l.spec,
          unit: l.unit,
          requiredQty: 0,
          currency: 'CNY',
          purchaseStatus: '미구매' as const,
        }))
      : [];
    setHqItems(hqFromBom);
    setForm(f => ({
      ...f,
      styleId: item.id,
      styleNo: item.styleNo,
      styleName: item.name,
      orderNo,
      revision,
      bomId: bom?.id,
    }));
    setSelectedItemBomCost(item.baseCostKrw ?? null);
  };

  const handleSave = () => {
    if (!form.styleId) { toast.error('스타일을 선택해주세요'); return; }
    if (!form.vendorName) { toast.error('발주처를 입력해주세요'); return; }
    // colorQtys 합계 자동계산
    const totalQty = colorQtys.length > 0
      ? colorQtys.reduce((s, c) => s + c.qty, 0)
      : (form.qty || 0);

    const order: ProductionOrder = {
      id: genId(),
      orderNo: form.orderNo || '',
      styleId: form.styleId || '',
      styleNo: form.styleNo || '',
      styleName: form.styleName || '',
      season: form.season || '26SS',
      revision: form.revision || 1,
      isReorder: (form.revision || 1) > 1,
      qty: totalQty,
      colorQtys: colorQtys.length > 0 ? colorQtys : undefined,
      vendorId: form.vendorId || '',
      vendorName: form.vendorName || '',
      status: form.status || '발주생성',
      milestones: form.milestones || newMilestones(),
      bomId: form.bomId,
      hqSupplyItems: hqItems,
      attachments: [],
      deliveryDate: form.deliveryDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      memo: form.memo,
    };
    store.addOrder(order);
    refresh();
    setShowModal(false);
    toast.success('발주가 등록되었습니다');
  };

  const handleDelete = (id: string) => {
    if (!confirm('발주를 삭제하시겠습니까?')) return;
    store.deleteOrder(id);
    refresh();
    toast.success('삭제되었습니다');
  };

  const handleStatusChange = (id: string, status: OrderStatus) => {
    if (status === '입고완료') {
      // 입고 처리 팝업 열기
      const order = orders.find(o => o.id === id);
      setReceiveOrderId(id);
      setReceiveForm({
        receivedQty: order?.qty || 0,
        defectQty: 0,
        defectNote: '',
        receivedDate: new Date().toISOString().split('T')[0],
      });
      setShowReceiveModal(true);
      return;
    }
    store.updateOrder(id, { status, updatedAt: new Date().toISOString() });
    refresh();
  };

  const handleReceiveConfirm = () => {
    store.updateOrder(receiveOrderId, {
      status: '입고완료',
      receivedQty: receiveForm.receivedQty,
      defectQty: receiveForm.defectQty,
      defectNote: receiveForm.defectNote,
      receivedDate: receiveForm.receivedDate,
      updatedAt: new Date().toISOString(),
    });
    setShowReceiveModal(false);
    refresh();
    toast.success('입고 처리 완료');
  };

  // 거래명세표 자동 생성 (입고완료 발주에서)
  const handleCreateTradeStatement = (order: ProductionOrder) => {
    const item = items.find(i => i.id === order.styleId);
    if (!item) { toast.error('품목 정보를 찾을 수 없습니다'); return; }
    if (order.tradeStatementId) { toast.error('이미 거래명세표가 생성된 발주입니다'); return; }

    const buyer = buyers.find(b => b.id === item.buyerId);
    if (!buyer) { toast.error('바이어 정보가 없습니다. 품목의 바이어를 먼저 설정해주세요'); return; }

    const vendorCode = buyer.vendorCode || buyer.code || 'XXX';
    const statementNo = store.getNextStatementNo(vendorCode);

    // 컬러별 lines 구성
    const colorQtyList = order.colorQtys && order.colorQtys.length > 0 ? order.colorQtys : [{ color: '기본', qty: order.qty }];
    const lines: TradeStatementLine[] = colorQtyList.map(cq => ({
      id: genId(),
      description: `[${order.styleNo}] ${order.styleName}${cq.color !== '기본' ? ` (${cq.color})` : ''}`,
      qty: cq.qty,
      unitPrice: item.salePriceKrw || 0,
      taxType: '과세' as const,
      taxRate: 0.1,
    }));

    const newStatement: TradeStatement = {
      id: genId(),
      statementNo,
      vendorId: buyer.id,
      vendorName: buyer.name,
      vendorCode,
      issueDate: new Date().toISOString().split('T')[0],
      lines,
      status: '미청구',
      createdAt: new Date().toISOString(),
      memo: `발주번호 ${order.orderNo}에서 자동 생성`,
    };

    store.addTradeStatement(newStatement);
    store.updateOrder(order.id, { tradeStatementId: newStatement.id, updatedAt: new Date().toISOString() });
    refresh();
    toast.success('거래명세표 생성됨 → 거래명세표 탭에서 확인하세요');
  };

  const handleCompleteMilestone = (orderId: string, milestones: OrderMilestone[]) => {
    const today = new Date().toISOString().split('T')[0];
    const nextIdx = milestones.findIndex(m => !m.actualDate);
    if (nextIdx < 0) { toast.error('완료 처리할 마일스톤이 없습니다'); return; }
    const updated = milestones.map((m, i) => i === nextIdx ? { ...m, actualDate: today } : m);
    // E. 마지막 마일스톤(입고완료) 완료 시 자동으로 status → "입고완료"
    const isAllDone = updated.every(m => !!m.actualDate);
    const isLastStage = milestones[nextIdx].stage === '입고완료';
    const updatePayload: Partial<ProductionOrder> = { milestones: updated, updatedAt: new Date().toISOString() };
    if (isAllDone || isLastStage) {
      updatePayload.status = '입고완료';
    }
    store.updateOrder(orderId, updatePayload);
    refresh();
    if (updatePayload.status === '입고완료') {
      toast.success(`"${milestones[nextIdx].stage}" 완료 → 발주 상태가 "입고완료"로 자동 변경되었습니다 ✅`);
    } else {
      toast.success(`"${milestones[nextIdx].stage}" 마일스톤 완료 처리`);
    }
  };

  const updateMilestone = (idx: number, field: keyof OrderMilestone, value: string) => {
    setForm(f => {
      const milestones = [...(f.milestones || [])];
      milestones[idx] = { ...milestones[idx], [field]: value };
      return { ...f, milestones };
    });
  };

  const [showFactoryView, setShowFactoryView] = useState(false);

  const stats = useMemo(() => ({
    total: orders.length,
    inProgress: orders.filter(o => ['샘플승인', '생산중'].includes(o.status)).length,
    reorders: orders.filter(o => o.isReorder).length,
    urgent: orders.filter(o => {
      const next = o.milestones.filter(m => !m.actualDate && m.plannedDate).sort((a, b) => (a.plannedDate || '').localeCompare(b.plannedDate || ''))[0];
      return next && calcDDay(next.plannedDate) <= 7;
    }).length,
  }), [orders]);

  // 공장별 발주 현황
  const factoryStats = useMemo(() => {
    const map = new Map<string, { name: string; total: number; inProgress: number; totalQty: number }>();
    orders.forEach(o => {
      const key = o.vendorName || '미지정';
      const cur = map.get(key) || { name: key, total: 0, inProgress: 0, totalQty: 0 };
      cur.total++;
      cur.totalQty += o.qty;
      if (!['입고완료'].includes(o.status)) cur.inProgress++;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [orders]);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-stone-800">생산 발주</h1>
          <p className="text-xs md:text-sm text-stone-500 mt-0.5 hidden sm:block">발주 생성 시 BOM 자동 로드 · 본사제공 자재 체크</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFactoryView(v => !v)}
            className={`hidden sm:block px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${showFactoryView ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}
          >
            공장별 현황
          </button>
          <Button onClick={() => openNew()} className="bg-amber-700 hover:bg-amber-800 text-white gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-10 px-2 md:px-4">
            <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />발주 등록
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: '전체 발주', value: stats.total, color: 'text-stone-800' },
          { label: '진행중', value: stats.inProgress, color: 'text-amber-700' },
          { label: '리오더', value: stats.reorders, color: 'text-blue-700' },
          { label: '긴급 (D-7 이내)', value: stats.urgent, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-stone-200 p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-stone-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 공장별 발주 현황 */}
      {showFactoryView && (
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-sm font-semibold text-stone-700 mb-3">공장별 발주 현황</p>
          {factoryStats.length === 0 ? (
            <p className="text-xs text-stone-400 text-center py-4">등록된 발주가 없습니다</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50">
                  <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">공장명</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">전체 발주</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">진행중</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">총 수량</th>
                </tr>
              </thead>
              <tbody>
                {factoryStats.map(f => (
                  <tr key={f.name} className="border-b border-stone-50">
                    <td className="px-3 py-2 font-medium text-stone-700">{f.name}</td>
                    <td className="px-3 py-2 text-center text-stone-600">{f.total}건</td>
                    <td className="px-3 py-2 text-center">
                      <span className={f.inProgress > 0 ? 'text-amber-700 font-medium' : 'text-stone-400'}>{f.inProgress}건</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-stone-700">{f.totalQty.toLocaleString()} PCS</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="발주번호 / 스타일 검색" className="pl-9 h-9" />
        </div>
        <Select value={filterSeason} onValueChange={setFilterSeason}>
          <SelectTrigger className="w-28 h-9"><SelectValue placeholder="시즌" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 시즌</SelectItem>
            {SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterBuyer} onValueChange={setFilterBuyer}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="바이어" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 바이어</SelectItem>
            {buyers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* 테이블 (데스크탑) */}
      <div className="hidden md:block bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">발주번호</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">스타일</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">시즌</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">발주처</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">납기일</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">상태</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">진행률</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">다음 마일스톤</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-stone-400">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 발주가 없습니다</p>
              </td></tr>
            ) : filtered.map(o => {
              const nextMilestone = o.milestones.filter(m => !m.actualDate && m.plannedDate).sort((a, b) => (a.plannedDate || '').localeCompare(b.plannedDate || ''))[0];
              const dday = nextMilestone ? calcDDay(nextMilestone.plannedDate) : null;
              const completedMilestones = o.milestones.filter(m => !!m.actualDate).length;
              const totalMilestones = o.milestones.length;
              const progressPct = totalMilestones > 0 ? Math.round(completedMilestones / totalMilestones * 100) : 0;
              return (
                <tr key={o.id} className="border-b border-stone-50 hover:bg-stone-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-stone-800">{o.orderNo}</span>
                      {o.isReorder && <Badge variant="outline" className="text-[10px] h-4 text-blue-600 border-blue-200">리오더</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-stone-700">{o.styleNo}</p>
                    <p className="text-xs text-stone-400">{o.styleName}</p>
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{o.season}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <p className="font-mono text-stone-700">{formatNumber(o.qty)}</p>
                    {(o.colorQtys || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-end mt-1">
                        {(o.colorQtys || []).map((cq, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 bg-stone-100 text-stone-600 rounded">
                            {cq.color} {cq.qty}
                          </span>
                        ))}
                      </div>
                    )}
                    {o.receivedQty !== undefined && (
                      <p className="text-[10px] text-green-600 mt-0.5">입고 {formatNumber(o.receivedQty)}{o.defectQty ? ` / 불량 ${o.defectQty}` : ''}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{o.vendorName}</td>
                  <td className="px-4 py-3 text-xs">
                    {o.deliveryDate ? (
                      <span className={`font-mono ${calcDDay(o.deliveryDate) < 0 ? 'text-red-600 font-bold' : calcDDay(o.deliveryDate) <= 14 ? 'text-amber-600' : 'text-stone-600'}`}>
                        {o.deliveryDate}
                      </span>
                    ) : <span className="text-stone-300">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Select value={o.status} onValueChange={v => handleStatusChange(o.id, v as OrderStatus)}>
                      <SelectTrigger className={`h-7 text-xs w-28 border ${STATUS_COLOR[o.status]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1 min-w-[80px]">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-stone-500">{completedMilestones}/{totalMilestones}</span>
                        <span className={progressPct === 100 ? 'text-green-600 font-bold' : 'text-amber-600'}>{progressPct}%</span>
                      </div>
                      <div className="w-full bg-stone-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${progressPct === 100 ? 'bg-green-500' : progressPct > 50 ? 'bg-amber-500' : 'bg-blue-400'}`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {nextMilestone && dday !== null ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-stone-500">{nextMilestone.stage}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${dDayColor(dday)}`}>{dDayLabel(dday)}</span>
                      </div>
                    ) : <span className="text-xs text-stone-300">-</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      {o.milestones.some(m => !m.actualDate) && (
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-green-700 border-green-300 hover:bg-green-50" onClick={() => handleCompleteMilestone(o.id, o.milestones)}>
                          ✅ 완료
                        </Button>
                      )}
                      {o.status === '입고완료' && (
                        o.tradeStatementId ? (
                          <Badge variant="outline" className="text-[10px] h-6 px-2 text-amber-700 border-amber-300 bg-amber-50">
                            명세표 발행됨
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
                            onClick={() => handleCreateTradeStatement(o)}
                          >
                            <FileText className="w-3 h-3 mr-1" />명세표 생성
                          </Button>
                        )
                      )}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowDetail(o)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(o.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 카드 리스트 (모바일) */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-stone-400 bg-white rounded-xl border border-stone-200">
            <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">등록된 발주가 없습니다</p>
          </div>
        ) : filtered.map(o => {
          const nextMilestone = o.milestones.filter(m => !m.actualDate && m.plannedDate).sort((a, b) => (a.plannedDate || '').localeCompare(b.plannedDate || ''))[0];
          const dday = nextMilestone ? calcDDay(nextMilestone.plannedDate) : null;
          const completedMilestones = o.milestones.filter(m => !!m.actualDate).length;
          const totalMilestones = o.milestones.length;
          const progressPct = totalMilestones > 0 ? Math.round(completedMilestones / totalMilestones * 100) : 0;
          return (
            <div key={o.id} className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-stone-800 text-sm">{o.orderNo}</span>
                    {o.isReorder && <Badge variant="outline" className="text-[10px] h-4 text-blue-600 border-blue-200">리오더</Badge>}
                  </div>
                  <p className="font-medium text-stone-700 text-sm mt-0.5">{o.styleNo}</p>
                  <p className="text-xs text-stone-400">{o.styleName}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${STATUS_COLOR[o.status]}`}>{o.status}</span>
              </div>
              {/* 공장 + 수량 + 납기 */}
              <div className="flex items-center gap-4 mt-3 text-xs text-stone-600">
                <span>🏭 {o.vendorName || '-'}</span>
                <span>📦 {formatNumber(o.qty)} PCS</span>
                {o.deliveryDate && (
                  <span className={`font-mono font-semibold ${calcDDay(o.deliveryDate) < 0 ? 'text-red-600' : calcDDay(o.deliveryDate) <= 14 ? 'text-amber-600' : 'text-stone-600'}`}>
                    {o.deliveryDate}
                  </span>
                )}
              </div>
              {/* 진행률 바 */}
              <div className="mt-3 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-stone-500">마일스톤 {completedMilestones}/{totalMilestones}</span>
                  {nextMilestone && dday !== null && (
                    <span className="flex items-center gap-1">
                      <span className="text-stone-500">{nextMilestone.stage}</span>
                      <span className={`px-1.5 py-0.5 rounded font-mono ${dDayColor(dday)}`}>{dDayLabel(dday)}</span>
                    </span>
                  )}
                  <span className={progressPct === 100 ? 'text-green-600 font-bold' : 'text-amber-600'}>{progressPct}%</span>
                </div>
                <div className="w-full bg-stone-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${progressPct === 100 ? 'bg-green-500' : progressPct > 50 ? 'bg-amber-500' : 'bg-blue-400'}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
              {/* 액션 */}
              <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-stone-100">
                {o.milestones.some(m => !m.actualDate) && (
                  <Button variant="outline" size="sm" className="h-8 px-2 text-xs text-green-700 border-green-300" onClick={() => handleCompleteMilestone(o.id, o.milestones)}>
                    ✅ 완료
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setShowDetail(o)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(o.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 발주 등록 모달 */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-2xl sm:rounded-lg sm:max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>발주 등록</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-1 sm:col-span-2">
                <Label>스타일 *</Label>
                <Select value={form.styleId || ''} onValueChange={handleStyleSelect}>
                  <SelectTrigger><SelectValue placeholder="스타일 선택" /></SelectTrigger>
                  <SelectContent>
                    {items.map(i => <SelectItem key={i.id} value={i.id}>{i.styleNo} — {i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.orderNo && (
                <div className="col-span-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-xs text-amber-700">발주번호: <span className="font-mono font-bold">{form.orderNo}</span>
                    {(form.revision || 1) > 1 && <span className="ml-2 text-blue-600">(리오더 #{form.revision})</span>}
                  </p>
                  {selectedItemBomCost !== null && selectedItemBomCost > 0 && (
                    <p className="text-xs text-stone-600 mt-1">
                      📊 BOM 원가: <span className="font-bold text-stone-800">{formatKRW(selectedItemBomCost)}</span>
                      <span className="text-stone-400 ml-1">(참고용)</span>
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <Label>시즌</Label>
                <Select value={form.season || '26SS'} onValueChange={v => setForm(f => ({ ...f, season: v as Season }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>바이어 납기일 <span className="text-stone-400 text-xs">(납품 목표일)</span></Label>
                <Input
                  type="date"
                  value={form.deliveryDate || ''}
                  onChange={e => setForm(f => ({ ...f, deliveryDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>수량 (PCS) — 컬러별 입력 시 자동 합산</Label>
                <Input
                  type="number"
                  value={colorQtys.length > 0 ? colorQtys.reduce((s, c) => s + c.qty, 0) : (form.qty || '')}
                  onChange={e => { if (colorQtys.length === 0) setForm(f => ({ ...f, qty: parseInt(e.target.value) || 0 })); }}
                  placeholder="0"
                  readOnly={colorQtys.length > 0}
                  className={colorQtys.length > 0 ? 'bg-stone-50 text-stone-500' : ''}
                />
              </div>
              {/* 컬러별 수량 */}
              <div className="col-span-2 space-y-2">
                <div className="flex items-center justify-between">
                  <Label>컬러별 수량</Label>
                  <Button
                    type="button" variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => setColorQtys(prev => [...prev, { color: '', qty: 0 }])}
                  >
                    <Plus className="w-3 h-3 mr-1" />컬러 추가
                  </Button>
                </div>
                {colorQtys.length === 0 ? (
                  <p className="text-xs text-stone-400">컬러 추가 버튼으로 컬러별 수량을 입력하세요</p>
                ) : (
                  <div className="space-y-1.5">
                    {colorQtys.map((cq, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          className="flex-1 h-8 text-sm"
                          placeholder="컬러명 (예: 블랙)"
                          value={cq.color}
                          onChange={e => setColorQtys(prev => prev.map((c, i) => i === idx ? { ...c, color: e.target.value } : c))}
                        />
                        <Input
                          type="number"
                          min={0}
                          className="w-24 h-8 text-sm text-center"
                          placeholder="수량"
                          value={cq.qty || ''}
                          onChange={e => setColorQtys(prev => prev.map((c, i) => i === idx ? { ...c, qty: parseInt(e.target.value) || 0 } : c))}
                        />
                        <Button
                          type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-400 hover:text-red-600"
                          onClick={() => setColorQtys(prev => prev.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                    <p className="text-xs text-stone-500 text-right">
                      합계: <span className="font-mono font-bold">{colorQtys.reduce((s, c) => s + c.qty, 0).toLocaleString()} PCS</span>
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>발주처 *</Label>
                <Select value={form.vendorId || ''} onValueChange={v => {
                  const vendor = store.getVendors().find(x => x.id === v);
                  // 자동 납기일 계산 (leadTimeDays 기반)
                  if (vendor?.leadTimeDays && vendor.leadTimeDays > 0) {
                    const suggestedDate = new Date();
                    suggestedDate.setDate(suggestedDate.getDate() + vendor.leadTimeDays);
                    const dateStr = suggestedDate.toISOString().split('T')[0];
                    if (!form.deliveryDate) {
                      setForm(f => ({ ...f, vendorId: v, vendorName: vendor?.name || '', deliveryDate: dateStr }));
                      toast.info(`📅 예상 납기일 자동 설정: ${dateStr} (리드타임 ${vendor.leadTimeDays}일 기준)`);
                      return;
                    }
                  }
                  setForm(f => ({ ...f, vendorId: v, vendorName: vendor?.name || '' }));
                }}>
                  <SelectTrigger><SelectValue placeholder="발주처 선택" /></SelectTrigger>
                  <SelectContent>
                    {store.getVendors().filter(v => v.type === '공장' || v.type === '해외공장').map(v => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                        {v.leadTimeDays ? <span className="text-stone-400 ml-1">({v.leadTimeDays}일)</span> : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {hqItems.length > 0 && (
              <div>
                <Label className="text-sm font-semibold text-stone-700 mb-2 block">본사제공 자재 (BOM 자동 추출)</Label>
                <div className="border border-stone-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-stone-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-stone-500">품목명</th>
                        <th className="text-right px-3 py-2 font-medium text-stone-500">필요수량</th>
                        <th className="text-left px-3 py-2 font-medium text-stone-500">구매상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hqItems.map((item, idx) => (
                        <tr key={item.bomLineId} className="border-t border-stone-100">
                          <td className="px-3 py-2 font-medium text-stone-700">{item.itemName} {item.spec && `(${item.spec})`}</td>
                          <td className="px-3 py-2">
                            <Input type="number" value={item.requiredQty || ''} onChange={e => {
                              const updated = [...hqItems];
                              updated[idx] = { ...updated[idx], requiredQty: parseInt(e.target.value) || 0 };
                              setHqItems(updated);
                            }} className="h-6 text-xs w-20 ml-auto" />
                          </td>
                          <td className="px-3 py-2">
                            <Select value={item.purchaseStatus} onValueChange={v => {
                              const updated = [...hqItems];
                              updated[idx] = { ...updated[idx], purchaseStatus: v as HqSupplyItem['purchaseStatus'] };
                              setHqItems(updated);
                            }}>
                              <SelectTrigger className="h-6 text-xs w-24"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="미구매">미구매</SelectItem>
                                <SelectItem value="구매완료">구매완료</SelectItem>
                                <SelectItem value="발송완료">발송완료</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <Label className="text-sm font-semibold text-stone-700 mb-2 block">마일스톤 일정</Label>
              <div className="space-y-2">
                {(form.milestones || []).map((m, idx) => (
                  <div key={m.stage} className="flex items-center gap-3">
                    <ChevronRight className="w-3.5 h-3.5 text-stone-300 shrink-0" />
                    <span className="text-xs text-stone-600 w-20 shrink-0">{m.stage}</span>
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] text-stone-400 mb-0.5">예정일</p>
                        <Input type="date" value={m.plannedDate || ''} onChange={e => updateMilestone(idx, 'plannedDate', e.target.value)} className="h-7 text-xs" />
                      </div>
                      <div>
                        <p className="text-[10px] text-stone-400 mb-0.5">실제완료일</p>
                        <Input type="date" value={m.actualDate || ''} onChange={e => updateMilestone(idx, 'actualDate', e.target.value)} className="h-7 text-xs" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>메모</Label>
              <Input value={form.memo || ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">발주 등록</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 입고 처리 팝업 */}
      <Dialog open={showReceiveModal} onOpenChange={setShowReceiveModal}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-md sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>입고 처리</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-stone-600">입고 수량과 불량 수량을 입력해주세요.</p>
            <div className="space-y-1.5">
              <Label>입고일</Label>
              <Input type="date" value={receiveForm.receivedDate} onChange={e => setReceiveForm(f => ({ ...f, receivedDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>실제 입고 수량</Label>
              <Input type="number" min={0} value={receiveForm.receivedQty} onChange={e => setReceiveForm(f => ({ ...f, receivedQty: parseInt(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1.5">
              <Label>불량 수량</Label>
              <Input type="number" min={0} value={receiveForm.defectQty} onChange={e => setReceiveForm(f => ({ ...f, defectQty: parseInt(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1.5">
              <Label>불량 비고</Label>
              <Input placeholder="예: 박음질 불량, 변색 등" value={receiveForm.defectNote} onChange={e => setReceiveForm(f => ({ ...f, defectNote: e.target.value }))} />
            </div>
            {receiveForm.defectQty > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                양품: {receiveForm.receivedQty - receiveForm.defectQty}개 / 불량: {receiveForm.defectQty}개
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReceiveModal(false)}>취소</Button>
            <Button onClick={handleReceiveConfirm} className="bg-green-700 hover:bg-green-800 text-white">입고 완료</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showDetail && (
        <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
          <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-2xl sm:rounded-lg sm:max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono">{showDetail.orderNo}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLOR[showDetail.status]}`}>{showDetail.status}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><p className="text-xs text-stone-400">스타일</p><p className="font-medium">{showDetail.styleNo}</p></div>
                <div><p className="text-xs text-stone-400">시즌</p><p className="font-medium">{showDetail.season}</p></div>
                <div><p className="text-xs text-stone-400">수량</p><p className="font-mono font-medium">{formatNumber(showDetail.qty)} PCS</p></div>
                <div><p className="text-xs text-stone-400">발주처</p><p className="font-medium">{showDetail.vendorName}</p></div>
                <div><p className="text-xs text-stone-400">리오더</p><p className="font-medium">{showDetail.isReorder ? `${showDetail.revision}차` : '신규'}</p></div>
              </div>
              <div>
                <p className="text-xs font-semibold text-stone-500 mb-2">마일스톤 진행 현황</p>
                <div className="space-y-2">
                  {showDetail.milestones.map(m => {
                    const dday = m.plannedDate ? calcDDay(m.plannedDate) : null;
                    const done = !!m.actualDate;
                    return (
                      <div key={m.stage} className={`flex items-center gap-3 p-2 rounded-lg ${done ? 'bg-green-50' : 'bg-stone-50'}`}>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${done ? 'bg-green-500 border-green-500' : 'border-stone-300'}`}>
                          {done && <span className="text-white text-[8px]">✓</span>}
                        </div>
                        <span className={`text-xs flex-1 ${done ? 'text-green-700 line-through' : 'text-stone-700'}`}>{m.stage}</span>
                        {m.plannedDate && <span className="text-xs text-stone-400">{m.plannedDate}</span>}
                        {dday !== null && !done && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${dDayColor(dday)}`}>{dDayLabel(dday)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {showDetail.hqSupplyItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-stone-500 mb-2">본사제공 자재</p>
                  <div className="space-y-1">
                    {showDetail.hqSupplyItems.map((item, idx) => (
                      <div key={idx} className={`flex items-center justify-between p-2 rounded text-xs ${item.purchaseStatus === '발송완료' ? 'bg-green-50 text-green-700' : item.purchaseStatus === '구매완료' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                        <span>{item.itemName} {item.spec && `(${item.spec})`}</span>
                        <span className="font-mono">{item.requiredQty} {item.unit} — {item.purchaseStatus}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDetail(null)}>닫기</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
