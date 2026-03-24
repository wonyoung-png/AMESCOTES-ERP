// AMESCOTES ERP — 자재 구매 매칭
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPurchaseItems, upsertPurchaseItem, deletePurchaseItem as deletePurchaseItemSB,
  updatePurchaseItemStatus, fetchOrders, upsertOrder,
} from '@/lib/supabaseQueries';
import {
  store, genId, formatKRW, formatNumber,
  type PurchaseItem, type Currency, type ExpenseType, type Expense, type ExpenseCategory,
  type ExpenseLine, type CartItem,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Trash2, ShoppingCart, FileText, Receipt, Printer, X, Mail, Eye } from 'lucide-react';

const CURRENCIES: Currency[] = ['KRW', 'USD', 'CNY'];
const PAYMENT_METHODS: ExpenseType[] = ['법인카드', '계좌이체', '현금'];
const PURCHASE_STATUSES = ['미발주', '발주완료', '입고완료', '발송완료'] as const;

const STATUS_COLOR: Record<string, string> = {
  '미발주': 'bg-stone-50 text-stone-500 border-stone-200',
  '발주완료': 'bg-blue-50 text-blue-700 border-blue-200',
  '입고완료': 'bg-amber-50 text-amber-700 border-amber-200',
  '발송완료': 'bg-green-50 text-green-700 border-green-200',
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
  const orders = store.getOrders();
  const vendors = store.getVendors().filter(v => v.type === '자재거래처');
  const allVendors = store.getVendors();
  const settings = store.getSettings();
  const [filterOrder, setFilterOrder] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
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
              upsertOrder({ ...localOrder, status: '생산중', updatedAt: new Date().toISOString() }).catch(() => {});
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

  // 지출전표 모달 상태
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(DEFAULT_EXPENSE_FORM);
  // 지출전표 상세보기 모달
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  // 생성된 전표 (바로보기용)
  const [justCreatedExpense, setJustCreatedExpense] = useState<Expense | null>(null);

  // 기존전표 연결 모달 상태 (작업 2)
  const [linkExpenseModal, setLinkExpenseModal] = useState(false);
  const [linkTargetItemId, setLinkTargetItemId] = useState<string | null>(null);
  const [linkSearchText, setLinkSearchText] = useState('');

  // 자재 장바구니 모달 상태
  const [cartModal, setCartModal] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>(() => store.getMaterialCart());
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
            toast.success(`✅ 생산발주 [${item.orderNo}] → 생산중으로 자동 변경됐어요`);
          } else {
            const localOrder = store.getOrders().find(o => o.orderNo === item.orderNo);
            if (localOrder && localOrder.status === '발주생성') {
              store.updateOrder(localOrder.id, { status: '생산중' });
              upsertOrder({ ...localOrder, status: '생산중', updatedAt: new Date().toISOString() }).catch(() => {});
              toast.success(`✅ 생산발주 [${item.orderNo}] → 생산중으로 변경됐어요`);
            }
          }
        } catch {
          const localOrder = store.getOrders().find(o => o.orderNo === item.orderNo);
          if (localOrder) {
            store.updateOrder(localOrder.id, { status: '생산중' });
            toast.success(`✅ 생산발주 [${item.orderNo}] → 생산중으로 변경됐어요`);
          }
        }
      }
    }

    refresh();
  };

  // ── 지출전표 생성 ──────────────────────────────────────────
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

  const handleSaveExpense = async () => {
    if (!expenseForm.description) { toast.error('내용을 입력해주세요'); return; }
    if (!expenseForm.amountKrw) { toast.error('금액을 입력해주세요'); return; }

    const expenseId = genId();
    // 자재구매 항목을 lines로 자동 구성 (작업 1)
    const item = purchases.find(p => p.id === expenseForm.purchaseItemId);
    const expenseLines = item ? [{
      id: genId(),
      description: item.itemName,
      qty: item.qty,
      unit: item.unit,
      unitPrice: item.amountKrw && item.qty ? Math.round(item.amountKrw / item.qty) : 0,
      amountKrw: item.amountKrw || expenseForm.amountKrw,
    }] : undefined;

    const expense: Expense = {
      id: expenseId,
      expenseDate: expenseForm.expenseDate,
      expenseType: expenseForm.expenseType,
      category: expenseForm.category,
      lines: expenseLines,
      description: expenseForm.description,
      amountKrw: expenseForm.amountKrw,
      orderId: expenseForm.orderId || undefined,
      orderNo: expenseForm.orderNo || undefined,
      vendorName: expenseForm.vendorName || undefined,
      hasTaxInvoice: expenseForm.hasTaxInvoice,
      memo: expenseForm.memo || undefined,
      createdAt: new Date().toISOString(),
    };

    store.addExpense(expense);

    // PurchaseItem의 statementNo에 expenseId 연결 (Supabase)
    await upsertPurchaseItem({
      ...purchases.find(p => p.id === expenseForm.purchaseItemId),
      id: expenseForm.purchaseItemId,
      statementNo: expenseId,
    });

    toast.success('지출전표가 생성되었습니다');
    refresh();
    setExpenseModal(false);
    setJustCreatedExpense(expense);
  };

  const viewLinkedExpense = (statementNo: string) => {
    const expenses = store.getExpenses();
    const expense = expenses.find(e => e.id === statementNo);
    if (!expense) { toast.error('연결된 전표를 찾을 수 없습니다'); return; }
    setSelectedExpense(expense);
  };

  // ── 기존전표 연결 (작업 2) ──────────────────────────────────
  const openLinkExpenseModal = (itemId: string) => {
    setLinkTargetItemId(itemId);
    setLinkSearchText('');
    setLinkExpenseModal(true);
  };

  const handleLinkExpense = async (expenseId: string) => {
    if (!linkTargetItemId) return;
    const item = purchases.find(p => p.id === linkTargetItemId);
    if (item) {
      await upsertPurchaseItem({ ...item, statementNo: expenseId });
    }
    toast.success('기존 지출전표가 연결되었습니다');
    refresh();
    setLinkExpenseModal(false);
    setLinkTargetItemId(null);
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
      if (resp.ok) { toast.success(`📧 ${vendor} 발주서를 ${email}로 발송했습니다`); return; }
    } catch { /* API 없음 */ }
    const gogCmd = `gog gmail send --to "${email}" --subject "${subject}" --body "${body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}" --account info@atlm.kr`;
    try {
      await navigator.clipboard.writeText(gogCmd);
      toast.success(`📋 ${vendor} 발주서 이메일 명령어가 클립보드에 복사됐습니다!\n터미널에 붙여넣기해서 실행하세요`);
    } catch {
      toast.info(`📧 ${vendor} 발주서\n수신: ${email}\n수동으로 gog 명령어를 실행해주세요`);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">자재 구매</h1>
          <p className="text-sm text-stone-500 mt-0.5">발주번호 매칭 · 본사제공 자재 구매 이력 관리</p>
        </div>
        <div className="flex gap-2">
          {/* 자재 장바구니 버튼 */}
          <button
            onClick={() => { refreshCart(); setCartModal(true); }}
            className="relative px-3 py-2 rounded-lg border border-blue-300 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors flex items-center gap-1.5"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            자재 장바구니
            {cartItems.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                {cartItems.length}
              </span>
            )}
          </button>
          <Button onClick={openNew} className="bg-amber-700 hover:bg-amber-800 text-white gap-2">
            <Plus className="w-4 h-4" />구매 등록
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 구매건', value: `${stats.total}건`, color: 'text-stone-800' },
          { label: '미발주', value: `${stats.unpurchased}건`, color: 'text-amber-700' },
          { label: '총 구매금액', value: formatKRW(stats.totalKrw), color: 'text-stone-800' },
          { label: '전표 연결됨', value: `${stats.linked}건`, color: 'text-emerald-700' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-stone-200 p-4">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-stone-500 mt-0.5">{s.label}</p>
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

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="w-10 px-3 py-3">
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
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">발주번호</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">품목명</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">공급업체</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">구매일</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">단가</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">금액(KRW)</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">결제</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500 w-28">상태</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500 w-20">전표</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-stone-400">
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
                      className="border-b border-stone-200 bg-stone-50 cursor-pointer hover:bg-amber-50/30"
                      onClick={() => toggleGroup(orderNo)}
                    >
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
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
                          <span className="text-stone-400 text-xs w-3">{isOpen ? '▼' : '▶'}</span>
                          <span className="font-mono font-semibold text-stone-700">{orderNo}</span>
                          <span className="text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">{groupItems.length}종</span>
                          {unpurchased > 0 && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">미구매 {unpurchased}건</span>
                          )}
                          <span className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-stone-500">공급가액 {formatKRW(totalKrw)}</span>
                            <span className="text-xs text-stone-400">+ 세액 {formatKRW(Math.round(totalKrw * 0.1))}</span>
                            <span className="text-xs font-semibold text-stone-700">= {formatKRW(totalKrw + Math.round(totalKrw * 0.1))}</span>
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
                      <tr key={p.id} className={`border-b border-stone-50 hover:bg-stone-50/50 ${selectedPurchaseIds.has(p.id) ? 'bg-amber-50/60' : ''}`}>
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedPurchaseIds.has(p.id)}
                            onChange={() => togglePurchaseSelect(p.id)}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-stone-500">{p.orderNo || '-'}</td>
                        <td className="px-4 py-3 font-medium text-stone-800">{p.itemName}</td>
                        <td className="px-4 py-3 text-stone-600">{p.vendorName || '-'}</td>
                        <td className="px-4 py-3 text-stone-600">{p.purchaseDate}</td>
                        <td className="px-4 py-3 text-right font-mono">{formatNumber(p.qty)} {p.unit}</td>
                        <td className="px-4 py-3 text-right font-mono text-stone-600">{formatNumber(p.unitPriceCny, 2)} {p.currency}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-stone-800">{formatKRW(p.amountKrw)}</td>
                        <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{p.paymentMethod}</Badge></td>
                        <td className="px-4 py-3">
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
                        <td className="px-3 py-3 text-center w-20">
                          {p.statementNo ? (
                            <span title="지출전표 연결됨" className="text-emerald-600 text-sm">📄</span>
                          ) : (
                            <span title="지출전표 미생성" className="text-stone-300 text-sm">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => openEdit(p)}>수정</Button>
                            {/* 지출전표 연결/생성/보기 버튼 (작업 2) */}
                            {p.statementNo ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                onClick={() => viewLinkedExpense(p.statementNo!)}
                              >
                                <FileText className="w-3.5 h-3.5 mr-1" />📄 전표 보기
                              </Button>
                            ) : (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2 text-stone-600 hover:text-stone-800 hover:bg-stone-100"
                                  >
                                    📋 전표 ▾
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem
                                    className="text-xs cursor-pointer"
                                    onClick={() => openLinkExpenseModal(p.id)}
                                  >
                                    📄 기존전표 연결
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-xs cursor-pointer"
                                    onClick={() => openExpenseModal(p)}
                                  >
                                    🧾 새전표 생성
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(p.id)}>
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
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? '구매 수정' : '구매 등록'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>발주번호 *</Label>
                <Select value={form.orderId || ''} onValueChange={handleOrderSelect}>
                  <SelectTrigger><SelectValue placeholder="발주 선택" /></SelectTrigger>
                  <SelectContent>
                    {orders.map(o => <SelectItem key={o.id} value={o.id}>{o.orderNo} — {o.styleName}</SelectItem>)}
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
                    <SelectItem value="">직접 입력</SelectItem>
                    {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
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
                <Input type="number" value={form.qty || ''} onChange={e => updateAmount(parseInt(e.target.value) || 0, form.unitPriceCny || 0, form.currency || 'KRW')} />
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
                <Input type="number" step="0.01" value={form.unitPriceCny || ''} onChange={e => updateAmount(form.qty || 0, parseFloat(e.target.value) || 0, form.currency || 'KRW')} />
              </div>
              <div className="space-y-1.5">
                <Label>KRW 금액 (자동)</Label>
                <div className="h-9 flex items-center px-3 bg-stone-50 rounded border border-stone-200 text-sm font-semibold text-stone-700">
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
            <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">{editId ? '수정' : '등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 자재 장바구니 모달 ── */}
      <Dialog open={cartModal} onOpenChange={setCartModal}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-4xl sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-blue-700" />
              자재 통합 발주 장바구니
              {cartItems.length > 0 && (
                <span className="ml-1 text-sm font-normal text-stone-500">({cartItems.length}종)</span>
              )}
            </DialogTitle>
          </DialogHeader>
          {cartItems.length === 0 ? (
            <div className="py-12 text-center text-stone-400">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">장바구니가 비어 있습니다</p>
              <p className="text-xs mt-1">생산발주 탭에서 발주 등록 시 자동으로 담깁니다</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50">
                      <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">자재명</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">규격</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">단위</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">단가(CNY)</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">소요수량</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">보유재고</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">발주수량</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">금액(KRW)</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">담긴 발주</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">구매처</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">삭제</th>
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
                      <tr key={idx} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="px-3 py-2 font-medium text-stone-800">{item.materialName}</td>
                        <td className="px-3 py-2 text-stone-500 text-xs">{item.spec || '-'}</td>
                        <td className="px-3 py-2 text-center text-stone-600">{item.unit}</td>
                        <td className="px-3 py-2 text-right font-mono text-stone-600 text-xs">
                          {unitPriceCny > 0 ? formatNumber(unitPriceCny, 2) : <span className="text-stone-300">-</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-stone-600 text-sm">
                          {item.qty % 1 === 0 ? item.qty.toLocaleString() : item.qty.toFixed(3)}
                        </td>
                        <td className="px-3 py-2 text-right">
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
                            className="w-20 h-7 text-right font-mono text-sm border border-stone-200 rounded px-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
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
                                ? 'border-green-300 text-green-700 bg-green-50 focus:ring-green-300'
                                : 'border-amber-300 text-amber-700 bg-amber-50 focus:ring-amber-300'
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-stone-600">
                          {amountKrw > 0 ? formatKRW(amountKrw) : <span className="text-stone-300">-</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-500">
                          {item.orders.map((o, i) => (
                            <span key={i}>
                              {i > 0 && <span className="mx-1 text-stone-300">+</span>}
                              <span className="text-stone-600 font-medium">{o.styleNo}</span>
                              <span className="text-stone-400">({o.qty % 1 === 0 ? o.qty.toLocaleString() : o.qty.toFixed(3)})</span>
                            </span>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-500">{item.vendorName || <span className="text-stone-300">-</span>}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            className="text-stone-300 hover:text-red-500 transition-colors"
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
              <p className="text-xs text-stone-400">💡 보유재고 입력 시 발주수량이 자동으로 차감됩니다. 발주수량도 직접 조정 가능합니다.</p>
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap">
            {cartItems.length > 0 && (
              <>
                <Button
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
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
                  className="bg-blue-700 hover:bg-blue-800 text-white"
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
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-3xl sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
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
                return <p className="text-center text-stone-400 py-8">발주가 필요한 자재가 없습니다 (보유재고로 충당 가능)</p>;
              }
              return Array.from(grouped.entries()).map(([vendor, items]) => (
                <div key={vendor} className="border border-stone-200 rounded-lg overflow-hidden">
                  <div className="bg-stone-800 text-white px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-base">{vendor === '미지정' ? '구매처 미지정' : vendor}</p>
                      <p className="text-xs text-stone-300 mt-0.5">발주일: {today} · {items.length}종</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-stone-800 border-stone-200 bg-white hover:bg-stone-100"
                      onClick={() => window.print()}
                    >
                      <Printer className="w-3 h-3 mr-1" />인쇄
                    </Button>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-stone-50 border-b border-stone-200">
                        <th className="text-center px-3 py-2 text-xs font-medium text-stone-500 w-8">No.</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-stone-500 w-10">이미지</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">자재명</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">규격</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">단위</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">단가(CNY)</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">소요수량</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">보유재고</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">발주수량</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">금액(KRW)</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, i) => {
                        const unitPriceCny = item.unitPriceCny ?? 0;
                        const amountKrw = Math.round(item.orderQty * unitPriceCny * settings.cnyKrw);
                        return (
                        <tr key={i} className="border-b border-stone-100">
                          <td className="px-3 py-2 text-center text-stone-400 text-xs">{i + 1}</td>
                          <td className="px-2 py-1 text-center">
                            {item.imageUrl ? (
                              <img src={item.imageUrl} alt={item.materialName} className="w-14 h-14 object-cover rounded cursor-pointer border border-stone-200 hover:scale-110 transition-transform" onClick={() => window.open(item.imageUrl, '_blank')} />
                            ) : (
                              <span className="text-stone-300 text-base">📷</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-medium text-stone-800">{item.materialName}</td>
                          <td className="px-3 py-2 text-stone-500 text-xs">{item.spec || '-'}</td>
                          <td className="px-3 py-2 text-center text-stone-600">{item.unit}</td>
                          <td className="px-3 py-2 text-right font-mono text-stone-600 text-xs">
                            {unitPriceCny > 0 ? formatNumber(unitPriceCny, 2) : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-stone-500 text-xs">
                            {item.qty % 1 === 0 ? item.qty.toLocaleString() : item.qty.toFixed(3)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-stone-500 text-xs">
                            {(item.stockQty ?? 0) % 1 === 0 ? (item.stockQty ?? 0).toLocaleString() : (item.stockQty ?? 0).toFixed(3)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700">
                            {item.orderQty % 1 === 0 ? item.orderQty.toLocaleString() : item.orderQty.toFixed(3)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-stone-600">
                            {amountKrw > 0 ? formatKRW(amountKrw) : '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-stone-400">
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
                      <tr className="bg-stone-50 border-t border-stone-200">
                        <td colSpan={8} className="px-3 py-2 text-xs font-medium text-stone-600 text-right">합계 {items.length}종</td>
                        <td className="px-3 py-2 text-right text-xs font-bold text-amber-700">
                          {items.reduce((s, i) => s + i.orderQty, 0).toFixed(0)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-bold text-stone-700">
                          {formatKRW(items.reduce((s, i) => s + Math.round(i.orderQty * (i.unitPriceCny ?? 0) * settings.cnyKrw), 0))}
                        </td>
                        <td className="px-3 py-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                  <div className="px-4 py-3 border-t border-stone-100 grid grid-cols-3 gap-4 text-xs text-stone-500">
                    <div>발주담당: ___________</div>
                    <div>확인: ___________</div>
                    <div>수령: ___________</div>
                  </div>
                </div>
              ));
            })()}
            {cartItems.length === 0 && (
              <p className="text-center text-stone-400 py-8">장바구니에 담긴 자재가 없습니다</p>
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
                      className="h-8 text-xs text-blue-700 border-blue-300 hover:bg-blue-50"
                      onClick={handleSendEmail}
                    >
                      <Mail className="w-3.5 h-3.5 mr-1" />📧 {vendor} 이메일
                    </Button>
                  );
                });
              })()}
              {/* 발주 확정 버튼 */}
              <Button
                className="h-8 text-xs bg-green-700 hover:bg-green-800 text-white"
                onClick={async () => {
                  const today = new Date().toISOString().split('T')[0];
                  let savedCount = 0;
                  // 중복 방지: Supabase에서 기존 항목 조회
                  const existingItems = await fetchPurchaseItems();
                  for (const item of cartItems) {
                    const stockQty = item.stockQty ?? 0;
                    const orderQty = Math.max(0, item.qty - stockQty);
                    if (orderQty === 0) continue;
                    const vendor = item.vendorName || '미지정';
                    const unitPriceCny = item.unitPriceCny ?? 0;
                    const amountKrw = Math.round(orderQty * unitPriceCny * settings.cnyKrw);
                    // 발주별로 구매 이력 저장 (발주번호별로 분리)
                    const orderNos = [...new Set(item.orders.map(o => o.styleNo))];
                    for (const styleNo of orderNos) {
                      const matchOrder = orders.find(o => o.styleNo === styleNo);
                      const currentOrderNo = matchOrder?.orderNo || styleNo;
                      // 중복 방지
                      const existingKeys = new Set(
                        existingItems
                          .filter(p => p.orderNo === currentOrderNo)
                          .map(p => p.itemName + '||' + p.unit)
                      );
                      const key = item.materialName + '||' + item.unit;
                      if (existingKeys.has(key)) continue;
                      await upsertPurchaseItem({
                        id: genId(),
                        orderId: matchOrder?.id || '',
                        orderNo: currentOrderNo,
                        purchaseDate: today,
                        itemName: item.materialName,
                        qty: orderQty,
                        unit: item.unit,
                        unitPriceCny: unitPriceCny,
                        currency: 'CNY',
                        appliedRate: settings.cnyKrw || 191,
                        amountKrw: amountKrw,
                        vendorName: vendor,
                        paymentMethod: '기타',
                        purchaseStatus: '미발주',
                        createdAt: new Date().toISOString(),
                      });
                      savedCount++;
                    }
                  }
                  store.clearMaterialCart();
                  refreshCart();
                  refresh();
                  toast.success(`✅ ${savedCount}건이 자재구매 목록에 저장되었습니다`);
                  setVendorOrderModal(false);
                }}
              >
                ✅ 발주 확정
              </Button>
              <Button variant="outline" onClick={() => setVendorOrderModal(false)}>닫기</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 이메일 입력 모달 ── */}
      <Dialog open={emailInputModal} onOpenChange={setEmailInputModal}>
        <DialogContent className="w-full rounded-none sm:w-[95vw] sm:max-w-sm sm:rounded-lg">
          <DialogHeader>
            <DialogTitle>이메일 주소 입력</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-stone-600">
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
              className="bg-blue-700 hover:bg-blue-800 text-white"
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

      {/* ── 지출전표 생성 모달 ── */}
      <Dialog open={expenseModal} onOpenChange={setExpenseModal}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-amber-700" />
              지출전표 생성
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
                <div className="h-9 flex items-center px-3 bg-stone-50 rounded border border-stone-200 text-sm text-stone-600">
                  자재구매 (고정)
                </div>
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
                    {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>발주번호</Label>
                <div className="h-9 flex items-center px-3 bg-stone-50 rounded border border-stone-200 text-sm font-mono text-stone-600">
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
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
              <p className="text-xs font-medium text-amber-800">전표 미리보기</p>
              <p className="text-xs text-amber-700">{expenseForm.description}</p>
              <p className="text-sm font-bold text-amber-900">{formatKRW(expenseForm.amountKrw)}</p>
              <p className="text-xs text-amber-600">{expenseForm.expenseDate} · {expenseForm.expenseType} · {expenseForm.vendorName || '거래처 미지정'}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseModal(false)}>취소</Button>
            <Button onClick={handleSaveExpense} className="bg-amber-700 hover:bg-amber-800 text-white gap-2">
              <FileText className="w-4 h-4" />전표 저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 기존전표 연결 모달 (작업 2) ── */}
      <Dialog open={linkExpenseModal} onOpenChange={setLinkExpenseModal}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              📄 기존 지출전표 연결
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="전표 검색 (내용, 거래처, 발주번호)"
              value={linkSearchText}
              onChange={e => setLinkSearchText(e.target.value)}
              className="h-9 text-sm"
            />
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {store.getExpenses()
                .filter(e => {
                  const q = linkSearchText.toLowerCase();
                  return !q || e.description.toLowerCase().includes(q) || (e.vendorName || '').toLowerCase().includes(q) || (e.orderNo || '').toLowerCase().includes(q);
                })
                .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate))
                .map(e => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between p-3 border border-stone-200 rounded-lg hover:bg-stone-50 cursor-pointer"
                    onClick={() => handleLinkExpense(e.id)}
                  >
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{e.description}</p>
                      <p className="text-xs text-stone-500">{e.expenseDate} · {e.expenseType} · {e.vendorName || '거래처 미지정'} {e.orderNo ? `· ${e.orderNo}` : ''}</p>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-sm font-semibold text-stone-800">{formatKRW(e.amountKrw)}</p>
                      <span className="text-xs bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">{e.category}</span>
                    </div>
                  </div>
                ))}
              {store.getExpenses().length === 0 && (
                <p className="text-center py-8 text-stone-400 text-sm">등록된 지출전표가 없습니다</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkExpenseModal(false)}>취소</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 생성된 전표 바로보기 알림 */}
      <Dialog open={!!justCreatedExpense} onOpenChange={() => setJustCreatedExpense(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-green-600" />
              지출전표가 생성되었습니다
            </DialogTitle>
          </DialogHeader>
          {justCreatedExpense && (
            <div className="space-y-3 py-2">
              <div className="bg-stone-50 rounded-lg p-3 text-sm space-y-1">
                <p><span className="text-stone-500 text-xs">내용</span></p>
                <p className="font-medium text-stone-800">{justCreatedExpense.description}</p>
                <p className="text-stone-600">{justCreatedExpense.expenseDate} · {justCreatedExpense.expenseType}</p>
                {justCreatedExpense.vendorName && <p className="text-stone-600">거래처: {justCreatedExpense.vendorName}</p>}
                {justCreatedExpense.orderNo && <p className="text-stone-600">발주번호: {justCreatedExpense.orderNo}</p>}
                <p className="font-bold text-amber-700 text-base">{formatKRW(justCreatedExpense.amountKrw)}</p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setJustCreatedExpense(null)}>닫기</Button>
            <Button
              className="bg-amber-700 hover:bg-amber-800 text-white gap-1"
              onClick={() => {
                if (justCreatedExpense) {
                  setSelectedExpense(justCreatedExpense);
                  setJustCreatedExpense(null);
                }
              }}
            >
              <Eye className="w-4 h-4" />전표 보기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 지출전표 상세보기 모달 (인라인) */}
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-700" />
            지출전표 상세
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm bg-stone-50 rounded-lg p-3">
            <div>
              <span className="text-stone-500 text-xs">전표번호</span>
              <p className="font-mono font-bold text-amber-700">{expenseNo}</p>
            </div>
            <div>
              <span className="text-stone-500 text-xs">발주번호</span>
              <p className="font-medium text-stone-800">{expense.orderNo || '-'}</p>
            </div>
            <div>
              <span className="text-stone-500 text-xs">거래처</span>
              <p className="font-medium text-stone-800">{expense.vendorName || '-'}</p>
            </div>
            <div>
              <span className="text-stone-500 text-xs">결제방법</span>
              <p className="font-medium text-stone-800">{expense.expenseType}</p>
            </div>
            <div>
              <span className="text-stone-500 text-xs">카테고리</span>
              <p className="font-medium text-stone-800">{expense.category}</p>
            </div>
            <div>
              <span className="text-stone-500 text-xs">날짜</span>
              <p className="font-medium text-stone-800">{expense.expenseDate}</p>
            </div>
          </div>

          <div className="border border-stone-200 rounded-lg overflow-hidden">
            <div className="bg-stone-50 px-4 py-2 flex items-center justify-between border-b border-stone-200">
              <p className="text-xs font-medium text-stone-600">품목/내역</p>
              <Button size="sm" variant="outline" onClick={addDetailLine} className="h-7 text-xs gap-1">
                <Plus className="w-3.5 h-3.5" />항목 추가
              </Button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">품목/내역</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-stone-500 w-16">수량</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-stone-500 w-14">단위</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-stone-500 w-24">단가</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-stone-500 w-24">금액</th>
                  <th className="w-8 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {detailLines.map((line) => (
                  <tr key={line.id} className="border-b border-stone-50">
                    <td className="px-2 py-1.5">
                      <input
                        value={line.description}
                        onChange={e => updateDetailLine(line.id, 'description', e.target.value)}
                        placeholder="품목명"
                        className="h-8 text-sm border border-stone-200 rounded px-2 w-full"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        value={line.qty}
                        onChange={e => updateDetailLine(line.id, 'qty', parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm text-right border border-stone-200 rounded px-2 w-16"
                        min={0}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={line.unit}
                        onChange={e => updateDetailLine(line.id, 'unit', e.target.value)}
                        className="h-8 text-sm text-center border border-stone-200 rounded px-2 w-14"
                        placeholder="개"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        value={line.unitPrice}
                        onChange={e => updateDetailLine(line.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm text-right border border-stone-200 rounded px-2 w-24"
                        min={0}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right text-sm font-medium text-stone-700">
                      {formatKRW(line.amountKrw)}
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        className="text-stone-400 hover:text-red-500"
                        onClick={() => removeDetailLine(line.id)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-amber-50 rounded-lg p-3 space-y-1.5 text-sm">
            <div className="flex justify-between text-stone-600">
              <span>공급가액</span>
              <span className="font-mono">{formatKRW(supplyAmount)}</span>
            </div>
            <div className="flex justify-between text-stone-600">
              <span>세액 (10%)</span>
              <span className="font-mono">{formatKRW(taxAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-stone-800 text-base pt-1 border-t border-amber-200">
              <span>합계</span>
              <span className="font-mono text-amber-900">{formatKRW(detailTotal)}</span>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>닫기</Button>
          <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">
            수정 저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
