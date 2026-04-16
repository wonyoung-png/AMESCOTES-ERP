/**
 * CostSheetPrint — 원가계산서 전용 인쇄 페이지
 * Puppeteer가 URL로 방문해서 PDF 생성하는 전용 페이지
 * /cost-sheet-print?bomId=xxx&color=xxx
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
  const totalCostKrw = factoryUnitCostKrw + hqMaterialCny * rate + customsKrw + logisticsKrw + packagingKrw + packingKrw;

  return {
    factoryMaterialKrw: factoryMaterialCny * rate,
    hqMaterialKrw: hqMaterialCny * rate,
    totalMaterialKrw: (factoryMaterialCny + hqMaterialCny) * rate,
    processingKrw,
    postProcessKrw: postProcessCny * rate,
    customsRate,
    customsKrw,
    logisticsKrw,
    packagingKrw,
    packingKrw,
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

  // 모달과 동일한 계산
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

  return (
    <div style={{ background: 'white', minHeight: '100vh', fontFamily: "'Noto Sans KR', sans-serif" }}>
      {/* 환율 배너 등 floating UI 숨기기 */}
      <style>{`
        [data-sonner-toaster], div[class*="fixed"], div[class*="toast"], div[class*="Toast"] {
          display: none !important;
        }
      `}</style>
      <div id="cost-sheet-print-content" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

        {/* 헤더: 제목 + 날짜 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #292524', paddingBottom: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#292524', letterSpacing: '0.05em' }}>원 가 계 산 서</h2>
          <span style={{ fontSize: '10px', color: '#a8a29e' }}>작성일: {today}</span>
        </div>

        {/* 섹션 1: 제품 기본정보 (compact 가로형) */}
        <div style={{ border: '1px solid #e7e5e4', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ background: '#292524', color: 'white', padding: '6px 12px' }}>
            <h3 style={{ fontSize: '11px', fontWeight: 700, margin: 0 }}>제품 기본정보</h3>
          </div>
          <div style={{ padding: '10px 12px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* 제품 이미지 */}
            <div style={{ flexShrink: 0, width: '70px', height: '70px', border: '1px solid #e7e5e4', borderRadius: '6px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9' }}>
              <img
                id="cost-sheet-product-img"
                alt="제품사진"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'none' }}
                onLoad={e => { (e.target as HTMLImageElement).style.display = 'block'; const ph = document.getElementById('cost-sheet-img-placeholder'); if (ph) ph.style.display = 'none'; }}
              />
              <div id="cost-sheet-img-placeholder" style={{ textAlign: 'center', color: '#a8a29e', fontSize: '10px' }}>No<br/>Image</div>
            </div>
            {/* 기본정보 그리드 */}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 16px' }}>
              {[
                { label: '스타일번호', val: bom.styleNo },
                { label: '품명', val: bom.styleName },
                { label: '시즌', val: bom.season },
                { label: '카테고리', val: bom.erpCategory || '—' },
                { label: '컬러', val: activePostColorBom?.color || colorParam || '—' },
                { label: '라인명', val: bom.lineName || '—' },
                { label: '디자이너', val: bom.designer || '—' },
                { label: '제조국', val: bom.manufacturingCountry || '—' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: '#a8a29e', fontSize: '8px', fontWeight: 500 }}>{item.label}</span>
                  <span style={{ color: '#292524', fontWeight: 600, fontSize: '10px' }}>{item.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 섹션 2+3: 2단 레이아웃 (원가 요약 | P&L 분석) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'start' }}>

          {/* 왼쪽: 사후원가 요약 테이블 */}
          <div style={{ border: '1px solid #e7e5e4', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ background: '#292524', color: 'white', padding: '6px 12px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 700, margin: 0 }}>사후원가 요약</h3>
            </div>
            <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f5f5f4', color: '#78716c' }}>
                  <th style={{ padding: '4px 10px', textAlign: 'left', fontWeight: 600, fontSize: '10px' }}>항목</th>
                  <th style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 600, fontSize: '10px' }}>금액 (KRW)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: '공장구매 자재', val: psSheet.factoryMaterialKrw },
                  { label: '본사제공 자재', val: psSheet.hqMaterialKrw },
                  { label: '임가공비', val: psSheet.processingKrw },
                ].map(row => (
                  <tr key={row.label} style={{ borderBottom: '1px solid #f5f5f4' }}>
                    <td style={{ padding: '4px 10px', color: '#78716c', fontSize: '10px' }}>{row.label}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: '10px' }}>{fmtKrw(row.val)}</td>
                  </tr>
                ))}
                <tr style={{ borderBottom: '1px solid #fde68a', background: '#fffbeb' }}>
                  <td style={{ padding: '5px 10px', fontWeight: 700, color: '#292524', fontSize: '10px' }}>공장단가</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 700, color: '#b45309', fontFamily: 'monospace', fontSize: '10px' }}>{fmtKrw(psSheet.factoryUnitCostKrw)}</td>
                </tr>
                {[
                  { label: `관세 (${psSheet.customsRate}%)`, val: psSheet.customsKrw },
                  { label: '물류비', val: psSheet.logisticsKrw },
                  { label: '포장/검사비', val: psSheet.packagingKrw },
                  { label: '패킹재', val: psSheet.packingKrw },
                ].map(row => (
                  <tr key={row.label} style={{ borderBottom: '1px solid #f5f5f4' }}>
                    <td style={{ padding: '4px 10px', color: '#78716c', fontSize: '10px' }}>{row.label}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: '10px' }}>{fmtKrw(row.val)}</td>
                  </tr>
                ))}
                <tr style={{ borderBottom: '1px solid #fde68a', background: '#fffbeb' }}>
                  <td style={{ padding: '5px 10px', fontWeight: 600, color: '#92400e', fontSize: '10px' }}>
                    제품 총원가 <span style={{ fontSize: '9px', fontWeight: 400, color: '#d97706' }}>(마진 전)</span>
                  </td>
                  <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600, color: '#b45309', fontFamily: 'monospace', fontSize: '10px' }}>{fmtKrw(psSheet.totalCostKrw)}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f5f5f4' }}>
                  <td style={{ padding: '4px 10px', color: '#78716c', fontSize: '10px' }}>생산마진 ({Math.round(postMarginRateSheet * 100)}%)</td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: '10px' }}>{fmtKrw(postProductionMarginKrwSheet)}</td>
                </tr>
                <tr style={{ background: '#292524' }}>
                  <td style={{ padding: '7px 10px', fontWeight: 700, color: 'white', fontSize: '12px' }}>
                    {postMarginRateSheet > 0 ? '총 원 가 액' : '제 품 원 가'}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, fontSize: '13px', color: '#C9A96E', fontFamily: 'monospace' }}>
                    {fmtKrw(finalCostSheet)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 오른쪽: P&L 분석 */}
          {bom.pnl && postPnlResultSheet ? (
            <div style={{ border: '1px solid #e7e5e4', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: '#292524', color: 'white', padding: '6px 12px' }}>
                <h3 style={{ fontSize: '11px', fontWeight: 700, margin: 0 }}>P&L 분석</h3>
              </div>
              <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

                {/* 가정 */}
                <div style={{ background: '#fafaf9', borderRadius: '6px', padding: '8px', border: '1px solid #e7e5e4' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', fontSize: '10px' }}>
                    <div>
                      <span style={{ color: '#a8a29e', fontSize: '9px', display: 'block' }}>할인율</span>
                      <span style={{ fontWeight: 600, color: '#292524' }}>{Math.round(bom.pnl.discountRate * 100)}%</span>
                    </div>
                    <div>
                      <span style={{ color: '#a8a29e', fontSize: '9px', display: 'block' }}>플랫폼 수수료</span>
                      <span style={{ fontWeight: 600, color: '#292524' }}>{Math.round(bom.pnl.platformFeeRate * 100)}%</span>
                    </div>
                    <div>
                      <span style={{ color: '#a8a29e', fontSize: '9px', display: 'block' }}>인건비/판관비</span>
                      <span style={{ fontWeight: 600, color: '#292524' }}>{Math.round(bom.pnl.sgaRate * 100)}%</span>
                    </div>
                  </div>
                </div>

                {/* 배수 분석 */}
                <div style={{ background: '#fafaf9', borderRadius: '6px', padding: '8px', border: '1px solid #e7e5e4' }}>
                  <h4 style={{ fontSize: '10px', fontWeight: 600, color: '#78716c', marginBottom: '6px', marginTop: 0 }}>배수 분석</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    {[
                      { label: '3.5× 최소 판매가', val: postPnlResultSheet.price35 },
                      { label: '4.0× 목표 판매가', val: postPnlResultSheet.price40 },
                      { label: '4.5× 이상적 판매가', val: postPnlResultSheet.price45 },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #e7e5e4' }}>
                        <span style={{ color: '#78716c', fontSize: '10px' }}>{item.label}</span>
                        <span style={{ fontWeight: 700, color: '#292524', fontFamily: 'monospace', fontSize: '10px' }}>{fmtKrw(item.val)}</span>
                      </div>
                    ))}
                    {bom.pnl.confirmedSalePrice && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '2px solid #d6d3d1' }}>
                        <span style={{ fontWeight: 600, color: '#44403c', fontSize: '10px' }}>확정 판매가</span>
                        <span style={{ fontWeight: 700, color: '#292524', fontFamily: 'monospace', fontSize: '10px' }}>{fmtKrw(bom.pnl.confirmedSalePrice)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 영업이익 분석 */}
                {bom.pnl.confirmedSalePrice && (
                  <div style={{ background: '#fafaf9', borderRadius: '6px', padding: '8px', border: '1px solid #e7e5e4' }}>
                    <h4 style={{ fontSize: '10px', fontWeight: 600, color: '#78716c', marginBottom: '6px', marginTop: 0 }}>영업이익 분석 (P&L)</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      {[
                        { no: '①', label: '정가 (확정판매가)', val: bom.pnl.confirmedSalePrice, color: '#292524', bold: false },
                        { no: '②', label: `(-) 할인 ${Math.round(bom.pnl.discountRate * 100)}%`, val: -(bom.pnl.confirmedSalePrice * bom.pnl.discountRate), color: '#ef4444', bold: false },
                        { no: '③', label: '실판가 (Net Sale)', val: postPnlResultSheet.netSale, color: '#44403c', bold: true },
                        { no: '④', label: `(-) 플랫폼 수수료 ${Math.round(bom.pnl.platformFeeRate * 100)}%`, val: -(postPnlResultSheet.netSale * bom.pnl.platformFeeRate), color: '#ef4444', bold: false },
                        { no: '⑤', label: `(-) 판관비 ${Math.round(bom.pnl.sgaRate * 100)}%`, val: -(postPnlResultSheet.netSale * bom.pnl.sgaRate), color: '#ef4444', bold: false },
                        { no: '⑥', label: '(-) COGS (총원가액)', val: -finalCostSheet, color: '#ef4444', bold: false },
                        { no: '⑦', label: '영업이익', val: postPnlResultSheet.operatingProfit, color: postPnlResultSheet.operatingProfit >= 0 ? '#16a34a' : '#dc2626', bold: true },
                      ].map(row => (
                        <div key={row.no} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '4px 8px', borderRadius: '3px',
                          background: row.bold ? 'white' : 'transparent',
                          border: row.bold ? '1px solid #e7e5e4' : 'none',
                          marginBottom: row.bold ? '1px' : 0,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '9px', color: '#a8a29e', width: '14px' }}>{row.no}</span>
                            <span style={{ fontSize: '10px', color: row.bold ? '#292524' : '#78716c', fontWeight: row.bold ? 600 : 400 }}>{row.label}</span>
                          </div>
                          <span style={{ fontSize: '11px', fontFamily: 'monospace', fontWeight: 600, color: row.color }}>{fmtKrw(row.val)}</span>
                        </div>
                      ))}
                      {/* 영업이익률 */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderRadius: '3px', background: 'white', border: '1px solid #e7e5e4' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '9px', color: '#a8a29e', width: '14px' }}>★</span>
                          <span style={{ fontSize: '10px', color: '#292524', fontWeight: 600 }}>영업이익률</span>
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: postPnlResultSheet.operatingMargin >= 0 ? '#16a34a' : '#dc2626' }}>
                          {(postPnlResultSheet.operatingMargin * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    {/* 실현 배수 */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 10px', borderRadius: '6px', marginTop: '6px',
                      background: postPnlResultSheet.meets35x ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${postPnlResultSheet.meets35x ? '#bbf7d0' : '#fecaca'}`,
                    }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#44403c' }}>⚡ 실현 배수</span>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: postPnlResultSheet.meets35x ? '#16a34a' : '#ef4444' }}>
                          {postPnlResultSheet.actualMultiple.toFixed(2)}×
                        </span>
                        <div style={{ fontSize: '9px', color: postPnlResultSheet.meets35x ? '#16a34a' : '#ef4444' }}>
                          {postPnlResultSheet.meets35x ? '✅ 목표달성 (3.5×↑)' : `⚠️ 절감 필요: ${fmtKrw(postPnlResultSheet.costReductionNeeded)}`}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 확정판매가 미입력 안내 */}
                {!bom.pnl.confirmedSalePrice && (
                  <div style={{ padding: '10px', textAlign: 'center', color: '#a8a29e', fontSize: '10px', background: '#fafaf9', borderRadius: '6px', border: '1px dashed #e7e5e4' }}>
                    확정 판매가를 입력하면<br/>영업이익 P&L 분석이 표시됩니다
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ border: '1px dashed #e7e5e4', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', color: '#a8a29e', fontSize: '11px' }}>
              P&L 데이터 없음
            </div>
          )}
        </div>
      </div>

      {/* Puppeteer가 기다리는 준비 완료 신호 */}
      {ready && <div id="cost-sheet-ready" style={{ display: 'none' }} />}
    </div>
  );
}
