// AMESCOTES ERP — 지출 전표
// 법인카드/계좌이체/현금 지출 기록 + 세금계산서 정보
import { useState, useMemo } from 'react';
import {
  store, genId, formatKRW,
  type Expense, type ExpenseType, type ExpenseCategory,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus, Trash2, CreditCard, Banknote, Building2, FileText } from 'lucide-react';

const EXPENSE_TYPES: ExpenseType[] = ['법인카드', '계좌이체', '현금'];
const EXPENSE_CATEGORIES: ExpenseCategory[] = ['자재구매', '물류비', '샘플비', '임가공비', '기타제조원가', '판관비', '기타'];

const TYPE_ICON: Record<ExpenseType, React.ReactNode> = {
  '법인카드': <CreditCard className="w-3.5 h-3.5" />,
  '계좌이체': <Building2 className="w-3.5 h-3.5" />,
  '현금': <Banknote className="w-3.5 h-3.5" />,
};

const TYPE_COLOR: Record<ExpenseType, string> = {
  '법인카드': 'bg-blue-50 text-blue-700 border-blue-200',
  '계좌이체': 'bg-green-50 text-green-700 border-green-200',
  '현금': 'bg-stone-50 text-stone-700 border-stone-200',
};

const EMPTY_FORM = {
  expenseDate: new Date().toISOString().split('T')[0],
  expenseType: '' as ExpenseType | '',
  category: '' as ExpenseCategory | '',
  description: '',
  amountKrw: '',
  orderNo: '',
  vendorName: '',
  hasTaxInvoice: false,
  taxInvoiceNo: '',
  supplyAmount: '',
  taxAmount: '',
  taxInvoiceDate: '',
  memo: '',
};

export default function ExpenseEntry() {
  const [expenses, setExpenses] = useState<Expense[]>(() => store.getExpenses());
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [filterType, setFilterType] = useState<string>('all');
  const [filterCat, setFilterCat] = useState<string>('all');

  const refresh = () => setExpenses(store.getExpenses());

  const totalAmount = useMemo(() => expenses.reduce((s, e) => s + e.amountKrw, 0), [expenses]);

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenses) {
      map[e.expenseType] = (map[e.expenseType] || 0) + e.amountKrw;
    }
    return map;
  }, [expenses]);

  const filtered = useMemo(() => {
    let list = expenses;
    if (filterType !== 'all') list = list.filter(e => e.expenseType === filterType);
    if (filterCat !== 'all') list = list.filter(e => e.category === filterCat);
    return list.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  }, [expenses, filterType, filterCat]);

  const handleSave = () => {
    if (!form.expenseDate || !form.expenseType || !form.category || !form.description || !form.amountKrw) {
      toast.error('필수 항목을 입력해주세요');
      return;
    }
    const amount = parseInt(form.amountKrw.replace(/,/g, ''));
    const expense: Expense = {
      id: genId(),
      expenseDate: form.expenseDate,
      expenseType: form.expenseType as ExpenseType,
      category: form.category as ExpenseCategory,
      description: form.description,
      amountKrw: amount,
      orderNo: form.orderNo || undefined,
      vendorName: form.vendorName || undefined,
      hasTaxInvoice: form.hasTaxInvoice,
      taxInvoiceNo: form.hasTaxInvoice ? form.taxInvoiceNo || undefined : undefined,
      supplyAmount: form.hasTaxInvoice && form.supplyAmount ? parseInt(form.supplyAmount) : undefined,
      taxAmount: form.hasTaxInvoice && form.taxAmount ? parseInt(form.taxAmount) : undefined,
      taxInvoiceDate: form.hasTaxInvoice ? form.taxInvoiceDate || undefined : undefined,
      memo: form.memo || undefined,
      createdAt: new Date().toISOString(),
    };
    store.addExpense(expense);
    refresh();
    setShowModal(false);
    setForm({ ...EMPTY_FORM });
    toast.success('지출 전표가 등록되었습니다');
  };

  const handleDelete = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    store.deleteExpense(id);
    refresh();
    toast.success('삭제되었습니다');
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">지출 전표</h1>
          <p className="text-sm text-stone-500 mt-0.5">법인카드 / 계좌이체 / 현금 지출 기록</p>
        </div>
        <Button onClick={() => setShowModal(true)} className="bg-amber-700 hover:bg-amber-800 text-white gap-2">
          <Plus className="w-4 h-4" />전표 등록
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xs text-stone-500 mb-1">총 지출</p>
          <p className="text-lg font-bold text-stone-800">{formatKRW(totalAmount)}</p>
          <p className="text-xs text-stone-400 mt-1">{expenses.length}건</p>
        </div>
        {EXPENSE_TYPES.map(t => (
          <div key={t} className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-stone-500">{TYPE_ICON[t]}</span>
              <p className="text-xs text-stone-500">{t}</p>
            </div>
            <p className="text-lg font-bold text-stone-800">{formatKRW(byType[t] || 0)}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-stone-200">
        <div className="flex items-center gap-3 p-4 border-b border-stone-100">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="결제 방법" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              {EXPENSE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="카테고리" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 카테고리</SelectItem>
              {EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">날짜</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">결제</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">카테고리</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">내용</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">발주번호</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">거래처</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">세금계산서</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">금액</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-stone-400 text-sm">등록된 전표가 없습니다</td></tr>
              ) : filtered.map(e => (
                <tr key={e.id} className="border-b border-stone-50 hover:bg-stone-50/50">
                  <td className="px-4 py-3 text-stone-600">{e.expenseDate}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-xs gap-1 ${TYPE_COLOR[e.expenseType]}`}>
                      {TYPE_ICON[e.expenseType]}{e.expenseType}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full">{e.category}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-stone-800">{e.description}</td>
                  <td className="px-4 py-3 text-stone-500 text-xs">{e.orderNo || '-'}</td>
                  <td className="px-4 py-3 text-stone-500 text-xs">{e.vendorName || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {e.hasTaxInvoice
                      ? <FileText className="w-4 h-4 text-green-600 mx-auto" />
                      : <span className="text-stone-300 text-xs">-</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-stone-800">{formatKRW(e.amountKrw)}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(e.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>지출 전표 등록</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>날짜 *</Label>
                <Input type="date" value={form.expenseDate} onChange={e => setForm(f => ({ ...f, expenseDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>결제 방법 *</Label>
                <Select value={form.expenseType} onValueChange={v => setForm(f => ({ ...f, expenseType: v as ExpenseType }))}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>{EXPENSE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>카테고리 *</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as ExpenseCategory }))}>
                <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>{EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>내용 *</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="지출 내용" />
            </div>
            <div className="space-y-1.5">
              <Label>금액 (KRW) *</Label>
              <Input type="number" value={form.amountKrw} onChange={e => setForm(f => ({ ...f, amountKrw: e.target.value }))} placeholder="0" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>발주번호</Label>
                <Input value={form.orderNo} onChange={e => setForm(f => ({ ...f, orderNo: e.target.value }))} placeholder="AME-26SS-001" />
              </div>
              <div className="space-y-1.5">
                <Label>거래처명</Label>
                <Input value={form.vendorName} onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))} placeholder="다산" />
              </div>
            </div>
            <div className="border border-stone-200 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">세금계산서</Label>
                <Switch checked={form.hasTaxInvoice} onCheckedChange={v => setForm(f => ({ ...f, hasTaxInvoice: v }))} />
              </div>
              {form.hasTaxInvoice && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">세금계산서 번호</Label>
                      <Input value={form.taxInvoiceNo} onChange={e => setForm(f => ({ ...f, taxInvoiceNo: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">발행일</Label>
                      <Input type="date" value={form.taxInvoiceDate} onChange={e => setForm(f => ({ ...f, taxInvoiceDate: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">공급가액</Label>
                      <Input type="number" value={form.supplyAmount} onChange={e => setForm(f => ({ ...f, supplyAmount: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">세액</Label>
                      <Input type="number" value={form.taxAmount} onChange={e => setForm(f => ({ ...f, taxAmount: e.target.value }))} />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>메모</Label>
              <Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
