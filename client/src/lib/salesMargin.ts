import type { ProductionOrder, SalesRecord } from './store';

/** 명시된 연결을 우선한다. 다른 차수의 첫 단가를 임의로 가져오지 않는다. */
export function saleMargin(sale: SalesRecord, orders: ProductionOrder[]) {
  const candidates = sale.orderId ? orders.filter(o => o.id === sale.orderId)
    : sale.orderNo ? orders.filter(o => o.orderNo === sale.orderNo && (!sale.styleNo || o.styleNo === sale.styleNo))
    : [];
  const prices = candidates.map(o => o.factoryUnitPriceKrw);
  const known = prices.length > 0 && prices.every(p => typeof p === 'number' && Number.isFinite(p) && p > 0) && new Set(prices).size === 1;
  const cogs = known ? prices[0]! * sale.qty : null;
  const fees = (sale.shippingCostKrw || 0) + (sale.platformFeeKrw || 0) + (sale.pgFeeKrw || 0);
  return { cogs, profit: cogs == null ? null : sale.totalKrw - cogs - fees };
}
