/**
 * BOM / 원가 관리 (사전원가 + 사후원가 통합)
 * Design: Maison Atelier — 에보니 사이드바, 골드 악센트, 아이보리 배경
 *
 * 탭 구조:
 * [사전원가] — 기존 BOM 입력 UI (자재 테이블, 임가공비, 원가 요약, P&L)
 * [사후원가] — 공장 원가표 업로드 + 통화/제조국 선택 + 강조된 원가 요약
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  store, genId,
  type Bom, type BomLine, type BomCategory, type BomSubPart, type Season, type Item, type Material,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Plus, Trash2, Upload, FileText, Download, ChevronDown, ChevronRight,
  Calculator, TrendingUp, AlertTriangle, CheckCircle, Save, X, Copy, Search,
  Factory,
} from 'lucide-react';

// ─── 타입 정의 ───────────────────────────────────────────────────────────────
interface PostProcessLine {
  id: string;
  name: string;
  netQty: number;
  unitPrice: number;
  memo?: string;
  subPart?: string;
  spec?: string;
  unit?: string;
}

interface BomPnlAssumptions {
  discountRate: number;
  platformFeeRate: number;
  sgaRate: number;
  confirmedSalePrice?: number;
}

// 확장된 BOM 타입 (localStorage에 저장되는 실제 구조)
interface ExtBom {
  id: string;
  styleId: string;
  styleNo: string;
  styleName: string;
  lineName?: string;
  designer?: string;
  erpCategory?: string;
  size?: string;
  boxSize?: string;
  version: number;
  season: Season;
  // 사전원가
  lines: ExtBomLine[];
  postProcessLines: PostProcessLine[];
  processingFee: number;
  logisticsCostKrw: number;
  packagingCostKrw: number;
  packingCostKrw: number;
  productionMarginRate: number;
  snapshotCnyKrw: number;
  pnl: BomPnlAssumptions;
  sourceFileName?: string;
  // 사전원가 추가 설정
  preCurrency?: 'CNY' | 'USD' | 'KRW';
  preManufacturingCountry?: '중국' | '한국' | '기타';
  preExchangeRateCny?: number;   // 사전원가 CNY 환율 (없으면 snapshotCnyKrw 사용)
  preExchangeRateUsd?: number;   // 사전원가 USD 환율
  preSourceFileName?: string;
  // 사후원가
  postMaterials?: ExtBomLine[];
  postProcessingFee?: number;
  currency?: 'CNY' | 'USD' | 'KRW';
  manufacturingCountry?: '중국' | '한국' | '기타';
  exchangeRateCny?: number;
  exchangeRateUsd?: number;
  postDeliveryPrice?: number;
  postSourceFileName?: string;
  createdAt: string;
  updatedAt: string;
  memo?: string;
}

interface ExtBomLine {
  id: string;
  category: BomCategory;
  subPart?: BomSubPart;     // 품목 부위 (원자재 구분 시만)
  itemName: string;
  spec?: string;
  unit: string;
  customUnit?: string;      // 직접입력 단위
  unitPriceCny: number;
  netQty: number;
  lossRate: number;
  isHqProvided: boolean;
  vendorName?: string;
  memo?: string;
}

// ─── 상수 ───────────────────────────────────────────────────────────────────
const BOM_SECTIONS: BomCategory[] = ['원자재', '지퍼', '장식', '보강재', '봉사·접착제', '포장재', '철형'];
const UNITS = ['SF', 'YD', 'M', 'EA', 'L', '콘', 'KG', 'SET', '장', '개', 'PC', 'CM', '직접입력'];
const SUB_PARTS: BomSubPart[] = ['바디', '안감', '트림1', '트림2', '기타'];
// 섹션별 부위 옵션
const SECTION_SUB_PARTS: Record<string, string[]> = {
  '원자재': ['바디', '안감', '트림1', '트림2', '기타'],
  '지퍼': ['메인지퍼', '내부지퍼', '장식지퍼', '기타'],
  '장식': ['자석', '고리', 'D링', '버클', '리벳', '기타'],
  '보강재': ['바디', '안감', '트림', '기타'],
  '봉사·접착제': ['바디', '안감', '콤비', '기타'],
  '포장재': ['박스', '내포장', '라벨', '기타'],
  '후가공': ['칼라불박', '자수', '인쇄', '옴브레', '기타'],
  '철형': ['기타'],
};
// const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS']; // 미사용

// ─── 계산 헬퍼 ──────────────────────────────────────────────────────────────
const calcQty = (net: number, loss: number) => net * (1 + loss);
const calcLineAmt = (price: number, net: number, loss: number) => price * calcQty(net, loss);
const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const fmtKrw = (n: number) => '₩' + Math.round(n).toLocaleString('ko-KR');

// 사전원가 요약 계산 (통화/환율 반영)
function calcSummary(bom: ExtBom, settingsUsdKrw?: number) {
  const preCur = bom.preCurrency || 'CNY';
  const cnyKrw = bom.preExchangeRateCny ?? bom.snapshotCnyKrw ?? 191;
  const usdKrw = bom.preExchangeRateUsd ?? settingsUsdKrw ?? 1380;
  // 입력 통화에 따른 KRW 환산 비율
  const toKrw = preCur === 'KRW' ? 1 : preCur === 'USD' ? usdKrw : cnyKrw;

  const materialAmt = bom.lines.reduce((s, l) => {
    if (l.isHqProvided) return s;
    return s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate);
  }, 0);
  const postProcessAmt = (bom.postProcessLines || []).reduce((s, l) => s + l.netQty * l.unitPrice, 0);
  const processingAmt = bom.processingFee || 0;
  const materialKrw = materialAmt * toKrw;
  const processingKrw = processingAmt * toKrw;
  const postProcessKrw = postProcessAmt * toKrw;
  const logisticsKrw = bom.logisticsCostKrw || 0;
  const packagingKrw = bom.packagingCostKrw || 0;
  const packingKrw = bom.packingCostKrw || 0;
  const marginRate = bom.productionMarginRate ?? 0.16;
  const subTotal = materialKrw + processingKrw + postProcessKrw + logisticsKrw + packagingKrw + packingKrw;
  const productionMarginKrw = subTotal * marginRate;
  const totalCostKrw = subTotal + productionMarginKrw;
  // 하위 호환성을 위해 Cny 명칭 유지
  return {
    materialCny: materialAmt, processingCny: processingAmt, postProcessCny: postProcessAmt,
    materialKrw, processingKrw, postProcessKrw,
    logisticsKrw, packagingKrw, packingKrw,
    productionMarginKrw, totalCostKrw, subTotal, marginRate,
    preCur, toKrw,
  };
}

// 사후원가 요약 계산
interface PostSummary {
  factoryMaterialCny: number;   // 공장구매 자재 (본사제공 제외)
  hqMaterialCny: number;        // 본사제공 자재
  totalMaterialCny: number;     // 자재비 합계
  processingCny: number;        // 임가공비
  factoryUnitCostCny: number;   // 공장단가 (공장구매자재 + 임가공비)
  totalCostCny: number;         // 제품원가 (전체)
  rate: number;                 // 적용 환율
  factoryMaterialKrw: number;
  hqMaterialKrw: number;
  totalMaterialKrw: number;
  processingKrw: number;
  factoryUnitCostKrw: number;
  totalCostKrw: number;
}

function calcPostSummary(bom: ExtBom, settingsUsdKrw = 1380): PostSummary {
  const materials = bom.postMaterials || [];
  const postCur = bom.currency || 'CNY';
  const cnyKrw = bom.exchangeRateCny || bom.snapshotCnyKrw || 191;
  const usdKrw = bom.exchangeRateUsd || settingsUsdKrw;
  const rate = postCur === 'USD' ? usdKrw : postCur === 'KRW' ? 1 : cnyKrw;

  const factoryMaterialCny = materials.reduce((s, l) => {
    if (l.isHqProvided) return s;
    return s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate);
  }, 0);
  const hqMaterialCny = materials.reduce((s, l) => {
    if (!l.isHqProvided) return s;
    return s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate);
  }, 0);
  const totalMaterialCny = factoryMaterialCny + hqMaterialCny;
  const processingCny = bom.postProcessingFee || 0;
  // 공장단가 = 공장구매자재 + 임가공비 (본사제공 제외)
  const factoryUnitCostCny = factoryMaterialCny + processingCny;
  // 제품원가 = 전체 자재 + 임가공비
  const totalCostCny = totalMaterialCny + processingCny;

  return {
    factoryMaterialCny,
    hqMaterialCny,
    totalMaterialCny,
    processingCny,
    factoryUnitCostCny,
    totalCostCny,
    rate,
    factoryMaterialKrw: factoryMaterialCny * rate,
    hqMaterialKrw: hqMaterialCny * rate,
    totalMaterialKrw: totalMaterialCny * rate,
    processingKrw: processingCny * rate,
    factoryUnitCostKrw: factoryUnitCostCny * rate,
    totalCostKrw: totalCostCny * rate,
  };
}

function calcPnl(totalCostKrw: number, pnl: BomPnlAssumptions) {
  const { discountRate, platformFeeRate, sgaRate, confirmedSalePrice } = pnl;
  const price35 = totalCostKrw * 3.5;
  const price40 = totalCostKrw * 4.0;
  const price45 = totalCostKrw * 4.5;
  const salePrice = confirmedSalePrice || 0;
  const netSale = salePrice * (1 - discountRate);
  const afterPlatform = netSale * (1 - platformFeeRate);
  const afterSga = afterPlatform * (1 - sgaRate);
  const operatingProfit = afterSga - totalCostKrw;
  const operatingMargin = salePrice > 0 ? operatingProfit / salePrice : 0;
  const actualMultiple = salePrice > 0 ? salePrice / totalCostKrw : 0;
  const costReductionNeeded = Math.max(0, totalCostKrw - salePrice / 3.5);
  return { price35, price40, price45, netSale, afterPlatform, afterSga, operatingProfit, operatingMargin, actualMultiple, costReductionNeeded, meets35x: actualMultiple >= 3.5 };
}

// ─── 기본값 생성 ─────────────────────────────────────────────────────────────
const newExtLine = (category: BomCategory): ExtBomLine => ({
  id: genId(), category, subPart: undefined, itemName: '', spec: '',
  unit: category === '원자재' ? 'SF' : 'EA', customUnit: '',
  unitPriceCny: 0, netQty: 0, lossRate: 0.05, isHqProvided: false, vendorName: '', memo: '',
});
const newPostLine = (): PostProcessLine => ({ id: genId(), name: '', netQty: 1, unitPrice: 0, memo: '' });
const defaultPnl = (): BomPnlAssumptions => ({ discountRate: 0.05, platformFeeRate: 0.30, sgaRate: 0.10 });

function createNewBom(settings: ReturnType<typeof store.getSettings>): ExtBom {
  return {
    id: genId(), styleId: '', styleNo: '', styleName: '', lineName: '', designer: '', erpCategory: '',
    size: '', boxSize: '', version: 1, season: settings.currentSeason,
    lines: BOM_SECTIONS.flatMap(cat => [newExtLine(cat)]),
    postProcessLines: [newPostLine()],
    processingFee: 0, logisticsCostKrw: 0, packagingCostKrw: 0, packingCostKrw: 0,
    productionMarginRate: 0.16, snapshotCnyKrw: settings.cnyKrw,
    pnl: defaultPnl(), sourceFileName: '',
    postMaterials: BOM_SECTIONS.flatMap(cat => [newExtLine(cat)]),
    postProcessingFee: 0,
    currency: 'CNY',
    manufacturingCountry: '중국',
    exchangeRateCny: settings.cnyKrw,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function normalizeBom(b: ExtBom): ExtBom {
  return {
    ...b,
    lines: Array.isArray(b.lines) ? b.lines.map(l => ({
      ...l,
      id: l.id || genId(),
      unitPriceCny: (l as ExtBomLine & { unitPrice?: number }).unitPriceCny ?? (l as ExtBomLine & { unitPrice?: number }).unitPrice ?? 0,
      lossRate: l.lossRate ?? 0.05,
      isHqProvided: l.isHqProvided ?? false,
    })) : [],
    postProcessLines: Array.isArray(b.postProcessLines) ? b.postProcessLines : [],
    pnl: b.pnl ?? defaultPnl(),
    processingFee: b.processingFee ?? 0,
    logisticsCostKrw: b.logisticsCostKrw ?? 0,
    packagingCostKrw: b.packagingCostKrw ?? 0,
    packingCostKrw: b.packingCostKrw ?? 0,
    productionMarginRate: b.productionMarginRate ?? 0.16,
    snapshotCnyKrw: b.snapshotCnyKrw ?? 191,
    postMaterials: Array.isArray(b.postMaterials) ? b.postMaterials.map(l => ({
      ...l,
      id: l.id || genId(),
      unitPriceCny: (l as ExtBomLine & { unitPrice?: number }).unitPriceCny ?? (l as ExtBomLine & { unitPrice?: number }).unitPrice ?? 0,
      lossRate: l.lossRate ?? 0.05,
      isHqProvided: l.isHqProvided ?? false,
    })) : BOM_SECTIONS.flatMap(cat => [newExtLine(cat)]),
    postProcessingFee: b.postProcessingFee ?? 0,
    currency: b.currency ?? 'CNY',
    manufacturingCountry: b.manufacturingCountry ?? '중국',
    exchangeRateCny: b.exchangeRateCny ?? b.snapshotCnyKrw ?? 191,
  };
}
function getExtBoms(): ExtBom[] {
  try {
    const raw = localStorage.getItem('ames_boms');
    if (!raw) return [];
    return (JSON.parse(raw) as ExtBom[]).map(normalizeBom);
  } catch { return []; }
}
function saveExtBoms(boms: ExtBom[]) {
  localStorage.setItem('ames_boms', JSON.stringify(boms));
}

// ─── 업체용 견적서 모달 ────────────────────────────────────────────────────────
interface QuoteRow {
  id: string;
  category: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  supplyAmt: number;
  taxAmt: number;
  memo?: string;
}

function buildQuoteRows(bom: ExtBom): QuoteRow[] {
  const cnyKrw = bom.snapshotCnyKrw || 191;
  const rows: QuoteRow[] = [];
  const matAmt = bom.lines.filter(l => l.category === '원자재' && !l.isHqProvided).reduce((s, l) => s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate) * cnyKrw, 0);
  if (matAmt > 0) rows.push({ id: genId(), category: '원자재', itemName: '원자재', qty: 1, unitPrice: Math.round(matAmt), supplyAmt: Math.round(matAmt), taxAmt: Math.round(matAmt * 0.1) });
  const subAmt = bom.lines.filter(l => ['지퍼', '장식', '보강재', '봉사·접착제'].includes(l.category) && !l.isHqProvided).reduce((s, l) => s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate) * cnyKrw, 0);
  if (subAmt > 0) rows.push({ id: genId(), category: '부자재', itemName: '부자재', qty: 1, unitPrice: Math.round(subAmt), supplyAmt: Math.round(subAmt), taxAmt: Math.round(subAmt * 0.1) });
  const packAmt = bom.lines.filter(l => l.category === '포장재' && !l.isHqProvided).reduce((s, l) => s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate) * cnyKrw, 0);
  if (packAmt > 0) rows.push({ id: genId(), category: '포장재', itemName: '포장재', qty: 1, unitPrice: Math.round(packAmt), supplyAmt: Math.round(packAmt), taxAmt: Math.round(packAmt * 0.1) });
  (bom.postProcessLines || []).filter(l => l.name && l.unitPrice > 0).forEach(l => {
    const amt = Math.round(l.netQty * l.unitPrice * cnyKrw);
    rows.push({ id: genId(), category: '후가공비', itemName: l.name, qty: l.netQty, unitPrice: Math.round(l.unitPrice * cnyKrw), supplyAmt: amt, taxAmt: Math.round(amt * 0.1) });
  });
  if (bom.processingFee > 0) {
    const amt = Math.round(bom.processingFee * cnyKrw);
    rows.push({ id: genId(), category: '가공비', itemName: '임가공', qty: 1, unitPrice: amt, supplyAmt: amt, taxAmt: Math.round(amt * 0.1) });
  }
  return rows;
}

function VendorQuoteModal({ bom, onClose }: { bom: ExtBom; onClose: () => void }) {
  const [rows, setRows] = useState<QuoteRow[]>(() => buildQuoteRows(bom));
  const [recipient, setRecipient] = useState('');
  const [dateStr, setDateStr] = useState(new Date().toISOString().split('T')[0]);
  const printRef = useRef<HTMLDivElement>(null);
  const totalSupply = rows.reduce((s, r) => s + r.supplyAmt, 0);
  const totalTax = rows.reduce((s, r) => s + r.taxAmt, 0);
  const grandTotal = totalSupply + totalTax;

  const updateRow = (id: string, field: keyof QuoteRow, val: string | number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const u = { ...r, [field]: val };
      if (field === 'qty' || field === 'unitPrice') { u.supplyAmt = Math.round(Number(u.qty) * Number(u.unitPrice)); u.taxAmt = Math.round(u.supplyAmt * 0.1); }
      if (field === 'supplyAmt') u.taxAmt = Math.round(Number(val) * 0.1);
      return u;
    }));
  };

  const handlePrint = () => {
    const html = printRef.current?.innerHTML;
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>견적서</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap');
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:'Noto Sans KR',sans-serif;font-size:11px;color:#1a1a1a;padding:24px}
      .wrap{max-width:780px;margin:0 auto}.hdr{display:flex;justify-content:space-between;margin-bottom:20px}
      .title{font-size:28px;font-weight:700;letter-spacing:10px}.co{text-align:right;font-size:10px;line-height:1.9;color:#444}
      .co-name{font-size:13px;font-weight:700;color:#1a1a1a}.gold{height:2px;background:linear-gradient(90deg,#C9A96E,#e8d5a3,#C9A96E);margin:14px 0}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;padding:12px 16px;background:#f8f6f0;border-left:3px solid #C9A96E}
      .mr{display:flex;gap:8px;font-size:11px}.ml{color:#666;min-width:60px}.mv{font-weight:600}
      .total-box{border:2px solid #1a1a1a;padding:10px 18px;margin-bottom:16px;display:flex;align-items:center;gap:14px}
      .tl{font-size:13px;font-weight:700}.ta{font-size:18px;font-weight:700;color:#C9A96E}
      .greet{font-size:11px;color:#444;margin-bottom:14px}
      table{width:100%;border-collapse:collapse}thead th{background:#1a1a1a;color:#fff;padding:7px 5px;font-size:10px;font-weight:600;text-align:center;border:1px solid #1a1a1a}
      tbody td{padding:6px 5px;border:1px solid #ddd;font-size:10px;text-align:center}tbody tr:nth-child(even){background:#fafaf7}
      .tl2{text-align:left!important}.tr2{text-align:right!important}.tot td{background:#f0ede4;font-weight:700;font-size:11px}
      .footer{margin-top:20px;text-align:center;font-size:10px;color:#888;border-top:1px solid #ddd;padding-top:10px}
    </style></head><body>${html}</body></html>`);
    w.document.close();
    setTimeout(() => { w.print(); w.close(); }, 500);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between">
          <DialogHeader>
            <DialogTitle className="text-stone-800 font-semibold text-sm">업체용 견적서 — {bom.styleNo} {bom.styleName}</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRows(p => [...p, { id: genId(), category: '', itemName: '', qty: 1, unitPrice: 0, supplyAmt: 0, taxAmt: 0 }])} className="text-xs gap-1">
              <Plus className="w-3 h-3" /> 행 추가
            </Button>
            <Button size="sm" onClick={handlePrint} className="text-xs gap-1 bg-[#C9A96E] hover:bg-[#b8944f] text-white">
              <Download className="w-3 h-3" /> PDF 출력
            </Button>
          </div>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs text-stone-500 mb-1 block">수신</label><Input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="수신처 입력" className="text-sm h-8" /></div>
            <div><label className="text-xs text-stone-500 mb-1 block">날짜</label><Input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} className="text-sm h-8" /></div>
          </div>
          <div className="bg-stone-50 border border-stone-200 rounded-lg px-4 py-3 flex items-center gap-4">
            <span className="text-sm font-semibold text-stone-700">합계금액 (공급가액+세액)</span>
            <span className="text-xl font-bold text-[#C9A96E]">{fmtKrw(grandTotal)}</span>
            <span className="text-xs text-stone-400 ml-auto">공급가액: {fmtKrw(totalSupply)} | 세액: {fmtKrw(totalTax)}</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-stone-800 text-white">
                  <th className="px-2 py-2 text-center w-8">No</th>
                  <th className="px-2 py-2 text-left w-20">구분</th>
                  <th className="px-2 py-2 text-left">품목</th>
                  <th className="px-2 py-2 text-right w-16">소요량</th>
                  <th className="px-2 py-2 text-right w-24">단가 (₩)</th>
                  <th className="px-2 py-2 text-right w-24">공급가액</th>
                  <th className="px-2 py-2 text-right w-20">세액</th>
                  <th className="px-2 py-2 text-right w-24">합계금액</th>
                  <th className="px-2 py-2 text-left w-20">비고</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-stone-50'}>
                    <td className="px-2 py-1.5 text-center text-stone-400">{idx + 1}</td>
                    <td className="px-1 py-1"><Input value={row.category} onChange={e => updateRow(row.id, 'category', e.target.value)} className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0" /></td>
                    <td className="px-1 py-1"><Input value={row.itemName} onChange={e => updateRow(row.id, 'itemName', e.target.value)} className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0" /></td>
                    <td className="px-1 py-1"><Input type="number" value={row.qty} onChange={e => updateRow(row.id, 'qty', Number(e.target.value))} className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-right" /></td>
                    <td className="px-1 py-1"><Input type="number" value={row.unitPrice} onChange={e => updateRow(row.id, 'unitPrice', Number(e.target.value))} className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-right" /></td>
                    <td className="px-1 py-1"><Input type="number" value={row.supplyAmt} onChange={e => updateRow(row.id, 'supplyAmt', Number(e.target.value))} className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-right" /></td>
                    <td className="px-2 py-1.5 text-right text-stone-600">{fmtKrw(row.taxAmt)}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{fmtKrw(row.supplyAmt + row.taxAmt)}</td>
                    <td className="px-1 py-1"><Input value={row.memo || ''} onChange={e => updateRow(row.id, 'memo', e.target.value)} className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0" placeholder="비고" /></td>
                    <td className="px-1 py-1 text-center"><button onClick={() => setRows(p => p.filter(r => r.id !== row.id))} className="text-stone-300 hover:text-red-400"><X className="w-3 h-3" /></button></td>
                  </tr>
                ))}
                <tr className="bg-[#f0ede4] font-semibold border-t-2 border-stone-300">
                  <td colSpan={5} className="px-2 py-2 text-right text-sm">TOTAL</td>
                  <td className="px-2 py-2 text-right text-sm">{fmtKrw(totalSupply)}</td>
                  <td className="px-2 py-2 text-right text-sm">{fmtKrw(totalTax)}</td>
                  <td className="px-2 py-2 text-right text-sm text-[#C9A96E]">{fmtKrw(grandTotal)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        {/* 인쇄용 숨김 영역 */}
        <div className="hidden">
          <div ref={printRef}>
            <div className="wrap">
              <div className="hdr">
                <div><div className="title">견 적 서</div></div>
                <div className="co"><div className="co-name">(주)아메스코테스</div><div>서울특별시 성북구 보문로13나길 27 1-4F</div><div>이원영 대표 / 한현석 과장</div><div>010.4098.2102 / 010.8420.2430</div></div>
              </div>
              <div className="gold"></div>
              <div className="meta">
                <div><div className="mr"><span className="ml">날  짜 :</span><span className="mv">{dateStr}</span></div><div className="mr"><span className="ml">수  신 :</span><span className="mv">{recipient}</span></div><div className="mr"><span className="ml">STYLE :</span><span className="mv">{bom.styleNo} {bom.styleName}</span></div></div>
                <div><div className="mr"><span className="ml">시  즌 :</span><span className="mv">{bom.season}</span></div><div className="mr"><span className="ml">환  율 :</span><span className="mv">CNY {bom.snapshotCnyKrw}</span></div></div>
              </div>
              <div className="greet">아래와 같이 견적합니다.</div>
              <div className="total-box"><span className="tl">합계금액 (공급가액 + 세액)</span><span className="ta">{fmtKrw(grandTotal)}</span></div>
              <table>
                <thead><tr><th style={{width:'28px'}}>No</th><th style={{width:'65px'}}>구분</th><th>품목</th><th style={{width:'55px'}}>소요량</th><th style={{width:'85px'}}>단가</th><th style={{width:'85px'}}>공급가액</th><th style={{width:'75px'}}>세액</th><th style={{width:'85px'}}>합계금액</th><th style={{width:'75px'}}>비고</th></tr></thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.id}><td>{idx + 1}</td><td className="tl2">{row.category}</td><td className="tl2">{row.itemName}</td><td className="tr2">{row.qty}</td><td className="tr2">{row.unitPrice.toLocaleString()}</td><td className="tr2">{row.supplyAmt.toLocaleString()}</td><td className="tr2">{row.taxAmt.toLocaleString()}</td><td className="tr2">{(row.supplyAmt + row.taxAmt).toLocaleString()}</td><td>{row.memo}</td></tr>
                  ))}
                  <tr className="tot"><td colSpan={5} className="tr2">TOTAL</td><td className="tr2">{totalSupply.toLocaleString()}</td><td className="tr2">{totalTax.toLocaleString()}</td><td className="tr2">{grandTotal.toLocaleString()}</td><td></td></tr>
                </tbody>
              </table>
              <div className="footer">본 견적서는 발행일로부터 30일간 유효합니다. | (주)아메스코테스</div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── 자재 검색 팝오버 ────────────────────────────────────────────────────────
function MaterialSearchPopover({ onSelect }: { onSelect: (m: Material) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const materials = store.getMaterials();

  const filtered = materials.filter(m => {
    const matchCat = filterCat === 'all' || m.category === filterCat;
    const matchSearch = !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.spec || '').toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors">
          <Search className="w-3 h-3" />자재
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-stone-700">자재 마스터 검색</p>
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="자재명 검색..." className="h-7 text-xs" />
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="w-full h-7 text-xs border border-stone-200 rounded px-2">
            <option value="all">전체 카테고리</option>
            {BOM_SECTIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-xs text-stone-400 text-center py-3">자재 없음</p>
            ) : filtered.map(m => (
              <button
                key={m.id}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-amber-50 text-xs"
                onClick={() => { onSelect(m); setOpen(false); setSearch(''); }}
              >
                <span className="font-medium text-stone-800">{m.name}</span>
                {m.spec && <span className="text-stone-400 ml-1">({m.spec})</span>}
                <span className="ml-1 text-amber-600">{m.unit}</span>
                {m.unitPriceCny != null && <span className="ml-1 text-stone-500">¥{m.unitPriceCny}</span>}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── BOM 행 컴포넌트 ─────────────────────────────────────────────────────────
function BomLineRow({ line, onChange, onDelete, cnyKrw, sectionKey = '원자재', accentColor = 'amber' }: {
  line: ExtBomLine;
  onChange: (id: string, field: keyof ExtBomLine, val: unknown) => void;
  onDelete: (id: string) => void;
  cnyKrw: number;
  sectionKey?: string;
  accentColor?: 'amber' | 'blue';
}) {
  const qty = calcQty(line.netQty, line.lossRate);
  const amt = line.unitPriceCny * qty;
  const vendors = store.getVendors().filter(v => v.type === '자재거래처');
  const isCustomUnit = line.unit === '직접입력';
  const displayUnit = isCustomUnit ? (line.customUnit || '') : line.unit;
  const subPartOptions = SECTION_SUB_PARTS[sectionKey] || ['기타'];

  const handleMaterialSelect = (m: Material) => {
    onChange(line.id, 'itemName', m.name);
    if (m.spec) onChange(line.id, 'spec', m.spec);
    // 단위 매핑: 자재 마스터 단위가 UNITS에 있으면 설정
    const unitInList = UNITS.find(u => u !== '직접입력' && u === m.unit);
    if (unitInList) {
      onChange(line.id, 'unit', m.unit);
    } else if (m.unit) {
      onChange(line.id, 'unit', '직접입력');
      onChange(line.id, 'customUnit', m.unit);
    }
    if (m.unitPriceCny != null) onChange(line.id, 'unitPriceCny', m.unitPriceCny);
    if (m.vendorId) {
      const vendor = store.getVendors().find(v => v.id === m.vendorId);
      if (vendor) onChange(line.id, 'vendorName', vendor.name);
    }
  };

  const ringCls = accentColor === 'blue'
    ? 'hover:bg-blue-50/30'
    : 'hover:bg-amber-50/30';

  return (
    <tr className={`group transition-colors border-b border-stone-100 ${ringCls}`}>
      {/* 자재명 (부위 Select가 inline으로 포함됨) */}
      <td className="px-1 py-1">
        <div className="flex items-center gap-1">
          {/* 부위 Select - 모든 섹션에 inline 배치 */}
          <Select value={line.subPart || ''} onValueChange={v => onChange(line.id, 'subPart', v as BomSubPart)}>
            <SelectTrigger className="h-7 text-xs border-stone-200 w-20 shrink-0">
              <SelectValue placeholder="-" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs text-stone-400">-</SelectItem>
              {subPartOptions.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <MaterialSearchPopover onSelect={handleMaterialSelect} />
          <Input value={line.itemName} onChange={e => onChange(line.id, 'itemName', e.target.value)} className="h-7 text-xs border-stone-200 bg-white min-w-[80px]" placeholder="자재명" />
        </div>
      </td>
      {/* 규격 */}
      <td className="px-1 py-1"><Input value={line.spec || ''} onChange={e => onChange(line.id, 'spec', e.target.value)} className="h-7 text-xs border-stone-200 bg-white min-w-[60px]" placeholder="규격" /></td>
      {/* 단위 */}
      <td className="px-1 py-1">
        <div className="flex flex-col gap-0.5">
          <Select value={line.unit} onValueChange={v => { onChange(line.id, 'unit', v); if (v !== '직접입력') onChange(line.id, 'customUnit', ''); }}>
            <SelectTrigger className="h-7 text-xs border-stone-200 w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNITS.map(u => <SelectItem key={u} value={u} className={`text-xs ${u === '직접입력' ? 'border-t border-stone-200 text-stone-500 italic' : ''}`}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
          {isCustomUnit && (
            <Input
              value={line.customUnit || ''}
              onChange={e => onChange(line.id, 'customUnit', e.target.value)}
              className="h-6 text-xs border-stone-300 bg-amber-50 w-20"
              placeholder="단위 입력"
            />
          )}
        </div>
      </td>
      {/* 단가 */}
      <td className="px-1 py-1"><Input type="number" value={line.unitPriceCny || ''} onChange={e => onChange(line.id, 'unitPriceCny', Number(e.target.value))} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder="0" /></td>
      {/* NET 소요량 */}
      <td className="px-1 py-1"><Input type="number" value={line.netQty || ''} onChange={e => onChange(line.id, 'netQty', Number(e.target.value))} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder="0" /></td>
      {/* LOSS */}
      <td className="px-1 py-1"><Input type="number" value={line.lossRate * 100 || ''} onChange={e => onChange(line.id, 'lossRate', Number(e.target.value) / 100)} className="h-7 text-xs border-stone-200 bg-white text-right w-14" placeholder="5" /></td>
      {/* 소요량 */}
      <td className="px-2 py-1 text-right text-xs text-stone-500 tabular-nums">{fmt(qty)} {displayUnit && <span className="text-[10px] text-stone-400">{displayUnit}</span>}</td>
      {/* 제조금액 */}
      <td className="px-2 py-1 text-right text-xs font-medium tabular-nums">{fmt(amt)}</td>
      {/* KRW */}
      <td className="px-2 py-1 text-right text-xs text-stone-500 tabular-nums">{fmtKrw(amt * cnyKrw)}</td>
      {/* 본사제공 */}
      <td className="px-2 py-1 text-center"><input type="checkbox" checked={line.isHqProvided} onChange={e => onChange(line.id, 'isHqProvided', e.target.checked)} className="w-3.5 h-3.5 accent-amber-600" /></td>
      {/* 업체제공 */}
      <td className="px-2 py-1 text-center"><input type="checkbox" checked={!!(line as ExtBomLine & { isVendorProvided?: boolean }).isVendorProvided} onChange={e => onChange(line.id, 'isVendorProvided', e.target.checked)} className="w-3.5 h-3.5 accent-blue-500" /></td>
      {/* 구매업체 */}
      <td className="px-1 py-1">
        <Select
          value={line.vendorName || ''}
          onValueChange={v => onChange(line.id, 'vendorName', v === '__direct__' ? '' : v)}
        >
          <SelectTrigger className="h-7 text-xs border-stone-200 w-24">
            <SelectValue placeholder="업체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs text-stone-400">-</SelectItem>
            {vendors.map(v => <SelectItem key={v.id} value={v.name} className="text-xs">{v.name}</SelectItem>)}
            <SelectItem value="__direct__" className="text-xs text-stone-500 italic border-t border-stone-200">직접입력</SelectItem>
          </SelectContent>
        </Select>
        {/* 직접입력 또는 드롭다운에 없는 값 */}
        {line.vendorName && !vendors.find(v => v.name === line.vendorName) && (
          <Input
            value={line.vendorName}
            onChange={e => onChange(line.id, 'vendorName', e.target.value)}
            className="h-6 text-xs border-stone-300 bg-amber-50 mt-0.5 w-24"
            placeholder="업체명"
          />
        )}
      </td>
      {/* 삭제 */}
      <td className="px-1 py-1"><button onClick={() => onDelete(line.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-stone-300 hover:text-red-400 p-0.5"><Trash2 className="w-3.5 h-3.5" /></button></td>
    </tr>
  );
}

// ─── 사후원가 요약 컴포넌트 ───────────────────────────────────────────────────
function PostCostSummary({
  bom,
  items,
  onDeliveryPriceChange,
}: {
  bom: ExtBom;
  items: Item[];
  onDeliveryPriceChange: (val: number) => void;
}) {
  const settingsForSummary = store.getSettings();
  const ps = calcPostSummary(bom, settingsForSummary.usdKrw);
  const currency = bom.currency || 'CNY';
  const currSymbol = currency === 'KRW' ? '₩' : currency === 'USD' ? '$' : '¥';
  const showKrw = currency !== 'KRW';

  // 납품가: postDeliveryPrice 우선, 없으면 품목 마스터
  const linkedItem = items.find(i => i.id === bom.styleId);
  const deliveryPrice = bom.postDeliveryPrice || linkedItem?.deliveryPrice || linkedItem?.targetSalePrice || 0;
  const marginAmt = deliveryPrice > 0 ? deliveryPrice - ps.totalCostKrw : 0;
  const marginPct = deliveryPrice > 0 ? (marginAmt / deliveryPrice) * 100 : 0;
  const marginClass = marginPct < 15 ? 'text-red-600' : marginPct < 30 ? 'text-yellow-600' : 'text-green-600';
  const marginBgClass = marginPct < 15 ? 'bg-red-50 border-red-200' : marginPct < 30 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200';
  const marginLabel = marginPct < 15 ? '🔴 위험' : marginPct < 30 ? '🟡 주의' : '✅ 양호';

  const fmtCny = (n: number) => `${currSymbol}${n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`;

  return (
    <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100 bg-stone-800 text-white flex items-center justify-between">
        <h2 className="text-sm font-semibold">사후 원가 요약 <span className="text-stone-400 text-xs font-normal ml-2">— 공장 실제 원가 기준</span></h2>
        {ps.totalMaterialCny > 0 && (
          <span className="text-xs text-stone-400">적용 환율: {currency === 'CNY' ? `CNY ${ps.rate}` : currency === 'USD' ? `USD ${bom.exchangeRateUsd || 1380}` : 'KRW 직접'}</span>
        )}
      </div>
      <div className="p-5 space-y-3">
        {/* 자재비 상세 */}
        <div className="bg-stone-50 rounded-lg border border-stone-200 overflow-hidden">
          <div className="px-4 py-2 bg-stone-100 border-b border-stone-200">
            <span className="text-xs font-semibold text-stone-600">자재비 합계</span>
            <span className="float-right text-xs font-bold text-stone-800">
              {fmtCny(ps.totalMaterialCny)} {showKrw && <span className="text-stone-500">→ {fmtKrw(ps.totalMaterialKrw)}</span>}
            </span>
          </div>
          <div className="px-4 py-2 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-stone-500 pl-3">- 공장구매 자재 <span className="text-[10px] text-stone-400">(본사제공 제외)</span></span>
              <span className="text-stone-700 font-medium">
                {fmtCny(ps.factoryMaterialCny)} {showKrw && <span className="text-stone-500">→ {fmtKrw(ps.factoryMaterialKrw)}</span>}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-stone-500 pl-3">- 본사제공 자재</span>
              <span className="text-stone-700 font-medium">
                {fmtCny(ps.hqMaterialCny)} {showKrw && <span className="text-stone-500">→ {fmtKrw(ps.hqMaterialKrw)}</span>}
              </span>
            </div>
          </div>
        </div>

        {/* 임가공비 */}
        <div className="flex justify-between items-center px-4 py-2 bg-stone-50 rounded-lg border border-stone-200 text-xs">
          <span className="text-stone-600 font-medium">임가공비</span>
          <span className="text-stone-800 font-medium">
            {fmtCny(ps.processingCny)} {showKrw && <span className="text-stone-500">→ {fmtKrw(ps.processingKrw)}</span>}
          </span>
        </div>

        {/* 구분선 */}
        <div className="border-t border-stone-200 my-1" />

        {/* 공장단가 (강조) */}
        <div className="bg-amber-50 rounded-xl border-2 border-amber-300 px-4 py-3">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm font-bold text-stone-800">🏭 공장단가</span>
              <div className="text-[10px] text-stone-500 mt-0.5">공장 결제금액 (공장구매자재 + 임가공)</div>
            </div>
            <div className="text-right">
              <div className="text-base font-bold text-amber-700">{fmtCny(ps.factoryUnitCostCny)}</div>
              {showKrw && <div className="text-sm font-semibold text-stone-600">{fmtKrw(ps.factoryUnitCostKrw)}</div>}
            </div>
          </div>
        </div>

        {/* 제품원가 */}
        <div className="bg-stone-800 rounded-xl px-4 py-3">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm font-bold text-white">📦 제품원가</span>
              <div className="text-[10px] text-stone-400 mt-0.5">전체 원가 (본사제공 포함)</div>
            </div>
            <div className="text-right">
              <div className="text-base font-bold text-[#C9A96E]">{fmtCny(ps.totalCostCny)}</div>
              {showKrw && <div className="text-sm font-semibold text-stone-300">{fmtKrw(ps.totalCostKrw)}</div>}
            </div>
          </div>
        </div>

        {/* 구분선 */}
        <div className="border-t border-stone-200 my-1" />

        {/* 납품가 */}
        <div className="flex items-center gap-3 px-1">
          <label className="text-xs font-semibold text-stone-700 whitespace-nowrap">납품가 (KRW)</label>
          <Input
            type="number"
            value={deliveryPrice || ''}
            onChange={e => onDeliveryPriceChange(Number(e.target.value))}
            className="h-8 text-sm border-stone-300 text-right w-36 font-semibold"
            placeholder="납품가 입력"
          />
          {linkedItem?.deliveryPrice && linkedItem.deliveryPrice !== bom.postDeliveryPrice && (
            <span className="text-[10px] text-stone-400">품목마스터: {fmtKrw(linkedItem.deliveryPrice)}</span>
          )}
        </div>

        {/* 마진 */}
        {deliveryPrice > 0 && (
          <div className={`rounded-xl border px-4 py-3 ${marginBgClass}`}>
            <div className="flex justify-between items-center">
              <div>
                <div className="text-xs text-stone-600">마진율</div>
                <div className={`text-2xl font-bold ${marginClass}`}>{marginPct.toFixed(1)}%</div>
                <div className="text-[10px] text-stone-500 mt-0.5">{marginLabel}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-stone-600">마진금액</div>
                <div className={`text-lg font-bold ${marginClass}`}>{fmtKrw(marginAmt)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function BomManagement() {
  const settings = store.getSettings();
  const items = store.getItems();
  const buyers = store.getVendors().filter(v => v.type === '바이어');

  // 현재 활성 탭: 사전원가 or 사후원가
  const [activeTab, setActiveTab] = useState<'pre' | 'post'>('pre');

  const [extBoms, setExtBoms] = useState<ExtBom[]>(() => getExtBoms());
  const [selectedStyleId, setSelectedStyleId] = useState<string>(() => {
    const prefillStyleNo = localStorage.getItem('ames_prefill_bom');
    if (prefillStyleNo) {
      localStorage.removeItem('ames_prefill_bom');
      const item = store.getItems().find(i => i.styleNo === prefillStyleNo);
      return item?.id || '';
    }
    return '';
  });
  const [filterBuyerBom, setFilterBuyerBom] = useState<string>('all');
  const [styleSearch, setStyleSearch] = useState<string>('');
  const [editBom, setEditBom] = useState<ExtBom | null>(null);
  const [showQuote, setShowQuote] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySourceId, setCopySourceId] = useState('');
  // 원자재 섹션은 기본 펼침, 나머지는 기본 접힘
  const NON_RAW_SECTIONS = ['지퍼', '장식', '보강재', '봉사·접착제', '포장재', '철형', '후가공'];
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(NON_RAW_SECTIONS));
  const [collapsedPostSections, setCollapsedPostSections] = useState<Set<string>>(new Set(NON_RAW_SECTIONS.filter(s => s !== '후가공')));
  const [isDirty, setIsDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const preFileRef = useRef<HTMLInputElement>(null);
  const postFileRef = useRef<HTMLInputElement>(null);

  const markDirty = () => setIsDirty(true);

  // 스타일 선택 시 BOM 로드
  useEffect(() => {
    if (!selectedStyleId) { setEditBom(null); return; }
    const item = items.find(i => i.id === selectedStyleId);
    const styleBoms = extBoms.filter(b => b.styleId === selectedStyleId);
    if (styleBoms.length > 0) {
      const loaded: ExtBom = JSON.parse(JSON.stringify(styleBoms.sort((a, b) => b.version - a.version)[0]));
      if (item) {
        loaded.styleNo = item.styleNo;
        loaded.styleName = item.name;
        loaded.season = item.season;
        loaded.designer = (item as Item & { designer?: string }).designer || loaded.designer || '';
        loaded.erpCategory = item.erpCategory || loaded.erpCategory || '';
      }
      setEditBom(normalizeBom(loaded));
    } else {
      if (item) {
        const nb = createNewBom(settings);
        nb.styleId = item.id;
        nb.styleNo = item.styleNo;
        nb.styleName = item.name;
        nb.season = item.season;
        nb.designer = (item as Item & { designer?: string }).designer || '';
        nb.erpCategory = item.erpCategory || '';
        setEditBom(nb);
      }
    }
    setIsDirty(false);
  }, [selectedStyleId]);

  const updateField = useCallback(<K extends keyof ExtBom>(field: K, val: ExtBom[K]) => {
    setEditBom(prev => prev ? { ...prev, [field]: val } : prev);
    markDirty();
  }, []);

  // 사전원가 자재 행 업데이트
  const updateLine = useCallback((id: string, field: keyof ExtBomLine, val: unknown) => {
    setEditBom(prev => prev ? { ...prev, lines: prev.lines.map(l => l.id === id ? { ...l, [field]: val } : l) } : prev);
    markDirty();
  }, []);

  const deleteLine = useCallback((id: string) => {
    setEditBom(prev => prev ? { ...prev, lines: prev.lines.filter(l => l.id !== id) } : prev);
    markDirty();
  }, []);

  const addLine = useCallback((category: BomCategory) => {
    setEditBom(prev => {
      if (!prev) return prev;
      const idx = [...prev.lines].map(l => l.category).lastIndexOf(category);
      const lines = [...prev.lines];
      lines.splice(idx + 1, 0, newExtLine(category));
      return { ...prev, lines };
    });
    markDirty();
  }, []);

  // 사후원가 자재 행 업데이트
  const updatePostMaterialLine = useCallback((id: string, field: keyof ExtBomLine, val: unknown) => {
    setEditBom(prev => prev ? { ...prev, postMaterials: (prev.postMaterials || []).map(l => l.id === id ? { ...l, [field]: val } : l) } : prev);
    markDirty();
  }, []);

  const deletePostMaterialLine = useCallback((id: string) => {
    setEditBom(prev => prev ? { ...prev, postMaterials: (prev.postMaterials || []).filter(l => l.id !== id) } : prev);
    markDirty();
  }, []);

  const addPostMaterialLine = useCallback((category: BomCategory) => {
    setEditBom(prev => {
      if (!prev) return prev;
      const mats = prev.postMaterials || [];
      const idx = [...mats].map(l => l.category).lastIndexOf(category);
      const newMats = [...mats];
      newMats.splice(idx + 1, 0, newExtLine(category));
      return { ...prev, postMaterials: newMats };
    });
    markDirty();
  }, []);

  const updatePostLine = useCallback((id: string, field: keyof PostProcessLine, val: unknown) => {
    setEditBom(prev => prev ? { ...prev, postProcessLines: prev.postProcessLines.map(l => l.id === id ? { ...l, [field]: val } : l) } : prev);
    markDirty();
  }, []);

  const deletePostLine = useCallback((id: string) => {
    setEditBom(prev => prev ? { ...prev, postProcessLines: prev.postProcessLines.filter(l => l.id !== id) } : prev);
    markDirty();
  }, []);

  const updatePnl = useCallback(<K extends keyof BomPnlAssumptions>(field: K, val: BomPnlAssumptions[K]) => {
    setEditBom(prev => prev ? { ...prev, pnl: { ...(prev.pnl || defaultPnl()), [field]: val } } : prev);
    markDirty();
  }, []);

  const handleSave = () => {
    if (!editBom) return;
    if (!editBom.styleId) { toast.error('스타일을 선택해주세요'); return; }
    const updated = { ...editBom, updatedAt: new Date().toISOString() };
    const existing = extBoms.find(b => b.id === updated.id);
    let newBoms: ExtBom[];
    if (existing) {
      newBoms = extBoms.map(b => b.id === updated.id ? updated : b);
    } else {
      newBoms = [...extBoms, updated];
    }
    saveExtBoms(newBoms);
    setExtBoms(newBoms);
    const summary = calcSummary(updated);
    store.updateItem(editBom.styleId, {
      baseCostKrw: Math.round(summary.totalCostKrw),
      hasBom: true,
    });
    setIsDirty(false);
    toast.success('BOM이 저장되었습니다');
  };

  const handleCopyBom = () => {
    if (!copySourceId || !selectedStyleId) { toast.error('복사할 BOM과 대상 스타일을 선택해주세요'); return; }
    const source = extBoms.find(b => b.id === copySourceId);
    const item = items.find(i => i.id === selectedStyleId);
    if (!source || !item) return;
    const copied: ExtBom = {
      ...JSON.parse(JSON.stringify(source)),
      id: genId(), styleId: item.id, styleNo: item.styleNo, styleName: item.name,
      version: 1,
      lines: source.lines.map(l => ({ ...l, id: genId() })),
      postProcessLines: source.postProcessLines.map(l => ({ ...l, id: genId() })),
      postMaterials: (source.postMaterials || []).map(l => ({ ...l, id: genId() })),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const newBoms = [...extBoms, copied];
    saveExtBoms(newBoms);
    setExtBoms(newBoms);
    setEditBom(copied);
    setIsDirty(false);
    setShowCopyModal(false);
    toast.success(`${source.styleNo} BOM을 ${item.styleNo}으로 복사했습니다`);
  };

  // 사전원가 → 사후원가 복사
  const handleCopyPreToPost = () => {
    if (!editBom) return;
    if (!confirm('사전원가 데이터를 사후원가로 복사하시겠습니까?\n기존 사후원가 데이터가 덮어씌워집니다.')) return;
    setEditBom(prev => prev ? {
      ...prev,
      postMaterials: prev.lines.map(l => ({ ...l, id: genId() })),
      postProcessingFee: prev.processingFee,
      exchangeRateCny: prev.snapshotCnyKrw,
    } : prev);
    markDirty();
    toast.success('사전원가 데이터를 사후원가로 복사했습니다');
  };

  // 사전원가 엑셀 업로드
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null });

      const getString = (row: (string | number | null)[], col: number) => String(row?.[col] || '').trim();
      const getNum = (row: (string | number | null)[], col: number) => Number(row?.[col]) || 0;

      const lineName = getString(raw[3], 1).replace(/라\s*인\s*명\s*:/i, '').trim();
      const styleNo = getString(raw[4], 1).replace(/STYLE\s*NO\s*:/i, '').trim();
      const designer = getString(raw[5], 1).replace(/담당\s*디자이너\s*:/i, '').trim();
      const size = getString(raw[6], 1);
      const boxSize = getString(raw[8], 1);
      const cnyKrw = getNum(raw[8], 7) || settings.cnyKrw;

      const sectionRanges: { cat: BomCategory; start: number; end: number }[] = [
        { cat: '원자재', start: 10, end: 15 },
        { cat: '지퍼', start: 16, end: 24 },
        { cat: '장식', start: 25, end: 33 },
        { cat: '보강재', start: 34, end: 43 },
        { cat: '봉사·접착제', start: 44, end: 63 },
        { cat: '포장재', start: 64, end: 88 },
        { cat: '철형', start: 89, end: 92 },
      ];

      const lines: ExtBomLine[] = [];
      for (const { cat, start, end } of sectionRanges) {
        for (let r = start; r <= end && r < raw.length; r++) {
          const row = raw[r];
          if (!row) continue;
          const itemName = getString(row, 2);
          if (!itemName) continue;
          lines.push({
            id: genId(), category: cat,
            itemName, spec: getString(row, 3), unit: getString(row, 4) || 'EA',
            unitPriceCny: getNum(row, 6), netQty: getNum(row, 5),
            lossRate: getNum(row, 7) || 0.05,
            isHqProvided: getString(row, 12).includes('본사'),
            vendorName: '', memo: '',
          });
        }
      }

      const postLines: PostProcessLine[] = [];
      for (let r = 95; r <= 103 && r < raw.length; r++) {
        const row = raw[r];
        if (!row) continue;
        const name = getString(row, 1);
        if (!name) continue;
        const unitPrice = getNum(row, 3);
        if (unitPrice > 0) postLines.push({ id: genId(), name, netQty: getNum(row, 2) || 1, unitPrice, memo: '' });
      }

      const processingFee = raw[99] ? getNum(raw[99], 4) : 0;
      const item = items.find(i => i.styleNo === styleNo);
      const nb = createNewBom(settings);
      nb.styleId = item?.id || (selectedStyleId || '');
      nb.styleNo = item?.styleNo || styleNo || editBom?.styleNo || '';
      nb.styleName = item?.name || editBom?.styleName || '';
      nb.lineName = lineName;
      nb.designer = (item as (Item & { designer?: string }) | undefined)?.designer || designer;
      nb.erpCategory = item?.erpCategory || '';
      nb.season = item?.season || nb.season;
      nb.size = size; nb.boxSize = boxSize;
      nb.snapshotCnyKrw = cnyKrw;
      nb.lines = lines.length > 0 ? lines : nb.lines;
      nb.postProcessLines = postLines.length > 0 ? postLines : nb.postProcessLines;
      nb.processingFee = processingFee;
      nb.sourceFileName = file.name;
      if (item) setSelectedStyleId(item.id);
      setEditBom(nb);
      setIsDirty(true);
      toast.success(`엑셀 파싱 완료: ${lines.length}개 자재 행 로드됨`);
    } catch (err) {
      console.error(err);
      toast.error('엑셀 파싱 실패. 파일 형식을 확인해주세요.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  // 사전원가 원가표 업로드 (preMaterials에 저장)
  // ── 엑셀 원가표 공통 파싱 헬퍼 ─────────────────────────────────────────────
  // 컬럼 구조 (고정):
  //   A(0):구분  B(1):부위/품목  C(2):자재명  D(3):규격  E(4):단위
  //   F(5):단가  G(6):NET  H(7):LOSS  I(8):소요량  J(9):제조금액
  //   K(10):본사제공  M(12):구매업체
  // 후가공 섹션: B열=작업명, D열=단가, E열=금액
  // 임가공비: '임가공' 키워드 행의 L열(11)
  // 환율: row[8](index 8)의 I열(8)

  const SECTION_MAP: Record<string, BomCategory> = {
    '원': '원자재',
    '지퍼': '지퍼',
    '장식': '장식',
    '보강': '보강재',
    '봉사': '봉사·접착제',
    '포장': '포장재',
    '철형': '철형',
  };

  const detectCategory = (cellVal: string): BomCategory | null => {
    for (const [key, cat] of Object.entries(SECTION_MAP)) {
      if (cellVal.includes(key)) return cat;
    }
    return null;
  };

  const parseExcelBomSheet = (raw: (string | number | null)[][], fallbackRate: number) => {
    const getString = (row: (string | number | null)[], col: number) => String(row?.[col] ?? '').trim();
    const getNum = (row: (string | number | null)[], col: number) => {
      const v = Number(row?.[col]);
      return isNaN(v) ? 0 : v;
    };

    // 1. 환율: row index 8(9번째 행)의 I열(index 8)
    let parsedRate = 0;
    if (raw[8]) parsedRate = getNum(raw[8], 8);
    // 못 찾으면 전체 행 스캔
    if (!parsedRate) {
      for (let r = 0; r < Math.min(20, raw.length); r++) {
        const row = raw[r];
        if (!row) continue;
        const rowStr = row.map(c => String(c ?? '')).join(' ');
        if (rowStr.includes('환율') || rowStr.includes('汇率') || rowStr.includes('Exchange')) {
          for (let c = row.length - 1; c >= 0; c--) {
            const v = Number(row[c]);
            if (v > 100 && v < 300) { parsedRate = v; break; }
          }
        }
      }
    }
    if (!parsedRate) parsedRate = fallbackRate;

    // 2. 헤더 행 찾기 (구분/품목 + 단가 포함)
    let dataStart = 10; // 기본 시작 행
    for (let r = 0; r < Math.min(30, raw.length); r++) {
      const row = raw[r];
      if (!row) continue;
      const rowStr = row.map(c => String(c ?? '')).join(' ');
      if ((rowStr.includes('구분') || rowStr.includes('품목')) && rowStr.includes('단가')) {
        dataStart = r + 1;
        break;
      }
    }

    const materials: ExtBomLine[] = [];
    const postProcessLines: PostProcessLine[] = [];
    let parsedProcessingFee = 0;
    let currentCategory: BomCategory = '원자재';
    let inPostProcess = false;

    for (let r = dataStart; r < raw.length; r++) {
      const row = raw[r];
      if (!row) continue;

      const cellA = getString(row, 0); // 구분
      const cellB = getString(row, 1); // 부위/품목
      const cellC = getString(row, 2); // 자재명
      const cellK = getString(row, 10); // 본사제공
      const cellL = getNum(row, 11);   // L열 (임가공/공장단가 금액)
      const rowStr = row.map(c => String(c ?? '')).join(' ');

      // 후가공 섹션 시작 감지
      if (rowStr.includes('부·소모재') || rowStr.includes('부소모재')) {
        inPostProcess = true;
        continue;
      }
      // A열이 '후가공비'인 행도 후가공 섹션 시작
      if (cellA.includes('후가공')) {
        inPostProcess = true;
        continue; // 헤더 행 스킵
      }

      // 구분(A열)에 값 있으면 섹션 갱신
      if (cellA) {
        const detected = detectCategory(cellA);
        if (detected) {
          currentCategory = detected;
          inPostProcess = false;
        }
        // 소계/합계/총계 행은 스킵
        if (cellA.includes('소계') || cellA.includes('합계') || cellA.includes('총계')) continue;
      }

      // 임가공비 행 감지: G열(6)='임가공' 텍스트, 값은 H열(8)
      const cellG = row[6] ? String(row[6]).trim() : '';
      if (cellG.includes('임가공')) {
        const fee = getNum(row, 8); // H열(8)에 임가공비 금액
        if (fee > 0) parsedProcessingFee = fee;
        continue;
      }
      // 공장단가/제품원가 행 스킵
      if (cellG.includes('공장단가') || cellG.includes('제품원가')) continue;

      // 공장단가/제품원가 행은 스킵 (ERP 내부 계산으로 대체)
      if (rowStr.includes('공장단가') || rowStr.includes('제품원가')) continue;

      // 후가공 섹션 처리
      // 실제 구조: B열=작업명, C열=NET, D열=단가, E열=금액
      if (inPostProcess) {
        const workName = cellB;
        if (!workName || workName === '소계' || workName === '공임비') continue;
        // D열=단가(index 3), E열=금액(index 4)
        const unitPrice = getNum(row, 3);
        const amount = getNum(row, 4);
        const netQtyPost = getNum(row, 2); // C열=NET
        if (workName && (unitPrice > 0 || amount > 0)) {
          postProcessLines.push({
            id: Math.random().toString(36).slice(2),
            name: workName.trim(),
            netQty: netQtyPost || 1,
            unitPrice: unitPrice || (netQtyPost > 0 ? amount / netQtyPost : amount),
            memo: '',
          });
        }
        continue;
      }

      // 자재명: C열 우선, 없으면 B열
      const itemName = cellC || cellB;
      if (!itemName) continue;

      // 소계/합계/총계 행 스킵
      if (itemName.includes('소계') || itemName.includes('합계') || itemName.includes('총계')) continue;

      const subPart = cellC ? cellB : undefined; // C열이 있으면 B열이 subPart
      const spec = getString(row, 3);            // D열: 규격
      const unit = getString(row, 4) || 'EA';    // E열: 단위
      const unitPriceRaw = getNum(row, 5);       // F열: 단가 (CNY)
      const netQty = getNum(row, 6);             // G열: NET
      const lossRate = getNum(row, 7);           // H열: LOSS (0.1 = 10%)
      const qtyDirect = getNum(row, 8);          // I열: 소요량 (이미 계산된 값)
      const amountDirect = getNum(row, 9);       // J열: 제조금액

      // NET도 소요량도 없으면 스킵
      const effectiveNet = netQty || qtyDirect;
      if (!effectiveNet && !amountDirect) continue;

      // 단가: F열 직접 사용. 없으면 제조금액/소요량 역산
      let unitPrice = unitPriceRaw;
      if (!unitPrice && amountDirect > 0 && qtyDirect > 0) {
        unitPrice = amountDirect / qtyDirect;
      }

      // 본사제공: K열(10)에 값 있으면 true
      const isHqProvided = cellK.length > 0 && cellK !== '0';

      // 구매업체: M열(12)
      const vendorName = getString(row, 12);

      materials.push({
        id: genId(),
        category: currentCategory,
        subPart: subPart as BomSubPart | undefined,
        itemName,
        spec,
        unit,
        unitPriceCny: unitPrice,
        netQty: netQty || qtyDirect,
        lossRate: lossRate || 0,
        isHqProvided,
        vendorName,
        memo: '',
      });
    }

    return { materials, parsedProcessingFee, parsedRate, postProcessLines };
  };

  const handlePreExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editBom) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null });

      const fallback = editBom.preExchangeRateCny ?? editBom.snapshotCnyKrw ?? 191;
      const { materials: preMaterials, parsedProcessingFee, parsedRate, postProcessLines: parsedPostLines } = parseExcelBomSheet(raw, fallback);

      setEditBom(prev => prev ? {
        ...prev,
        lines: preMaterials.length > 0 ? preMaterials : prev.lines,
        processingFee: parsedProcessingFee || prev.processingFee,
        postProcessLines: parsedPostLines.length > 0 ? parsedPostLines : prev.postProcessLines,
        snapshotCnyKrw: parsedRate,
        preSourceFileName: file.name,
      } : prev);
      markDirty();
      toast.success(`원가표 파싱 완료: ${preMaterials.length}개 자재 행, 후가공 ${parsedPostLines.length}개, 임가공 ${parsedProcessingFee}, 환율 ${parsedRate}`);
    } catch (err) {
      console.error(err);
      toast.error('원가표 파싱 실패. 파일 형식을 확인해주세요.');
    }
    if (preFileRef.current) preFileRef.current.value = '';
  };

  // 사후원가 공장 원가표 업로드
  const handlePostExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editBom) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null });

      const fallback = editBom.exchangeRateCny ?? editBom.snapshotCnyKrw ?? 191;
      const { materials: postMaterials, parsedProcessingFee, parsedRate, postProcessLines: parsedPostLines2 } = parseExcelBomSheet(raw, fallback);

      setEditBom(prev => prev ? {
        ...prev,
        postMaterials: postMaterials.length > 0 ? postMaterials : prev.postMaterials,
        postProcessingFee: parsedProcessingFee || prev.postProcessingFee,
        postProcessLines: parsedPostLines2.length > 0 ? parsedPostLines2 : prev.postProcessLines,
        exchangeRateCny: parsedRate,
        postSourceFileName: file.name,
      } : prev);
      markDirty();
      toast.success(`공장 원가표 파싱 완료: ${postMaterials.length}개 자재 행, 후가공 ${parsedPostLines2.length}개, 임가공 ${parsedProcessingFee}, 환율 ${parsedRate}`);
    } catch (err) {
      console.error(err);
      toast.error('공장 원가표 파싱 실패. 파일 형식을 확인해주세요.');
    }
    if (postFileRef.current) postFileRef.current.value = '';
  };

  const toggleSection = (cat: string) => {
    setCollapsedSections(prev => { const s = new Set(prev); s.has(cat) ? s.delete(cat) : s.add(cat); return s; });
  };
  const togglePostSection = (cat: string) => {
    setCollapsedPostSections(prev => { const s = new Set(prev); s.has(cat) ? s.delete(cat) : s.add(cat); return s; });
  };

  // BOM 목록 다중 선택
  const [selectedBomIds, setSelectedBomIds] = useState<Set<string>>(new Set());
  const isAllBomSelected = extBoms.length > 0 && extBoms.every(b => selectedBomIds.has(b.id));
  const isBomIndeterminate = extBoms.some(b => selectedBomIds.has(b.id)) && !isAllBomSelected;

  const toggleSelectAllBoms = () => {
    if (isAllBomSelected) setSelectedBomIds(new Set());
    else setSelectedBomIds(new Set(extBoms.map(b => b.id)));
  };
  const toggleSelectBom = (id: string) => {
    setSelectedBomIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const handleBulkDeleteBom = () => {
    if (selectedBomIds.size === 0) return;
    if (confirm(`${selectedBomIds.size}개 BOM을 삭제하시겠습니까?`)) {
      const newBoms = extBoms.filter(b => !selectedBomIds.has(b.id));
      extBoms.filter(b => selectedBomIds.has(b.id)).forEach(b => store.updateItem(b.styleId, { hasBom: false }));
      saveExtBoms(newBoms);
      setExtBoms(newBoms);
      setSelectedBomIds(new Set());
      if (editBom && selectedBomIds.has(editBom.id)) { setEditBom(null); setSelectedStyleId(''); }
      toast.success(`${selectedBomIds.size}개 BOM이 삭제되었습니다`);
    }
  };

  const summary = editBom ? calcSummary(editBom, settings.usdKrw) : null;
  const pnlResult = summary && editBom?.pnl ? calcPnl(summary.totalCostKrw, editBom.pnl) : null;
  const cnyKrw = editBom?.snapshotCnyKrw || settings.cnyKrw;

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800 tracking-tight">BOM / 원가 관리</h1>
          <p className="text-sm text-stone-500 mt-0.5">사전원가(BOM) 및 사후원가(공장 실적) 통합 관리</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls" onChange={handleExcelUpload} className="hidden" />
          <input ref={preFileRef} type="file" accept=".xlsx,.xlsm,.xls" onChange={handlePreExcelUpload} className="hidden" />
          <input ref={postFileRef} type="file" accept=".xlsx,.xlsm,.xls" onChange={handlePostExcelUpload} className="hidden" />
          {activeTab === 'pre' && (
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5 text-xs border-stone-300">
              <Upload className="w-3.5 h-3.5" /> 엑셀 업로드
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowCopyModal(true)} className="gap-1.5 text-xs border-stone-300">
            <Copy className="w-3.5 h-3.5" /> 유사 스타일 복사
          </Button>
          {editBom && activeTab === 'pre' && (
            <Button variant="outline" size="sm" onClick={() => setShowQuote(true)} className="gap-1.5 text-xs border-[#C9A96E] text-[#C9A96E] hover:bg-amber-50">
              <FileText className="w-3.5 h-3.5" /> 업체용 견적서
            </Button>
          )}
          {editBom && (isDirty || activeTab === 'post') && (
            <Button size="sm" onClick={handleSave} className="gap-1.5 text-xs bg-stone-800 hover:bg-stone-700 text-white">
              <Save className="w-3.5 h-3.5" /> 저장
            </Button>
          )}
        </div>
      </div>

      {/* 스타일 선택 */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="col-span-1">
            <label className="text-xs text-stone-500 mb-1 block font-medium">바이어 필터</label>
            <Select value={filterBuyerBom} onValueChange={setFilterBuyerBom}>
              <SelectTrigger className="h-8 text-xs border-stone-200"><SelectValue placeholder="전체 바이어" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">전체 바이어</SelectItem>
                {buyers.map(b => <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-1">
            <label className="text-xs text-stone-500 mb-1 block font-medium">스타일 검색</label>
            <Input value={styleSearch} onChange={e => setStyleSearch(e.target.value)} className="h-8 text-xs border-stone-200" placeholder="스타일번호 / 품명" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-stone-500 mb-1 block font-medium">스타일 선택</label>
            <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
              <SelectTrigger className="h-8 text-xs border-stone-200"><SelectValue placeholder="스타일 선택..." /></SelectTrigger>
              <SelectContent>
                {items
                  .filter(item => filterBuyerBom === 'all' || item.buyerId === filterBuyerBom)
                  .filter(item => !styleSearch || item.styleNo.toLowerCase().includes(styleSearch.toLowerCase()) || item.name.toLowerCase().includes(styleSearch.toLowerCase()))
                  .map(item => {
                    const bomCost = item.hasBom ? store.getBomTotalCost(item.styleNo) : 0;
                    return (
                      <SelectItem key={item.id} value={item.id} className="text-xs">
                        <span className="flex items-center gap-1.5">
                          {item.styleNo} — {item.name}
                          {item.hasBom && <Badge variant="outline" className="text-[10px] py-0 h-4 border-green-300 text-green-600">BOM</Badge>}
                          {item.hasBom && bomCost > 0 && <span className="text-[10px] text-amber-600 font-medium">{fmtKrw(bomCost)}</span>}
                        </span>
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
          </div>
          {editBom && (
            <>
              <div>
                <label className="text-xs text-stone-500 mb-1 block font-medium">스타일번호 <span className="text-[10px] text-amber-600 font-normal">자동</span></label>
                <Input value={editBom.styleNo} disabled className="h-8 text-xs border-stone-200 bg-stone-50 text-stone-500 cursor-not-allowed" />
              </div>
              <div>
                <label className="text-xs text-stone-500 mb-1 block font-medium">품명 <span className="text-[10px] text-amber-600 font-normal">자동</span></label>
                <Input value={editBom.styleName} disabled className="h-8 text-xs border-stone-200 bg-stone-50 text-stone-500 cursor-not-allowed" />
              </div>
              <div>
                <label className="text-xs text-stone-500 mb-1 block font-medium">시즌 <span className="text-[10px] text-amber-600 font-normal">자동</span></label>
                <Input value={editBom.season} disabled className="h-8 text-xs border-stone-200 bg-stone-50 text-stone-500 cursor-not-allowed" />
              </div>
              <div>
                <label className="text-xs text-stone-500 mb-1 block font-medium">카테고리 <span className="text-[10px] text-amber-600 font-normal">자동</span></label>
                <Input value={editBom.erpCategory || ''} disabled className="h-8 text-xs border-stone-200 bg-stone-50 text-stone-500 cursor-not-allowed" />
              </div>
              <div>
                <label className="text-xs text-stone-500 mb-1 block font-medium">담당 디자이너 <span className="text-[10px] text-amber-600 font-normal">자동</span></label>
                <Input value={editBom.designer || ''} disabled className="h-8 text-xs border-stone-200 bg-stone-50 text-stone-500 cursor-not-allowed" />
              </div>
              <div><label className="text-xs text-stone-500 mb-1 block font-medium">라인명</label><Input value={editBom.lineName || ''} onChange={e => updateField('lineName', e.target.value)} className="h-8 text-xs border-stone-200" placeholder="라인명" /></div>
              <div><label className="text-xs text-stone-500 mb-1 block font-medium">환율 (CNY→KRW)</label><Input type="number" value={editBom.snapshotCnyKrw} onChange={e => updateField('snapshotCnyKrw', Number(e.target.value))} className="h-8 text-xs border-stone-200 text-right" /></div>
              <div><label className="text-xs text-stone-500 mb-1 block font-medium">생산마진율 (%)</label><Input type="number" value={Math.round((editBom.productionMarginRate || 0.16) * 100)} onChange={e => updateField('productionMarginRate', Number(e.target.value) / 100)} className="h-8 text-xs border-stone-200 text-right" /></div>
            </>
          )}
        </div>
      </div>

      {/* BOM 목록 */}
      {extBoms.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
            <p className="text-sm font-semibold text-stone-700">등록된 BOM 목록 ({extBoms.length}건)</p>
            {selectedBomIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-500">{selectedBomIds.size}개 선택됨</span>
                <button onClick={handleBulkDeleteBom} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-medium">🗑️ 선택 삭제</button>
                <button onClick={() => setSelectedBomIds(new Set())} className="flex items-center gap-1 px-2 py-1.5 bg-stone-200 hover:bg-stone-300 text-stone-700 rounded-lg text-xs font-medium">✕ 해제</button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50">
                  <th className="px-4 py-2.5 w-10">
                    <input type="checkbox" checked={isAllBomSelected} ref={el => { if (el) el.indeterminate = isBomIndeterminate; }} onChange={toggleSelectAllBoms} className="w-4 h-4 rounded border-stone-300 accent-[#C9A96E] cursor-pointer" />
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">스타일번호</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">품명</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">시즌</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-stone-500">사전원가(KRW)</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-stone-500">자재비(CNY)</th>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-stone-500">사후원가</th>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-stone-500">작업</th>
                </tr>
              </thead>
              <tbody>
                {extBoms.map(b => {
                  const isChecked = selectedBomIds.has(b.id);
                  const sum = calcSummary(b, settings.usdKrw);
                  const hasPost = (b.postMaterials || []).some(l => l.itemName);
                  return (
                    <tr key={b.id} className={`border-b border-stone-50 hover:bg-stone-50/50 cursor-pointer ${isChecked ? 'bg-amber-50/60' : ''}`} onClick={() => setSelectedStyleId(b.styleId)}>
                      <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isChecked} onChange={() => toggleSelectBom(b.id)} className="w-4 h-4 rounded border-stone-300 accent-[#C9A96E] cursor-pointer" />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-700">{b.styleNo}</td>
                      <td className="px-4 py-2.5 text-xs text-stone-600">{b.styleName}</td>
                      <td className="px-4 py-2.5 text-xs text-stone-500">{b.season}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-stone-700">{fmtKrw(sum.totalCostKrw)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-stone-500">{fmt(sum.materialCny)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {hasPost ? <Badge className="text-[10px] py-0 h-4 bg-blue-100 text-blue-700 border-blue-300">등록됨</Badge> : <span className="text-xs text-stone-300">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button onClick={e => { e.stopPropagation(); setSelectedStyleId(b.styleId); }} className="text-xs px-2 py-0.5 rounded border border-[#C9A96E] text-[#C9A96E] hover:bg-amber-50">편집</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!editBom && (
        <div className="bg-stone-50 border border-dashed border-stone-300 rounded-xl p-12 text-center">
          <Calculator className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <p className="text-stone-500 text-sm font-medium">스타일을 선택하거나 엑셀을 업로드하세요</p>
          <p className="text-stone-400 text-xs mt-1">중국원가표(.xlsm) 업로드 시 자동으로 BOM이 생성됩니다</p>
        </div>
      )}

      {/* ─── 탭 UI ─────────────────────────────────────────────────────────── */}
      {editBom && (
        <>
          {/* 탭 헤더 */}
          <div className="flex border-b border-stone-200">
            <button
              onClick={() => setActiveTab('pre')}
              className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'pre'
                  ? 'border-[#C9A96E] text-[#C9A96E]'
                  : 'border-transparent text-stone-400 hover:text-stone-600'
              }`}
            >
              사전원가
            </button>
            <button
              onClick={() => setActiveTab('post')}
              className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'post'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-stone-400 hover:text-stone-600'
              }`}
            >
              <Factory className="w-4 h-4" />
              사후원가
              {(editBom.postMaterials || []).some(l => l.itemName) && (
                <Badge className="text-[10px] py-0 h-4 bg-blue-100 text-blue-700 border-blue-300">등록됨</Badge>
              )}
            </button>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
            사전원가 탭
          ══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'pre' && (
            <>
              {/* 사전원가 컨트롤 바 */}
              <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm">
                <div className="flex flex-wrap items-end gap-4">
                  {/* 제조국 선택 */}
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block font-medium">제조국</label>
                    <div className="flex gap-1">
                      {(['중국', '한국', '기타'] as const).map(country => (
                        <button
                          key={country}
                          onClick={() => {
                            updateField('preManufacturingCountry', country);
                            if (country === '중국') updateField('preCurrency', 'CNY');
                            else if (country === '한국') updateField('preCurrency', 'KRW');
                          }}
                          className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                            editBom.preManufacturingCountry === country
                              ? 'bg-stone-800 text-white border-stone-800'
                              : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                          }`}
                        >
                          {country}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 통화 선택 */}
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block font-medium">입력 통화</label>
                    <div className="flex gap-1">
                      {(['CNY', 'USD', 'KRW'] as const).map(cur => (
                        <button
                          key={cur}
                          onClick={() => updateField('preCurrency', cur)}
                          className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                            (editBom.preCurrency || 'CNY') === cur
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                          }`}
                        >
                          {cur === 'CNY' ? '¥ CNY' : cur === 'USD' ? '$ USD' : '₩ KRW'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 환율 입력 — CNY */}
                  {(editBom.preCurrency || 'CNY') !== 'KRW' && (
                    <div>
                      <label className="text-xs text-stone-500 mb-1 block font-medium">
                        CNY→KRW 환율
                      </label>
                      <Input
                        type="number"
                        value={editBom.preExchangeRateCny ?? editBom.snapshotCnyKrw}
                        onChange={e => updateField('preExchangeRateCny', Number(e.target.value))}
                        className="h-8 text-xs border-stone-200 text-right w-28"
                      />
                    </div>
                  )}
                  {/* 환율 입력 — USD */}
                  {(editBom.preCurrency || 'CNY') !== 'KRW' && (
                    <div>
                      <label className="text-xs text-stone-500 mb-1 block font-medium">
                        USD→KRW 환율
                      </label>
                      <Input
                        type="number"
                        value={editBom.preExchangeRateUsd ?? settings.usdKrw}
                        onChange={e => updateField('preExchangeRateUsd', Number(e.target.value))}
                        className="h-8 text-xs border-stone-200 text-right w-28"
                      />
                    </div>
                  )}
                  {/* 원가표 업로드 버튼 */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => preFileRef.current?.click()}
                    className="gap-1.5 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                  >
                    <Upload className="w-3.5 h-3.5" /> 원가표 불러오기
                  </Button>
                  {editBom.preSourceFileName && (
                    <span className="text-xs text-stone-400 flex items-center gap-1">
                      <FileText className="w-3 h-3 text-blue-400" /> {editBom.preSourceFileName}
                    </span>
                  )}
                </div>
              </div>

              {/* BOM 테이블 */}
              {(() => {
                const preCur = editBom.preCurrency || 'CNY';
                const preCnyKrw = editBom.preExchangeRateCny ?? editBom.snapshotCnyKrw;
                const preUsdKrw = editBom.preExchangeRateUsd ?? settings.usdKrw;
                const preRate = preCur === 'USD' ? preUsdKrw : preCur === 'KRW' ? 1 : preCnyKrw;
                const curSymbol = preCur === 'CNY' ? '¥' : preCur === 'USD' ? '$' : '₩';
                return (
                  <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between bg-stone-50">
                      <h2 className="text-sm font-semibold text-stone-700">사전원가 자재 명세</h2>
                      <span className="text-xs text-stone-400">
                        입력 통화: {preCur} {preCur !== 'KRW' && `| CNY→KRW ${preCnyKrw} | USD→KRW ${preUsdKrw}`}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-stone-800 text-white text-[11px]">
                            <th className="px-2 py-2 text-left">부위 | 자재명</th>
                            <th className="px-2 py-2 text-left w-20">규격</th>
                            <th className="px-2 py-2 text-center w-20">단위</th>
                            <th className="px-2 py-2 text-right w-20">단가({curSymbol})</th>
                            <th className="px-2 py-2 text-right w-20">NET</th>
                            <th className="px-2 py-2 text-right w-16">LOSS(%)</th>
                            <th className="px-2 py-2 text-right w-24">소요량</th>
                            <th className="px-2 py-2 text-right w-24">제조금액({curSymbol})</th>
                            <th className="px-2 py-2 text-right w-24">KRW</th>
                            <th className="px-2 py-2 text-center w-14">본사제공</th>
                            <th className="px-2 py-2 text-center w-14 text-blue-600">업체제공</th>
                            <th className="px-2 py-2 text-left w-24">구매업체</th>
                            <th className="px-2 py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {BOM_SECTIONS.map(cat => {
                            const isRawMaterial = cat === '원자재';
                            const catLines = editBom.lines.filter(l => l.category === cat);
                            const filledLines = catLines.filter(l => l.itemName);
                            const catTotal = catLines.reduce((s, l) => s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate), 0);
                            // 원자재: 기본 펼침, 나머지: 기본 접힘
                            const collapsed = collapsedSections.has(cat);
                            const colCount = 12; // 총 컬럼 수
                            return (
                              <React.Fragment key={cat}>
                                <tr className={`border-y ${isRawMaterial ? 'bg-amber-50 border-amber-200' : 'bg-stone-100 border-stone-200'}`}>
                                  <td colSpan={colCount} className="px-3 py-1.5">
                                    <div className="flex items-center justify-between">
                                      <button onClick={() => toggleSection(cat)} className={`flex items-center gap-2 font-semibold text-xs hover:opacity-80 ${isRawMaterial ? 'text-amber-800' : 'text-stone-700'}`}>
                                        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                        {cat}
                                        {!isRawMaterial && filledLines.length > 0 && (
                                          <span className="text-[10px] font-normal text-stone-500">({filledLines.length})</span>
                                        )}
                                      </button>
                                      <div className="flex items-center gap-3">
                                        {catTotal > 0 && (
                                          <span className="text-xs text-stone-500">
                                            소계: <span className="font-semibold text-stone-700">{fmt(catTotal)} {curSymbol}</span>
                                            {preCur !== 'KRW' && <> = <span className="font-semibold text-[#C9A96E]">{fmtKrw(catTotal * preRate)}</span></>}
                                          </span>
                                        )}
                                        <button onClick={() => addLine(cat)} className="flex items-center gap-1 text-[11px] text-[#C9A96E] hover:text-amber-700 font-medium">
                                          <Plus className="w-3 h-3" /> 행 추가
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                                {!collapsed && catLines.map(line => (
                                  <BomLineRow
                                    key={line.id}
                                    line={line}
                                    onChange={updateLine}
                                    onDelete={deleteLine}
                                    cnyKrw={preRate}
                                    sectionKey={cat}
                                    accentColor="amber"
                                  />
                                ))}
                              </React.Fragment>
                            );
                          })}
                          {/* 후가공비 섹션 - 동일 컬럼 구조 */}
                          <tr className="bg-stone-100 border-y border-stone-200">
                            <td colSpan={12} className="px-3 py-1.5">
                              <div className="flex items-center justify-between">
                                <button onClick={() => toggleSection('후가공')} className="flex items-center gap-2 text-stone-700 font-semibold text-xs hover:text-stone-900">
                                  {collapsedSections.has('후가공') ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  후가공비
                                  {editBom.postProcessLines.filter(l => l.name).length > 0 && (
                                    <span className="text-[10px] font-normal text-stone-500">({editBom.postProcessLines.filter(l => l.name).length})</span>
                                  )}
                                </button>
                                <button onClick={() => { setEditBom(prev => prev ? { ...prev, postProcessLines: [...prev.postProcessLines, newPostLine()] } : prev); markDirty(); }} className="flex items-center gap-1 text-[11px] text-[#C9A96E] hover:text-amber-700 font-medium">
                                  <Plus className="w-3 h-3" /> 행 추가
                                </button>
                              </div>
                            </td>
                          </tr>
                          {!collapsedSections.has('후가공') && editBom.postProcessLines.map(line => {
                            const lineAmt = line.netQty * line.unitPrice;
                            const isDimmed = lineAmt === 0;
                            return (
                              <tr key={line.id} className={`group hover:bg-amber-50/30 transition-colors border-b border-stone-100 ${isDimmed ? 'opacity-40' : ''}`}>
                                {/* 부위 | 자재명 통합 셀 */}
                                <td className="px-1 py-1">
                                  <div className="flex items-center gap-1">
                                    <Select
                                      value={(line as PostProcessLine & { subPart?: string }).subPart || ''}
                                      onValueChange={v => updatePostLine(line.id, 'subPart' as keyof PostProcessLine, v)}
                                    >
                                      <SelectTrigger className="h-7 text-xs border-stone-200 w-20 shrink-0">
                                        <SelectValue placeholder="-" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none" className="text-xs text-stone-400">-</SelectItem>
                                        {SECTION_SUB_PARTS['후가공'].map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                                      </SelectContent>
                                    </Select>
                                    <Input value={line.name} onChange={e => updatePostLine(line.id, 'name', e.target.value)} className="h-7 text-xs border-stone-200 bg-white min-w-[80px]" placeholder="후가공 품목명" />
                                  </div>
                                </td>
                                {/* 규격 */}
                                <td className="px-1 py-1">
                                  <Input
                                    value={(line as PostProcessLine & { spec?: string }).spec || ''}
                                    onChange={e => updatePostLine(line.id, 'spec' as keyof PostProcessLine, e.target.value)}
                                    className="h-7 text-xs border-stone-200 bg-white min-w-[60px]"
                                    placeholder="규격"
                                  />
                                </td>
                                {/* 단위 */}
                                <td className="px-1 py-1">
                                  <Select
                                    value={(line as PostProcessLine & { unit?: string }).unit || 'EA'}
                                    onValueChange={v => updatePostLine(line.id, 'unit' as keyof PostProcessLine, v)}
                                  >
                                    <SelectTrigger className="h-7 text-xs border-stone-200 w-20"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {UNITS.filter(u => u !== '직접입력').map(u => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </td>
                                {/* 단가 */}
                                <td className="px-1 py-1"><Input type="number" value={line.unitPrice || ''} onChange={e => updatePostLine(line.id, 'unitPrice', Number(e.target.value))} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder={`단가(${curSymbol})`} /></td>
                                {/* NET */}
                                <td className="px-1 py-1"><Input type="number" value={line.netQty || ''} onChange={e => updatePostLine(line.id, 'netQty', Number(e.target.value))} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder="수량" /></td>
                                {/* LOSS (후가공은 빈칸) */}
                                <td className="px-2 py-1 text-center text-xs text-stone-300">-</td>
                                {/* 소요량 (= NET) */}
                                <td className="px-2 py-1 text-right text-xs text-stone-500 tabular-nums">{fmt(line.netQty)}</td>
                                {/* 제조금액 */}
                                <td className="px-2 py-1 text-right text-xs font-medium tabular-nums">{fmt(lineAmt)}</td>
                                {/* KRW */}
                                <td className="px-2 py-1 text-right text-xs text-stone-500 tabular-nums">{fmtKrw(lineAmt * preRate)}</td>
                                {/* 본사제공 빈칸 */}
                                <td></td>
                                {/* 구매업체 빈칸 */}
                                <td></td>
                                {/* 삭제 */}
                                <td className="px-1 py-1"><button onClick={() => deletePostLine(line.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-stone-300 hover:text-red-400 p-0.5"><Trash2 className="w-3.5 h-3.5" /></button></td>
                              </tr>
                            );
                          })}
                          {/* 임가공비 - 별도 섹션으로 분리 */}
                          <tr className="bg-amber-50/50 border-y border-stone-200">
                            <td colSpan={12} className="px-3 py-1.5">
                              <span className="text-xs font-semibold text-stone-600">임가공비</span>
                              <span className="text-[10px] text-stone-400 ml-2">자재비와 별도 항목</span>
                            </td>
                          </tr>
                          <tr className="bg-amber-50/30 border-b border-stone-200">
                            <td className="px-1 py-1" colSpan={3}>
                              <span className="text-xs text-stone-600 px-2">임가공비 (NET)</span>
                            </td>
                            <td className="px-1 py-1"><Input type="number" value={editBom.processingFee || ''} onChange={e => updateField('processingFee', Number(e.target.value))} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder={curSymbol} /></td>
                            <td className="px-1 py-1"><span className="text-xs text-stone-400 px-2">1</span></td>
                            <td></td>
                            <td className="px-2 py-1 text-right text-xs text-stone-400">1</td>
                            <td className="px-2 py-1 text-right text-xs font-semibold tabular-nums">{fmt(editBom.processingFee)} {curSymbol}</td>
                            <td className="px-2 py-1 text-right text-xs font-semibold text-[#C9A96E] tabular-nums">{fmtKrw(editBom.processingFee * preRate)}</td>
                            <td colSpan={3}></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* 사전원가 요약 */}
              {summary && (
                <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-stone-100 bg-stone-800 text-white">
                    <h2 className="text-sm font-semibold">사전 원가 요약 <span className="text-stone-400 text-xs font-normal ml-2">— 디자이너 사전원가 산출용</span></h2>
                  </div>
                  <table className="w-full text-xs">
                    <thead><tr className="bg-stone-100 text-stone-600"><th className="px-4 py-2 text-left w-12">구분</th><th className="px-4 py-2 text-left">항목</th><th className="px-4 py-2 text-left text-stone-400">내용/비고</th><th className="px-4 py-2 text-right w-40">금액 (원)</th></tr></thead>
                    <tbody>
                      {[
                        { key: '원', label: '원부자재 합산', desc: `원자재 + 부자재 + 보강재 + 포장재 (${summary.preCur})`, val: summary.materialKrw + summary.postProcessKrw, editable: false },
                        { key: '부', label: '임가공비', desc: `NET (${summary.preCur})`, val: summary.processingKrw, editable: false },
                        { key: '자', label: '물류비', desc: 'PCS 배분 물류비', val: summary.logisticsKrw, editable: true, field: 'logisticsCostKrw' as keyof ExtBom },
                        { key: '재', label: '포장/검사비', desc: '포장 잡비, 검사 인건비', val: summary.packagingKrw, editable: true, field: 'packagingCostKrw' as keyof ExtBom },
                        { key: '패', label: '패킹재', desc: '쇼핑백, 박스, 에어캡 등', val: summary.packingKrw, editable: true, field: 'packingCostKrw' as keyof ExtBom },
                        { key: '마', label: '생산마진', desc: `${Math.round((editBom.productionMarginRate || 0.16) * 100)}%`, val: summary.productionMarginKrw, editable: false },
                      ].map(row => (
                        <tr key={row.key} className="border-b border-stone-100 hover:bg-stone-50">
                          <td className="px-4 py-2 font-bold text-stone-400">{row.key}</td>
                          <td className="px-4 py-2 font-medium text-stone-700">{row.label}</td>
                          <td className="px-4 py-2 text-stone-400">{row.desc}</td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums">
                            {row.editable && row.field ? (
                              <Input type="number" value={(editBom[row.field] as number) || ''} onChange={e => updateField(row.field!, Number(e.target.value) as ExtBom[typeof row.field])} className="h-6 text-xs border-stone-200 text-right w-36 ml-auto" placeholder="0" />
                            ) : (
                              <span className={row.val === 0 ? 'text-stone-300' : 'text-stone-800'}>{fmtKrw(row.val)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-stone-800 text-white">
                        <td className="px-4 py-3 font-bold">사</td>
                        <td className="px-4 py-3 font-bold text-base" colSpan={2}>총 원 가 액</td>
                        <td className="px-4 py-3 text-right font-bold text-lg tabular-nums text-[#C9A96E]">{fmtKrw(summary.totalCostKrw)}</td>
                      </tr>
                      {(() => {
                        const linkedItem = items.find(i => i.id === editBom.styleId);
                        const deliveryPrice = linkedItem?.deliveryPrice || linkedItem?.targetSalePrice;
                        if (!deliveryPrice || deliveryPrice <= 0) return null;
                        const marginAmt = deliveryPrice - summary.totalCostKrw;
                        const marginPct = (marginAmt / deliveryPrice) * 100;
                        const marginClass = marginPct < 15 ? 'text-red-600' : marginPct < 30 ? 'text-amber-600' : 'text-green-600';
                        const marginBg = marginPct < 15 ? 'bg-red-50 border-red-200' : marginPct < 30 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200';
                        return (
                          <>
                            <tr className="bg-blue-50 border-t border-blue-200">
                              <td className="px-4 py-2.5 text-xs font-medium text-blue-600">연동</td>
                              <td className="px-4 py-2.5 text-sm font-semibold text-blue-800" colSpan={2}>납품가 (품목 마스터 연동)</td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-blue-800">{fmtKrw(deliveryPrice)}</td>
                            </tr>
                            <tr>
                              <td colSpan={4} className="px-4 py-2">
                                <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl border ${marginBg}`}>
                                  <div className="flex items-center gap-4">
                                    <span className="text-xs text-stone-500">마진금액</span>
                                    <span className={`font-mono font-bold text-sm ${marginClass}`}>{fmtKrw(marginAmt)}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-stone-500">마진율</span>
                                    <span className={`font-mono font-bold text-lg ${marginClass}`}>{marginPct.toFixed(1)}%</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${marginPct >= 30 ? 'bg-green-100 text-green-700' : marginPct >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                      {marginPct >= 30 ? '✅ 양호' : marginPct >= 15 ? '🟡 주의' : '🔴 위험'}
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          </>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              )}

              {/* P&L 분석 */}
              {summary && editBom.pnl && pnlResult && (
                <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-stone-100 bg-stone-800 text-white">
                    <h2 className="text-sm font-semibold">P&L 분석 <span className="text-stone-400 text-xs font-normal ml-2">— 아래 값을 변경하면 모든 P&L이 자동 업데이트됩니다</span></h2>
                  </div>
                  <div className="p-5 space-y-5">
                    {/* 가정값 */}
                    <div className="bg-stone-50 rounded-lg p-4 border border-stone-200">
                      <h3 className="text-xs font-semibold text-stone-600 mb-3">가정 (Assumptions)</h3>
                      <div className="grid grid-cols-3 gap-4">
                        {([
                          { label: '할인율 (Discount)', field: 'discountRate' as keyof BomPnlAssumptions },
                          { label: '플랫폼 수수료', field: 'platformFeeRate' as keyof BomPnlAssumptions },
                          { label: '인건비 / 판관비', field: 'sgaRate' as keyof BomPnlAssumptions },
                        ] as const).map(item => (
                          <div key={item.field}>
                            <label className="text-[11px] text-stone-500 mb-1 block">{item.label}</label>
                            <div className="flex items-center gap-1">
                              <Input type="number" value={Math.round((editBom.pnl[item.field] as number) * 100)} onChange={e => updatePnl(item.field, Number(e.target.value) / 100 as BomPnlAssumptions[typeof item.field])} className="h-7 text-xs border-stone-200 text-right w-20" />
                              <span className="text-xs text-stone-500">%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* 배수 분석 */}
                    <div className="bg-stone-50 rounded-lg p-4 border border-stone-200">
                      <h3 className="text-xs font-semibold text-stone-600 mb-3">배수 분석</h3>
                      <div className="space-y-2">
                        {[
                          { label: '3.5배 기준 최소 판매가', val: pnlResult.price35 },
                          { label: '4.0배 기준 목표 판매가', val: pnlResult.price40 },
                          { label: '4.5배 기준 이상적 판매가', val: pnlResult.price45 },
                        ].map(item => (
                          <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-stone-200 last:border-0">
                            <span className="text-xs text-stone-600">{item.label}</span>
                            <span className="text-sm font-bold text-stone-800 tabular-nums">{fmtKrw(item.val)}</span>
                          </div>
                        ))}
                        <div className="pt-2">
                          <label className="text-xs font-semibold text-stone-700 mb-1.5 block">확정 판매가 — 직접 입력</label>
                          <div className="flex items-center gap-3 flex-wrap">
                            <Input type="number" value={editBom.pnl.confirmedSalePrice || ''} onChange={e => updatePnl('confirmedSalePrice', e.target.value ? Number(e.target.value) : undefined)} className="h-8 text-sm border-stone-300 text-right w-40 font-semibold" placeholder="판매가 입력" />
                            {editBom.pnl.confirmedSalePrice ? (
                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-stone-500">실현 배수:</span>
                                <span className={`font-bold ${pnlResult.meets35x ? 'text-green-600' : 'text-red-500'}`}>{pnlResult.actualMultiple.toFixed(2)}x</span>
                                {pnlResult.meets35x
                                  ? <span className="flex items-center gap-1 text-green-600"><CheckCircle className="w-3.5 h-3.5" /> 3.5배 달성</span>
                                  : <span className="flex items-center gap-1 text-red-500"><AlertTriangle className="w-3.5 h-3.5" /> 3.5배 미달 — 원가 절감 필요: {fmtKrw(pnlResult.costReductionNeeded)}</span>
                                }
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* 영업이익 P&L */}
                    {editBom.pnl.confirmedSalePrice ? (
                      <div className="bg-stone-50 rounded-lg p-4 border border-stone-200">
                        <h3 className="text-xs font-semibold text-stone-600 mb-3">영업이익 분석 (P&L)</h3>
                        <div className="space-y-1">
                          {[
                            { no: '①', label: '정가 (확정판매가)', desc: '', val: editBom.pnl.confirmedSalePrice, color: 'text-stone-800', bold: false },
                            { no: '②', label: '(-) 할인', desc: `${Math.round(editBom.pnl.discountRate * 100)}%`, val: -(editBom.pnl.confirmedSalePrice * editBom.pnl.discountRate), color: 'text-red-500', bold: false },
                            { no: '③', label: '실판가 (Net Sale)', desc: '', val: pnlResult.netSale, color: 'text-stone-700', bold: true },
                            { no: '④', label: '(-) 플랫폼 수수료', desc: `${Math.round(editBom.pnl.platformFeeRate * 100)}%`, val: -(pnlResult.netSale * editBom.pnl.platformFeeRate), color: 'text-red-500', bold: false },
                            { no: '⑤', label: '(-) 인건비 / 판관비', desc: `${Math.round(editBom.pnl.sgaRate * 100)}%`, val: -(pnlResult.netSale * editBom.pnl.sgaRate), color: 'text-red-500', bold: false },
                            { no: '⑥', label: '(-) 매출원가 (COGS)', desc: '총 원가액', val: -summary.totalCostKrw, color: 'text-red-500', bold: false },
                            { no: '⑦', label: '영업이익', desc: '', val: pnlResult.operatingProfit, color: pnlResult.operatingProfit >= 0 ? 'text-green-600' : 'text-red-600', bold: true },
                            { no: '★', label: '영업이익률', desc: '', val: null, color: pnlResult.operatingMargin >= 0 ? 'text-green-600' : 'text-red-600', bold: true, rate: pnlResult.operatingMargin },
                          ].map(row => (
                            <div key={row.no} className={`flex items-center justify-between py-1.5 px-3 rounded ${row.bold ? 'bg-white border border-stone-200' : ''}`}>
                              <div className="flex items-center gap-3">
                                <span className="text-[11px] text-stone-400 w-5">{row.no}</span>
                                <span className={`text-xs ${row.bold ? 'font-semibold text-stone-800' : 'text-stone-600'}`}>{row.label} <span className="text-stone-400 font-normal">{row.desc}</span></span>
                              </div>
                              <span className={`text-sm tabular-nums font-semibold ${row.color}`}>
                                {'rate' in row && row.rate !== undefined ? `${(row.rate * 100).toFixed(1)}%` : row.val !== null ? fmtKrw(row.val) : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-stone-50 rounded-lg p-4 border border-dashed border-stone-300 text-center text-xs text-stone-400">
                        <TrendingUp className="w-6 h-6 mx-auto mb-2 text-stone-300" />
                        확정 판매가를 입력하면 영업이익 P&L 분석이 표시됩니다
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════════
            사후원가 탭
          ══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'post' && (
            <>
              {/* 사후원가 컨트롤 바 */}
              <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm">
                <div className="flex flex-wrap items-end gap-4">
                  {/* 제조국 선택 */}
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block font-medium">제조국</label>
                    <div className="flex gap-1">
                      {(['중국', '한국', '기타'] as const).map(country => (
                        <button
                          key={country}
                          onClick={() => {
                            updateField('manufacturingCountry', country);
                            if (country === '중국') updateField('currency', 'CNY');
                            else if (country === '한국') updateField('currency', 'KRW');
                          }}
                          className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                            editBom.manufacturingCountry === country
                              ? 'bg-stone-800 text-white border-stone-800'
                              : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                          }`}
                        >
                          {country}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 통화 선택 (3가지) */}
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block font-medium">입력 통화</label>
                    <div className="flex gap-1">
                      {(['CNY', 'USD', 'KRW'] as const).map(cur => (
                        <button
                          key={cur}
                          onClick={() => updateField('currency', cur)}
                          className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                            (editBom.currency || 'CNY') === cur
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                          }`}
                        >
                          {cur === 'CNY' ? '¥ CNY' : cur === 'USD' ? '$ USD' : '₩ KRW'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 환율 — CNY */}
                  {(editBom.currency || 'CNY') !== 'KRW' && (
                    <div>
                      <label className="text-xs text-stone-500 mb-1 block font-medium">CNY→KRW 환율</label>
                      <Input
                        type="number"
                        value={editBom.exchangeRateCny || editBom.snapshotCnyKrw}
                        onChange={e => updateField('exchangeRateCny', Number(e.target.value))}
                        className="h-8 text-xs border-stone-200 text-right w-28"
                      />
                    </div>
                  )}
                  {/* 환율 — USD */}
                  {(editBom.currency || 'CNY') !== 'KRW' && (
                    <div>
                      <label className="text-xs text-stone-500 mb-1 block font-medium">USD→KRW 환율</label>
                      <Input
                        type="number"
                        value={editBom.exchangeRateUsd || settings.usdKrw}
                        onChange={e => updateField('exchangeRateUsd', Number(e.target.value))}
                        className="h-8 text-xs border-stone-200 text-right w-28"
                      />
                    </div>
                  )}
                  {/* 사전원가 적용 버튼 */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyPreToPost}
                    className="gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                  >
                    <Copy className="w-3.5 h-3.5" /> 사전원가 적용
                  </Button>
                  {/* 공장 원가표 업로드 */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => postFileRef.current?.click()}
                    className="gap-1.5 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                  >
                    <Upload className="w-3.5 h-3.5" /> 공장 원가표 업로드
                  </Button>
                  {editBom.postSourceFileName && (
                    <span className="text-xs text-stone-400 flex items-center gap-1">
                      <FileText className="w-3 h-3 text-blue-400" /> {editBom.postSourceFileName}
                    </span>
                  )}
                </div>
              </div>

              {/* 사후원가 자재 테이블 */}
              {(() => {
                const postCur = editBom.currency || 'CNY';
                const postCnyKrw = editBom.exchangeRateCny || editBom.snapshotCnyKrw || 191;
                const postUsdKrw = editBom.exchangeRateUsd || settings.usdKrw;
                const postRate = postCur === 'USD' ? postUsdKrw : postCur === 'KRW' ? 1 : postCnyKrw;
                const curSymbol = postCur === 'CNY' ? '¥' : postCur === 'USD' ? '$' : '₩';
                return (
                  <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between bg-stone-50">
                      <h2 className="text-sm font-semibold text-stone-700">사후원가 자재 명세</h2>
                      <span className="text-xs text-stone-400">
                        입력 통화: {postCur} {postCur !== 'KRW' && `| CNY→KRW ${postCnyKrw} | USD→KRW ${postUsdKrw}`}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-blue-900 text-white text-[11px]">
                            <th className="px-2 py-2 text-left">부위 | 자재명</th>
                            <th className="px-2 py-2 text-left w-20">규격</th>
                            <th className="px-2 py-2 text-center w-20">단위</th>
                            <th className="px-2 py-2 text-right w-20">단가({curSymbol})</th>
                            <th className="px-2 py-2 text-right w-20">NET</th>
                            <th className="px-2 py-2 text-right w-16">LOSS(%)</th>
                            <th className="px-2 py-2 text-right w-24">소요량</th>
                            <th className="px-2 py-2 text-right w-24">제조금액({curSymbol})</th>
                            <th className="px-2 py-2 text-right w-24">KRW</th>
                            <th className="px-2 py-2 text-center w-14">본사제공</th>
                            <th className="px-2 py-2 text-center w-14 text-blue-600">업체제공</th>
                            <th className="px-2 py-2 text-left w-24">구매업체</th>
                            <th className="px-2 py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {BOM_SECTIONS.map(cat => {
                            const catLines = (editBom.postMaterials || []).filter(l => l.category === cat);
                            const filledLines = catLines.filter(l => l.itemName);
                            const catTotal = catLines.reduce((s, l) => s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate), 0);
                            const collapsed = collapsedPostSections.has(cat);
                            const colCount = 12;
                            const isRawMaterial = cat === '원자재';
                            return (
                              <React.Fragment key={cat}>
                                <tr className={`border-y ${isRawMaterial ? 'bg-blue-50 border-blue-200' : 'bg-blue-50/30 border-blue-100'}`}>
                                  <td colSpan={colCount} className="px-3 py-1.5">
                                    <div className="flex items-center justify-between">
                                      <button onClick={() => togglePostSection(cat)} className="flex items-center gap-2 text-blue-700 font-semibold text-xs hover:text-blue-900">
                                        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                        {cat}
                                        {filledLines.length > 0 && (
                                          <span className="text-[10px] font-normal text-blue-500">({filledLines.length})</span>
                                        )}
                                      </button>
                                      <div className="flex items-center gap-3">
                                        {catTotal > 0 && (
                                          <span className="text-xs text-stone-500">
                                            소계: <span className="font-semibold text-stone-700">{fmt(catTotal)} {curSymbol}</span>
                                            {postCur !== 'KRW' && <> = <span className="font-semibold text-blue-600">{fmtKrw(catTotal * postRate)}</span></>}
                                          </span>
                                        )}
                                        <button onClick={() => addPostMaterialLine(cat)} className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium">
                                          <Plus className="w-3 h-3" /> 행 추가
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                                {!collapsed && catLines.map(line => (
                                  <BomLineRow
                                    key={line.id}
                                    line={line}
                                    onChange={updatePostMaterialLine}
                                    onDelete={deletePostMaterialLine}
                                    cnyKrw={postRate}
                                    sectionKey={cat}
                                    accentColor="blue"
                                  />
                                ))}
                              </React.Fragment>
                            );
                          })}
                          {/* 사후원가 임가공비 - 별도 섹션 */}
                          <tr className="bg-blue-50/50 border-y border-blue-100">
                            <td colSpan={12} className="px-3 py-1.5">
                              <span className="text-xs font-semibold text-blue-700">임가공비 (사후)</span>
                              <span className="text-[10px] text-blue-400 ml-2">자재비와 별도 항목</span>
                            </td>
                          </tr>
                          <tr className="bg-blue-50/20 border-b border-blue-100">
                            <td className="px-1 py-1" colSpan={3}>
                              <span className="text-xs text-blue-700 px-2">임가공비 (NET)</span>
                            </td>
                            <td className="px-1 py-1">
                              <Input
                                type="number"
                                value={editBom.postProcessingFee || ''}
                                onChange={e => updateField('postProcessingFee', Number(e.target.value))}
                                className="h-7 text-xs border-stone-200 bg-white text-right w-20"
                                placeholder={curSymbol}
                              />
                            </td>
                            <td className="px-1 py-1"><span className="text-xs text-stone-400 px-2">1</span></td>
                            <td></td>
                            <td className="px-2 py-1 text-right text-xs text-stone-400">1</td>
                            <td className="px-2 py-1 text-right text-xs font-semibold tabular-nums text-blue-700">
                              {fmt(editBom.postProcessingFee || 0)} {curSymbol}
                            </td>
                            <td className="px-2 py-1 text-right text-xs font-semibold text-blue-600 tabular-nums">
                              {fmtKrw((editBom.postProcessingFee || 0) * postRate)}
                            </td>
                            <td colSpan={3}></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* 사후원가 요약 */}
              <PostCostSummary
                bom={editBom}
                items={items}
                onDeliveryPriceChange={(val) => {
                  updateField('postDeliveryPrice', val);
                  // 품목 마스터 자동 연동
                  if (editBom.styleId) {
                    store.updateItem(editBom.styleId, { deliveryPrice: val });
                  }
                }}
              />
            </>
          )}

          {/* 유사 스타일 복사 모달 */}
          {showCopyModal && (
            <Dialog open onOpenChange={() => setShowCopyModal(false)}>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>유사 스타일 BOM 복사</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">복사할 원본 BOM 선택</label>
                    <Select value={copySourceId} onValueChange={setCopySourceId}>
                      <SelectTrigger className="text-sm"><SelectValue placeholder="원본 BOM 선택..." /></SelectTrigger>
                      <SelectContent>
                        {extBoms.map(b => <SelectItem key={b.id} value={b.id} className="text-xs">{b.styleNo} — {b.styleName} ({b.season})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">복사 대상 스타일</label>
                    <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
                      <SelectTrigger className="text-sm"><SelectValue placeholder="대상 스타일 선택..." /></SelectTrigger>
                      <SelectContent>
                        {items.map(item => <SelectItem key={item.id} value={item.id} className="text-xs">{item.styleNo} — {item.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowCopyModal(false)}>취소</Button>
                    <Button size="sm" onClick={handleCopyBom} className="bg-stone-800 text-white">복사 실행</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}

          {/* 업체용 견적서 모달 */}
          {showQuote && editBom && <VendorQuoteModal bom={editBom} onClose={() => setShowQuote(false)} />}
        </>
      )}

      {/* 유사 스타일 복사 모달 (editBom 없을 때) */}
      {showCopyModal && !editBom && (
        <Dialog open onOpenChange={() => setShowCopyModal(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>유사 스타일 BOM 복사</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <label className="text-xs text-stone-500 mb-1 block">복사할 원본 BOM 선택</label>
                <Select value={copySourceId} onValueChange={setCopySourceId}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="원본 BOM 선택..." /></SelectTrigger>
                  <SelectContent>
                    {extBoms.map(b => <SelectItem key={b.id} value={b.id} className="text-xs">{b.styleNo} — {b.styleName} ({b.season})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-stone-500 mb-1 block">복사 대상 스타일</label>
                <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="대상 스타일 선택..." /></SelectTrigger>
                  <SelectContent>
                    {items.map(item => <SelectItem key={item.id} value={item.id} className="text-xs">{item.styleNo} — {item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowCopyModal(false)}>취소</Button>
                <Button size="sm" onClick={handleCopyBom} className="bg-stone-800 text-white">복사 실행</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}