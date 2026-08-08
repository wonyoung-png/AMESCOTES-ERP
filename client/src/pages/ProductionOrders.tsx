// AMESCOTES ERP — 생산 발주 관리 (BOM 연동)
import { useState, useMemo, useEffect, useRef } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchOrders, upsertOrder, deleteOrder as deleteOrderSB, fetchBoms, fetchVendors, fetchItems, fetchMaterials, upsertMaterial, fetchPurchaseItems, upsertPurchaseItem } from '@/lib/supabaseQueries';
import { phase1 } from '@/lib/phase1';
import { confirmMaterialOrder } from '@/lib/confirmMaterialOrder';
import { nextOrderNo } from '@/lib/orderNo';
import {
  store, genId, calcDDay, dDayLabel, dDayColor, formatNumber, formatKRW, normalizeColors,
  getBomForOrderFromList,
  type ProductionOrder, type OrderStatus, type Season, type Item, type Bom,
  type HqSupplyItem, type ColorQty, type CartItem,
  type TradeStatement, type TradeStatementLine,
  type ExpenseType, type ExpenseCategory, type SalesRecord,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { onSaveFail } from '@/lib/saveGuard';
import { printDoc, copyDocAsImage, saveDocAsImage } from '@/lib/docExport';
import { Plus, Search, Eye, Trash2, Package, FileText, AlertTriangle, CheckCircle2, Factory, ShoppingCart, Printer, X, Pencil, Download, Mail, Receipt, Camera, MoreHorizontal, ChevronRight, ChevronDown, Layers } from 'lucide-react';

const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS'];
const ORDER_STATUSES: OrderStatus[] = ['발주생성', '생산중', '생산완료', '입고완료'];

const STATUS_COLOR: Record<OrderStatus, string> = {
  '초안': 'bg-[var(--system-orange)]/10 text-[var(--system-orange)] border-[var(--system-orange)]/30',
  '발주생성': 'bg-[var(--fill-quaternary)] text-muted-foreground border-border',
  '생산중': 'bg-[var(--fill-tertiary)] text-foreground border-transparent',
  '생산완료': 'bg-primary/10 text-primary border-transparent',
  '입고완료': 'bg-[var(--system-green)]/10 text-[var(--system-green)] border-transparent',
};

// BOM 연동 계산 결과 타입
interface BomCalcResult {
  bomType: 'post' | 'pre' | 'manual' | null;
  bomLoaded: boolean;
  hasBomWarning: boolean;
  factoryUnitPriceCny: number;
  factoryUnitPriceKrw: number;
  totalFactoryAmountKrw: number;
  hqProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; imageUrl?: string; category?: string }>;
  factoryProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; imageUrl?: string; category?: string }>;
  manufacturingCountry?: string;
}

export default function ProductionOrders() {
  const queryClient = useQueryClient();
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
  const setOrders = (_v: ProductionOrder[]) => {}; // no-op
  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: fetchItems });
  const { data: boms = [] } = useQuery({ queryKey: ['boms'], queryFn: fetchBoms });
  const { data: allVendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const buyers = allVendors.filter((v: any) => v.type === '바이어');
  const factories = allVendors.filter((v: any) => v.type === '공장' || v.type === '해외공장');
  // 해외 판별은 region 기준 — '해외공장' 타입은 신규 생성되지 않는 레거시 값이라 폴백으로만 본다
  const isOverseas = (v: any) => (v?.region ?? (v?.type === '해외공장' ? '해외' : '국내')) === '해외';
  const [search, setSearch] = usePersistedState('orders.search', '');
  const [filterBuyer, setFilterBuyer] = usePersistedState('orders.filterBuyer', 'all');
  const [filterStatus, setFilterStatus] = usePersistedState('orders.filterStatus', 'all');
  const [filterSeason, setFilterSeason] = usePersistedState('orders.filterSeason', 'all');
  const [filterFactory, setFilterFactory] = usePersistedState('orders.filterFactory', 'all');
  const [filterStyle, setFilterStyle] = usePersistedState('orders.filterStyle', 'all');
  const [filterDeadline, setFilterDeadline] = usePersistedState('orders.filterDeadline', 'all'); // 'all' | 'urgent' | 'week' | 'overdue'
  const [sortBy, setSortBy] = usePersistedState('orders.sortBy', 'createdAt'); // 'createdAt' | 'deliveryDate' | 'orderNo'
  const [filterExpense, setFilterExpense] = usePersistedState('orders.filterExpense', 'all'); // 'all' | 'done' | 'none'
  const [filterUrgent, setFilterUrgent] = usePersistedState('orders.filterUrgent', false);
  const [filterPo, setFilterPo] = usePersistedState('orders.filterPo', 'all');
  const [groupByPo, setGroupByPo] = usePersistedState('orders.groupByPo', false);
  const [openPoGroups, setOpenPoGroups] = useState<Set<string>>(new Set());

  // 다른 화면(미지급 등)에서 ?order=발주번호 로 들어오면 그 발주 상세를 바로 연다
  const [deepLinked, setDeepLinked] = useState(false);
  useEffect(() => {
    if (deepLinked || (orders as ProductionOrder[]).length === 0) return;
    const wanted = new URLSearchParams(window.location.search).get('order');
    if (!wanted) return;
    const hit = (orders as ProductionOrder[]).find(o => o.orderNo === wanted);
    setDeepLinked(true);
    setSearch(wanted);
    if (hit) setShowDetail(hit);
    else toast.error(`발주번호 ${wanted} 를 찾을 수 없습니다`);
  }, [orders, deepLinked]);
  const [showModal, setShowModal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState<ProductionOrder | null>(null);
  const [form, setForm] = useState<Partial<ProductionOrder>>({});
  const [hqItems, setHqItems] = useState<HqSupplyItem[]>([]);
  const [colorQtys, setColorQtys] = useState<ColorQty[]>([]);

  // BOM 연동 상태
  const [bomCalc, setBomCalc] = useState<BomCalcResult>({
    bomType: null, bomLoaded: false, hasBomWarning: false,
    factoryUnitPriceCny: 0, factoryUnitPriceKrw: 0, totalFactoryAmountKrw: 0,
    hqProvided: [], factoryProvided: [],
  });
  // 공장단가 수동 입력 모드
  const [manualFactoryPrice, setManualFactoryPrice] = useState(false);
  const [manualPriceCny, setManualPriceCny] = useState<number>(0);
  // 공장단가 통화 선택
  const [factoryCurrency, setFactoryCurrency] = useState<'CNY' | 'USD' | 'KRW'>('CNY');

  // 컬러 드롭다운 상태
  const [showColorDropdown, setShowColorDropdown] = useState(false);
  const [customColorInput, setCustomColorInput] = useState('');
  const [showCustomColorInput, setShowCustomColorInput] = useState(false);

  // 입고 처리 팝업 상태
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [receiveOrderId, setReceiveOrderId] = useState<string>('');
  const [receiveForm, setReceiveForm] = useState<{ receivedQty: number; defectQty: number; defectNote: string; receivedDate: string }>({
    receivedQty: 0, defectQty: 0, defectNote: '', receivedDate: new Date().toISOString().split('T')[0],
  });

  // 명세표 발행 모달 상태
  const [billingModal, setBillingModal] = useState(false);
  const [billingTarget, setBillingTarget] = useState<ProductionOrder | null>(null);
  const [billingMode, setBillingMode] = useState<'new' | 'link'>('new');
  const [linkStatementId, setLinkStatementId] = useState('');

  // 작업지시서 모달 상태
  const [batchSheet, setBatchSheet] = useState<{ batchNo: string; orders: ProductionOrder[] } | null>(null);
  const batchSheetRef = useRef<HTMLDivElement>(null);
  const [workOrderModal, setWorkOrderModal] = useState(false);
  const [workOrderTarget, setWorkOrderTarget] = useState<ProductionOrder | null>(null);
  // 사후 불량 — 납품 후 뒤늦게 발견된 불량. 원본을 고치지 않고 차감 이력으로 쌓는다
  const [postDefectTarget, setPostDefectTarget] = useState<ProductionOrder | null>(null);
  const [postDefectForm, setPostDefectForm] = useState({ qty: '', reason: '', foundDate: new Date().toISOString().split('T')[0] });
  // 발주서(PO) 출력 — 작업지시서와 별개 문서
  const [poTarget, setPoTarget] = useState<ProductionOrder | null>(null);
  const poSheetRef = useRef<HTMLDivElement>(null);
  // 납기관리에서 '작업지시서'를 누르고 넘어온 경우 해당 발주의 작업지시서를 바로 연다
  useEffect(() => {
    const id = localStorage.getItem('ames_open_work_order');
    if (!id || orders.length === 0) return;
    const target = (orders as ProductionOrder[]).find(o => o.id === id);
    localStorage.removeItem('ames_open_work_order');
    if (target) setWorkOrderTarget(target);
  }, [orders]);
  const [workOrderNote, setWorkOrderNote] = useState('');
  const [workOrderWithBom, setWorkOrderWithBom] = useState(false);
  // 작업지시서 본사제공 자재 수령 체크란
  const [hqReceive, setHqReceive] = useState<{ received: string; checked: boolean }[]>([]);

  // 발주 완료 후 액션 팝업 상태
  const [postOrderModal, setPostOrderModal] = useState(false);
  const [postOrderInfo, setPostOrderInfo] = useState<{ order: ProductionOrder; bomMaterials: Array<any> } | null>(null);
  const [materialImagePreview, setMaterialImagePreview] = useState<string | null>(null);

  // 자재 장바구니 모달 상태
  const [cartModal, setCartModal] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>(() => store.getMaterialCart());
  const orderBackfillDone = useRef(new Set<string>());

  // 공장단가 / bomId 누락 보완 — BOM 화면과 동일 기준으로 공장단가 연동
  useEffect(() => {
    if (!orders.length) return;
    let cancelled = false;
    (async () => {
      let changed = false;
      for (const o of orders as ProductionOrder[]) {
        if (orderBackfillDone.current.has(o.id)) continue;
        const needPrice = !(o.factoryUnitPriceKrw && o.factoryUnitPriceKrw > 0);
        const needBomMeta = !o.bomId || !o.bomType;
        if (!needPrice && !needBomMeta) {
          orderBackfillDone.current.add(o.id);
          continue;
        }

        await store.fetchAndCacheBom(o.styleNo);
        const fromList = getBomForOrderFromList(boms as Bom[], o.styleNo, o.styleId);
        const local = fromList.bom ? fromList : store.getBomForOrder(o.styleNo);

        // BOM이 아직 없으면 다음에 재시도
        if (!local.bom) continue;

        const updates: Partial<ProductionOrder> = {};
        if (!o.bomId) updates.bomId = local.bom.id;
        if (!o.bomType && local.type) updates.bomType = local.type;

        if (needPrice) {
          const resolved = store.resolveFactoryUnitFromBom(local.bom, o.colorQtys);
          if (resolved.factoryUnitPriceKrw > 0) {
            updates.factoryUnitPriceKrw = resolved.factoryUnitPriceKrw;
            updates.factoryUnitPriceCny = resolved.factoryUnitPriceCny;
            updates.factoryCurrency = o.factoryCurrency || 'CNY';
            if (!o.bomType) updates.bomType = local.type || 'post';
          }
        }

        // 가격이 필요한데 여전히 0이면(원가 미입력 BOM) 완료 표시 — 무한 재시도 방지
        orderBackfillDone.current.add(o.id);
        if (Object.keys(updates).length === 0) continue;
        try {
          await upsertOrder({ ...o, ...updates, updatedAt: new Date().toISOString() });
          changed = true;
        } catch (e) {
          console.warn('[orders] backfill failed', o.orderNo, e);
          orderBackfillDone.current.delete(o.id);
        }
        if (cancelled) return;
      }
      if (changed && !cancelled) {
        queryClient.invalidateQueries({ queryKey: ['orders'] });
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, boms, items, allVendors]);

  // 공장구매/본사제공 자재 카테고리 접기/펼치기 상태
  const CATEGORY_ORDER = ['원자재', '장식', '지퍼', '보강재', '봉사·접착제', '포장재', '철형', '후가공', '기타'];
  const [factoryCategoryOpen, setFactoryCategoryOpen] = useState<Record<string, boolean>>({ '원자재': true });
  const [hqCategoryOpen, setHqCategoryOpen] = useState<Record<string, boolean>>({ '원자재': true });

  // 거래처별 발주서 모달 상태
  const [vendorOrderModal, setVendorOrderModal] = useState(false);

  // 이메일 입력 모달 상태
  const [emailInputModal, setEmailInputModal] = useState(false);
  const [emailInputValue, setEmailInputValue] = useState('');
  const [pendingEmailVendor, setPendingEmailVendor] = useState<string>('');
  const [pendingEmailItems, setPendingEmailItems] = useState<Array<CartItem & { orderQty: number }>>([]);

  // 입고완료 전표생성 모달 상태
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState<{
    orderId: string; orderNo: string; styleNo: string;
    description: string; amountKrw: number; expenseDate: string;
    expenseType: ExpenseType; category: ExpenseCategory;
    vendorName: string; hasTaxInvoice: boolean; memo: string;
  }>({
    orderId: '', orderNo: '', styleNo: '',
    description: '', amountKrw: 0,
    expenseDate: new Date().toISOString().split('T')[0],
    expenseType: '계좌이체', category: '임가공비',
    vendorName: '', hasTaxInvoice: false, memo: '',
  });

  const openExpenseModal = (order: ProductionOrder) => {
    const totalAmt = (order.factoryUnitPriceKrw || 0) * order.qty;
    setExpenseForm({
      orderId: order.id,
      orderNo: order.orderNo,
      styleNo: order.styleNo,
      description: `[생산발주] ${order.orderNo} — ${order.styleName || order.styleNo} ${order.qty.toLocaleString()}PCS`,
      amountKrw: totalAmt,
      expenseDate: order.receivedDate || new Date().toISOString().split('T')[0],
      expenseType: '계좌이체',
      category: '임가공비',
      vendorName: order.vendorName || '',
      hasTaxInvoice: false,
      memo: `스타일: ${order.styleNo} / 수량: ${order.qty.toLocaleString()}PCS / 단가: ${order.factoryUnitPriceKrw ? formatKRW(order.factoryUnitPriceKrw) : '-'}`,
    });
    setExpenseModal(true);
  };

  const handleSaveExpense = () => {
    if (!expenseForm.description) { toast.error('내용을 입력해주세요'); return; }
    if (!expenseForm.amountKrw) { toast.error('금액을 입력해주세요'); return; }
    const order = (orders as ProductionOrder[]).find(o => o.id === expenseForm.orderId);
    const payable = phase1.createPayableFromProcessingOrder({
      id: expenseForm.orderId,
      orderNo: expenseForm.orderNo,
      styleNo: expenseForm.styleNo,
      styleName: order?.styleName,
      qty: order?.qty,
      factoryUnitPriceKrw: order?.factoryUnitPriceKrw,
      vendorId: order?.vendorId,
      vendorName: expenseForm.vendorName || order?.vendorName,
      projectNo: order?.projectNo,
      receivedDate: expenseForm.expenseDate,
    }, expenseForm.amountKrw);
    if (!payable) { toast.error('지출결의 생성 실패 (금액 확인)'); return; }
    if (order) {
      upsertOrder({ ...order, expenseId: payable.id, updatedAt: new Date().toISOString() })
        .then(() => refresh())
        .catch(onSaveFail('발주'));
    }
    toast.success('지출결의(임가공)가 생성되었습니다 — /payables 에서 결제');
    setExpenseModal(false);
  };

  const EXPENSE_PAYMENT_METHODS: ExpenseType[] = ['법인카드', '계좌이체', '현금'];

  // 기존 결의 연결 모달 상태
  const [linkExpenseModal, setLinkExpenseModal] = useState(false);
  const [linkExpenseOrderId, setLinkExpenseOrderId] = useState<string | null>(null);
  const [linkExpenseSearch, setLinkExpenseSearch] = useState('');

  const openLinkExpenseForOrder = (order: ProductionOrder) => {
    setLinkExpenseOrderId(order.id);
    setLinkExpenseSearch('');
    setLinkExpenseModal(true);
  };

  const handleLinkExpenseToOrder = (payableId: string) => {
    if (!linkExpenseOrderId) return;
    const order = (orders as ProductionOrder[]).find(o => o.id === linkExpenseOrderId);
    if (order) {
      upsertOrder({ ...order, expenseId: payableId, updatedAt: new Date().toISOString() })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['orders'] });
          toast.success('지출결의가 연결되었습니다');
        })
        .catch((e: Error) => toast.error(e.message));
    }
    setLinkExpenseModal(false);
    setLinkExpenseOrderId(null);
  };

  const refreshCart = () => setCartItems(store.getMaterialCart());
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['orders'] });

  // 거래처 이메일 발주서 발송 (gog Gmail API 사용)
  const sendVendorEmail = async (vendor: string, email: string, items: Array<CartItem & { orderQty: number }>) => {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const subject = `[AMESCOTES] 자재 발주서 - ${vendor} ${today}`;
    const bodyLines = [
      `안녕하세요, ${vendor} 담당자님.`,
      ``,
      `아래와 같이 자재 발주 드립니다. 확인 및 납기 일정 회신 부탁드립니다.`,
      ``,
      `[발주 일자] ${today}`,
      `[거래처] ${vendor}`,
      ``,
      `─────────────────────────────`,
      `No. | 자재명 | 규격 | 단위 | 발주수량`,
      `─────────────────────────────`,
      ...items.map((item, i) =>
        `${i + 1}. ${item.materialName}${item.spec ? ` (${item.spec})` : ''} | ${item.unit} | ${item.orderQty % 1 === 0 ? item.orderQty.toLocaleString() : item.orderQty.toFixed(3)}`
      ),
      `─────────────────────────────`,
      `총 ${items.length}종`,
      ``,
      `담긴 발주: ${[...new Set(items.flatMap(item => item.orders.map(o => o.styleNo)))].join(', ')}`,
      ``,
      `문의사항은 회신 주시기 바랍니다.`,
      ``,
      `감사합니다.`,
      `AMESCOTES Co., Ltd`,
    ];
    const body = bodyLines.join('\n');
    // fetch 방식으로 서버 API 호출 시도
    try {
      const resp = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email, subject, body, account: 'info@atlm.kr' }),
      });
      if (resp.ok) {
        toast.success(`${vendor} 발주서를 ${email}로 발송했습니다`);
        return;
      }
    } catch {
      // API 없음 - 아래로 fall-through
    }
    // gog CLI 명령어 생성하여 클립보드에 복사
    const gogCmd = `gog gmail send --to "${email}" --subject "${subject}" --body "${body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}" --account info@atlm.kr`;
    try {
      await navigator.clipboard.writeText(gogCmd);
      toast.success(`${vendor} 발주서 이메일 명령어가 클립보드에 복사됐습니다!\n수신: ${email}\n터미널에 붙여넣기해서 실행하세요`);
    } catch {
      toast.info(`${vendor} 발주서\n수신: ${email}\n수동으로 gog 명령어를 실행해주세요`);
    }
  };

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let list = orders;
    if (filterStatus !== 'all') list = list.filter(o => o.status === filterStatus);
    if (filterSeason !== 'all') list = list.filter(o => o.season === filterSeason);
    if (filterBuyer !== 'all') {
      const buyerStyleIds = items.filter(i => i.buyerId === filterBuyer).map(i => i.id);
      list = list.filter(o => buyerStyleIds.includes(o.styleId));
    }
    if (filterUrgent) {
      list = list.filter(o => o.deliveryDate && calcDDay(o.deliveryDate) <= 7 && o.status !== '입고완료');
    }
    if (search) {
      const q = search.toLowerCase();
      // 발주번호 · 스타일 · 품명에 더해 발주서 묶음번호(PO-YYMMDD-NN)로도 찾는다
      list = list.filter(o =>
        o.orderNo.toLowerCase().includes(q) ||
        o.styleNo.toLowerCase().includes(q) ||
        o.styleName.toLowerCase().includes(q) ||
        (o.poBatchNo || '').toLowerCase().includes(q)
      );
    }
    if (filterPo !== 'all') list = list.filter(o => o.poBatchNo === filterPo);
    // 공장 필터
    if (filterFactory !== 'all') list = list.filter(o => o.vendorId === filterFactory || o.vendorName === filterFactory);
    // 스타일 필터
    if (filterStyle !== 'all') list = list.filter(o => o.styleNo === filterStyle);
    // 납기일 상세 필터
    if (filterDeadline === 'd20') list = list.filter(o => { if (!o.deliveryDate) return false; const d = calcDDay(o.deliveryDate); return d >= 0 && d <= 20; });
    if (filterDeadline === 'd10') list = list.filter(o => { if (!o.deliveryDate) return false; const d = calcDDay(o.deliveryDate); return d >= 0 && d <= 10; });
    if (filterDeadline === 'd7') list = list.filter(o => { if (!o.deliveryDate) return false; const d = calcDDay(o.deliveryDate); return d >= 0 && d <= 7; });
    if (filterDeadline === 'd3') list = list.filter(o => { if (!o.deliveryDate) return false; const d = calcDDay(o.deliveryDate); return d >= 0 && d <= 3; });
    if (filterDeadline === 'overdue') list = list.filter(o => o.deliveryDate ? calcDDay(o.deliveryDate) < 0 : false);
    // 전표 필터
    if (filterExpense === 'done') list = list.filter(o => !!(o as any).expenseId || !!o.tradeStatementId);
    if (filterExpense === 'none') list = list.filter(o => !(o as any).expenseId && !o.tradeStatementId);
    // 정렬
    if (sortBy === 'deliveryDate') return list.sort((a, b) => (a.deliveryDate || '9999').localeCompare(b.deliveryDate || '9999'));
    if (sortBy === 'orderNo') return list.sort((a, b) => a.orderNo.localeCompare(b.orderNo));
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [orders, filterStatus, filterSeason, filterBuyer, filterFactory, filterStyle, filterDeadline, filterExpense, sortBy, filterUrgent, items, search, filterPo]);

  /** 발주서 묶음 목록 (필터 드롭다운용) — 최근 발주서가 위로 */
  const poBatchOptions = useMemo(
    () => Array.from(new Set((orders as ProductionOrder[]).map(o => o.poBatchNo).filter((b): b is string => !!b)))
      .sort((a, b) => b.localeCompare(a)),
    [orders],
  );

  /** 같은 발주서(PO)끼리 묶는다. 묶음번호가 없는 건은 그대로 한 줄로 둔다 */
  const poGroups = useMemo(() => {
    const map = new Map<string, ProductionOrder[]>();
    filtered.forEach(o => {
      const key = o.poBatchNo || `single:${o.id}`;
      const cur = map.get(key);
      if (cur) cur.push(o); else map.set(key, [o]);
    });
    return Array.from(map.entries()).map(([key, list]) => ({
      key,
      batchNo: list[0].poBatchNo || null,
      orders: list,
    }));
  }, [filtered]);

  type OrderRow = { kind: 'po'; group: (typeof poGroups)[number] } | { kind: 'order'; order: ProductionOrder };
  const displayRows = useMemo<OrderRow[]>(() => {
    if (!groupByPo) return filtered.map(o => ({ kind: 'order', order: o }));
    const rows: OrderRow[] = [];
    poGroups.forEach(g => {
      // 묶음이 아닌 단건은 요약줄 없이 그대로 보여준다
      if (!g.batchNo) { rows.push({ kind: 'order', order: g.orders[0] }); return; }
      rows.push({ kind: 'po', group: g });
      if (openPoGroups.has(g.key)) g.orders.forEach(o => rows.push({ kind: 'order', order: o }));
    });
    return rows;
  }, [groupByPo, filtered, poGroups, openPoGroups]);

  const togglePoGroup = (key: string) => setOpenPoGroups(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const isAllSelected = filtered.length > 0 && filtered.every(o => selectedIds.has(o.id));
  const toggleSelectAll = () => setSelectedIds(isAllSelected ? new Set() : new Set(filtered.map(o => o.id)));

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`선택한 ${selectedIds.size}건을 삭제하시겠습니까?`)) return;
    for (const id of Array.from(selectedIds)) {
      store.deleteOrder(id);
      deleteOrderSB(id).catch(onSaveFail('발주'));
    }
    setSelectedIds(new Set());
    refresh();
    toast.success(`${selectedIds.size}건 삭제됐어요`);
  };

  const openNew = (prefillStyleId?: string) => {
    const prefillRaw = localStorage.getItem('ames_prefill_order');
    let prefillStyleIdToUse = prefillStyleId;
    if (prefillRaw && !prefillStyleId) {
      try {
        const prefill = JSON.parse(prefillRaw) as { styleId: string; styleNo: string; styleName: string; season: string };
        prefillStyleIdToUse = prefill.styleId;
        localStorage.removeItem('ames_prefill_order');
      } catch { /* ignore */ }
    }

    setIsEditMode(false);
    setEditOrderId(null);
    setForm({ season: '26SS', status: '발주생성', qty: 0, orderDate: new Date().toISOString().split('T')[0], hqSupplyItems: [], attachments: [] });
    setHqItems([]);
    setColorQtys([]);
    setBomCalc({ bomType: null, bomLoaded: false, hasBomWarning: false, factoryUnitPriceCny: 0, factoryUnitPriceKrw: 0, totalFactoryAmountKrw: 0, hqProvided: [], factoryProvided: [] });
    setManualFactoryPrice(false);
    setManualPriceCny(0);
    setFactoryCurrency('CNY');
    setShowColorDropdown(false);
    setShowCustomColorInput(false);
    setCustomColorInput('');
    setShowModal(true);

    if (prefillStyleIdToUse) {
      setTimeout(() => handleStyleSelect(prefillStyleIdToUse!), 0);
    }
  };

  const openEdit = (order: ProductionOrder) => {
    setIsEditMode(true);
    setEditOrderId(order.id);
    setForm({ ...order });
    setHqItems(order.hqSupplyItems || []);
    setColorQtys(order.colorQtys || []);
    setBomCalc({ bomType: order.bomType as 'post' | 'pre' | 'manual' | null, bomLoaded: true, hasBomWarning: false, factoryUnitPriceCny: order.factoryUnitPriceCny || 0, factoryUnitPriceKrw: order.factoryUnitPriceKrw || 0, totalFactoryAmountKrw: (order.factoryUnitPriceKrw || 0) * order.qty, hqProvided: [], factoryProvided: [] });
    setManualFactoryPrice(order.bomType === 'manual');
    setManualPriceCny(order.factoryUnitPriceCny || 0);
    setFactoryCurrency((order.factoryCurrency as 'CNY' | 'USD' | 'KRW') || 'CNY');
    setShowColorDropdown(false);
    setShowCustomColorInput(false);
    setCustomColorInput('');
    setShowModal(true);
  };

  useEffect(() => {
    const prefillRaw = localStorage.getItem('ames_prefill_order');
    if (prefillRaw) { openNew(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BOM 기반 계산 (스타일+수량 변경 시 호출)
  const recalcBom = (styleNo: string, qty: number) => {
    if (!styleNo || qty <= 0) return;
    // 최신 BOM 항상 Supabase에서 동기화 후 계산
    store.fetchAndCacheBom(styleNo).then(() => {
      _doRecalcBom(styleNo, qty);
    });
  };
  const _doRecalcBom = (styleNo: string, qty: number) => {
    if (!styleNo || qty <= 0) return;
    const { bom } = store.getBomForOrder(styleNo);
    const result = store.calcMaterialRequirements(styleNo, qty, colorQtys.length > 0 ? colorQtys : undefined);

    if (result.bomType === null) {
      // BOM 없음
      setBomCalc(prev => ({
        ...prev, bomLoaded: false, hasBomWarning: true,
        factoryUnitPriceCny: 0, factoryUnitPriceKrw: 0, totalFactoryAmountKrw: 0,
        hqProvided: [], factoryProvided: [],
      }));
      return;
    }

    const resolved = store.resolveFactoryUnitFromBom(bom, colorQtys.length > 0 ? colorQtys : undefined);
    const factoryUnitPriceKrw = resolved.factoryUnitPriceKrw > 0
      ? resolved.factoryUnitPriceKrw
      : Math.round(result.factoryUnitPriceCny * (resolved.rate || store.getSettings().cnyKrw || 191));
    const factoryUnitPriceCny = resolved.factoryUnitPriceCny > 0
      ? resolved.factoryUnitPriceCny
      : result.factoryUnitPriceCny;
    const totalFactoryAmountKrw = factoryUnitPriceKrw * qty;

    setBomCalc({
      bomType: result.bomType,
      bomLoaded: true,
      hasBomWarning: false,
      factoryUnitPriceCny,
      factoryUnitPriceKrw,
      totalFactoryAmountKrw,
      hqProvided: result.hqProvided,
      factoryProvided: result.factoryProvided,
      manufacturingCountry: result.manufacturingCountry,
    });

    // 공장단가 폼에 자동 설정
    setForm(f => ({
      ...f,
      factoryUnitPriceCny,
      factoryUnitPriceKrw,
      bomType: result.bomType as 'post' | 'pre',
    }));
  };

  const handleStyleSelect = (styleId: string) => {
    const item = items.find(i => i.id === styleId);
    if (!item) return;
    // Supabase orders(useQuery)에서 같은 스타일 발주 조회 → 최대 revision+1
    const existingForStyle = (orders as any[]).filter(o => o.styleNo === item.styleNo);
    const existingRevisions = existingForStyle.map((o: any) => {
      const match = (o.orderNo || '').match(/-R(\d+)$/);
      return match ? parseInt(match[1]) : 0;
    });
    const nextRevision = existingRevisions.length > 0 ? Math.max(...existingRevisions) + 1 : 1;
    const orderNo = `${item.styleNo}-R${nextRevision}`;
    const bomList = boms.filter(b => b.styleId === styleId);
    const bom = bomList.sort((a, b) => b.version - a.version)[0];

    // HQ 제공 자재 추출 (BOM에서)
    const { bom: bomForOrder } = getBomForOrderFromList(boms as Bom[], item.styleNo);
    const usedLines = bomForOrder
      ? ((bomForOrder.postMaterials && bomForOrder.postMaterials.length > 0)
          ? bomForOrder.postMaterials
          : bomForOrder.lines)
      : [];
    const hqFromBom: HqSupplyItem[] = (usedLines || [])
      .filter(l => l.isHqProvided)
      .map(l => ({
        bomLineId: l.id,
        itemName: l.itemName,
        spec: l.spec,
        unit: l.unit,
        requiredQty: 0,
        currency: 'CNY' as const,
        purchaseStatus: '미구매' as const,
        vendorId: undefined,
        memo: l.vendorName ? `구매처: ${l.vendorName}` : undefined,
      }));
    setHqItems(hqFromBom);

    // BOM currency → factoryCurrency 기본값 설정
    if (bomForOrder?.currency) {
      setFactoryCurrency(bomForOrder.currency);
    }

    setForm(f => ({
      ...f,
      styleId: item.id,
      styleNo: item.styleNo,
      styleName: item.name,
      orderNo,
      revision: nextRevision,
      bomId: bom?.id,
    }));

    // 수량이 이미 있으면 BOM 재계산
    const currentQty = form.qty || 0;
    if (currentQty > 0) {
      recalcBom(item.styleNo, currentQty);
    } else {
      // 수량 없어도 BOM 존재 여부 확인
      const { bom: b } = getBomForOrderFromList(boms as Bom[], item.styleNo);
      setBomCalc(prev => ({
        ...prev,
        bomLoaded: !!b,
        hasBomWarning: !b,
        bomType: b ? ((b as any).postColorBoms?.length > 0 || (b.postMaterials && b.postMaterials.length > 0) ? 'post' : 'pre') : null,
      }));
    }
  };

  const handleQtyChange = (newQty: number) => {
    setForm(f => ({ ...f, qty: newQty }));
    if (form.styleNo && newQty > 0) {
      recalcBom(form.styleNo, newQty);
      // HQ items 수량도 재계산
      if (bomCalc.hqProvided.length > 0) {
        const result = store.calcMaterialRequirements(form.styleNo!, newQty, colorQtys.length > 0 ? colorQtys : undefined);
        setHqItems(prev => prev.map(item => {
          const found = result.hqProvided.find(h => h.bomLineId === item.bomLineId);
          return found ? { ...item, requiredQty: found.reqQty } : item;
        }));
      }
    }
  };

  // ── 일괄 발주 등록 (스타일 여러 개 → 스타일별 발주서 각각 생성) ──
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [stylePickerSearch, setStylePickerSearch] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSearch, setBulkSearch] = useState('');
  const [bulkBrand, setBulkBrand] = useState('all');
  const [bulkSeason, setBulkSeason] = useState('all');
  const [bulkCat, setBulkCat] = useState('all');
  const [bulkRows, setBulkRows] = useState<Record<string, {
    colorQtys: { color: string; qty: string }[];
    orderDate: string; deliveryDate: string; vendorId: string;
  }>>({});

  /** 발주 등록 목록에서 쓰는 브랜드명 (브랜드 우선, 없으면 회사명) */
  const brandOfItem = (i: Item) => {
    const b: any = allVendors.find((v: any) => v.id === (i as any).buyerId);
    return b?.brands?.[0] || b?.nameEn || b?.name || '';
  };

  const bulkBrandOptions = useMemo(
    () => Array.from(new Set((items as Item[]).map(brandOfItem).filter(Boolean))).sort(),
    [items, allVendors],
  );
  const bulkSeasonOptions = useMemo(
    () => Array.from(new Set((items as Item[]).map(i => i.season).filter(Boolean))).sort(),
    [items],
  );
  const bulkCatOptions = useMemo(
    () => Array.from(new Set((items as Item[]).map(i => i.erpCategory).filter(Boolean))).sort(),
    [items],
  );

  const bulkCandidates = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    return (items as Item[])
      .filter(i => {
        if (bulkBrand !== 'all' && brandOfItem(i) !== bulkBrand) return false;
        if (bulkSeason !== 'all' && i.season !== bulkSeason) return false;
        if (bulkCat !== 'all' && i.erpCategory !== bulkCat) return false;
        if (!q) return true;
        const buyer: any = allVendors.find((v: any) => v.id === (i as any).buyerId);
        const brands = [buyer?.name, buyer?.companyName, buyer?.nameEn, ...((buyer?.brands as string[]) || [])];
        return [i.styleNo, (i as any).buyerStyleNo, i.name, i.nameEn, ...brands]
          .some(f => (f || '').toLowerCase().includes(q));
      })
      // 브랜드 → 스타일번호 순으로 정렬해 같은 브랜드가 붙어 보이게 한다
      .sort((a, b) => {
        const ba = brandOfItem(a), bb = brandOfItem(b);
        if (ba !== bb) return ba.localeCompare(bb);
        return (a.styleNo || '').localeCompare(b.styleNo || '');
      });
  }, [items, allVendors, bulkSearch, bulkBrand, bulkSeason, bulkCat]);

  const toggleBulkRow = (item: Item) => {
    setBulkRows(prev => {
      if (prev[item.id]) { const { [item.id]: _drop, ...rest } = prev; return rest; }
      const today = new Date().toISOString().split('T')[0];
      // 품목에 등록된 컬러를 미리 깔아준다 — 컬러 없이 수량만 넣는 건 의미가 없다
      const colors = normalizeColors(item.colors || []).map(c => ({ color: c.name, qty: '' }));
      return {
        ...prev,
        [item.id]: {
          colorQtys: colors.length ? colors : [{ color: '', qty: '' }],
          orderDate: today, deliveryDate: '', vendorId: '',
        },
      };
    });
  };

  /** 간편등록으로 들어온 초안을 정식 발주로 확정 — 이때 발주번호가 붙는다 */
  const confirmDraft = async (o: ProductionOrder) => {
    if (!o.vendorId) { toast.error('공장을 먼저 지정하세요 — 행에서 수정으로 들어가세요'); return; }
    const orderNo = nextOrderNo(o.styleNo, orders as any[]);
    try {
      const revision = parseInt((orderNo.match(/-R(\d+)$/) || [])[1] || '1', 10);
      await upsertOrder({
        ...o, orderNo, status: '발주생성',
        revision,
        isReorder: revision >= 2,   // 같은 스타일 재발주면 -R2 이상이 붙는다
        updatedAt: new Date().toISOString(),
      });
      toast.success(`발주 확정 — ${orderNo}`);
      refresh();
    } catch (e) {
      toast.error(`확정 실패: ${(e as Error).message}`);
    }
  };

  /** 묶음번호: PO-YYMMDD-NN (같은 날 순번) */
  const nextPoBatchNo = (existing: ProductionOrder[]) => {
    const d = new Date();
    const ymd = `${String(d.getFullYear() % 100).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const head = `PO-${ymd}-`;
    const used = existing
      .map(o => o.poBatchNo)
      .filter((b): b is string => !!b && b.startsWith(head))
      .map(b => parseInt(b.slice(head.length), 10) || 0);
    return `${head}${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
  };

  /** 선택한 스타일마다 발주서를 따로 만든다 (작업지시서도 발주 단위라 자동으로 분리됨) */
  const saveBulkOrders = async () => {
    const picked = Object.entries(bulkRows);
    if (picked.length === 0) { toast.error('스타일을 선택해주세요'); return; }
    const bad = picked.find(([, r]) => r.colorQtys.every(c => !Number(c.qty)));
    if (bad) { toast.error('수량을 입력하지 않은 스타일이 있습니다'); return; }
    const noColor = picked.find(([, r]) => r.colorQtys.some(c => Number(c.qty) > 0 && !c.color.trim()));
    if (noColor) { toast.error('컬러명을 입력하세요 — 컬러 없이 수량만 넣으면 발주할 수 없습니다'); return; }

    // 이번 일괄 발주 = 묶음 1개. 공장에 나가는 발주서는 이 묶음 단위로 1장.
    const batchNo = nextPoBatchNo(orders as ProductionOrder[]);
    const known = [...(orders as any[])];
    const created: ProductionOrder[] = [];
    let ok = 0;
    for (const [itemId, row] of picked) {
      const item = (items as Item[]).find(i => i.id === itemId);
      if (!item) continue;
      const vendor = allVendors.find((v: any) => v.id === row.vendorId);
      const orderNo = nextOrderNo(item.styleNo, known);
      const order: ProductionOrder = {
        id: genId(),
        orderNo,
        workspace: 'OEM',
        styleId: item.id,
        styleNo: item.styleNo,
        styleName: item.name,
        season: item.season,
        revision: parseInt((orderNo.match(/-R(\d+)$/) || [])[1] || '1', 10),
        isReorder: /-R([2-9]|\d{2,})$/.test(orderNo),
        qty: row.colorQtys.reduce((sum, c) => sum + (Number(c.qty) || 0), 0),
        colorQtys: row.colorQtys.filter(c => Number(c.qty) > 0).map(c => ({ color: c.color.trim(), qty: Number(c.qty) })),
        vendorId: row.vendorId || '',
        vendorName: (vendor as any)?.name || '',
        orderDate: row.orderDate,
        deliveryDate: row.deliveryDate || undefined,
        status: '발주생성',
        poBatchNo: batchNo,
        attachments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as ProductionOrder;
      try {
        await upsertOrder(order);
        known.push(order as any);
        created.push(order);
        ok += 1;
      } catch (e) {
        toast.error(`${item.styleNo} 발주 실패: ${(e as Error).message}`);
      }
    }
    if (ok > 0) {
      toast.success(`발주 ${ok}건 등록 · 묶음 ${batchNo}`);
      setBulkRows({});
      setBulkSearch('');
      setBulkOpen(false);
      refresh();
      setBatchSheet({ batchNo, orders: created });   // 공장 발주서(묶음 1장) 바로 열기
    }
  };

  const handleSave = async () => {
    if (!form.styleId) { toast.error('스타일을 선택해주세요'); return; }
    if (!form.vendorId) { toast.error('발주처(공장)를 선택해주세요'); return; }

    const totalQty = colorQtys.length > 0
      ? colorQtys.reduce((s, c) => s + c.qty, 0)
      : (form.qty || 0);

    // 공장단가: 네고 적용 시 form에 저장된 값 사용, 수동입력 모드면 manualPriceCny, 아니면 BOM 계산값
    const settings = store.getSettings();
    const cnyKrw = settings.cnyKrw || 191;
    const usdKrw = settings.usdKrw || 1380;
    let finalFactoryUnitPriceCny: number;
    let finalFactoryUnitPriceKrw: number;

    finalFactoryUnitPriceCny = manualFactoryPrice ? manualPriceCny : bomCalc.factoryUnitPriceCny;
    if (factoryCurrency === 'KRW') {
      finalFactoryUnitPriceKrw = Math.round(finalFactoryUnitPriceCny);
    } else if (factoryCurrency === 'USD') {
      finalFactoryUnitPriceKrw = Math.round(finalFactoryUnitPriceCny * usdKrw);
    } else {
      finalFactoryUnitPriceKrw = Math.round(finalFactoryUnitPriceCny * cnyKrw);
    }

    const finalNegoHistory = (form as any).negoHistory || [];

    if (isEditMode && editOrderId) {
      // 편집 모드: 기존 발주 업데이트
      const updates: Partial<ProductionOrder> = {
        qty: totalQty,
        colorQtys: colorQtys.length > 0 ? colorQtys : undefined,
        vendorId: form.vendorId || '',
        vendorName: form.vendorName || '',
        orderDate: form.orderDate || new Date().toISOString().split('T')[0],
        deliveryDate: form.deliveryDate,
        status: form.status || '발주생성',
        hqSupplyItems: hqItems,
        factoryUnitPriceCny: finalFactoryUnitPriceCny,
        factoryUnitPriceKrw: finalFactoryUnitPriceKrw,
        factoryCurrency,
        bomType: manualFactoryPrice ? 'manual' : (bomCalc.bomType ?? undefined),
        negoHistory: finalNegoHistory,
        memo: form.memo,
        updatedAt: new Date().toISOString(),
      };
      const existingOrder = (orders as ProductionOrder[]).find(o => o.id === editOrderId);
      const fullUpdated = { ...(existingOrder || {}), ...updates, id: editOrderId } as ProductionOrder;
      upsertOrder(fullUpdated)
        .then(() => { toast.success('발주가 수정되었습니다'); refresh(); setShowModal(false); setIsEditMode(false); setEditOrderId(null); })
        .catch((e: Error) => toast.error(`저장 실패: ${e.message}`));
      return;
    }

    // 신규 발주 시 실제 저장될 orderNo를 명시적으로 계산 (form.orderNo가 오래된 값일 수 있음)
    const finalOrderNo = nextOrderNo(form.styleNo || '', orders as any[]);

    // 손익·전표 연결 키 = 발주번호. OEM은 project_no 미발급
    const order: ProductionOrder = {
      id: genId(),
      orderNo: finalOrderNo,
      workspace: 'OEM',
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
      orderDate: form.orderDate || new Date().toISOString().split('T')[0],
      status: form.status || '발주생성',
      bomId: form.bomId,
      hqSupplyItems: hqItems,
      attachments: [],
      factoryUnitPriceCny: finalFactoryUnitPriceCny,
      factoryUnitPriceKrw: finalFactoryUnitPriceKrw,
      factoryCurrency,
      bomType: manualFactoryPrice ? 'manual' : (bomCalc.bomType ?? undefined),
      deliveryDate: form.deliveryDate,
      negoHistory: finalNegoHistory,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      memo: form.memo,
    };
    // 서버 저장이 끝난 뒤에만 다음 단계로 — 실패했는데 "등록 완료" 팝업이 뜨던 문제
    try {
      await upsertOrder(order);
    } catch (e) {
      toast.error(`발주 저장 실패 — 서버에 저장되지 않았습니다: ${(e as Error).message}`);
      return;
    }

    // 새 컬러 → 품목 마스터 자동 추가 (낙관적 업데이트)
    if (colorQtys.length > 0 && form.styleId) {
      const currentItem = (items as Item[]).find((i: any) => i.id === form.styleId);
      const existingColorNames = normalizeColors(currentItem?.colors || []).map(c => c.name);
      const newColors = colorQtys
        .map(cq => cq.color.trim())
        .filter(c => c && !existingColorNames.includes(c))
        .map(c => ({ name: c }));
      if (newColors.length > 0 && currentItem) {
        const updatedColors = [...normalizeColors(currentItem.colors || []), ...newColors];
        import('@/lib/supabaseQueries').then(m => m.upsertItem({ ...currentItem, colors: updatedColors } as any)).catch(onSaveFail('발주'));
        queryClient.setQueryData(['items'], (old: any[] = []) =>
          old.map((it: any) => it.id === form.styleId ? { ...it, colors: updatedColors } : it)
        );
      }
    }

    refresh();
    setShowModal(false);

    // 발주 완료 후 액션 팝업: BOM 자재 목록 계산
    const bomMaterials: Array<any> = [];
    let _bomForCart: any = null;  // 장바구니 담기용 bom 참조
    if (form.styleNo) {
      const { bom } = getBomForOrderFromList(boms as Bom[], form.styleNo);
      _bomForCart = bom;  // 외부 스코프로 전달
      if (bom) {
        // postColorBoms 우선 → 선택된 컬러만 → postMaterials → lines 순서로 확인
        const postColorBoms = (bom as any).postColorBoms || [];
        // 선택된 컬러 목록 - 저장된 order의 colorQtys 사용 (폼 초기화 후에도 유지)
        const orderColorQtys = order.colorQtys || [];
        const selectedColors = orderColorQtys.filter(cq => cq.qty > 0).map(cq => cq.color.trim());
        let allLines: any[] = [];
        if (postColorBoms.length > 0) {
          if (selectedColors.length > 0) {
            // 선택된 컬러에 해당하는 BOM lines만 가져옴
            allLines = postColorBoms
              .filter((cb: any) => selectedColors.includes(cb.color?.trim()))
              .flatMap((cb: any) => cb.lines || []);
            // 선택된 컬러 BOM 없으면 첫 번째 컬러로 폴백
            if (allLines.length === 0) {
              allLines = (postColorBoms[0]?.lines || []);
            }
          } else {
            allLines = postColorBoms[0]?.lines || [];
          }
        } else if (bom.postMaterials && bom.postMaterials.length > 0) {
          allLines = bom.postMaterials;
        } else {
          allLines = bom.lines || [];
        }
        // bomMaterials는 팝업용 (중복 제거)
        const seen = new Set<string>();
        for (const l of allLines) {
          if (l.isHqProvided && !seen.has(l.itemName)) {
            seen.add(l.itemName);
            bomMaterials.push({
              itemName: l.itemName,
              spec: l.spec,
              unit: l.unit,
              netQty: l.netQty,
              lossRate: l.lossRate,
              vendorName: l.vendorName,
              isHqProvided: true,
              imageUrl: l.imageUrl,
              unitPriceCny: (l as any).unitPriceCny ?? (l as any).unitPrice ?? 0,
            });
          }
        }
      }
    }

    // 본사제공 자재 자동 장바구니 저장 - Supabase REST API raw 데이터 직접 조회 (await)
    try {
      const _sbUrl = 'https://linzfvhgswrnoukssqyi.supabase.co/rest/v1';
      const _sbKey = 'sb_publishable_-cxAP3_Gkq4XkBfc55OymA_ozoSEEH2';
      const _rawRes = await fetch(`${_sbUrl}/boms?style_no=eq.${order.styleNo}&select=post_color_boms`, {
        headers: { 'apikey': _sbKey, 'Authorization': `Bearer ${_sbKey}` }
      });
      const _rawBoms: any[] = await _rawRes.json();
      const _rawBom = _rawBoms?.[0];
      const _postColorBoms = _rawBom?.post_color_boms || [];
      const _orderColorQtys = order.colorQtys || [];
      if (_postColorBoms.length > 0 && _orderColorQtys.length > 0) {
        for (const cq of _orderColorQtys) {
          if (!cq.qty || cq.qty <= 0) continue;
          const _cb = _postColorBoms.find((cb: any) => cb.color?.trim() === cq.color?.trim());
          if (!_cb) continue;
          const _mats = (_cb.lines || [])
            .filter((l: any) => l.isHqProvided)
            .map((l: any) => ({
              itemName: l.itemName ?? '',
              spec: l.spec ?? '',
              unit: l.unit ?? '',
              netQty: l.netQty ?? 0,
              lossRate: l.lossRate ?? 0,
              vendorName: l.vendorName ?? '',
              isHqProvided: true,
              imageUrl: l.imageUrl,
              unitPriceCny: l.unitPriceCny ?? 0,
            }));
          if (_mats.length > 0) {
            store.addToMaterialCart(order.styleNo, order.styleName, _mats, cq.qty);
          }
        }
      } else if (bomMaterials.length > 0) {
        store.addToMaterialCart(order.styleNo, order.styleName, bomMaterials, totalQty);
      }
    } catch { /* ignore */ }
    refreshCart();

    setPostOrderInfo({ order, bomMaterials });
    setPostOrderModal(true);

    {
      // 새 컬러 개수 계산 후 토스트
      const _currentItem = (items as Item[]).find((i: any) => i.id === form.styleId);
      const _existingColorNames = normalizeColors(_currentItem?.colors || []).map(c => c.name);
      const _newColorCount = colorQtys.filter(cq => cq.color.trim() && !_existingColorNames.includes(cq.color.trim())).length;
      if (_newColorCount > 0) {
        toast.success(`발주 등록 완료 · 새 컬러 ${_newColorCount}개가 품목 마스터에 추가됨`);
      }
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm('발주를 삭제하시겠습니까?')) return;
    deleteOrderSB(id)
      .then(() => { refresh(); toast.success('삭제되었습니다'); })
      .catch((e: Error) => toast.error(`삭제 실패: ${e.message}`));
  };

  const savePostDefect = async () => {
    const order = postDefectTarget;
    if (!order) return;
    const qty = Number(postDefectForm.qty);
    if (!qty || qty <= 0) { toast.error('불량 수량을 입력하세요'); return; }
    if (!postDefectForm.reason.trim()) { toast.error('사유를 입력하세요'); return; }
    const entry = {
      id: genId(),
      qty,
      reason: postDefectForm.reason.trim(),
      foundDate: postDefectForm.foundDate,
    };
    try {
      await upsertOrder({
        ...order,
        postDefects: [...(order.postDefects || []), entry],
        updatedAt: new Date().toISOString(),
      });
      toast.success(`사후 불량 ${qty}개 등록 — 다음 명세표에서 차감됩니다`);
      setPostDefectTarget(null);
      setPostDefectForm({ qty: '', reason: '', foundDate: new Date().toISOString().split('T')[0] });
      refresh();
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    }
  };

  const handleStatusChange = (id: string, status: OrderStatus) => {
    if (status === '입고완료') {
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
    const existing = (orders as ProductionOrder[]).find(o => o.id === id);
    if (existing) {
      upsertOrder({ ...existing, status, updatedAt: new Date().toISOString() }).then(() => refresh()).catch(onSaveFail('발주'));
    }
  };

  const handleReceiveConfirm = () => {
    const existing = (orders as ProductionOrder[]).find(o => o.id === receiveOrderId);
    if (existing) {
      upsertOrder({
        ...existing,
        status: '입고완료',
        receivedQty: receiveForm.receivedQty,
        defectQty: receiveForm.defectQty,
        defectNote: receiveForm.defectNote,
        receivedDate: receiveForm.receivedDate,
        updatedAt: new Date().toISOString(),
      }).then(() => {
        // 매출관리 자동 등록 (중복 방지)
        const existingSales = store.getSalesRecords();
        const alreadyExists = existingSales.some(s => s.orderId === existing.id);
        if (!alreadyExists) {
          const vendorObj = allVendors.find((v: any) => v.id === existing.buyerId && (v.type === '바이어' || v.type === '브랜드'));
          const buyerName = vendorObj?.name || (existing as any).buyerName || '미지정';
          const salesRecord: SalesRecord = {
            id: genId(),
            saleDate: receiveForm.receivedDate || new Date().toISOString().split('T')[0],
            channel: 'B2B직납',
            buyerName,
            styleNo: existing.styleNo,
            styleName: existing.styleName,
            qty: receiveForm.receivedQty || existing.qty,
            unitPriceKrw: existing.factoryUnitPriceKrw || 0,
            totalKrw: (existing.factoryUnitPriceKrw || 0) * (receiveForm.receivedQty || existing.qty),
            season: existing.season,
            memo: `발주번호 ${existing.orderNo} 입고완료 자동 등록`,
            createdAt: new Date().toISOString(),
            orderId: existing.id,
            orderNo: existing.orderNo,
            vendorId: existing.vendorId,
            vendorName: existing.vendorName,
            source: 'production',
          };
          store.addSalesRecord(salesRecord);
        }
        setShowReceiveModal(false);
        refresh();
        toast.success('입고 처리 완료 — 매출관리에 자동 등록되었습니다');
      }).catch((e: Error) => toast.error(`처리 실패: ${e.message}`));
    }
  };

  const openBillingModal = (order: ProductionOrder) => {
    setBillingTarget(order);
    setBillingMode('new');
    setLinkStatementId('');
    setBillingModal(true);
  };

  const handleConfirmBilling = () => {
    if (!billingTarget) return;
    const order = billingTarget;
    const item = items.find(i => i.id === order.styleId);
    if (!item) { toast.error('품목 정보를 찾을 수 없습니다'); return; }

    const buyer = buyers.find(b => b.id === item.buyerId);
    if (!buyer) { toast.error('바이어 정보가 없습니다. 품목의 바이어를 먼저 설정해주세요'); return; }

    const today = new Date().toISOString().split('T')[0];
    // 청구 수량 = 실제 입고분 - 입고불량 - 아직 정산 안 된 사후불량
    const pendingPostDefect = (order.postDefects || []).filter(d => !d.settledAt).reduce((s2, d) => s2 + d.qty, 0);
    const billQty = Math.max(0, (order.receivedQty !== undefined
      ? (order.receivedQty || 0) - (order.defectQty || 0)
      : order.qty) - pendingPostDefect);
    const rawColorQtys = order.colorQtys && order.colorQtys.length > 0 ? order.colorQtys : [{ color: '기본', qty: order.qty }];
    const orderedTotal = rawColorQtys.reduce((s, c) => s + c.qty, 0) || order.qty || 1;
    // 컬러별로 청구 수량을 발주 비율대로 나눈다 (마지막 컬러가 잔여를 흡수)
    const colorQtyList = (() => {
      if (billQty === orderedTotal) return rawColorQtys;
      let left = billQty;
      return rawColorQtys.map((c, i) => {
        const q = i === rawColorQtys.length - 1 ? left : Math.round((c.qty / orderedTotal) * billQty);
        left -= q;
        return { ...c, qty: Math.max(0, q) };
      });
    })();
    const unitPrice = item.deliveryPrice || item.targetSalePrice || order.factoryUnitPriceKrw || 0;

    if (billingMode === 'new') {
      const vendorCode = buyer.vendorCode || buyer.code || 'XXX';
      const statementNo = store.getNextStatementNo(vendorCode);

      const lines: TradeStatementLine[] = colorQtyList.map(cq => ({
        id: genId(),
        description: `[${order.styleNo}] ${order.styleName}${cq.color !== '기본' ? ` (${cq.color})` : ''}`,
        qty: cq.qty,
        unitPrice,
        taxType: '과세' as const,
        taxRate: 0.1,
        memo: [
          `발주번호 ${order.orderNo}`,
          order.defectQty ? `불량 ${order.defectQty}개 차감` : '',
          pendingPostDefect ? `사후불량 ${pendingPostDefect}개 차감` : '',
        ].filter(Boolean).join(' · '),
      }));

      // 이번 명세표에 반영한 사후불량은 정산 완료로 표시해 다음에 또 빠지지 않게 한다
      if (pendingPostDefect > 0) {
        const today2 = today;
        upsertOrder({
          ...order,
          postDefects: (order.postDefects || []).map(d => d.settledAt ? d : { ...d, settledAt: today2 }),
          updatedAt: new Date().toISOString(),
        }).catch(onSaveFail('발주'));
      }

      const newStatement: TradeStatement = {
        id: genId(),
        statementNo,
        vendorId: buyer.id,
        vendorName: buyer.name,
        vendorCode,
        issueDate: today,
        lines,
        status: '미청구',
        createdAt: new Date().toISOString(),
        memo: `발주번호 ${order.orderNo}에서 자동 생성`,
      };

      store.addTradeStatement(newStatement); // 거래명세표 store에 유지
      const existingOrder1 = (orders as ProductionOrder[]).find(o => o.id === order.id);
      if (existingOrder1) {
        upsertOrder({ ...existingOrder1, tradeStatementId: newStatement.id, updatedAt: new Date().toISOString() })
          .then(() => refresh()).catch(onSaveFail('발주'));
      }
      setBillingModal(false);
      toast.success(`거래명세표 ${statementNo} 생성 완료 → 거래명세표 탭에서 확인하세요`);
    } else {
      if (!linkStatementId) { toast.error('연결할 전표를 선택해주세요'); return; }
      const stmt = store.getTradeStatements().find(t => t.id === linkStatementId);
      if (!stmt) { toast.error('선택한 전표를 찾을 수 없습니다'); return; }

      const newLines: TradeStatementLine[] = colorQtyList.map(cq => ({
        id: genId(),
        description: `[${order.styleNo}] ${order.styleName}${cq.color !== '기본' ? ` (${cq.color})` : ''}`,
        qty: cq.qty,
        unitPrice,
        taxType: '과세' as const,
        taxRate: 0.1,
        memo: `발주번호 ${order.orderNo}`,
      }));

      store.updateTradeStatement(linkStatementId, { lines: [...(stmt.lines || []), ...newLines] });
      const existingOrder2 = (orders as ProductionOrder[]).find(o => o.id === order.id);
      if (existingOrder2) {
        upsertOrder({ ...existingOrder2, tradeStatementId: linkStatementId, updatedAt: new Date().toISOString() })
          .then(() => refresh()).catch(onSaveFail('발주'));
      }
      setBillingModal(false);
      toast.success(`${stmt.statementNo}에 발주 항목이 추가됐습니다`);
    }
  };

  const openWorkOrderModal = (order: ProductionOrder, withBom = false) => {
    setWorkOrderTarget(order);
    setWorkOrderNote('');
    setWorkOrderWithBom(withBom);
    // 본사제공 자재 수령 체크란 초기화
    const { bom } = getBomForOrderFromList(boms as Bom[], order.styleNo);
    const bomLines = bom ? ((bom.postMaterials && bom.postMaterials.length > 0) ? bom.postMaterials : (bom.lines || [])) : [];
    const hqMats = bomLines.filter((l: any) => l.isHqProvided);
    setHqReceive(hqMats.map(() => ({ received: '', checked: false })));
    setWorkOrderModal(true);
  };

  const handlePrintWorkOrder = () => {
    window.print();
  };

  /** 작업지시서를 이미지로 — 카톡·위챗 전달용 */
  const workOrderAsImage = async (mode: 'copy' | 'save') => {
    const el = document.getElementById('work-order-print-area') as HTMLElement | null;
    if (!el) { toast.error('작업지시서 영역을 찾을 수 없습니다'); return; }
    try {
      if (mode === 'copy') { await copyDocAsImage(el); toast.success('이미지 복사됨 — 카톡·위챗에 붙여넣으세요'); }
      else { await saveDocAsImage(el, `작업지시서_${workOrderTarget?.orderNo || ''}`); toast.success('이미지 저장됨'); }
    } catch (e) { toast.error((e as Error).message); }
  };

  const [showFactoryView, setShowFactoryView] = useState(false);

  const stats = useMemo(() => ({
    total: orders.filter((o: ProductionOrder) => o.status !== '초안').length,
    drafts: orders.filter((o: ProductionOrder) => o.status === '초안').length,
    inProgress: orders.filter(o => o.status === '생산중').length,
    reorders: orders.filter(o => o.isReorder).length,
    urgent: orders.filter(o => o.deliveryDate && calcDDay(o.deliveryDate) <= 7 && o.status !== '입고완료').length,
  }), [orders]);

  const factoryStats = useMemo(() => {
    const map = new Map<string, { name: string; total: number; inProgress: number; totalQty: number; totalAmountKrw: number }>();
    orders.forEach(o => {
      const key = o.vendorName || '미지정';
      const cur = map.get(key) || { name: key, total: 0, inProgress: 0, totalQty: 0, totalAmountKrw: 0 };
      cur.total++;
      cur.totalQty += o.qty;
      cur.totalAmountKrw += (o.factoryUnitPriceKrw || 0) * o.qty;
      if (!['입고완료'].includes(o.status)) cur.inProgress++;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [orders]);

  // 공장 목록: BOM 제조국이 중국이면 해외 공장 우선
  const sortedFactories = useMemo(() => {
    if (bomCalc.manufacturingCountry === '중국') {
      return [
        ...factories.filter(isOverseas),
        ...factories.filter(f => !isOverseas(f)),
      ];
    }
    return factories;
  }, [factories, bomCalc.manufacturingCountry]);

  // 브랜드명 가져오기 (items → buyerId → vendors)
  const getBrandName = (order: ProductionOrder) => {
    const item = items.find(i => i.styleNo === order.styleNo || i.id === order.styleId);
    if (item?.buyerId) {
      const vendor = allVendors.find(v => v.id === item.buyerId);
      return vendor?.name || '';
    }
    return '';
  };

  // 현재 발주 수량 (컬러별 합계 또는 직접 입력)
  const currentQty = colorQtys.length > 0
    ? colorQtys.reduce((s, c) => s + c.qty, 0)
    : (form.qty || 0);

  // 공장단가 (수동/BOM)
  const displayFactoryPriceCny = manualFactoryPrice ? manualPriceCny : bomCalc.factoryUnitPriceCny;
  const _appSettings = store.getSettings();
  const cnyKrwDisplay = _appSettings.cnyKrw || 191;
  const usdKrwDisplay = _appSettings.usdKrw || 1380;
  let displayFactoryPriceKrw: number;
  if (factoryCurrency === 'KRW') {
    displayFactoryPriceKrw = Math.round(displayFactoryPriceCny);
  } else if (factoryCurrency === 'USD') {
    displayFactoryPriceKrw = Math.round(displayFactoryPriceCny * usdKrwDisplay);
  } else {
    displayFactoryPriceKrw = Math.round(displayFactoryPriceCny * cnyKrwDisplay);
  }
  const displayTotalAmountKrw = displayFactoryPriceKrw * currentQty;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">생산 발주</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5 hidden sm:block">BOM 자동 연동 · 공장/자재 발주 분리 · 소요량 자동 계산</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFactoryView(v => !v)}
            className={`hidden sm:block px-3 py-2 rounded-md border text-xs font-medium transition-colors ${showFactoryView ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground hover:bg-[var(--fill-quaternary)]'}`}
          >
            공장별 현황
          </button>
          <Button
            onClick={() => { setBulkRows({}); setBulkSearch(''); setBulkOpen(true); }}
            className="gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-10 px-2 md:px-4"
          >
            <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />발주 등록
          </Button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: '전체 발주', value: stats.total, color: 'text-foreground' },
          { label: '진행중', value: stats.inProgress, color: 'text-[var(--system-orange)]' },
          { label: '리오더', value: stats.reorders, color: 'text-primary' },
          { label: '긴급 (D-7 이내)', value: stats.urgent, color: 'text-[var(--system-red)]' },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-lg border border-border p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 공장별 발주 현황 */}
      {showFactoryView && (
        <div className="bg-card rounded-lg border border-border p-4">
          <p className="text-sm font-semibold text-foreground mb-3">공장별 발주 현황</p>
          {factoryStats.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">등록된 발주가 없습니다</p>
          ) : (
            <div className="overflow-x-auto"><table className="data-table w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-[13px] font-semibold text-muted-foreground">공장명</th>
                  <th className="ctr text-[13px] font-semibold text-muted-foreground">전체 발주</th>
                  <th className="ctr text-[13px] font-semibold text-muted-foreground">진행중</th>
                  <th className="num text-[13px] font-semibold text-muted-foreground">총 수량</th>
                  <th className="num text-[13px] font-semibold text-muted-foreground">총 발주금액</th>
                </tr>
              </thead>
              <tbody>
                {factoryStats.map(f => (
                  <tr key={f.name} className="border-b border-border">
                    <td className="font-medium text-foreground">{f.name}</td>
                    <td className="ctr text-muted-foreground">{f.total}건</td>
                    <td className="ctr">
                      <span className={f.inProgress > 0 ? 'text-[var(--system-orange)] font-medium' : 'text-muted-foreground'}>{f.inProgress}건</span>
                    </td>
                    <td className="nw num font-mono text-foreground">{f.totalQty.toLocaleString()} PCS</td>
                    <td className="nw num font-mono text-foreground">
                      {f.totalAmountKrw > 0 ? formatKRW(f.totalAmountKrw) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* 검색/필터 */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="발주번호 · PO번호 · 스타일 검색" className="pl-9 h-9" />
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
        {/* 공장 필터 */}
        <Select value={filterFactory} onValueChange={setFilterFactory}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="공장" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 공장</SelectItem>
            {allVendors.filter((v: any) => v.type === '해외공장' || v.type === '공장' || v.type === '자재거래처').map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* 납기일 필터 */}
        <Select value={filterDeadline} onValueChange={setFilterDeadline}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="납기" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 납기</SelectItem>
            <SelectItem value="d20">20일 이내</SelectItem>
            <SelectItem value="d10">10일 이내</SelectItem>
            <SelectItem value="d7">7일 이내</SelectItem>
            <SelectItem value="d3">3일 이내</SelectItem>
            <SelectItem value="overdue">납기 초과</SelectItem>
          </SelectContent>
        </Select>
        {/* 발주서 묶음 필터 */}
        <Select value={filterPo} onValueChange={setFilterPo}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="발주서" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 발주서</SelectItem>
            {poBatchOptions.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* 정렬 */}
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="정렬" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="createdAt">등록일순</SelectItem>
            <SelectItem value="deliveryDate">납기일순</SelectItem>
            <SelectItem value="orderNo">발주번호순</SelectItem>
          </SelectContent>
        </Select>
        {/* 발주서 단위로 접어 보기 */}
        <Button
          variant={groupByPo ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setGroupByPo(!groupByPo)}
        >
          <Layers className="w-4 h-4" />
          발주서 묶음
        </Button>
        {selectedIds.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleBulkDelete}
          >
            <Trash2 className="w-4 h-4" />
            선택 삭제 ({selectedIds.size}건)
          </Button>
        )}
      </div>

      {/* 테이블 (데스크탑) */}
      <div className="hidden md:block bg-card rounded-lg border border-border overflow-hidden">
        <table className="data-table w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-10">
                <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="cursor-pointer" />
              </th>
              <th className="nw text-[13px] font-semibold text-muted-foreground whitespace-nowrap">발주일</th>
              <th className="nw text-[13px] font-semibold text-muted-foreground">발주번호</th>
              <th className="text-[13px] font-semibold text-muted-foreground">스타일</th>
              <th className="text-[13px] font-semibold text-muted-foreground">브랜드</th>
              <th className="text-[13px] font-semibold text-muted-foreground">컬러</th>
              <th className="num text-[13px] font-semibold text-muted-foreground whitespace-nowrap">발주</th>
              <th className="num text-[13px] font-semibold text-muted-foreground whitespace-nowrap">입고</th>
              <th className="num text-[13px] font-semibold text-muted-foreground whitespace-nowrap">불량</th>
              <th className="num text-[13px] font-semibold text-muted-foreground whitespace-nowrap">청구</th>
              <th className="text-[13px] font-semibold text-muted-foreground">공장 / 공장단가</th>
              <th className="num text-[13px] font-semibold text-muted-foreground">총 발주금액</th>
              <th className="nw text-[13px] font-semibold text-muted-foreground whitespace-nowrap">납기일</th>
              <th className="nw text-[13px] font-semibold text-muted-foreground">상태</th>
              <th className="ctr text-[13px] font-semibold text-muted-foreground">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={12} className="text-center py-12 text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 발주가 없습니다</p>
              </td></tr>
            ) : displayRows.map(row => {
              if (row.kind === 'po') {
                // 발주서 1장 요약 — 펼치면 스타일별 발주가 아래에 붙는다
                const g = row.group;
                const open = openPoGroups.has(g.key);
                const totalQty = g.orders.reduce((sum, x) => sum + (x.qty || 0), 0);
                const totalAmt = g.orders.reduce((sum, x) => sum + (x.factoryUnitPriceKrw || 0) * (x.qty || 0), 0);
                return (
                  <tr key={g.key} className="border-b border-border bg-[var(--fill-quaternary)]">
                    <td colSpan={15} className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => togglePoGroup(g.key)}
                          className="flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-primary">
                          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          <span className="font-mono">{g.batchNo}</span>
                        </button>
                        <span className="text-xs text-muted-foreground">{g.orders[0].vendorName || '공장 미지정'}</span>
                        <span className="text-xs text-muted-foreground">{g.orders[0].orderDate || ''}</span>
                        <span className="text-xs text-muted-foreground">{g.orders.length}스타일 · {formatNumber(totalQty)} PCS</span>
                        <span className="ml-auto flex items-center gap-3">
                          <span className="text-sm font-mono font-medium text-foreground">{formatKRW(totalAmt)}</span>
                          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                            onClick={() => setBatchSheet({ batchNo: g.batchNo!, orders: g.orders })}>
                            <FileText className="w-3.5 h-3.5" />발주서
                          </Button>
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              }
              const o = row.order;
              const totalAmtKrw = (o.factoryUnitPriceKrw || 0) * o.qty;
              // BOM 실제 존재 여부: 발주 메타 + 품목 hasBom + Supabase bom 목록
              const itemForOrder = items.find(i => i.styleNo === o.styleNo || i.id === o.styleId);
              const { bom: matchedBom } = getBomForOrderFromList(
                boms as Bom[],
                o.styleNo,
                o.styleId || itemForOrder?.id,
              );
              const hasBom = !!o.bomId
                || o.bomType === 'post'
                || o.bomType === 'pre'
                || !!(itemForOrder as any)?.hasBom
                || !!matchedBom;
              const displayFactoryKrw = (o.factoryUnitPriceKrw && o.factoryUnitPriceKrw > 0)
                ? o.factoryUnitPriceKrw
                : 0;
              return (
                <tr key={o.id} className={`border-b border-border hover:bg-[var(--fill-quaternary)] ${selectedIds.has(o.id) ? 'bg-primary/5' : ''}`}>
                  <td className="w-10 ctr">
                    <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} className="cursor-pointer" />
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {o.orderDate
                      ? <span className="font-mono text-muted-foreground">{o.orderDate}</span>
                      : <span className="text-muted-foreground">-</span>}
                  </td>
                  <td>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-foreground">{o.orderNo}</span>
                      {o.status === '초안' && (
                        <Badge variant="outline" className="text-[11px] h-4 text-[var(--system-orange)] border-[var(--system-orange)]/30 bg-[var(--system-orange)]/10">초안</Badge>
                      )}
                      {o.isReorder && <Badge variant="outline" className="text-[11px] h-4 text-primary border-primary/20">리오더</Badge>}
                      {o.poBatchNo && (
                        <button
                          type="button"
                          title="같은 묶음 발주서 보기"
                          onClick={() => setBatchSheet({
                            batchNo: o.poBatchNo!,
                            orders: (orders as ProductionOrder[]).filter(x => x.poBatchNo === o.poBatchNo),
                          })}
                          className="text-[11px] h-4 px-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                        >
                          {o.poBatchNo}
                        </button>
                      )}
                      {(o as any).expenseId && <Badge variant="outline" className="text-[11px] h-4 text-[var(--system-green)] border-transparent bg-[var(--system-green)]/10">전표완료</Badge>}
                    </div>
                  </td>
                  <td>
                    <p className="font-medium text-foreground">{o.styleNo}</p>
                    <p className="text-xs text-muted-foreground">{o.styleName}</p>
                    {!hasBom && o.bomType !== 'manual' && (
                      <span className="text-[11px] text-[var(--system-orange)] flex items-center gap-0.5 mt-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" />BOM 미등록
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="text-xs text-muted-foreground font-medium">{getBrandName(o) || <span className="text-muted-foreground">-</span>}</span>
                  </td>
                  {/* 컬러 — 컬러명만. 수량은 오른쪽 수량 열들이 담당한다 */}
                  <td className="align-top">
                    {(o.colorQtys || []).length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {(o.colorQtys || []).map((cq, i) => (
                          <span key={i} className="text-[11px] text-muted-foreground whitespace-nowrap" title={cq.memo || undefined}>
                            {cq.color} <span className="font-mono text-foreground">{formatNumber(cq.qty)}</span>
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  {(() => {
                    // 발주 → 입고 → 불량 → 청구. 한 열에 뭉쳐 보이던 값을 각 열로 분리한다
                    const received = o.receivedQty;
                    const postDefect = (o.postDefects || []).filter(d => !d.settledAt).reduce((sum, d) => sum + d.qty, 0);
                    const defect = (o.defectQty || 0) + postDefect;
                    const billable = received === undefined ? null : Math.max(0, received - defect);
                    const short = received === undefined ? 0 : (o.qty || 0) - received;
                    return (
                      <>
                        <td className="nw num align-top font-mono text-foreground whitespace-nowrap">
                          {formatNumber(o.qty)}
                        </td>
                        <td className="num align-top whitespace-nowrap">
                          {received === undefined ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <>
                              <span className="font-mono text-[var(--system-green)]">{formatNumber(received)}</span>
                              {short > 0 && (
                                <p className="text-[11px] text-[var(--system-orange)]">미입고 {formatNumber(short)}</p>
                              )}
                            </>
                          )}
                        </td>
                        <td className="num align-top whitespace-nowrap">
                          {defect > 0 ? (
                            <>
                              <span className="font-mono text-[var(--system-red)]">{formatNumber(defect)}</span>
                              {postDefect > 0 && (
                                <p className="text-[11px] text-[var(--system-red)]">사후 {formatNumber(postDefect)}</p>
                              )}
                            </>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="num align-top whitespace-nowrap">
                          {billable === null
                            ? <span className="text-muted-foreground">—</span>
                            : <span className="font-mono font-medium text-foreground">{formatNumber(billable)}</span>}
                        </td>
                      </>
                    );
                  })()}
                  <td>
                    <p className="text-foreground font-medium">{o.vendorName}</p>
                    {displayFactoryKrw > 0 ? (
                      <p className="text-xs text-muted-foreground font-mono">{formatKRW(displayFactoryKrw)}/PCS
                        {o.bomType === 'manual' && <span className="text-[var(--system-orange)] ml-1">(수동)</span>}
                      </p>
                    ) : (
                      <p className="text-xs text-[var(--system-orange)]">{hasBom ? "공장단가 재계산 필요" : "공장단가 수동 입력 필요"}</p>
                    )}
                  </td>
                  <td className="num">
                    {totalAmtKrw > 0
                      ? <span className="font-mono text-foreground font-medium">{formatKRW(totalAmtKrw)}</span>
                      : <span className="text-muted-foreground">-</span>
                    }
                  </td>
                  <td className="text-xs">
                    {o.deliveryDate ? (
                      <div>
                        <span className={`font-mono ${calcDDay(o.deliveryDate) < 0 ? 'text-[var(--system-red)] font-bold' : calcDDay(o.deliveryDate) <= 14 ? 'text-[var(--system-orange)]' : 'text-muted-foreground'}`}>
                          {o.deliveryDate}
                        </span>
                        <span className={`ml-1 text-[11px] px-1 py-0.5 rounded font-mono ${dDayColor(calcDDay(o.deliveryDate))}`}>{dDayLabel(calcDDay(o.deliveryDate))}</span>
                      </div>
                    ) : <span className="text-muted-foreground">-</span>}
                  </td>
                  <td>
                    <Select value={o.status} disabled={o.status === '초안'}
                      onValueChange={v => handleStatusChange(o.id, v as OrderStatus)}>
                      <SelectTrigger
                        title={o.status === '초안' ? '초안은 [확정] 후에 상태를 바꿀 수 있습니다' : undefined}
                        className={`h-7 text-xs w-28 border ${STATUS_COLOR[o.status] || ''} ${o.status === '초안' ? 'opacity-60' : ''}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td>
                    {/* 작업 — 자주 쓰는 문서 2개만 노출, 나머지는 더보기로 */}
                    <div className="flex items-center justify-end gap-1">
                      {o.status === '초안' && (
                        <Button size="sm" className="h-7 text-xs px-2 mr-1" title="정식 발주번호를 붙여 확정"
                          onClick={() => confirmDraft(o)}>확정</Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="작업지시서"
                        onClick={() => openWorkOrderModal(o)}>
                        <Package className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="발주서"
                        onClick={() => setPoTarget(o)}>
                        <FileText className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="상세"
                        onClick={() => setShowDetail(o)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="더보기">
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          {o.tradeStatementId ? (
                            <DropdownMenuItem disabled className="text-xs">명세표 발행됨</DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem className="text-xs cursor-pointer" onClick={() => openBillingModal(o)}>
                              명세표 발행
                            </DropdownMenuItem>
                          )}
                          {o.status === '입고완료' && (
                            (o as any).expenseId ? (
                              <DropdownMenuItem disabled className="text-xs">전표 작성됨</DropdownMenuItem>
                            ) : (
                              <>
                                <DropdownMenuItem className="text-xs cursor-pointer" onClick={() => openLinkExpenseForOrder(o)}>
                                  기존 결의 연결
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-xs cursor-pointer" onClick={() => openExpenseModal(o)}>
                                  지출결의 생성
                                </DropdownMenuItem>
                              </>
                            )
                          )}
                          {o.status === '입고완료' && (
                            <DropdownMenuItem className="text-xs cursor-pointer text-[var(--system-red)]"
                              onClick={() => setPostDefectTarget(o)}>
                              사후 불량 등록
                              {(o.postDefects || []).filter(d => !d.settledAt).length > 0 &&
                                ` (${(o.postDefects || []).filter(d => !d.settledAt).reduce((s2, d) => s2 + d.qty, 0)})`}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="text-xs cursor-pointer" onClick={() => openEdit(o)}>발주 수정</DropdownMenuItem>
                          <DropdownMenuItem className="text-xs cursor-pointer text-[var(--system-red)]" onClick={() => handleDelete(o.id)}>
                            삭제
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
          <div className="text-center py-12 text-muted-foreground bg-card rounded-lg border border-border">
            <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">등록된 발주가 없습니다</p>
          </div>
        ) : filtered.map(o => {
          const totalAmtKrw = (o.factoryUnitPriceKrw || 0) * o.qty;
          return (
            <div key={o.id} className="bg-card rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-foreground text-sm">{o.orderNo}</span>
                    {o.isReorder && <Badge variant="outline" className="text-[11px] h-4 text-primary border-primary/20">리오더</Badge>}
                  </div>
                  <p className="font-medium text-foreground text-sm mt-0.5">{o.styleNo}</p>
                  <p className="text-xs text-muted-foreground">{o.styleName}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${STATUS_COLOR[o.status]}`}>{o.status}</span>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Factory className="w-3 h-3" />{o.vendorName || '-'}</span>
                <span className="flex items-center gap-1"><Package className="w-3 h-3" />{formatNumber(o.qty)} PCS</span>
                {o.factoryUnitPriceKrw && o.factoryUnitPriceKrw > 0 && (
                  <span className="font-mono">단가 {formatKRW(o.factoryUnitPriceKrw)}</span>
                )}
                {o.deliveryDate && (
                  <span className={`font-mono font-semibold ${calcDDay(o.deliveryDate) < 0 ? 'text-[var(--system-red)]' : calcDDay(o.deliveryDate) <= 14 ? 'text-[var(--system-orange)]' : 'text-muted-foreground'}`}>
                    {o.deliveryDate}
                  </span>
                )}
              </div>
              {totalAmtKrw > 0 && (
                <p className="text-xs text-foreground font-mono mt-1">총 발주금액: <span className="font-bold">{formatKRW(totalAmtKrw)}</span></p>
              )}
              <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-border">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setShowDetail(o)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-primary" onClick={() => openEdit(o)} title="발주 수정">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-[var(--system-red)]" onClick={() => handleDelete(o.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── 스타일 선택 사이드 패널 (오른쪽에서 슬라이드) ─── */}
      <Sheet open={stylePickerOpen} onOpenChange={setStylePickerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle className="text-base">스타일 선택</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                autoFocus
                value={stylePickerSearch}
                onChange={e => setStylePickerSearch(e.target.value)}
                placeholder="브랜드명 · 스타일번호 · 품명"
                className="pl-9 h-9"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-border border-t border-border">
            {(() => {
              const q = stylePickerSearch.trim().toLowerCase();
              const list = (items as Item[]).filter(i => {
                if (!q) return true;
                const buyer: any = allVendors.find((v: any) => v.id === (i as any).buyerId);
                const brands = [buyer?.name, buyer?.companyName, buyer?.nameEn, ...((buyer?.brands as string[]) || [])];
                return [i.styleNo, (i as any).buyerStyleNo, i.name, i.nameEn, ...brands]
                  .some(f => (f || '').toLowerCase().includes(q));
              }).slice(0, 300);
              if (list.length === 0) {
                return <p className="p-8 text-center text-sm text-muted-foreground">일치하는 스타일이 없습니다</p>;
              }
              return list.map(i => {
                const buyer: any = allVendors.find((v: any) => v.id === (i as any).buyerId);
                const brand = buyer?.brands?.[0] || buyer?.nameEn || buyer?.name || '';
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => toggleBulkRow(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--fill-quaternary)] ${
                      bulkRows[i.id] ? 'bg-primary/5' : ''
                    }`}
                  >
                    <input type="checkbox" readOnly checked={!!bulkRows[i.id]} className="w-4 h-4 accent-primary shrink-0" />
                    {i.imageUrl ? (
                      <img src={i.imageUrl} alt="" className="w-10 h-10 rounded object-cover border border-border shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-[var(--fill-tertiary)] border border-border shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {brand && <span className="text-muted-foreground">{brand} · </span>}
                        {i.styleNo}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{i.name}</p>
                    </div>
                    {i.season && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--fill-tertiary)] text-muted-foreground shrink-0">{i.season}</span>
                    )}
                  </button>
                );
              });
            })()}
          </div>
          <div className="border-t border-border p-3">
            <Button className="w-full" onClick={() => setStylePickerOpen(false)}>
              {Object.keys(bulkRows).length > 0 ? `${Object.keys(bulkRows).length}건 담기` : '닫기'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ─── 일괄 발주 등록 ─── */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-4xl sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>발주 등록 <span className="text-xs font-normal text-muted-foreground ml-1">여러 스타일을 한 번에 담아 컬러별 수량을 넣습니다</span></DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={bulkSearch}
                  onChange={e => setBulkSearch(e.target.value)}
                  placeholder="브랜드명 · 스타일번호 · 품명으로 검색"
                  className="pl-9 h-9"
                />
              </div>
              <select value={bulkBrand} onChange={e => setBulkBrand(e.target.value)}
                className="h-9 text-xs border border-border rounded-md bg-card px-2">
                <option value="all">전체 브랜드</option>
                {bulkBrandOptions.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <select value={bulkSeason} onChange={e => setBulkSeason(e.target.value)}
                className="h-9 text-xs border border-border rounded-md bg-card px-2">
                <option value="all">전체 시즌</option>
                {bulkSeasonOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select value={bulkCat} onChange={e => setBulkCat(e.target.value)}
                className="h-9 text-xs border border-border rounded-md bg-card px-2">
                <option value="all">전체 카테고리</option>
                {bulkCatOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            {/* 스타일 목록 — 브랜드 · 스타일번호 · 품명 · 시즌 */}
            <div className="border border-border rounded-md overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-1.5 bg-[var(--fill-quaternary)] border-b border-border text-[11px] text-muted-foreground">
              <span className="w-4 shrink-0" />
              <span className="w-9 shrink-0" />
              <span className="w-28 shrink-0">브랜드</span>
              <span className="w-36 shrink-0">스타일번호</span>
              <span className="flex-1 min-w-0">품명</span>
              <span className="w-14 shrink-0 text-right">시즌</span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-border">
              {bulkCandidates.length === 0 && (
                <p className="p-6 text-center text-xs text-muted-foreground">일치하는 스타일이 없습니다</p>
              )}
              {bulkCandidates.slice(0, 200).map(i => {
                const picked = !!bulkRows[i.id];
                const buyer: any = allVendors.find((v: any) => v.id === (i as any).buyerId);
                const brand = buyer?.brands?.[0] || buyer?.nameEn || buyer?.name || '';
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => toggleBulkRow(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--fill-quaternary)] ${picked ? 'bg-primary/5' : ''}`}
                  >
                    <input type="checkbox" readOnly checked={picked} className="w-4 h-4 accent-primary" />
                    {i.imageUrl ? (
                      <img src={i.imageUrl} alt="" className="w-9 h-9 rounded object-cover border border-border" />
                    ) : (
                      <div className="w-9 h-9 rounded bg-[var(--fill-tertiary)] border border-border" />
                    )}
                    <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{brand || '—'}</span>
                    <span className="w-36 shrink-0 truncate text-sm font-mono">{i.styleNo}</span>
                    <span className="flex-1 min-w-0 truncate text-sm">{i.name}</span>
                    <span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground">{i.season || ''}</span>
                  </button>
                );
              })}
            </div>
            </div>

            {/* 선택된 스타일 — 스타일마다 카드 1장. 컬러별 수량을 넣는다 */}
            {Object.keys(bulkRows).length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    선택 {Object.keys(bulkRows).length}건 — 스타일마다 발주서·작업지시서가 따로 만들어집니다
                  </p>
                  {/* 첫 카드의 공장·날짜를 나머지에 그대로 복사 */}
                  {Object.keys(bulkRows).length > 1 && (
                    <button
                      type="button"
                      className="text-[11px] text-primary hover:underline"
                      onClick={() => setBulkRows(prev => {
                        const ids = Object.keys(prev);
                        const first = prev[ids[0]];
                        const next = { ...prev };
                        ids.slice(1).forEach(id => {
                          next[id] = { ...next[id], vendorId: first.vendorId, orderDate: first.orderDate, deliveryDate: first.deliveryDate };
                        });
                        return next;
                      })}
                    >첫 카드의 공장·날짜를 전체 적용</button>
                  )}
                </div>

                {Object.entries(bulkRows).map(([id, row]) => {
                  const it = (items as Item[]).find(x => x.id === id);
                  const upd = (patch: Partial<typeof row>) =>
                    setBulkRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
                  const updColor = (idx: number, patch: Partial<{ color: string; qty: string }>) =>
                    upd({ colorQtys: row.colorQtys.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });
                  const total = row.colorQtys.reduce((sum, c) => sum + (Number(c.qty) || 0), 0);
                  return (
                    <div key={id} className="border border-border rounded-md p-3 space-y-2.5 bg-card">
                      <div className="flex items-center gap-2">
                        {it?.imageUrl
                          ? <img src={it.imageUrl} alt="" className="w-9 h-9 rounded object-cover border border-border" />
                          : <div className="w-9 h-9 rounded bg-[var(--fill-tertiary)] border border-border" />}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{it?.styleNo}</p>
                          <p className="text-xs text-muted-foreground truncate">{it?.name}</p>
                        </div>
                        <span className="text-xs text-muted-foreground">합계 <b className="text-foreground">{total.toLocaleString()}</b></span>
                        <button type="button" onClick={() => toggleBulkRow(it as Item)}
                          className="text-muted-foreground hover:text-[var(--system-red)] px-1">×</button>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">공장</Label>
                          <Select value={row.vendorId || 'none'} onValueChange={v => upd({ vendorId: v === 'none' ? '' : v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="선택" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">미지정</SelectItem>
                              {factories.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">발주일</Label>
                          <Input type="date" value={row.orderDate} onChange={e => upd({ orderDate: e.target.value })} className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">납기일</Label>
                          <Input type="date" value={row.deliveryDate} onChange={e => upd({ deliveryDate: e.target.value })} className="h-8 text-xs" />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-[11px] text-muted-foreground">컬러별 수량 *</Label>
                        {row.colorQtys.map((c, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <Input
                              value={c.color}
                              onChange={e => updColor(idx, { color: e.target.value })}
                              placeholder="컬러명"
                              className="h-8 text-xs flex-1"
                            />
                            <Input
                              type="number"
                              value={c.qty}
                              onChange={e => updColor(idx, { qty: e.target.value })}
                              placeholder="수량"
                              className="h-8 text-xs w-24"
                            />
                            {row.colorQtys.length > 1 && (
                              <button type="button" onClick={() => upd({ colorQtys: row.colorQtys.filter((_, i) => i !== idx) })}
                                className="text-muted-foreground hover:text-[var(--system-red)] px-1">×</button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => upd({ colorQtys: [...row.colorQtys, { color: '', qty: '' }] })}
                          className="text-[11px] text-primary hover:underline"
                        >+ 컬러 추가</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>취소</Button>
            <Button onClick={saveBulkOrders} disabled={Object.keys(bulkRows).length === 0}>
              발주 {Object.keys(bulkRows).length}건 등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── 발주 등록 모달 (BOM 연동) ─── */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-3xl sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isEditMode ? '발주 수정' : '발주 등록 — BOM 연동'}</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">

            {/* Step 1: 스타일 선택 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
                <Label className="text-sm font-semibold">스타일 선택</Label>
              </div>
              <button
                type="button"
                disabled={isEditMode}
                onClick={() => { setStylePickerSearch(''); setStylePickerOpen(true); }}
                className={`w-full h-9 px-3 text-sm border border-border rounded-md flex items-center justify-between gap-2 ${
                  isEditMode ? 'bg-[var(--fill-quaternary)] text-muted-foreground cursor-not-allowed' : 'bg-card hover:border-primary/40'
                }`}
              >
                <span className={form.styleId ? 'truncate' : 'text-muted-foreground'}>
                  {form.styleId ? `${form.styleNo} — ${form.styleName}` : '품목 마스터에서 선택'}
                </span>
                <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </button>
              {isEditMode && <p className="text-xs text-muted-foreground">※ 수정 모드에서는 스타일 변경 불가 (납기일, 수량, 공장단가, 메모 수정 가능)</p>}
              {form.styleId && (() => {
                const existingOrdersForStyle = (orders as ProductionOrder[]).filter(o => o.styleNo === form.styleNo && (!isEditMode || o.id !== editOrderId));
                const existingCount = existingOrdersForStyle.length;
                return existingCount > 0 ? (
                  <div className="p-2 rounded-md bg-primary/10 border border-primary/20 text-xs text-primary flex items-center gap-1.5">
                    <span>이 스타일 기존 발주 <strong>{existingCount}건</strong> 있음 (리오더)</span>
                  </div>
                ) : null;
              })()}
              {form.orderNo && (
                <div className={`p-3 rounded-md border ${bomCalc.hasBomWarning ? 'bg-[var(--system-orange)]/10 border-[var(--system-orange)]/20' : 'bg-[var(--system-green)]/10 border-[var(--system-green)]/20'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-foreground">
                      발주번호: <span className="font-mono font-bold">{form.orderNo}</span>
                      {(form.revision || 1) > 1 && <span className="ml-2 text-primary">(리오더 #{form.revision})</span>}
                    </p>
                    {bomCalc.bomLoaded && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bomCalc.bomType === 'post' ? 'bg-[var(--system-green)]/10 text-[var(--system-green)]' : 'bg-primary/10 text-primary'}`}>
                        {bomCalc.bomType === 'post' ? '사후원가 BOM' : '사전원가 BOM'}
                      </span>
                    )}
                    {bomCalc.hasBomWarning && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--system-orange)]/10 text-[var(--system-orange)] flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />BOM 미등록
                      </span>
                    )}
                  </div>
                  {bomCalc.hasBomWarning && (
                    <p className="text-xs text-[var(--system-orange)] mt-1">BOM 미등록 — 공장단가 수동 입력 필요</p>
                  )}
                  {bomCalc.manufacturingCountry && (
                    <p className="text-xs text-muted-foreground mt-1">제조국: {bomCalc.manufacturingCountry}
                      {bomCalc.manufacturingCountry === '중국' && <span className="text-primary ml-1">(해외 공장 목록 우선 표시)</span>}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: 발주 수량 + 시즌 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
                <Label className="text-sm font-semibold">발주 수량 입력</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>수량 (PCS)</Label>
                  <Input
                    type="number"
                    value={colorQtys.length > 0 ? colorQtys.reduce((s, c) => s + c.qty, 0) : (form.qty || '')}
                    onChange={e => { if (colorQtys.length === 0) handleQtyChange(parseInt(e.target.value) || 0); }}
                    placeholder="0"
                    readOnly={colorQtys.length > 0}
                    className={colorQtys.length > 0 ? 'bg-[var(--fill-quaternary)] text-muted-foreground' : ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>시즌</Label>
                  <Select value={form.season || '26SS'} onValueChange={v => setForm(f => ({ ...f, season: v as Season }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {/* 컬러별 수량 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">컬러별 수량 (선택)</Label>
                  <div className="relative">
                    <Button
                      type="button" variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => {
                        setShowColorDropdown(v => !v);
                        setShowCustomColorInput(false);
                        setCustomColorInput('');
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" />컬러 추가
                    </Button>
                    {showColorDropdown && (() => {
                      const selectedItem = items.find(i => i.id === form.styleId);
                      const registeredColors = normalizeColors(selectedItem?.colors || []).map(c => c.name);
                      const usedColors = colorQtys.map(c => c.color);
                      const availableColors = registeredColors.filter(c => !usedColors.includes(c));
                      return (
                        <div className="absolute right-0 top-8 z-50 w-48 bg-card border border-border rounded-md shadow-lg py-1">
                          {availableColors.length === 0 && !showCustomColorInput && (
                            <p className="text-xs text-muted-foreground px-3 py-2">등록된 컬러 없음</p>
                          )}
                          {availableColors.map(color => (
                            <button
                              key={color}
                              type="button"
                              className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-[var(--fill-quaternary)] flex items-center gap-2"
                              onClick={() => {
                                setColorQtys(prev => [...prev, { color, qty: 0 }]);
                                setShowColorDropdown(false);
                              }}
                            >
                              <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[11px]">{color}</span>
                            </button>
                          ))}
                          {availableColors.length > 0 && <div className="border-t border-border my-1" />}
                          {!showCustomColorInput ? (
                            <button
                              type="button"
                              className="w-full text-left px-3 py-1.5 text-xs text-[var(--system-green)] hover:bg-[var(--fill-quaternary)] font-medium"
                              onClick={() => setShowCustomColorInput(true)}
                            >
                              직접 입력 (새 컬러)
                            </button>
                          ) : (
                            <div className="px-2 py-1.5 space-y-1">
                              <Input
                                autoFocus
                                className="h-7 text-xs"
                                placeholder="컬러명 입력"
                                value={customColorInput}
                                onChange={e => setCustomColorInput(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && customColorInput.trim()) {
                                    setColorQtys(prev => [...prev, { color: customColorInput.trim(), qty: 0 }]);
                                    setCustomColorInput('');
                                    setShowCustomColorInput(false);
                                    setShowColorDropdown(false);
                                  }
                                  if (e.key === 'Escape') {
                                    setShowCustomColorInput(false);
                                    setCustomColorInput('');
                                  }
                                }}
                              />
                              <Button
                                type="button" size="sm"
                                className="w-full h-6 text-[11px]"
                                onClick={() => {
                                  if (customColorInput.trim()) {
                                    setColorQtys(prev => [...prev, { color: customColorInput.trim(), qty: 0 }]);
                                    setCustomColorInput('');
                                    setShowCustomColorInput(false);
                                    setShowColorDropdown(false);
                                  }
                                }}
                              >추가</Button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                {colorQtys.length > 0 && (() => {
                  const selectedItem = items.find(i => i.id === form.styleId);
                  const registeredColors = normalizeColors(selectedItem?.colors || []).map(c => c.name);
                  return (
                    <div className="space-y-1.5">
                      {colorQtys.map((cq, idx) => {
                        const isNew = !registeredColors.includes(cq.color);
                        // 품목 마스터에서 컬러 상세 정보 조회
                        const masterItem2 = items.find(i => i.styleNo === form.styleNo || i.id === form.styleId);
                        const masterColors2 = normalizeColors(masterItem2?.colors || []);
                        const masterColor2 = masterColors2.find(c => c.name === cq.color);
                        return (
                          <div key={idx} className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                            <div className="flex-1 flex items-center gap-1.5">
                              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${isNew ? 'bg-[var(--system-green)]/10 text-[var(--system-green)]' : 'bg-primary/10 text-primary'}`}>
                                {cq.color || '?'}
                              </span>
                              <Input
                                className="flex-1 h-8 text-sm"
                                placeholder="컬러명"
                                value={cq.color}
                                onChange={e => setColorQtys(prev => prev.map((c, i) => i === idx ? { ...c, color: e.target.value } : c))}
                              />
                              {isNew && cq.color && (
                                <span className="text-[11px] text-[var(--system-green)] shrink-0 whitespace-nowrap">(신규 — 자동 추가됨)</span>
                              )}
                            </div>
                            <Input
                              type="number" min={0}
                              className="w-24 h-8 text-sm text-center"
                              placeholder="수량"
                              value={cq.qty || ''}
                              onChange={e => {
                                const updated = colorQtys.map((c, i) => i === idx ? { ...c, qty: parseInt(e.target.value) || 0 } : c);
                                setColorQtys(updated);
                                const newTotal = updated.reduce((s, c) => s + c.qty, 0);
                                if (form.styleNo && newTotal > 0) recalcBom(form.styleNo, newTotal);
                              }}
                            />
                            <Button
                              type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-[var(--system-red)]"
                              onClick={() => setColorQtys(prev => prev.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                          {/* 컬러별 메모/상세 입력 */}
                          <div className="ml-2 flex items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground shrink-0">메모:</span>
                            <Input
                              className="flex-1 h-7 text-xs text-muted-foreground"
                              placeholder="주의사항/특이사항 (선택)"
                              value={cq.memo || ''}
                              onChange={e => setColorQtys(prev => prev.map((c, i) => i === idx ? { ...c, memo: e.target.value } : c))}
                            />
                          </div>
                          {/* 컬러 상세정보 (품목 마스터 연동) */}
                          {masterColor2 && (masterColor2.leatherColor || masterColor2.decorColor || masterColor2.threadColor || masterColor2.girimaeColor) && (
                            <div className="ml-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground bg-[var(--fill-quaternary)] rounded px-2 py-1">
                              {masterColor2.leatherColor && <span>가죽: <span className="text-foreground font-medium">{masterColor2.leatherColor}</span></span>}
                              {masterColor2.decorColor && <span>장식: <span className="text-foreground font-medium">{masterColor2.decorColor}</span></span>}
                              {masterColor2.threadColor && <span>실: <span className="text-foreground font-medium">{masterColor2.threadColor}</span></span>}
                              {masterColor2.girimaeColor && <span>기리매: <span className="text-foreground font-medium">{masterColor2.girimaeColor}</span></span>}
                            </div>
                          )}
                          </div>
                        );
                      })}
                      {colorQtys.some(cq => !registeredColors.includes(cq.color) && cq.color) && (
                        <p className="text-[11px] text-[var(--system-green)] bg-[var(--system-green)]/10 border border-transparent rounded px-2 py-1">
                          초록색 배지 컬러는 품목 마스터에 없는 새 컬러입니다. 발주 저장 시 자동으로 추가됩니다.
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground text-right">
                        합계: <span className="font-mono font-bold">{colorQtys.reduce((s, c) => s + c.qty, 0).toLocaleString()} PCS</span>
                      </p>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* BOM 자동 계산 결과 패널 */}
            {form.styleId && currentQty > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                  <Label className="text-sm font-semibold">자동 계산 결과</Label>
                </div>

                {/* ── 공장 발주 섹션 ── */}
                <div className="rounded-md border border-border overflow-hidden">
                  <div className="bg-[var(--fill-quaternary)] border-b border-border px-4 py-2 flex items-center gap-2">
                    <Factory className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">공장 발주</span>
                    <span className="text-xs text-muted-foreground">(임가공비 + 본사미제공 자재)</span>
                  </div>
                  <div className="p-4 space-y-3">
                    {/* 발주처 · 공장단가 · KRW 환산을 한 줄에 맞춘다 */}
                    <div className="grid grid-cols-3 gap-3 items-start">
                    <div className="space-y-1.5">
                      <div className="flex items-center h-5"><Label>발주처 (공장) *</Label></div>
                      <Select value={form.vendorId || ''} onValueChange={v => {
                        const vendor = allVendors.find(x => x.id === v);
                        if (vendor?.leadTimeDays && vendor.leadTimeDays > 0 && !form.deliveryDate) {
                          const suggestedDate = new Date();
                          suggestedDate.setDate(suggestedDate.getDate() + vendor.leadTimeDays);
                          const dateStr = suggestedDate.toISOString().split('T')[0];
                          setForm(f => ({ ...f, vendorId: v, vendorName: vendor?.name || '', deliveryDate: dateStr }));
                          toast.info(`예상 납기일 자동 설정: ${dateStr} (리드타임 ${vendor.leadTimeDays}일)`);
                          return;
                        }
                        setForm(f => ({ ...f, vendorId: v, vendorName: vendor?.name || '' }));
                      }}>
                        <SelectTrigger><SelectValue placeholder="공장 선택" /></SelectTrigger>
                        <SelectContent>
                          {bomCalc.manufacturingCountry === '중국' && (
                            <>
                              <div className="px-2 py-1 text-[11px] text-muted-foreground font-medium">해외 공장 (중국 제조국)</div>
                              {sortedFactories.filter(isOverseas).map(v => (
                                <SelectItem key={v.id} value={v.id}>
                                  {v.name}{v.leadTimeDays ? <span className="text-muted-foreground ml-1">({v.leadTimeDays}일)</span> : null}
                                </SelectItem>
                              ))}
                              <div className="px-2 py-1 text-[11px] text-muted-foreground font-medium">국내 공장</div>
                            </>
                          )}
                          {sortedFactories
                            .filter(f => bomCalc.manufacturingCountry === '중국' ? !isOverseas(f) : true)
                            .map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.name}{v.leadTimeDays ? <span className="text-muted-foreground ml-1">({v.leadTimeDays}일)</span> : null}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between h-5">
                          <div className="flex items-center gap-1.5">
                            <Label>공장단가 ({factoryCurrency}/PCS)</Label>
                            <Select value={factoryCurrency} onValueChange={(v) => setFactoryCurrency(v as 'CNY' | 'USD' | 'KRW')}>
                              <SelectTrigger className="h-5 w-16 text-[11px] px-1.5 border-border">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="CNY">CNY</SelectItem>
                                <SelectItem value="USD">USD</SelectItem>
                                <SelectItem value="KRW">KRW</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setManualFactoryPrice(!manualFactoryPrice);
                              if (!manualFactoryPrice) setManualPriceCny(bomCalc.factoryUnitPriceCny);
                            }}
                            className="text-[11px] text-primary underline"
                          >
                            {manualFactoryPrice ? 'BOM 자동' : '수동 입력'}
                          </button>
                        </div>
                        {manualFactoryPrice ? (
                          <Input
                            type="number"
                            value={manualPriceCny || ''}
                            onChange={e => setManualPriceCny(parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            step="0.01"
                            className="h-9 text-right font-mono"
                          />
                        ) : (
                          <div className={`h-9 px-3 py-2 border rounded-md text-sm font-mono flex items-center justify-end ${bomCalc.bomLoaded ? 'bg-[var(--system-green)]/10 border-[var(--system-green)]/20 text-[var(--system-green)]' : 'bg-[var(--system-orange)]/10 border-[var(--system-orange)]/20 text-[var(--system-orange)]'}`}>
                            {bomCalc.bomLoaded
                              ? factoryCurrency === 'CNY'
                                ? `¥${bomCalc.factoryUnitPriceCny.toFixed(2)}`
                                : factoryCurrency === 'USD'
                                ? `$${bomCalc.factoryUnitPriceCny.toFixed(2)}`
                                : `₩${Math.round(bomCalc.factoryUnitPriceCny).toLocaleString()}`
                              : '—'}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center h-5"><Label>공장단가 (KRW 환산)</Label></div>
                        <div className="h-9 px-3 py-2 border border-border rounded-md text-sm font-mono flex items-center justify-end bg-[var(--fill-quaternary)] text-foreground">
                          {displayFactoryPriceKrw > 0 ? formatKRW(displayFactoryPriceKrw) : '—'}
                        </div>
                      </div>
                    </div>
                    {/* 총 발주금액 */}
                    {displayTotalAmountKrw > 0 && (
                      <div className="p-3 bg-primary/5 rounded-md border border-primary/20">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">총 공장 발주금액</span>
                          <span className="text-lg font-bold text-primary font-mono">{formatKRW(displayTotalAmountKrw)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatKRW(displayFactoryPriceKrw)} × {currentQty.toLocaleString()} PCS</p>
                      </div>
                    )}
                    {bomCalc.hasBomWarning && (
                      <div className="p-3 bg-[var(--system-orange)]/10 rounded-md border border-[var(--system-orange)]/20 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-[var(--system-orange)] shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-[var(--system-orange)]">BOM 미등록 — 공장단가 수동 입력 필요</p>
                          <p className="text-xs text-muted-foreground mt-0.5">위 "수동 입력" 버튼으로 공장단가를 직접 입력해주세요.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── 자재 발주 섹션 (본사제공) ── */}
                {(bomCalc.hqProvided.length > 0 || hqItems.length > 0) && (
                  <div className="rounded-md border border-border overflow-hidden">
                    <div className="bg-[var(--fill-quaternary)] border-b border-border px-4 py-2 flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">자재 발주 (본사제공)</span>
                      <span className="text-xs text-muted-foreground">(각 자재거래처에 별도 발주)</span>
                    </div>
                    <div className="p-0">
                      {/* 이미지 미리보기 모달 */}
                      {materialImagePreview && (
                        <Dialog open onOpenChange={() => setMaterialImagePreview(null)}>
                          <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-2xl p-0 overflow-hidden">
                            <div className="relative">
                              <button
                                onClick={() => setMaterialImagePreview(null)}
                                className="absolute top-3 right-3 z-10 bg-black/50 text-white rounded-full p-1.5 hover:bg-black/70 transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                              <img src={materialImagePreview} alt="자재 이미지" className="w-full max-h-[80vh] object-contain" />
                              <div className="absolute bottom-3 right-3">
                                <a
                                  href={materialImagePreview}
                                  download="material-image.jpg"
                                  className="bg-card/80 hover:bg-card text-foreground text-xs px-3 py-1.5 rounded-md border border-border flex items-center gap-1 shadow-sm"
                                >
                                  <Download className="w-3.5 h-3.5" /> 다운로드
                                </a>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                      {/* hqItems 카테고리별 드롭다운 */}
                      {(() => {
                        // hqItems를 calcItem의 category 기준으로 그룹화
                        const grouped: Record<string, Array<{ item: typeof hqItems[0]; idx: number }>> = {};
                        hqItems.forEach((item, idx) => {
                          const calcItem = bomCalc.hqProvided.find(h => h.bomLineId === item.bomLineId);
                          const cat = calcItem?.category || '기타';
                          if (!grouped[cat]) grouped[cat] = [];
                          grouped[cat].push({ item, idx });
                        });
                        const sortedCats = CATEGORY_ORDER.filter(c => grouped[c]);
                        return (
                          <div className="divide-y divide-border">
                            {sortedCats.map(cat => {
                              const entries = grouped[cat];
                              const isOpen = hqCategoryOpen[cat] ?? false;
                              return (
                                <div key={cat}>
                                  <button
                                    type="button"
                                    className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--fill-tertiary)] transition-colors text-left bg-[var(--fill-quaternary)]"
                                    onClick={() => setHqCategoryOpen(prev => ({ ...prev, [cat]: !isOpen }))}
                                  >
                                    <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                      <span className="text-primary">{isOpen ? '▼' : '▶'}</span>
                                      {cat}
                                      <span className="bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded-full font-normal">{entries.length}종</span>
                                    </span>
                                  </button>
                                  {isOpen && (
                                    <table className="data-table w-full text-xs">
                                      <thead className="border-b border-border">
                                        <tr>
                                          <th className="font-semibold text-muted-foreground">자재명</th>
                                          <th className="num font-semibold text-muted-foreground">소요량</th>
                                          <th className="nw ctr font-semibold text-muted-foreground">단위</th>
                                          <th className="font-semibold text-muted-foreground">구매업체</th>
                                          <th className="font-semibold text-muted-foreground">구매상태</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {entries.map(({ item, idx }) => {
                                          const calcItem = bomCalc.hqProvided.find(h => h.bomLineId === item.bomLineId);
                                          return (
                                            <tr key={item.bomLineId} className="border-t border-border hover:bg-[var(--fill-quaternary)]">
                                              <td className="font-medium text-foreground">
                                                <div className="flex items-center gap-2">
                                                  {calcItem?.imageUrl ? (
                                                    <img
                                                      src={calcItem.imageUrl}
                                                      alt={item.itemName}
                                                      className="w-6 h-6 object-cover rounded cursor-pointer border border-border shrink-0"
                                                      onClick={() => setMaterialImagePreview(calcItem.imageUrl!)}
                                                      title="클릭하여 확대"
                                                    />
                                                  ) : null}
                                                  <span>
                                                    {item.itemName}
                                                    {item.spec && <span className="text-muted-foreground ml-1">({item.spec})</span>}
                                                  </span>
                                                </div>
                                              </td>
                                              <td className="num">
                                                {calcItem ? (
                                                  <span className="font-mono font-semibold text-primary">
                                                    {calcItem.reqQty % 1 === 0 ? calcItem.reqQty.toLocaleString() : calcItem.reqQty.toFixed(2)}
                                                  </span>
                                                ) : (
                                                  <Input
                                                    type="number" value={item.requiredQty || ''}
                                                    onChange={e => {
                                                      const updated = [...hqItems];
                                                      updated[idx] = { ...updated[idx], requiredQty: parseFloat(e.target.value) || 0 };
                                                      setHqItems(updated);
                                                    }}
                                                    className="h-6 text-xs w-20 ml-auto"
                                                  />
                                                )}
                                              </td>
                                              <td className="ctr text-muted-foreground">{item.unit}</td>
                                              <td className="text-muted-foreground">
                                                {calcItem?.vendorName || item.memo?.replace('구매처: ', '') || <span className="text-muted-foreground">미지정</span>}
                                              </td>
                                              <td>
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
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* 본사미제공(공장발주) 자재 목록 — 카테고리별 드롭다운 */}
                {bomCalc.factoryProvided.length > 0 && (() => {
                  const grouped: Record<string, typeof bomCalc.factoryProvided> = {};
                  for (const m of bomCalc.factoryProvided) {
                    const cat = m.category || '기타';
                    if (!grouped[cat]) grouped[cat] = [];
                    grouped[cat].push(m);
                  }
                  const sortedCats = CATEGORY_ORDER.filter(c => grouped[c]);
                  return (
                    <div className="rounded-md border border-border bg-[var(--fill-quaternary)] overflow-hidden">
                      <p className="text-xs font-medium text-muted-foreground px-3 py-2 flex items-center gap-1 border-b border-border bg-[var(--fill-tertiary)]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
                        공장 구매 자재 ({bomCalc.factoryProvided.length}종) — 공장이 직접 구매
                      </p>
                      <div className="divide-y divide-border">
                        {sortedCats.map(cat => {
                          const items = grouped[cat];
                          const isOpen = factoryCategoryOpen[cat] ?? false;
                          return (
                            <div key={cat}>
                              <button
                                type="button"
                                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--fill-tertiary)] transition-colors text-left"
                                onClick={() => setFactoryCategoryOpen(prev => ({ ...prev, [cat]: !isOpen }))}
                              >
                                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                  <span className="text-muted-foreground">{isOpen ? '▼' : '▶'}</span>
                                  {cat}
                                  <span className="bg-[var(--fill-tertiary)] text-muted-foreground text-xs px-1.5 py-0.5 rounded-full font-normal">{items.length}종</span>
                                </span>
                              </button>
                              {isOpen && (
                                <div className="bg-card px-3 pb-1">
                                  {items.map(m => (
                                    <div key={m.bomLineId} className="flex items-center justify-between text-xs text-muted-foreground py-1 border-t border-border first:border-t-0">
                                      <div className="flex items-center gap-2">
                                        {m.imageUrl ? (
                                          <img
                                            src={m.imageUrl}
                                            alt={m.itemName}
                                            className="w-5 h-5 object-cover rounded cursor-pointer border border-border shrink-0"
                                            onClick={() => setMaterialImagePreview(m.imageUrl!)}
                                            title="클릭하여 확대"
                                          />
                                        ) : null}
                                        <span className="text-foreground">{m.itemName}{m.spec ? <span className="text-muted-foreground ml-1">({m.spec})</span> : null}</span>
                                      </div>
                                      <span className="font-mono text-muted-foreground shrink-0 ml-2">
                                        {m.reqQty % 1 === 0 ? m.reqQty.toLocaleString() : m.reqQty.toFixed(2)} {m.unit}
                                        {m.vendorName && <span className="ml-1 text-muted-foreground">({m.vendorName})</span>}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* BOM 없거나 수량 미입력 시 공장 선택만 표시 */}
            {form.styleId && currentQty === 0 && (
              <div className="space-y-1.5">
                <Label>발주처 (공장) *</Label>
                <Select value={form.vendorId || ''} onValueChange={v => {
                  const vendor = allVendors.find(x => x.id === v);
                  setForm(f => ({ ...f, vendorId: v, vendorName: vendor?.name || '' }));
                }}>
                  <SelectTrigger><SelectValue placeholder="공장 선택" /></SelectTrigger>
                  <SelectContent>
                    {sortedFactories.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Step 4: 발주일 / 납기일 / 메모 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">4</span>
                <Label className="text-sm font-semibold">발주일 & 납기일</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>발주일</Label>
                  <Input
                    type="date"
                    value={form.orderDate || new Date().toISOString().split('T')[0]}
                    onChange={e => setForm(f => ({ ...f, orderDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>납기일 (바이어)</Label>
                  <Input
                    type="date"
                    value={form.deliveryDate || ''}
                    onChange={e => setForm(f => ({ ...f, deliveryDate: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>메모</Label>
                <Input value={form.memo || ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave}>{isEditMode ? '발주 수정' : '발주 등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 입고 처리 팝업 */}
      <Dialog open={showReceiveModal} onOpenChange={setShowReceiveModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-md sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>입고 처리</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">입고 수량과 불량 수량을 입력해주세요.</p>
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
              <div className="p-3 bg-[var(--system-red)]/10 border border-[var(--system-red)]/20 rounded text-xs text-[var(--system-red)]">
                양품: {receiveForm.receivedQty - receiveForm.defectQty}개 / 불량: {receiveForm.defectQty}개
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReceiveModal(false)}>취소</Button>
            <Button onClick={handleReceiveConfirm}>입고 완료</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 발주 상세 모달 */}
      {showDetail && (
        <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
          <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-2xl sm:rounded-md sm:max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono">{showDetail.orderNo}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLOR[showDetail.status]}`}>{showDetail.status}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div><p className="text-xs text-muted-foreground">스타일</p><p className="font-medium">{showDetail.styleNo}</p></div>
                <div><p className="text-xs text-muted-foreground">시즌</p><p className="font-medium">{showDetail.season}</p></div>
                <div><p className="text-xs text-muted-foreground">수량</p><p className="font-mono font-medium">{formatNumber(showDetail.qty)} PCS</p></div>
                <div><p className="text-xs text-muted-foreground">발주처</p><p className="font-medium">{showDetail.vendorName}</p></div>
                <div>
                  <p className="text-xs text-muted-foreground">공장단가</p>
                  <p className="font-mono font-medium">
                    {showDetail.factoryUnitPriceKrw ? formatKRW(showDetail.factoryUnitPriceKrw) : '-'}
                    {showDetail.bomType === 'manual' && <span className="text-xs text-[var(--system-orange)] ml-1">(수동)</span>}
                    {showDetail.bomType === 'post' && <span className="text-xs text-[var(--system-green)] ml-1">(사후원가)</span>}
                    {showDetail.bomType === 'pre' && <span className="text-xs text-primary ml-1">(사전원가)</span>}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">총 발주금액</p>
                  <p className="font-mono font-bold text-primary">
                    {showDetail.factoryUnitPriceKrw
                      ? formatKRW(showDetail.factoryUnitPriceKrw * showDetail.qty)
                      : '-'}
                  </p>
                </div>
                <div><p className="text-xs text-muted-foreground">리오더</p><p className="font-medium">{showDetail.isReorder ? `${showDetail.revision}차` : '신규'}</p></div>
                {showDetail.orderDate && (
                  <div><p className="text-xs text-muted-foreground">발주일</p><p className="font-mono">{showDetail.orderDate}</p></div>
                )}
                {showDetail.deliveryDate && (
                  <div>
                    <p className="text-xs text-muted-foreground">납기일</p>
                    <p className="font-mono">{showDetail.deliveryDate}
                      <span className={`ml-1 text-[11px] px-1 py-0.5 rounded font-mono ${dDayColor(calcDDay(showDetail.deliveryDate))}`}>{dDayLabel(calcDDay(showDetail.deliveryDate))}</span>
                    </p>
                  </div>
                )}
              </div>
              {/* 컬러별 수량 */}
              {(showDetail.colorQtys || []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">컬러별 수량</p>
                  <div className="flex flex-wrap gap-2">
                    {(showDetail.colorQtys || []).map((cq, i) => (
                      <span key={i} className="px-2 py-1 bg-[var(--fill-tertiary)] text-foreground text-xs rounded">{cq.color}: {cq.qty.toLocaleString()} PCS</span>
                    ))}
                  </div>
                </div>
              )}
              {showDetail.hqSupplyItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">본사제공 자재</p>
                  <div className="space-y-1">
                    {showDetail.hqSupplyItems.map((item, idx) => (
                      <div key={idx} className={`flex items-center justify-between p-2 rounded text-xs ${item.purchaseStatus === '발송완료' ? 'bg-[var(--system-green)]/10 text-[var(--system-green)]' : item.purchaseStatus === '구매완료' ? 'bg-primary/10 text-primary' : 'bg-[var(--system-orange)]/10 text-[var(--system-orange)]'}`}>
                        <span>{item.itemName} {item.spec && `(${item.spec})`}</span>
                        <span className="font-mono">{item.requiredQty} {item.unit} — {item.purchaseStatus}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 네고 이력 */}
              {((showDetail as any).negoHistory || []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">리오더 네고 이력</p>
                  <div className="space-y-1.5">
                    {((showDetail as any).negoHistory as Array<{
                      requestedPrice: number; currency: string; savedAmount: number;
                      savedRate: number; memo: string; date: string;
                    }>).map((n, i) => (
                      <div key={i} className={`p-2.5 rounded-md border text-xs ${n.savedAmount > 0 ? 'bg-[var(--system-green)]/10 border-[var(--system-green)]/20' : 'bg-[var(--system-red)]/10 border-[var(--system-red)]/20'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground font-medium">{n.date}</span>
                          <span className={`font-mono font-bold ${n.savedAmount > 0 ? 'text-[var(--system-green)]' : 'text-[var(--system-red)]'}`}>
                            {n.savedAmount > 0 ? '+' : ''}{formatKRW(n.savedAmount)} ({n.savedRate}%)
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-muted-foreground">
                          <span>요청단가: <span className="font-mono font-medium text-foreground">{n.requestedPrice} {n.currency}</span></span>
                          {n.memo && <span className="text-muted-foreground">{n.memo}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setShowDetail(null); openWorkOrderModal(showDetail!); }}
                className="text-foreground"
              >
                <Package className="w-3.5 h-3.5 mr-1.5" />작업지시서 출력
              </Button>
              <Button variant="outline" onClick={() => setShowDetail(null)}>닫기</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 명세표 발행 모달 ── */}
      {billingTarget && (
        <Dialog open={billingModal} onOpenChange={setBillingModal}>
          <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-lg sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>명세표 발행 — {billingTarget.orderNo}</DialogTitle>
              <div className="text-xs text-muted-foreground mt-1">
                거래명세표를 새로 생성하거나 기존 전표에 연결하세요
              </div>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* 모드 선택 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={() => setBillingMode('new')}
                  className={`p-3 rounded-md border text-sm font-medium transition-colors ${billingMode === 'new' ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:bg-[var(--fill-quaternary)]'}`}
                >
                  거래명세표 신규 생성
                </button>
                <button
                  onClick={() => setBillingMode('link')}
                  className={`p-3 rounded-md border text-sm font-medium transition-colors ${billingMode === 'link' ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:bg-[var(--fill-quaternary)]'}`}
                >
                  기존 전표에 연결
                </button>
              </div>

              {billingMode === 'link' && (() => {
                const thisMonth = new Date().toISOString().slice(0,7);
                const item = items.find(i => i.id === billingTarget.styleId);
                const buyer = buyers.find(b => b.id === item?.buyerId);
                const buyerStatements = store.getTradeStatements()
                  .filter(t => {
                    const matchBuyer = !buyer || t.vendorId === buyer.id;
                    const matchMonth = t.issueDate.startsWith(thisMonth);
                    return matchBuyer && matchMonth && t.status !== '수금완료';
                  });
                return (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">이번 달 전표 ({thisMonth}) — 바이어: {buyer?.name || '미지정'}</p>
                    {buyerStatements.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-3 text-center">해당 조건의 전표가 없습니다. 신규 생성을 선택하세요.</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {buyerStatements.map(t => (
                          <button key={t.id}
                            onClick={() => setLinkStatementId(t.id)}
                            className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${linkStatementId === t.id ? 'bg-primary/10 border-primary' : 'border-border hover:bg-[var(--fill-quaternary)]'}`}
                          >
                            <span className="font-mono font-medium">{t.statementNo}</span>
                            <span className="ml-2 text-muted-foreground">{t.vendorName}</span>
                            <span className="ml-2 text-muted-foreground">{t.issueDate}</span>
                            <span className="ml-2 text-muted-foreground">{t.lines?.length || 0}건</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {billingMode === 'new' && (() => {
                const item = items.find(i => i.id === billingTarget.styleId);
                const buyer = buyers.find(b => b.id === item?.buyerId);
                const unitPrice = item?.deliveryPrice || item?.targetSalePrice || billingTarget.factoryUnitPriceKrw || 0;
                const colorQtyList = billingTarget.colorQtys && billingTarget.colorQtys.length > 0
                  ? billingTarget.colorQtys
                  : [{ color: '기본', qty: billingTarget.qty }];
                const totalAmt = colorQtyList.reduce((sum, cq) => sum + cq.qty * unitPrice, 0);
                return (
                  <div className="p-3 bg-[var(--fill-quaternary)] rounded-md text-xs text-muted-foreground space-y-1">
                    <p className="font-medium mb-1">생성될 거래명세표</p>
                    <p>발주번호: {billingTarget.orderNo}</p>
                    <p>스타일: {billingTarget.styleNo} — {billingTarget.styleName}</p>
                    <p>바이어: {buyer?.name || '미지정'}</p>
                    <p>
                      수량: {(billingTarget.receivedQty !== undefined
                        ? Math.max(0, (billingTarget.receivedQty || 0) - (billingTarget.defectQty || 0))
                        : billingTarget.qty).toLocaleString()} PCS
                      {!!billingTarget.defectQty && (
                        <span className="text-[var(--system-red)]"> (불량 {billingTarget.defectQty}개 차감)</span>
                      )}
                    </p>
                    {unitPrice > 0 && <p>단가: {formatKRW(unitPrice)} / 합계: {formatKRW(totalAmt)}</p>}
                    {billingTarget.deliveryDate && <p>납기일: {billingTarget.deliveryDate}</p>}
                  </div>
                );
              })()}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBillingModal(false)}>취소</Button>
              <Button
                disabled={billingMode === 'link' && !linkStatementId}
                onClick={handleConfirmBilling}
              >
                {billingMode === 'new' ? '명세표 신규 생성' : '전표 연결 완료'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 사후 불량 등록 ── */}
      <Dialog open={!!postDefectTarget} onOpenChange={o => { if (!o) setPostDefectTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>사후 불량 — {postDefectTarget?.orderNo}</DialogTitle></DialogHeader>
          {postDefectTarget && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                납품 후 발견된 불량입니다. 원래 입고 수량은 그대로 두고 차감 이력만 남기며,
                다음 명세표 발행 때 이 수량만큼 청구에서 빠집니다.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>불량 수량 *</Label>
                  <Input type="number" value={postDefectForm.qty}
                    onChange={e => setPostDefectForm(f => ({ ...f, qty: e.target.value }))} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label>발견일</Label>
                  <Input type="date" value={postDefectForm.foundDate}
                    onChange={e => setPostDefectForm(f => ({ ...f, foundDate: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>사유 *</Label>
                <Input value={postDefectForm.reason}
                  onChange={e => setPostDefectForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="예: 봉제 터짐 · 가죽 스크래치" />
              </div>

              {(postDefectTarget.postDefects || []).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">등록된 사후 불량</p>
                  <div className="border border-border rounded-md divide-y divide-border max-h-40 overflow-y-auto">
                    {(postDefectTarget.postDefects || []).map(d => (
                      <div key={d.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="truncate">{d.foundDate} · {d.reason}</span>
                        <span className="shrink-0 ml-2">
                          <span className="text-[var(--system-red)] font-medium">{d.qty}개</span>
                          {d.settledAt
                            ? <span className="ml-1 text-muted-foreground">정산됨</span>
                            : <span className="ml-1 text-[var(--system-orange)]">미정산</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostDefectTarget(null)}>취소</Button>
            <Button onClick={savePostDefect}>등록</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 발주서(PO) — 공장 결제 근거. 작업지시서와 별개 문서 ── */}
      <Dialog open={!!poTarget} onOpenChange={o => { if (!o) setPoTarget(null); }}>
        <DialogContent className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>발주서 — {poTarget?.orderNo}</DialogTitle></DialogHeader>
          {poTarget && (() => {
            const it = items.find(i => i.id === poTarget.styleId || i.styleNo === poTarget.styleNo);
            const unit = poTarget.factoryUnitPriceKrw || 0;
            const rows = (poTarget.colorQtys || []).length > 0
              ? poTarget.colorQtys!
              : [{ color: '기본', qty: poTarget.qty }];
            const total = rows.reduce((sum, r) => sum + r.qty * unit, 0);
            return (
              <div ref={poSheetRef} className="p-4 space-y-4 text-sm bg-white text-neutral-900 rounded">
                <h2 className="text-center text-lg font-bold tracking-widest border-b-2 border-neutral-800 pb-2">발 주 서</h2>
                <table className="data-table w-full text-xs border-collapse">
                  <tbody>
                    <tr>
                      <td className="border border-neutral-300 bg-neutral-100 font-semibold w-24">발주번호</td>
                      <td className="nw border border-neutral-300 font-mono">{poTarget.orderNo}</td>
                      <td className="border border-neutral-300 bg-neutral-100 font-semibold w-24">발주일</td>
                      <td className="border border-neutral-300">{poTarget.orderDate}</td>
                    </tr>
                    <tr>
                      <td className="border border-neutral-300 bg-neutral-100 font-semibold">공장</td>
                      <td className="border border-neutral-300">{poTarget.vendorName || '—'}</td>
                      <td className="border border-neutral-300 bg-neutral-100 font-semibold">납기일</td>
                      <td className="border border-neutral-300 font-semibold text-red-600">{poTarget.deliveryDate || '—'}</td>
                    </tr>
                    <tr>
                      <td className="border border-neutral-300 bg-neutral-100 font-semibold">스타일</td>
                      <td className="border border-neutral-300" colSpan={3}>
                        {poTarget.styleNo} — {poTarget.styleName}{it?.buyerStyleNo ? ` (바이어 품번 ${it.buyerStyleNo})` : ''}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <table className="data-table w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-neutral-100">
                      <th className="border border-neutral-300">컬러</th>
                      <th className="border border-neutral-300 num">수량</th>
                      <th className="border border-neutral-300 num">단가</th>
                      <th className="border border-neutral-300 num">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="border border-neutral-300">{r.color}</td>
                        <td className="nw border border-neutral-300 num font-mono">{formatNumber(r.qty)}</td>
                        <td className="nw border border-neutral-300 num font-mono">{formatKRW(unit)}</td>
                        <td className="nw border border-neutral-300 num font-mono">{formatKRW(r.qty * unit)}</td>
                      </tr>
                    ))}
                    <tr className="bg-neutral-50 font-semibold">
                      <td className="border border-neutral-300">합계</td>
                      <td className="nw border border-neutral-300 num font-mono">{formatNumber(rows.reduce((s2, r) => s2 + r.qty, 0))}</td>
                      <td className="border border-neutral-300"></td>
                      <td className="nw border border-neutral-300 num font-mono">{formatKRW(total)}</td>
                    </tr>
                  </tbody>
                </table>

                {poTarget.memo && <p className="text-xs text-neutral-600">비고: {poTarget.memo}</p>}
              </div>
            );
          })()}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPoTarget(null)}>닫기</Button>
            <Button variant="outline" onClick={async () => {
              if (!poSheetRef.current) return;
              try { await copyDocAsImage(poSheetRef.current); toast.success('이미지 복사됨 — 카톡·위챗에 붙여넣으세요'); }
              catch (e) { toast.error((e as Error).message); }
            }}>이미지 복사</Button>
            <Button variant="outline" onClick={async () => {
              if (!poSheetRef.current) return;
              try { await saveDocAsImage(poSheetRef.current, `발주서_${poTarget?.orderNo}`); toast.success('이미지 저장됨'); }
              catch (e) { toast.error((e as Error).message); }
            }}>이미지 저장</Button>
            <Button onClick={() => printDoc(poSheetRef.current)}>
              <Printer className="w-4 h-4 mr-1.5" />A4 인쇄 · PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 작업지시서 모달 (가로 A4 실제 양식) ── */}
      {workOrderTarget && (
        <Dialog open={workOrderModal} onOpenChange={setWorkOrderModal}>
          <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[98vw] sm:h-auto sm:max-w-6xl sm:rounded-md sm:max-h-[95vh] overflow-y-auto p-4">
            {/* 인쇄 전용 스타일 */}
            <style>{`
              @media print {
                @page { size: A4 landscape; margin: 8mm; }
                body * { visibility: hidden; }
                #work-order-print-area, #work-order-print-area * { visibility: visible; }
                /* fixed는 Dialog transform에 갇힘 → absolute (전역 index.css가 다이얼로그를 평면화) */
                #work-order-print-area { position: absolute; top: 0; left: 0; width: 100%; }
                .no-print { display: none !important; }
                textarea { border: none !important; resize: none; background: transparent; }
                input[type="text"], input[type="number"] { border: none !important; background: transparent; }
                input[type="checkbox"] { display: inline-block !important; }
              }
            `}</style>

            {/* 상단 버튼 영역 (인쇄 시 숨김) */}
            <div className="no-print flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Package className="w-4 h-4" />
                작업지시서 — {workOrderTarget.orderNo}
              </h2>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setWorkOrderModal(false)}>닫기</Button>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => workOrderAsImage('copy')}>
                  이미지 복사
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => workOrderAsImage('save')}>
                  이미지 저장
                </Button>
                <Button size="sm" className="h-8 text-xs" onClick={handlePrintWorkOrder}>
                  <Printer className="w-3.5 h-3.5 mr-1" />A4 인쇄 · PDF
                </Button>
              </div>
            </div>

            {/* 작업지시서 본문 — 가로 A4 양식 */}
            <div id="work-order-print-area">
              {(() => {
                const order = workOrderTarget;
                const item = items.find(i => i.id === order.styleId);
                const { bom } = getBomForOrderFromList(boms as Bom[], order.styleNo);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                // 컬러별 BOM에서 첫 번째 컬러 사용, 없으면 기존 방식
                const getColorBomLines = (b: any) => {
                  if (!b) return [];
                  // 사후원가 컬러 BOM 우선
                  if (b.postColorBoms && b.postColorBoms.length > 0) return b.postColorBoms[0].lines || [];
                  if (b.postMaterials && b.postMaterials.length > 0) return b.postMaterials;
                  // 사전원가 컬러 BOM
                  if (b.colorBoms && b.colorBoms.length > 0) return b.colorBoms[0].lines || [];
                  return b.lines || [];
                };
                const bomLines: any[] = getColorBomLines(bom);

                // 원자재 (바디/안감)
                const rawMaterials = bomLines.filter((l: any) => l.category === '원자재');
                // 바디 자재: subPart=바디 or 첫 번째 원자재 (안감 제외)
                const bodyMat = rawMaterials.find((l: any) => l.subPart === '바디') || rawMaterials.find((l: any) => l.subPart !== '안감') || rawMaterials[0];
                // 안감 자재
                const liningMat = rawMaterials.find((l: any) => l.subPart === '안감');
                // 지퍼
                const zipperMat = bomLines.find((l: any) => l.category === '지퍼' || (l.itemName && l.itemName.includes('지퍼')));
                // 불박 로고
                const logoMat = bomLines.find((l: any) => l.itemName && (l.itemName.includes('불박') || l.itemName.includes('로고')));
                // 기리매
                const girimaeMat = bomLines.find((l: any) => l.itemName && l.itemName.includes('기리매'));
                // 실
                const threadMat = bomLines.find((l: any) => l.category === '부자재' && l.itemName && l.itemName.includes('실'));

                // 본사제공 자재 목록 (isHqProvided=true)
                const hqMaterials = bomLines.filter((l: any) => l.isHqProvided);

                // 컬러 정보 (품목 마스터)
                const itemColors = normalizeColors(item?.colors || []);

                // 컬러별 발주수량
                const colorQtyList = (order.colorQtys || []).length > 0
                  ? (order.colorQtys as { color: string; qty: number }[])
                  : [{ color: '기본', qty: order.qty }];

                // 샘플 이미지 가져오기
                const samples = store.getSamples().filter(s => s.styleId === order.styleId);
                const sampleImages = samples.flatMap(s => s.imageUrls || []).slice(0, 3);
                const itemImage = item?.imageUrl;
                const allImages: string[] = sampleImages.length > 0 ? sampleImages.slice(0, 3) : (itemImage ? [itemImage] : []);

                // 기본 작업 지시사항
                const defaultWorkNote = `1. 가죽 재단 후 기스 및 불량 확인
2. 봉제, 기리매 기본 철저히 준수
3. 주의사항 및 변경 사항 확인 필수
4. 애매한 것은 담당자에게 확인하여 빠르게 해결하기
5. 시아기 본드자국 및 실 끝처리 확인 철저
6. 원부자재 빠르게 공급하기

7. 제품 생산 완료 후 내부 검수필수 (실, 바늘, 물 등등)
8. 재단물, 장식 전달 후 수량 파악 필수`;

                return (
                  <div style={{ fontFamily: "'Nanum Gothic', '나눔고딕', 'Malgun Gothic', sans-serif", fontSize: '12px', background: 'white' }}>

                    {/* ── 타이틀 ── */}
                    <div style={{ textAlign: 'center', padding: '8px 0 6px', borderBottom: '2px solid #333' }}>
                      <h1 style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.4em', margin: 0 }}>작  업  지  시  서</h1>
                    </div>

                    {/* ── 상단 헤더 테이블 (발주일자 / 납기일 / 스타일넘버 / 작업장) ── */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', borderBottom: '1px solid #555' }}>
                      <tbody>
                        <tr>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', background: '#f5f5f5', fontWeight: 'bold', width: '12%', whiteSpace: 'nowrap' }}>발주일자</td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', width: '22%' }}>
                            {order.orderDate ? `${order.orderDate.slice(0,4)}년 ${parseInt(order.orderDate.slice(5,7))}월 ${parseInt(order.orderDate.slice(8,10))}일` : '—'}
                          </td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', background: '#f5f5f5', fontWeight: 'bold', width: '10%', whiteSpace: 'nowrap' }}>납기일</td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', width: '56%', color: '#cc0000', fontWeight: 'bold', fontSize: '13px' }}>
                            {order.deliveryDate || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', background: '#f5f5f5', fontWeight: 'bold', whiteSpace: 'nowrap' }}>스타일넘버(품명)</td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', fontWeight: 'bold', fontSize: '13px' }}>
                            {order.styleNo} / {order.styleName}
                          </td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', background: '#f5f5f5', fontWeight: 'bold', whiteSpace: 'nowrap' }}>작업장</td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', fontWeight: 'bold', fontSize: '13px' }}>
                            {order.vendorName || '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* ── 원단/가죽 소요량 행 ── */}
                    <div style={{ background: '#fafafa', border: '1px solid #ccc', borderTop: 'none', padding: '5px 10px', display: 'flex', gap: '24px', fontSize: '12px' }}>
                      <span>
                        <strong>원단/가죽 소요량: </strong>
                        {bodyMat
                          ? `${(bodyMat.netQty * (1 + bodyMat.lossRate)).toFixed(3)} ${bodyMat.unit}`
                          : '—'}
                      </span>
                      <span style={{ color: '#888' }}>|</span>
                      <span>
                        <strong>안감 소요량: </strong>
                        {liningMat
                          ? `${(liningMat.netQty * (1 + liningMat.lossRate)).toFixed(3)} ${liningMat.unit}`
                          : '—'}
                      </span>
                    </div>

                    {/* ── 컬러별 자재 정보 테이블 ── */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px', fontSize: '11px' }}>
                      <thead>
                        <tr style={{ background: '#e8e8e8' }}>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '22%', textAlign: 'center' }}>메인자재<br/><span style={{ fontWeight: 'normal', fontSize: '10px' }}>(발주수량)</span></th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '10%', textAlign: 'center' }}>우라<br/><span style={{ fontWeight: 'normal', fontSize: '10px' }}>(안감)</span></th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '10%', textAlign: 'center' }}>장식</th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '12%', textAlign: 'center' }}>불박로고</th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '10%', textAlign: 'center' }}>기리매</th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '10%', textAlign: 'center' }}>실번버</th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '12%', textAlign: 'center' }}>지퍼번버</th>
                        </tr>
                      </thead>
                      <tbody>
                        {colorQtyList.map((cq, i) => {
                          // 이 컬러에 해당하는 품목 컬러 정보
                          const colorInfo = itemColors.find(c => c.name === cq.color) || itemColors[0];
                          return (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', verticalAlign: 'top' }}>
                                <div style={{ fontWeight: 'bold', lineHeight: 1.4 }}>
                                  {colorInfo?.leatherColor || cq.color}
                                </div>
                                <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
                                  {bodyMat?.spec && <span>{bodyMat.spec}</span>}
                                </div>
                                <div style={{ fontWeight: 'bold', marginTop: '3px', fontSize: '12px' }}>
                                  {cq.qty.toLocaleString()} PCS
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {liningMat ? (liningMat.spec || liningMat.itemName || '—') : '—'}
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {colorInfo?.decorColor || '—'}
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {logoMat ? (logoMat.spec || logoMat.itemName) : '—'}
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {colorInfo?.girimaeColor || (girimaeMat ? (girimaeMat.spec || girimaeMat.itemName) : '—')}
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {colorInfo?.threadColor || (threadMat ? (threadMat.spec || threadMat.itemName) : '—')}
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {zipperMat ? (zipperMat.spec || zipperMat.itemName) : '—'}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {/* 합계 행 */}
                        <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                          <td style={{ border: '1px solid #ccc', padding: '4px 6px' }}>
                            합계: {colorQtyList.reduce((s, c) => s + c.qty, 0).toLocaleString()} PCS
                          </td>
                          <td colSpan={6} style={{ border: '1px solid #ccc', padding: '4px 6px', fontSize: '10px', color: '#888' }}>
                            {colorQtyList.map(cq => `${cq.color} ${cq.qty.toLocaleString()}PCS`).join(' / ')}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* ── 제품 이미지 영역 ── */}
                    <div style={{ border: '1px solid #ccc', borderTop: 'none', padding: '8px', display: 'flex', gap: '8px', minHeight: '90px', alignItems: 'center' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '11px', color: '#555', minWidth: '60px', writingMode: 'vertical-rl', textAlign: 'center' }}>제품사진</div>
                      {allImages.length > 0 ? (
                        allImages.map((img, i) => (
                          <div key={i} style={{ width: '80px', height: '80px', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
                            <img src={img} alt={`제품이미지${i+1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                        ))
                      ) : (
                        Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} style={{ width: '80px', height: '80px', border: '1px dashed #bbb', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#bbb', fontSize: '10px' }}>
                            사진 {i+1}
                          </div>
                        ))
                      )}
                      <div style={{ flex: 1 }} />
                      {/* 이미지 없으면 메모란 */}
                      {allImages.length === 0 && (
                        <div style={{ flex: 1, fontSize: '10px', color: '#aaa', border: '1px dashed #ddd', padding: '6px', borderRadius: '4px', minHeight: '60px' }}>
                          품목 마스터 또는 샘플에 이미지를 등록하면 자동으로 표시됩니다
                        </div>
                      )}
                    </div>

                    {/* ── 하단 2열 레이아웃: 작업 기본사항 | 본사제공 자재 체크란 ── */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', border: '1px solid #ccc', borderTop: 'none' }}>

                      {/* 왼쪽: 6대 작업 기본사항 */}
                      <div style={{ borderRight: '1px solid #ccc', padding: '8px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '6px', borderBottom: '1px solid #ddd', paddingBottom: '4px' }}>
                          6대 작업 기본사항
                        </div>
                        <textarea
                          className="no-print"
                          style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: '3px', padding: '6px', fontSize: '11px', lineHeight: 1.7, resize: 'vertical', minHeight: '120px', fontFamily: 'inherit', background: '#fafffe' }}
                          value={workOrderNote || defaultWorkNote}
                          onChange={e => setWorkOrderNote(e.target.value)}
                        />
                        {/* 인쇄용 (화면에선 숨김) */}
                        <div style={{ display: 'none', fontSize: '11px', lineHeight: 1.7, whiteSpace: 'pre-wrap' }} className="print-only">
                          {workOrderNote || defaultWorkNote}
                        </div>
                        <style>{`.print-only { display: none; } @media print { .print-only { display: block !important; } .no-print { display: none !important; } }`}</style>
                        <div style={{ marginTop: '8px', fontWeight: 'bold', color: '#cc0000', fontSize: '12px', textAlign: 'center' }}>
                          수정사항 꼭 확인해주세요
                        </div>
                      </div>

                      {/* 오른쪽: 본사제공 자재 수령 체크란 */}
                      <div style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '6px', borderBottom: '1px solid #ddd', paddingBottom: '4px' }}>
                          본사제공 자재 수령 체크란
                        </div>
                        {hqMaterials.length > 0 ? (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                            <thead>
                              <tr style={{ background: '#f0f0f0' }}>
                                <th style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center', width: '30%' }}>품명</th>
                                <th style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center', width: '22%' }}>필요수량</th>
                                <th style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center', width: '28%' }}>수령수량</th>
                                <th style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center', width: '10%' }}>✓</th>
                              </tr>
                            </thead>
                            <tbody>
                              {hqMaterials.map((mat: any, idx: number) => {
                                const reqQty = (mat.netQty * (1 + mat.lossRate) * order.qty);
                                return (
                                  <tr key={idx}>
                                    <td style={{ border: '1px solid #ccc', padding: '3px 5px' }}>
                                      {mat.itemName}
                                      {mat.spec && <span style={{ color: '#888', fontSize: '10px' }}><br/>{mat.spec}</span>}
                                    </td>
                                    <td style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center', fontFamily: 'monospace' }}>
                                      {reqQty % 1 === 0 ? reqQty.toLocaleString() : reqQty.toFixed(2)} {mat.unit}
                                    </td>
                                    <td style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center' }}>
                                      <input
                                        type="text"
                                        className="no-print"
                                        placeholder="수령량"
                                        value={hqReceive[idx]?.received || ''}
                                        onChange={e => {
                                          const updated = [...hqReceive];
                                          updated[idx] = { ...updated[idx], received: e.target.value };
                                          setHqReceive(updated);
                                        }}
                                        style={{ width: '70px', border: '1px solid #ccc', borderRadius: '2px', padding: '2px 4px', fontSize: '11px', textAlign: 'center' }}
                                      />
                                      <span className="print-only" style={{ display: 'none', fontFamily: 'monospace' }}>
                                        {hqReceive[idx]?.received || '___'} {mat.unit}
                                      </span>
                                    </td>
                                    <td style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center' }}>
                                      <input
                                        type="checkbox"
                                        checked={hqReceive[idx]?.checked || false}
                                        onChange={e => {
                                          const updated = [...hqReceive];
                                          updated[idx] = { ...updated[idx], checked: e.target.checked };
                                          setHqReceive(updated);
                                        }}
                                        style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        ) : (
                          <div style={{ padding: '16px', textAlign: 'center', color: '#bbb', fontSize: '11px', border: '1px dashed #ddd', borderRadius: '4px' }}>
                            본사제공 자재 없음<br/>
                            <span style={{ fontSize: '10px' }}>(BOM에서 isHqProvided=true 항목이 없습니다)</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── 하단 서명란 ── */}
                    <div style={{ border: '1px solid #ccc', borderTop: 'none', padding: '6px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '11px', color: '#555' }}>
                      <div>작성: _______________</div>
                      <div>확인: _______________</div>
                      <div>수령: _______________</div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 하단 버튼 (인쇄 시 숨김) */}
            <div className="no-print flex justify-end gap-2 mt-3 pt-3 border-t border-border">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setWorkOrderModal(false)}>닫기</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => window.print()}>
                <FileText className="w-3.5 h-3.5 mr-1" />PDF 저장
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={() => window.print()}>
                <Printer className="w-3.5 h-3.5 mr-1" />인쇄
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 발주 완료 후 액션 팝업 ── */}
      {postOrderInfo && (
        <Dialog open={postOrderModal} onOpenChange={setPostOrderModal}>
          <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full rounded-none sm:w-[95vw] sm:max-w-md sm:rounded-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[var(--system-green)]">
                <CheckCircle2 className="w-5 h-5" />
                발주 등록 완료!
              </DialogTitle>
            </DialogHeader>
            <div className="py-3 space-y-3">
              {/* 발주 정보 요약 */}
              <div className="p-3 bg-[var(--system-green)]/10 border border-[var(--system-green)]/20 rounded-md">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span className="font-mono font-bold text-foreground">{postOrderInfo.order.styleNo}</span>
                  <span className="text-muted-foreground">{postOrderInfo.order.styleName}</span>
                  <span className="font-mono text-[var(--system-green)] font-semibold">{postOrderInfo.order.qty.toLocaleString()} PCS</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">발주번호: {postOrderInfo.order.orderNo} · 공장: {postOrderInfo.order.vendorName}</p>
              </div>
              <p className="text-sm text-muted-foreground font-medium">이어서 진행하시겠습니까?</p>
              <div className="space-y-2">
                {/* 작업지시서 출력 */}
                <button
                  className="w-full flex items-center gap-3 p-3 rounded-md border border-border hover:bg-[var(--fill-quaternary)] text-left transition-colors"
                  onClick={() => {
                    setPostOrderModal(false);
                    openWorkOrderModal(postOrderInfo.order);
                  }}
                >
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">작업지시서 출력</p>
                    <p className="text-xs text-muted-foreground">작업지시서 모달 바로 오픈</p>
                  </div>
                </button>
                {/* 자재 장바구니 자동 저장 안내 */}
                {postOrderInfo.bomMaterials.length > 0 ? (
                  <div className="w-full flex items-center gap-3 p-3 rounded-md border border-primary/20 bg-primary/10 text-left">
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm font-semibold text-primary">자재 장바구니 자동 저장 완료</p>
                      <p className="text-xs text-muted-foreground">본사제공 자재 {postOrderInfo.bomMaterials.length}종이 자재구매 탭 장바구니에 추가됐습니다</p>
                    </div>
                  </div>
                ) : (
                  <div className="w-full flex items-center gap-3 p-3 rounded-md border border-border bg-[var(--fill-quaternary)] text-left opacity-60">
                    <Package className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground">자재 없음</p>
                      <p className="text-xs text-muted-foreground">본사제공 자재 없음 (BOM 미등록 또는 전량 공장구매)</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPostOrderModal(false)}>닫기</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 자재 통합 발주 장바구니 모달 ── */}
      <Dialog open={cartModal} onOpenChange={setCartModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-4xl sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              자재 통합 발주 장바구니
              {cartItems.length > 0 && (
                <span className="ml-1 text-sm font-normal text-muted-foreground">({cartItems.length}종)</span>
              )}
            </DialogTitle>
          </DialogHeader>
          {cartItems.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">장바구니가 비어 있습니다</p>
              <p className="text-xs mt-1">발주 등록 완료 후 "자재 장바구니 담기"를 클릭하세요</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="overflow-x-auto">
                <table className="data-table w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-[var(--fill-quaternary)]">
                      <th className="text-[13px] font-semibold text-muted-foreground">자재명</th>
                      <th className="text-[13px] font-semibold text-muted-foreground">규격</th>
                      <th className="nw ctr text-[13px] font-semibold text-muted-foreground">단위</th>
                      <th className="num text-[13px] font-semibold text-muted-foreground">소요수량</th>
                      <th className="num text-[13px] font-semibold text-muted-foreground">보유재고</th>
                      <th className="num text-[13px] font-semibold text-muted-foreground">발주수량</th>
                      <th className="text-[13px] font-semibold text-muted-foreground">담긴 발주</th>
                      <th className="text-[13px] font-semibold text-muted-foreground">구매처</th>
                      <th className="ctr text-[13px] font-semibold text-muted-foreground">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cartItems.map((item, idx) => {
                      const stockQty = item.stockQty ?? 0;
                      const orderQty = Math.max(0, item.qty - stockQty);
                      const isSufficient = orderQty === 0;
                      return (
                      <tr key={idx} className="border-b border-border hover:bg-[var(--fill-quaternary)]">
                        <td className="font-medium text-foreground">{item.materialName}</td>
                        <td className="text-muted-foreground text-xs">{item.spec || '-'}</td>
                        <td className="ctr text-muted-foreground">{item.unit}</td>
                        <td className="nw num font-mono text-muted-foreground text-sm">
                          {item.qty % 1 === 0 ? item.qty.toLocaleString() : item.qty.toFixed(3)}
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            value={stockQty === 0 ? '' : stockQty}
                            placeholder="0"
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              store.updateCartItemStock(item.materialName, item.unit, val);
                              refreshCart();
                            }}
                            className="w-20 h-7 text-right font-mono text-sm border border-border rounded px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            value={orderQty}
                            onChange={e => {
                              const newQty = parseFloat(e.target.value) || 0;
                              // 발주수량 수동 조정 시 stockQty를 역산하여 저장
                              const newStock = Math.max(0, item.qty - newQty);
                              store.updateCartItemStock(item.materialName, item.unit, newStock);
                              refreshCart();
                            }}
                            className={`w-24 h-7 text-right font-mono text-sm border rounded px-2 focus:outline-none focus:ring-1 ${
                              isSufficient
                                ? 'border-[var(--system-green)] text-[var(--system-green)] bg-[var(--system-green)]/10 focus:ring-[var(--system-green)]'
                                : 'border-[var(--system-orange)] text-[var(--system-orange)] bg-[var(--system-orange)]/10 focus:ring-[var(--system-orange)]'
                            }`}
                          />
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {item.orders.map((o, i) => (
                            <span key={i}>
                              {i > 0 && <span className="mx-1 text-muted-foreground">+</span>}
                              <span className="text-muted-foreground font-medium">{o.styleNo}</span>
                              <span className="text-muted-foreground">({o.qty % 1 === 0 ? o.qty.toLocaleString() : o.qty.toFixed(3)})</span>
                            </span>
                          ))}
                        </td>
                        <td className="text-xs text-muted-foreground">{item.vendorName || <span className="text-muted-foreground">-</span>}</td>
                        <td className="ctr">
                          <button
                            className="text-muted-foreground hover:text-[var(--system-red)] transition-colors"
                            onClick={() => {
                              store.removeCartItem(item.materialName, item.unit);
                              refreshCart();
                            }}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">보유재고 입력 시 발주수량이 자동으로 차감됩니다. 발주수량도 직접 조정 가능합니다.</p>
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap">
            {cartItems.length > 0 && (
              <>
                <Button
                  variant="outline"
                  className="text-[var(--system-red)]"
                  onClick={() => {
                    if (confirm('장바구니를 전체 비우시겠습니까?')) {
                      store.clearMaterialCart();
                      refreshCart();
                    }
                  }}
                >
                  전체 비우기
                </Button>
                <Button
                  onClick={() => { setCartModal(false); setVendorOrderModal(true); }}
                >
                  <Printer className="w-4 h-4 mr-1.5" />
                  거래처별 발주서 출력
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setCartModal(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 공장 발주서 (묶음 1장) ── 스타일 여러 개를 한 장에 담아 공장에 보낸다.
             작업지시서는 스타일별로 따로 뽑는다 (아래 버튼). ── */}
      <Dialog open={!!batchSheet} onOpenChange={o => { if (!o) setBatchSheet(null); }}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[96vw] sm:h-auto sm:max-w-5xl sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="w-4 h-4" />발주서 — {batchSheet?.batchNo}
            </DialogTitle>
          </DialogHeader>
          {batchSheet && (() => {
            const list = batchSheet.orders;
            const vendorNames = Array.from(new Set(list.map(o => o.vendorName).filter(Boolean)));
            const totalQty = list.reduce((s, o) => s + (o.qty || 0), 0);
            const totalAmt = list.reduce((s, o) => s + (o.qty || 0) * (o.factoryUnitPriceKrw || 0), 0);
            const dates = list.map(o => o.deliveryDate).filter(Boolean).sort();
            return (
              <div className="space-y-4 py-1" ref={batchSheetRef}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">공장</p><p className="font-semibold">{vendorNames.join(', ') || '미지정'}</p></div>
                  <div><p className="text-xs text-muted-foreground">발주일</p><p className="font-semibold">{list[0]?.orderDate || '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">납기</p><p className="font-semibold">{dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`) : '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">스타일</p><p className="font-semibold tabular-nums">{list.length}개 · {totalQty.toLocaleString()} PCS</p></div>
                </div>

                {vendorNames.length > 1 && (
                  <p className="text-xs text-[var(--system-orange)]">공장이 {vendorNames.length}곳입니다 — 공장별로 나눠서 인쇄하세요.</p>
                )}

                <div className="border border-border rounded-md overflow-x-auto">
                  <table className="data-table min-w-[760px]">
                    <thead>
                      <tr>
                        <th className="num" style={{ width: 36 }}>No.</th>
                        <th className="nw nw" style={{ width: 128 }}>발주번호</th>
                        <th className="nw" style={{ width: 112 }}>스타일</th>
                        <th style={{ width: 96 }}>품명</th>
                        <th>컬러별 수량</th>
                        <th className="num" style={{ width: 72 }}>총수량</th>
                        <th className="num" style={{ width: 88 }}>단가</th>
                        <th className="num" style={{ width: 108 }}>금액</th>
                        <th className="nw nw" style={{ width: 92 }}>납기</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((o, i) => (
                        <tr key={o.id}>
                          <td className="num text-muted-foreground">{i + 1}</td>
                          <td className="nw font-mono text-xs">{o.orderNo}</td>
                          <td className="nw font-medium">{o.styleNo}</td>
                          <td className="text-muted-foreground">{o.styleName}</td>
                          <td className="text-xs">
                            {(o.colorQtys || []).length
                              ? (o.colorQtys || []).map(c => `${c.color} ${c.qty.toLocaleString()}`).join(' · ')
                              : '—'}
                          </td>
                          <td className="num">{(o.qty || 0).toLocaleString()}</td>
                          <td className="num">{o.factoryUnitPriceKrw ? formatKRW(o.factoryUnitPriceKrw) : '—'}</td>
                          <td className="num">{o.factoryUnitPriceKrw ? formatKRW((o.qty || 0) * o.factoryUnitPriceKrw) : '—'}</td>
                          <td className="nw text-xs">{o.deliveryDate || <span className="text-[var(--system-orange)]">미정</span>}</td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={5} className="font-semibold">합계</td>
                        <td className="num font-semibold">{totalQty.toLocaleString()}</td>
                        <td></td>
                        <td className="num font-semibold">{totalAmt > 0 ? formatKRW(totalAmt) : '—'}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="no-capture no-print">
                  <p className="text-xs text-muted-foreground mb-2">작업지시서는 스타일별로 따로 나갑니다</p>
                  <div className="flex flex-wrap gap-2">
                    {list.map(o => (
                      <Button key={o.id} size="sm" variant="outline" className="h-8 text-xs"
                        onClick={() => { setBatchSheet(null); openWorkOrderModal(o); }}>
                        <FileText className="w-3.5 h-3.5 mr-1.5" />{o.styleNo} 작업지시서
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setBatchSheet(null)}>닫기</Button>
            <Button variant="outline" onClick={async () => {
              if (!batchSheetRef.current) return;
              try { await copyDocAsImage(batchSheetRef.current); toast.success('이미지 복사됨 — 카톡·위챗에 붙여넣으세요'); }
              catch (e) { toast.error((e as Error).message); }
            }}>이미지 복사</Button>
            <Button variant="outline" onClick={async () => {
              if (!batchSheetRef.current) return;
              try { await saveDocAsImage(batchSheetRef.current, `발주서_${batchSheet.batchNo}`); toast.success('이미지 저장됨'); }
              catch (e) { toast.error((e as Error).message); }
            }}>이미지 저장</Button>
            <Button onClick={() => printDoc(batchSheetRef.current)}>
              <Printer className="w-4 h-4 mr-1.5" />A4 인쇄 · PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 거래처별 발주서 출력 모달 ── */}
      <Dialog open={vendorOrderModal} onOpenChange={setVendorOrderModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-3xl sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="w-4 h-4" />
              거래처별 발주서
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            {/* 거래처별 분류 */}
            {(() => {
              // cartItems를 vendorName 기준으로 그룹핑 (발주수량 0 항목 제외)
              const grouped = new Map<string, Array<CartItem & { orderQty: number }>>();
              for (const item of cartItems) {
                const stockQty = item.stockQty ?? 0;
                const orderQty = Math.max(0, item.qty - stockQty);
                if (orderQty === 0) continue; // 발주수량 0 항목 제외
                const vendor = item.vendorName || '미지정';
                if (!grouped.has(vendor)) grouped.set(vendor, []);
                grouped.get(vendor)!.push({ ...item, orderQty });
              }
              const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
              if (grouped.size === 0) {
                return <p className="text-center text-muted-foreground py-8">발주가 필요한 자재가 없습니다 (보유재고로 충당 가능)</p>;
              }
              return Array.from(grouped.entries()).map(([vendor, items]) => (
                <div key={vendor} className="border border-border rounded-md overflow-hidden">
                  {/* 업체 헤더 */}
                  <div className="bg-[var(--fill-quaternary)] border-b border-border px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-base text-foreground">{vendor === '미지정' ? '구매처 미지정' : vendor}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">발주일: {today} · {items.length}종</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => window.print()}
                    >
                      <Printer className="w-3 h-3 mr-1" />인쇄
                    </Button>
                  </div>
                  {/* 발주 품목 테이블 */}
                  <div className="overflow-x-auto"><table className="data-table w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="ctr text-[13px] font-semibold text-muted-foreground w-8">No.</th>
                        <th className="ctr text-[13px] font-semibold text-muted-foreground w-10">이미지</th>
                        <th className="text-[13px] font-semibold text-muted-foreground">자재명</th>
                        <th className="text-[13px] font-semibold text-muted-foreground">규격</th>
                        <th className="nw ctr text-[13px] font-semibold text-muted-foreground">단위</th>
                        <th className="num text-[13px] font-semibold text-muted-foreground">소요수량</th>
                        <th className="num text-[13px] font-semibold text-muted-foreground">보유재고</th>
                        <th className="num text-[13px] font-semibold text-muted-foreground">발주수량</th>
                        <th className="text-[13px] font-semibold text-muted-foreground">비고 (담긴 발주)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, i) => (
                        <tr key={i} className="border-b border-border">
                          <td className="ctr text-muted-foreground text-xs">{i + 1}</td>
                          <td className="ctr">
                            {(item as any).imageUrl ? (
                              <img src={(item as any).imageUrl} alt={item.materialName} className="w-14 h-14 object-cover rounded cursor-pointer border border-border hover:scale-110 transition-transform" onClick={() => window.open((item as any).imageUrl, '_blank')} />
                            ) : (
                              <Camera className="w-4 h-4 mx-auto text-muted-foreground" />
                            )}
                          </td>
                          <td className="font-medium text-foreground">{item.materialName}</td>
                          <td className="text-muted-foreground text-xs">{item.spec || '-'}</td>
                          <td className="ctr text-muted-foreground">{item.unit}</td>
                          <td className="nw num font-mono text-muted-foreground text-xs">
                            {item.qty % 1 === 0 ? item.qty.toLocaleString() : item.qty.toFixed(3)}
                          </td>
                          <td className="nw num font-mono text-muted-foreground text-xs">
                            {(item.stockQty ?? 0) % 1 === 0 ? (item.stockQty ?? 0).toLocaleString() : (item.stockQty ?? 0).toFixed(3)}
                          </td>
                          <td className="nw num font-mono font-semibold text-primary">
                            {item.orderQty % 1 === 0 ? item.orderQty.toLocaleString() : item.orderQty.toFixed(3)}
                          </td>
                          <td className="text-xs text-muted-foreground">
                            {item.orders.map((o, j) => (
                              <span key={j}>
                                {j > 0 && ' + '}
                                {o.styleNo}({o.qty % 1 === 0 ? o.qty.toLocaleString() : o.qty.toFixed(3)})
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[var(--fill-quaternary)] border-t border-border">
                        <td colSpan={6} className="px-3 py-2 text-xs font-medium text-muted-foreground text-right">합계 {items.length}종</td>
                        <td className="num text-xs font-bold text-foreground">{items.length}종 발주</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table></div>
                  {/* 서명란 */}
                  <div className="px-4 py-3 border-t border-border grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                    <div>발주담당: ___________</div>
                    <div>확인: ___________</div>
                    <div>수령: ___________</div>
                  </div>
                </div>
              ));
            })()}
            {cartItems.length === 0 && (
              <p className="text-center text-muted-foreground py-8">장바구니에 담긴 자재가 없습니다</p>
            )}
          </div>
          <DialogFooter className="flex flex-wrap gap-2 justify-between">
            <Button variant="outline" onClick={() => { setVendorOrderModal(false); setCartModal(true); }}>
              뒤로
            </Button>
            <div className="flex gap-2 flex-wrap">
              {/* 이메일 발송 버튼 (거래처별 발주서 전체에 대한 안내) */}
              {(() => {
                const grouped = new Map<string, Array<CartItem & { orderQty: number }>>();
                for (const item of cartItems) {
                  const stockQty = item.stockQty ?? 0;
                  const orderQty = Math.max(0, item.qty - stockQty);
                  if (orderQty === 0) continue;
                  const vendor = item.vendorName || '미지정';
                  if (!grouped.has(vendor)) grouped.set(vendor, []);
                  grouped.get(vendor)!.push({ ...item, orderQty });
                }
                return Array.from(grouped.entries()).map(([vendor, items]) => {
                  const handleSendEmail = async () => {
                    // 거래처 이메일 자동 조회
                    const vendorRecord = allVendors.find(v => v.name === vendor && v.type === '자재거래처');
                    const vendorEmail = vendorRecord?.contactEmail || '';
                    if (!vendorEmail) {
                      setPendingEmailVendor(vendor);
                      setPendingEmailItems(items);
                      setEmailInputValue('');
                      setEmailInputModal(true);
                      return;
                    }
                    await sendVendorEmail(vendor, vendorEmail, items);
                  };
                  return (
                    <Button
                      key={`email-${vendor}`}
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={handleSendEmail}
                    >
                      <Mail className="w-3.5 h-3.5 mr-1" />{vendor} 이메일
                    </Button>
                  );
                });
              })()}
              {/* 발주 확정 버튼 */}
              <Button
                className="h-8 text-xs"
                onClick={async () => {
                  try {
                    const r = await confirmMaterialOrder({
                      cartItems,
                      orders,
                      vendors: allVendors,
                      cnyKrw: store.getSettings().cnyKrw || 191,
                      fallbackOrder: postOrderInfo?.order ?? null,
                    });
                    queryClient.invalidateQueries({ queryKey: ['materials'] });
                    queryClient.invalidateQueries({ queryKey: ['purchaseItems'] });
                    refreshCart();
                    if (r.skippedNoOrder.length > 0) {
                      toast.warning(`발주번호를 찾지 못해 ${r.skippedNoOrder.length}종을 건너뛰었습니다`, {
                        description: r.skippedNoOrder.join(', '),
                      });
                    }
                    toast.success(`자재 ${r.materialCount}종 저장 · 자재구매 전표 ${r.purchaseCount}건 생성`);
                    setVendorOrderModal(false);
                  } catch (e: any) {
                    console.error('발주 확정 오류:', e);
                    toast.error(`발주 확정 실패: ${e?.message || '알 수 없는 오류'}`);
                  }
                }}
              >
                발주 확정
              </Button>
              <Button variant="outline" onClick={() => setVendorOrderModal(false)}>닫기</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 기존 결의 연결 모달 ── */}
      <Dialog open={linkExpenseModal} onOpenChange={setLinkExpenseModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" />기존 지출결의 연결
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="검색 (메모, 거래처, 발주번호)"
              value={linkExpenseSearch}
              onChange={e => setLinkExpenseSearch(e.target.value)}
              className="h-9 text-sm"
            />
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {phase1.getPayables()
                .filter(p => p.sourceType === 'processing' || p.sourceType === 'order_receipt' || p.sourceType === 'manual')
                .filter(p => {
                  const q = linkExpenseSearch.toLowerCase();
                  return !q
                    || (p.memo || '').toLowerCase().includes(q)
                    || (p.vendorName || '').toLowerCase().includes(q)
                    || (p.orderNo || '').toLowerCase().includes(q)
                    || (p.projectNo || '').toLowerCase().includes(q);
                })
                .sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''))
                .map(p => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 border border-border rounded-md hover:bg-[var(--fill-quaternary)] cursor-pointer"
                    onClick={() => handleLinkExpenseToOrder(p.id)}
                  >
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.memo || p.vendorName}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.dueDate} · {p.vendorName || '공장 미지정'}
                        {p.orderNo ? ` · ${p.orderNo}` : ''}
                        {p.projectNo ? ` · ${p.projectNo}` : ''}
                      </p>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-sm font-semibold text-foreground">{formatKRW(p.amountKrw)}</p>
                      <span className="text-xs bg-[var(--fill-tertiary)] text-muted-foreground px-1.5 py-0.5 rounded">{p.sourceType}</span>
                    </div>
                  </div>
                ))}
              {phase1.getPayables().filter(p => p.sourceType === 'processing' || p.sourceType === 'order_receipt').length === 0 && (
                <p className="text-center py-8 text-muted-foreground text-sm">등록된 공장 지출결의가 없습니다</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkExpenseModal(false)}>취소</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 입고완료 지출결의 모달 ── */}
      <Dialog open={expenseModal} onOpenChange={setExpenseModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full rounded-none sm:w-[95vw] sm:max-w-md sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" />
              지출결의 생성 — 임가공(입고)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>내용 *</Label>
                <Input
                  value={expenseForm.description}
                  onChange={e => setExpenseForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="지출 내용"
                />
              </div>
              <div className="space-y-1.5">
                <Label>날짜</Label>
                <Input
                  type="date"
                  value={expenseForm.expenseDate}
                  onChange={e => setExpenseForm(f => ({ ...f, expenseDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>카테고리</Label>
                <Select value={expenseForm.category} onValueChange={v => setExpenseForm(f => ({ ...f, category: v as ExpenseCategory }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['임가공비', '자재구매', '물류비', '샘플비', '기타제조원가', '판관비', '기타'] as ExpenseCategory[]).map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>금액 (KRW) *</Label>
                <Input
                  type="number"
                  value={expenseForm.amountKrw || ''}
                  onChange={e => setExpenseForm(f => ({ ...f, amountKrw: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>결제 방법</Label>
                <Select value={expenseForm.expenseType} onValueChange={v => setExpenseForm(f => ({ ...f, expenseType: v as ExpenseType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>발주번호</Label>
                <div className="h-9 flex items-center px-3 bg-[var(--fill-quaternary)] rounded border border-border text-sm font-mono text-muted-foreground">
                  {expenseForm.orderNo || '-'}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>거래처명 (공장)</Label>
                <Input
                  value={expenseForm.vendorName}
                  onChange={e => setExpenseForm(f => ({ ...f, vendorName: e.target.value }))}
                  placeholder="공장명"
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={expenseForm.hasTaxInvoice}
                    onChange={e => setExpenseForm(f => ({ ...f, hasTaxInvoice: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  세금계산서 수취
                </Label>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>메모</Label>
                <Input
                  value={expenseForm.memo}
                  onChange={e => setExpenseForm(f => ({ ...f, memo: e.target.value }))}
                  placeholder="비고"
                />
              </div>
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-md p-3 space-y-1">
              <p className="text-xs font-medium text-primary">전표 미리보기</p>
              <p className="text-xs text-muted-foreground">{expenseForm.description}</p>
              <p className="text-sm font-bold text-foreground">{formatKRW(expenseForm.amountKrw)}</p>
              <p className="text-xs text-muted-foreground">{expenseForm.expenseDate} · {expenseForm.expenseType} · {expenseForm.vendorName || '공장 미지정'}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseModal(false)}>취소</Button>
            <Button onClick={handleSaveExpense} className="gap-2">
              <Receipt className="w-4 h-4" />전표 저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 이메일 입력 모달 ── */}
      <Dialog open={emailInputModal} onOpenChange={setEmailInputModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full rounded-none sm:w-[95vw] sm:max-w-sm sm:rounded-md">
          <DialogHeader>
            <DialogTitle>이메일 주소 입력</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold">{pendingEmailVendor}</span> 거래처의 이메일 주소가 등록되어 있지 않습니다.
            </p>
            <div className="space-y-1.5">
              <Label>이메일 주소</Label>
              <Input
                type="email"
                placeholder="example@company.com"
                value={emailInputValue}
                onChange={e => setEmailInputValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && emailInputValue.trim()) {
                    setEmailInputModal(false);
                    sendVendorEmail(pendingEmailVendor, emailInputValue.trim(), pendingEmailItems);
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailInputModal(false)}>취소</Button>
            <Button
              disabled={!emailInputValue.trim()}
              onClick={() => {
                setEmailInputModal(false);
                sendVendorEmail(pendingEmailVendor, emailInputValue.trim(), pendingEmailItems);
              }}
            >
              <Mail className="w-4 h-4 mr-1" />발송
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

