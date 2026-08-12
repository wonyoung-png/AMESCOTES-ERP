// 발주 손익 — 발주번호(orderNo) 기준 BOM vs 실제 · 품목/컬러 배분
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { phase1 } from '@/lib/phase1';
import { store, formatKRW } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { migrateLocalToSupabase } from '@/lib/phase1';
import { toast } from 'sonner';
import { Database } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Input } from '@/components/ui/input';
import { fetchSalesRecords, upsertSalesRecord } from '@/lib/salesRecords';

export default function ProjectPL() {
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
  const sales = remoteSales.filter(s => !s.workspace || s.workspace === workspace);
  const salesSummary = sales.reduce((a, sale) => {
    const order = orders.find(o => o.id === sale.orderId || o.orderNo === sale.orderNo || o.styleNo === sale.styleNo);
    const cogs = (order?.factoryUnitPriceKrw || 0) * sale.qty;
    a.revenue += sale.totalKrw; a.cogs += cogs; a.shipping += sale.shippingCostKrw || 0;
    a.platform += sale.platformFeeKrw || 0; a.pg += sale.pgFeeKrw || 0;
    a.profit += sale.totalKrw - cogs - (sale.shippingCostKrw || 0) - (sale.platformFeeKrw || 0) - (sale.pgFeeKrw || 0);
    return a;
  }, { revenue: 0, cogs: 0, shipping: 0, platform: 0, pg: 0, profit: 0 });
  const updateSaleCost = async (id: string, field: 'shippingCostKrw' | 'platformFeeKrw' | 'pgFeeKrw', value: number) => {
    const sale = sales.find(s => s.id === id); if (!sale) return;
    await upsertSalesRecord({ ...sale, [field]: Math.max(0, value) });
    await queryClient.invalidateQueries({ queryKey: ['salesRecords'] });
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
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">매출 · 영업이익</h1>
          <p className="text-sm text-muted-foreground">
            발주번호 — 자재·임가공(미지급) · 품목/컬러 배분 원가
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={syncToSupabase}>
          <Database className="w-4 h-4 mr-1" />정산 → AWS
        </Button>
      </div>

      <section className="space-y-3">
        <div><h2 className="text-lg font-bold text-foreground">매출 · 영업이익</h2><p className="text-xs text-muted-foreground">{workspace} · OEM/LUMEN 상품코드 연동</p></div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"><Kpi label="매출" value={formatKRW(salesSummary.revenue)} /><Kpi label="매출원가" value={formatKRW(salesSummary.cogs)} /><Kpi label="배송비" value={formatKRW(salesSummary.shipping)} /><Kpi label="플랫폼 수수료" value={formatKRW(salesSummary.platform)} /><Kpi label="PG 수수료" value={formatKRW(salesSummary.pg)} /><Kpi label="영업이익" value={formatKRW(salesSummary.profit)} sub={salesSummary.profit >= 0 ? '흑자' : '적자'} /></div>
        <div className="bg-card rounded-lg border overflow-x-auto"><table className="data-table w-full text-sm min-w-[900px]"><thead><tr><th>상품/판매처</th><th className="num">수량</th><th className="num">매출</th><th className="num">배송비</th><th className="num">플랫폼</th><th className="num">PG</th><th className="num">영업이익</th></tr></thead><tbody>
          {sales.map(sale => { const order = orders.find(o => o.id === sale.orderId || o.orderNo === sale.orderNo || o.styleNo === sale.styleNo); const cogs = (order?.factoryUnitPriceKrw || 0) * sale.qty; const profit = sale.totalKrw - cogs - (sale.shippingCostKrw || 0) - (sale.platformFeeKrw || 0) - (sale.pgFeeKrw || 0); return <tr key={sale.id}><td><span className="font-medium">{sale.styleName || sale.styleNo || '상품 미지정'}</span><span className="block text-xs text-muted-foreground">{sale.buyerName} · {sale.deliveryMarket === 'overseas' ? '해외' : sale.deliveryMarket === 'domestic' ? '국내' : 'B2B'}</span></td><td className="num">{sale.qty.toLocaleString()}</td><td className="num">{formatKRW(sale.totalKrw)}</td>{(['shippingCostKrw','platformFeeKrw','pgFeeKrw'] as const).map(field => <td key={field}><Input type="number" min="0" className="h-8 text-right" defaultValue={sale[field] || ''} onBlur={e => updateSaleCost(sale.id, field, Number(e.target.value))} /></td>)}<td className={`num font-bold ${profit < 0 ? 'text-[var(--system-red)]' : 'text-[var(--system-green)]'}`}>{formatKRW(profit)}</td></tr>; })}
          {sales.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">매출 데이터가 없습니다.</td></tr>}
        </tbody></table></div>
      </section>
      <div className="flex flex-wrap gap-2">
        {allOrderNos.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 발주가 없습니다</p>
        ) : allOrderNos.map(no => (
          <Button key={no} size="sm" variant={selectedNo === no ? 'secondary' : 'outline'}
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
              sub={pl.payableFactory > 0 ? '미지급 기준' : '단가×입고 추정'}
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

          <div className="bg-card rounded-lg border overflow-hidden">
            <div className="px-4 py-3 border-b font-semibold text-sm">연결 발주 ({projOrders.length}건)</div>
            <div className="overflow-x-auto">
            <table className="data-table w-full text-sm min-w-[560px]">
              <thead className="text-[13px] font-semibold text-muted-foreground">
                <tr>
                  <th className="nw">발주번호</th>
                  <th>품목</th>
                  <th className="num">수량</th>
                  <th className="num">단가</th>
                  <th className="num">입고</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {projOrders.map(o => (
                  <tr key={o.id} className="hover:bg-[var(--fill-quaternary)]">
                    <td className="nw font-mono text-xs">{o.orderNo}</td>
                    <td>{o.styleName || o.styleNo}</td>
                    <td className="num">{o.qty}</td>
                    <td className="num">{formatKRW(o.factoryUnitPriceKrw || 0)}</td>
                    <td className="num">{o.receivedQty ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div className="bg-card rounded-lg border overflow-hidden">
            <div className="px-4 py-3 border-b font-semibold text-sm">
              품목 · 컬러별 실제원가
              <span className="ml-2 font-normal text-muted-foreground text-xs">
                자재/임가공을 colorQtys 비중으로 배분 (컬러 지정 입고결의는 해당 컬러에 직접 반영)
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm min-w-[640px]">
                <thead className="text-[13px] font-semibold text-muted-foreground">
                  <tr>
                    <th>발주</th>
                    <th>스타일</th>
                    <th>컬러</th>
                    <th className="num">수량</th>
                    <th className="num">자재</th>
                    <th className="num">임가공</th>
                    <th className="num">합계</th>
                    <th className="num">PCS당</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(pl.byStyleColor || []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">
                        배분할 발주/원가 데이터가 없습니다
                      </td>
                    </tr>
                  ) : (pl.byStyleColor || []).map((row, i) => (
                    <tr key={`${row.orderNo}-${row.color}-${i}`} className="hover:bg-[var(--fill-quaternary)]">
                      <td className="nw font-mono text-xs">{row.orderNo}</td>
                      <td>
                        <span className="font-mono text-xs text-muted-foreground">{row.styleNo}</span>
                        {row.styleName ? <span className="block text-xs">{row.styleName}</span> : null}
                      </td>
                      <td>{row.color}</td>
                      <td className="num">{row.qty.toLocaleString()}</td>
                      <td className="num">{formatKRW(row.materialCost)}</td>
                      <td className="num">{formatKRW(row.factoryCost)}</td>
                      <td className="num font-medium">{formatKRW(row.totalCost)}</td>
                      <td className="num text-muted-foreground">
                        {row.qty > 0 ? formatKRW(Math.round(row.totalCost / row.qty)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {(pl.byStyleColor || []).length > 0 && (
                  <tfoot className="bg-muted border-t font-medium text-sm">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-right text-muted-foreground">합계</td>
                      <td className="num">
                        {formatKRW((pl.byStyleColor || []).reduce((s, r) => s + r.materialCost, 0))}
                      </td>
                      <td className="num">
                        {formatKRW((pl.byStyleColor || []).reduce((s, r) => s + r.factoryCost, 0))}
                      </td>
                      <td className="num">
                        {formatKRW((pl.byStyleColor || []).reduce((s, r) => s + r.totalCost, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="bg-muted rounded-lg border p-4 text-sm">
            <p className="font-semibold text-foreground">손익 요약</p>
            <p className="mt-2 text-muted-foreground">
              매출 {formatKRW(pl.revenue)} − 생산비 {formatKRW(pl.actualCost)} − 자재 {formatKRW(pl.purchaseCost)}
              = <span className="font-bold text-foreground">{formatKRW(pl.profit)}</span>
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground mt-1">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
