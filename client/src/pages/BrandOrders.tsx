// 리오더 · 오더관리 — R3 승인 + 차수별 입고·지출결의
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { store, formatNumber, normalizeColors, type OrderStatus } from '@/lib/store';
import {
  phase1, R3_STEPS, CHINA_CORP_VENDOR_CODE, CHINA_CORP_VENDOR_NAME,
  type BrandOrderBatch, type OrderDisplayStatus, type ReceiptDestination, type ReorderOrderRow,
} from '@/lib/phase1';
import { fetchOrders } from '@/lib/supabaseQueries';
import { applyColorTestData } from '@/lib/fillItemColorsForTest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Check, X, Split, Send, Package, Factory, Palette } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { getAssigneeForStep, R3_ROLE_LABEL, R3_STEP_ROLE } from '@/lib/orgChart';

const PIPELINE = ['발주', '진행중', '생산완료', '한국/중국입고', '지출결의', '공장결제'] as const;

const STATUS_CLASS: Record<OrderDisplayStatus, string> = {
  결제완료: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  지출결의: 'bg-violet-100 text-violet-800 border-violet-200',
  입고완료: 'bg-sky-100 text-sky-800 border-sky-200',
  부분입고: 'bg-amber-100 text-amber-800 border-amber-200',
  선입고: 'bg-orange-100 text-orange-800 border-orange-200',
  생산완료: 'bg-blue-100 text-blue-800 border-blue-200',
  진행중: 'bg-stone-100 text-stone-700 border-stone-200',
  발주: 'bg-white text-stone-600 border-stone-200',
};

function ensureChinaCorpVendor(): { id: string; name: string } {
  const vendors = store.getVendors();
  const found = vendors.find(v =>
    v.code === CHINA_CORP_VENDOR_CODE || v.name.includes('중국법인') || v.name === CHINA_CORP_VENDOR_NAME,
  );
  if (found) return { id: found.id, name: found.name };
  const id = `vendor-${CHINA_CORP_VENDOR_CODE}`;
  store.addVendor({
    id,
    name: CHINA_CORP_VENDOR_NAME,
    code: CHINA_CORP_VENDOR_CODE,
    type: '기타',
    customType: '중국법인',
    country: '중국',
    currency: 'CNY',
    contactHistory: [],
    createdAt: new Date().toISOString(),
  });
  return { id, name: CHINA_CORP_VENDOR_NAME };
}

export default function BrandOrders() {
  const { workspace } = useWorkspace();
  const ws = workspace === 'AETALOOP' ? 'AETALOOP' : 'LUMEN';
  const queryClient = useQueryClient();
  const { data: remoteOrders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
  const [, tick] = useState(0);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    tick(n => n + 1);
  };

  const localOrders = store.getOrders();
  const orders = useMemo(() => {
    const map = new Map<string, (typeof localOrders)[0]>();
    [...remoteOrders, ...localOrders].forEach(o => map.set(o.id, o as (typeof localOrders)[0]));
    return [...map.values()];
  }, [remoteOrders, localOrders, tick]);

  const batches = phase1.getBrandBatches(ws);
  const items = store.getItems();
  const factories = store.getVendors().filter(v => v.type === '공장' || v.type === '임가공');

  const [mainTab, setMainTab] = useState('mgmt');
  const [selected, setSelected] = useState<BrandOrderBatch | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [lineForm, setLineForm] = useState({
    styleNo: '', qty: 0, factoryId: '', productionOrigin: 'china' as 'domestic' | 'china',
  });
  const [lineColorQtys, setLineColorQtys] = useState<{ color: string; qty: number }[]>([]);

  const [progressFilter, setProgressFilter] = useState<'active' | 'done' | 'all'>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [styleSearch, setStyleSearch] = useState('');
  const [detailRow, setDetailRow] = useState<ReorderOrderRow | null>(null);
  const [recvFocusColor, setRecvFocusColor] = useState<string>('');

  const [recvOpen, setRecvOpen] = useState(false);
  const [recvForm, setRecvForm] = useState({
    destination: 'korea' as ReceiptDestination,
    qty: 0,
    color: '',
    date: new Date().toISOString().slice(0, 10),
    isAdvance: false,
    memo: '',
    createPayable: true,
  });

  const detail = selected ? phase1.getBrandBatch(selected.id) : null;
  const actorName = getCurrentUser()?.name || '시스템';
  const stepAssignee = detail
    ? getAssigneeForStep(detail.approvalStep, ws)
    : null;

  const board = useMemo(() => {
    const groups = phase1.getReorderOrderBoard(
      orders.map(o => ({
        id: o.id,
        orderNo: o.orderNo,
        styleNo: o.styleNo,
        styleName: o.styleName,
        revision: o.revision,
        isReorder: o.isReorder,
        brandBatchId: o.brandBatchId,
        orderDate: o.orderDate,
        createdAt: o.createdAt,
        qty: o.qty,
        status: o.status,
        colorQtys: o.colorQtys,
        vendorId: o.vendorId,
        vendorName: o.vendorName,
        workspace: o.workspace,
        projectNo: o.projectNo,
        factoryUnitPriceKrw: o.factoryUnitPriceKrw,
      })),
      ws,
      items.map(i => ({ styleNo: i.styleNo, name: i.name, erpCategory: i.erpCategory })),
    );
    return groups
      .map(g => ({
        ...g,
        rows: g.rows.filter(r => {
          if (progressFilter === 'active' && r.isComplete) return false;
          if (progressFilter === 'done' && !r.isComplete) return false;
          return true;
        }),
      }))
      .filter(g => {
        if (!g.rows.length) return false;
        if (categoryFilter !== 'all' && (g.erpCategory || '') !== categoryFilter) return false;
        if (styleSearch.trim()) {
          const q = styleSearch.trim().toLowerCase();
          return g.styleNo.toLowerCase().includes(q) || g.styleName.toLowerCase().includes(q);
        }
        return true;
      });
  }, [orders, items, ws, progressFilter, categoryFilter, styleSearch, tick]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => { if (i.erpCategory) set.add(i.erpCategory); });
    return [...set];
  }, [items]);

  const createBatch = () => {
    if (!newTitle.trim()) { toast.error('제목 입력'); return; }
    const b = phase1.createBrandBatch(ws, newTitle.trim());
    setNewTitle('');
    setSelected(b);
    setMainTab('approval');
    refresh();
    toast.success(`발주 생성 ${b.projectNo}`);
  };

  const addLine = () => {
    if (!detail || !lineForm.styleNo) return;
    const item = items.find(i => i.styleNo === lineForm.styleNo);
    const colors = lineColorQtys.filter(c => c.color.trim() && c.qty > 0);
    if (colors.length === 0) {
      toast.error('컬러별 수량을 입력하세요');
      return;
    }
    const qty = colors.reduce((s, c) => s + c.qty, 0);
    phase1.addBrandLine(detail.id, {
      styleNo: lineForm.styleNo,
      styleName: item?.name || lineForm.styleNo,
      colorQtys: colors.map(c => ({ color: c.color.trim(), qty: c.qty })),
      factoryId: lineForm.factoryId,
      factoryName: factories.find(f => f.id === lineForm.factoryId)?.name,
      productionOrigin: lineForm.productionOrigin,
      isEmployeePurchase: false,
      qty,
    });
    setLineForm({ styleNo: '', qty: 0, factoryId: '', productionOrigin: 'china' });
    setLineColorQtys([]);
    refresh();
    setSelected(phase1.getBrandBatch(detail.id) || null);
  };

  const pickStyleForLine = (styleNo: string) => {
    setLineForm(f => ({ ...f, styleNo }));
    const item = items.find(i => i.styleNo === styleNo);
    const colors = normalizeColors(item?.colors || []);
    setLineColorQtys(colors.length
      ? colors.map(c => ({ color: c.name, qty: 0 }))
      : [{ color: '', qty: 0 }]);
  };

  const splitToOrders = () => {
    if (!detail) return;
    const created = phase1.splitBrandBatchToOrders(
      detail.id,
      (order) => store.addOrder(order as Parameters<typeof store.addOrder>[0]),
      factories.map(f => ({ id: f.id, name: f.name })),
    );
    if (created.length) {
      toast.success(`생산발주 ${created.length}건 생성`);
      refresh();
    } else {
      toast.error('승인 완료된 발주만 분할 가능');
    }
  };

  const stepLabel = (batch: BrandOrderBatch) => {
    if (batch.status === 'approved') return '승인완료';
    if (batch.status === 'split') return '분할완료';
    if (batch.status === 'draft') return '작성중';
    const s = R3_STEPS.find(x => x.step === batch.approvalStep);
    return s ? `${s.step}. ${s.label}` : `단계 ${batch.approvalStep}`;
  };

  const openRecv = (row: ReorderOrderRow, color?: string) => {
    const focus = color || row.colorLines.find(c => c.remaining > 0)?.color || row.colorLines[0]?.color || '';
    const colorLine = row.colorLines.find(c => c.color === focus);
    const remain = colorLine ? colorLine.remaining : row.remaining;
    setDetailRow(row);
    setRecvFocusColor(focus);
    setRecvForm({
      destination: 'korea',
      qty: Math.max(0, remain),
      color: focus === '(미지정)' || focus === '(미배정)' ? '' : focus,
      date: new Date().toISOString().slice(0, 10),
      isAdvance: row.productionStatus !== 'produced',
      memo: '',
      createPayable: true,
    });
    setRecvOpen(true);
  };

  const markProduced = (row: ReorderOrderRow) => {
    store.updateOrder(row.orderId, { status: '생산완료' as OrderStatus });
    toast.success('생산완료 처리되었습니다');
    if (detailRow?.orderId === row.orderId) {
      setDetailRow({ ...row, orderStatus: '생산완료', productionStatus: 'produced', displayStatus: row.receiptStatus === 'none' ? '생산완료' : row.displayStatus });
    }
    refresh();
  };

  const submitRecv = () => {
    if (!detailRow) return;
    if (recvForm.qty <= 0) { toast.error('수량을 입력하세요'); return; }
    const colorKey = recvForm.color.trim() || '(미배정)';
    const colorLine = detailRow.colorLines.find(c => c.color === colorKey || c.color === recvForm.color.trim());
    const colorRemain = colorLine ? colorLine.remaining : detailRow.remaining;
    if (recvForm.qty > colorRemain) {
      toast.error(`해당 컬러 잔량(${colorRemain})을 초과할 수 없습니다`);
      return;
    }
    if (recvForm.qty > detailRow.remaining) { toast.error('잔량을 초과할 수 없습니다'); return; }
    if (!recvForm.color.trim()) {
      toast.error('컬러를 선택하세요 (품목·컬러별 관리)');
      return;
    }
    const order = orders.find(o => o.id === detailRow.orderId);
    const log = phase1.addReceiptLog({
      orderId: detailRow.orderId,
      orderNo: detailRow.orderNo,
      projectNo: detailRow.projectNo,
      logType: 'inbound',
      qty: recvForm.qty,
      defectQty: 0,
      receivedDate: recvForm.date,
      memo: recvForm.memo,
      destination: recvForm.destination,
      color: recvForm.color.trim(),
      isAdvance: recvForm.isAdvance || detailRow.productionStatus !== 'produced',
    });
    const sum = phase1.getOrderReceiptSummary(detailRow.orderId, detailRow.qty);
    const updates: Record<string, unknown> = {
      receivedQty: sum.receivedQty,
      receivedDate: recvForm.date,
    };
    if (sum.remaining <= 0) updates.status = '입고완료';
    store.updateOrder(detailRow.orderId, updates as Partial<typeof order>);

    if (recvForm.createPayable) {
      const cn = ensureChinaCorpVendor();
      phase1.createPayableFromReceipt(log, {
        unitPriceKrw: detailRow.factoryUnitPriceKrw || order?.factoryUnitPriceKrw || 0,
        factoryVendorId: detailRow.vendorId || order?.vendorId,
        factoryVendorName: detailRow.vendorName || order?.vendorName,
        chinaCorpVendorId: cn.id,
        chinaCorpVendorName: cn.name,
      });
    }

    if (recvForm.destination === 'china') {
      const stock = phase1.postChinaInboundFromReceipt(log, {
        workspace: (detailRow.workspace === 'AETALOOP' ? 'AETALOOP' : 'LUMEN'),
        styleNo: detailRow.styleNo,
        styleName: detailRow.styleName,
        color: recvForm.color.trim(),
      });
      if (stock) {
        toast.success(`중국입고 ${recvForm.qty}개 · 중국창고 반영${recvForm.createPayable ? ' · 지출결의' : ''}`);
      } else {
        toast.success(`중국입고 ${recvForm.qty}개 기록`);
      }
    } else if (recvForm.createPayable) {
      toast.success(`한국입고 ${recvForm.qty}개 · 지출결의 초안 생성`);
    } else {
      toast.success(`한국입고 ${recvForm.qty}개 기록`);
    }
    setRecvOpen(false);
    refresh();
    const updated = phase1.getReorderOrderBoard(
      store.getOrders().map(o => ({
        id: o.id, orderNo: o.orderNo, styleNo: o.styleNo, styleName: o.styleName,
        revision: o.revision, isReorder: o.isReorder, brandBatchId: o.brandBatchId,
        orderDate: o.orderDate, createdAt: o.createdAt, qty: o.qty, status: o.status,
        colorQtys: o.colorQtys, vendorId: o.vendorId, vendorName: o.vendorName,
        workspace: o.workspace, projectNo: o.projectNo, factoryUnitPriceKrw: o.factoryUnitPriceKrw,
      })),
      ws,
    ).flatMap(g => g.rows).find(r => r.orderId === detailRow.orderId);
    if (updated) setDetailRow(updated);
  };

  const createPayables = (row: ReorderOrderRow) => {
    const order = orders.find(o => o.id === row.orderId);
    const cn = ensureChinaCorpVendor();
    const created = phase1.createPayablesForOrderReceipts(row.orderId, {
      unitPriceKrw: row.factoryUnitPriceKrw || order?.factoryUnitPriceKrw || 0,
      factoryVendorId: row.vendorId || order?.vendorId,
      factoryVendorName: row.vendorName || order?.vendorName,
      chinaCorpVendorId: cn.id,
      chinaCorpVendorName: cn.name,
    });
    toast.success(`지출결의 ${created.length}건 확인/생성`);
    refresh();
  };

  const detailLogs = detailRow ? phase1.getReceiptLogsByOrder(detailRow.orderId).filter(l => l.logType === 'inbound') : [];

  const applyColorsForTest = () => {
    if (!confirm(
      '품목 컬러를 채우고, 기존 발주·입고의 「기본 / (미지정) / (미배정)」을 실제 컬러로 재분배합니다.\n컬러별 입고·중국창고 테스트용입니다. 계속할까요?',
    )) return;
    const r = applyColorTestData();
    toast.success(
      `컬러 재적용 · 품목 ${r.itemsUpdated} · 발주 ${r.ordersUpdated}`
      + (r.receiptsRemapped ? ` · 입고 ${r.receiptsRemapped}` : '')
      + (r.brandLinesUpdated ? ` · R3라인 ${r.brandLinesUpdated}` : ''),
    );
    refresh();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">리오더 · 오더관리</h1>
          <p className="text-sm text-stone-500">{ws} — 차수별 잔량·선입고 · 한국/중국 입고 · 지출결의</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-amber-300 text-amber-900 hover:bg-amber-50 gap-1.5"
          onClick={applyColorsForTest}
        >
          <Palette size={14} />
          컬러 데이터 재적용
        </Button>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="mgmt">오더관리</TabsTrigger>
          <TabsTrigger value="approval">승인 (R3)</TabsTrigger>
        </TabsList>

        {/* ── 오더관리 ── */}
        <TabsContent value="mgmt" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            {([
              ['active', '진행중'],
              ['done', '완료'],
              ['all', '전체'],
            ] as const).map(([k, label]) => (
              <Button key={k} size="sm" variant={progressFilter === k ? 'default' : 'outline'}
                onClick={() => setProgressFilter(k)}>{label}</Button>
            ))}
            <select
              className="border rounded-md h-8 px-2 text-xs"
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
            >
              <option value="all">카테고리 전체</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <Input
              className="h-8 max-w-xs text-sm"
              placeholder="스타일번호 · 품목명 검색"
              value={styleSearch}
              onChange={e => setStyleSearch(e.target.value)}
            />
            <span className="text-[10px] text-stone-400 ml-auto hidden sm:inline">
              기본·미지정 컬러가 보이면 「컬러 데이터 재적용」
            </span>
          </div>

          {board.length === 0 ? (
            <div className="bg-white rounded-xl border p-10 text-center text-sm text-stone-400">
              표시할 오더가 없습니다. 승인 탭에서 묶음 발주 → 생산발주 분할 후, 또는 리오더 생산발주를 등록하세요.
            </div>
          ) : board.map(group => (
            <div key={group.styleNo} className="bg-white rounded-xl border overflow-hidden">
              <div className="px-4 py-3 border-b bg-stone-50 flex items-center gap-2">
                <span className="font-semibold text-sm">{group.styleName}</span>
                <span className="font-mono text-xs text-amber-700">{group.styleNo}</span>
                {group.erpCategory && <Badge variant="outline" className="text-[10px]">{group.erpCategory}</Badge>}
                <span className="text-[10px] text-stone-400 ml-auto">{group.rows.length}차</span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-stone-500 bg-white">
                  <tr>
                    <th className="text-left px-3 py-2">차수</th>
                    <th className="text-left px-3 py-2">컬러</th>
                    <th className="text-left px-3 py-2">발주일</th>
                    <th className="text-right px-3 py-2">발주</th>
                    <th className="text-right px-3 py-2">선입</th>
                    <th className="text-right px-3 py-2">입고</th>
                    <th className="text-right px-3 py-2">잔량</th>
                    <th className="text-left px-3 py-2">상태</th>
                    <th className="px-3 py-2">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.flatMap(row => {
                    const lines = (row.colorLines?.length ? row.colorLines : [{ color: '(미지정)', qty: row.qty, advanceQty: row.advanceQty, receivedQty: row.receivedQty, remaining: row.remaining }]);
                    return lines.map((cl, idx) => (
                      <tr key={`${row.orderId}-${cl.color}`} className="border-t border-stone-100 hover:bg-amber-50/40">
                        <td className="px-3 py-2 font-medium text-xs">
                          {idx === 0 ? `${row.revision}차` : ''}
                          {idx === 0 && lines.length > 1 && (
                            <span className="block text-[10px] text-stone-400 font-normal">합 {formatNumber(row.qty)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px] font-mono">{cl.color}</Badge>
                        </td>
                        <td className="px-3 py-2 text-xs">{idx === 0 ? (row.orderDate || '—') : ''}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(cl.qty)}</td>
                        <td className="px-3 py-2 text-right text-orange-700">{formatNumber(cl.advanceQty)}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(cl.receivedQty)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatNumber(cl.remaining)}</td>
                        <td className="px-3 py-2">
                          {idx === 0 ? (
                            <span className={`text-[10px] px-2 py-0.5 rounded border ${STATUS_CLASS[row.displayStatus]}`}>
                              {row.displayStatus}
                            </span>
                          ) : (
                            <span className="text-[10px] text-stone-400">{cl.remaining <= 0 ? '입고완료' : cl.receivedQty > 0 ? '부분' : '대기'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1 justify-end">
                            {idx === 0 && (
                              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setDetailRow(row)}>상세</Button>
                            )}
                            {cl.remaining > 0 && (
                              <Button size="sm" className="h-7 text-[10px]" onClick={() => openRecv(row, cl.color)}>
                                <Package className="w-3 h-3 mr-0.5" />입고
                              </Button>
                            )}
                            {idx === 0 && row.productionStatus !== 'produced' && row.orderStatus !== '입고완료' && (
                              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => markProduced(row)}>
                                <Factory className="w-3 h-3 mr-0.5" />생산완료
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </TabsContent>

        {/* ── 승인 (기존) ── */}
        <TabsContent value="approval" className="mt-4 space-y-4">
          <div className="flex gap-2">
            <Input placeholder="발주 제목 (예: 6월 2주차 리오더)" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="max-w-sm" />
            <Button onClick={createBatch}>+ 묶음 발주</Button>
          </div>

          <div className="grid grid-cols-5 gap-4">
            <div className="col-span-2 bg-white rounded-xl border divide-y max-h-[70vh] overflow-y-auto">
              {batches.length === 0 ? (
                <p className="p-6 text-sm text-stone-400 text-center">발주 없음</p>
              ) : batches.map(b => (
                <button key={b.id} type="button"
                  className={`w-full text-left px-4 py-3 hover:bg-stone-50 ${selected?.id === b.id ? 'bg-amber-50' : ''}`}
                  onClick={() => setSelected(b)}>
                  <p className="font-mono text-xs text-amber-700">{b.projectNo}</p>
                  <p className="font-medium text-sm">{b.title}</p>
                  <p className="text-xs text-stone-500 mt-1">{stepLabel(b)} · {b.lines.length} SKU</p>
                </button>
              ))}
            </div>

            <div className="col-span-3 bg-white rounded-xl border p-5 space-y-4">
              {!detail ? (
                <p className="text-stone-400 text-sm">왼쪽에서 발주 선택</p>
              ) : (
                <>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-mono text-sm text-amber-700">{detail.projectNo}</p>
                      <h2 className="text-lg font-bold">{detail.title}</h2>
                    </div>
                    <span className="text-xs bg-stone-100 px-2 py-1 rounded">{stepLabel(detail)}</span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {R3_STEPS.map(s => {
                      const asg = getAssigneeForStep(s.step, ws);
                      return (
                        <span
                          key={s.step}
                          title={asg ? `담당: ${asg.name} (${R3_ROLE_LABEL[R3_STEP_ROLE[s.step]]})` : undefined}
                          className={`text-[10px] px-2 py-1 rounded border ${
                            detail.approvalStep > s.step ? 'bg-green-50 border-green-200 text-green-700' :
                            detail.approvalStep === s.step && detail.status === 'in_approval' ? 'bg-amber-50 border-amber-300 font-bold' :
                            'bg-stone-50 border-stone-200 text-stone-400'
                          }`}
                        >
                          {s.step}.{s.label}
                          {asg && !asg.isVacant ? ` · ${asg.name}` : ''}
                        </span>
                      );
                    })}
                  </div>

                  {detail.status === 'in_approval' && stepAssignee && (
                    <p className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-md px-3 py-2">
                      현재 단계 담당(조직도): <b>{stepAssignee.name}</b> {stepAssignee.title}
                      <span className="text-violet-500 ml-1">· {R3_ROLE_LABEL[R3_STEP_ROLE[detail.approvalStep]]}</span>
                      {detail.approvalStep === 2 && (
                        <span className="block mt-1 text-violet-600">생산납기(예상입고일)는 이 단계에서 입력 · 조직도에서 담당 변경 가능</span>
                      )}
                    </p>
                  )}

                  {detail.status === 'in_approval' && detail.approvalStep === 2 && (
                    <div className="flex flex-wrap items-end gap-2 border rounded-lg p-3 bg-amber-50/50">
                      <div className="space-y-1">
                        <label className="text-[10px] text-stone-500">생산납기 · 예상입고일</label>
                        <Input
                          type="date"
                          className="h-8 text-sm"
                          value={detail.expectedDely || ''}
                          onChange={e => {
                            phase1.updateBrandBatch(detail.id, { expectedDely: e.target.value });
                            refresh();
                            setSelected(phase1.getBrandBatch(detail.id) || null);
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-stone-500 pb-1">저장되면 MD 화면에 참고 표시됩니다</p>
                    </div>
                  )}

                  {detail.expectedDely && (
                    <p className="text-xs text-stone-600">
                      등록된 생산납기: <b className="font-mono text-amber-800">{detail.expectedDely}</b>
                    </p>
                  )}

                  {detail.status === 'draft' && (
                    <Button size="sm" onClick={() => { phase1.submitBrandBatch(detail.id, actorName); refresh(); setSelected(phase1.getBrandBatch(detail.id) || null); }}>
                      <Send className="w-3 h-3 mr-1" />승인 요청
                    </Button>
                  )}
                  {detail.status === 'in_approval' && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => {
                        if (detail.approvalStep === 2 && !detail.expectedDely) {
                          toast.error('생산납기(예상입고일)를 먼저 입력하세요');
                          return;
                        }
                        const name = stepAssignee?.name || actorName;
                        phase1.approveBrandStep(detail.id, detail.approvalStep, name);
                        refresh(); setSelected(phase1.getBrandBatch(detail.id) || null);
                      }}><Check className="w-3 h-3 mr-1" />승인</Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        phase1.rejectBrandStep(detail.id, detail.approvalStep, stepAssignee?.name || actorName, '수정 필요');
                        refresh(); setSelected(phase1.getBrandBatch(detail.id) || null);
                      }}><X className="w-3 h-3 mr-1" />반려</Button>
                    </div>
                  )}
                  {detail.status === 'approved' && (
                    <Button size="sm" onClick={splitToOrders}><Split className="w-3 h-3 mr-1" />생산발주 분할</Button>
                  )}

                  <table className="w-full text-sm border rounded-lg overflow-hidden">
                    <thead className="bg-stone-50 text-xs">
                      <tr>
                        <th className="text-left px-3 py-2">SKU</th>
                        <th className="text-left px-3 py-2">컬러</th>
                        <th className="text-right px-3 py-2">수량</th>
                        <th className="text-left px-3 py-2">공장</th>
                        <th className="text-left px-3 py-2">생산지</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.flatMap(l => {
                        const cqs = l.colorQtys?.length ? l.colorQtys : [{ color: '(미지정)', qty: l.qty }];
                        return cqs.map((cq, i) => (
                          <tr key={`${l.id}-${cq.color}-${i}`} className="border-t">
                            <td className="px-3 py-2 font-mono text-xs">{i === 0 ? l.styleNo : ''}</td>
                            <td className="px-3 py-2 text-xs">{cq.color}</td>
                            <td className="px-3 py-2 text-right">{cq.qty}</td>
                            <td className="px-3 py-2">{i === 0 ? (l.factoryName || '—') : ''}</td>
                            <td className="px-3 py-2">{i === 0 ? (l.productionOrigin === 'china' ? '중국' : '국내') : ''}</td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>

                  {detail.status === 'draft' && (
                    <div className="border-t pt-4 space-y-2">
                      <p className="text-xs font-semibold text-stone-500">SKU 추가 (컬러별 수량)</p>
                      <div className="grid grid-cols-2 gap-2">
                        <select className="border rounded h-9 px-2 text-sm" value={lineForm.styleNo}
                          onChange={e => pickStyleForLine(e.target.value)}>
                          <option value="">품목 선택</option>
                          {items.map(i => <option key={i.id} value={i.styleNo}>{i.styleNo} {i.name}</option>)}
                        </select>
                        <select className="border rounded h-9 px-2 text-sm" value={lineForm.factoryId}
                          onChange={e => setLineForm(f => ({ ...f, factoryId: e.target.value }))}>
                          <option value="">공장</option>
                          {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                      {lineForm.styleNo && (
                        <div className="space-y-1.5 border rounded-md p-2 bg-stone-50">
                          {lineColorQtys.map((cq, idx) => (
                            <div key={idx} className="grid grid-cols-5 gap-1.5 items-center">
                              <Input
                                className="h-8 text-xs col-span-2"
                                placeholder="컬러"
                                value={cq.color}
                                onChange={e => setLineColorQtys(prev => prev.map((x, i) => i === idx ? { ...x, color: e.target.value } : x))}
                              />
                              <Input
                                className="h-8 text-xs col-span-2"
                                type="number"
                                placeholder="수량"
                                value={cq.qty || ''}
                                onChange={e => setLineColorQtys(prev => prev.map((x, i) => i === idx ? { ...x, qty: +e.target.value } : x))}
                              />
                              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs"
                                onClick={() => setLineColorQtys(prev => prev.filter((_, i) => i !== idx))}>삭제</Button>
                            </div>
                          ))}
                          <div className="flex justify-between items-center pt-1">
                            <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]"
                              onClick={() => setLineColorQtys(prev => [...prev, { color: '', qty: 0 }])}>+ 컬러</Button>
                            <span className="text-[10px] text-stone-500">
                              합계 {lineColorQtys.reduce((s, c) => s + (c.qty || 0), 0).toLocaleString()} PCS
                            </span>
                          </div>
                          {!normalizeColors(items.find(i => i.styleNo === lineForm.styleNo)?.colors || []).length && (
                            <p className="text-[10px] text-amber-700">품목마스터에 컬러가 없습니다. 직접 입력하세요.</p>
                          )}
                        </div>
                      )}
                      <Button size="sm" variant="outline" onClick={addLine}>라인 추가</Button>
                    </div>
                  )}

                  {phase1.getApprovalLogs(detail.id).length > 0 && (
                    <div className="border-t pt-3">
                      <p className="text-xs font-semibold text-stone-500 mb-2">승인 이력</p>
                      {phase1.getApprovalLogs(detail.id).map(l => (
                        <p key={l.id} className="text-xs text-stone-600 py-0.5">
                          {l.createdAt.slice(0, 10)} · {l.step}단계 {l.action} · {l.actorName}
                          {l.comment && ` — ${l.comment}`}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* 오더 상세 */}
      <Dialog open={!!detailRow && !recvOpen} onOpenChange={open => { if (!open) setDetailRow(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {detailRow && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">
                  {detailRow.styleName} · {detailRow.revision}차
                </DialogTitle>
                <p className="text-xs text-stone-500 font-mono">{detailRow.orderNo} · {detailRow.orderDate}</p>
              </DialogHeader>

              <div className="flex flex-wrap gap-1">
                {PIPELINE.map((label, i) => {
                  const stepOn =
                    (i === 0) ||
                    (i === 1 && ['진행중', '생산완료', '부분입고', '선입고', '입고완료', '지출결의', '결제완료'].includes(detailRow.displayStatus)) ||
                    (i === 2 && ['생산완료', '부분입고', '선입고', '입고완료', '지출결의', '결제완료'].includes(detailRow.displayStatus)) ||
                    (i === 3 && ['부분입고', '선입고', '입고완료', '지출결의', '결제완료'].includes(detailRow.displayStatus)) ||
                    (i === 4 && ['지출결의', '결제완료'].includes(detailRow.displayStatus)) ||
                    (i === 5 && detailRow.displayStatus === '결제완료');
                  return (
                    <span key={label} className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      stepOn ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-stone-50 border-stone-200 text-stone-400'
                    }`}>{label}</span>
                  );
                })}
              </div>

              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded border p-2"><p className="text-stone-400">발주</p><p className="font-bold">{formatNumber(detailRow.qty)}</p></div>
                <div className="rounded border p-2"><p className="text-stone-400">선입</p><p className="font-bold text-orange-700">{formatNumber(detailRow.advanceQty)}</p></div>
                <div className="rounded border p-2"><p className="text-stone-400">입고</p><p className="font-bold">{formatNumber(detailRow.receivedQty)}</p></div>
                <div className="rounded border p-2"><p className="text-stone-400">잔량</p><p className="font-bold">{formatNumber(detailRow.remaining)}</p></div>
              </div>

              <div>
                <p className="text-xs font-semibold text-stone-500 mb-1">컬러별</p>
                <table className="w-full text-xs border rounded overflow-hidden">
                  <thead className="bg-stone-50 text-stone-500">
                    <tr>
                      <th className="text-left px-2 py-1">컬러</th>
                      <th className="text-right px-2 py-1">발주</th>
                      <th className="text-right px-2 py-1">선입</th>
                      <th className="text-right px-2 py-1">입고</th>
                      <th className="text-right px-2 py-1">잔량</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailRow.colorLines || []).map(cl => (
                      <tr key={cl.color} className="border-t">
                        <td className="px-2 py-1 font-mono">{cl.color}</td>
                        <td className="px-2 py-1 text-right">{formatNumber(cl.qty)}</td>
                        <td className="px-2 py-1 text-right text-orange-700">{formatNumber(cl.advanceQty)}</td>
                        <td className="px-2 py-1 text-right">{formatNumber(cl.receivedQty)}</td>
                        <td className="px-2 py-1 text-right font-semibold">{formatNumber(cl.remaining)}</td>
                        <td className="px-2 py-1 text-right">
                          {cl.remaining > 0 && (
                            <Button size="sm" className="h-6 text-[10px]" onClick={() => openRecv(detailRow, cl.color)}>입고</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <p className="text-xs font-semibold text-stone-500 mb-1">입고 이력</p>
                {detailLogs.length === 0 ? (
                  <p className="text-xs text-stone-400">입고 기록 없음</p>
                ) : detailLogs.map(l => (
                  <div key={l.id} className="text-xs border rounded px-2 py-1.5 mb-1 flex justify-between gap-2">
                    <span>
                      {l.receivedDate} · {l.destination === 'china' ? '중국' : l.destination === 'korea' ? '한국' : '입고'}
                      {l.color ? ` · ${l.color}` : ''} · {l.qty}pcs
                      {l.isAdvance ? ' (선입)' : ''}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {detailRow.remaining > 0 && (
                  <Button size="sm" onClick={() => openRecv(detailRow)}><Package className="w-3 h-3 mr-1" />입고 등록</Button>
                )}
                {detailRow.productionStatus !== 'produced' && detailRow.orderStatus !== '입고완료' && (
                  <Button size="sm" variant="outline" onClick={() => markProduced(detailRow)}>생산완료</Button>
                )}
                {detailLogs.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => createPayables(detailRow)}>지출결의 생성</Button>
                )}
                <Link href="/payables">
                  <Button size="sm" variant="ghost">미지급 탭 →</Button>
                </Link>
                <Link href="/china-warehouse">
                  <Button size="sm" variant="ghost">중국창고 →</Button>
                </Link>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 입고 등록 */}
      <Dialog open={recvOpen} onOpenChange={setRecvOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>입고 등록</DialogTitle>
            {detailRow && (
              <p className="text-xs text-stone-500">{detailRow.styleName} · {detailRow.revision}차 · 잔량 {detailRow.remaining}</p>
            )}
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>목적지</Label>
              <div className="flex gap-2 mt-1">
                <Button type="button" size="sm" variant={recvForm.destination === 'korea' ? 'default' : 'outline'}
                  onClick={() => setRecvForm(f => ({ ...f, destination: 'korea' }))}>한국입고</Button>
                <Button type="button" size="sm" variant={recvForm.destination === 'china' ? 'default' : 'outline'}
                  onClick={() => setRecvForm(f => ({ ...f, destination: 'china' }))}>중국입고</Button>
              </div>
              <p className="text-[10px] text-stone-400 mt-1">
                {recvForm.destination === 'korea'
                  ? '지출결의 → 공장 다이렉트'
                  : '지출결의 → 아메스코테스 중국법인'}
              </p>
            </div>
            <div>
              <Label>수량</Label>
              <Input type="number" value={recvForm.qty || ''} onChange={e => setRecvForm(f => ({ ...f, qty: +e.target.value }))} />
            </div>
            <div>
              <Label>컬러 <span className="text-red-500">*</span></Label>
              {detailRow?.colorLines?.length || detailRow?.colorQtys?.length ? (
                <select
                  className="w-full border rounded-md h-9 px-2 text-sm"
                  value={recvForm.color}
                  onChange={e => {
                    const color = e.target.value;
                    const cl = detailRow?.colorLines.find(c => c.color === color);
                    setRecvForm(f => ({ ...f, color, qty: cl?.remaining ?? f.qty }));
                    setRecvFocusColor(color);
                  }}
                >
                  <option value="">선택</option>
                  {(detailRow?.colorLines || []).map(c => (
                    <option key={c.color} value={c.color === '(미배정)' || c.color === '(미지정)' ? '' : c.color}>
                      {c.color} (발주 {c.qty} · 잔량 {c.remaining})
                    </option>
                  ))}
                </select>
              ) : (
                <Input value={recvForm.color} onChange={e => setRecvForm(f => ({ ...f, color: e.target.value }))} placeholder="컬러명" />
              )}
            </div>
            <div>
              <Label>입고일</Label>
              <Input type="date" value={recvForm.date} onChange={e => setRecvForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-xs text-stone-600">
              <input type="checkbox" checked={recvForm.isAdvance}
                onChange={e => setRecvForm(f => ({ ...f, isAdvance: e.target.checked }))} />
              생산완료 전 선입고
            </label>
            <label className="flex items-center gap-2 text-xs text-stone-600">
              <input type="checkbox" checked={recvForm.createPayable}
                onChange={e => setRecvForm(f => ({ ...f, createPayable: e.target.checked }))} />
              입고와 함께 지출결의 초안 생성
            </label>
            <div>
              <Label>메모</Label>
              <Input value={recvForm.memo} onChange={e => setRecvForm(f => ({ ...f, memo: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecvOpen(false)}>취소</Button>
            <Button onClick={submitRecv}>입고 확정</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
