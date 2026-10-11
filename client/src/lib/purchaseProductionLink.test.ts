import assert from 'node:assert/strict';
import test from 'node:test';
import { linkShippedPurchases } from './purchaseProductionLink';
import type { PurchaseItem, ProductionOrder } from './store';

const item = { id: 'p1', orderId: 'o1', orderNo: 'old-number', purchaseStatus: '발송완료' } as PurchaseItem;
const order = { id: 'o1', orderNo: 'new-number', status: '발주생성' } as ProductionOrder;
test('strict reads fail closed and a verified no-op write is not reported as a new transition', async () => {
  const deps = { purchases: async () => [item], orders: async () => [order], save: async () => false };
  assert.equal(await linkShippedPurchases(item, deps), null);
  await assert.rejects(linkShippedPurchases(item, { ...deps, purchases: async () => { throw Error('purchase read failed'); } }), /purchase read failed/);
  await assert.rejects(linkShippedPurchases(item, { ...deps, orders: async () => { throw Error('order read failed'); } }), /order read failed/);
});
test('one shipped material does not start production; persisted order ID beats display number', async () => {
  let saves = 0;
  const deps = { purchases: async () => [item, { ...item, id: 'p2', purchaseStatus: '미발주' }], orders: async () => [order], save: async () => { saves++; } };
  assert.equal(await linkShippedPurchases(item, deps), null);
  deps.purchases = async () => [item];
  assert.equal((await linkShippedPurchases(item, deps))?.id, 'o1');
  assert.equal(saves, 1);
});
test('failed production write propagates; retry and already started order are safe', async () => {
  let saved = false;
  const deps = { purchases: async () => [item], orders: async () => [order], save: async () => { throw Error('DB unavailable'); } };
  await assert.rejects(linkShippedPurchases(item, deps), /DB unavailable/);
  assert.equal(saved, false);
  await linkShippedPurchases(item, { ...deps, save: async () => { saved = true; } });
  assert.equal(saved, true);
  saved = false;
  await linkShippedPurchases(item, { ...deps, orders: async () => [{ ...order, status: '입고완료' }], save: async () => { saved = true; } });
  assert.equal(saved, false);
});
