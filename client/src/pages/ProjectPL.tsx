// 발주 손익 — 발주번호(orderNo) 기준 BOM vs 실제 · 품목/컬러 배분
import { useMemo, useState } from 'react';
import { phase1 } from '@/lib/phase1';
import { store, formatKRW } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { migrateLocalToSupabase } from '@/lib/phase1';
import { toast } from 'sonner';
import { Database } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Input } from '@/components/ui/input';

export default function ProjectPL() {
  const { workspace } = useWorkspace();
  const [, tick] = useState(0);
  const refresh = () => tick(n => n + 1);
  const orders = store.getOrders();
  const [selectedNo, setSelectedNo] = useState(orders[0]?.orderNo || '');

  const allOrderNos = useMemo(() => {
    return [...new Set(orders.map(o => o.orderNo).filter(Boolean))]
      .sort()
      .reverse();
  }, [orders, tick]);

  const pl = selectedNo ? phase1.getProjectPL(selectedNo) : null;
  const sales = store.getSalesRecords().filter(s => !s.workspace || s.workspace === workspace);
  const salesSummary = sales.reduce((a, sale) => {
    const order = orders.find(o => o.id === sale.orderId || o.orderNo === sale.orderNo);
    const cogs = (order?.factoryUnitPriceKrw || 0) * sale.qty;
    const shipping = sale.shippingCostKrw || 0;
    const platform = sale.platformFeeKrw || 0;
    const pg = sale.pgFeeKrw || 0;
    a.revenue += sale.totalKrw;
    a.cogs += cogs;
    a.shipping += shipping;
    a.platform += platform;
    a.pg += pg;
    a.profit += sale.totalKrw - cogs - shipping - platform - pg;
    return a;
  }, { revenue: 0, cogs: 0, shipping: 0, platform: 0, pg: 0, profit: 0 });
  const updateSaleCost = (id: string, field: 'shippingCostKrw' | 'platformFeeKrw' | 'pgFeeKrw', value: number) => {
    store.updateSalesRecord(id, { [field]: Math.max(0, value) });
    refresh();
  };
  const projOrders = orders.filter(o => o.orderNo === selectedNo);

  const syncToSupabase = async () => {
    try {
      await migrateLocalToSupabase();
      toast.success('정산 데이터 Supabase 동기화 완료');
      refresh();
    } catch {
      toast.error('동기화 실패 — migration SQL 실행 확인');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">발주 손익</h1>
          <p className="text-sm text-stone-500">
            발주번호 — 자재·임가공(지출결의) · 품목/컬러 배분 원가
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={syncToSupabase}>
          <Database className="w-4 h-4 mr-1" />정산 → Supabase
        </Button>
      </div>

      <section className="space-y-3">
        <div><h2 className="text-lg font-bold text-stone-800">매출 · 영업이익</h2><p className="text-xs text-stone-500">{workspace} · 상품코드로 OEM/LUMEN 생산원가 연동</p></div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"><Kpi label="매출" value={formatKRW(salesSummary.revenue)} /><Kpi label="매출원가" value={formatKRW(salesSummary.cogs)} /><Kpi label="배송비" value={formatKRW(salesSummary.shipping)} /><Kpi label="플랫폼 수수료" value={formatKRW(salesSummary.platform)} /><Kpi label="PG 수수료" value={formatKRW(salesSummary.pg)} /><Kpi label="영업이익" value={formatKRW(salesSummary.profit)} sub={salesSummary.profit >= 0 ? '흑자' : '적자'} /></div>
        <div className="bg-white rounded-xl border overflow-x-auto"><table className="w-full text-sm min-w-[900px]"><thead className="bg-stone-50 text-xs text-stone-500"><tr><th className="text-left px-3 py-2">상품/판매처</th><th className="text-right px-3 py-2">수량</th><th className="text-right px-3 py-2">매출</th><th className="text-right px-3 py-2">배송비</th><th className="text-right px-3 py-2">플랫폼</th><th className="text-right px-3 py-2">PG</th><th className="text-right px-3 py-2">영업이익</th></tr></thead><tbody>
          {sales.map(sale => { const order = orders.find(o => o.id === sale.orderId || o.orderNo === sale.orderNo); const cogs = (order?.factoryUnitPriceKrw || 0) * sale.qty; const profit = sale.totalKrw - cogs - (sale.shippingCostKrw || 0) - (sale.platformFeeKrw || 0) - (sale.pgFeeKrw || 0); return <tr key={sale.id} className="border-t"><td className="px-3 py-2"><span className="font-medium">{sale.styleName || sale.styleNo || '상품 미지정'}</span><span className="block text-xs text-stone-400">{sale.buyerName} · {sale.deliveryMarket === 'overseas' ? '해외' : sale.deliveryMarket === 'domestic' ? '국내' : 'B2B'}</span></td><td className="px-3 py-2 text-right">{sale.qty.toLocaleString()}</td><td className="px-3 py-2 text-right">{formatKRW(sale.totalKrw)}</td>{(['shippingCostKrw','platformFeeKrw','pgFeeKrw'] as const).map(field => <td key={field} className="px-2 py-1"><Input type="number" min="0" className="h-8 text-right" value={sale[field] || ''} onChange={e => updateSaleCost(sale.id, field, Number(e.target.value))} /></td>)}<td className={`px-3 py-2 text-right font-bold ${profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatKRW(profit)}</td></tr>; })}
          {sales.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-400">입고완료 또는 매출 데이터가 없습니다.</td></tr>}
        </tbody></table></div>
      </section>
      <div className="flex flex-wrap gap-2">
        {allOrderNos.length === 0 ? (
          <p className="text-sm text-stone-400">등록된 발주가 없습니다</p>
        ) : allOrderNos.map(no => (
          <Button key={no} size="sm" variant={selectedNo === no ? 'default' : 'outline'}
            onClick={() => setSelectedNo(no)} className="font-mono text-xs">
            {no}
          </Button>
        ))}
      </div>

      {pl && selectedNo && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="BOM 예상원가" value={formatKRW(pl.bomCost)} />
            <Kpi
              label="실제 생산비"
              value={formatKRW(pl.actualCost)}
              sub={pl.payableFactory > 0 ? '지출결의 기준' : '단가×입고 추정'}
            />
            <Kpi label="OEM 매출(청구)" value={formatKRW(pl.revenue)} />
            <Kpi label="자재매입" value={formatKRW(pl.purchaseCost)} />
            <Kpi label="자재 결의액" value={formatKRW(pl.payablePurchase)} />
            <Kpi
              label="손익"
              value={formatKRW(pl.profit)}
              sub={pl.profit >= 0 ? '흑자' : '적자'}
            />
          </div>

          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b font-semibold text-sm">연결 발주 ({projOrders.length}건)</div>
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500">
                <tr>
                  <th className="text-left px-4 py-2">발주번호</th>
                  <th className="text-left px-4 py-2">품목</th>
                  <th className="text-right px-4 py-2">수량</th>
                  <th className="text-right px-4 py-2">단가</th>
                  <th className="text-right px-4 py-2">입고</th>
                </tr>
              </thead>
              <tbody>
                {projOrders.map(o => (
                  <tr key={o.id} className="border-t">
                    <td className="px-4 py-3 font-mono text-xs">{o.orderNo}</td>
                    <td className="px-4 py-3">{o.styleName || o.styleNo}</td>
                    <td className="px-4 py-3 text-right">{o.qty}</td>
                    <td className="px-4 py-3 text-right">{formatKRW(o.factoryUnitPriceKrw || 0)}</td>
                    <td className="px-4 py-3 text-right">{o.receivedQty ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b font-semibold text-sm">
              품목 · 컬러별 실제원가
              <span className="ml-2 font-normal text-stone-400 text-xs">
                자재/임가공을 colorQtys 비중으로 배분 (컬러 지정 입고결의는 해당 컬러에 직접 반영)
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-stone-50 text-xs text-stone-500">
                  <tr>
                    <th className="text-left px-4 py-2">발주</th>
                    <th className="text-left px-4 py-2">스타일</th>
                    <th className="text-left px-4 py-2">컬러</th>
                    <th className="text-right px-4 py-2">수량</th>
                    <th className="text-right px-4 py-2">자재</th>
                    <th className="text-right px-4 py-2">임가공</th>
                    <th className="text-right px-4 py-2">합계</th>
                    <th className="text-right px-4 py-2">PCS당</th>
                  </tr>
                </thead>
                <tbody>
                  {(pl.byStyleColor || []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-stone-400 text-sm">
                        배분할 발주/원가 데이터가 없습니다
                      </td>
                    </tr>
                  ) : (pl.byStyleColor || []).map((row, i) => (
                    <tr key={`${row.orderNo}-${row.color}-${i}`} className="border-t">
                      <td className="px-4 py-2.5 font-mono text-xs">{row.orderNo}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-stone-500">{row.styleNo}</span>
                        {row.styleName ? <span className="block text-xs">{row.styleName}</span> : null}
                      </td>
                      <td className="px-4 py-2.5">{row.color}</td>
                      <td className="px-4 py-2.5 text-right">{row.qty.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right">{formatKRW(row.materialCost)}</td>
                      <td className="px-4 py-2.5 text-right">{formatKRW(row.factoryCost)}</td>
                      <td className="px-4 py-2.5 text-right font-medium">{formatKRW(row.totalCost)}</td>
                      <td className="px-4 py-2.5 text-right text-stone-500">
                        {row.qty > 0 ? formatKRW(Math.round(row.totalCost / row.qty)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {(pl.byStyleColor || []).length > 0 && (
                  <tfoot className="bg-stone-50 border-t font-medium text-sm">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-right text-stone-500">합계</td>
                      <td className="px-4 py-2.5 text-right">
                        {formatKRW((pl.byStyleColor || []).reduce((s, r) => s + r.materialCost, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {formatKRW((pl.byStyleColor || []).reduce((s, r) => s + r.factoryCost, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {formatKRW((pl.byStyleColor || []).reduce((s, r) => s + r.totalCost, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="bg-stone-50 rounded-xl border p-4 text-sm">
            <p className="font-semibold text-stone-700">손익 요약</p>
            <p className="mt-2 text-stone-600">
              매출 {formatKRW(pl.revenue)} − 생산비 {formatKRW(pl.actualCost)} − 자재 {formatKRW(pl.purchaseCost)}
              = <span className="font-bold text-stone-800">{formatKRW(pl.profit)}</span>
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="text-lg font-bold text-stone-800 mt-1">{value}</p>
      {sub && <p className="text-[10px] text-stone-400 mt-0.5">{sub}</p>}
    </div>
  );
}
