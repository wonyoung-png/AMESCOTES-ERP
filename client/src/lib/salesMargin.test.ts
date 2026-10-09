import test from 'node:test';
import assert from 'node:assert/strict';
import { saleMargin } from './salesMargin';

test('명시적인 발주 ID가 품번보다 우선하고 다른 차수 원가를 쓰지 않는다', () => {
  const orders = [{ id: 'old', styleNo: 'A', factoryUnitPriceKrw: 10 }, { id: 'new', styleNo: 'A', factoryUnitPriceKrw: 30 }] as any;
  assert.deepEqual(saleMargin({ orderId: 'new', qty: 2, totalKrw: 100, shippingCostKrw: 5 } as any, orders), { cogs: 60, profit: 35 });
  assert.equal(saleMargin({ styleNo: 'A', qty: 2, totalKrw: 100 } as any, orders).profit, null);
  assert.equal(saleMargin({ orderId: 'missing', styleNo: 'A', qty: 2, totalKrw: 100 } as any, orders).profit, null);
});

test('서로 다른 단가를 가진 발주번호는 원가 확정으로 간주하지 않는다', () => {
  assert.equal(saleMargin({ orderNo: 'PO1', styleNo: 'A', qty: 2, totalKrw: 100 } as any, [{ orderNo: 'PO1', styleNo: 'A', factoryUnitPriceKrw: 10 }, { orderNo: 'PO1', styleNo: 'A', factoryUnitPriceKrw: 30 }] as any).cogs, null);
});
