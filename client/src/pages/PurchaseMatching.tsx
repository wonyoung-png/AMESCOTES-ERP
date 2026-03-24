// AMESCOTES ERP — 자재 구매 매칭
import React, { useState, useMemo } from 'react';
import {
  store, genId, formatKRW, formatNumber,
  type PurchaseItem, type Currency, type ExpenseType, type Expense, type ExpenseCategory,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Trash2, ShoppingCart, FileText, Receipt } from 'lucide-react';

const CURRENCIES: Currency[] = ['KRW', 'USD', 'CNY'];
const PAYMENT_METHODS: ExpenseType[] = ['법인카드', '계좌이체', '현금'];
const PURCHASE_STATUSES = ['미구매', '구매완료', '발송완료'] as const;

const STATUS_COLOR: Record<string, string> = {
  '미구매': 'bg-stone-50 text-stone-500 border-stone-200',
  '구매완료': 'bg-blue-50 text-blue-700 border-blue-200',
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
  const [purchases, setPurchases] = useState<PurchaseItem[]>(() => store.getPurchaseItems());
  const orders = store.getOrders();
  const vendors = store.getVendors().filter(v => v.type === '자재거래처');
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
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Partial<PurchaseItem>>({});
  const [editId, setEditId] = useState<string | null>(null);

  // 지출전표 모달 상태
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(DEFAULT_EXPENSE_FORM);

  const refresh = () => setPurchases(store.getPurchaseItems());

  const filtered = useMemo(() => {
    let list = purchases;
    if (filterOrder !== 'all') list = list.filter(p => p.orderId === filterOrder);
    if (filterStatus !== 'all') list = list.filter(p => p.purchaseStatus === filterStatus);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [purchases, filterOrder, filterStatus]);

  const stats = useMemo(() => {
    const unpurchased = purchases.filter(p => p.purchaseStatus === '미구매').length;
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
      appliedRate: 1, purchaseStatus: '미구매', paymentMethod: '법인카드',
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

  const handleSave = () => {
    if (!form.orderId) { toast.error('발주번호를 선택해주세요'); return; }
    if (!form.itemName) { toast.error('품목명을 입력해주세요'); return; }
    if (editId) {
      store.updatePurchaseItem(editId, form as Partial<PurchaseItem>);
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
        purchaseStatus: form.purchaseStatus || '미구매',
        paymentMethod: form.paymentMethod || '법인카드',
        statementNo: form.statementNo,
        memo: form.memo,
        createdAt: new Date().toISOString(),
      };
      store.addPurchaseItem(p);
      toast.success('구매 내역이 등록되었습니다');
    }
    refresh();
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    store.deletePurchaseItem(id);
    refresh();
    toast.success('삭제되었습니다');
  };

  const handleStatusChange = (id: string, status: string) => {
    store.updatePurchaseItem(id, { purchaseStatus: status as PurchaseItem['purchaseStatus'] });
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

  const handleSaveExpense = () => {
    if (!expenseForm.description) { toast.error('내용을 입력해주세요'); return; }
    if (!expenseForm.amountKrw) { toast.error('금액을 입력해주세요'); return; }

    const expenseId = genId();
    const expense: Expense = {
      id: expenseId,
      expenseDate: expenseForm.expenseDate,
      expenseType: expenseForm.expenseType,
      category: expenseForm.category,
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

    // PurchaseItem의 statementNo에 expenseId 연결
    store.updatePurchaseItem(expenseForm.purchaseItemId, { statementNo: expenseId });

    toast.success('지출전표가 생성되었습니다');
    refresh();
    setExpenseModal(false);
  };

  const viewLinkedExpense = (statementNo: string) => {
    const expenses = store.getExpenses();
    const expense = expenses.find(e => e.id === statementNo);
    if (!expense) { toast.error('연결된 전표를 찾을 수 없습니다'); return; }
    toast.info(`전표: ${expense.description} / ${formatKRW(expense.amountKrw)} / ${expense.expenseDate}`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">자재 구매</h1>
          <p className="text-sm text-stone-500 mt-0.5">발주번호 매칭 · 본사제공 자재 구매 이력 관리</p>
        </div>
        <Button onClick={openNew} className="bg-amber-700 hover:bg-amber-800 text-white gap-2">
          <Plus className="w-4 h-4" />구매 등록
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 구매건', value: `${stats.total}건`, color: 'text-stone-800' },
          { label: '미구매', value: `${stats.unpurchased}건`, color: 'text-amber-700' },
          { label: '총 구매금액', value: formatKRW(stats.totalKrw), color: 'text-stone-800' },
          { label: '전표 연결됨', value: `${stats.linked}건`, color: 'text-emerald-700' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-stone-200 p-4">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-stone-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-28 h-9"><SelectValue placeholder="상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {PURCHASE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">품목명</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">공급업체</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">구매일</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">단가</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">금액(KRW)</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">결제</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">상태 / 전표</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-stone-400">
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
                const unpurchased = groupItems.filter(i => i.purchaseStatus === '미구매').length;
                return (
                  <React.Fragment key={orderNo}>
                    {/* 그룹 헤더 */}
                    <tr
                      className="border-b border-stone-200 bg-stone-50 cursor-pointer hover:bg-amber-50/30"
                      onClick={() => toggleGroup(orderNo)}
                    >
                      <td colSpan={9} className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <span className="text-stone-400 text-xs w-3">{isOpen ? '▼' : '▶'}</span>
                          <span className="font-mono font-semibold text-stone-700">{orderNo}</span>
                          <span className="text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">{groupItems.length}종</span>
                          {unpurchased > 0 && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">미구매 {unpurchased}건</span>
                          )}
                          <span className="text-xs text-stone-500 ml-auto">{formatKRW(totalKrw)}</span>
                        </div>
                      </td>
                    </tr>
                    {/* 그룹 내 자재 행들 */}
                    {isOpen && groupItems.map(p => (
                      <tr key={p.id} className="border-b border-stone-50 hover:bg-stone-50/50">
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
                            {/* 지출전표 연결 여부 아이콘 */}
                            {p.statementNo ? (
                              <span title="지출전표 연결됨" className="text-emerald-600 text-sm">📄</span>
                            ) : (
                              <span title="지출전표 미생성" className="text-stone-300 text-sm">➕</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => openEdit(p)}>수정</Button>
                            {/* 지출전표 생성 / 전표 보기 버튼 */}
                            {p.statementNo ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                onClick={() => viewLinkedExpense(p.statementNo!)}
                                title="연결된 지출전표 보기"
                              >
                                <FileText className="w-3.5 h-3.5 mr-1" />전표
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2 text-amber-700 hover:text-amber-800 hover:bg-amber-50"
                                onClick={() => openExpenseModal(p)}
                                title="지출전표 생성"
                              >
                                <Receipt className="w-3.5 h-3.5 mr-1" />전표생성
                              </Button>
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
                <Select value={form.purchaseStatus || '미구매'} onValueChange={v => setForm(f => ({ ...f, purchaseStatus: v as PurchaseItem['purchaseStatus'] }))}>
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
    </div>
  );
}
