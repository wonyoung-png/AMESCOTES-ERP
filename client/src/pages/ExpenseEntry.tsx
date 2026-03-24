// AMESCOTES ERP — 지출 전표 (거래명세표 방식: 여러 항목 입력)
import { useState, useMemo } from 'react';
import {
  store, genId, formatKRW, formatNumber,
  type Expense, type ExpenseLine, type ExpenseType, type ExpenseCategory,
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

const EMPTY_HEADER = {
  expenseDate: new Date().toISOString().split('T')[0],
  expenseType: '' as ExpenseType | '',
  category: '' as ExpenseCategory | '',
  orderNo: '',
  vendorName: '',
  hasTaxInvoice: false,
  taxInvoiceNo: '',
  supplyAmount: '',
  taxAmount: '',
  taxInvoiceDate: '',
  memo: '',
};

const newLine = (): ExpenseLine => ({
  id: genId(),
  description: '',
  qty: 1,
  unit: '개',
  unitPrice: 0,
  amountKrw: 0,
});

export default function ExpenseEntry() {
  const [expenses, setExpenses] = useState<Expense[]>(() => store.getExpenses());
  const [showModal, setShowModal] = useState(false);
  const [header, setHeader] = useState({ ...EMPTY_HEADER });
  const [lines, setLines] = useState<ExpenseLine[]>([newLine()]);
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

  const linesTotal = useMemo(() => lines.reduce((s, l) => s + l.amountKrw, 0), [lines]);

  const updateLine = (id: string, field: keyof ExpenseLine, value: string | number) => {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, [field]: value };
      if (field === 'qty' || field === 'unitPrice') {
        updated.amountKrw = updated.qty * updated.unitPrice;
      }
      if (field === 'amountKrw') {
        updated.amountKrw = Number(value);
      }
      return updated;
    }));
  };

  const addLine = () => setLines(prev => [...prev, newLine()]);
  const removeLine = (id: string) => {
    if (lines.length <= 1) { toast.error('항목은 최소 1개 이상이어야 합니다'); return; }
    setLines(prev => prev.filter(l => l.id !== id));
  };

  const handleSave = () => {
    if (!header.expenseDate || !header.expenseType || !header.category) {
      toast.error('날짜, 결제방법, 카테고리는 필수입니다');
      return;
    }
    if (lines.some(l => !l.description)) {
      toast.error('품목명을 모두 입력해주세요');
      return;
    }
    if (linesTotal <= 0) {
      toast.error('금액을 입력해주세요');
      return;
    }
    const expense: Expense = {
      id: genId(),
      expenseDate: header.expenseDate,
      expenseType: header.expenseType as ExpenseType,
      category: header.category as ExpenseCategory,
      lines,
      description: lines[0].description,
      amountKrw: linesTotal,
      orderNo: header.orderNo || undefined,
      vendorName: header.vendorName || undefined,
      hasTaxInvoice: header.hasTaxInvoice,
      taxInvoiceNo: header.hasTaxInvoice ? header.taxInvoiceNo || undefined : undefined,
      supplyAmount: header.hasTaxInvoice && header.supplyAmount ? parseInt(header.supplyAmount) : undefined,
      taxAmount: header.hasTaxInvoice && header.taxAmount ? parseInt(header.taxAmount) : undefined,
      taxInvoiceDate: header.hasTaxInvoice ? header.taxInvoiceDate || undefined : undefined,
      memo: header.memo || undefined,
      createdAt: new Date().toISOString(),
    };
    store.addExpense(expense);
    refresh();
    setShowModal(false);
    setHeader({ ...EMPTY_HEADER });
    setLines([newLine()]);
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
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">항목수</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">발주번호</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">거래처</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">세금계산서</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">금액</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-stone-400 text-sm">등록된 전표가 없습니다</td></tr>
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
                  <td className="px-4 py-3 text-center">
                    {e.lines && e.lines.length > 0
                      ? <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">{e.lines.length}항목</span>
                      : <span className="text-xs text-stone-400">-</span>}
                  </td>
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

      {/* 전표 등록 모달 */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>지출 전표 등록</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* 헤더 정보 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>날짜 *</Label>
                <Input type="date" value={header.expenseDate} onChange={e => setHeader(f => ({ ...f, expenseDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>결제 방법 *</Label>
                <Select value={header.expenseType} onValueChange={v => setHeader(f => ({ ...f, expenseType: v as ExpenseType }))}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>{EXPENSE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>카테고리 *</Label>
                <Select value={header.category} onValueChange={v => setHeader(f => ({ ...f, category: v as ExpenseCategory }))}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>{EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>발주번호</Label>
                <Input value={header.orderNo} onChange={e => setHeader(f => ({ ...f, orderNo: e.target.value }))} placeholder="AME-26SS-001" />
              </div>
              <div className="space-y-1.5">
                <Label>거래처명</Label>
                <Input value={header.vendorName} onChange={e => setHeader(f => ({ ...f, vendorName: e.target.value }))} placeholder="다산" />
              </div>
              <div className="space-y-1.5">
                <Label>메모</Label>
                <Input value={header.memo} onChange={e => setHeader(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
              </div>
            </div>

            {/* 항목 테이블 */}
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <div className="bg-stone-50 px-4 py-2 flex items-center justify-between border-b border-stone-200">
                <p className="text-xs font-medium text-stone-600">항목 명세</p>
                <Button size="sm" variant="outline" onClick={addLine} className="h-7 text-xs gap-1">
                  <Plus className="w-3.5 h-3.5" />항목 추가
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100">
                    <th className="text-left px-3 py-2 text-xs font-medium text-stone-500 w-1/3">품목명</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-stone-500 w-16">수량</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-stone-500 w-16">단위</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-stone-500 w-28">단가(KRW)</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-stone-500 w-28">금액</th>
                    <th className="w-8 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={line.id} className="border-b border-stone-50">
                      <td className="px-2 py-1.5">
                        <Input
                          value={line.description}
                          onChange={e => updateLine(line.id, 'description', e.target.value)}
                          placeholder={`품목 ${idx + 1}`}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          value={line.qty}
                          onChange={e => updateLine(line.id, 'qty', parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm text-right"
                          min={0}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={line.unit}
                          onChange={e => updateLine(line.id, 'unit', e.target.value)}
                          className="h-8 text-sm text-center"
                          placeholder="개"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          value={line.unitPrice}
                          onChange={e => updateLine(line.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm text-right"
                          min={0}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right text-sm font-medium text-stone-700">
                        {formatKRW(line.amountKrw)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => removeLine(line.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-amber-50 border-t border-amber-200">
                    <td colSpan={4} className="px-3 py-2 text-right text-sm font-medium text-amber-800">합계</td>
                    <td className="px-3 py-2 text-right text-base font-bold text-amber-900">{formatKRW(linesTotal)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* 세금계산서 */}
            <div className="border border-stone-200 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">세금계산서</Label>
                <Switch checked={header.hasTaxInvoice} onCheckedChange={v => setHeader(f => ({ ...f, hasTaxInvoice: v }))} />
              </div>
              {header.hasTaxInvoice && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">세금계산서 번호</Label>
                      <Input value={header.taxInvoiceNo} onChange={e => setHeader(f => ({ ...f, taxInvoiceNo: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">발행일</Label>
                      <Input type="date" value={header.taxInvoiceDate} onChange={e => setHeader(f => ({ ...f, taxInvoiceDate: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">공급가액</Label>
                      <Input type="number" value={header.supplyAmount} onChange={e => setHeader(f => ({ ...f, supplyAmount: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">세액</Label>
                      <Input type="number" value={header.taxAmount} onChange={e => setHeader(f => ({ ...f, taxAmount: e.target.value }))} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowModal(false); setHeader({ ...EMPTY_HEADER }); setLines([newLine()]); }}>취소</Button>
            <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
