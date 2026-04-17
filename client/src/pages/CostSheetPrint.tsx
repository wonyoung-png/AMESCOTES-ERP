/**
 * CostSheetPrint — 원가계산서 전용 인쇄 페이지
 * Puppeteer가 URL로 방문해서 PDF 생성하는 전용 페이지
 * /cost-sheet-print?bomId=xxx&color=xxx
 *
 * ⚠️ 이 파일의 렌더 구조는 BomManagement.tsx 의 "원가계산서 모달" (id="cost-sheet-print-content") 과
 *    동일하게 유지해야 합니다. 모달 수정 시 이 파일도 함께 수정하세요.
 */

import { useEffect, useState } from 'react';
import { useSearch } from 'wouter';
import { fetchBoms } from '@/lib/supabaseQueries';

// ─── 타입 ──────────────────────────────────────────────────────────────────
interface BomPnlAssumptions {
  discountRate: number;
  platformFeeRate: number;
  sgaRate: number;
  confirmedSalePrice?: number;
}

interface ExtBomLine {
  id: string;
  category: string;
  subPart?: string;
  itemName: string;
  spec?: string;
  unit: string;
  customUnit?: string;
  unitPriceCny: number;
  netQty: number;
  lossRate: number;
  isHqProvided: boolean;
  isVendorProvided?: boolean;
  vendorName?: string;
  memo?: string;
}

interface PostProcessLine {
  id: string;
  name: string;
  netQty: number;
  unitPrice: number;
  memo?: string;
}

interface ExtColorBom {
  color: string;
  lines: ExtBomLine[];
  postProcessLines: PostProcessLine[];
  processingFee: number;
}

interface ExtBom {
  id: string;
  styleId?: string;
  styleNo: string;
  styleName: string;
  lineName?: string;
  designer?: string;
  erpCategory?: string;
  size?: string;
  season: string;
  lines: ExtBomLine[];
  postProcessLines: PostProcessLine[];
  processingFee: number;
  logisticsCostKrw: number;
  packagingCostKrw: number;
  packingCostKrw: number;
  customsRate?: number;
  productionMarginRate: number;
  snapshotCnyKrw: number;
  pnl: BomPnlAssumptions;
  currency?: 'CNY' | 'USD' | 'KRW';
  manufacturingCountry?: string;
  exchangeRateCny?: number;
  exchangeRateUsd?: number;
  postColorBoms?: ExtColorBom[];
  postMaterials?: ExtBomLine[];
  postProcessingFee?: number;
  createdAt: string;
  updatedAt: string;
}

// ─── 헬퍼 함수 ──────────────────────────────────────────────────────────────
const calcLineAmt = (price: number, net: number, loss: number) => price * net * (1 + loss);
const fmtKrw = (n: number) => '₩' + Math.round(n).toLocaleString('ko-KR');

interface PostSummary {
  factoryMaterialKrw: number;
  hqMaterialKrw: number;
  totalMaterialKrw: number;
  processingKrw: number;
  postProcessKrw: number;
  customsRate: number;
  customsKrw: number;
  logisticsKrw: number;
  packagingKrw: number;
  packingKrw: number;
  factoryUnitCostKrw: number;
  totalCostKrw: number;
  factoryMaterialCny: number;
  hqMaterialCny: number;
  totalMaterialCny: number;
  processingCny: number;
  postProcessCny: number;
  factoryUnitCostCny: number;
  totalCostCny: number;
  rate: number;
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
  const postProcessCny = postProcLines.reduce((s, l) => s + l.netQty * l.unitPrice, 0);
  const customsRate = bom.customsRate || 0;
  const processingKrw = processingCny * rate;
  const customsKrw = processingKrw * (customsRate / 100);
  const logisticsKrw = bom.logisticsCostKrw || 0;
  const packagingKrw = bom.packagingCostKrw || 0;
  const packingKrw = bom.packingCostKrw || 0;
  const factoryUnitCostKrw = factoryMaterialCny * rate + processingKrw + postProcessCny * rate;
  const factoryUnitCostCny = factoryUnitCostKrw / (rate || 1);
  const totalCostKrw = factoryUnitCostKrw + hqMaterialCny * rate + customsKrw + logisticsKrw + packagingKrw + packingKrw;
  const totalCostCny = totalCostKrw / (rate || 1);

  return {
    factoryMaterialKrw: factoryMaterialCny * rate,
    hqMaterialKrw: hqMaterialCny * rate,
    totalMaterialKrw: totalMaterialCny * rate,
    processingKrw,
    postProcessKrw: postProcessCny * rate,
    customsRate,
    customsKrw,
    logisticsKrw,
    packagingKrw,
    packingKrw,
    factoryUnitCostKrw,
    totalCostKrw,
    factoryMaterialCny,
    hqMaterialCny,
    totalMaterialCny,
    processingCny,
    postProcessCny,
    factoryUnitCostCny,
    totalCostCny,
    rate,
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
  return { price35, price40, price45, netSale, operatingProfit, operatingMargin, actualMultiple, costReductionNeeded, meets35x: actualMultiple >= 3.5 };
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────
export default function CostSheetPrint() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const bomId = params.get('bomId') || '';
  const colorParam = params.get('color') || '';

  const [bom, setBom] = useState<ExtBom | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!bomId) {
      setError('bomId 파라미터가 없습니다.');
      return;
    }
    fetchBoms()
      .then((boms: any[]) => {
        const found = boms.find((b: any) => b.id === bomId);
        if (!found) {
          setError(`BOM ID(${bomId})를 찾을 수 없습니다.`);
        } else {
          setBom(found as ExtBom);
        }
        setTimeout(() => setReady(true), 800);
      })
      .catch((err: any) => {
        setError('데이터 로드 오류: ' + String(err));
        setReady(true);
      });
  }, [bomId]);

  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', color: 'red' }}>
        {error}
        {ready && <div id="cost-sheet-ready" style={{ display: 'none' }} />}
      </div>
    );
  }

  if (!bom) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#888' }}>
        원가계산서 로딩 중...
      </div>
    );
  }

  // ── 계산 (BomManagement 모달과 동일) ──────────────────────────────────────
  const activePostColorBom = colorParam
    ? bom.postColorBoms?.find(c => c.color === colorParam)
    : bom.postColorBoms?.[0];

  const usdKrw = bom.exchangeRateUsd || 1380;
  const psSheet = calcPostSummary(bom, usdKrw, activePostColorBom);
  const postMarginRateSheet = bom.productionMarginRate ?? 0;
  const postProductionMarginKrwSheet = psSheet.totalCostKrw * postMarginRateSheet;
  const postTotalWithMarginKrwSheet = psSheet.totalCostKrw + postProductionMarginKrwSheet;
  const finalCostSheet = postMarginRateSheet > 0 ? postTotalWithMarginKrwSheet : psSheet.totalCostKrw;
  const postPnlResultSheet = bom.pnl ? calcPnl(finalCostSheet, bom.pnl) : null;
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });

  // ── 렌더 (BomManagement id="cost-sheet-print-content" 와 동일 구조) ────────
  return (
    <div className="bg-white min-h-screen font-sans">
      <style>{`
        [data-sonner-toaster], div[class*="fixed"], div[class*="toast"], div[class*="Toast"] { display: none !important; }
        body { margin: 0; padding: 0; background: white; }
      `}</style>

      {/* 모달의 id="cost-sheet-print-content" 와 동일한 구조 */}
      <div id="cost-sheet-print-content" className="p-6 space-y-6">

        {/* ── 섹션 1: 제품 기본정보 ── */}
        <div className="border border-stone-200 rounded-xl overflow-hidden">
          <div className="bg-stone-800 text-white px-5 py-3 flex items-center justify-between">
            <h3 className="text-sm font-bold">제품 기본정보</h3>
            <span className="text-xs text-stone-400">작성일: {today}</span>
          </div>
          <div className="p-5">
            <div className="flex gap-5">
              {/* 제품 사진 (Puppeteer가 base64 주입) */}
              <div className="flex-shrink-0">
                <div className="w-32 h-32 border-2 border-dashed border-stone-300 rounded-xl flex flex-col items-center justify-center overflow-hidden">
                  <img
                    id="cost-sheet-product-img"
                    alt="제품사진"
                    className="w-full h-full object-cover"
                    style={{ display: 'none' }}
                    onLoad={e => {
                      (e.target as HTMLImageElement).style.display = 'block';
                      const ph = document.getElementById('cost-sheet-img-placeholder');
                      if (ph) ph.style.display = 'none';
                    }}
                  />
                  <div id="cost-sheet-img-placeholder" className="text-center text-stone-400 text-xs px-2">
                    No Image
                  </div>
                </div>
              </div>
              {/* 정보 그리드 */}
              <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {[
                  { label: '스타일번호', val: bom.styleNo },
                  { label: '품명', val: bom.styleName },
                  { label: '시즌', val: bom.season },
                  { label: '카테고리', val: bom.erpCategory || '—' },
                  { label: '컬러', val: activePostColorBom?.color || colorParam || '—' },
                  { label: '라인명', val: bom.lineName || '—' },
                  { label: '담당 디자이너', val: bom.designer || '—' },
                  { label: '제조국', val: bom.manufacturingCountry || '—' },
                ].map(item => (
                  <div key={item.label} className="flex flex-col">
                    <span className="text-stone-400 text-[10px] font-medium">{item.label}</span>
                    <span className="text-stone-800 font-semibold">{item.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── 섹션 2: 사후원가 요약 테이블 ── */}
        <div className="border border-stone-200 rounded-xl overflow-hidden">
          <div className="bg-stone-800 text-white px-5 py-3">
            <h3 className="text-sm font-bold">사후원가 요약</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-stone-100 text-stone-600">
                <th className="px-4 py-2 text-left">항목</th>
                <th className="px-4 py-2 text-right">금액 (KRW)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-stone-100">
                <td className="px-4 py-2 text-stone-600">공장구매 자재</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtKrw(psSheet.factoryMaterialKrw)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="px-4 py-2 text-stone-600">본사제공 자재</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtKrw(psSheet.hqMaterialKrw)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="px-4 py-2 text-stone-600">임가공비</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtKrw(psSheet.processingKrw)}</td>
              </tr>
              {psSheet.postProcessKrw > 0 && (
                <tr className="border-b border-stone-100">
                  <td className="px-4 py-2 text-stone-600">후가공비</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtKrw(psSheet.postProcessKrw)}</td>
                </tr>
              )}
              <tr className="border-b border-amber-200 bg-amber-50">
                <td className="px-4 py-2.5 font-bold text-stone-800">🏭 공장단가</td>
                <td className="px-4 py-2.5 text-right font-bold text-amber-700 tabular-nums">{fmtKrw(psSheet.factoryUnitCostKrw)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="px-4 py-2 text-stone-600">관세 ({psSheet.customsRate}%)</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtKrw(psSheet.customsKrw)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="px-4 py-2 text-stone-600">물류비</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtKrw(psSheet.logisticsKrw)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="px-4 py-2 text-stone-600">포장/검사비</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtKrw(psSheet.packagingKrw)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="px-4 py-2 text-stone-600">패킹재</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtKrw(psSheet.packingKrw)}</td>
              </tr>
              <tr className="border-b border-amber-200 bg-amber-50">
                <td className="px-4 py-2.5 font-semibold text-amber-800">
                  제품 총원가 <span className="text-[10px] font-normal text-amber-500">(생산마진 전)</span>
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-amber-700 tabular-nums">{fmtKrw(psSheet.totalCostKrw)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="px-4 py-2 text-stone-600">생산마진 ({Math.round(postMarginRateSheet * 100)}%)</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtKrw(postProductionMarginKrwSheet)}</td>
              </tr>
              <tr className="bg-stone-800">
                <td className="px-4 py-3 font-bold text-white text-sm">
                  {postMarginRateSheet > 0 ? '총 원 가 액' : '제 품 원 가'}
                </td>
                <td className="px-4 py-3 text-right font-bold text-lg text-[#C9A96E] tabular-nums">
                  {fmtKrw(finalCostSheet)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── 섹션 3: P&L 분석 ── */}
        {bom.pnl && postPnlResultSheet && (
          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <div className="bg-stone-800 text-white px-5 py-3">
              <h3 className="text-sm font-bold">P&L 분석</h3>
            </div>
            <div className="p-5 space-y-4">

              {/* 가정 */}
              <div className="bg-stone-50 rounded-lg p-4 border border-stone-200">
                <h4 className="text-xs font-semibold text-stone-600 mb-3">가정 (Assumptions)</h4>
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-stone-400 text-[10px] block">할인율</span>
                    <span className="font-semibold text-stone-800">{Math.round(bom.pnl.discountRate * 100)}%</span>
                  </div>
                  <div>
                    <span className="text-stone-400 text-[10px] block">플랫폼 수수료</span>
                    <span className="font-semibold text-stone-800">{Math.round(bom.pnl.platformFeeRate * 100)}%</span>
                  </div>
                  <div>
                    <span className="text-stone-400 text-[10px] block">인건비/판관비</span>
                    <span className="font-semibold text-stone-800">{Math.round(bom.pnl.sgaRate * 100)}%</span>
                  </div>
                </div>
              </div>

              {/* 배수 분석 */}
              <div className="bg-stone-50 rounded-lg p-4 border border-stone-200">
                <h4 className="text-xs font-semibold text-stone-600 mb-3">배수 분석</h4>
                <div className="space-y-2 text-xs">
                  {[
                    { label: '3.5배 기준 최소 판매가', val: postPnlResultSheet.price35 },
                    { label: '4.0배 기준 목표 판매가', val: postPnlResultSheet.price40 },
                    { label: '4.5배 기준 이상적 판매가', val: postPnlResultSheet.price45 },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between py-1.5 border-b border-stone-200 last:border-0">
                      <span className="text-stone-600">{item.label}</span>
                      <span className="font-bold text-stone-800 tabular-nums">{fmtKrw(item.val)}</span>
                    </div>
                  ))}
                  {bom.pnl.confirmedSalePrice && (
                    <div className="flex justify-between py-1.5 border-t-2 border-stone-300">
                      <span className="font-semibold text-stone-700">확정 판매가</span>
                      <span className="font-bold text-stone-800 tabular-nums">{fmtKrw(bom.pnl.confirmedSalePrice)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 영업이익 분석 */}
              {bom.pnl.confirmedSalePrice ? (
                <div className="bg-stone-50 rounded-lg p-4 border border-stone-200">
                  <h4 className="text-xs font-semibold text-stone-600 mb-3">영업이익 분석 (P&L)</h4>
                  <div className="space-y-1">
                    {[
                      { no: '①', label: '정가 (확정판매가)', desc: '', val: bom.pnl.confirmedSalePrice, color: 'text-stone-800', bold: false },
                      { no: '②', label: '(-) 할인', desc: `${Math.round(bom.pnl.discountRate * 100)}%`, val: -(bom.pnl.confirmedSalePrice * bom.pnl.discountRate), color: 'text-red-500', bold: false },
                      { no: '③', label: '실판가 (Net Sale)', desc: '', val: postPnlResultSheet.netSale, color: 'text-stone-700', bold: true },
                      { no: '④', label: '(-) 플랫폼 수수료', desc: `${Math.round(bom.pnl.platformFeeRate * 100)}%`, val: -(postPnlResultSheet.netSale * bom.pnl.platformFeeRate), color: 'text-red-500', bold: false },
                      { no: '⑤', label: '(-) 인건비 / 판관비', desc: `${Math.round(bom.pnl.sgaRate * 100)}%`, val: -(postPnlResultSheet.netSale * bom.pnl.sgaRate), color: 'text-red-500', bold: false },
                      { no: '⑥', label: '(-) 매출원가 (COGS)', desc: '총 원가액', val: -finalCostSheet, color: 'text-red-500', bold: false },
                      { no: '⑦', label: '영업이익', desc: '', val: postPnlResultSheet.operatingProfit, color: postPnlResultSheet.operatingProfit >= 0 ? 'text-green-600' : 'text-red-600', bold: true },
                      { no: '★', label: '영업이익률', desc: '', val: null as number | null, color: postPnlResultSheet.operatingMargin >= 0 ? 'text-green-600' : 'text-red-600', bold: true, rate: postPnlResultSheet.operatingMargin },
                    ].map(row => (
                      <div key={row.no} className={`flex items-center justify-between py-1.5 px-3 rounded ${row.bold ? 'bg-white border border-stone-200' : ''}`}>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-stone-400 w-5">{row.no}</span>
                          <span className={`text-xs ${row.bold ? 'font-semibold text-stone-800' : 'text-stone-600'}`}>
                            {row.label} <span className="text-stone-400 font-normal">{row.desc}</span>
                          </span>
                        </div>
                        <span className={`text-sm tabular-nums font-semibold ${row.color}`}>
                          {'rate' in row && row.rate !== undefined
                            ? `${(row.rate * 100).toFixed(1)}%`
                            : row.val !== null ? fmtKrw(row.val) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {/* 실현배수 */}
                  <div className={`flex items-center justify-between py-2 px-3 rounded mt-2 ${postPnlResultSheet.meets35x ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-stone-400 w-5">⚡</span>
                      <span className="text-xs font-semibold text-stone-700">실현 배수</span>
                    </div>
                    <div className="text-right">
                      <span className={`text-sm font-bold ${postPnlResultSheet.meets35x ? 'text-green-600' : 'text-red-500'}`}>
                        {postPnlResultSheet.actualMultiple.toFixed(2)}x
                      </span>
                      {postPnlResultSheet.meets35x
                        ? <div className="text-[10px] text-green-600">✅ 목표 달성 (3.5x 이상)</div>
                        : <div className="text-[10px] text-red-500">⚠️ 원가 절감 필요: {fmtKrw(postPnlResultSheet.costReductionNeeded)}</div>
                      }
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-stone-400 text-xs py-4 bg-stone-50 rounded-lg border border-stone-200 border-dashed">
                  확정 판매가를 입력하면 영업이익 P&L 분석이 표시됩니다
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Puppeteer 준비 완료 신호 */}
      {ready && <div id="cost-sheet-ready" style={{ display: 'none' }} />}
    </div>
  );
}
