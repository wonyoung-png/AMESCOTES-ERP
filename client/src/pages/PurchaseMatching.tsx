// AMESCOTES ERP — 자재 구매 매칭
import React, { useState, useMemo, useEffect } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useSearch } from 'wouter';
import { confirmMaterialOrder } from '@/lib/confirmMaterialOrder';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPurchaseItems, upsertPurchaseItem, deletePurchaseItem as deletePurchaseItemSB,
  updatePurchaseItemStatus, fetchOrders, upsertOrder, fetchVendors,
} from '@/lib/supabaseQueries';
import {
  store, genId, formatKRW, formatNumber,
  type PurchaseItem, type Currency, type ExpenseType, type Expense, type ExpenseCategory,
  type ExpenseLine, type CartItem,
} from '@/lib/store';
import { phase1, type Payable } from '@/lib/phase1';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { onSaveFail } from '@/lib/saveGuard';
import { Plus, Trash2, ShoppingCart, FileText, Receipt, Printer, X, Mail, Eye, Camera } from 'lucide-react';

const CURRENCIES: Currency[] = ['KRW', 'USD', 'CNY'];
const PAYMENT_METHODS: ExpenseType[] = ['법인카드', '계좌이체', '현금'];
const PURCHASE_STATUSES = ['미발주', '발주완료', '입고완료', '발송완료'] as const;

const STATUS_COLOR: Record<string, string> = {
  '미발주': 'bg-[var(--fill-quaternary)] text-muted-foreground border-border',
  '발주완료': 'bg-primary/10 text-primary border-transparent',
  '입고완료': 'bg-[var(--system-green)]/10 text-[var(--system-green)] border-transparent',
  '발송완료': 'bg-[var(--system-green)]/10 text-[var(--system-green)] border-transparent',
};

interface ExpenseFormState {
  purchaseItemId: string;
  expenseDate: string;
  category: ExpenseCategory;
  description: string;
  amountKrw: number;
  orderNo: string;
  orderId: string;
  vendorName: string;
  expenseType: ExpenseType;
  hasTaxInvoice: boolean;
  memo: string;
}

const DEFAULT_EXPENSE_FORM: ExpenseFormState = {
  purchaseItemId: '',
  expenseDate: new Date().toISOString().split('T')[0],
  category: '자재구매',
  description: '',
  amountKrw: 0,
  orderNo: '',
  orderId: '',
  vendorName: '',
  expenseType: '계좌이체',
  hasTaxInvoice: false,
  memo: '',
};

export default function PurchaseMatching() {
  const queryClient = useQueryClient();
  const { data: purchases = [] } = useQuery({
    queryKey: ['purchaseItems'],
    queryFn: fetchPurchaseItems,
  });
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
  const { data: allVendorsData = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const vendors = allVendorsData.filter((v: any) => v.type === '자재거래처');
  const allVendors = store.getVendors();
  const settings = store.getSettings();
  const [filterOrder, setFilterOrder] = usePersistedState('purchase.filterOrder', 'all');
  const [filterStatus, setFilterStatus] = usePersistedState('purchase.filterStatus', 'all');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 체크박스 선택 상태
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState<Set<string>>(new Set());

  const togglePurchaseSelect = (id: string) => {
    setSelectedPurchaseIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleGroupSelect = (orderNo: string, items: PurchaseItem[]) => {
    const ids = items.map(i => i.id);
    const allSelected = ids.every(id => selectedPurchaseIds.has(id));
    setSelectedPurchaseIds(prev => {
      const n = new Set(prev);
      if (allSelected) ids.forEach(id => n.delete(id));
      else ids.forEach(id => n.add(id));
      return n;
    });
  };

  const handleGroupStatusChange = async (orderNo: string, items: PurchaseItem[], status: string) => {
    for (const item of items) {
      await updatePurchaseItemStatus(item.id, status);
      if (status === '발송완료') {
        try {
          const allOrders = await fetchOrders();
          const relatedOrder = allOrders.find((o: any) => o.orderNo === item.orderNo);
          if (relatedOrder && (relatedOrder.status === '발주생성' || !relatedOrder.status)) {
            await upsertOrder({ ...relatedOrder, status: '생산중', updatedAt: new Date().toISOString() });
            store.updateOrder(relatedOrder.id, { status: '생산중' });
          } else {
            const localOrder = store.getOrders().find(o => o.orderNo === item.orderNo);
            if (localOrder && localOrder.status === '발주생성') {
              store.updateOrder(localOrder.id, { status: '생산중' });
              upsertOrder({ ...localOrder, status: '생산중', updatedAt: new Date().toISOString() }).catch(onSaveFail('자재구매'));
            }
          }
        } catch {
          const localOrder = store.getOrders().find(o => o.orderNo === item.orderNo);
          if (localOrder && localOrder.status === '발주생성') {
            store.updateOrder(localOrder.id, { status: '생산중' });
          }
        }
      }
    }
    refresh();
    toast.success(`[${orderNo}] ${items.length}종 → ${status}로 변경됐어요`);
  };

  const handleBulkDeletePurchase = async () => {
    if (!confirm(`선택한 ${selectedPurchaseIds.size}건을 삭제하시겠습니까?`)) return;
    const count = selectedPurchaseIds.size;
    for (const id of Array.from(selectedPurchaseIds)) {
      await deletePurchaseItemSB(id);
    }
    setSelectedPurchaseIds(new Set());
    refresh();
    toast.success(`${count}건 삭제됐어요`);
  };
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Partial<PurchaseItem>>({});
  const [editId, setEditId] = useState<string | null>(null);

  // 지출결의 모달 상태
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(DEFAULT_EXPENSE_FORM);
  // 지출결의/구전표 상세
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [selectedPayable, setSelectedPayable] = useState<Payable | null>(null);
  // 생성된 결의 (바로보기용)
  const [justCreatedPayable, setJustCreatedPayable] = useState<Payable | null>(null);

  // 기존전표 연결 모달 상태 (작업 2)
  const [linkExpenseModal, setLinkExpenseModal] = useState(false);
  const [linkTargetItemId, setLinkTargetItemId] = useState<string | null>(null);
  const [linkSearchText, setLinkSearchText] = useState('');

  // 일괄수정 모달 상태 (작업 6)
  const [bulkEditModal, setBulkEditModal] = useState(false);
  const [bulkEditOrderNo, setBulkEditOrderNo] = useState('');
  const [bulkEditItems, setBulkEditItems] = useState<PurchaseItem[]>([]);
  const [bulkEditDate, setBulkEditDate] = useState('');

  const openBulkEditModal = (orderNo: string, items: PurchaseItem[]) => {
    setBulkEditOrderNo(orderNo);
    setBulkEditItems(items.map(i => ({ ...i })));
    setBulkEditDate(new Date().toISOString().split('T')[0]);
    setBulkEditModal(true);
  };

  const updateBulkItem = (idx: number, field: 'qty' | 'unitPriceCny' | 'purchaseStatus', value: string) => {
    setBulkEditItems(prev => {
      const next = [...prev];
      const item = { ...next[idx] };
      if (field === 'qty') item.qty = parseFloat(value) || 0;
      else if (field === 'unitPriceCny') item.unitPriceCny = parseFloat(value) || 0;
      else if (field === 'purchaseStatus') item.purchaseStatus = value as PurchaseItem['purchaseStatus'];
      item.amountKrw = calcAmountKrw(item.qty, item.unitPriceCny, item.currency);
      next[idx] = item;
      return next;
    });
  };

  const handleBulkEdit = async () => {
    for (const item of bulkEditItems) {
      const extra: Record<string, any> = {
        unit_price_cny: item.unitPriceCny,
        amount_krw: item.amountKrw,
        qty: item.qty,
      };
      if (bulkEditDate) extra.purchase_date = bulkEditDate;
      await updatePurchaseItemStatus(item.id, item.purchaseStatus, extra);
    }
    refresh();
    setBulkEditModal(false);
    toast.success(`${bulkEditItems.length}종 일괄 수정 완료`);
  };

  // 자재 장바구니 모달 상태
  const [cartModal, setCartModal] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>(() => store.getMaterialCart());
  const searchStr = useSearch();

  // 품목마스터 일괄발주 완료 → "자재 장바구니 확인"으로 진입 시 모달 자동 오픈
  useEffect(() => {
    const fromQuery = /(?:^|[?&])cart=1(?:&|$)/.test(searchStr) || searchStr === '?cart=1' || searchStr.includes('cart=1');
    let fromFlag = false;
    try { fromFlag = localStorage.getItem('ames_open_material_cart') === '1'; } catch { /* ignore */ }
    if (!fromQuery && !fromFlag) return;
    try { localStorage.removeItem('ames_open_material_cart'); } catch { /* ignore */ }
    setCartItems(store.getMaterialCart());
    setCartModal(true);
  }, [searchStr]);

  // 거래처별 발주서 모달 상태
  const [vendorOrderModal, setVendorOrderModal] = useState(false);
  // 이메일 입력 모달 상태
  const [emailInputModal, setEmailInputModal] = useState(false);
  const [emailInputValue, setEmailInputValue] = useState('');
  const [pendingEmailVendor, setPendingEmailVendor] = useState<string>('');
  const [pendingEmailItems, setPendingEmailItems] = useState<Array<CartItem & { orderQty: number }>>([]);

  const refreshCart = () => setCartItems(store.getMaterialCart());
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['purchaseItems'] });

  // (Supabase 전환 후 orderNo 동기화 로직 불필요 - Supabase가 단일 소스)

  const filtered = useMemo(() => {
    let list = purchases;
    if (filterOrder !== 'all') list = list.filter(p => p.orderId === filterOrder);
    if (filterStatus !== 'all') list = list.filter(p => p.purchaseStatus === filterStatus);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [purchases, filterOrder, filterStatus]);

  const stats = useMemo(() => {
    const unpurchased = purchases.filter(p => p.purchaseStatus === '미발주').length;
    const totalKrw = purchases.reduce((s, p) => s + p.amountKrw, 0);
    const linked = purchases.filter(p => !!p.statementNo).length;
    return { total: purchases.length, unpurchased, totalKrw, linked };
  }, [purchases]);

  const calcAmountKrw = (qty: number, unitPriceCny: number, currency: Currency): number => {
    if (currency === 'KRW') return qty * unitPriceCny;
    if (currency === 'USD') return qty * unitPriceCny * settings.usdKrw;
    if (currency === 'CNY') return qty * unitPriceCny * settings.cnyKrw;
    return qty * unitPriceCny;
  };

  const openNew = () => {
    setForm({
      purchaseDate: new Date().toISOString().split('T')[0],
      currency: 'KRW', qty: 0, unitPriceCny: 0, amountKrw: 0,
      appliedRate: 1, purchaseStatus: '미발주', paymentMethod: '법인카드',
    });
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (p: PurchaseItem) => { setForm({ ...p }); setEditId(p.id); setShowModal(true); };

  const handleOrderSelect = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (order) setForm(f => ({ ...f, orderId: order.id, orderNo: order.orderNo }));
  };

  const updateAmount = (qty: number, unitPriceCny: number, currency: Currency) => {
    const rate = currency === 'USD' ? settings.usdKrw : currency === 'CNY' ? settings.cnyKrw : 1;
    const amountKrw = calcAmountKrw(qty, unitPriceCny, currency);
    setForm(f => ({ ...f, qty, unitPriceCny, currency, appliedRate: rate, amountKrw }));
  };

  const handleSave = async () => {
    if (!form.orderId) { toast.error('발주번호를 선택해주세요'); return; }
    if (!form.itemName) { toast.error('품목명을 입력해주세요'); return; }
    if (editId) {
      await upsertPurchaseItem({ ...form, id: editId });
      toast.success('수정되었습니다');
    } else {
      const p: PurchaseItem = {
        id: genId(),
        orderId: form.orderId!,
        orderNo: form.orderNo!,
        purchaseDate: form.purchaseDate || new Date().toISOString().split('T')[0],
        itemName: form.itemName!,
        qty: form.qty || 0,
        unit: form.unit || 'EA',
        unitPriceCny: form.unitPriceCny || 0,
        currency: form.currency || 'KRW',
        appliedRate: form.appliedRate || 1,
        amountKrw: form.amountKrw || 0,
        vendorId: form.vendorId,
        vendorName: form.vendorName,
        purchaseStatus: form.purchaseStatus || '미발주',
        paymentMethod: form.paymentMethod || '법인카드',
        statementNo: form.statementNo,
        memo: form.memo,
        createdAt: new Date().toISOString(),
      };
      await upsertPurchaseItem(p);
      toast.success('구매 내역이 등록되었습니다');
    }
    refresh();
    setShowModal(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    await deletePurchaseItemSB(id);
    refresh();
    toast.success('삭제되었습니다');
  };

  const handleStatusChange = async (id: string, status: string) => {
    await updatePurchaseItemStatus(id, status);

    // 발송완료로 변경 시 → 해당 발주번호의 생산발주 상태를 '생산중'으로 자동 변경
    if (status === '발송완료') {
      const item = purchases.find(p => p.id === id);
      if (item?.orderNo) {
        try {
          const allOrders = await fetchOrders();
          const relatedOrder = allOrders.find((o: any) => o.orderNo === item.orderNo);
          if (relatedOrder && (relatedOrder.status === '발주생성' || !relatedOrder.status)) {
            await upsertOrder({ ...relatedOrder, status: '생산중', updatedAt: new Date().toISOString() });
            store.updateOrder(relatedOrder.id, { status: '생산중' });
            toast.success(`생산발주 [${item.orderNo}] → 생산중으로 자동 변경됐어요`);
          } else {
            const localOrder = store.getOrders().find(o => o.orderNo === item.orderNo);
            if (localOrder && localOrder.status === '발주생성') {
              store.updateOrder(localOrder.id, { status: '생산중' });
              upsertOrder({ ...localOrder, status: '생산중', updatedAt: new Date().toISOString() }).catch(onSaveFail('자재구매'));
              toast.success(`생산발주 [${item.orderNo}] → 생산중으로 변경됐어요`);
            }
          }
        } catch {
          const localOrder = store.getOrders().find(o => o.orderNo === item.orderNo);
          if (localOrder) {
            store.updateOrder(localOrder.id, { status: '생산중' });
            toast.success(`생산발주 [${item.orderNo}] → 생산중으로 변경됐어요`);
          }
        }
      }
    }

    refresh();
  };

  // ── 지출결의(Payable) 생성 ──────────────────────────────────────────
  const openExpenseModal = (item: PurchaseItem) => {
    setExpenseForm({
      purchaseItemId: item.id,
      expenseDate: item.purchaseDate || new Date().toISOString().split('T')[0],
      category: '자재구매',
      description: `[${item.orderNo}] ${item.itemName} ${item.qty}${item.unit}`,
      amountKrw: item.amountKrw || 0,
      orderNo: item.orderNo,
      orderId: item.orderId,
      vendorName: item.vendorName || '',
      expenseType: (item.paymentMethod as ExpenseType) || '계좌이체',
      hasTaxInvoice: false,
      memo: '',
    });
    setExpenseModal(true);
  };

  const resolvePurchaseProject = (item?: PurchaseItem) => {
    if (!item) return { projectNo: undefined as string | undefined, styleNo: undefined as string | undefined };
    if (item.projectNo || item.styleNo) return { projectNo: item.projectNo, styleNo: item.styleNo };
    const order = (orders as Array<{ id: string; orderNo: string; projectNo?: string; styleNo?: string }>)
      .find(o => o.id === item.orderId || o.orderNo === item.orderNo)
      || store.getOrders().find(o => o.id === item.orderId || o.orderNo === item.orderNo);
    return { projectNo: order?.projectNo, styleNo: order?.styleNo || item.styleNo };
  };

  const handleSaveExpense = async () => {
    if (!expenseForm.description) { toast.error('내용을 입력해주세요'); return; }
    if (!expenseForm.amountKrw) { toast.error('금액을 입력해주세요'); return; }

    const item = purchases.find(p => p.id === expenseForm.purchaseItemId);
    const { projectNo, styleNo } = resolvePurchaseProject(item);
    const payable = phase1.createPayableFromPurchase({
      id: expenseForm.purchaseItemId,
      orderId: expenseForm.orderId || item?.orderId,
      orderNo: expenseForm.orderNo || item?.orderNo,
      itemName: item?.itemName,
      amountKrw: expenseForm.amountKrw,
      vendorId: item?.vendorId,
      vendorName: expenseForm.vendorName || item?.vendorName,
      purchaseDate: expenseForm.expenseDate,
      projectNo,
      styleNo,
    });
    if (!payable) { toast.error('지출결의 생성 실패'); return; }

    await upsertPurchaseItem({
      ...item,
      id: expenseForm.purchaseItemId,
      statementNo: payable.id,
      projectNo: projectNo || item?.projectNo,
      styleNo: styleNo || item?.styleNo,
      amountKrw: expenseForm.amountKrw,
      vendorName: expenseForm.vendorName || item?.vendorName,
      purchaseDate: expenseForm.expenseDate,
    });

    toast.success('지출결의(자재)가 생성되었습니다 — /payables 에서 결제');
    refresh();
    setExpenseModal(false);
    setJustCreatedPayable(payable);
  };

  const viewLinkedExpense = (statementNo: string) => {
    const payable = phase1.getPayables().find(p => p.id === statementNo);
    if (payable) { setSelectedPayable(payable); return; }
    const expense = store.getExpenses().find(e => e.id === statementNo);
    if (!expense) { toast.error('연결된 결의/전표를 찾을 수 없습니다'); return; }
    setSelectedExpense(expense);
  };

  // ── 기존 결의/전표 연결 ──────────────────────────────────
  const openLinkExpenseModal = (itemId: string) => {
    setLinkTargetItemId(itemId);
    setLinkSearchText('');
    setLinkExpenseModal(true);
  };

  const handleLinkExpense = async (docId: string) => {
    if (!linkTargetItemId) return;
    await updatePurchaseItemStatus(linkTargetItemId, purchases.find(p => p.id === linkTargetItemId)?.purchaseStatus || '미발주', {
      statement_no: docId,
    });
    refresh();
    setLinkExpenseModal(false);
    setLinkTargetItemId(null);
    toast.success('결의 연결 완료');
  };

  // 그룹 전표 일괄발행 — 항목별 Payable
  const handleGroupBulkExpense = async (orderNo: string, groupItems: PurchaseItem[]) => {
    const unpaidItems = groupItems.filter(i => !i.statementNo);
    if (unpaidItems.length === 0) { toast.error('이미 모든 항목에 결의가 있습니다'); return; }
    let count = 0;
    let totalKrw = 0;
    for (const item of unpaidItems) {
      const { projectNo, styleNo } = resolvePurchaseProject(item);
      const payable = phase1.createPayableFromPurchase({
        id: item.id,
        orderId: item.orderId,
        orderNo: item.orderNo || orderNo,
        itemName: item.itemName,
        amountKrw: item.amountKrw,
        vendorId: item.vendorId,
        vendorName: item.vendorName,
        purchaseDate: item.purchaseDate || new Date().toISOString().split('T')[0],
        projectNo,
        styleNo,
      });
      if (!payable) continue;
      await updatePurchaseItemStatus(item.id, item.purchaseStatus, {
        statement_no: payable.id,
        ...(projectNo ? { project_no: projectNo } : {}),
      });
      count++;
      totalKrw += item.amountKrw;
    }
    refresh();
    toast.success(`[${orderNo}] 지출결의 일괄발행 — ${count}종 / ${formatKRW(totalKrw)}`);
  };

  // 이메일 발송
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
    try {
      const resp = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email, subject, body, account: 'info@atlm.kr' }),
      });
      if (resp.ok) { toast.success(`${vendor} 발주서를 ${email}로 발송했습니다`); return; }
    } catch { /* API 없음 */ }
    const gogCmd = `gog gmail send --to "${email}" --subject "${subject}" --body "${body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}" --account info@atlm.kr`;
    try {
      await navigator.clipboard.writeText(gogCmd);
      toast.success(`${vendor} 발주서 이메일 명령어가 클립보드에 복사됐습니다!\n터미널에 붙여넣기해서 실행하세요`);
    } catch {
      toast.info(`${vendor} 발주서\n수신: ${email}\n수동으로 gog 명령어를 실행해주세요`);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">자재 구매</h1>
          <p className="text-sm text-muted-foreground mt-0.5">발주번호 매칭 · 본사제공 자재 구매 이력 관리</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* 자재 장바구니 버튼 */}
          <button
            onClick={() => { refreshCart(); setCartModal(true); }}
            className="relative px-3 py-2 rounded-md border border-transparent text-xs font-medium text-primary bg-primary/15 hover:bg-primary/20 transition-colors flex items-center gap-1.5"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            자재 장바구니
            {cartItems.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-primary text-primary-foreground text-[11px] rounded-full flex items-center justify-center font-bold">
                {cartItems.length}
              </span>
            )}
          </button>
          <Button onClick={openNew} className="gap-2">
            <Plus className="w-4 h-4" />구매 등록
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '전체 구매건', value: `${stats.total}건`, color: 'text-foreground' },
          { label: '미발주', value: `${stats.unpurchased}건`, color: 'text-[var(--system-orange)]' },
          { label: '총 구매금액', value: formatKRW(stats.totalKrw), color: 'text-foreground' },
          { label: '전표 연결됨', value: `${stats.linked}건`, color: 'text-[var(--system-green)]' },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-lg border border-border p-4">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-28 h-9"><SelectValue placeholder="상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {PURCHASE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {selectedPurchaseIds.size > 0 && (
          <Button variant="destructive" size="sm" onClick={handleBulkDeletePurchase}>
            선택 삭제 ({selectedPurchaseIds.size}건)
          </Button>
        )}
      </div>

      <div className="bg-card rounded-lg border border-border overflow-x-auto">
        <table className="data-table w-full min-w-[800px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every(p => selectedPurchaseIds.has(p.id))}
                  onChange={() => {
                    const allSelected = filtered.every(p => selectedPurchaseIds.has(p.id));
                    setSelectedPurchaseIds(allSelected ? new Set() : new Set(filtered.map(p => p.id)));
                  }}
                  className="cursor-pointer"
                />
              </th>
              <th className="nw text-[13px] font-semibold text-muted-foreground">발주번호</th>
              <th className="text-[13px] font-semibold text-muted-foreground">품목명</th>
              <th className="text-[13px] font-semibold text-muted-foreground">공급업체</th>
              <th className="text-[13px] font-semibold text-muted-foreground">구매일</th>
              <th className="num text-[13px] font-semibold text-muted-foreground">수량</th>
              <th className="num text-[13px] font-semibold text-muted-foreground">단가</th>
              <th className="num text-[13px] font-semibold text-muted-foreground">금액(KRW)</th>
              <th className="text-[13px] font-semibold text-muted-foreground">결제</th>
              <th className="nw text-[13px] font-semibold text-muted-foreground w-28">상태</th>
              <th className="ctr text-[13px] font-semibold text-muted-foreground w-20">전표</th>
              <th className="ctr text-[13px] font-semibold text-muted-foreground">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-muted-foreground">
                <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 구매 내역이 없습니다</p>
              </td></tr>
            ) : (() => {
              // 발주번호별 그룹화
              const groups = new Map<string, typeof filtered>();
              filtered.forEach(p => {
                const key = p.orderNo || '발주번호 없음';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(p);
              });
              return Array.from(groups.entries()).map(([orderNo, groupItems]) => {
                const isOpen = openGroups.has(orderNo);
                const totalKrw = groupItems.reduce((s, i) => s + i.amountKrw, 0);
                const unpurchased = groupItems.filter(i => i.purchaseStatus === '미발주').length;
                return (
                  <React.Fragment key={orderNo}>
                    {/* 그룹 헤더 */}
                    <tr
                      className="border-b border-border bg-[var(--fill-quaternary)] cursor-pointer hover:bg-[var(--fill-tertiary)]"
                      onClick={() => toggleGroup(orderNo)}
                    >
                      <td onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={groupItems.length > 0 && groupItems.every(i => selectedPurchaseIds.has(i.id))}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleGroupSelect(orderNo, groupItems);
                          }}
                          className="cursor-pointer"
                        />
                      </td>
                      <td colSpan={10} className="px-4 py-2.5">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-muted-foreground text-xs w-3">{isOpen ? '▼' : '▶'}</span>
                          <span className="font-mono font-semibold text-foreground">{orderNo}</span>
                          <span className="text-xs text-muted-foreground bg-[var(--fill-tertiary)] px-2 py-0.5 rounded-full">{groupItems.length}종</span>
                          {unpurchased > 0 && (
                            <span className="text-xs bg-[var(--system-orange)]/10 text-[var(--system-orange)] px-2 py-0.5 rounded-full">미구매 {unpurchased}건</span>
                          )}
                          <span className="ml-auto flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">공급가액 {formatKRW(totalKrw)}</span>
                            <span className="text-xs text-muted-foreground">+ 세액 {formatKRW(Math.round(totalKrw * 0.1))}</span>
                            <span className="text-xs font-semibold text-foreground">= {formatKRW(totalKrw + Math.round(totalKrw * 0.1))}</span>
                            {/* 전표 일괄발행 버튼 (작업 4) */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={async (e) => {
                                e.stopPropagation();
                                await handleGroupBulkExpense(orderNo, groupItems);
                              }}
                            >
                              전표 일괄발행
                            </Button>
                            {/* 일괄수정 버튼 (작업 6) */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                openBulkEditModal(orderNo, groupItems);
                              }}
                            >
                              일괄수정
                            </Button>
                            {/* 일괄삭제 버튼 (작업 5) */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-[var(--system-red)]"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm(`[${orderNo}] 발주의 자재 ${groupItems.length}종을 모두 삭제하시겠습니까?`)) return;
                                for (const item of groupItems) {
                                  await deletePurchaseItemSB(item.id);
                                }
                                refresh();
                                toast.success(`${groupItems.length}종 삭제 완료`);
                              }}
                            >
                              일괄삭제
                            </Button>
                            <div onClick={e => e.stopPropagation()}>
                              <Select onValueChange={(v) => handleGroupStatusChange(orderNo, groupItems, v)}>
                                <SelectTrigger className="w-28 h-7 text-xs" onClick={e => e.stopPropagation()}>
                                  <SelectValue placeholder="일괄변경" />
                                </SelectTrigger>
                                <SelectContent>
                                  {PURCHASE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </span>
                        </div>
                      </td>
                    </tr>
                    {/* 그룹 내 자재 행들 */}
                    {isOpen && groupItems.map(p => (
                      <tr key={p.id} className={`border-b border-border hover:bg-[var(--fill-quaternary)] ${selectedPurchaseIds.has(p.id) ? 'bg-primary/5' : ''}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedPurchaseIds.has(p.id)}
                            onChange={() => togglePurchaseSelect(p.id)}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="nw font-mono text-xs text-muted-foreground">{p.orderNo || '-'}</td>
                        <td className="font-medium text-foreground">{p.itemName}</td>
                        <td className="text-muted-foreground">{p.vendorName || '-'}</td>
                        <td className="text-muted-foreground">{p.purchaseDate}</td>
                        <td className="nw num font-mono">{formatNumber(p.qty)} {p.unit}</td>
                        <td className="nw num font-mono text-muted-foreground">{formatNumber(p.unitPriceCny, 2)} {p.currency}</td>
                        <td className="nw num font-mono font-semibold text-foreground">{formatKRW(p.amountKrw)}</td>
                        <td><Badge variant="outline" className="text-xs">{p.paymentMethod}</Badge></td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <Select value={p.purchaseStatus} onValueChange={v => handleStatusChange(p.id, v)}>
                              <SelectTrigger className={`h-7 text-xs w-24 border ${STATUS_COLOR[p.purchaseStatus]}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PURCHASE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </td>
                        <td className="ctr w-20">
                          {p.statementNo ? (
                            <span title="지출결의 연결됨" className="inline-flex justify-center text-[var(--system-green)]"><FileText className="w-4 h-4" /></span>
                          ) : (
                            <span title="지출결의 미생성" className="text-muted-foreground text-sm">—</span>
                          )}
                        </td>
                        <td className="ctr">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => openEdit(p)}>수정</Button>
                            {/* 지출전표 연결/생성/보기 버튼 (작업 2) */}
                            {p.statementNo ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2"
                                onClick={() => viewLinkedExpense(p.statementNo!)}
                              >
                                <FileText className="w-3.5 h-3.5 mr-1" />전표 보기
                              </Button>
                            ) : (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground hover:bg-[var(--fill-quaternary)]"
                                  >
                                    전표 ▾
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem
                                    className="text-xs cursor-pointer"
                                    onClick={() => openLinkExpenseModal(p.id)}
                                  >
                                    기존전표 연결
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-xs cursor-pointer"
                                    onClick={() => openExpenseModal(p)}
                                  >
                                    새전표 생성
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-[var(--system-red)]" onClick={() => handleDelete(p.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      {/* ── 구매 등록/수정 모달 ── */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? '구매 수정' : '구매 등록'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>발주번호 *</Label>
                <Select value={form.orderId || ''} onValueChange={handleOrderSelect}>
                  <SelectTrigger><SelectValue placeholder="발주 선택" /></SelectTrigger>
                  <SelectContent>
                    {(orders as any[]).filter(o => o.id && o.id.trim() !== '').map((o: any) => <SelectItem key={o.id} value={o.id}>{o.orderNo} — {o.styleName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>품목명 *</Label>
                <Input value={form.itemName || ''} onChange={e => setForm(f => ({ ...f, itemName: e.target.value }))} placeholder="예: 황동 버클 20mm" />
              </div>
              <div className="space-y-1.5">
                <Label>공급업체</Label>
                <Select value={form.vendorId || ''} onValueChange={vid => {
                  const v = vendors.find(x => x.id === vid);
                  setForm(f => ({ ...f, vendorId: v?.id, vendorName: v?.name }));
                }}>
                  <SelectTrigger><SelectValue placeholder="업체 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direct">직접 입력</SelectItem>
                    {vendors.filter((v: any) => v.id && v.id.trim() !== '').map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {!form.vendorId && (
                <div className="space-y-1.5">
                  <Label>업체명</Label>
                  <Input value={form.vendorName || ''} onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))} placeholder="업체명" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>구매일</Label>
                <Input type="date" value={form.purchaseDate || ''} onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>단위</Label>
                <Input value={form.unit || 'EA'} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="EA, m, kg" />
              </div>
              <div className="space-y-1.5">
                <Label>수량</Label>
                <Input type="number" min="0" value={form.qty || ''} onChange={e => updateAmount(parseInt(e.target.value) || 0, form.unitPriceCny || 0, form.currency || 'KRW')} />
              </div>
              <div className="space-y-1.5">
                <Label>통화</Label>
                <Select value={form.currency || 'KRW'} onValueChange={v => updateAmount(form.qty || 0, form.unitPriceCny || 0, v as Currency)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>단가</Label>
                <Input type="number" min="0" step="0.01" value={form.unitPriceCny || ''} onChange={e => updateAmount(form.qty || 0, parseFloat(e.target.value) || 0, form.currency || 'KRW')} />
              </div>
              <div className="space-y-1.5">
                <Label>KRW 금액 (자동)</Label>
                <div className="h-9 flex items-center px-3 bg-[var(--fill-quaternary)] rounded border border-border text-sm font-semibold text-foreground">
                  {formatKRW(form.amountKrw || 0)}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>결제 방법</Label>
                <Select value={form.paymentMethod || '법인카드'} onValueChange={v => setForm(f => ({ ...f, paymentMethod: v as ExpenseType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>상태</Label>
                <Select value={form.purchaseStatus || '미발주'} onValueChange={v => setForm(f => ({ ...f, purchaseStatus: v as PurchaseItem['purchaseStatus'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PURCHASE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>메모</Label>
                <Input value={form.memo || ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave}>{editId ? '수정' : '등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 자재 장바구니 모달 ── */}
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
              <p className="text-xs mt-1">생산발주 탭에서 발주 등록 시 자동으로 담깁니다</p>
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
                      <th className="num text-[13px] font-semibold text-muted-foreground">단가(CNY)</th>
                      <th className="num text-[13px] font-semibold text-muted-foreground">소요수량</th>
                      <th className="num text-[13px] font-semibold text-muted-foreground">보유재고</th>
                      <th className="num text-[13px] font-semibold text-muted-foreground">발주수량</th>
                      <th className="num text-[13px] font-semibold text-muted-foreground">금액(KRW)</th>
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
                      const unitPriceCny = item.unitPriceCny ?? 0;
                      const amountKrw = Math.round(orderQty * unitPriceCny * settings.cnyKrw);
                      return (
                      <tr key={idx} className="border-b border-border hover:bg-[var(--fill-quaternary)]">
                        <td className="font-medium text-foreground">{item.materialName}</td>
                        <td className="text-muted-foreground text-xs">{item.spec || '-'}</td>
                        <td className="ctr text-muted-foreground">{item.unit}</td>
                        <td className="nw num font-mono text-muted-foreground text-xs">
                          {unitPriceCny > 0 ? formatNumber(unitPriceCny, 2) : <span className="text-muted-foreground">-</span>}
                        </td>
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
                        <td className="nw num font-mono text-xs text-muted-foreground">
                          {amountKrw > 0 ? formatKRW(amountKrw) : <span className="text-muted-foreground">-</span>}
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

      {/* ── 거래처별 발주서 모달 ── */}
      <Dialog open={vendorOrderModal} onOpenChange={setVendorOrderModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-3xl sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="w-4 h-4" />
              거래처별 발주서
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
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
              const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
              if (grouped.size === 0) {
                return <p className="text-center text-muted-foreground py-8">발주가 필요한 자재가 없습니다 (보유재고로 충당 가능)</p>;
              }
              return Array.from(grouped.entries()).map(([vendor, items]) => (
                <div key={vendor} className="border border-border rounded-md overflow-hidden">
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
                  <div className="overflow-x-auto"><table className="data-table w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="ctr text-[13px] font-semibold text-muted-foreground w-8">No.</th>
                        <th className="ctr text-[13px] font-semibold text-muted-foreground w-10">이미지</th>
                        <th className="text-[13px] font-semibold text-muted-foreground">자재명</th>
                        <th className="text-[13px] font-semibold text-muted-foreground">규격</th>
                        <th className="nw ctr text-[13px] font-semibold text-muted-foreground">단위</th>
                        <th className="num text-[13px] font-semibold text-muted-foreground">단가(CNY)</th>
                        <th className="num text-[13px] font-semibold text-muted-foreground">소요수량</th>
                        <th className="num text-[13px] font-semibold text-muted-foreground">보유재고</th>
                        <th className="num text-[13px] font-semibold text-muted-foreground">발주수량</th>
                        <th className="num text-[13px] font-semibold text-muted-foreground">금액(KRW)</th>
                        <th className="text-[13px] font-semibold text-muted-foreground">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, i) => {
                        const unitPriceCny = item.unitPriceCny ?? 0;
                        const amountKrw = Math.round(item.orderQty * unitPriceCny * settings.cnyKrw);
                        return (
                        <tr key={i} className="border-b border-border">
                          <td className="ctr text-muted-foreground text-xs">{i + 1}</td>
                          <td className="ctr">
                            {item.imageUrl ? (
                              <img src={item.imageUrl} alt={item.materialName} className="w-14 h-14 object-cover rounded cursor-pointer border border-border hover:scale-110 transition-transform" onClick={() => window.open(item.imageUrl, '_blank')} />
                            ) : (
                              <Camera className="w-4 h-4 mx-auto text-muted-foreground" />
                            )}
                          </td>
                          <td className="font-medium text-foreground">{item.materialName}</td>
                          <td className="text-muted-foreground text-xs">{item.spec || '-'}</td>
                          <td className="ctr text-muted-foreground">{item.unit}</td>
                          <td className="nw num font-mono text-muted-foreground text-xs">
                            {unitPriceCny > 0 ? formatNumber(unitPriceCny, 2) : '-'}
                          </td>
                          <td className="nw num font-mono text-muted-foreground text-xs">
                            {item.qty % 1 === 0 ? item.qty.toLocaleString() : item.qty.toFixed(3)}
                          </td>
                          <td className="nw num font-mono text-muted-foreground text-xs">
                            {(item.stockQty ?? 0) % 1 === 0 ? (item.stockQty ?? 0).toLocaleString() : (item.stockQty ?? 0).toFixed(3)}
                          </td>
                          <td className="nw num font-mono font-semibold text-primary">
                            {item.orderQty % 1 === 0 ? item.orderQty.toLocaleString() : item.orderQty.toFixed(3)}
                          </td>
                          <td className="nw num font-mono text-xs text-muted-foreground">
                            {amountKrw > 0 ? formatKRW(amountKrw) : '-'}
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
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[var(--fill-quaternary)] border-t border-border">
                        <td colSpan={8} className="px-3 py-2 text-xs font-medium text-muted-foreground text-right">합계 {items.length}종</td>
                        <td className="num text-xs font-bold text-primary">
                          {items.reduce((s, i) => s + i.orderQty, 0).toFixed(0)}
                        </td>
                        <td className="num text-xs font-bold text-foreground">
                          {formatKRW(items.reduce((s, i) => s + Math.round(i.orderQty * (i.unitPriceCny ?? 0) * settings.cnyKrw), 0))}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table></div>
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
              {/* 이메일 발송 버튼 */}
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
                  // 정본: lib/confirmMaterialOrder.ts
                  // 예전엔 여기 사본에 1단계(Supabase materials 저장)와
                  // invalidateQueries(['materials'])가 통째로 빠져 있어서,
                  // 같은 버튼인데 생산발주 탭에서 누를 때와 결과가 달랐다.
                  try {
                    const r = await confirmMaterialOrder({
                      cartItems,
                      orders,
                      vendors: allVendors,
                      cnyKrw: settings.cnyKrw || 191,
                    });
                    queryClient.invalidateQueries({ queryKey: ['materials'] });
                    queryClient.invalidateQueries({ queryKey: ['purchaseItems'] });
                    refreshCart();
                    refresh();
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

      {/* ── 이메일 입력 모달 ── */}
      <Dialog open={emailInputModal} onOpenChange={setEmailInputModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full rounded-none sm:w-[95vw] sm:max-w-md sm:rounded-md">
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

      {/* ── 지출결의 생성 모달 ── */}
      <Dialog open={expenseModal} onOpenChange={setExpenseModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" />
              지출결의 생성 (자재)
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
                <div className="h-9 flex items-center px-3 bg-[var(--fill-quaternary)] rounded border border-border text-sm text-muted-foreground">
                  자재구매 (고정)
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>금액 (KRW) *</Label>
                <Input
                  type="number" min="0"
                  value={expenseForm.amountKrw || ''}
                  onChange={e => setExpenseForm(f => ({ ...f, amountKrw: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                />
                {expenseForm.amountKrw > 0 && (
                  <div className="text-right text-xs text-muted-foreground">{formatKRW(expenseForm.amountKrw)}</div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>결제 방법</Label>
                <Select value={expenseForm.expenseType} onValueChange={v => setExpenseForm(f => ({ ...f, expenseType: v as ExpenseType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
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
                <Label>거래처명</Label>
                <Input
                  value={expenseForm.vendorName}
                  onChange={e => setExpenseForm(f => ({ ...f, vendorName: e.target.value }))}
                  placeholder="거래처명"
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

            {/* 미리보기 */}
            <div className="bg-primary/5 border border-primary/20 rounded-md p-3 space-y-1">
              <p className="text-xs font-medium text-primary">전표 미리보기</p>
              <p className="text-xs text-muted-foreground">{expenseForm.description}</p>
              <p className="text-sm font-bold text-foreground">{formatKRW(expenseForm.amountKrw)}</p>
              <p className="text-xs text-muted-foreground">{expenseForm.expenseDate} · {expenseForm.expenseType} · {expenseForm.vendorName || '거래처 미지정'}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseModal(false)}>취소</Button>
            <Button onClick={handleSaveExpense} className="gap-2">
              <FileText className="w-4 h-4" />전표 저장
            </Button>
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
              value={linkSearchText}
              onChange={e => setLinkSearchText(e.target.value)}
              className="h-9 text-sm"
            />
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {phase1.getPayables()
                .filter(p => p.sourceType === 'purchase' || p.sourceType === 'manual')
                .filter(p => {
                  const q = linkSearchText.toLowerCase();
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
                    onClick={() => handleLinkExpense(p.id)}
                  >
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.memo || p.vendorName}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.dueDate} · {p.vendorName || '거래처 미지정'}
                        {p.orderNo ? ` · ${p.orderNo}` : ''}
                        {p.projectNo ? ` · ${p.projectNo}` : ''}
                      </p>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-sm font-semibold text-foreground">{formatKRW(p.amountKrw)}</p>
                      <span className="text-xs bg-[var(--fill-tertiary)] text-muted-foreground px-1.5 py-0.5 rounded">{p.status}</span>
                    </div>
                  </div>
                ))}
              {phase1.getPayables().filter(p => p.sourceType === 'purchase').length === 0 && (
                <p className="text-center py-8 text-muted-foreground text-sm">등록된 자재 지출결의가 없습니다</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkExpenseModal(false)}>취소</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 일괄수정 모달 (작업 6) ── */}
      <Dialog open={bulkEditModal} onOpenChange={setBulkEditModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>일괄수정 — [{bulkEditOrderNo}] {bulkEditItems.length}종</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-3">
              <Label className="text-xs whitespace-nowrap">구매일 (전체 적용)</Label>
              <Input
                type="date"
                value={bulkEditDate}
                onChange={e => setBulkEditDate(e.target.value)}
                className="h-8 w-48"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="data-table w-full min-w-[560px] text-xs border-collapse">
                <thead>
                  <tr className="bg-[var(--fill-quaternary)] text-[13px] font-semibold text-muted-foreground">
                    <th className="border border-border">품목명</th>
                    <th className="ctr border border-border w-20">수량</th>
                    <th className="ctr border border-border w-28">단가({bulkEditItems[0]?.currency || 'CNY'})</th>
                    <th className="num border border-border w-28">금액(KRW)</th>
                    <th className="nw ctr border border-border w-28">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkEditItems.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-[var(--fill-quaternary)]">
                      <td className="border border-border font-medium">{item.itemName}</td>
                      <td className="border border-border">
                        <input
                          type="number" min="0"
                          value={item.qty}
                          onChange={e => updateBulkItem(idx, 'qty', e.target.value)}
                          className="w-full text-center border border-border rounded px-1 py-0.5 text-xs"
                        />
                      </td>
                      <td className="border border-border">
                        <input
                          type="number" min="0"
                          value={item.unitPriceCny}
                          onChange={e => updateBulkItem(idx, 'unitPriceCny', e.target.value)}
                          className="w-full text-center border border-border rounded px-1 py-0.5 text-xs"
                          step="0.01"
                        />
                      </td>
                      <td className="border border-border num text-primary font-medium">
                        {formatKRW(item.amountKrw)}
                      </td>
                      <td className="border border-border">
                        <select
                          value={item.purchaseStatus}
                          onChange={e => updateBulkItem(idx, 'purchaseStatus', e.target.value)}
                          className="w-full border border-border rounded px-1 py-0.5 text-xs bg-card"
                        >
                          {PURCHASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-2 bg-primary/10 rounded-md text-xs text-primary">
              총 {bulkEditItems.length}종 · 합계 {formatKRW(bulkEditItems.reduce((s, i) => s + i.amountKrw, 0))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEditModal(false)}>취소</Button>
            <Button
              onClick={handleBulkEdit}
            >
              일괄 수정 저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 생성된 결의 바로보기 알림 */}
      <Dialog open={!!justCreatedPayable} onOpenChange={() => setJustCreatedPayable(null)}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-[var(--system-green)]" />
              지출결의가 생성되었습니다
            </DialogTitle>
          </DialogHeader>
          {justCreatedPayable && (
            <div className="space-y-3 py-2">
              <div className="bg-[var(--fill-quaternary)] rounded-md p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground text-xs">내용</span></p>
                <p className="font-medium text-foreground">{justCreatedPayable.memo}</p>
                <p className="text-muted-foreground">{justCreatedPayable.dueDate} · {justCreatedPayable.status}</p>
                {justCreatedPayable.vendorName && <p className="text-muted-foreground">거래처: {justCreatedPayable.vendorName}</p>}
                {justCreatedPayable.orderNo && <p className="text-muted-foreground">발주번호: {justCreatedPayable.orderNo}</p>}
                {justCreatedPayable.projectNo && <p className="text-muted-foreground">프로젝트: {justCreatedPayable.projectNo}</p>}
                <p className="font-bold text-primary text-base">{formatKRW(justCreatedPayable.amountKrw)}</p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setJustCreatedPayable(null)}>닫기</Button>
            <Button
              className="gap-1"
              onClick={() => {
                if (justCreatedPayable) {
                  setSelectedPayable(justCreatedPayable);
                  setJustCreatedPayable(null);
                }
              }}
            >
              <Eye className="w-4 h-4" />결의 보기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 지출결의 상세 */}
      {selectedPayable && (
        <Dialog open={!!selectedPayable} onOpenChange={() => setSelectedPayable(null)}>
          <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-md">
            <DialogHeader>
              <DialogTitle>지출결의 상세</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm py-2">
              <p className="font-medium">{selectedPayable.memo}</p>
              <p className="text-muted-foreground">거래처: {selectedPayable.vendorName}</p>
              <p className="text-muted-foreground">프로젝트: {selectedPayable.projectNo || '—'}</p>
              <p className="text-muted-foreground">발주: {selectedPayable.orderNo || '—'} · 품목: {selectedPayable.styleNo || '—'}</p>
              <p className="text-muted-foreground">상태: {selectedPayable.status} · 지급예정: {selectedPayable.dueDate}</p>
              <p className="font-bold text-lg">{formatKRW(selectedPayable.amountKrw)}</p>
              <p className="text-xs text-muted-foreground">결제·미지급 관리는 지출결의(/payables) 메뉴에서 진행합니다</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedPayable(null)}>닫기</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 구 지출전표 상세보기 (레거시) */}
      {selectedExpense && (
        <ExpenseDetailInlineModal
          expense={selectedExpense}
          onClose={() => setSelectedExpense(null)}
          onSaved={() => { refresh(); setSelectedExpense(null); }}
        />
      )}
    </div>
  );
}

// 지출전표 상세 인라인 모달
function ExpenseDetailInlineModal({
  expense,
  onClose,
  onSaved,
}: {
  expense: Expense;
  onClose: () => void;
  onSaved: () => void;
}) {
  const getInitialLines = (e: Expense): ExpenseLine[] => {
    if (e.lines && e.lines.length > 0) return [...e.lines];
    return [{
      id: genId(),
      description: e.description,
      qty: 1,
      unit: '개',
      unitPrice: e.amountKrw,
      amountKrw: e.amountKrw,
    }];
  };

  const [detailLines, setDetailLines] = React.useState<ExpenseLine[]>(() => getInitialLines(expense));

  const updateDetailLine = (id: string, field: keyof ExpenseLine, value: string | number) => {
    setDetailLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, [field]: value };
      if (field === 'qty' || field === 'unitPrice') {
        updated.amountKrw = updated.qty * updated.unitPrice;
      }
      if (field === 'amountKrw') updated.amountKrw = Number(value);
      return updated;
    }));
  };

  const addDetailLine = () => setDetailLines(prev => [...prev, { id: genId(), description: '', qty: 1, unit: '개', unitPrice: 0, amountKrw: 0 }]);
  const removeDetailLine = (id: string) => {
    if (detailLines.length <= 1) { toast.error('항목은 최소 1개 이상이어야 합니다'); return; }
    setDetailLines(prev => prev.filter(l => l.id !== id));
  };

  const detailTotal = detailLines.reduce((s, l) => s + l.amountKrw, 0);
  const supplyAmount = Math.round(detailTotal / 1.1);
  const taxAmount = detailTotal - supplyAmount;
  const expenseNo = `EXP-${expense.expenseDate.replace(/-/g, '')}-${expense.id.slice(-3).toUpperCase()}`;

  const handleSave = () => {
    if (detailLines.some(l => !l.description)) { toast.error('품목명을 모두 입력해주세요'); return; }
    store.updateExpense(expense.id, { lines: detailLines, description: detailLines[0].description, amountKrw: detailTotal });
    toast.success('전표가 수정되었습니다');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            지출전표 상세
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm bg-[var(--fill-quaternary)] rounded-md p-3">
            <div>
              <span className="text-muted-foreground text-xs">전표번호</span>
              <p className="font-mono font-bold text-primary">{expenseNo}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">발주번호</span>
              <p className="font-medium text-foreground">{expense.orderNo || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">거래처</span>
              <p className="font-medium text-foreground">{expense.vendorName || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">결제방법</span>
              <p className="font-medium text-foreground">{expense.expenseType}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">카테고리</span>
              <p className="font-medium text-foreground">{expense.category}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">날짜</span>
              <p className="font-medium text-foreground">{expense.expenseDate}</p>
            </div>
          </div>

          <div className="border border-border rounded-md overflow-hidden">
            <div className="bg-[var(--fill-quaternary)] px-4 py-2 flex items-center justify-between border-b border-border">
              <p className="text-xs font-medium text-muted-foreground">품목/내역</p>
              <Button size="sm" variant="outline" onClick={addDetailLine} className="h-7 text-xs gap-1">
                <Plus className="w-3.5 h-3.5" />항목 추가
              </Button>
            </div>
            <div className="overflow-x-auto"><table className="data-table w-full min-w-[560px] text-sm">
              <thead>
                <tr className="bg-[var(--fill-quaternary)] border-b border-border">
                  <th className="text-[13px] font-semibold text-muted-foreground">품목/내역</th>
                  <th className="num text-[13px] font-semibold text-muted-foreground w-16">수량</th>
                  <th className="nw ctr text-[13px] font-semibold text-muted-foreground w-14">단위</th>
                  <th className="num text-[13px] font-semibold text-muted-foreground w-24">단가</th>
                  <th className="num text-[13px] font-semibold text-muted-foreground w-24">금액</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {detailLines.map((line) => (
                  <tr key={line.id} className="border-b border-border">
                    <td>
                      <input
                        value={line.description}
                        onChange={e => updateDetailLine(line.id, 'description', e.target.value)}
                        placeholder="품목명"
                        className="h-8 text-sm border border-border rounded px-2 w-full"
                      />
                    </td>
                    <td>
                      <input
                        type="number" min="0"
                        value={line.qty}
                        onChange={e => updateDetailLine(line.id, 'qty', parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm text-right border border-border rounded px-2 w-16"
                        min={0}
                      />
                    </td>
                    <td>
                      <input
                        value={line.unit}
                        onChange={e => updateDetailLine(line.id, 'unit', e.target.value)}
                        className="h-8 text-sm text-center border border-border rounded px-2 w-14"
                        placeholder="개"
                      />
                    </td>
                    <td>
                      <input
                        type="number" min="0"
                        value={line.unitPrice}
                        onChange={e => updateDetailLine(line.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm text-right border border-border rounded px-2 w-24"
                        min={0}
                      />
                    </td>
                    <td className="num text-sm font-medium text-foreground">
                      {formatKRW(line.amountKrw)}
                    </td>
                    <td>
                      <button
                        className="text-muted-foreground hover:text-[var(--system-red)]"
                        onClick={() => removeDetailLine(line.id)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>

          <div className="bg-[var(--fill-quaternary)] rounded-md p-3 space-y-1.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>공급가액</span>
              <span className="font-mono">{formatKRW(supplyAmount)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>세액 (10%)</span>
              <span className="font-mono">{formatKRW(taxAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-foreground text-base pt-1 border-t border-border">
              <span>합계</span>
              <span className="font-mono text-primary">{formatKRW(detailTotal)}</span>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>닫기</Button>
          <Button onClick={handleSave}>
            수정 저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
