// 리오더 · 오더관리 — R3 승인 + 차수별 입고·미지급 등록
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { store, formatNumber, genId, type OrderStatus, type ProductionOrder } from '@/lib/store';
import {
  phase1, pullBrandOrders, CHINA_CORP_VENDOR_CODE, CHINA_CORP_VENDOR_NAME,
  type BrandOrderBatch, type OrderDisplayStatus, type ReceiptDestination, type ReorderOrderRow,
} from '@/lib/phase1';
import { fetchOrders } from '@/lib/dbQueries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Send, Package, Factory, Trash2, Undo2 } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import StylePickerSheet, { type PickedLine } from '@/components/StylePickerSheet';
import ReorderImport from '@/components/ReorderImport';
import { brandWorkflow } from '@/lib/brandWorkflow';
import { validDate } from '../../../shared/schedule';

const PIPELINE = ['발주', '진행중', '생산완료', '한국/중국입고', '미지급 등록', '공장결제'] as const;

const STATUS_CLASS: Record<OrderDisplayStatus, string> = {
  결제완료: 'bg-[var(--fill-quaternary)] text-[var(--system-green)] border-border',
  '미지급 등록': 'bg-[var(--fill-tertiary)] text-foreground border-border',
  입고완료: 'bg-[var(--fill-quaternary)] text-[var(--system-green)] border-border',
  부분입고: 'bg-[var(--fill-quaternary)] text-[var(--system-orange)] border-border',
  선입고: 'bg-[var(--fill-quaternary)] text-[var(--system-orange)] border-border',
  생산완료: 'bg-[var(--fill-quaternary)] text-primary border-border',
  진행중: 'bg-[var(--fill-quaternary)] text-muted-foreground border-border',
  발주: 'bg-card text-muted-foreground border-border',
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
  const ws = workspace === 'AETALOOF' ? 'AETALOOF' : 'LUMEN';
  const queryClient = useQueryClient();
  const { data: remoteOrders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
  const { data: pulled = 0, isError: brandReadError } = useQuery({ queryKey: ['brandOrders'], queryFn: pullBrandOrders });
  const [tickN, tick] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['brandOrders'] });
    tick(n => n + 1);
  };

  const localOrders = store.getOrders();
  const orders = useMemo(() => {
    const map = new Map<string, (typeof localOrders)[0]>();
    [...remoteOrders, ...localOrders].forEach(o => map.set(o.id, o as (typeof localOrders)[0]));
    return [...map.values()];
  }, [remoteOrders, localOrders, tick]);

  const batches = useMemo(() => phase1.getBrandBatches(ws), [ws, pulled, tickN]);
  const items = store.getItems();
  const factories = store.getVendors().filter(v => v.type === '공장' || v.type === '해외공장');

  const [mainTab, setMainTab] = useState('mgmt');
  const [selected, setSelected] = useState<BrandOrderBatch | null>(null);
  const [newTitle, setNewTitle] = useState('');

  const [progressFilter, setProgressFilter] = useState<'active' | 'done' | 'all'>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [styleSearch, setStyleSearch] = useState('');
  const [detailRow, setDetailRow] = useState<ReorderOrderRow | null>(null);
  const [recvFocusColor, setRecvFocusColor] = useState<string>('');

  const [recvOpen, setRecvOpen] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptRequestId, setReceiptRequestId] = useState('');
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

  const reorderSummary = useMemo(() => {
    const logs = phase1.getReceiptLogs();
    return board.map(group => {
      const ids = new Set(group.rows.map(r => r.orderId)); const styleLogs = logs.filter(l => ids.has(l.orderId));
      const inbound = styleLogs.filter(l => l.logType === 'inbound').reduce((n,l) => n + l.qty, 0);
      const outbound = styleLogs.filter(l => l.logType !== 'inbound'); const shipped = outbound.reduce((n,l) => n + l.qty, 0);
      const incoming = group.rows.reduce((n,r) => n + r.remaining, 0);
      const demand = { domestic: outbound.filter(l => l.deliveryMarket === 'domestic').reduce((n,l) => n+l.qty,0), b2b: outbound.filter(l => !l.deliveryMarket || l.deliveryMarket === 'b2b').reduce((n,l) => n+l.qty,0), overseas: outbound.filter(l => l.deliveryMarket === 'overseas').reduce((n,l) => n+l.qty,0) };
      const currentStock = Math.max(0, inbound - shipped); const totalDemand = demand.domestic + demand.b2b + demand.overseas;
      return { ...group, currentStock, incoming, available: currentStock + incoming, demand, reorderQty: Math.max(0, totalDemand-currentStock-incoming) };
    });
  }, [board, tickN]);
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => { if (i.erpCategory) set.add(i.erpCategory); });
    return [...set];
  }, [items]);

  const createBatch = () => {
    // 제목을 강제하면 버튼이 안 눌린 것처럼 보인다. 비면 발주번호로 지어준다
    const b = phase1.createBrandBatch(ws, newTitle.trim());
    setNewTitle('');
    setSelected(b);
    setMainTab('approval');
    refresh();
    toast.success(`발주 생성 ${b.projectNo}`);
  };

  /** 발주 취소 — 수주함이 받기 전이면 초안으로 되돌린다 */
  const cancelIssue = async () => {
    if (!detail || workflowBusy) return;
    if (!confirm(`${detail.projectNo}를 작성 상태로 되돌립니다. 수정 후 대표 승인을 다시 받아야 합니다.`)) return;
    setWorkflowBusy(true);
    let saved = false;
    try {
      await brandWorkflow(`brand-batches/${encodeURIComponent(detail.id)}/cancel-issue`);
      saved = true;
      await pullBrandOrders();
      refresh(); setSelected(phase1.getBrandBatch(detail.id) || null);
      toast.success('작성 상태로 되돌렸습니다 — 수정 후 대표 승인이 필요합니다');
    } catch (e: any) {
      refresh();
      if (saved) toast.warning('취소는 저장됐지만 목록 조회에 실패했습니다 — 새로고침해주세요');
      else toast.error(e.message || '취소 실패');
    } finally { setWorkflowBusy(false); }
  };

  /** 발주 삭제 — 안 나간 것만 */
  const removeBatch = () => {
    if (!detail) return;
    if (!confirm(`${detail.projectNo}를 삭제합니다. 담은 상품도 함께 지워집니다.`)) return;
    const r = phase1.deleteBrandBatch(detail.id);
    if (!r.ok) { toast.error(r.reason || '삭제 실패'); return; }
    setSelected(null); refresh();
    toast.success('발주 삭제');
  };

  /** 담은 상품 1줄 빼기 */
  const removeLine = (lineId: string) => {
    if (!detail) return;
    phase1.deleteBrandLine(lineId);
    refresh(); setSelected(phase1.getBrandBatch(detail.id) || null);
  };

  /** 시트에서 담아 온 것들 — 한 번에 라인으로 만든다 */
  const addPicked = (lines: PickedLine[], factoryId: string, route: 'oem' | 'direct') => {
    if (!detail) return;
    const factoryName = factories.find(f => f.id === factoryId)?.name;
    lines.forEach(l => phase1.addBrandLine(detail.id, {
      styleNo: l.styleNo,
      styleName: l.styleName,
      colorQtys: l.colorQtys,
      factoryId,
      factoryName,
      productionOrigin: 'china',
      route,
      isEmployeePurchase: false,
      qty: l.colorQtys.reduce((s, c) => s + c.qty, 0),
    }));
    refresh();
    setSelected(phase1.getBrandBatch(detail.id) || null);
    toast.success(`${lines.length}개 품번 담았습니다`);
  };

  /** 발주서 발행 — 공장별로 1장. 이 번호가 AMESCOTES의 PO가 된다 */
  const approve = async () => {
    if (!detail || workflowBusy) return;
    setWorkflowBusy(true);
    let saved = false;
    try {
      await brandWorkflow(`brand-batches/${encodeURIComponent(detail.id)}/approve`);
      saved = true;
      await pullBrandOrders();
      setSelected(phase1.getBrandBatch(detail.id) || null);
      refresh();
      toast.success('대표 승인 완료 — 발주서를 발행할 수 있습니다');
    } catch (e: any) {
      refresh();
      if (saved) toast.warning('승인은 저장됐지만 목록 조회에 실패했습니다 — 새로고침해주세요');
      else toast.error(e.message || '승인 실패');
    }
    finally { setWorkflowBusy(false); }
  };
  const issue = async () => {
    if (!detail) return;
    if (workflowBusy) return;
    setWorkflowBusy(true);
    let saved = false;
    try {
      const issued = await brandWorkflow(`brand-batches/${encodeURIComponent(detail.id)}/issue`) as { poNo: string; route: string; factoryName: string }[];
      saved = true;
      await pullBrandOrders();
      setSelected(phase1.getBrandBatch(detail.id) || null);
      refresh();
      toast.success(`발주서 ${issued.length}장 발행 — ${issued.map(i => `${i.poNo} ${i.route === 'direct' ? '[직발주]' : ''}(${i.factoryName})`).join(' · ')}`);
    } catch (e: any) {
      refresh();
      if (saved) toast.warning('발주서는 저장됐지만 목록 조회에 실패했습니다 — 새로고침해주세요');
      else toast.error(e.message || '발행 실패');
    }
    finally { setWorkflowBusy(false); }
  };

  /** 발주가 지금 어디까지 왔는지 — 담는 중 → 발주 → 납기확정 → 분할 */
  const stepLabel = (batch: BrandOrderBatch) => {
    if (batch.status === 'done') return '의뢰 완료';
    if (batch.status === 'split') return '생산발주 완료';
    if (batch.status === 'issued') return batch.expectedDely ? `납기 ${batch.expectedDely}` : '납기 대기';
    if (batch.status === 'approved') return '승인 완료 · 발행 대기';
    if (batch.status === 'in_approval') return '승인 대기';
    return '작성중';
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
    setReceiptRequestId(genId());
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

  const submitRecv = async () => {
    if (receiptBusy) return;
    if (!detailRow) return;
    if (!Number.isInteger(recvForm.qty) || recvForm.qty <= 0) { toast.error('수량은 양의 정수로 입력하세요'); return; }
    if (!validDate(recvForm.date)) { toast.error('올바른 입고 날짜를 입력하세요'); return; }
    const colorKey = recvForm.color.trim() || '(미배정)';
    const colorLine = detailRow.colorLines.find(c => c.color === colorKey || c.color === recvForm.color.trim());
    const colorRemain = colorLine ? colorLine.remaining : detailRow.remaining;
    if (recvForm.destination === 'china' && recvForm.qty > colorRemain) {
      toast.error(`해당 컬러 잔량(${colorRemain})을 초과할 수 없습니다`);
      return;
    }
    if (recvForm.destination === 'china' && recvForm.qty > detailRow.remaining) { toast.error('잔량을 초과할 수 없습니다'); return; }
    if (!recvForm.color.trim()) {
      toast.error('컬러를 선택하세요 (품목·컬러별 관리)');
      return;
    }
    {
      setReceiptBusy(true);
      try {
        const result = await phase1.saveKoreaReceipt({ id: receiptRequestId, orderId: detailRow.orderId,
          qty: recvForm.qty, defectQty: 0, receivedDate: recvForm.date, color: recvForm.color.trim(),
          memo: recvForm.memo, isAdvance: recvForm.isAdvance || detailRow.productionStatus !== 'produced',
          createPayable: recvForm.createPayable, disposition: 'deduct', destination: recvForm.destination });
        store.cacheOrderReceipt(result.order);
        if (recvForm.createPayable && !result.payable) toast.warning('입고 저장 완료 · 공장 원화 단가 미확정으로 미지급은 생성하지 않았습니다');
        toast.success(`${recvForm.destination === 'china' ? '중국입고 · 서버 재고 반영' : '한국입고'} ${recvForm.qty}개 저장${result.payable ? ' · 미지급 연결' : ''}`);
        setRecvOpen(false); setDetailRow(null); refresh();
        queryClient.invalidateQueries({ queryKey: ['payables'] });
      } catch (error) { toast.error((error as Error).message); }
      finally { setReceiptBusy(false); }
      return;
    }
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
    if (created.length) toast.success(`미지급 ${created.length}건 확인/등록`);
    else toast.warning('등록 가능한 입고 미지급이 없습니다 — 입고 기록과 공장 단가를 확인해주세요');
    refresh();
  };

  const detailLogs = detailRow ? phase1.getReceiptLogsByOrder(detailRow.orderId).filter(l => l.logType === 'inbound') : [];


  return (
    <>
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">브랜드 생산 의뢰</h1>
          <p className="text-sm text-muted-foreground">{ws} — 차수별 잔량·선입고 · 한국/중국 입고 · 미지급 등록</p>
        </div>
      </div>

      <ReorderImport workspace={ws} onImported={() => { refresh(); setMainTab('approval'); }} />
      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="mgmt">생산 의뢰</TabsTrigger>
          <TabsTrigger value="approval">발주 작성</TabsTrigger>
        </TabsList>

        {/* ── 오더관리 ── */}
        <TabsContent value="mgmt" className="mt-4 space-y-4">
          <div className="bg-card rounded-lg border overflow-x-auto"><div className="px-4 py-3 border-b"><p className="font-semibold text-sm">리오더 수량 판단</p><p className="text-xs text-muted-foreground">OEM·LUMEN 공통 상품코드 · 현재고 + 입고예정과 배송처별 주문 비교</p></div><table className="data-table w-full text-sm min-w-[760px]"><thead><tr><th>상품</th><th className="num">현재고</th><th className="num">입고예정</th><th className="num">가용합계</th><th className="num">국내</th><th className="num">B2B</th><th className="num">해외</th><th className="num">리오더 권장</th></tr></thead><tbody>{reorderSummary.map(r => <tr key={r.styleNo}><td><b>{r.styleName}</b><span className="ml-2 font-mono text-xs text-primary">{r.styleNo}</span></td><td className="num">{formatNumber(r.currentStock)}</td><td className="num">{formatNumber(r.incoming)}</td><td className="num font-semibold">{formatNumber(r.available)}</td><td className="num">{formatNumber(r.demand.domestic)}</td><td className="num">{formatNumber(r.demand.b2b)}</td><td className="num">{formatNumber(r.demand.overseas)}</td><td className={`num font-bold ${r.reorderQty ? 'text-[var(--system-red)]' : 'text-[var(--system-green)]'}`}>{formatNumber(r.reorderQty)}</td></tr>)}</tbody></table></div>
          <div className="flex flex-wrap gap-2 items-center">
            {([
              ['active', '진행중'],
              ['done', '완료'],
              ['all', '전체'],
            ] as const).map(([k, label]) => (
              <Button key={k} size="sm" variant={progressFilter === k ? 'secondary' : 'outline'}
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
          </div>

          {board.length === 0 ? (
            <div className="bg-card rounded-lg border p-10 text-center text-sm text-muted-foreground">
              표시할 오더가 없습니다. 발주 작성에서 대표 승인 → 발주서 발행 → OEM 수주 후 생산 오더가 표시됩니다.
            </div>
          ) : board.map(group => (
            <div key={group.styleNo} className="bg-card rounded-lg border overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted flex items-center gap-2">
                <span className="font-semibold text-sm">{group.styleName}</span>
                <span className="font-mono text-xs text-primary">{group.styleNo}</span>
                {group.erpCategory && <Badge variant="outline" className="text-[11px]">{group.erpCategory}</Badge>}
                <span className="text-[11px] text-muted-foreground ml-auto">{group.rows.length}차</span>
              </div>
              <div className="overflow-x-auto">
              <table className="data-table w-full text-sm min-w-[720px]">
                <thead className="text-[13px] font-semibold text-muted-foreground">
                  <tr>
                    <th className="nw">차수</th>
                    <th>컬러</th>
                    <th className="nw">발주일</th>
                    <th className="num">발주</th>
                    <th className="num">선입</th>
                    <th className="num">입고</th>
                    <th className="num">잔량</th>
                    <th className="nw">상태</th>
                    <th>액션</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.flatMap(row => {
                    const lines = (row.colorLines?.length ? row.colorLines : [{ color: '(미지정)', qty: row.qty, advanceQty: row.advanceQty, receivedQty: row.receivedQty, remaining: row.remaining }]);
                    return lines.map((cl, idx) => (
                      <tr key={`${row.orderId}-${cl.color}`} className="border-t border-border hover:bg-[var(--fill-quaternary)]">
                        <td className="font-medium text-xs">
                          {idx === 0 ? `${row.revision}차` : ''}
                          {idx === 0 && lines.length > 1 && (
                            <span className="block text-[11px] text-muted-foreground font-normal">합 {formatNumber(row.qty)}</span>
                          )}
                        </td>
                        <td>
                          <Badge variant="outline" className="text-[11px] font-mono">{cl.color}</Badge>
                        </td>
                        <td className="text-xs">{idx === 0 ? (row.orderDate || '—') : ''}</td>
                        <td className="num">{formatNumber(cl.qty)}</td>
                        <td className="num text-[var(--system-orange)]">{formatNumber(cl.advanceQty)}</td>
                        <td className="num">{formatNumber(cl.receivedQty)}</td>
                        <td className="num font-semibold">{formatNumber(cl.remaining)}</td>
                        <td>
                          {idx === 0 ? (
                            <span className={`text-[11px] px-2 py-0.5 rounded border ${STATUS_CLASS[row.displayStatus]}`}>
                              {row.displayStatus}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">{cl.remaining <= 0 ? '입고완료' : cl.receivedQty > 0 ? '부분' : '대기'}</span>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1 justify-end">
                            {idx === 0 && (
                              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setDetailRow(row)}>상세</Button>
                            )}
                            {cl.remaining > 0 && (
                              <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={() => openRecv(row, cl.color)}>
                                <Package className="w-3 h-3 mr-0.5" />입고
                              </Button>
                            )}
                            {idx === 0 && row.productionStatus !== 'produced' && row.orderStatus !== '입고완료' && (
                              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => markProduced(row)}>
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
            </div>
          ))}
        </TabsContent>

        {/* ── 승인 (기존) ── */}
        <TabsContent value="approval" className="mt-4 space-y-4">
          {brandReadError && <p role="alert" className="text-sm text-[var(--system-orange)]">서버 목록을 조회하지 못했습니다. 이전 자료일 수 있으니 새로고침 후 확인해주세요.</p>}
          <div className="flex gap-2">
            <Input placeholder="발주 제목 (예: 6월 2주차 리오더)" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="max-w-sm" />
            <Button variant="secondary" onClick={createBatch}>+ 묶음 발주</Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2 bg-card rounded-lg border divide-y divide-border max-h-[70vh] overflow-y-auto">
              {batches.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">발주 없음</p>
              ) : batches.map(b => (
                <button key={b.id} type="button"
                  className={`w-full text-left px-4 py-3 hover:bg-[var(--fill-quaternary)] ${selected?.id === b.id ? 'bg-primary/5' : ''}`}
                  onClick={() => setSelected(b)}>
                  <p className="font-mono text-xs text-primary">{b.projectNo}</p>
                  <p className="font-medium text-sm">{b.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stepLabel(b)} · {b.lines.length} SKU</p>
                </button>
              ))}
            </div>

            <div className="lg:col-span-3 bg-card rounded-lg border p-4 md:p-5 space-y-4">
              {!detail ? (
                <p className="text-muted-foreground text-sm">왼쪽에서 발주 선택</p>
              ) : (
                <>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-mono text-sm text-primary">{detail.projectNo}</p>
                      <h2 className="text-lg font-bold">{detail.title}</h2>
                    </div>
                    <span className="text-xs bg-muted px-2 py-1 rounded">{stepLabel(detail)}</span>
                  </div>

                  {['issued', 'split', 'done'].includes(detail.status) ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        발주 완료 · <b className="font-mono text-foreground">
                          {[...new Set(detail.lines.map(l => l.poNo).filter(Boolean))].join(' · ')}
                        </b>
                      </span>
                      {detail.expectedDely
                        ? <span className="text-foreground">납기 확정 <b className="font-mono text-primary">{detail.expectedDely}</b></span>
                        : <span className="text-[var(--system-orange)]">수주함에서 납기 회신 대기</span>}
                      {(() => {
                        // 수주함이 받으면 생산발주가 생긴다. 몇 건이 어디까지 갔는지 여기서 본다
                        const pos = new Set(detail.lines.map(l => l.poNo).filter(Boolean));
                        const linked = orders.filter(o => pos.has((o as any).poBatchNo));
                        if (!linked.length) return null;
                        return (
                          <Link href="/orders" className="text-primary hover:underline">
                            생산발주 {linked.length}건 · {[...new Set(linked.map(o => o.status))].join(' · ')} →
                          </Link>
                        );
                      })()}
                      {detail.status === 'issued' && !detail.lines.some(l => l.acceptedAt) && (
                        <Button size="sm" variant="outline" className="h-7 text-xs ml-auto" onClick={cancelIssue} disabled={workflowBusy}>
                          <Undo2 className="w-3 h-3 mr-1" />발주 취소
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      {['draft', 'in_approval'].includes(detail.status) && getCurrentUser()?.role === '대표' && (
                        <Button size="sm" onClick={approve} disabled={workflowBusy || detail.lines.length === 0}>대표 승인</Button>
                      )}
                      <Button size="sm" onClick={issue} disabled={workflowBusy || detail.status !== 'approved' || detail.lines.length === 0}>
                        <Send className="w-3 h-3 mr-1" />발주서 발행
                      </Button>
                      {['in_approval', 'approved'].includes(detail.status) && (
                        <Button size="sm" variant="outline" onClick={cancelIssue} disabled={workflowBusy}>작성으로 되돌리기</Button>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        AMESCOTES 수주함으로 넘어갑니다. 납기는 수주함에서 회신됩니다
                      </span>
                      <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs text-muted-foreground hover:text-[var(--system-red)]"
                        onClick={removeBatch} disabled={workflowBusy || detail.status !== 'draft'}>
                        <Trash2 className="w-3 h-3 mr-1" />발주 삭제
                      </Button>
                    </div>
                  )}

                  <div className="overflow-x-auto border rounded-md">
                  <table className="data-table w-full text-sm min-w-[480px]">
                    <thead className="text-[13px] font-semibold text-muted-foreground">
                      <tr>
                        <th>SKU</th>
                        <th>컬러</th>
                        <th className="num">수량</th>
                        <th>공장</th>
                        <th>생산지</th>
                        <th>경로</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {detail.lines.flatMap(l => {
                        const cqs = l.colorQtys?.length ? l.colorQtys : [{ color: '(미지정)', qty: l.qty }];
                        return cqs.map((cq, i) => (
                          <tr key={`${l.id}-${cq.color}-${i}`} className="hover:bg-[var(--fill-quaternary)]">
                            <td className="nw font-mono text-xs">{i === 0 ? l.styleNo : ''}</td>
                            <td className="text-xs">{cq.color}</td>
                            <td className="num">{cq.qty}</td>
                            <td>{i === 0 ? (l.factoryName || '—') : ''}</td>
                            <td>{i === 0 ? (l.productionOrigin === 'china' ? '중국' : '국내') : ''}</td>
                            <td>{i === 0 ? ((l.route || 'oem') === 'direct' ? '직발주' : 'AMESCOTES') : ''}</td>
                            <td className="text-center">
                              {i === 0 && detail.status === 'draft' && (
                                <button type="button" onClick={() => removeLine(l.id)}
                                  title="이 상품 빼기"
                                  className="text-muted-foreground hover:text-[var(--system-red)] p-1">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                  </div>

                  {detail.status === 'draft' && (
                    <div className="border-t pt-4">
                      <Button size="sm" onClick={() => setPickerOpen(true)}>
                        <Package className="w-3 h-3 mr-1" />상품 담기
                      </Button>
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
                <p className="text-xs text-muted-foreground font-mono">{detailRow.orderNo} · {detailRow.orderDate}</p>
              </DialogHeader>

              <div className="flex flex-wrap gap-1">
                {PIPELINE.map((label, i) => {
                  const stepOn =
                    (i === 0) ||
                    (i === 1 && ['진행중', '생산완료', '부분입고', '선입고', '입고완료', '미지급 등록', '결제완료'].includes(detailRow.displayStatus)) ||
                    (i === 2 && ['생산완료', '부분입고', '선입고', '입고완료', '미지급 등록', '결제완료'].includes(detailRow.displayStatus)) ||
                    (i === 3 && ['부분입고', '선입고', '입고완료', '미지급 등록', '결제완료'].includes(detailRow.displayStatus)) ||
                    (i === 4 && ['미지급 등록', '결제완료'].includes(detailRow.displayStatus)) ||
                    (i === 5 && detailRow.displayStatus === '결제완료');
                  return (
                    <span key={label} className={`text-[11px] px-1.5 py-0.5 rounded border ${
                      stepOn ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-[var(--fill-quaternary)] border-border text-muted-foreground'
                    }`}>{label}</span>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded border p-2"><p className="text-muted-foreground">발주</p><p className="font-bold">{formatNumber(detailRow.qty)}</p></div>
                <div className="rounded border p-2"><p className="text-muted-foreground">선입</p><p className="font-bold text-[var(--system-orange)]">{formatNumber(detailRow.advanceQty)}</p></div>
                <div className="rounded border p-2"><p className="text-muted-foreground">입고</p><p className="font-bold">{formatNumber(detailRow.receivedQty)}</p></div>
                <div className="rounded border p-2"><p className="text-muted-foreground">잔량</p><p className="font-bold">{formatNumber(detailRow.remaining)}</p></div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">컬러별</p>
                <table className="data-table w-full text-xs border rounded overflow-hidden">
                  <thead className="text-muted-foreground font-semibold">
                    <tr>
                      <th>컬러</th>
                      <th className="num">발주</th>
                      <th className="num">선입</th>
                      <th className="num">입고</th>
                      <th className="num">잔량</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(detailRow.colorLines || []).map(cl => (
                      <tr key={cl.color}>
                        <td className="nw font-mono">{cl.color}</td>
                        <td className="num">{formatNumber(cl.qty)}</td>
                        <td className="num text-[var(--system-orange)]">{formatNumber(cl.advanceQty)}</td>
                        <td className="num">{formatNumber(cl.receivedQty)}</td>
                        <td className="num font-semibold">{formatNumber(cl.remaining)}</td>
                        <td className="num">
                          {cl.remaining > 0 && (
                            <Button size="sm" variant="secondary" className="h-6 text-[11px]" onClick={() => openRecv(detailRow, cl.color)}>입고</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">입고 이력</p>
                {detailLogs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">입고 기록 없음</p>
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
                  <Button size="sm" variant="outline" onClick={() => createPayables(detailRow)}>미지급 등록</Button>
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
      <Dialog open={recvOpen} onOpenChange={open => { if (!receiptBusy) setRecvOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>입고 등록</DialogTitle>
            {detailRow && (
              <p className="text-xs text-muted-foreground">{detailRow.styleName} · {detailRow.revision}차 · 잔량 {detailRow.remaining}</p>
            )}
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>목적지</Label>
              <div className="flex gap-2 mt-1">
                <Button type="button" size="sm" variant={recvForm.destination === 'korea' ? 'secondary' : 'outline'}
                  onClick={() => setRecvForm(f => ({ ...f, destination: 'korea' }))}>한국입고</Button>
                <Button type="button" size="sm" variant={recvForm.destination === 'china' ? 'secondary' : 'outline'}
                  onClick={() => setRecvForm(f => ({ ...f, destination: 'china' }))}>중국입고</Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {recvForm.destination === 'korea'
                  ? '미지급 → 공장 다이렉트'
                  : '미지급 → 아메스코테스 중국법인'}
              </p>
            </div>
            <div>
              <Label>수량</Label>
              <Input type="number" min="0" value={recvForm.qty || ''} onChange={e => setRecvForm(f => ({ ...f, qty: +e.target.value }))} />
            </div>
            <div>
              <Label>컬러 <span className="text-destructive">*</span></Label>
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
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={recvForm.isAdvance}
                onChange={e => setRecvForm(f => ({ ...f, isAdvance: e.target.checked }))} />
              생산완료 전 선입고
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={recvForm.createPayable}
                onChange={e => setRecvForm(f => ({ ...f, createPayable: e.target.checked }))} />
              입고와 함께 미지급 초안 생성
            </label>
            <div>
              <Label>메모</Label>
              <Input value={recvForm.memo} onChange={e => setRecvForm(f => ({ ...f, memo: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecvOpen(false)} disabled={receiptBusy}>취소</Button>
            <Button onClick={submitRecv} disabled={receiptBusy}>{receiptBusy ? '저장 중…' : '입고 확정'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

      <StylePickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        factories={factories}
        onAdd={addPicked}
      />
    </>
  );
}
