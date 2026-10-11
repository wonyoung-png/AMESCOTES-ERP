import type { PurchaseItem, ProductionOrder } from './store';

// Re-read persisted purchases after the status write. One shipped material is
// not evidence that every material for this production order has been sent.
export async function linkShippedPurchases(
  item: PurchaseItem,
  deps: {
    purchases: () => Promise<PurchaseItem[]>;
    orders: () => Promise<ProductionOrder[]>;
    save: (order: ProductionOrder) => Promise<void | boolean>;
  },
): Promise<ProductionOrder | null> {
  const purchases = await deps.purchases();
  const related = purchases.filter(p => item.orderId ? p.orderId === item.orderId : p.orderNo === item.orderNo);
  if (!related.length || related.some(p => p.purchaseStatus !== '발송완료')) return null;
  const orders = await deps.orders();
  const order = orders.find(o => item.orderId ? o.id === item.orderId : o.orderNo === item.orderNo);
  if (!order) throw new Error('연결된 생산발주를 찾을 수 없습니다. 발주 연결을 확인해주세요.');
  if (order.status && order.status !== '발주생성') return null;
  const updated = { ...order, status: '생산중' as const, updatedAt: new Date().toISOString() };
  const changed = await deps.save(updated);
  return changed === false ? null : updated;
}
