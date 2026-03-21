// 서류 출력 — PDF document generation via window.print()
import { useState } from 'react';
import { store, formatKRW, formatNumber } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { FileText, Printer } from 'lucide-react';
import { toast } from 'sonner';

const DOC_TYPES = [
  { id: 'factory_po', name: '공장용 발주서', desc: 'BOM 테이블, 수량, 단가(선택)' },
  { id: 'pi', name: 'PI (Proforma Invoice)', desc: 'USD/CNY 금액, HS code' },
  { id: 'packing', name: 'Packing List', desc: 'CT, QTY, N.W, G.W, CBM' },
  { id: 'buyer_quote', name: '바이어 견적서', desc: '스타일, 가격, MOQ, 납기' },
  { id: 'invoice', name: '거래명세서', desc: '공급가액 + VAT' },
  { id: 'cost_report', name: '원가계산서', desc: '사전 vs 사후 원가 비교' },
];

export default function DocumentOutput() {
  const [selectedDoc, setSelectedDoc] = useState('factory_po');
  const [selectedOrder, setSelectedOrder] = useState('');
  const [showPrices, setShowPrices] = useState(true);
  const orders = store.getOrders();
  const items = store.getItems();
  const boms = store.getBoms();

  const handlePrint = () => {
    const order = orders.find(o => o.orderNo === selectedOrder);
    if (!order && selectedDoc !== 'cost_report') {
      toast.error('발주번호를 선택하세요');
      return;
    }

    const item = items.find(i => i.styleNo === order?.styleNo);
    const bom = boms.find(b => b.styleNo === order?.styleNo);

    // Build print content
    let content = '';
    const header = `
      <div style="text-align:center;margin-bottom:24px;border-bottom:2px solid #C9A96E;padding-bottom:16px;">
        <h1 style="font-size:20px;color:#1C1C1E;margin:0;">ATLM — Atelier de LUMEN</h1>
        <p style="font-size:12px;color:#6B6B6B;margin:4px 0 0;">(주)아메스코테스</p>
      </div>
    `;

    if (selectedDoc === 'factory_po' && order && bom) {
      content = `${header}
        <h2 style="font-size:16px;margin-bottom:16px;">공장용 발주서</h2>
        <table style="width:100%;font-size:12px;margin-bottom:12px;">
          <tr><td><b>발주번호:</b> ${order.orderNo}</td><td><b>스타일:</b> ${order.styleNo}</td></tr>
          <tr><td><b>품명:</b> ${item?.name || ''}</td><td><b>수량:</b> ${formatNumber(order.qty)}pcs</td></tr>
          <tr><td><b>공장:</b> ${order.vendorName}</td><td><b>발주일:</b> ${order.createdAt?.split('T')[0] || ''}</td></tr>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead><tr style="background:#f5f4ef;">
            <th style="border:1px solid #ddd;padding:6px;">구분</th>
            <th style="border:1px solid #ddd;padding:6px;">품목명</th>
            <th style="border:1px solid #ddd;padding:6px;">규격</th>
            <th style="border:1px solid #ddd;padding:6px;">단위</th>
            ${showPrices ? '<th style="border:1px solid #ddd;padding:6px;">단가</th>' : ''}
            <th style="border:1px solid #ddd;padding:6px;">소요량</th>
            ${showPrices ? '<th style="border:1px solid #ddd;padding:6px;">금액</th>' : ''}
          </tr></thead>
          <tbody>
            ${bom.lines.map(m => `<tr>
              <td style="border:1px solid #ddd;padding:4px;">${m.category}</td>
              <td style="border:1px solid #ddd;padding:4px;">${m.itemName}</td>
              <td style="border:1px solid #ddd;padding:4px;">${m.spec || ''}</td>
              <td style="border:1px solid #ddd;padding:4px;">${m.unit}</td>
              ${showPrices ? `<td style="border:1px solid #ddd;padding:4px;text-align:right;">${m.unitPriceCny} ${'CNY'}</td>` : ''}
              <td style="border:1px solid #ddd;padding:4px;text-align:right;">${(m.netQty * (1 + m.lossRate / 100)).toFixed(2)}</td>
              ${showPrices ? `<td style="border:1px solid #ddd;padding:4px;text-align:right;">${(m.unitPriceCny * m.netQty * (1 + m.lossRate / 100)).toFixed(2)} ${'CNY'}</td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
        ${showPrices ? `<p style="text-align:right;margin-top:12px;font-size:13px;"><b>임가공비: ${bom.processingFee.toFixed(2)} CNY</b></p>` : ''}
      `;
    } else if (selectedDoc === 'buyer_quote' && order) {
      content = `${header}
        <h2 style="font-size:16px;margin-bottom:16px;">견적서 (Quotation)</h2>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#f5f4ef;">
            <th style="border:1px solid #ddd;padding:8px;">Style No.</th>
            <th style="border:1px solid #ddd;padding:8px;">Product Name</th>
            <th style="border:1px solid #ddd;padding:8px;">Material</th>
            <th style="border:1px solid #ddd;padding:8px;">Price (KRW)</th>
            <th style="border:1px solid #ddd;padding:8px;">MOQ</th>
          </tr></thead>
          <tbody><tr>
            <td style="border:1px solid #ddd;padding:6px;">${order.styleNo}</td>
            <td style="border:1px solid #ddd;padding:6px;">${item?.name}</td>
            <td style="border:1px solid #ddd;padding:6px;">${item?.material}</td>
            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${formatKRW(item?.salePriceKrw || 0)}</td>
            <td style="border:1px solid #ddd;padding:6px;text-align:center;">100</td>
          </tr></tbody>
        </table>
      `;
    } else {
      content = `${header}<h2>문서 미리보기</h2><p>선택한 문서 유형: ${DOC_TYPES.find(d => d.id === selectedDoc)?.name}</p>`;
    }

    // Open print window
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html><html><head><title>ATLM 문서 출력</title>
        <style>body{font-family:-apple-system,sans-serif;padding:40px;color:#2D2D2D;} @media print{body{padding:20px;}}</style>
        </head><body>${content}</body></html>
      `);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 500);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">서류 출력</h1>
        <p className="text-sm text-muted-foreground mt-0.5">ATLM 브랜드 헤더 포함 PDF 문서 생성</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Document type selection */}
        <div className="lg:col-span-2 space-y-3">
          {DOC_TYPES.map(doc => (
            <Card key={doc.id}
              className={`border-border/60 shadow-sm cursor-pointer transition-all ${selectedDoc === doc.id ? 'ring-2 ring-[#C9A96E] border-[#C9A96E]' : 'hover:border-[#C9A96E]/50'}`}
              onClick={() => setSelectedDoc(doc.id)}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${selectedDoc === doc.id ? 'bg-[#C9A96E] text-white' : 'bg-muted text-muted-foreground'}`}>
                  <FileText size={18} />
                </div>
                <div>
                  <p className="font-medium text-sm">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">{doc.desc}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Options panel */}
        <div>
          <Card className="border-border/60 shadow-sm sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">출력 옵션</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>발주번호</Label>
                <Select value={selectedOrder} onValueChange={setSelectedOrder}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>{orders.map(o => <SelectItem key={o.id} value={o.orderNo}>{o.orderNo}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {selectedDoc === 'factory_po' && (
                <div className="flex items-center gap-2">
                  <Switch checked={showPrices} onCheckedChange={setShowPrices} />
                  <Label className="text-sm">단가 표시</Label>
                </div>
              )}

              <Button onClick={handlePrint} className="w-full bg-[#C9A96E] hover:bg-[#B8985D] text-white">
                <Printer size={16} className="mr-2" />출력 / PDF 저장
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
