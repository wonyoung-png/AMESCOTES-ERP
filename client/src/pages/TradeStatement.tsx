// AMESCOTES ERP — 거래명세표 (Phase 1 신규)
// 전표번호: YYYYMM-거래처코드-순번 (예: 202603-LLL-001)
import { useState, useMemo } from 'react';
import {
  store, genId, formatKRW, formatNumber,
  type TradeStatement, type TradeStatementLine, type TradeStatementStatus, type TaxType,
  type TaxInvoiceData, type Settlement, type ProductionOrder,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Trash2, FileText, X, Receipt, Printer, Download } from 'lucide-react';

// 공급자 고정값 (우리 회사)
const SUPPLIER = {
  companyName: '(주)아메스코테스',
  bizRegNo: '343-88-01791',
  address: '서울특별시 성북구 보문로13나길 27(보문동7가)',
  ceo: '이원영',
};

const STATUSES: TradeStatementStatus[] = ['미청구', '청구완료', '수금완료'];

const STATUS_COLOR: Record<TradeStatementStatus, string> = {
  '미청구':   'bg-stone-50 text-stone-500 border-stone-200',
  '청구완료': 'bg-amber-50 text-amber-700 border-amber-200',
  '수금완료': 'bg-green-50 text-green-700 border-green-200',
};

function newLine(): TradeStatementLine {
  return { id: genId(), description: '', qty: 1, unitPrice: 0, taxType: '과세', taxRate: 0.1 };
}

function calcLine(line: TradeStatementLine) {
  const supply = line.qty * line.unitPrice;
  const tax = supply * line.taxRate;
  return { supply, tax, total: supply + tax };
}

function calcStatement(lines: TradeStatementLine[] | undefined) {
  if (!lines || lines.length === 0) return { taxableSupply: 0, taxableVat: 0, exemptAmount: 0, grandTotal: 0 };
  const taxable = lines.filter(l => l.taxType === '과세');
  const exempt  = lines.filter(l => l.taxType === '면세');
  const taxableSupply = taxable.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const taxableVat    = taxable.reduce((s, l) => s + l.qty * l.unitPrice * l.taxRate, 0);
  const exemptAmount  = exempt.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  return { taxableSupply, taxableVat, exemptAmount, grandTotal: taxableSupply + taxableVat + exemptAmount };
}

export default function TradeStatement() {
  const [statements, setStatements] = useState<TradeStatement[]>(() => store.getTradeStatements());
  const vendors = store.getVendors();

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterBuyer, setFilterBuyer] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<Partial<TradeStatement>>({});
  const [lines, setLines] = useState<TradeStatementLine[]>([newLine()]);

  // 발주에서 불러오기 모달
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderFilterBuyer, setOrderFilterBuyer] = useState('all');
  const [completedOrders] = useState<ProductionOrder[]>(() =>
    store.getOrders().filter(o => o.status === '입고완료')
  );

  // 세금계산서 발행 모달 상태
  const [showTaxModal, setShowTaxModal] = useState(false);
  const [taxTargetId, setTaxTargetId] = useState<string>('');
  const [taxForm, setTaxForm] = useState<TaxInvoiceData>({
    issued: false,
    supplyAmount: 0,
    taxAmount: 0,
    totalAmount: 0,
    buyerCompanyName: '',
    buyerBizRegNo: '',
    buyerAddress: '',
    buyerEmail: '',
    memo: '',
  });

  // 세금계산서 미리보기 모달
  const [showTaxPreview, setShowTaxPreview] = useState(false);
  const [taxPreviewData, setTaxPreviewData] = useState<{ statement: TradeStatement; invoice: TaxInvoiceData } | null>(null);

  const refresh = () => setStatements(store.getTradeStatements());

  const filtered = useMemo(() => {
    let list = statements;
    if (filterStatus !== 'all') list = list.filter(s => s.status === filterStatus);
    if (filterBuyer !== 'all') list = list.filter(s => s.vendorId === filterBuyer);
    if (search) list = list.filter(s =>
      s.statementNo.toLowerCase().includes(search.toLowerCase()) ||
      s.vendorName.toLowerCase().includes(search.toLowerCase())
    );
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [statements, search, filterStatus, filterBuyer]);

  const stats = useMemo(() => {
    const unclaimed = statements.filter(s => s.status === '미청구');
    const billed    = statements.filter(s => s.status === '청구완료');
    const unclaimedAmount = unclaimed.reduce((sum, s) => sum + calcStatement(s.lines || []).grandTotal, 0);
    const billedAmount    = billed.reduce((sum, s) => sum + calcStatement(s.lines || []).grandTotal, 0);
    return { total: statements.length, unclaimed: unclaimed.length, unclaimedAmount, billed: billed.length, billedAmount };
  }, [statements]);

  const openNew = () => {
    setIsEdit(false);
    setForm({ issueDate: new Date().toISOString().split('T')[0], status: '미청구', vendorId: '', vendorName: '', vendorCode: '' });
    setLines([newLine()]);
    setShowModal(true);
  };

  // 발주에서 불러오기: 선택한 발주 정보를 lines에 채움
  const handleImportFromOrder = (order: ProductionOrder) => {
    const items = store.getItems();
    const item = items.find(i => i.id === order.styleId);

    // 바이어 자동 선택
    if (item?.buyerId) {
      const buyer = vendors.find(v => v.id === item.buyerId);
      if (buyer) {
        setForm(f => ({
          ...f,
          vendorId: buyer.id,
          vendorName: buyer.name,
          vendorCode: buyer.vendorCode || buyer.code || '',
        }));
      }
    }

    // lines 구성
    const colorQtyList = order.colorQtys && order.colorQtys.length > 0
      ? order.colorQtys
      : [{ color: '기본', qty: order.qty }];
    const importedLines: TradeStatementLine[] = colorQtyList.map(cq => ({
      id: genId(),
      description: `[${order.styleNo}] ${order.styleName}${cq.color !== '기본' ? ` (${cq.color})` : ''}`,
      qty: cq.qty,
      unitPrice: item?.salePriceKrw ?? 0,
      taxType: '과세' as const,
      taxRate: 0.1,
    }));
    setLines(importedLines);
    setShowOrderModal(false);
    toast.success(`발주 ${order.orderNo} 정보를 불러왔습니다`);
  };

  const openEdit = (s: TradeStatement) => {
    setIsEdit(true);
    setForm({ ...s });
    setLines([...s.lines]);
    setShowModal(true);
  };

  const handleVendorSelect = (vendorId: string) => {
    const vendor = vendors.find(v => v.id === vendorId);
    if (!vendor) return;
    setForm(f => ({
      ...f,
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorCode: vendor.vendorCode || vendor.code || '',
    }));
  };

  const handleSave = () => {
    if (!form.vendorId)  { toast.error('거래처를 선택해주세요'); return; }
    if (!form.issueDate) { toast.error('발행일을 입력해주세요'); return; }
    if (lines.some(l => !l.description)) { toast.error('품목/내역을 모두 입력해주세요'); return; }

    const vendorCode = form.vendorCode || 'XXX';

    if (isEdit && form.id) {
      store.updateTradeStatement(form.id, { ...form, lines, vendorCode } as Partial<TradeStatement>);
      toast.success('거래명세표가 수정되었습니다');
    } else {
      const statementNo = store.getNextStatementNo(vendorCode);
      store.addTradeStatement({
        id: genId(),
        statementNo,
        vendorId: form.vendorId!,
        vendorName: form.vendorName!,
        vendorCode,
        issueDate: form.issueDate!,
        lines,
        status: form.status || '미청구',
        taxInvoiceNo: form.taxInvoiceNo,
        memo: form.memo,
        createdAt: new Date().toISOString(),
      });
      toast.success(`거래명세표 ${statementNo} 발행 완료`);
    }
    refresh();
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    store.deleteTradeStatement(id);
    refresh();
    toast.success('삭제되었습니다');
  };

  // 계산서 발행 모달 열기
  const openTaxModal = (s: TradeStatement) => {
    const calc = calcStatement(s.lines);
    const grandTotal = calc.grandTotal;
    const supplyAmount = Math.round(grandTotal / 1.1);
    const taxAmount = grandTotal - supplyAmount;

    const vendor = vendors.find(v => v.id === s.vendorId);
    setTaxTargetId(s.id);
    setTaxForm({
      issued: false,
      supplyAmount,
      taxAmount,
      totalAmount: grandTotal,
      buyerCompanyName: vendor?.companyName || vendor?.name || s.vendorName,
      buyerBizRegNo: vendor?.bizRegNo || '',
      buyerAddress: vendor?.address || '',
      buyerEmail: vendor?.billingEmail || vendor?.contactEmail || '',
      memo: '',
    });
    setShowTaxModal(true);
  };

  // 계산서 발행 완료
  const handleTaxIssue = () => {
    if (!taxForm.buyerCompanyName) { toast.error('공급받는자 상호를 입력해주세요'); return; }
    if (!taxForm.buyerBizRegNo) { toast.error('사업자등록번호를 입력해주세요'); return; }
    if (taxForm.totalAmount <= 0) { toast.error('합계금액을 입력해주세요'); return; }

    const invoiceData: TaxInvoiceData = {
      ...taxForm,
      issued: true,
      issuedAt: new Date().toISOString(),
    };
    store.updateTradeStatement(taxTargetId, { taxInvoice: invoiceData });
    refresh();
    setShowTaxModal(false);
    toast.success('세금계산서가 발행되었습니다');
  };

  // 계산서 미리보기 열기
  const openTaxPreview = (s: TradeStatement) => {
    if (!s.taxInvoice) return;
    setTaxPreviewData({ statement: s, invoice: s.taxInvoice });
    setShowTaxPreview(true);
  };

  // PDF 출력 (거래명세표)
  const handlePrintStatement = (s: TradeStatement) => {
    const calc = calcStatement(s.lines);
    const vendor = vendors.find(v => v.id === s.vendorId);
    const printWin = window.open('', '_blank', 'width=800,height=900');
    if (!printWin) { toast.error('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.'); return; }
    const rows = s.lines.map(l => `
      <tr>
        <td>${l.description}</td>
        <td style="text-align:center">${l.qty}</td>
        <td style="text-align:right">${l.unitPrice.toLocaleString()}</td>
        <td style="text-align:center">${l.taxType}</td>
        <td style="text-align:right">${(l.qty * l.unitPrice).toLocaleString()}</td>
        <td style="text-align:right">${Math.round(l.qty * l.unitPrice * l.taxRate).toLocaleString()}</td>
        <td style="text-align:right">${Math.round(l.qty * l.unitPrice * (1 + l.taxRate)).toLocaleString()}</td>
      </tr>
    `).join('');
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>거래명세표 ${s.statementNo}</title>
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
          .total-row { background: #fef3c7; font-weight: bold; }
          .footer { margin-top: 16px; text-align: right; font-size: 11px; color: #666; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <h2>거래명세표</h2>
        <div style="text-align:right; margin-bottom:8px; color:#666; font-size:11px;">
          전표번호: <strong>${s.statementNo}</strong> &nbsp;|&nbsp; 발행일: ${s.issueDate}
        </div>
        <div class="info-grid">
          <div class="info-box">
            <h4>공급자</h4>
            <p><strong>${SUPPLIER.companyName}</strong></p>
            <p>사업자번호: ${SUPPLIER.bizRegNo}</p>
            <p>대표자: ${SUPPLIER.ceo}</p>
            <p>${SUPPLIER.address}</p>
          </div>
          <div class="info-box">
            <h4>공급받는자</h4>
            <p><strong>${vendor?.companyName || s.vendorName}</strong></p>
            <p>사업자번호: ${vendor?.bizRegNo || '-'}</p>
            <p>${vendor?.address || '-'}</p>
            <p>이메일: ${vendor?.contactEmail || '-'}</p>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>품목/내역</th>
              <th>수량</th>
              <th>단가</th>
              <th>세율</th>
              <th>공급가</th>
              <th>부가세</th>
              <th>합계</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="total-row">
              <td colspan="4" style="text-align:right">합계</td>
              <td style="text-align:right">${(calc.taxableSupply + calc.exemptAmount).toLocaleString()}</td>
              <td style="text-align:right">${calc.taxableVat.toLocaleString()}</td>
              <td style="text-align:right">${calc.grandTotal.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
        <div class="footer">* 본 거래명세표는 AMESCOTES ERP에서 발행되었습니다.</div>
        <script>window.onload = function() { window.print(); };</script>
      </body>
      </html>
    `);
    printWin.document.close();
  };

  const updateLine = (idx: number, field: keyof TradeStatementLine, value: unknown) => {
    setLines(ls => ls.map((l, i) => {
      if (i !== idx) return l;
      const updated = { ...l, [field]: value } as TradeStatementLine;
      if (field === 'taxType') updated.taxRate = (value as TaxType) === '과세' ? 0.1 : 0;
      return updated;
    }));
  };

  const currentTotal = useMemo(() => calcStatement(lines), [lines]);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-stone-800">거래명세표</h1>
          <p className="text-xs md:text-sm text-stone-500 mt-0.5 hidden sm:block">전표번호: YYYYMM-거래처코드-순번 · 건별 세율 설정 지원</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => { openNew(); setShowOrderModal(true); }}
            className="hidden sm:flex gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            <Download className="w-4 h-4" />발주에서 불러오기
          </Button>
          <Button onClick={openNew} className="bg-amber-700 hover:bg-amber-800 text-white gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-10 px-2 md:px-4">
            <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />명세표 발행
          </Button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
        {[
          { label: '전체',       value: `${stats.total}건`,              color: 'text-stone-800' },
          { label: '미청구',     value: `${stats.unclaimed}건`,          color: 'text-amber-700' },
          { label: '미청구 금액', value: formatKRW(stats.unclaimedAmount), color: 'text-amber-700' },
          { label: '청구 완료',  value: formatKRW(stats.billedAmount),   color: 'text-blue-700' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-stone-200 p-4">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-stone-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 상태 탭 필터 */}
      <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl w-fit">
        {[
          { value: 'all', label: '전체', count: stats.total },
          { value: '미청구', label: '미청구', count: stats.unclaimed },
          { value: '청구완료', label: '청구완료', count: stats.billed },
          { value: '수금완료', label: '수금완료', count: statements.filter(s => s.status === '수금완료').length },
        ].map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilterStatus(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              filterStatus === opt.value
                ? 'bg-white text-stone-800 shadow-sm'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {opt.label}
            <span className="ml-1.5 text-[10px] opacity-60">{opt.count}</span>
          </button>
        ))}
      </div>

      {/* 검색 + 바이어 필터 */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="전표번호 / 거래처 검색" className="pl-9 h-9" />
        </div>
        <Select value={filterBuyer} onValueChange={setFilterBuyer}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="바이어 필터" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 바이어</SelectItem>
            {vendors.filter(v => v.type === '바이어').map(v => (
              <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 테이블 (데스크탑) */}
      <div className="hidden md:block bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">전표번호</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">거래처</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">발행일</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">공급가액</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">부가세</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">합계</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">상태</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">세금계산서</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-stone-400">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">발행된 명세표가 없습니다</p>
              </td></tr>
            ) : filtered.map(s => {
              const calc = calcStatement(s.lines);
              return (
                <tr key={s.id} className="border-b border-stone-50 hover:bg-stone-50/50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-amber-700">{s.statementNo}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-stone-800">{s.vendorName}</p>
                    {s.vendorCode && <p className="text-xs text-stone-400">코드: {s.vendorCode}</p>}
                  </td>
                  <td className="px-4 py-3 text-stone-600 text-xs">{s.issueDate}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-stone-700">{formatKRW(calc.taxableSupply + calc.exemptAmount)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-stone-500">{formatKRW(calc.taxableVat)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-bold text-stone-800">{formatKRW(calc.grandTotal)}</td>
                  <td className="px-4 py-3">
                    <Select value={s.status} onValueChange={v => {
                      const newStatus = v as TradeStatementStatus;
                      store.updateTradeStatement(s.id, { status: newStatus });
                      if (newStatus === '청구완료') {
                        // 중복 방지: 이미 같은 전표번호로 정산 레코드가 있으면 skip
                        const existingSettlements = store.getSettlements();
                        const alreadyExists = existingSettlements.some(st => st.invoiceNo === s.statementNo);
                        if (!alreadyExists) {
                          const today = new Date().toISOString().split('T')[0];
                          const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                          const calc = calcStatement(s.lines);
                          const settlement: Settlement = {
                            id: genId(),
                            buyerId: s.vendorId,
                            buyerName: s.vendorName,
                            channel: 'B2B직납',
                            invoiceNo: s.statementNo,
                            invoiceDate: today,
                            dueDate,
                            billedAmountKrw: calc.grandTotal,
                            collectedAmountKrw: 0,
                            status: '정상',
                            createdAt: new Date().toISOString(),
                          };
                          store.addSettlement(settlement);
                        }
                      }
                      if (newStatus === '수금완료') {
                        // 연결된 정산 레코드의 collectedAmountKrw = billedAmountKrw 자동 업데이트
                        const settlements = store.getSettlements();
                        const linked = settlements.find(st => st.invoiceNo === s.statementNo);
                        if (linked) {
                          store.updateSettlement(linked.id, {
                            collectedAmountKrw: linked.billedAmountKrw,
                            status: '완납',
                          });
                        }
                      }
                      refresh();
                    }}>
                      <SelectTrigger className={`h-7 text-xs w-28 border ${STATUS_COLOR[s.status]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map(st => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {s.taxInvoice?.issued ? (
                      <button
                        onClick={() => openTaxPreview(s)}
                        className="inline-flex flex-col items-center gap-0.5 group"
                      >
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 group-hover:bg-green-100 transition-colors">
                          ✅ 발행완료
                        </span>
                        <span className="text-[10px] text-stone-400">
                          {s.taxInvoice.issuedAt ? new Date(s.taxInvoice.issuedAt).toLocaleDateString('ko-KR') : ''}
                        </span>
                      </button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                        onClick={() => openTaxModal(s)}
                      >
                        <Receipt className="w-3 h-3" />계산서 발행
                      </Button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-blue-700 hover:text-blue-900" onClick={() => handlePrintStatement(s)}>
                        <Printer className="w-3.5 h-3.5 mr-1" />PDF
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(s)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(s.id)}>
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
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">발행된 명세표가 없습니다</p>
          </div>
        ) : filtered.map(s => {
          const calc = calcStatement(s.lines);
          return (
            <div key={s.id} className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono font-bold text-amber-700 text-sm">{s.statementNo}</p>
                  <p className="font-medium text-stone-800 mt-0.5">{s.vendorName}</p>
                  <p className="text-xs text-stone-400">{s.issueDate}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${STATUS_COLOR[s.status]}`}>{s.status}</span>
              </div>
              <div className="mt-3 pt-3 border-t border-stone-100">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-stone-500">
                    <span>공급가: {formatKRW(calc.taxableSupply + calc.exemptAmount)}</span>
                    <span className="mx-1.5 text-stone-300">|</span>
                    <span>부가세: {formatKRW(calc.taxableVat)}</span>
                  </div>
                  <p className="font-mono font-bold text-stone-800">{formatKRW(calc.grandTotal)}</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1 mt-3">
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-blue-700" onClick={() => handlePrintStatement(s)}>
                  <Printer className="w-3.5 h-3.5 mr-1" />PDF
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(s)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(s.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 세금계산서 발행 모달 */}
      <Dialog open={showTaxModal} onOpenChange={setShowTaxModal}>
        <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-amber-700" />
              세금계산서 발행
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* 공급자 (고정) */}
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">공급자</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div><span className="text-stone-500">상호</span><span className="ml-2 font-medium text-stone-800">{SUPPLIER.companyName}</span></div>
                <div><span className="text-stone-500">대표자</span><span className="ml-2 font-medium text-stone-800">{SUPPLIER.ceo}</span></div>
                <div><span className="text-stone-500">사업자번호</span><span className="ml-2 font-mono text-stone-700">{SUPPLIER.bizRegNo}</span></div>
                <div className="col-span-2"><span className="text-stone-500">주소</span><span className="ml-2 text-stone-700">{SUPPLIER.address}</span></div>
              </div>
            </div>

            {/* 공급받는자 */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-3 space-y-3">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">공급받는자</p>
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">상호 *</Label>
                  <Input
                    value={taxForm.buyerCompanyName}
                    onChange={e => setTaxForm(f => ({ ...f, buyerCompanyName: e.target.value }))}
                    placeholder="회사명"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">사업자등록번호 *</Label>
                  <Input
                    value={taxForm.buyerBizRegNo}
                    onChange={e => setTaxForm(f => ({ ...f, buyerBizRegNo: e.target.value }))}
                    placeholder="000-00-00000"
                    className="h-8 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">사업장 주소</Label>
                  <Input
                    value={taxForm.buyerAddress}
                    onChange={e => setTaxForm(f => ({ ...f, buyerAddress: e.target.value }))}
                    placeholder="주소"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">이메일</Label>
                  <Input
                    value={taxForm.buyerEmail || ''}
                    onChange={e => setTaxForm(f => ({ ...f, buyerEmail: e.target.value }))}
                    placeholder="이메일"
                    className="h-8 text-sm"
                    type="email"
                  />
                </div>
              </div>
            </div>

            {/* 금액 */}
            <div className="rounded-lg border border-stone-200 p-3 space-y-3">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">금액</p>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Label className="text-xs w-24 shrink-0">공급가액</Label>
                  <Input
                    type="number"
                    value={taxForm.supplyAmount || ''}
                    onChange={e => {
                      const supplyAmount = parseInt(e.target.value) || 0;
                      const taxAmount = taxForm.totalAmount - supplyAmount;
                      setTaxForm(f => ({ ...f, supplyAmount, taxAmount }));
                    }}
                    className="h-8 text-sm text-right font-mono"
                  />
                  <span className="text-sm text-stone-500 shrink-0">원</span>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-xs w-24 shrink-0">세액 (10%)</Label>
                  <Input
                    type="number"
                    value={taxForm.taxAmount || ''}
                    onChange={e => setTaxForm(f => ({ ...f, taxAmount: parseInt(e.target.value) || 0 }))}
                    className="h-8 text-sm text-right font-mono"
                  />
                  <span className="text-sm text-stone-500 shrink-0">원</span>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-xs w-24 shrink-0 font-bold">합계금액</Label>
                  <Input
                    type="number"
                    value={taxForm.totalAmount || ''}
                    onChange={e => {
                      const totalAmount = parseInt(e.target.value) || 0;
                      const supplyAmount = Math.round(totalAmount / 1.1);
                      const taxAmount = totalAmount - supplyAmount;
                      setTaxForm(f => ({ ...f, totalAmount, supplyAmount, taxAmount }));
                    }}
                    className="h-8 text-sm text-right font-mono font-bold"
                  />
                  <span className="text-sm text-stone-500 shrink-0">원</span>
                </div>
              </div>
            </div>

            {/* 비고 */}
            <div className="space-y-1.5">
              <Label className="text-xs">비고</Label>
              <Input
                value={taxForm.memo || ''}
                onChange={e => setTaxForm(f => ({ ...f, memo: e.target.value }))}
                placeholder="비고 사항 입력"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTaxModal(false)}>취소</Button>
            <Button onClick={handleTaxIssue} className="bg-amber-700 hover:bg-amber-800 text-white gap-2">
              <Receipt className="w-4 h-4" />발행 완료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 세금계산서 미리보기 모달 */}
      <Dialog open={showTaxPreview} onOpenChange={setShowTaxPreview}>
        <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-green-700" />
              세금계산서 발행 내역
            </DialogTitle>
          </DialogHeader>
          {taxPreviewData && (
            <div className="space-y-4 py-2" id="tax-invoice-print">
              <div className="text-center border-b border-stone-200 pb-3">
                <h2 className="text-xl font-bold text-stone-800">세금계산서</h2>
                <p className="text-sm text-stone-500 mt-1">
                  전표번호: {taxPreviewData.statement.statementNo}
                  {taxPreviewData.invoice.issuedAt && (
                    <> · 발행일: {new Date(taxPreviewData.invoice.issuedAt).toLocaleDateString('ko-KR')}</>
                  )}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border border-stone-200 p-3 space-y-1">
                  <p className="text-xs font-semibold text-stone-500 mb-2">공급자</p>
                  <p className="text-sm font-bold text-stone-800">{SUPPLIER.companyName}</p>
                  <p className="text-xs text-stone-600">사업자번호: {SUPPLIER.bizRegNo}</p>
                  <p className="text-xs text-stone-600">대표자: {SUPPLIER.ceo}</p>
                  <p className="text-xs text-stone-500">{SUPPLIER.address}</p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-3 space-y-1">
                  <p className="text-xs font-semibold text-amber-700 mb-2">공급받는자</p>
                  <p className="text-sm font-bold text-stone-800">{taxPreviewData.invoice.buyerCompanyName}</p>
                  <p className="text-xs text-stone-600">사업자번호: {taxPreviewData.invoice.buyerBizRegNo}</p>
                  {taxPreviewData.invoice.buyerAddress && (
                    <p className="text-xs text-stone-500">{taxPreviewData.invoice.buyerAddress}</p>
                  )}
                  {taxPreviewData.invoice.buyerEmail && (
                    <p className="text-xs text-stone-400">{taxPreviewData.invoice.buyerEmail}</p>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-stone-200 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-stone-100">
                      <td className="px-4 py-2.5 text-stone-600 bg-stone-50 w-40">공급가액</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-stone-800">
                        {formatKRW(taxPreviewData.invoice.supplyAmount)}
                      </td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="px-4 py-2.5 text-stone-600 bg-stone-50">세액 (10%)</td>
                      <td className="px-4 py-2.5 text-right font-mono text-stone-600">
                        {formatKRW(taxPreviewData.invoice.taxAmount)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-bold text-stone-800 bg-stone-50">합계금액</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-lg text-amber-700">
                        {formatKRW(taxPreviewData.invoice.totalAmount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {taxPreviewData.invoice.memo && (
                <div className="rounded-lg border border-stone-100 bg-stone-50 px-4 py-2.5">
                  <span className="text-xs text-stone-500">비고: </span>
                  <span className="text-sm text-stone-700">{taxPreviewData.invoice.memo}</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => window.print()} className="gap-2">
              🖨️ 인쇄
            </Button>
            <Button onClick={() => setShowTaxPreview(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 발주에서 불러오기 모달 */}
      <Dialog open={showOrderModal} onOpenChange={setShowOrderModal}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-2xl sm:rounded-lg sm:max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-4 h-4 text-amber-700" />
              발주에서 불러오기 (입고완료)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Select value={orderFilterBuyer} onValueChange={setOrderFilterBuyer}>
                <SelectTrigger className="w-40 h-8">
                  <SelectValue placeholder="바이어 필터" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 바이어</SelectItem>
                  {vendors.filter(v => v.type === '바이어').map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">발주번호</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">스타일</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">수량</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">바이어</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">선택</th>
                  </tr>
                </thead>
                <tbody>
                  {completedOrders
                    .filter(o => {
                      if (orderFilterBuyer === 'all') return true;
                      const item = store.getItems().find(i => i.id === o.styleId);
                      return item?.buyerId === orderFilterBuyer;
                    })
                    .map(o => {
                      const item = store.getItems().find(i => i.id === o.styleId);
                      const buyer = item?.buyerId ? vendors.find(v => v.id === item.buyerId) : null;
                      return (
                        <tr key={o.id} className="border-b border-stone-50 hover:bg-stone-50">
                          <td className="px-3 py-2 font-mono text-xs font-bold text-amber-700">{o.orderNo}</td>
                          <td className="px-3 py-2">
                            <p className="font-medium text-stone-700">{o.styleNo}</p>
                            <p className="text-xs text-stone-400">{o.styleName}</p>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{formatNumber(o.qty)}</td>
                          <td className="px-3 py-2 text-xs text-stone-600">{buyer?.name ?? '-'}</td>
                          <td className="px-3 py-2 text-center">
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-amber-700 hover:bg-amber-800 text-white"
                              onClick={() => handleImportFromOrder(o)}
                            >
                              불러오기
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  {completedOrders.filter(o => {
                    if (orderFilterBuyer === 'all') return true;
                    const item = store.getItems().find(i => i.id === o.styleId);
                    return item?.buyerId === orderFilterBuyer;
                  }).length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-stone-400 text-sm">
                        입고완료된 발주가 없습니다
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOrderModal(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 발행/수정 모달 */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-3xl sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? '거래명세표 수정' : '거래명세표 발행'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {!isEdit && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
                  onClick={() => setShowOrderModal(true)}
                >
                  <Download className="w-3.5 h-3.5" />발주에서 불러오기
                </Button>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-1 sm:col-span-2">
                <Label>거래처 *</Label>
                <Select value={form.vendorId || ''} onValueChange={handleVendorSelect}>
                  <SelectTrigger><SelectValue placeholder="거래처 선택" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map(v => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}{v.vendorCode ? ` [${v.vendorCode}]` : ''}{v.code ? ` (${v.code})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.vendorCode && (
                  <p className="text-xs text-stone-500">
                    전표번호 예시:{' '}
                    <span className="font-mono font-bold text-amber-700">
                      {new Date().toISOString().slice(0, 7).replace('-', '')}-{form.vendorCode}-001
                    </span>
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>발행일 *</Label>
                <Input type="date" value={form.issueDate || ''} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>세율 (일괄 적용)</Label>
                <Select value={lines[0]?.taxType || '과세'} onValueChange={v => setLines(prev => prev.map(l => ({ ...l, taxType: v as TaxType, taxRate: v === '과세' ? 0.1 : 0 })))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="과세">과세 10%</SelectItem>
                    <SelectItem value="면세">면세 0%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 명세 라인 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>품목 명세</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setLines(ls => [...ls, newLine()])} className="h-7 text-xs gap-1">
                  <Plus className="w-3 h-3" />항목 추가
                </Button>
              </div>
              <div className="rounded-lg border border-stone-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200">
                      <th className="text-center px-3 py-2.5 font-medium text-stone-400 w-10">No</th>
                      <th className="text-left px-4 py-2.5 font-medium text-stone-600">품목/내역</th>
                      <th className="text-center px-3 py-2.5 font-medium text-stone-600 w-20">수량</th>
                      <th className="text-right px-3 py-2.5 font-medium text-stone-600 w-32">단가 (원)</th>
                      <th className="text-right px-3 py-2.5 font-medium text-stone-600 w-32">공급가액</th>
                      <th className="text-right px-3 py-2.5 font-medium text-stone-600 w-28">부가세</th>
                      <th className="text-right px-3 py-2.5 font-medium text-stone-600 w-32">합계</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => {
                      const calc = calcLine(line);
                      return (
                        <tr key={line.id} className="border-b border-stone-50">
                          <td className="px-2 py-1.5 text-center text-xs text-stone-400 font-mono">{idx + 1}</td>
                          <td className="px-2 py-1.5">
                            <Input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} placeholder="품목명 또는 내역" className="h-8 text-sm min-w-[220px]" />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input type="number" min="1" value={line.qty} onChange={e => updateLine(idx, 'qty', parseInt(e.target.value) || 1)} className="h-8 text-sm text-center w-16" />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input type="number" min="0" value={(!line.unitPrice || isNaN(line.unitPrice)) ? '' : line.unitPrice} onChange={e => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)} placeholder="0" className="h-8 text-sm text-right w-28" />
                          </td>

                          <td className="px-2 py-1.5 text-right text-stone-700 font-mono">{formatKRW(calc.supply)}</td>
                          <td className="px-2 py-1.5 text-right text-stone-500 font-mono">{formatKRW(calc.tax)}</td>
                          <td className="px-2 py-1.5 text-right text-stone-800 font-mono font-semibold">{formatKRW(calc.total)}</td>
                          <td className="px-2 py-1.5 text-center">
                            {lines.length > 1 && (
                              <button onClick={() => setLines(ls => ls.filter((_, i) => i !== idx))} className="text-stone-300 hover:text-red-500">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* 합계 */}
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-100 text-sm space-y-1">
                <div className="flex justify-between text-stone-600">
                  <span>과세 공급가액</span>
                  <span className="font-mono">{formatKRW(currentTotal.taxableSupply)}</span>
                </div>
                {currentTotal.exemptAmount > 0 && (
                  <div className="flex justify-between text-stone-600">
                    <span>면세 공급가액</span>
                    <span className="font-mono">{formatKRW(currentTotal.exemptAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-stone-600">
                  <span>부가세 (10%)</span>
                  <span className="font-mono">{formatKRW(currentTotal.taxableVat)}</span>
                </div>
                <div className="flex justify-between font-bold text-stone-800 text-base pt-2 border-t border-stone-200">
                  <span>합계</span>
                  <span className="font-mono">{formatKRW(currentTotal.grandTotal)}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>전표 상태</Label>
                <Select value={form.status || '미청구'} onValueChange={v => setForm(f => ({ ...f, status: v as TradeStatementStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>세금계산서 번호</Label>
                <Input value={form.taxInvoiceNo || ''} onChange={e => setForm(f => ({ ...f, taxInvoiceNo: e.target.value }))} placeholder="자동발행 시 비워두세요" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>메모</Label>
              <Input value={form.memo || ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">{isEdit ? '수정' : '발행'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
