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
import { Plus, Trash2, CreditCard, Banknote, Building2, FileText, Eye, Printer } from 'lucide-react';

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

// description 파싱: "[생산발주] AT2603HB01-R12 — 체인백 222PCS" 형식
function parseDescription(desc: string): { styleNo: string; itemName: string; qty: number; unit: string } {
  const match = desc.match(/\[생산발주\]\s*(\S+)\s*[—\-]+\s*(.+?)\s*(\d+)PCS/);
  if (match) {
    return { styleNo: match[1], itemName: match[2].trim(), qty: parseInt(match[3]), unit: 'PCS' };
  }
  return { styleNo: '', itemName: desc, qty: 1, unit: '' };
}

// 지출전표 상세 모달 컴포넌트
function ExpenseDetailModal({
  expense,
  onClose,
  onSaved,
  onPrintTradeStatement,
}: {
  expense: Expense;
  onClose: () => void;
  onSaved: () => void;
  onPrintTradeStatement: (expense: Expense) => void;
}) {
  const getInitialLines = (e: Expense): ExpenseLine[] => {
    if (e.lines && e.lines.length > 0) return [...e.lines];
    // lines 없는 기존 전표: description/amountKrw를 첫 번째 line으로 변환
    const parsed = parseDescription(e.description);
    return [{
      id: genId(),
      description: e.description,
      qty: parsed.qty,
      unit: parsed.unit || '개',
      unitPrice: parsed.qty > 1 ? Math.round(e.amountKrw / parsed.qty) : e.amountKrw,
      amountKrw: e.amountKrw,
    }];
  };

  const [detailLines, setDetailLines] = useState<ExpenseLine[]>(() => getInitialLines(expense));

  const updateDetailLine = (id: string, field: keyof ExpenseLine, value: string | number) => {
    setDetailLines(prev => prev.map(l => {
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

  const addDetailLine = () => setDetailLines(prev => [...prev, newLine()]);
  const removeDetailLine = (id: string) => {
    if (detailLines.length <= 1) { toast.error('항목은 최소 1개 이상이어야 합니다'); return; }
    setDetailLines(prev => prev.filter(l => l.id !== id));
  };

  const detailTotal = useMemo(() => detailLines.reduce((s, l) => s + l.amountKrw, 0), [detailLines]);
  const supplyAmount = Math.round(detailTotal / 1.1);
  const taxAmount = detailTotal - supplyAmount;

  const handleDetailSave = () => {
    if (detailLines.some(l => !l.description)) {
      toast.error('품목명을 모두 입력해주세요');
      return;
    }
    store.updateExpense(expense.id, {
      lines: detailLines,
      description: detailLines[0].description,
      amountKrw: detailTotal,
    });
    onSaved();
    toast.success('전표가 수정되었습니다');
    onClose();
  };

  // 전표번호 생성 (간단 포맷)
  const expenseNo = `EXP-${expense.expenseDate.replace(/-/g, '')}-${expense.id.slice(-3).toUpperCase()}`;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-700" />
            지출전표 상세
          </DialogTitle>
        </DialogHeader>

        {/* 헤더 정보 */}
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
              <span className="text-stone-500 text-xs">카테고리</span>
              <p className="font-medium text-stone-800">{expense.category}</p>
            </div>
            <div>
              <span className="text-stone-500 text-xs">결제방법</span>
              <p className="font-medium text-stone-800">{expense.expenseType}</p>
            </div>
            <div>
              <span className="text-stone-500 text-xs">날짜</span>
              <p className="font-medium text-stone-800">{expense.expenseDate}</p>
            </div>
          </div>

          {/* 품목 테이블 - 편집 가능 */}
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
                  <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">스타일번호</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">품명</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-stone-500 w-16">수량</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-stone-500 w-14">단위</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-stone-500 w-24">단가(원)</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-stone-500 w-24">금액(원)</th>
                  <th className="w-8 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {detailLines.map((line) => {
                  const parsed = parseDescription(line.description);
                  const styleNo = parsed.styleNo;
                  const itemName = parsed.styleNo ? parsed.itemName : line.description;
                  return (
                    <tr key={line.id} className="border-b border-stone-50">
                      <td className="px-2 py-1.5">
                        <Input
                          value={styleNo}
                          onChange={e => {
                            const newStyleNo = e.target.value;
                            const newDesc = newStyleNo
                              ? `[생산발주] ${newStyleNo} — ${itemName} ${line.qty}PCS`
                              : itemName;
                            updateDetailLine(line.id, 'description', newDesc);
                          }}
                          placeholder="스타일번호"
                          className="h-8 text-sm font-mono w-32"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={itemName}
                          onChange={e => {
                            const newItemName = e.target.value;
                            const newDesc = styleNo
                              ? `[생산발주] ${styleNo} — ${newItemName} ${line.qty}PCS`
                              : newItemName;
                            updateDetailLine(line.id, 'description', newDesc);
                          }}
                          placeholder="품명"
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          value={line.qty}
                          onChange={e => {
                            const newQty = parseFloat(e.target.value) || 0;
                            updateDetailLine(line.id, 'qty', newQty);
                            if (styleNo) {
                              const newDesc = `[생산발주] ${styleNo} — ${itemName} ${newQty}PCS`;
                              updateDetailLine(line.id, 'description', newDesc);
                            }
                          }}
                          className="h-8 text-sm text-right w-16"
                          min={0}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={line.unit}
                          onChange={e => updateDetailLine(line.id, 'unit', e.target.value)}
                          className="h-8 text-sm text-center w-14"
                          placeholder="PCS"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="space-y-0.5">
                          <Input
                            type="number"
                            value={line.unitPrice}
                            onChange={e => updateDetailLine(line.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                            className="h-8 text-sm text-right w-24"
                            min={0}
                          />
                          {line.unitPrice > 0 && (
                            <div className="text-right text-[10px] text-stone-400">{formatKRW(line.unitPrice)}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right text-sm font-medium text-stone-700">
                        {formatKRW(line.amountKrw)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-stone-400 hover:text-red-500"
                          onClick={() => removeDetailLine(line.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 합계 */}
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
          <Button
            variant="outline"
            className="gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
            onClick={() => onPrintTradeStatement(expense)}
          >
            <Printer className="w-4 h-4" />거래명세표 출력
          </Button>
          <Button onClick={handleDetailSave} className="bg-amber-700 hover:bg-amber-800 text-white">
            수정 저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 거래명세표 출력 (지출전표 기반)
function printExpenseTradeStatement(expense: Expense) {
  const printWin = window.open('', '_blank', 'width=800,height=900');
  if (!printWin) { toast.error('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.'); return; }

  const lines = expense.lines && expense.lines.length > 0
    ? expense.lines
    : [{ id: '', description: expense.description, qty: 1, unit: '식', unitPrice: expense.amountKrw, amountKrw: expense.amountKrw }];

  const total = lines.reduce((s, l) => s + l.amountKrw, 0);
  const supplyAmount = Math.round(total / 1.1);
  const taxAmount = total - supplyAmount;

  const rows = lines.map(l => `
    <tr>
      <td>${l.description}</td>
      <td style="text-align:center">${l.qty}</td>
      <td style="text-align:center">${l.unit}</td>
      <td style="text-align:right">${l.unitPrice.toLocaleString()}</td>
      <td style="text-align:right">${l.amountKrw.toLocaleString()}</td>
    </tr>
  `).join('');

  const expenseNo = `EXP-${expense.expenseDate.replace(/-/g, '')}-${expense.id.slice(-3).toUpperCase()}`;

  printWin.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>거래명세표 ${expenseNo}</title>
      <style>
        body { font-family: 'Malgun Gothic', sans-serif; font-size: 12px; padding: 20px; }
        h2 { text-align: center; font-size: 20px; margin-bottom: 20px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
        .info-box { border: 1px solid #ddd; padding: 10px; border-radius: 4px; }
        .info-box h4 { margin: 0 0 8px; font-size: 11px; color: #666; }
        .info-box p { margin: 2px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 11px; }
        th { background: #f5f5f5; text-align: center; }
        .total-section { margin-top: 16px; text-align: right; }
        .total-section table { width: 300px; margin-left: auto; }
        @media print { body { margin: 0; } }
      </style>
    </head>
    <body>
      <h2>거래명세표 (지출전표)</h2>
      <div style="text-align:right; margin-bottom:8px; color:#666; font-size:11px;">
        전표번호: <strong>${expenseNo}</strong> &nbsp;|&nbsp; 날짜: ${expense.expenseDate}
      </div>
      <div class="info-grid">
        <div class="info-box">
          <h4>공급자</h4>
          <p><strong>(주)아메스코테스</strong></p>
          <p>사업자번호: 343-88-01791</p>
          <p>대표자: 이원영</p>
        </div>
        <div class="info-box">
          <h4>공급받는자 (거래처)</h4>
          <p><strong>${expense.vendorName || '-'}</strong></p>
          <p>발주번호: ${expense.orderNo || '-'}</p>
          <p>결제방법: ${expense.expenseType}</p>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>품목/내역</th>
            <th>수량</th>
            <th>단위</th>
            <th>단가</th>
            <th>금액</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <div class="total-section">
        <table>
          <tr><td>공급가액</td><td style="text-align:right">${supplyAmount.toLocaleString()}원</td></tr>
          <tr><td>세액(10%)</td><td style="text-align:right">${taxAmount.toLocaleString()}원</td></tr>
          <tr style="font-weight:bold;background:#fef3c7"><td>합계</td><td style="text-align:right">${total.toLocaleString()}원</td></tr>
        </table>
      </div>
      <script>window.onload = function() { window.print(); };</script>
    </body>
    </html>
  `);
  printWin.document.close();
}

export default function ExpenseEntry() {
  const [expenses, setExpenses] = useState<Expense[]>(() => store.getExpenses());
  const [showModal, setShowModal] = useState(false);
  const [header, setHeader] = useState({ ...EMPTY_HEADER });
  const [lines, setLines] = useState<ExpenseLine[]>([newLine()]);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterCat, setFilterCat] = useState<string>('all');

  // 상세보기 모달 상태
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);

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
                <tr
                  key={e.id}
                  className="border-b border-stone-50 hover:bg-stone-50/50 cursor-pointer"
                  onClick={() => setDetailExpense(e)}
                >
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
                  <td className="px-4 py-3" onClick={ev => ev.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-amber-700 hover:text-amber-900"
                        onClick={() => setDetailExpense(e)}
                        title="상세보기"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(e.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 전표 상세 모달 */}
      {detailExpense && (
        <ExpenseDetailModal
          expense={detailExpense}
          onClose={() => setDetailExpense(null)}
          onSaved={() => { refresh(); setDetailExpense(null); }}
          onPrintTradeStatement={printExpenseTradeStatement}
        />
      )}

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
                        <div className="space-y-0.5">
                          <Input
                            type="number"
                            value={line.unitPrice}
                            onChange={e => updateLine(line.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                            className="h-8 text-sm text-right"
                            min={0}
                          />
                          {line.unitPrice > 0 && (
                            <div className="text-right text-[10px] text-stone-400">{formatKRW(line.unitPrice)}</div>
                          )}
                        </div>
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
