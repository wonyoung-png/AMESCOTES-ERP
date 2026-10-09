import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router from './inventory';
import { inventoryFromSheet, inventoryQuantity, inventorySubtotal } from '../shared/inventory';

const sheet = { headers: ['SKU', '상품명', '총잔여', 'EZ가용', '출고대기', 'EZ해외', '쇼피파이', '카페24', '신세계센텀', '한남쇼룸'],
  rows: [['※ ASOF test'], ['s1', '제품', 9999, 10, 3, 2, 10, 10, 4, 5]] };
test('가용에 출고대기를 다시 차감하거나 채널 할당을 더하지 않는다', () => {
  const rows = inventoryFromSheet(sheet);
  assert.equal(rows.length, 4);
  assert.equal(inventorySubtotal(rows, 'domestic'), 10);
  assert.equal(rows.find(row => row.location === 'domestic')?.pending, 3);
  assert.ok(!rows.some(row => row.quantity === 9999));
});
test('해외와 매장은 국내와 분리하고 열 순서 대신 명칭을 사용한다', () => {
  const rows = inventoryFromSheet(sheet);
  assert.equal(inventorySubtotal(rows, 'ez-overseas'), 2);
  assert.equal(inventorySubtotal(rows, 'centum'), 4);
  assert.equal(inventorySubtotal(rows, 'hannam'), 5);
  assert.equal(rows[0].sku, 'S1');
});
test('누락·잘못된 수량을 0으로 바꾸지 않는다', () => {
  for (const value of [undefined, null, '', ' ', 'oops', '1.2', 'Infinity', '1,2', Number.MAX_SAFE_INTEGER + 1]) assert.equal(inventoryQuantity(value), null);
  assert.equal(inventoryQuantity('0'), 0);
  assert.equal(inventoryQuantity('-3'), -3);
  assert.equal(inventoryQuantity('1,234'), 1234);
});
test('누락된 위치와 비어 있는 브랜드의 합계는 미확인이다', () => {
  const rows = inventoryFromSheet({ headers: ['SKU', 'EZ가용'], rows: [['S1', 1], ['S2', '']] });
  assert.equal(inventorySubtotal(rows, 'domestic'), null);
  assert.equal(inventorySubtotal(rows, 'hannam'), null);
  assert.equal(inventorySubtotal([], 'domestic'), null);
});
test('중복 SKU를 추정 병합하지 않고 합계 산출을 막는다', () => {
  const rows = inventoryFromSheet({ headers: sheet.headers, rows: [sheet.rows[1], sheet.rows[1]] });
  assert.equal(rows.length, 8);
  assert.equal(new Set(rows.map(row => row.id)).size, 8);
  assert.equal(inventorySubtotal(rows, 'domestic'), null);
});
test('구형 EZ국내를 의미 확인 없이 EZ가용으로 바꾸지 않는다', () => {
  assert.throws(() => inventoryFromSheet({ headers: ['SKU', 'EZ국내'], rows: [] }));
  assert.throws(() => inventoryFromSheet({ headers: [], rows: [] }));
});
test('재고 조회는 비로그인 요청을 차단한다', async () => {
  const app = express(); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/inventory/overview?workspace=LUMEN`);
    assert.equal(response.status, 401);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
