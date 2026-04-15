// AMESCOTES ERP — MD 대시보드
// 매출구성비 · GMROI · 공헌도 분석
import { useState, useEffect, useCallback } from 'react';
import { PlusCircle, Trash2, RefreshCw, Info } from 'lucide-react';
import { fetchItems } from '@/lib/supabaseQueries';

// ─── 타입 ───────────────────────────────────────────
interface MDRow {
  id: string;
  styleNo: string;
  styleName: string;
  salesPriceKrw: number;   // 판매가
  costKrw: number;          // 원가 (패키지 포함)
  salesQty: number;         // 판매 수량
  adCostTotal: number;      // 총 광고비 (해당 기간)
  commissionRate: number;   // 판매 수수료율 %
  settlementRate: number;   // 결제 수수료율 %
  shippingCostPerUnit: number; // 건당 배송비
  avgInventoryQty: number;  // 평균 재고 수량
}

interface Computed {
  revenue: number;           // 매출액
  variableCost: number;      // 변동비 합계
  profit: number;            // 이익액 (공헌이익)
  profitRate: number;        // 이익률 %
  inventoryValue: number;    // 재고금액
  turnover: number;          // 재고회전율
  gmroi: number;             // GMROI
  salesShare: number;        // 매출구성비 %
  contribution: number;      // 공헌도
}

function compute(row: MDRow, totalRevenue: number): Computed {
  const revenue = row.salesPriceKrw * row.salesQty;
  const adCostTotal = row.adCostTotal;
  const commissionTotal = revenue * (row.commissionRate / 100);
  const settlementTotal = revenue * (row.settlementRate / 100);
  const shippingTotal = row.shippingCostPerUnit * row.salesQty;
  const costTotal = row.costKrw * row.salesQty;
  const variableCost = costTotal + adCostTotal + commissionTotal + settlementTotal + shippingTotal;
  const profit = revenue - variableCost;
  const profitRate = revenue > 0 ? (profit / revenue) * 100 : 0;
  const inventoryValue = row.avgInventoryQty * row.costKrw;
  const turnover = inventoryValue > 0 ? revenue / inventoryValue : 0;
  const gmroi = (profitRate / 100) * turnover;
  const salesShare = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;
  const contribution = salesShare * gmroi;
  return { revenue, variableCost, profit, profitRate, inventoryValue, turnover, gmroi, salesShare, contribution };
}

function newRow(): MDRow {
  return {
    id: crypto.randomUUID(),
    styleNo: '',
    styleName: '',
    salesPriceKrw: 0,
    costKrw: 0,
    salesQty: 0,
    adCostTotal: 0,
    commissionRate: 0,
    settlementRate: 0,
    shippingCostPerUnit: 0,
    avgInventoryQty: 0,
  };
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const fmtPct = (n: number) => n.toFixed(2) + '%';
const fmtNum = (n: number) => n.toFixed(3);

const STORAGE_KEY = 'ames_md_dashboard';

// ─── 컴포넌트 ────────────────────────────────────────
export default function MDDashboard() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [totalRevenue, setTotalRevenue] = useState<number>(0);
  const [rows, setRows] = useState<MDRow[]>([newRow()]);
  const [erpItems, setErpItems] = useState<{ styleNo: string; name: string; deliveryPrice: number; baseCostKrw: number }[]>([]);
  const [tooltip, setTooltip] = useState<string | null>(null);

  // ERP 품목 로드
  useEffect(() => {
    fetchItems().then(items => {
      setErpItems(items.map(i => ({
        styleNo: i.styleNo,
        name: i.name,
        deliveryPrice: i.deliveryPrice ?? 0,
        baseCostKrw: i.baseCostKrw ?? 0,
      })));
    }).catch(() => {});
  }, []);

  // localStorage 저장/불러오기
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const { month: m, totalRevenue: t, rows: r } = JSON.parse(saved);
        if (m) setMonth(m);
        if (t) setTotalRevenue(t);
        if (r) setRows(r);
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ month, totalRevenue, rows }));
  }, [month, totalRevenue, rows]);

  const updateRow = useCallback((id: string, patch: Partial<MDRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);

  const addRow = () => setRows(prev => [...prev, newRow()]);
  const deleteRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));

  // ERP 품목 자동 채우기
  const fillFromErp = (id: string, styleNo: string) => {
    const item = erpItems.find(i => i.styleNo === styleNo);
    if (item) {
      updateRow(id, {
        styleNo: item.styleNo,
        styleName: item.name,
        salesPriceKrw: item.deliveryPrice,
        costKrw: item.baseCostKrw,
      });
    } else {
      updateRow(id, { styleNo });
    }
  };

  // 계산 결과
  const computedRows = rows.map(r => ({ ...r, ...compute(r, totalRevenue) }));
  const totalRevenueSumCalc = computedRows.reduce((s, r) => s + r.revenue, 0);

  // 상위 3 공헌도
  const top3 = [...computedRows].sort((a, b) => b.contribution - a.contribution).slice(0, 3);

  return (
    <div className="p-6 space-y-6 max-w-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">MD 대시보드</h1>
          <p className="text-sm text-stone-500 mt-0.5">매출구성비 · GMROI · 공헌도 분석</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
            style={{ '--tw-ring-color': '#C9A96E' } as React.CSSProperties}
          />
          <button
            onClick={() => { setRows([newRow()]); setTotalRevenue(0); }}
            className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 border rounded-lg px-3 py-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            초기화
          </button>
        </div>
      </div>

      {/* 총 매출액 입력 */}
      <div className="bg-white border rounded-2xl p-4 flex items-center gap-4">
        <div className="flex-shrink-0">
          <p className="text-xs text-stone-500 mb-1">월 전체 총 매출액 <span className="text-red-400">*</span></p>
          <p className="text-xs text-stone-400">(매출구성비 계산 기준)</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={totalRevenue || ''}
            onChange={e => setTotalRevenue(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-1"
            style={{ '--tw-ring-color': '#C9A96E' } as React.CSSProperties}
            placeholder="예: 100000000"
          />
          <span className="text-sm text-stone-500">원</span>
          {totalRevenue > 0 && (
            <span className="text-sm font-medium text-stone-700">{fmt(totalRevenue)}원</span>
          )}
        </div>
        {totalRevenueSumCalc > 0 && Math.abs(totalRevenueSumCalc - totalRevenue) > 1000 && (
          <p className="text-xs text-amber-500 ml-2">
            ※ 상품 매출 합계 {fmt(totalRevenueSumCalc)}원과 차이가 있습니다
          </p>
        )}
      </div>

      {/* 요약 카드 — 상위 3 공헌도 */}
      {computedRows.some(r => r.revenue > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {top3.map((r, i) => (
            <div key={r.id} className="bg-white border rounded-2xl p-4" style={{ borderColor: i === 0 ? '#C9A96E' : undefined }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: i === 0 ? '#C9A96E' : '#94a3b8' }}>
                  공헌도 {i + 1}위
                </span>
                <span className="text-xs text-stone-400">{r.styleNo}</span>
              </div>
              <p className="text-sm font-semibold text-stone-700 truncate">{r.styleName || r.styleNo || '(미입력)'}</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-xs text-stone-400">매출구성비</p>
                  <p className="text-base font-bold" style={{ color: '#C9A96E' }}>{fmtPct(r.salesShare)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-stone-400">GMROI</p>
                  <p className="text-base font-bold text-stone-700">{fmtNum(r.gmroi)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-stone-400">공헌도</p>
                  <p className="text-base font-bold text-stone-800">{fmtNum(r.contribution)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 입력 테이블 */}
      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-700">상품별 입력</h2>
          <p className="text-xs text-stone-400">스타일번호 입력 시 ERP 품목에서 자동 불러오기</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-stone-50 border-b">
                <th className="text-left px-3 py-2.5 text-stone-500 font-medium w-28">스타일번호</th>
                <th className="text-left px-3 py-2.5 text-stone-500 font-medium w-32">상품명</th>
                <th className="text-right px-3 py-2.5 text-stone-500 font-medium">판매가</th>
                <th className="text-right px-3 py-2.5 text-stone-500 font-medium">원가</th>
                <th className="text-right px-3 py-2.5 text-stone-500 font-medium">판매수량</th>
                <th className="text-right px-3 py-2.5 text-stone-500 font-medium">총 광고비</th>
                <th className="text-right px-3 py-2.5 text-stone-500 font-medium">판매수수료%</th>
                <th className="text-right px-3 py-2.5 text-stone-500 font-medium">결제수수료%</th>
                <th className="text-right px-3 py-2.5 text-stone-500 font-medium">건당배송비</th>
                <th className="text-right px-3 py-2.5 text-stone-500 font-medium">평균재고수량</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b hover:bg-stone-50/50">
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={row.styleNo}
                      onChange={e => fillFromErp(row.id, e.target.value)}
                      className="w-full border rounded px-2 py-1 focus:outline-none focus:ring-1"
                      style={{ '--tw-ring-color': '#C9A96E' } as React.CSSProperties}
                      placeholder="A25-001"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={row.styleName}
                      onChange={e => updateRow(row.id, { styleName: e.target.value })}
                      className="w-full border rounded px-2 py-1 focus:outline-none focus:ring-1"
                      style={{ '--tw-ring-color': '#C9A96E' } as React.CSSProperties}
                      placeholder="파니에 쁘띠"
                    />
                  </td>
                  {(['salesPriceKrw', 'costKrw', 'salesQty', 'adCostTotal', 'commissionRate', 'settlementRate', 'shippingCostPerUnit', 'avgInventoryQty'] as const).map(field => (
                    <td key={field} className="px-2 py-1.5">
                      <input
                        type="number"
                        value={row[field] || ''}
                        onChange={e => updateRow(row.id, { [field]: Number(e.target.value) })}
                        className="w-full border rounded px-2 py-1 text-right focus:outline-none focus:ring-1"
                        style={{ '--tw-ring-color': '#C9A96E' } as React.CSSProperties}
                        min="0"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <button onClick={() => deleteRow(row.id)} className="text-stone-300 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t">
          <button
            onClick={addRow}
            className="flex items-center gap-1.5 text-xs font-medium hover:opacity-80 transition-opacity"
            style={{ color: '#C9A96E' }}
          >
            <PlusCircle className="w-4 h-4" />
            상품 추가
          </button>
        </div>
      </div>

      {/* 결과 테이블 */}
      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <h2 className="text-sm font-semibold text-stone-700">분석 결과</h2>
          <button
            onMouseEnter={() => setTooltip('info')}
            onMouseLeave={() => setTooltip(null)}
            className="text-stone-300 hover:text-stone-500 relative"
          >
            <Info className="w-4 h-4" />
            {tooltip === 'info' && (
              <div className="absolute left-6 top-0 z-10 bg-stone-800 text-white text-xs rounded-lg p-3 w-64 shadow-lg">
                <p className="font-semibold mb-1.5">지표 계산 공식</p>
                <p>• 매출구성비 = 상품매출 / 총매출 × 100</p>
                <p>• 이익률 = (매출 - 변동비) / 매출 × 100</p>
                <p>• 재고회전율 = 매출액 / 재고금액</p>
                <p>• GMROI = 이익률 × 재고회전율</p>
                <p>• 공헌도 = 매출구성비 × GMROI</p>
              </div>
            )}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-stone-50 border-b">
                <th className="text-left px-4 py-2.5 text-stone-500 font-medium">상품</th>
                <th className="text-right px-4 py-2.5 text-stone-500 font-medium">매출액</th>
                <th className="text-right px-4 py-2.5 text-stone-500 font-medium">이익액</th>
                <th className="text-right px-4 py-2.5 text-stone-500 font-medium">이익률</th>
                <th className="text-right px-4 py-2.5 text-stone-500 font-medium">재고금액</th>
                <th className="text-right px-4 py-2.5 text-stone-500 font-medium">재고회전율</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#C9A96E' }}>매출구성비</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#C9A96E' }}>GMROI</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#C9A96E' }}>공헌도</th>
              </tr>
            </thead>
            <tbody>
              {computedRows
                .filter(r => r.revenue > 0)
                .sort((a, b) => b.contribution - a.contribution)
                .map((r) => (
                  <tr key={r.id} className="border-b hover:bg-stone-50/50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-stone-700">{r.styleName || r.styleNo || '—'}</p>
                      {r.styleName && r.styleNo && <p className="text-stone-400">{r.styleNo}</p>}
                    </td>
                    <td className="text-right px-4 py-2.5 text-stone-600">{fmt(r.revenue)}</td>
                    <td className={`text-right px-4 py-2.5 font-medium ${r.profit < 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(r.profit)}</td>
                    <td className={`text-right px-4 py-2.5 ${r.profitRate < 0 ? 'text-red-500' : 'text-stone-600'}`}>{fmtPct(r.profitRate)}</td>
                    <td className="text-right px-4 py-2.5 text-stone-500">{fmt(r.inventoryValue)}</td>
                    <td className="text-right px-4 py-2.5 text-stone-500">{fmtNum(r.turnover)}</td>
                    <td className="text-right px-4 py-2.5 font-semibold" style={{ color: '#C9A96E' }}>{fmtPct(r.salesShare)}</td>
                    <td className="text-right px-4 py-2.5 font-semibold text-stone-700">{fmtNum(r.gmroi)}</td>
                    <td className="text-right px-4 py-2.5 font-bold text-stone-800">{fmtNum(r.contribution)}</td>
                  </tr>
                ))}
              {computedRows.every(r => r.revenue === 0) && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-stone-400">
                    위 입력 테이블에 판매수량과 판매가를 입력하면 자동 계산됩니다
                  </td>
                </tr>
              )}
            </tbody>
            {computedRows.some(r => r.revenue > 0) && (
              <tfoot>
                <tr className="bg-stone-50 border-t-2 font-semibold">
                  <td className="px-4 py-2.5 text-stone-700">합계</td>
                  <td className="text-right px-4 py-2.5 text-stone-700">{fmt(computedRows.reduce((s, r) => s + r.revenue, 0))}</td>
                  <td className="text-right px-4 py-2.5">{fmt(computedRows.reduce((s, r) => s + r.profit, 0))}</td>
                  <td colSpan={3}></td>
                  <td className="text-right px-4 py-2.5" style={{ color: '#C9A96E' }}>
                    {fmtPct(computedRows.reduce((s, r) => s + r.salesShare, 0))}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
