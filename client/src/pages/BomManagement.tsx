/**
 * BOM / 원가 관리 (사전원가 + 사후원가 통합)
 * Design: Maison Atelier — 에보니 사이드바, 골드 악센트, 아이보리 배경
 *
 * 탭 구조:
 * [사전원가] — 기존 BOM 입력 UI (자재 테이블, 임가공비, 원가 요약, P&L)
 * [사후원가] — 공장 원가표 업로드 + 통화/제조국 선택 + 강조된 원가 요약
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';
import {
  store, genId,
  type Bom, type BomLine, type BomCategory, type BomSubPart, type Season, type Item, type Material, type Vendor,
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

// 컬러별 BOM (전체 섹션 독립 관리)
interface ExtColorBom {
  color: string;
  lines: ExtBomLine[];                  // 원자재+지퍼+장식+보강재+봉사·접착제+포장재+철형
  postProcessLines: PostProcessLine[];  // 후가공
  processingFee: number;                // 임가공비
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
  customsRate?: number;       // 관세율 (%, 임가공비에 적용)
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
  // 컬러별 BOM (사전원가)
  colorBoms?: ExtColorBom[];
  // 사후원가
  postColorBoms?: ExtColorBom[];  // 사후원가 컬러별 BOM
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
  color?: string;           // @deprecated — 컬러별 BOM 탭 방식으로 전환. 하위 호환성을 위해 optional 유지
  spec?: string;
  unit: string;
  customUnit?: string;      // 직접입력 단위
  unitPriceCny: number;
  netQty: number;
  lossRate: number;
  isHqProvided: boolean;
  isVendorProvided?: boolean; // 업체제공 여부
  vendorName?: string;        // 본사제공 시 자재업체명
  vendorId?: string;          // 본사제공 시 자재업체 ID
  isNewVendor?: boolean;      // 새로 등록된 업체 (기본 정보 미입력)
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
// colorBom이 주어지면 해당 컬러 BOM 데이터 사용
function calcSummary(bom: ExtBom, settingsUsdKrw?: number, colorBom?: ExtColorBom) {
  const preCur = bom.preCurrency || 'CNY';
  const cnyKrw = bom.preExchangeRateCny ?? bom.snapshotCnyKrw ?? 191;
  const usdKrw = bom.preExchangeRateUsd ?? settingsUsdKrw ?? 1380;
  // 입력 통화에 따른 KRW 환산 비율
  const toKrw = preCur === 'KRW' ? 1 : preCur === 'USD' ? usdKrw : cnyKrw;

  const srcLines = colorBom ? colorBom.lines : bom.lines;
  const srcPostProcessLines = colorBom ? (colorBom.postProcessLines ?? []) : (bom.postProcessLines || []);
  const processingAmt = colorBom ? (colorBom.processingFee ?? 0) : (bom.processingFee || 0);

  const materialAmt = srcLines.reduce((s, l) => {
    if (l.isHqProvided) return s;
    return s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate);
  }, 0);
  const postProcessAmt = srcPostProcessLines.reduce((s, l) => s + l.netQty * l.unitPrice, 0);
  const materialKrw = materialAmt * toKrw;
  const processingKrw = processingAmt * toKrw;
  const postProcessKrw = postProcessAmt * toKrw;
  const logisticsKrw = bom.logisticsCostKrw || 0;
  // 관세 = 임가공비(KRW) × 관세율(%)
  const customsRate = bom.customsRate || 0;
  const customsKrw = processingKrw * (customsRate / 100);
  const packagingKrw = bom.packagingCostKrw || 0;
  const packingKrw = bom.packingCostKrw || 0;
  const marginRate = bom.productionMarginRate ?? 0.16;
  const subTotal = materialKrw + processingKrw + postProcessKrw + customsKrw + logisticsKrw + packagingKrw + packingKrw;
  const productionMarginKrw = subTotal * marginRate;
  const totalCostKrw = subTotal + productionMarginKrw;
  // 하위 호환성을 위해 Cny 명칭 유지
  return {
    materialCny: materialAmt, processingCny: processingAmt, postProcessCny: postProcessAmt,
    materialKrw, processingKrw, postProcessKrw,
    customsRate, customsKrw,
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
  postProcessCny: number;       // 후가공비
  factoryUnitCostCny: number;   // 공장단가 (공장구매자재 + 임가공비 + 후가공 + 관세)
  totalCostCny: number;         // 제품원가 (공장단가 + 본사제공 + 물류비)
  rate: number;                 // 적용 환율
  factoryMaterialKrw: number;
  hqMaterialKrw: number;
  totalMaterialKrw: number;
  processingKrw: number;
  postProcessKrw: number;
  customsRate: number;          // 관세율 (%)
  customsKrw: number;           // 관세금액 (KRW)
  logisticsKrw: number;         // 물류비 (KRW)
  factoryUnitCostKrw: number;
  totalCostKrw: number;
}

function calcPostSummary(bom: ExtBom, settingsUsdKrw = 1380, postColorBom?: ExtColorBom): PostSummary {
  const materials = postColorBom ? postColorBom.lines : (bom.postMaterials || []);
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
  const processingCny = postColorBom ? (postColorBom.processingFee ?? 0) : (bom.postProcessingFee || 0);
  const postProcLines = postColorBom ? (postColorBom.postProcessLines ?? []) : (bom.postProcessLines || []);
  const postProcessCny2 = postProcLines.reduce((s, l) => s + l.netQty * l.unitPrice, 0);
  // 관세 = 임가공비(KRW) × 관세율(%)
  const customsRate = bom.customsRate || 0;
  const processingKrw = processingCny * rate;
  const customsKrw = processingKrw * (customsRate / 100);
  const logisticsKrw = bom.logisticsCostKrw || 0;
  // 공장단가 = 공장구매자재 + 임가공비 + 후가공비 + 관세 (본사제공 제외)
  const factoryUnitCostKrw = factoryMaterialCny * rate + processingKrw + postProcessCny2 * rate + customsKrw;
  const factoryUnitCostCny = factoryUnitCostKrw / (rate || 1);
  // 제품원가 = 공장단가 + 본사제공 + 물류비
  const totalCostKrw = factoryUnitCostKrw + hqMaterialCny * rate + logisticsKrw;
  const totalCostCny = totalCostKrw / (rate || 1);

  return {
    factoryMaterialCny,
    hqMaterialCny,
    totalMaterialCny,
    processingCny,
    postProcessCny: postProcessCny2,
    factoryUnitCostCny,
    totalCostCny,
    rate,
    factoryMaterialKrw: factoryMaterialCny * rate,
    hqMaterialKrw: hqMaterialCny * rate,
    totalMaterialKrw: totalMaterialCny * rate,
    processingKrw,
    postProcessKrw: postProcessCny2 * rate,
    customsRate,
    customsKrw,
    logisticsKrw,
    factoryUnitCostKrw,
    totalCostKrw,
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
    customsRate: b.customsRate ?? 0,
    productionMarginRate: b.productionMarginRate ?? 0.16,
    snapshotCnyKrw: b.snapshotCnyKrw ?? 191,
    colorBoms: Array.isArray(b.colorBoms) ? b.colorBoms.map(cb => ({
      color: cb.color,
      lines: Array.isArray(cb.lines) ? cb.lines.map(l => ({
        ...l,
        id: l.id || genId(),
        unitPriceCny: (l as ExtBomLine & { unitPrice?: number }).unitPriceCny ?? (l as ExtBomLine & { unitPrice?: number }).unitPrice ?? 0,
        lossRate: l.lossRate ?? 0.05,
        isHqProvided: l.isHqProvided ?? false,
      })) : [],
      postProcessLines: Array.isArray(cb.postProcessLines) ? cb.postProcessLines : [],
      processingFee: cb.processingFee ?? 0,
    })) : undefined,
    postColorBoms: Array.isArray(b.postColorBoms) ? b.postColorBoms.map(cb => ({
      color: cb.color,
      lines: Array.isArray(cb.lines) ? cb.lines.map(l => ({
        ...l,
        id: l.id || genId(),
        unitPriceCny: (l as ExtBomLine & { unitPrice?: number }).unitPriceCny ?? (l as ExtBomLine & { unitPrice?: number }).unitPrice ?? 0,
        lossRate: l.lossRate ?? 0.05,
        isHqProvided: l.isHqProvided ?? false,
      })) : [],
      postProcessLines: Array.isArray(cb.postProcessLines) ? cb.postProcessLines : [],
      processingFee: cb.processingFee ?? 0,
    })) : undefined,
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
  // 마진 조정 메타
  isRawMaterial?: boolean;      // 원자재(가죽/원단) 여부 — 마진 배분 시 단가 고정
  isVendorProvided?: boolean;   // 업체제공 여부 — 금액 0, 마진 계산 제외
  originalUnitPrice?: number;   // 마진 조정 전 원본 단가
  isMarginRow?: boolean;        // 마진(생산관리비용) 별도 행 여부
}

// 10원 단위 올림
const ceil10 = (n: number) => Math.ceil(n / 10) * 10;

function buildQuoteRows(bom: ExtBom, tab: 'pre' | 'post' = 'pre', colorBom?: ExtColorBom): QuoteRow[] {
  // 환율 결정
  const preCur = bom.preCurrency || 'CNY';
  const cnyKrw = (tab === 'post' ? bom.exchangeRateCny : bom.preExchangeRateCny) || bom.snapshotCnyKrw || 191;
  const usdKrw = (tab === 'post' ? bom.exchangeRateUsd : bom.preExchangeRateUsd) || 1380;
  const toKrw = tab === 'post'
    ? ((bom.currency === 'KRW') ? 1 : (bom.currency === 'USD') ? usdKrw : cnyKrw)
    : (preCur === 'KRW' ? 1 : preCur === 'USD' ? usdKrw : cnyKrw);

  const rows: QuoteRow[] = [];
  // 컬러별 BOM이 주어지면 해당 컬러 데이터 우선 사용
  const srcLines = colorBom ? colorBom.lines : (tab === 'post' ? (bom.postMaterials || []) : bom.lines);

  // ── 개별 행: 원자재, 장식, 지퍼 ──
  const INDIVIDUAL_CATS: BomCategory[] = ['원자재', '장식', '지퍼'];
  for (const cat of INDIVIDUAL_CATS) {
    const catLines = srcLines.filter(l => l.category === cat && l.itemName.trim());
    for (const line of catLines) {
      const grossQty = calcQty(line.netQty, line.lossRate);
      if (line.isVendorProvided) {
        rows.push({
          id: genId(), category: cat,
          itemName: line.itemName + (line.subPart ? ` (${line.subPart})` : ''),
          qty: parseFloat(grossQty.toFixed(4)), unitPrice: 0, supplyAmt: 0, taxAmt: 0,
          memo: '업체제공', isRawMaterial: cat === '원자재', isVendorProvided: true, originalUnitPrice: 0,
        });
      } else {
        const amtKrw = calcLineAmt(line.unitPriceCny, line.netQty, line.lossRate) * toKrw;
        if (amtKrw <= 0) continue;
        const sup = ceil10(amtKrw);
        const unitKrw = grossQty > 0 ? ceil10(line.unitPriceCny * toKrw) : sup;
        rows.push({
          id: genId(), category: cat,
          itemName: line.itemName + (line.subPart ? ` (${line.subPart})` : ''),
          qty: parseFloat(grossQty.toFixed(4)), unitPrice: unitKrw, supplyAmt: sup,
          taxAmt: ceil10(sup * 0.1), memo: line.isHqProvided ? '본사제공' : '',
          isRawMaterial: cat === '원자재', isVendorProvided: false, originalUnitPrice: unitKrw,
        });
      }
    }
  }

  // ── 합계 1행: 보강재, 봉사·접착제, 포장재 ──
  const SUMMARY_CATS: Array<{ cat: BomCategory; label: string }> = [
    { cat: '보강재', label: '내부 보강자재' },
    { cat: '봉사·접착제', label: '실/기리매/본드 등' },
    { cat: '포장재', label: '스타핑지/기본 포장재/납품박스 등' },
  ];
  for (const { cat, label } of SUMMARY_CATS) {
    const catLines = srcLines.filter(l => l.category === cat && l.itemName.trim() && !l.isVendorProvided);
    const total = catLines.reduce((s, l) => s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate) * toKrw, 0);
    if (total > 0) {
      const sup = ceil10(total);
      rows.push({
        id: genId(), category: cat, itemName: label,
        qty: 1, unitPrice: sup, supplyAmt: sup,
        taxAmt: ceil10(sup * 0.1), memo: '',
        isRawMaterial: false, isVendorProvided: false, originalUnitPrice: sup,
      });
    }
    // 업체제공 품목이 있으면 별도 업체제공 행
    const vendorLines = srcLines.filter(l => l.category === cat && l.itemName.trim() && l.isVendorProvided);
    if (vendorLines.length > 0) {
      rows.push({
        id: genId(), category: cat, itemName: `${cat} 일체 (업체제공)`,
        qty: vendorLines.length, unitPrice: 0, supplyAmt: 0, taxAmt: 0,
        memo: '업체제공', isRawMaterial: false, isVendorProvided: true, originalUnitPrice: 0,
      });
    }
  }

  // ── 철형 합계 (금액 > 0 일 때만) ──
  const cheolLines = srcLines.filter(l => l.category === '철형' && l.itemName.trim() && !l.isVendorProvided);
  const cheolTotal = cheolLines.reduce((s, l) => s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate) * toKrw, 0);
  if (cheolTotal > 0) {
    const sup = ceil10(cheolTotal);
    rows.push({ id: genId(), category: '철형', itemName: '철형 일체', qty: 1, unitPrice: sup, supplyAmt: sup, taxAmt: ceil10(sup * 0.1), memo: '', isRawMaterial: false, isVendorProvided: false, originalUnitPrice: sup });
  }

  // ── 후가공 합계 (금액 > 0 일 때만) ──
  const postProcLines = colorBom ? (colorBom.postProcessLines ?? []) : (bom.postProcessLines || []);
  const activePostProcLines = postProcLines.filter(l => l.name && l.unitPrice > 0);
  const postProcTotal = activePostProcLines.reduce((s, l) => s + l.netQty * l.unitPrice * toKrw, 0);
  if (postProcTotal > 0) {
    const sup = ceil10(postProcTotal);
    // 후가공 항목명: 실제 항목이 1개면 그 이름, 여러 개면 열거
    const postProcLabel = activePostProcLines.length === 1
      ? activePostProcLines[0].name
      : activePostProcLines.map(l => l.name).join('/');
    rows.push({ id: genId(), category: '후가공', itemName: postProcLabel, qty: 1, unitPrice: sup, supplyAmt: sup, taxAmt: ceil10(sup * 0.1), isRawMaterial: false, isVendorProvided: false, originalUnitPrice: sup });
  }

  // ── 임가공비 ──
  const processingFee = colorBom ? (colorBom.processingFee ?? 0) : (tab === 'post' ? (bom.postProcessingFee || 0) : bom.processingFee);
  if (processingFee > 0) {
    const sup = ceil10(processingFee * toKrw);
    rows.push({ id: genId(), category: '가공비', itemName: '임가공', qty: 1, unitPrice: sup, supplyAmt: sup, taxAmt: ceil10(sup * 0.1), isRawMaterial: false, isVendorProvided: false, originalUnitPrice: sup });
  }

  // ── 관세 (관세율 > 0 일 때만) ──
  const customsRate = bom.customsRate || 0;
  if (customsRate > 0 && processingFee > 0) {
    const processingKrw = processingFee * toKrw;
    const customsAmt = ceil10(processingKrw * (customsRate / 100));
    rows.push({ id: genId(), category: '관세', itemName: `관세 (${customsRate}%)`, qty: 1, unitPrice: customsAmt, supplyAmt: customsAmt, taxAmt: ceil10(customsAmt * 0.1), isRawMaterial: false, isVendorProvided: false, originalUnitPrice: customsAmt });
  }

  // ── 물류비 (금액 > 0 일 때만) ──
  const logisticsKrw = bom.logisticsCostKrw || 0;
  if (logisticsKrw > 0) {
    rows.push({ id: genId(), category: '물류비', itemName: '물류비', qty: 1, unitPrice: logisticsKrw, supplyAmt: logisticsKrw, taxAmt: ceil10(logisticsKrw * 0.1), isRawMaterial: false, isVendorProvided: false, originalUnitPrice: logisticsKrw });
  }

  return rows;
}

/** 마진 배분 로직:
 * 공장단가(KRW) = 업체제공 제외 rows 합계 공급가액
 * 목표 납품가 = 공장단가 / (1 - internalMargin)   ← 내부 마진(실제 목표)
 * 견적 납품가 = 공장단가 / (1 - quoteMargin)       ← 견적 마진(바이어 제시)
 * 마진 행 금액 = 목표 납품가 - 견적 납품가          ← 생산관리비용으로 별도 표시
 * 비원자재 행에는 견적 마진 배분; 차액은 isMarginRow 행으로 추가
 */
function applyMarginAdjustment(rows: QuoteRow[], internalMargin: number, quoteMargin: number): { adjustedRows: QuoteRow[]; factoryCost: number; targetPrice: number; quotePrice: number; diff: number } {
  // 업체제공 제외한 합계가 기준
  const factoryCost = rows.reduce((s, r) => r.isVendorProvided ? s : s + r.supplyAmt, 0);
  const targetPrice = ceil10(factoryCost / (1 - internalMargin));
  const quotePrice = ceil10(factoryCost / (1 - quoteMargin));
  const diff = targetPrice - quotePrice; // 내부 마진 - 견적 마진 차액 = 생산관리비용

  // 조정 대상: 원자재 아니고 업체제공 아닌 행, 기존 마진 행 제외
  const adjustableRows = rows.filter(r => !r.isRawMaterial && !r.isVendorProvided && !r.isMarginRow);
  const adjustableTotal = adjustableRows.reduce((s, r) => s + r.supplyAmt, 0);

  // 견적 마진을 비원자재 행에 비례 배분 (quoteMargin 기준)
  const quoteMarginAmt = quotePrice - factoryCost;
  let quotaAdjustedRows: QuoteRow[];
  if (adjustableTotal === 0 || quoteMarginAmt <= 0) {
    quotaAdjustedRows = rows.filter(r => !r.isMarginRow);
  } else {
    quotaAdjustedRows = rows.filter(r => !r.isMarginRow).map(r => {
      if (r.isRawMaterial || r.isVendorProvided) return r;
      const ratio = r.supplyAmt / adjustableTotal;
      const addAmt = ceil10(quoteMarginAmt * ratio);
      const newSupply = ceil10(r.supplyAmt + addAmt);
      const newUnitPrice = r.qty > 0 ? ceil10(newSupply / r.qty) : newSupply;
      const newTax = ceil10(newSupply * 0.1);
      return { ...r, unitPrice: newUnitPrice, supplyAmt: newSupply, taxAmt: newTax };
    });
  }

  // 마진 행(생산관리비용) 추가 — diff > 0 일 때만
  if (diff > 0) {
    quotaAdjustedRows.push({
      id: genId(),
      category: '마진',
      itemName: '생산관리비용',
      qty: 1,
      unitPrice: diff,
      supplyAmt: diff,
      taxAmt: ceil10(diff * 0.1),
      memo: '',
      isRawMaterial: false,
      isVendorProvided: false,
      originalUnitPrice: diff,
      isMarginRow: true,
    });
  }

  return { adjustedRows: quotaAdjustedRows, factoryCost, targetPrice, quotePrice, diff };
}

function VendorQuoteModal({ bom, onClose, tab = 'pre', colorBom }: { bom: ExtBom; onClose: () => void; tab?: 'pre' | 'post'; colorBom?: ExtColorBom }) {
  const [rows, setRows] = useState<QuoteRow[]>(() => buildQuoteRows(bom, tab, colorBom));
  const [recipient, setRecipient] = useState('');
  const [dateStr, setDateStr] = useState(new Date().toISOString().split('T')[0]);
  const printRef = useRef<HTMLDivElement>(null);

  // 마진율 설정
  const [internalMargin, setInternalMargin] = useState(Math.round((bom?.productionMarginRate ?? 0.3) * 100)); // %
  const [quoteMargin, setQuoteMargin] = useState(16); // %
  const [marginInfo, setMarginInfo] = useState<{ factoryCost: number; targetPrice: number; quotePrice: number; diff: number } | null>(null);
  const [marginApplied, setMarginApplied] = useState(false);

  // 마진이 별도 행으로 포함되어 있으므로 rows 전체 합산이 곧 최종 견적가
  const totalSupply = rows.filter(r => !r.isVendorProvided).reduce((s, r) => s + r.supplyAmt, 0);
  const totalTax = rows.filter(r => !r.isVendorProvided).reduce((s, r) => s + r.taxAmt, 0);
  const grandTotal = ceil10(totalSupply + totalTax);

  // 소계 패널용 (마진 행 제외한 원가 소계)
  const baseSupply = rows.filter(r => !r.isVendorProvided && !r.isMarginRow).reduce((s, r) => s + r.supplyAmt, 0);
  const marginRowAmt = rows.find(r => r.isMarginRow)?.supplyAmt ?? 0;
  // 마진 미적용 상태의 표시용 견적가 (마진 행이 없을 때 quoteMargin 기준 참고값)
  const marginAmt = marginRowAmt > 0 ? marginRowAmt : ceil10(baseSupply * (quoteMargin / 100));
  const quoteSupply = baseSupply + marginAmt;
  const quoteTax = ceil10(quoteSupply * 0.1);

  const updateRow = (id: string, field: keyof QuoteRow, val: string | number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const u = { ...r, [field]: val };
      if (field === 'qty' || field === 'unitPrice') {
        u.supplyAmt = ceil10(Number(u.qty) * Number(u.unitPrice));
        u.taxAmt = ceil10(u.supplyAmt * 0.1);
      }
      if (field === 'supplyAmt') u.taxAmt = ceil10(Number(val) * 0.1);
      return u;
    }));
  };

  // 마진 자동 조정 실행
  const handleApplyMargin = () => {
    const internalRate = internalMargin / 100;
    const quoteRate = quoteMargin / 100;
    const base = buildQuoteRows(bom, tab, colorBom); // 원본 기준으로 재계산
    const { adjustedRows, factoryCost, targetPrice, quotePrice, diff } = applyMarginAdjustment(base, internalRate, quoteRate);
    setRows(adjustedRows);
    setMarginInfo({ factoryCost, targetPrice, quotePrice, diff });
    setMarginApplied(true);
  };

  // 마진 초기화
  const handleResetMargin = () => {
    setRows(buildQuoteRows(bom, tab, colorBom));
    setMarginInfo(null);
    setMarginApplied(false);
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

          {/* ── 마진율 조정 패널 ── */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-3">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-xs font-semibold text-amber-800">마진율 설정</span>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-stone-500 whitespace-nowrap">내부 마진율</label>
                <Input
                  type="number" min={20} max={50} value={internalMargin}
                  onChange={e => { setInternalMargin(Number(e.target.value)); setMarginApplied(false); }}
                  className="h-7 text-xs w-20 text-right border-amber-300"
                />
                <span className="text-xs text-stone-500">%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-stone-500 whitespace-nowrap">견적 마진율</label>
                <Input
                  type="number" min={15} max={20} value={quoteMargin}
                  onChange={e => { setQuoteMargin(Number(e.target.value)); setMarginApplied(false); }}
                  className="h-7 text-xs w-20 text-right border-amber-300"
                />
                <span className="text-xs text-stone-500">%</span>
              </div>
              <Button size="sm" onClick={handleApplyMargin} className="text-xs h-7 gap-1 bg-amber-600 hover:bg-amber-700 text-white">
                <Calculator className="w-3 h-3" /> 마진 자동 조정
              </Button>
              {marginApplied && (
                <Button size="sm" variant="outline" onClick={handleResetMargin} className="text-xs h-7 gap-1 border-stone-300 text-stone-500">
                  <X className="w-3 h-3" /> 초기화
                </Button>
              )}
            </div>

            {marginInfo && (
              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-amber-200">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-stone-500">실제 공장단가</span>
                    <span className="font-medium">{fmtKrw(marginInfo.factoryCost)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-stone-500">견적 납품가 <span className="text-stone-400">({quoteMargin}% 기준)</span></span>
                    <span className="font-medium text-blue-700">{fmtKrw(marginInfo.quotePrice)}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-stone-500">목표 납품가 <span className="text-stone-400">(내부 {internalMargin}% 기준)</span></span>
                    <span className="font-medium text-amber-700">{fmtKrw(marginInfo.targetPrice)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-stone-500">부자재 조정액</span>
                    <span className={`font-semibold ${marginInfo.diff > 0 ? 'text-green-700' : 'text-stone-500'}`}>
                      {marginInfo.diff > 0 ? `+${fmtKrw(marginInfo.diff)}` : '조정 없음'}
                    </span>
                  </div>
                </div>
                <div className="col-span-2 text-[10px] text-stone-400">
                  ※ 원자재 단가는 고정. 부자재·포장재·후가공·임가공 금액에 비례 배분됩니다.
                </div>
              </div>
            )}
          </div>

          <div className="bg-stone-50 border border-stone-200 rounded-lg px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>소계 (업체제공·마진 제외)</span>
              <span className="tabular-nums">{fmtKrw(baseSupply)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-amber-700">
              <span>생산관리비용 {marginRowAmt > 0 ? '(내/견적 마진 차액)' : `(견적 마진 ${quoteMargin}% 참고)`}</span>
              <span className="tabular-nums font-medium">+ {fmtKrw(marginAmt)}</span>
            </div>
            <div className="border-t border-stone-200 pt-1.5 flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-700">견적 공급가</span>
              <span className="text-base font-bold text-stone-800 tabular-nums">{fmtKrw(totalSupply)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>세액 (10%)</span>
              <span className="tabular-nums">{fmtKrw(totalTax)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-stone-300 pt-1.5">
              <span className="text-sm font-bold text-stone-800">합계금액 (공급가+세액)</span>
              <span className="text-xl font-bold text-[#C9A96E] tabular-nums">{fmtKrw(grandTotal)}</span>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-stone-800 text-white">
                  <th className="px-2 py-2 text-center w-8">No</th>
                  <th className="px-2 py-2 text-left w-28">구분</th>
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
                {rows.map((row, idx) => {
                  const vendorRow = row.isVendorProvided;
                  const marginRow = row.isMarginRow;
                  const rowBg = marginRow
                    ? 'bg-amber-50'
                    : vendorRow
                    ? 'bg-blue-50'
                    : idx % 2 === 0 ? 'bg-white' : 'bg-stone-50';
                  return (
                    <tr key={row.id} className={rowBg}>
                      <td className="px-2 py-1.5 text-center text-stone-400">{idx + 1}</td>
                      <td className="px-1 py-1 min-w-[7rem]">
                        <Input value={row.category} onChange={e => updateRow(row.id, 'category', e.target.value)} className={`h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 ${vendorRow ? 'text-blue-700 font-medium' : ''} ${marginRow ? 'text-amber-700 font-semibold' : ''}`} />
                      </td>
                      <td className="px-1 py-1"><Input value={row.itemName} onChange={e => updateRow(row.id, 'itemName', e.target.value)} className={`h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 ${vendorRow ? 'text-blue-700' : ''} ${marginRow ? 'text-amber-700' : ''}`} /></td>
                      <td className="px-1 py-1"><Input type="number" value={parseFloat(row.qty.toFixed(2))} onChange={e => updateRow(row.id, 'qty', Number(e.target.value))} className={`h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-right ${vendorRow ? 'text-blue-700 font-semibold' : ''}`} /></td>
                      <td className="px-1 py-1">
                        <div className="text-right">
                          {vendorRow ? (
                            <span className="text-xs text-blue-400 px-1">—</span>
                          ) : (
                            <Input
                              type="text"
                              value={row.unitPrice.toLocaleString()}
                              onChange={e => updateRow(row.id, 'unitPrice', Number(e.target.value.replace(/,/g, '')))}
                              className={`h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-right ${marginRow ? 'text-amber-700 font-semibold' : ''}`}
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-1 py-1">
                        {vendorRow ? (
                          <span className="text-xs text-blue-400 px-1 block text-right">—</span>
                        ) : (
                          <Input type="number" value={row.supplyAmt} onChange={e => updateRow(row.id, 'supplyAmt', Number(e.target.value))} className={`h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-right ${marginRow ? 'text-amber-700 font-semibold' : ''}`} />
                        )}
                      </td>
                      <td className={`px-2 py-1.5 text-right ${marginRow ? 'text-amber-700 font-semibold' : 'text-stone-600'}`}>{vendorRow ? '—' : fmtKrw(row.taxAmt)}</td>
                      <td className={`px-2 py-1.5 text-right font-medium ${marginRow ? 'text-amber-700' : ''}`}>{vendorRow ? '—' : fmtKrw(ceil10(row.supplyAmt + row.taxAmt))}</td>
                      <td className="px-1 py-1">{marginRow ? null : <Input value={row.memo || ''} onChange={e => updateRow(row.id, 'memo', e.target.value)} className={`h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 ${vendorRow ? 'text-blue-600 font-medium' : ''}`} placeholder="비고" />}</td>
                      <td className="px-1 py-1 text-center"><button onClick={() => setRows(p => p.filter(r => r.id !== row.id))} className="text-stone-300 hover:text-red-400"><X className="w-3 h-3" /></button></td>
                    </tr>
                  );
                })}
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
                <thead><tr><th style={{width:'28px'}}>No</th><th style={{width:'80px'}}>구분</th><th>품목</th><th style={{width:'55px'}}>소요량</th><th style={{width:'85px'}}>단가</th><th style={{width:'85px'}}>공급가액</th><th style={{width:'75px'}}>세액</th><th style={{width:'85px'}}>합계금액</th><th style={{width:'75px'}}>비고</th></tr></thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.id} style={
                      row.isMarginRow ? {background:'#fffbeb'} :
                      row.isVendorProvided ? {background:'#EFF6FF'} : {}
                    }>
                      <td>{idx + 1}</td>
                      <td className="tl2" style={
                        row.isMarginRow ? {color:'#b45309', fontWeight:'600'} :
                        row.isVendorProvided ? {color:'#1D4ED8'} : {}
                      }>{row.category}</td>
                      <td className="tl2" style={
                        row.isMarginRow ? {color:'#b45309'} :
                        row.isVendorProvided ? {color:'#1D4ED8'} : {}
                      }>{row.itemName}</td>
                      <td className="tr2">{parseFloat(row.qty.toFixed(2))}</td>
                      <td className="tr2">{row.isVendorProvided ? '—' : row.unitPrice.toLocaleString()}</td>
                      <td className="tr2">{row.isVendorProvided ? '—' : row.supplyAmt.toLocaleString()}</td>
                      <td className="tr2">{row.isVendorProvided ? '—' : row.taxAmt.toLocaleString()}</td>
                      <td className="tr2">{row.isVendorProvided ? '—' : ceil10(row.supplyAmt + row.taxAmt).toLocaleString()}</td>
                      <td style={row.isVendorProvided ? {color:'#2563EB',fontWeight:'600'} : {}}>{row.isMarginRow ? '' : row.memo}</td>
                    </tr>
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

// ─── 자재업체 자동완성 컴포넌트 (본사제공 시 사용) ────────────────────────────
function VendorAutoComplete({ value, vendorId, isNewVendor, onChange }: {
  value: string;
  vendorId?: string;
  isNewVendor?: boolean;
  onChange: (name: string, id?: string, isNew?: boolean) => void;
}) {
  const [, setLocation] = useLocation();
  const [inputVal, setInputVal] = useState(value);
  const [suggestions, setSuggestions] = useState<Vendor[]>([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const vendors = store.getVendors().filter(v => v.type === '자재거래처');

  // 외부 value 변경 시 inputVal 동기화
  useEffect(() => { setInputVal(value); }, [value]);

  const handleInput = (text: string) => {
    setInputVal(text);
    if (!text.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const lower = text.toLowerCase();
    const matched = vendors.filter(v => v.name.toLowerCase().includes(lower)).slice(0, 8);
    setSuggestions(matched);
    setOpen(matched.length > 0);
  };

  const selectVendor = (v: Vendor) => {
    setInputVal(v.name);
    setSuggestions([]);
    setOpen(false);
    onChange(v.name, v.id, false);
  };

  const registerNew = () => {
    const name = inputVal.trim();
    if (!name) return;
    // 이미 존재하는 업체면 그냥 선택
    const existing = vendors.find(v => v.name === name);
    if (existing) { selectVendor(existing); return; }
    // 신규 등록
    const newVendor: Vendor = {
      id: genId(),
      name,
      type: '자재거래처',
      country: '한국',
      currency: 'KRW',
      contactHistory: [],
      createdAt: new Date().toISOString(),
    };
    store.addVendor(newVendor);
    toast.success(`"${name}" 거래처 마스터에 등록됨`);
    setInputVal(name);
    setSuggestions([]);
    setOpen(false);
    onChange(name, newVendor.id, true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); registerNew(); }
    if (e.key === 'Escape') { setOpen(false); }
  };

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const goToVendorMaster = () => {
    if (vendorId) setLocation(`/vendors?edit=${vendorId}`);
    else setLocation('/vendors');
  };

  return (
    <div ref={containerRef} className="relative w-36">
      <div className="flex items-center gap-0.5">
        <Input
          ref={inputRef}
          value={inputVal}
          onChange={e => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!inputVal.trim()) {
              setSuggestions(vendors.slice(0, 8));
            }
            setOpen(true);
          }}
          className="h-7 text-xs border-stone-200 bg-amber-50/60 w-full"
          placeholder="업체명 검색/입력"
        />
        {isNewVendor && (
          <button
            onClick={goToVendorMaster}
            title="기본 정보 미입력 — 거래처 마스터에서 추가 정보 입력 필요"
            className="text-red-500 hover:text-red-700 shrink-0"
          >
            <span className="text-sm">❗</span>
          </button>
        )}
      </div>
      {/* 자동완성 드롭다운 */}
      {open && (
        <div className="absolute z-50 top-full left-0 mt-0.5 bg-white border border-stone-200 rounded shadow-lg w-48 max-h-48 overflow-auto">
          {suggestions.map(v => (
            <button
              key={v.id}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-amber-50 text-stone-800"
              onMouseDown={() => selectVendor(v)}
            >
              {v.name}
            </button>
          ))}
          {inputVal.trim() && !vendors.find(v => v.name === inputVal.trim()) && (
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-green-50 text-green-700 border-t border-stone-100 flex items-center gap-1"
              onMouseDown={registerNew}
            >
              <span>+</span> <span>"{inputVal.trim()}" 신규 등록</span>
            </button>
          )}
        </div>
      )}
    </div>
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
  const isCustomUnit = line.unit === '직접입력';
  const displayUnit = isCustomUnit ? (line.customUnit || '') : line.unit;
  const subPartOptions = SECTION_SUB_PARTS[sectionKey] || ['기타'];

  // 공급 상태 판단
  const isHqProvided = line.isHqProvided;
  const isVendorProvided = !!(line.isVendorProvided);
  // 본사/업체 동시 체크 불가: 본사제공 우선
  const supplyLabel = !isHqProvided && !isVendorProvided
    ? { text: '공장', cls: 'text-stone-400' }
    : isVendorProvided && !isHqProvided
    ? { text: '업체', cls: 'text-blue-500' }
    : { text: '본사', cls: 'text-amber-600 font-semibold' };

  const handleMaterialSelect = (m: Material) => {
    onChange(line.id, 'itemName', m.name);
    if (m.spec) onChange(line.id, 'spec', m.spec);
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
      if (vendor) {
        onChange(line.id, 'vendorName', vendor.name);
        onChange(line.id, 'vendorId', vendor.id);
      }
    }
  };

  const handleHqChange = (checked: boolean) => {
    onChange(line.id, 'isHqProvided', checked);
    if (checked) {
      // 본사제공 체크 시 업체제공 해제
      onChange(line.id, 'isVendorProvided', false);
    } else {
      // 본사제공 해제 시 업체 정보 초기화
      onChange(line.id, 'vendorName', '');
      onChange(line.id, 'vendorId', '');
      onChange(line.id, 'isNewVendor', false);
    }
  };

  const handleVendorChange = (checked: boolean) => {
    onChange(line.id, 'isVendorProvided', checked);
    if (checked) {
      // 업체제공 체크 시 본사제공 해제 + 업체 정보 초기화
      onChange(line.id, 'isHqProvided', false);
      onChange(line.id, 'vendorName', '');
      onChange(line.id, 'vendorId', '');
      onChange(line.id, 'isNewVendor', false);
    }
  };

  const handleVendorAutoComplete = (name: string, id?: string, isNew?: boolean) => {
    onChange(line.id, 'vendorName', name);
    onChange(line.id, 'vendorId', id || '');
    onChange(line.id, 'isNewVendor', isNew || false);
  };

  const ringCls = accentColor === 'blue'
    ? 'hover:bg-blue-50/30'
    : 'hover:bg-amber-50/30';

  return (
    <tr className={`group transition-colors border-b border-stone-100 ${ringCls}`}>
      {/* 자재명 (부위 Select가 inline으로 포함됨) */}
      <td className="px-1 py-1">
        <div className="flex items-center gap-1">
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
      {/* 공급 상태 + 체크박스 (본사/업체/공장) */}
      <td className="px-2 py-1 w-28">
        <div className="flex flex-col items-center gap-1.5">
          {/* 공급 상태 텍스트 */}
          <span className={`text-sm font-semibold ${supplyLabel.cls}`}>{supplyLabel.text}</span>
          {/* 체크박스 2개 */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 cursor-pointer" title="본사제공">
              <input type="checkbox" checked={isHqProvided} onChange={e => handleHqChange(e.target.checked)} className="w-4 h-4 accent-amber-600" />
              <span className="text-xs text-amber-600 font-medium">본사</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer" title="업체제공">
              <input type="checkbox" checked={isVendorProvided} onChange={e => handleVendorChange(e.target.checked)} className="w-4 h-4 accent-blue-500" />
              <span className="text-xs text-blue-500 font-medium">업체</span>
            </label>
          </div>
        </div>
      </td>
      {/* 자재업체 (본사제공 시에만 입력 가능) */}
      <td className="px-1 py-1">
        {isHqProvided ? (
          <VendorAutoComplete
            value={line.vendorName || ''}
            vendorId={line.vendorId}
            isNewVendor={line.isNewVendor}
            onChange={handleVendorAutoComplete}
          />
        ) : (
          <span className="text-[10px] text-stone-300 px-2">—</span>
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
  const marginClass = marginPct < 15 ? 'text-red-600' : marginPct < 20 ? 'text-amber-600' : marginPct <= 30 ? 'text-green-600' : 'text-orange-600';
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

        {/* 관세 */}
        {ps.customsRate > 0 && (
          <div className="flex justify-between items-center px-4 py-2 bg-stone-50 rounded-lg border border-stone-200 text-xs">
            <span className="text-stone-600 font-medium">관세 ({ps.customsRate}%)</span>
            <span className="text-stone-800 font-medium">{fmtKrw(ps.customsKrw)}</span>
          </div>
        )}

        {/* 구분선 */}
        <div className="border-t border-stone-200 my-1" />

        {/* 공장단가 (강조) */}
        <div className="bg-amber-50 rounded-xl border-2 border-amber-300 px-4 py-3">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm font-bold text-stone-800">🏭 공장단가</span>
              <div className="text-[10px] text-stone-500 mt-0.5">공장구매자재 + 임가공 + 관세 (본사제공 제외)</div>
            </div>
            <div className="text-right">
              <div className="text-base font-bold text-amber-700">{fmtCny(ps.factoryUnitCostCny)}</div>
              {showKrw && <div className="text-sm font-semibold text-stone-600">{fmtKrw(ps.factoryUnitCostKrw)}</div>}
            </div>
          </div>
        </div>

        {/* 물류비 */}
        {ps.logisticsKrw > 0 && (
          <div className="flex justify-between items-center px-4 py-2 bg-stone-50 rounded-lg border border-stone-200 text-xs">
            <span className="text-stone-600 font-medium">물류비</span>
            <span className="text-stone-800 font-medium">{fmtKrw(ps.logisticsKrw)}</span>
          </div>
        )}

        {/* 제품원가 */}
        <div className="bg-stone-800 rounded-xl px-4 py-3">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm font-bold text-white">📦 제품원가</span>
              <div className="text-[10px] text-stone-400 mt-0.5">공장단가 + 본사제공 + 물류비</div>
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

  // URL 파라미터 감지 (품목 마스터 컬러 BOM 바로가기)
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  // 최상위 탭: 'pre' | 'post'
  const [mainTab, setMainTab] = useState<'pre' | 'post'>('pre');
  // 각 탭 내 활성 컬러 탭
  const [activePreColor, setActivePreColor] = useState<string>('');
  const [activePostColor, setActivePostColor] = useState<string>('');
  // 컬러 탭 추가 모달
  const [showAddColorModal, setShowAddColorModal] = useState(false);
  const [addColorForTab, setAddColorForTab] = useState<'pre' | 'post'>('pre');
  const [newColorName, setNewColorName] = useState('');
  // "다른 컬러에서 복사" 드롭다운 상태
  const [copyFromColor, setCopyFromColor] = useState<string>('');
  // URL 파라미터로 자동 활성화할 컬러명 (품목 마스터 연동)
  const [pendingColorTab, setPendingColorTab] = useState<string | null>(null);
  // activeTab 변수는 제거됨 — mainTab, activePreColor, activePostColor를 직접 사용

  const [extBoms, setExtBoms] = useState<ExtBom[]>(() => getExtBoms());
  const [selectedStyleId, setSelectedStyleId] = useState<string>(() => {
    // 1) URL 파라미터 우선 처리
    const urlParams = new URLSearchParams(searchString);
    const urlStyleNo = urlParams.get('styleNo');
    if (urlStyleNo) {
      const item = store.getItems().find(i => i.styleNo === urlStyleNo);
      if (item) return item.id;
    }
    // 2) localStorage prefill 처리
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
    // _reload 접미사 처리 (강제 재로드용)
    const styleId = selectedStyleId.endsWith('_reload')
      ? selectedStyleId.replace('_reload', '')
      : selectedStyleId;

    if (!styleId) { setEditBom(null); setActivePreColor(''); setActivePostColor(''); return; }
    const item = items.find(i => i.id === styleId);
    const styleBoms = extBoms.filter(b => b.styleId === styleId);
    let loadedBom: ExtBom;
    if (styleBoms.length > 0) {
      const loaded: ExtBom = JSON.parse(JSON.stringify(styleBoms.sort((a, b) => b.version - a.version)[0]));
      if (item) {
        loaded.styleNo = item.styleNo;
        loaded.styleName = item.name;
        loaded.season = item.season;
        loaded.designer = (item as Item & { designer?: string }).designer || loaded.designer || '';
        loaded.erpCategory = item.erpCategory || loaded.erpCategory || '';
      }
      loadedBom = normalizeBom(loaded);
    } else {
      if (!item) return;
      const nb = createNewBom(settings);
      nb.styleId = item.id;
      nb.styleNo = item.styleNo;
      nb.styleName = item.name;
      nb.season = item.season;
      nb.designer = (item as Item & { designer?: string }).designer || '';
      nb.erpCategory = item.erpCategory || '';
      loadedBom = nb;
    }

    // colorBoms 없고 lines에 실제 데이터가 있으면 자동으로 '기본' 컬러 탭 생성
    // (Supabase에서 동기화된 기존 BOM 데이터 호환)
    if ((!loadedBom.colorBoms || loadedBom.colorBoms.length === 0) && loadedBom.lines.some(l => l.itemName)) {
      loadedBom = {
        ...loadedBom,
        colorBoms: [{
          color: '기본',
          lines: loadedBom.lines.map(l => ({ ...l, id: l.id || genId() })),
          postProcessLines: (loadedBom.postProcessLines || []).map(l => ({ ...l, id: l.id || genId() })),
          processingFee: loadedBom.processingFee || 0,
        }],
      };
    }

    setEditBom(loadedBom);
    setIsDirty(false);

    // 사전원가 컬러 탭 자동 활성화
    const colors = loadedBom.colorBoms || [];
    if (colors.length > 0) {
      setActivePreColor(colors[0].color);
    } else {
      // 빈 BOM이면 컬러 추가 모달 열기
      setActivePreColor('');
      setAddColorForTab('pre');
      setShowAddColorModal(true);
    }
    // 사후원가 컬러 탭 자동 활성화
    const postColors = loadedBom.postColorBoms || [];
    if (postColors.length > 0) {
      setActivePostColor(postColors[0].color);
    } else {
      setActivePostColor('');
    }
  }, [selectedStyleId]);

  // URL 파라미터로 컬러 탭 자동 활성화 (품목 마스터 BOM 바로가기 연동)
  useEffect(() => {
    const urlParams = new URLSearchParams(searchString);
    const urlColor = urlParams.get('color');
    if (urlColor) {
      setPendingColorTab(urlColor);
      // URL 파라미터 제거 (히스토리 클린업)
      setLocation('/bom', { replace: true });
    }
  }, [searchString]);

  // pendingColorTab이 설정되면 editBom 로드 후 사전원가 탭 활성화
  useEffect(() => {
    if (!pendingColorTab || !editBom) return;
    const colorExists = (editBom.colorBoms || []).some(cb => cb.color === pendingColorTab);
    if (colorExists) {
      setMainTab('pre');
      setActivePreColor(pendingColorTab);
      setPendingColorTab(null);
    } else {
      setMainTab('pre');
      setNewColorName(pendingColorTab);
      setAddColorForTab('pre');
      setShowAddColorModal(true);
      setPendingColorTab(null);
    }
  }, [pendingColorTab, editBom]);

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

  // ─── 컬러 BOM 핸들러 ────────────────────────────────────────────────────
  // 컬러 탭 추가 (사전/사후 구분)
  const addColorBom = useCallback((color: string, forTab: 'pre' | 'post' = 'pre') => {
    setEditBom(prev => {
      if (!prev) return prev;
      const bomKey = forTab === 'post' ? 'postColorBoms' : 'colorBoms';
      const existing = (prev[bomKey] || []).find((cb: ExtColorBom) => cb.color === color);
      if (existing) return prev;

      const colors = prev[bomKey] || [];
      let newLines: ExtBomLine[];
      let newPostProcessLines: PostProcessLine[];
      let newProcessingFee: number;

      if (colors.length > 0) {
        // 첫 번째 컬러 탭의 전체 BOM 복사
        const firstColor = colors[0];
        newLines = firstColor.lines.map(l => ({ ...l, id: genId() }));
        newPostProcessLines = (firstColor.postProcessLines ?? []).map(l => ({ ...l, id: genId() }));
        newProcessingFee = firstColor.processingFee ?? 0;
      } else {
        // 첫 번째 컬러: 기존 데이터가 있으면 복사, 없으면 빈 구조
        const srcLines = forTab === 'post' ? (prev.postMaterials || []) : prev.lines;
        const hasExistingLines = srcLines.some(l => l.itemName);
        if (hasExistingLines) {
          newLines = srcLines.map(l => ({ ...l, id: genId() }));
          newPostProcessLines = (forTab === 'post' ? (prev.postProcessLines || []) : (prev.postProcessLines || [])).map(l => ({ ...l, id: genId() }));
          newProcessingFee = forTab === 'post' ? (prev.postProcessingFee || 0) : (prev.processingFee || 0);
        } else {
          newLines = BOM_SECTIONS.flatMap(cat => [newExtLine(cat)]);
          newPostProcessLines = [newPostLine()];
          newProcessingFee = 0;
        }
      }

      return {
        ...prev,
        [bomKey]: [...colors, {
          color,
          lines: newLines,
          postProcessLines: newPostProcessLines,
          processingFee: newProcessingFee,
        }],
      };
    });
    markDirty();
    if (forTab === 'post') setActivePostColor(color);
    else setActivePreColor(color);
  }, []);

  // 컬러 탭 삭제 (사전/사후 구분)
  const removeColorBom = useCallback((color: string, forTab: 'pre' | 'post' = 'pre') => {
    setEditBom(prev => {
      if (!prev) return prev;
      const bomKey = forTab === 'post' ? 'postColorBoms' : 'colorBoms';
      const newColors = (prev[bomKey] || []).filter((cb: ExtColorBom) => cb.color !== color);
      if (forTab === 'post') {
        if (newColors.length > 0) setActivePostColor(newColors[0].color);
        else setActivePostColor('');
      } else {
        if (newColors.length > 0) setActivePreColor(newColors[0].color);
        else { setActivePreColor(''); setAddColorForTab('pre'); setShowAddColorModal(true); }
      }
      return { ...prev, [bomKey]: newColors };
    });
    markDirty();
  }, []);

  // 컬러 BOM 행 업데이트 (lines)
  const updateColorBomLine = useCallback((color: string, id: string, field: keyof ExtBomLine, val: unknown) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        colorBoms: (prev.colorBoms || []).map(cb =>
          cb.color === color
            ? { ...cb, lines: cb.lines.map(l => l.id === id ? { ...l, [field]: val } : l) }
            : cb
        ),
      };
    });
    markDirty();
  }, []);

  // 컬러 BOM 행 삭제 (lines)
  const deleteColorBomLine = useCallback((color: string, id: string) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        colorBoms: (prev.colorBoms || []).map(cb =>
          cb.color === color
            ? { ...cb, lines: cb.lines.filter(l => l.id !== id) }
            : cb
        ),
      };
    });
    markDirty();
  }, []);

  // 컬러 BOM 행 추가 (lines, 카테고리별)
  const addColorBomLine = useCallback((color: string, category: BomCategory) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        colorBoms: (prev.colorBoms || []).map(cb => {
          if (cb.color !== color) return cb;
          const idx = [...cb.lines].map(l => l.category).lastIndexOf(category);
          const lines = [...cb.lines];
          lines.splice(idx + 1, 0, newExtLine(category));
          return { ...cb, lines };
        }),
      };
    });
    markDirty();
  }, []);

  // 컬러 BOM 후가공 행 업데이트
  const updateColorPostLine = useCallback((color: string, id: string, field: keyof PostProcessLine, val: unknown) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        colorBoms: (prev.colorBoms || []).map(cb =>
          cb.color === color
            ? { ...cb, postProcessLines: (cb.postProcessLines ?? []).map(l => l.id === id ? { ...l, [field]: val } : l) }
            : cb
        ),
      };
    });
    markDirty();
  }, []);

  // 컬러 BOM 후가공 행 삭제
  const deleteColorPostLine = useCallback((color: string, id: string) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        colorBoms: (prev.colorBoms || []).map(cb =>
          cb.color === color
            ? { ...cb, postProcessLines: (cb.postProcessLines ?? []).filter(l => l.id !== id) }
            : cb
        ),
      };
    });
    markDirty();
  }, []);

  // 컬러 BOM 후가공 행 추가
  const addColorPostLine = useCallback((color: string) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        colorBoms: (prev.colorBoms || []).map(cb =>
          cb.color === color
            ? { ...cb, postProcessLines: [...(cb.postProcessLines ?? []), newPostLine()] }
            : cb
        ),
      };
    });
    markDirty();
  }, []);

  // 컬러 BOM 임가공비 업데이트
  const updateColorProcessingFee = useCallback((color: string, fee: number, forTab: 'pre' | 'post' = 'pre') => {
    setEditBom(prev => {
      if (!prev) return prev;
      const bomKey = forTab === 'post' ? 'postColorBoms' : 'colorBoms';
      return {
        ...prev,
        [bomKey]: (prev[bomKey] || []).map((cb: ExtColorBom) =>
          cb.color === color ? { ...cb, processingFee: fee } : cb
        ),
      };
    });
    markDirty();
  }, []);

  // 사후원가 컬러 BOM 행 업데이트
  const updatePostColorBomLine = useCallback((color: string, id: string, field: keyof ExtBomLine, val: unknown) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        postColorBoms: (prev.postColorBoms || []).map(cb =>
          cb.color === color
            ? { ...cb, lines: cb.lines.map(l => l.id === id ? { ...l, [field]: val } : l) }
            : cb
        ),
      };
    });
    markDirty();
  }, []);

  const deletePostColorBomLine = useCallback((color: string, id: string) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        postColorBoms: (prev.postColorBoms || []).map(cb =>
          cb.color === color
            ? { ...cb, lines: cb.lines.filter(l => l.id !== id) }
            : cb
        ),
      };
    });
    markDirty();
  }, []);

  const addPostColorBomLine = useCallback((color: string, category: BomCategory) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        postColorBoms: (prev.postColorBoms || []).map(cb => {
          if (cb.color !== color) return cb;
          const idx = [...cb.lines].map(l => l.category).lastIndexOf(category);
          const lines = [...cb.lines];
          lines.splice(idx + 1, 0, newExtLine(category));
          return { ...cb, lines };
        }),
      };
    });
    markDirty();
  }, []);

  const updatePostColorPostLine = useCallback((color: string, id: string, field: keyof PostProcessLine, val: unknown) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        postColorBoms: (prev.postColorBoms || []).map(cb =>
          cb.color === color
            ? { ...cb, postProcessLines: (cb.postProcessLines ?? []).map(l => l.id === id ? { ...l, [field]: val } : l) }
            : cb
        ),
      };
    });
    markDirty();
  }, []);

  const deletePostColorPostLine = useCallback((color: string, id: string) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        postColorBoms: (prev.postColorBoms || []).map(cb =>
          cb.color === color
            ? { ...cb, postProcessLines: (cb.postProcessLines ?? []).filter(l => l.id !== id) }
            : cb
        ),
      };
    });
    markDirty();
  }, []);

  const addPostColorPostLine = useCallback((color: string) => {
    setEditBom(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        postColorBoms: (prev.postColorBoms || []).map(cb =>
          cb.color === color
            ? { ...cb, postProcessLines: [...(cb.postProcessLines ?? []), newPostLine()] }
            : cb
        ),
      };
    });
    markDirty();
  }, []);

  // 다른 컬러에서 복사 (사전/사후 구분)
  const copyColorBom = useCallback((targetColor: string, sourceColor: string, forTab: 'pre' | 'post' = 'pre') => {
    setEditBom(prev => {
      if (!prev) return prev;
      const bomKey = forTab === 'post' ? 'postColorBoms' : 'colorBoms';
      const source = (prev[bomKey] || []).find((cb: ExtColorBom) => cb.color === sourceColor);
      if (!source) return prev;
      return {
        ...prev,
        [bomKey]: (prev[bomKey] || []).map((cb: ExtColorBom) =>
          cb.color === targetColor
            ? {
                ...cb,
                lines: source.lines.map(l => ({ ...l, id: genId() })),
                postProcessLines: (source.postProcessLines ?? []).map(l => ({ ...l, id: genId() })),
                processingFee: source.processingFee ?? 0,
              }
            : cb
        ),
      };
    });
    markDirty();
    toast.success(`[${sourceColor}] BOM을 [${targetColor}]에 복사했습니다`);
    setCopyFromColor('');
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
    // 첫 번째 컬러 BOM 기준으로 원가 업데이트 (없으면 lines 기준)
    const firstColor = (updated.colorBoms || [])[0];
    const summary = calcSummary(updated, settings.usdKrw, firstColor);
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

  // 사전원가 컬러 → 사후원가 컬러 복사
  const copyPreToPost = (color: string) => {
    if (!editBom) return;
    const preColorBom = (editBom.colorBoms || []).find(c => c.color === color);
    if (!preColorBom) { toast.error('사전원가에 해당 컬러가 없습니다'); return; }
    const postHas = (editBom.postColorBoms || []).some(c => c.color === color);
    const msg = postHas
      ? `기존 [${color}] 사후원가 데이터를 사전원가로 덮어쓰시겠습니까?`
      : `사전원가 [${color}] 데이터를 사후원가에 복사하시겠습니까?`;
    if (!confirm(msg)) return;
    setEditBom(prev => {
      if (!prev) return prev;
      const post = [...(prev.postColorBoms || [])];
      const idx = post.findIndex(c => c.color === color);
      const newColorBom = { ...preColorBom, lines: preColorBom.lines.map(l => ({ ...l, id: genId() })) };
      if (idx >= 0) post[idx] = newColorBom;
      else post.push(newColorBom);
      return { ...prev, postColorBoms: post };
    });
    toast.success(`사전원가 [${color}] → 사후원가 복사 완료`);
    markDirty();
  };

  // 사후원가 컬러 → 사전원가 컬러 복사
  // 전체 불러오기 함수
  const copyAllPostToPre = () => {
    const postBoms = editBom?.postColorBoms || [];
    if (postBoms.length === 0) { toast.error('사후원가에 등록된 컬러가 없습니다'); return; }
    if (!confirm(`사후원가 전체 ${postBoms.length}개 컬러를 사전원가로 복사하시겠습니까?\n기존 사전원가 데이터가 덮어씌워집니다.`)) return;
    setEditBom(prev => {
      if (!prev) return prev;
      const newColorBoms = postBoms.map(pb => ({
        ...pb,
        lines: pb.lines.map((l: any) => ({ ...l, id: genId() })),
      }));
      return { ...prev, colorBoms: newColorBoms };
    });
    toast.success(`사후원가 전체 ${postBoms.length}개 컬러 → 사전원가 복사 완료`);
    markDirty();
  };

  const copyAllPreToPost = () => {
    const preBoms = editBom?.colorBoms || [];
    if (preBoms.length === 0) { toast.error('사전원가에 등록된 컬러가 없습니다'); return; }
    if (!confirm(`사전원가 전체 ${preBoms.length}개 컬러를 사후원가로 복사하시겠습니까?\n기존 사후원가 데이터가 덮어씌워집니다.`)) return;
    setEditBom(prev => {
      if (!prev) return prev;
      const newPostColorBoms = preBoms.map(pb => ({
        ...pb,
        lines: pb.lines.map((l: any) => ({ ...l, id: genId() })),
      }));
      return { ...prev, postColorBoms: newPostColorBoms };
    });
    toast.success(`사전원가 전체 ${preBoms.length}개 컬러 → 사후원가 복사 완료`);
    markDirty();
  };

  const copyPostToPre = (color: string) => {
    if (!editBom) return;
    const postColorBomSrc = (editBom.postColorBoms || []).find(c => c.color === color);
    if (!postColorBomSrc) { toast.error('사후원가에 해당 컬러가 없습니다'); return; }
    const preHas = (editBom.colorBoms || []).some(c => c.color === color);
    const msg = preHas
      ? `기존 [${color}] 사전원가 데이터를 사후원가로 덮어쓰시겠습니까?`
      : `사후원가 [${color}] 데이터를 사전원가에 복사하시겠습니까?`;
    if (!confirm(msg)) return;
    setEditBom(prev => {
      if (!prev) return prev;
      const pre = [...(prev.colorBoms || [])];
      const idx = pre.findIndex(c => c.color === color);
      const newColorBom = { ...postColorBomSrc, lines: postColorBomSrc.lines.map(l => ({ ...l, id: genId() })) };
      if (idx >= 0) pre[idx] = newColorBom;
      else pre.push(newColorBom);
      return { ...prev, colorBoms: pre };
    });
    toast.success(`사후원가 [${color}] → 사전원가 복사 완료`);
    markDirty();
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
      // console.error(err);
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

      // 후가공 섹션 시작 감지 (아직 진입 안 했을 때만 - 재감지 방지)
      if (!inPostProcess && (rowStr.includes('부·소모재') || rowStr.includes('부소모재') || cellA.includes('후가공'))) {
        inPostProcess = true;
        continue;
      }

      // 구분(A열)에 값 있으면 섹션 갱신 (후가공 섹션 진입 후에는 스킵)
      if (cellA && !inPostProcess) {
        const detected = detectCategory(cellA);
        if (detected) {
          currentCategory = detected;
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
      // B96:B102 = 품목명, C96:C102 = 수량(NET), D96:D102 = 단가
      if (inPostProcess) {
        const workName = cellB;
        // 스킵 조건
        if (!workName || workName === '소계' || workName === '공임비' || workName === 'NET') continue;
        const netQtyPost = getNum(row, 2); // C열 = 수량
        const unitPrice = getNum(row, 3);  // D열 = 단가
        if (workName && unitPrice > 0) {
          postProcessLines.push({
            id: Math.random().toString(36).slice(2),
            name: workName.trim(),
            netQty: netQtyPost || 1,
            unitPrice: unitPrice,
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

      setEditBom(prev => {
        if (!prev) return prev;
        // 현재 활성 컬러 탭에 파싱 데이터 반영 (있으면)
        const currentColor = mainTab === 'pre' ? activePreColor : null;
        const updatedColorBoms = currentColor && (prev.colorBoms || []).some(cb => cb.color === currentColor)
          ? (prev.colorBoms || []).map(cb =>
              cb.color === currentColor
                ? {
                    ...cb,
                    lines: preMaterials.length > 0 ? preMaterials.map(l => ({ ...l, id: genId() })) : cb.lines,
                    postProcessLines: parsedPostLines.length > 0 ? parsedPostLines.map(l => ({ ...l, id: genId() })) : cb.postProcessLines,
                    processingFee: parsedProcessingFee || cb.processingFee,
                  }
                : cb
            )
          : prev.colorBoms;
        return {
          ...prev,
          lines: preMaterials.length > 0 ? preMaterials : prev.lines,
          processingFee: parsedProcessingFee || prev.processingFee,
          postProcessLines: parsedPostLines.length > 0 ? parsedPostLines : prev.postProcessLines,
          snapshotCnyKrw: parsedRate,
          preSourceFileName: file.name,
          colorBoms: updatedColorBoms,
        };
      });
      markDirty();
      toast.success(`원가표 파싱 완료: ${preMaterials.length}개 자재 행, 후가공 ${parsedPostLines.length}개, 임가공 ${parsedProcessingFee}, 환율 ${parsedRate}`);
    } catch (err) {
      // console.error(err);
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
      // console.error(err);
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

  // 현재 활성 컬러 BOM
  const activeColorBom = editBom && mainTab === 'pre'
    ? (editBom.colorBoms || []).find(cb => cb.color === activePreColor)
    : undefined;
  const activePostColorBom = editBom && mainTab === 'post'
    ? (editBom.postColorBoms || []).find(cb => cb.color === activePostColor)
    : undefined;
  // summary는 활성 컬러 BOM 기준 (없으면 lines 기준 fallback)
  const summary = editBom ? calcSummary(editBom, settings.usdKrw, activeColorBom) : null;
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
          <Button variant="outline" size="sm" onClick={() => setShowCopyModal(true)} className="gap-1.5 text-xs border-stone-300">
            <Copy className="w-3.5 h-3.5" /> 유사 스타일 복사
          </Button>
          {editBom && (activeColorBom || activePostColorBom) && (
            <Button variant="outline" size="sm" onClick={() => setShowQuote(true)} className="gap-1.5 text-xs border-[#C9A96E] text-[#C9A96E] hover:bg-amber-50">
              <FileText className="w-3.5 h-3.5" /> 업체용 견적서
            </Button>
          )}
          {editBom && isDirty && (
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
            <Select value={selectedStyleId.replace('_reload', '')} onValueChange={setSelectedStyleId}>
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
          {/* ── 최상위 탭: 사전원가 / 사후원가 ── */}
          <div className="flex items-center border-b-2 border-stone-200">
            <button
              onClick={() => setMainTab('pre')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-bold border-b-2 -mb-[2px] transition-colors whitespace-nowrap ${
                mainTab === 'pre'
                  ? 'border-emerald-500 text-emerald-700'
                  : 'border-transparent text-stone-400 hover:text-stone-600'
              }`}
            >
              사전원가
              {(editBom.colorBoms || []).length > 0 && (
                <Badge className="text-[10px] py-0 h-4 bg-emerald-100 text-emerald-700 border-emerald-300">{(editBom.colorBoms || []).length}컬러</Badge>
              )}
            </button>
            <button
              onClick={() => setMainTab('post')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-bold border-b-2 -mb-[2px] transition-colors whitespace-nowrap ${
                mainTab === 'post'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-stone-400 hover:text-stone-600'
              }`}
            >
              <Factory className="w-4 h-4" />
              사후원가
              {(editBom.postColorBoms || []).length > 0 && (
                <Badge className="text-[10px] py-0 h-4 bg-blue-100 text-blue-700 border-blue-300">{(editBom.postColorBoms || []).length}컬러</Badge>
              )}
            </button>
          </div>

          {/* ── 사전원가 컬러 서브탭 ── */}
          {mainTab === 'pre' && (
            <div className="flex items-center border-b border-stone-200 overflow-x-auto bg-emerald-50/40">
              {(editBom.colorBoms || []).map(cb => (
                <button
                  key={cb.color}
                  onClick={() => setActivePreColor(cb.color)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                    activePreColor === cb.color
                      ? 'border-emerald-500 text-emerald-700 bg-white'
                      : 'border-transparent text-stone-400 hover:text-stone-600'
                  }`}
                >
                  {cb.color}
                  <span
                    onClick={e => { e.stopPropagation(); removeColorBom(cb.color, 'pre'); }}
                    className="w-4 h-4 rounded-full bg-stone-200 hover:bg-red-200 text-stone-500 hover:text-red-600 flex items-center justify-center text-[10px] cursor-pointer"
                  >×</span>
                </button>
              ))}
              <button
                onClick={() => { setAddColorForTab('pre'); setShowAddColorModal(true); }}
                className="px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-stone-400 hover:text-emerald-600 transition-colors whitespace-nowrap"
              >+ 컬러 추가</button>
            </div>
          )}

          {/* ── 사후원가 컬러 서브탭 ── */}
          {mainTab === 'post' && (
            <div className="flex items-center border-b border-stone-200 overflow-x-auto bg-blue-50/40">
              {(editBom.postColorBoms || []).map(cb => (
                <button
                  key={cb.color}
                  onClick={() => setActivePostColor(cb.color)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                    activePostColor === cb.color
                      ? 'border-blue-500 text-blue-600 bg-white'
                      : 'border-transparent text-stone-400 hover:text-stone-600'
                  }`}
                >
                  {cb.color}
                  <span
                    onClick={e => { e.stopPropagation(); removeColorBom(cb.color, 'post'); }}
                    className="w-4 h-4 rounded-full bg-stone-200 hover:bg-red-200 text-stone-500 hover:text-red-600 flex items-center justify-center text-[10px] cursor-pointer"
                  >×</span>
                </button>
              ))}
              <button
                onClick={() => { setAddColorForTab('post'); setShowAddColorModal(true); }}
                className="px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-stone-400 hover:text-blue-600 transition-colors whitespace-nowrap"
              >+ 컬러 추가</button>
            </div>
          )}

          {/* 컬러 추가 모달 */}
          {showAddColorModal && (
            <Dialog open onOpenChange={() => { setShowAddColorModal(false); setNewColorName(''); }}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>{addColorForTab === 'post' ? '사후원가' : '사전원가'} 컬러 탭 추가</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  {/* 마이그레이션 안내 */}
                  {addColorForTab === 'pre' && (editBom.colorBoms || []).length === 0 && editBom.lines.some(l => l.itemName) && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800">
                      <span className="font-semibold">📋 기존 BOM 데이터 감지</span>
                      <p className="mt-1 text-amber-700">첫 번째 컬러 탭이 생성되면 기존 BOM 데이터가 자동으로 복사됩니다.</p>
                    </div>
                  )}
                  {addColorForTab === 'pre' && (editBom.colorBoms || []).length > 0 && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-xs text-emerald-800">
                      <span className="font-semibold">✨ 자동 복사</span>
                      <p className="mt-1 text-emerald-700">[{editBom.colorBoms?.[0]?.color}] 탭의 전체 BOM이 복사됩니다.</p>
                    </div>
                  )}
                  {addColorForTab === 'post' && (editBom.postColorBoms || []).length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-xs text-blue-800">
                      <span className="font-semibold">✨ 자동 복사</span>
                      <p className="mt-1 text-blue-700">[{editBom.postColorBoms?.[0]?.color}] 탭의 전체 BOM이 복사됩니다.</p>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">컬러명</label>
                    <Input
                      value={newColorName}
                      onChange={e => setNewColorName(e.target.value)}
                      placeholder="예: 블랙, 브라운, 레드..."
                      className="text-sm"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newColorName.trim()) {
                          addColorBom(newColorName.trim(), addColorForTab);
                          setShowAddColorModal(false);
                          setNewColorName('');
                        }
                      }}
                      autoFocus
                    />
                    {/* 품목 마스터 컬러 목록에서 빠른 선택 */}
                    {(() => {
                      const linkedItem = items.find(i => i.id === editBom.styleId);
                      const existingColors = (addColorForTab === 'post' ? (editBom.postColorBoms || []) : (editBom.colorBoms || [])).map(cb => cb.color);
                      const itemColors = (linkedItem?.colors || [])
                        .map(c => typeof c === 'string' ? c : c.name)
                        .filter(name => name && !existingColors.includes(name));
                      if (itemColors.length === 0) return null;
                      const btnClass = addColorForTab === 'post'
                        ? 'border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100'
                        : 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100';
                      return (
                        <div className="mt-2">
                          <p className="text-[10px] text-stone-400 mb-1">품목 마스터 컬러에서 선택:</p>
                          <div className="flex flex-wrap gap-1">
                            {itemColors.map(name => (
                              <button
                                key={name}
                                onClick={() => {
                                  addColorBom(name, addColorForTab);
                                  setShowAddColorModal(false);
                                  setNewColorName('');
                                }}
                                className={`px-2 py-0.5 text-xs rounded-full border ${btnClass}`}
                              >
                                {name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowAddColorModal(false); setNewColorName(''); }}>취소</Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (newColorName.trim()) {
                          addColorBom(newColorName.trim(), addColorForTab);
                          setShowAddColorModal(false);
                          setNewColorName('');
                        }
                      }}
                      disabled={!newColorName.trim()}
                      className={addColorForTab === 'post' ? 'bg-blue-700 hover:bg-blue-800 text-white' : 'bg-emerald-700 hover:bg-emerald-800 text-white'}
                    >
                      추가
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}

          {/* 사전원가 - 컬러 탭 없는 경우 안내 */}
          {mainTab === 'pre' && !activeColorBom && (editBom.colorBoms || []).length === 0 && (
            <div className="bg-stone-50 border border-dashed border-emerald-300 rounded-xl p-10 text-center">
              <div className="text-4xl mb-3">🎨</div>
              <p className="text-stone-700 text-sm font-semibold mb-1">사전원가 컬러 탭이 없습니다</p>
              <p className="text-stone-400 text-xs mb-4">BOM을 관리하려면 먼저 컬러를 추가하세요. 기존 엑셀 데이터가 있으면 첫 컬러 탭에 자동 복사됩니다.</p>
              <Button size="sm" onClick={() => { setAddColorForTab('pre'); setShowAddColorModal(true); }} className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5">
                <Plus className="w-4 h-4" /> 첫 번째 컬러 추가
              </Button>
              {(editBom.postColorBoms || []).length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyAllPostToPre}
                  className="border-purple-300 text-purple-700 hover:bg-purple-50 gap-1.5 mt-2"
                >
                  사후원가 전체 불러오기 → (컬러 {(editBom.postColorBoms || []).length}개)
                </Button>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
            사전원가 컬러별 BOM 탭
          ══════════════════════════════════════════════════════════════════ */}
          {mainTab === 'pre' && activeColorBom && (() => {
            const colorBom = activeColorBom;
            const preCur = editBom.preCurrency || 'CNY';
            const preCnyKrw = editBom.preExchangeRateCny ?? editBom.snapshotCnyKrw;
            const preUsdKrw = editBom.preExchangeRateUsd ?? settings.usdKrw;
            const preRate = preCur === 'USD' ? preUsdKrw : preCur === 'KRW' ? 1 : preCnyKrw;
            const curSymbol = preCur === 'CNY' ? '¥' : preCur === 'USD' ? '$' : '₩';
            const otherColors = (editBom.colorBoms || []).filter(cb => cb.color !== colorBom.color);
            return (
              <div className="space-y-4">
                {/* 컬러 BOM 컨트롤 바 */}
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
                    {/* 환율 CNY */}
                    {(editBom.preCurrency || 'CNY') !== 'KRW' && (
                      <div>
                        <label className="text-xs text-stone-500 mb-1 block font-medium">CNY→KRW 환율</label>
                        <Input type="number" value={editBom.preExchangeRateCny ?? editBom.snapshotCnyKrw} onChange={e => updateField('preExchangeRateCny', Number(e.target.value))} className="h-8 text-xs border-stone-200 text-right w-28" />
                      </div>
                    )}
                    {/* 환율 USD */}
                    {(editBom.preCurrency || 'CNY') !== 'KRW' && (
                      <div>
                        <label className="text-xs text-stone-500 mb-1 block font-medium">USD→KRW 환율</label>
                        <Input type="number" value={editBom.preExchangeRateUsd ?? settings.usdKrw} onChange={e => updateField('preExchangeRateUsd', Number(e.target.value))} className="h-8 text-xs border-stone-200 text-right w-28" />
                      </div>
                    )}
                    {/* 원가표 업로드 */}
                    <Button variant="outline" size="sm" onClick={() => preFileRef.current?.click()} className="gap-1.5 text-xs border-blue-300 text-blue-700 hover:bg-blue-50">
                      <Upload className="w-3.5 h-3.5" /> 원가표 불러오기
                    </Button>
                    {editBom.preSourceFileName && (
                      <span className="text-xs text-stone-400 flex items-center gap-1">
                        <FileText className="w-3 h-3 text-blue-400" /> {editBom.preSourceFileName}
                      </span>
                    )}
                    {/* 다른 컬러에서 복사 드롭다운 */}
                    {otherColors.length > 0 && (
                      <div className="ml-auto flex items-center gap-2">
                        <label className="text-xs text-stone-500 whitespace-nowrap">다른 컬러에서 복사:</label>
                        <select
                          value={copyFromColor}
                          onChange={e => setCopyFromColor(e.target.value)}
                          className="h-8 text-xs border border-stone-200 rounded px-2 text-stone-700"
                        >
                          <option value="">선택...</option>
                          {otherColors.map(cb => (
                            <option key={cb.color} value={cb.color}>{cb.color}</option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!copyFromColor}
                          onClick={() => copyFromColor && copyColorBom(colorBom.color, copyFromColor, 'pre')}
                          className="gap-1 text-xs border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                        >
                          <Copy className="w-3 h-3" /> 복사
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* BOM 테이블 (전체 섹션) */}
                <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between bg-emerald-50">
                    <div className="flex items-center gap-3">
                      <h2 className="text-sm font-semibold text-emerald-800">BOM 자재 명세 — [{colorBom.color}]</h2>
                      {/* 사후원가에서 불러오기 버튼 */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyPostToPre(colorBom.color)}
                        className="h-7 gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                      >
                        <Copy className="w-3 h-3" /> 사후원가 [{colorBom.color}] 불러오기 →
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={copyAllPostToPre}
                        className="h-7 gap-1 text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
                      >
                        <Copy className="w-3 h-3" /> 사후원가 전체 불러오기 →
                      </Button>
                    </div>
                    <span className="text-xs text-stone-400">
                      입력 통화: {preCur} {preCur !== 'KRW' && `| CNY→KRW ${preCnyKrw} | USD→KRW ${preUsdKrw}`}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-emerald-800 text-white text-[11px]">
                          <th className="px-2 py-2 text-left">부위 | 자재명</th>
                          <th className="px-2 py-2 text-left w-20">규격</th>
                          <th className="px-2 py-2 text-center w-20">단위</th>
                          <th className="px-2 py-2 text-right w-20">단가({curSymbol})</th>
                          <th className="px-2 py-2 text-right w-20">NET</th>
                          <th className="px-2 py-2 text-right w-16">LOSS(%)</th>
                          <th className="px-2 py-2 text-right w-24">소요량</th>
                          <th className="px-2 py-2 text-right w-24">제조금액({curSymbol})</th>
                          <th className="px-2 py-2 text-right w-24">KRW</th>
                          <th className="px-2 py-2 text-center w-28">공급</th>
                          <th className="px-2 py-2 text-left w-36">자재업체</th>
                          <th className="px-2 py-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {BOM_SECTIONS.map(cat => {
                          const isRawMaterial = cat === '원자재';
                          const catLines = colorBom.lines.filter(l => l.category === cat);
                          const filledLines = catLines.filter(l => l.itemName);
                          const catTotal = catLines.reduce((s, l) => s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate), 0);
                          const collapsed = collapsedSections.has(cat);
                          return (
                            <React.Fragment key={cat}>
                              <tr className={`border-y ${isRawMaterial ? 'bg-amber-50 border-amber-200' : 'bg-stone-100 border-stone-200'}`}>
                                <td colSpan={12} className="px-3 py-1.5">
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
                                      <button onClick={() => addColorBomLine(colorBom.color, cat)} className="flex items-center gap-1 text-[11px] text-[#C9A96E] hover:text-amber-700 font-medium">
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
                                  onChange={(id, field, val) => updateColorBomLine(colorBom.color, id, field, val)}
                                  onDelete={id => deleteColorBomLine(colorBom.color, id)}
                                  cnyKrw={preRate}
                                  sectionKey={cat}
                                  accentColor="amber"
                                />
                              ))}
                            </React.Fragment>
                          );
                        })}

                        {/* 후가공 섹션 */}
                        <tr className="bg-stone-100 border-y border-stone-200">
                          <td colSpan={12} className="px-3 py-1.5">
                            <div className="flex items-center justify-between">
                              <button onClick={() => toggleSection('후가공')} className="flex items-center gap-2 text-stone-700 font-semibold text-xs hover:text-stone-900">
                                {collapsedSections.has('후가공') ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                후가공비
                                {(colorBom.postProcessLines ?? []).filter(l => l.name).length > 0 && (
                                  <span className="text-[10px] font-normal text-stone-500">({(colorBom.postProcessLines ?? []).filter(l => l.name).length})</span>
                                )}
                              </button>
                              <button onClick={() => addColorPostLine(colorBom.color)} className="flex items-center gap-1 text-[11px] text-[#C9A96E] hover:text-amber-700 font-medium">
                                <Plus className="w-3 h-3" /> 행 추가
                              </button>
                            </div>
                          </td>
                        </tr>
                        {!collapsedSections.has('후가공') && (colorBom.postProcessLines ?? []).map(line => {
                          const lineAmt = line.netQty * line.unitPrice;
                          return (
                            <tr key={line.id} className="group hover:bg-amber-50/30 transition-colors border-b border-stone-100">
                              <td className="px-1 py-1" colSpan={3}>
                                <div className="flex items-center gap-1">
                                  <Select value={(line as PostProcessLine & { subPart?: string }).subPart || ''} onValueChange={v => updateColorPostLine(colorBom.color, line.id, 'subPart' as keyof PostProcessLine, v)}>
                                    <SelectTrigger className="h-7 text-xs border-stone-200 w-20 shrink-0"><SelectValue placeholder="-" /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none" className="text-xs text-stone-400">-</SelectItem>
                                      {SECTION_SUB_PARTS['후가공'].map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                  <Input value={line.name} onChange={e => updateColorPostLine(colorBom.color, line.id, 'name', e.target.value)} className="h-7 text-xs border-stone-200 bg-white min-w-[80px]" placeholder="후가공 품목명" />
                                </div>
                              </td>
                              <td className="px-1 py-1"><Input type="number" value={line.unitPrice || ''} onChange={e => updateColorPostLine(colorBom.color, line.id, 'unitPrice', Number(e.target.value))} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder={`단가(${curSymbol})`} /></td>
                              <td className="px-1 py-1"><Input type="number" value={line.netQty || ''} onChange={e => updateColorPostLine(colorBom.color, line.id, 'netQty', Number(e.target.value))} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder="수량" /></td>
                              <td className="px-2 py-1 text-center text-xs text-stone-300">-</td>
                              <td className="px-2 py-1 text-right text-xs text-stone-500 tabular-nums">{fmt(line.netQty)}</td>
                              <td className="px-2 py-1 text-right text-xs font-medium tabular-nums">{fmt(lineAmt)}</td>
                              <td className="px-2 py-1 text-right text-xs text-stone-500 tabular-nums">{fmtKrw(lineAmt * preRate)}</td>
                              <td></td><td></td>
                              <td className="px-1 py-1"><button onClick={() => deleteColorPostLine(colorBom.color, line.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-stone-300 hover:text-red-400 p-0.5"><Trash2 className="w-3.5 h-3.5" /></button></td>
                            </tr>
                          );
                        })}

                        {/* 임가공비 */}
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
                          <td className="px-1 py-1">
                            <Input type="number" value={colorBom.processingFee || ''} onChange={e => updateColorProcessingFee(colorBom.color, Number(e.target.value))} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder={curSymbol} />
                          </td>
                          <td className="px-1 py-1"><span className="text-xs text-stone-400 px-2">1</span></td>
                          <td></td>
                          <td className="px-2 py-1 text-right text-xs text-stone-400">1</td>
                          <td className="px-2 py-1 text-right text-xs font-semibold tabular-nums">{fmt(colorBom.processingFee ?? 0)} {curSymbol}</td>
                          <td className="px-2 py-1 text-right text-xs font-semibold text-[#C9A96E] tabular-nums">{fmtKrw((colorBom.processingFee ?? 0) * preRate)}</td>
                          <td colSpan={3}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 사전원가 요약 */}
                {summary && (
                  <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-stone-100 bg-stone-800 text-white">
                      <h2 className="text-sm font-semibold">사전 원가 요약 <span className="text-stone-400 text-xs font-normal ml-2">— [{colorBom.color}] 기준</span></h2>
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
                          ...((editBom.productionMarginRate ?? 0) > 0 ? [{ key: '마', label: '생산마진', desc: `${Math.round((editBom.productionMarginRate || 0) * 100)}%`, val: summary.productionMarginKrw, editable: false }] : []),
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
                          const marginClass = marginPct < 15 ? 'text-red-600' : marginPct < 20 ? 'text-amber-600' : marginPct <= 30 ? 'text-green-600' : 'text-orange-600';
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
                                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${marginPct > 30 ? 'bg-orange-100 text-orange-700' : marginPct >= 20 ? 'bg-green-100 text-green-700' : marginPct >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                        {marginPct > 30 ? '🟠 초과주의' : marginPct >= 20 ? '🟢 좋음' : marginPct >= 15 ? '🟡 적정' : '🔴 미달'}
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
                      <h2 className="text-sm font-semibold">P&L 분석 <span className="text-stone-400 text-xs font-normal ml-2">— [{colorBom.color}] 기준</span></h2>
                    </div>
                    <div className="p-5 space-y-5">
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
                                    : <span className="flex items-center gap-1 text-red-500"><AlertTriangle className="w-3.5 h-3.5" /> 원가 절감 필요: {fmtKrw(pnlResult.costReductionNeeded)}</span>
                                  }
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
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
              </div>
            );
          })()}

          {/* 사후원가 - 컬러 탭 없는 경우 안내 */}
          {mainTab === 'post' && !activePostColorBom && (editBom.postColorBoms || []).length === 0 && (
            <div className="bg-stone-50 border border-dashed border-blue-300 rounded-xl p-10 text-center">
              <div className="text-4xl mb-3">🏭</div>
              <p className="text-stone-700 text-sm font-semibold mb-1">사후원가 컬러 탭이 없습니다</p>
              <p className="text-stone-400 text-xs mb-4">공장 원가표를 관리하려면 컬러를 추가하세요.</p>
              <Button size="sm" onClick={() => { setAddColorForTab('post'); setShowAddColorModal(true); }} className="bg-blue-700 hover:bg-blue-800 text-white gap-1.5">
                <Plus className="w-4 h-4" /> 첫 번째 컬러 추가
              </Button>
              {(editBom.colorBoms || []).length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyAllPreToPost}
                  className="border-purple-300 text-purple-700 hover:bg-purple-50 gap-1.5 mt-2"
                >
                  <Copy className="w-4 h-4" /> ← 사전원가 전체 불러오기 (컬러 {(editBom.colorBoms || []).length}개)
                </Button>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
            사후원가 탭 (컬러별)
          ══════════════════════════════════════════════════════════════════ */}
          {mainTab === 'post' && activePostColorBom && (
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
                  {/* 업체용 견적서 발행 */}
                  <Button variant="outline" size="sm" onClick={() => setShowQuote(true)} className="gap-1.5 text-xs border-[#C9A96E] text-[#C9A96E] hover:bg-amber-50">
                    <FileText className="w-3.5 h-3.5" /> 업체용 견적서
                  </Button>
                </div>
              </div>

              {/* 사후원가 자재 테이블 */}
              {(() => {
                const postColorBom = activePostColorBom!;
                const postCur = editBom.currency || 'CNY';
                const postCnyKrw = editBom.exchangeRateCny || editBom.snapshotCnyKrw || 191;
                const postUsdKrw = editBom.exchangeRateUsd || settings.usdKrw;
                const postRate = postCur === 'USD' ? postUsdKrw : postCur === 'KRW' ? 1 : postCnyKrw;
                const curSymbol = postCur === 'CNY' ? '¥' : postCur === 'USD' ? '$' : '₩';
                const otherPostColors = (editBom.postColorBoms || []).filter(cb => cb.color !== postColorBom.color);
                return (
                  <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between bg-blue-50">
                      <div className="flex items-center gap-3">
                        <h2 className="text-sm font-semibold text-blue-800">사후원가 자재 명세 — [{postColorBom.color}]</h2>
                        {/* 사전원가에서 불러오기 버튼 */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyPreToPost(postColorBom.color)}
                          className="h-7 gap-1 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        >
                          <Copy className="w-3 h-3" /> ← 사전원가 [{postColorBom.color}] 불러오기
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={copyAllPreToPost}
                          className="h-7 gap-1 text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
                        >
                          <Copy className="w-3 h-3" /> ← 사전원가 전체 불러오기
                        </Button>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-stone-400">입력 통화: {postCur} {postCur !== 'KRW' && `| CNY→KRW ${postCnyKrw} | USD→KRW ${postUsdKrw}`}</span>
                        {/* 다른 컬러에서 복사 */}
                        {otherPostColors.length > 0 && (
                          <div className="flex items-center gap-2">
                            <select
                              value={copyFromColor}
                              onChange={e => setCopyFromColor(e.target.value)}
                              className="h-7 text-xs border border-stone-200 rounded px-2 text-stone-700"
                            >
                              <option value="">다른 컬러에서 복사...</option>
                              {otherPostColors.map(cb => <option key={cb.color} value={cb.color}>{cb.color}</option>)}
                            </select>
                            <Button size="sm" variant="outline" disabled={!copyFromColor}
                              onClick={() => copyFromColor && copyColorBom(postColorBom.color, copyFromColor, 'post')}
                              className="gap-1 text-xs h-7 border-blue-400 text-blue-700 hover:bg-blue-50">
                              <Copy className="w-3 h-3" /> 복사
                            </Button>
                          </div>
                        )}
                      </div>
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
                            <th className="px-2 py-2 text-center w-28">공급</th>
                            <th className="px-2 py-2 text-left w-36">자재업체</th>
                            <th className="px-2 py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {BOM_SECTIONS.map(cat => {
                            const catLines = postColorBom.lines.filter(l => l.category === cat);
                            const filledLines = catLines.filter(l => l.itemName);
                            const catTotal = catLines.reduce((s, l) => s + calcLineAmt(l.unitPriceCny, l.netQty, l.lossRate), 0);
                            const collapsed = collapsedPostSections.has(cat);
                            const colCount = 12;
                            const isRawMaterial = cat === '원자재';
                            return (
                              <React.Fragment key={cat}>
                                <tr className={`border-y ${isRawMaterial ? 'bg-amber-50 border-amber-200' : 'bg-stone-100 border-stone-200'}`}>
                                  <td colSpan={colCount} className="px-3 py-1.5">
                                    <div className="flex items-center justify-between">
                                      <button onClick={() => togglePostSection(cat)} className={`flex items-center gap-2 font-semibold text-xs hover:opacity-80 ${isRawMaterial ? 'text-amber-800' : 'text-stone-700'}`}>
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
                                            {postCur !== 'KRW' && <> = <span className="font-semibold text-[#C9A96E]">{fmtKrw(catTotal * postRate)}</span></>}
                                          </span>
                                        )}
                                        <button onClick={() => addPostColorBomLine(postColorBom.color, cat)} className="flex items-center gap-1 text-[11px] text-[#C9A96E] hover:text-amber-700 font-medium">
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
                                    onChange={(id, field, val) => updatePostColorBomLine(postColorBom.color, id, field, val)}
                                    onDelete={id => deletePostColorBomLine(postColorBom.color, id)}
                                    cnyKrw={postRate}
                                    sectionKey={cat}
                                    accentColor="amber"
                                  />
                                ))}
                              </React.Fragment>
                            );
                          })}
                          {/* 후가공 섹션 (postColorBom 기반) */}
                          <React.Fragment key="후가공-post">
                            <tr className="bg-stone-100 border-y border-stone-200">
                              <td colSpan={12} className="px-3 py-1.5">
                                <div className="flex items-center justify-between">
                                  <button onClick={() => togglePostSection('후가공')} className="flex items-center gap-2 font-semibold text-xs text-stone-700 hover:opacity-80">
                                    {collapsedPostSections.has('후가공') ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                    후가공
                                    {(postColorBom.postProcessLines ?? []).filter(l => l.name).length > 0 && (
                                      <span className="text-[10px] font-normal text-stone-500">({(postColorBom.postProcessLines ?? []).filter(l => l.name).length})</span>
                                    )}
                                  </button>
                                  <button onClick={() => addPostColorPostLine(postColorBom.color)} className="flex items-center gap-1 text-[11px] text-[#C9A96E] hover:text-amber-700 font-medium">
                                    <Plus className="w-3 h-3" /> 행 추가
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {!collapsedPostSections.has('후가공') && (postColorBom.postProcessLines ?? []).map(line => (
                              <tr key={line.id} className="border-b border-stone-100 hover:bg-stone-50">
                                <td className="px-2 py-1" colSpan={2}>
                                  <Input value={line.name} onChange={e => updatePostColorPostLine(postColorBom.color, line.id, 'name', e.target.value)} placeholder="후가공 작업명" className="h-7 text-xs border-stone-200 w-full" />
                                </td>
                                <td className="px-1 py-1"></td>
                                <td className="px-1 py-1">
                                  <Input type="number" value={line.netQty || ''} onChange={e => updatePostColorPostLine(postColorBom.color, line.id, 'netQty', Number(e.target.value))} placeholder="NET" className="h-7 text-xs border-stone-200 w-16 text-right" />
                                </td>
                                <td className="px-1 py-1">
                                  <Input type="number" value={line.unitPrice || ''} onChange={e => updatePostColorPostLine(postColorBom.color, line.id, 'unitPrice', Number(e.target.value))} placeholder="단가" className="h-7 text-xs border-stone-200 w-20 text-right" />
                                </td>
                                <td className="px-1 py-1"></td>
                                <td className="px-2 py-1 text-right text-xs tabular-nums">{fmt(line.netQty * line.unitPrice)}</td>
                                <td className="px-2 py-1 text-right text-xs text-stone-500 tabular-nums">{fmtKrw(line.netQty * line.unitPrice * postRate)}</td>
                                <td colSpan={3}></td>
                                <td className="px-1 py-1 text-center">
                                  <button onClick={() => deletePostColorPostLine(postColorBom.color, line.id)} className="text-stone-300 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                          {/* 임가공비 (postColorBom 기반) */}
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
                            <td className="px-1 py-1">
                              <Input type="number" value={postColorBom.processingFee || ''} onChange={e => updateColorProcessingFee(postColorBom.color, Number(e.target.value), 'post')} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder={curSymbol} />
                            </td>
                            <td className="px-1 py-1"><span className="text-xs text-stone-400 px-2">1</span></td>
                            <td></td>
                            <td className="px-2 py-1 text-right text-xs text-stone-400">1</td>
                            <td className="px-2 py-1 text-right text-xs font-semibold tabular-nums">{fmt(postColorBom.processingFee ?? 0)} {curSymbol}</td>
                            <td className="px-2 py-1 text-right text-xs font-semibold text-[#C9A96E] tabular-nums">{fmtKrw((postColorBom.processingFee ?? 0) * postRate)}</td>
                            <td colSpan={3}></td>
                          </tr>
                          {/* 관세율 */}
                          <tr className="bg-amber-50/20 border-b border-stone-100">
                            <td className="px-1 py-1" colSpan={3}>
                              <span className="text-xs text-stone-500 px-2">관세율 (%)</span>
                              <span className="text-[10px] text-stone-400 ml-1">임가공비 × 관세율</span>
                            </td>
                            <td className="px-1 py-1">
                              <Input type="number" value={editBom.customsRate || ''} onChange={e => updateField('customsRate', Number(e.target.value))} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder="%" />
                            </td>
                            <td colSpan={3}></td>
                            <td className="px-2 py-1 text-right text-xs font-semibold tabular-nums text-stone-500">{(editBom.customsRate || 0) > 0 ? `${editBom.customsRate}%` : '—'}</td>
                            <td className="px-2 py-1 text-right text-xs font-semibold text-[#C9A96E] tabular-nums">{(editBom.customsRate || 0) > 0 ? fmtKrw((postColorBom.processingFee ?? 0) * postRate * ((editBom.customsRate || 0) / 100)) : '—'}</td>
                            <td colSpan={3}></td>
                          </tr>
                          {/* 물류비 */}
                          <tr className="bg-amber-50/20 border-b border-stone-100">
                            <td className="px-1 py-1" colSpan={3}>
                              <span className="text-xs text-stone-500 px-2">물류비 (KRW)</span>
                              <span className="text-[10px] text-stone-400 ml-1">PCS 배분 물류비</span>
                            </td>
                            <td className="px-1 py-1">
                              <Input type="number" value={editBom.logisticsCostKrw || ''} onChange={e => updateField('logisticsCostKrw', Number(e.target.value))} className="h-7 text-xs border-stone-200 bg-white text-right w-20" placeholder="₩" />
                            </td>
                            <td colSpan={4}></td>
                            <td className="px-2 py-1 text-right text-xs font-semibold text-[#C9A96E] tabular-nums">{(editBom.logisticsCostKrw || 0) > 0 ? fmtKrw(editBom.logisticsCostKrw || 0) : '—'}</td>
                            <td colSpan={3}></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* 사후원가 요약 */}
              {(() => {
                const ps = calcPostSummary(editBom, settings.usdKrw, activePostColorBom);
                const postCur = editBom.currency || 'CNY';
                const linkedItem = items.find(i => i.id === editBom.styleId);
                // 생산마진 계산 (사전원가와 동일 구조)
                const postMarginRate = editBom.productionMarginRate ?? 0;
                const postProductionMarginKrw = ps.totalCostKrw * postMarginRate;
                const postTotalWithMarginKrw = ps.totalCostKrw + postProductionMarginKrw;
                const deliveryPrice = editBom.postDeliveryPrice || linkedItem?.deliveryPrice || linkedItem?.targetSalePrice || 0;
                const finalCost = postMarginRate > 0 ? postTotalWithMarginKrw : ps.totalCostKrw;
                const marginAmt = deliveryPrice > 0 ? deliveryPrice - finalCost : 0;
                const marginPct = deliveryPrice > 0 ? (marginAmt / deliveryPrice) * 100 : 0;
                const marginClass = marginPct < 15 ? 'text-red-600' : marginPct < 20 ? 'text-amber-600' : marginPct <= 30 ? 'text-green-600' : 'text-orange-600';
                const marginBg = marginPct < 15 ? 'bg-red-50 border-red-200' : marginPct < 30 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200';
                return (
                  <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-stone-100 bg-stone-800 text-white">
                      <h2 className="text-sm font-semibold">사후 원가 요약 <span className="text-stone-400 text-xs font-normal ml-2">— [{activePostColorBom?.color}] 기준</span></h2>
                    </div>
                    <table className="w-full text-xs">
                      <thead><tr className="bg-stone-100 text-stone-600"><th className="px-4 py-2 text-left w-12">구분</th><th className="px-4 py-2 text-left">항목</th><th className="px-4 py-2 text-left text-stone-400">내용/비고</th><th className="px-4 py-2 text-right w-40">금액 (원)</th></tr></thead>
                      <tbody>
                        <tr className="border-b border-stone-100 hover:bg-stone-50">
                          <td className="px-4 py-2 font-bold text-stone-400">자</td>
                          <td className="px-4 py-2 font-medium text-stone-700">공장구매 자재</td>
                          <td className="px-4 py-2 text-stone-400">본사제공 제외 ({postCur})</td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums"><span className={ps.factoryMaterialKrw === 0 ? 'text-stone-300' : 'text-stone-800'}>{fmtKrw(ps.factoryMaterialKrw)}</span></td>
                        </tr>
                        <tr className="border-b border-stone-100 hover:bg-stone-50">
                          <td className="px-4 py-2 font-bold text-stone-400">본</td>
                          <td className="px-4 py-2 font-medium text-stone-700">본사제공 자재</td>
                          <td className="px-4 py-2 text-stone-400">본사에서 공급</td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums"><span className={ps.hqMaterialKrw === 0 ? 'text-stone-300' : 'text-stone-800'}>{fmtKrw(ps.hqMaterialKrw)}</span></td>
                        </tr>
                        <tr className="border-b border-stone-100 hover:bg-stone-50">
                          <td className="px-4 py-2 font-bold text-stone-400">공</td>
                          <td className="px-4 py-2 font-medium text-stone-700">임가공비</td>
                          <td className="px-4 py-2 text-stone-400">NET ({postCur})</td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums"><span className={ps.processingKrw === 0 ? 'text-stone-300' : 'text-stone-800'}>{fmtKrw(ps.processingKrw)}</span></td>
                        </tr>
                        {ps.customsRate > 0 && (
                          <tr className="border-b border-stone-100 hover:bg-stone-50">
                            <td className="px-4 py-2 font-bold text-stone-400">관</td>
                            <td className="px-4 py-2 font-medium text-stone-700">관세 ({ps.customsRate}%)</td>
                            <td className="px-4 py-2 text-stone-400">임가공비 × 관세율</td>
                            <td className="px-4 py-2 text-right font-semibold tabular-nums"><span className={ps.customsKrw === 0 ? 'text-stone-300' : 'text-stone-800'}>{fmtKrw(ps.customsKrw)}</span></td>
                          </tr>
                        )}
                        <tr className="bg-amber-50 border-y border-amber-200">
                          <td className="px-4 py-3 font-bold text-amber-600">🏭</td>
                          <td className="px-4 py-3 font-bold text-stone-800">공장단가</td>
                          <td className="px-4 py-3 text-stone-500 text-[11px]">공장구매자재 + 임가공 + 후가공 + 관세 (본사제공 제외)</td>
                          <td className="px-4 py-3 text-right font-bold text-amber-700 tabular-nums">{fmtKrw(ps.factoryUnitCostKrw)}</td>
                        </tr>
                        {ps.logisticsKrw > 0 && (
                          <tr className="border-b border-stone-100 hover:bg-stone-50">
                            <td className="px-4 py-2 font-bold text-stone-400">물</td>
                            <td className="px-4 py-2 font-medium text-stone-700">물류비</td>
                            <td className="px-4 py-2 text-stone-400">PCS 배분 물류비</td>
                            <td className="px-4 py-2 text-right font-semibold tabular-nums"><span className="text-stone-800">{fmtKrw(ps.logisticsKrw)}</span></td>
                          </tr>
                        )}
                        {/* 소계 행 (생산마진율 > 0인 경우에만 구분선 표시) */}
                        {postMarginRate > 0 && (
                          <tr className="bg-stone-100 border-y border-stone-300">
                            <td className="px-4 py-2 font-bold text-stone-500">소</td>
                            <td className="px-4 py-2 font-semibold text-stone-700" colSpan={2}>소 계 (생산마진 전)</td>
                            <td className="px-4 py-2 text-right font-bold tabular-nums text-stone-700">{fmtKrw(ps.totalCostKrw)}</td>
                          </tr>
                        )}
                        {/* 생산마진 행 (율 > 0인 경우에만 표시) */}
                        {postMarginRate > 0 && (
                          <tr className="border-b border-stone-100 hover:bg-stone-50">
                            <td className="px-4 py-2 font-bold text-stone-400">마</td>
                            <td className="px-4 py-2 font-medium text-stone-700">생산마진</td>
                            <td className="px-4 py-2 text-stone-400">{Math.round(postMarginRate * 100)}%</td>
                            <td className="px-4 py-2 text-right font-semibold tabular-nums"><span className="text-stone-800">{fmtKrw(postProductionMarginKrw)}</span></td>
                          </tr>
                        )}
                        <tr className="bg-stone-800 text-white">
                          <td className="px-4 py-3 font-bold">📦</td>
                          <td className="px-4 py-3 font-bold text-base" colSpan={2}>{postMarginRate > 0 ? '총 원 가 액' : '제 품 원 가'}</td>
                          <td className="px-4 py-3 text-right font-bold text-lg tabular-nums text-[#C9A96E]">{fmtKrw(finalCost)}</td>
                        </tr>
                        {deliveryPrice > 0 && (
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
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${marginPct > 30 ? 'bg-orange-100 text-orange-700' : marginPct >= 20 ? 'bg-green-100 text-green-700' : marginPct >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                      {marginPct > 30 ? '🟠 초과주의' : marginPct >= 20 ? '🟢 좋음' : marginPct >= 15 ? '🟡 적정' : '🔴 미달'}
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>
                    {/* 납품가 입력 */}
                    <div className="px-4 py-3 border-t border-stone-200 flex items-center gap-3">
                      <label className="text-xs font-semibold text-stone-700 whitespace-nowrap">납품가 (KRW)</label>
                      <Input
                        type="number"
                        value={deliveryPrice || ''}
                        onChange={e => {
                          const val = Number(e.target.value);
                          updateField('postDeliveryPrice', val);
                          if (editBom.styleId) store.updateItem(editBom.styleId, { deliveryPrice: val });
                        }}
                        className="h-8 text-sm border-stone-300 text-right w-36 font-semibold"
                        placeholder="납품가 입력"
                      />
                      {linkedItem?.deliveryPrice && linkedItem.deliveryPrice !== editBom.postDeliveryPrice && (
                        <span className="text-[10px] text-stone-400">품목마스터: {fmtKrw(linkedItem.deliveryPrice)}</span>
                      )}
                    </div>
                  </div>
                );
              })()}
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
          {showQuote && editBom && (
            <VendorQuoteModal
              bom={editBom}
              onClose={() => setShowQuote(false)}
              tab={mainTab}
              colorBom={mainTab === 'post' ? activePostColorBom : activeColorBom}
            />
          )}
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