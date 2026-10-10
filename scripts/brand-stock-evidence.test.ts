import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('입출고 이력을 현재고·주문 수요로 추정해 리오더를 권장하지 않는다', () => {
  const source = readFileSync(new URL('../client/src/pages/BrandOrders.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /inbound\s*-\s*shipped|totalDemand-currentStock-incoming|r\.reorderQty|r\.currentStock/);
  assert.match(source, /위치별 실재고·불량·현재 주문 수요 대조 전 권장 수량은 미확인/);
  assert.match(source, /배송처별 숫자는 과거 출고 이력/);
  assert.match(source, /href="\/inventory"[^>]*>재고 대조 필요/);
});
