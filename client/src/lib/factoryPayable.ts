type FactoryPayable = {
  id: string;
  sourceType: string;
  amountKrw: number;
  orderId?: string;
  orderNo?: string;
  projectNo?: string;
};

/** 같은 생산발주의 예정 가공비와 입고 확정액은 합산하지 않고 큰 금액만 반영한다. */
export function effectiveFactoryPayableTotal(payables: FactoryPayable[]) {
  const totals = new Map<string, { processing: number; receipt: number }>();
  for (const payable of payables) {
    const key = payable.orderId || payable.orderNo || payable.projectNo || payable.id;
    const total = totals.get(key) || { processing: 0, receipt: 0 };
    if (payable.sourceType === 'processing') total.processing += payable.amountKrw || 0;
    if (payable.sourceType === 'order_receipt') total.receipt += payable.amountKrw || 0;
    totals.set(key, total);
  }
  return [...totals.values()].reduce((sum, total) => sum + Math.max(total.processing, total.receipt), 0);
}
