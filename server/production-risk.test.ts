import test from 'node:test';
import assert from 'node:assert/strict';
import { productionRisks, productionScope } from './production-risk';

const base = { id: 'O1', order_no: 'PO1', quantity: 100, received_qty: 100, delivery_date: '2026-10-09', status: '생산중' };
test('브랜드의 OEM 의뢰는 포함하되 다른 브랜드의 의뢰는 섞지 않는다', () => {
  const scope = decodeURIComponent(productionScope('LUMEN', [{ id: 'L1', workspace: 'LUMEN' }, { id: 'A1', workspace: 'AETALOOF' }]));
  assert.equal(scope, 'or=(workspace.eq.LUMEN,brand_batch_id.in.("L1"))');
  assert.equal(productionScope('AETALOOF', []), 'workspace=eq.AETALOOF');
});
test('입고 이력이 상태·발주 누계보다 우선하며 출고를 입고로 더하지 않는다', () => {
  const rows = [{ order_id: 'O1', log_type: 'inbound', qty: 40 }, { order_id: 'O1', log_type: 'outbound_oem', qty: 60 }];
  const result = productionRisks([base], rows, '2026-10-09')[0];
  assert.equal(result.remaining, 60);
  assert.equal(result.label, '7일 내 납기');
  assert.equal(rows[0].qty, 40);
});
test('기한·공장 확정·잘못된 날짜·완료 불일치를 구분한다', () => {
  const label = (overrides: any) => productionRisks([{ ...base, received_qty: 0, ...overrides }], [], '2026-10-09')[0]?.label;
  assert.equal(label({ delivery_date: '2026-10-08' }), '납기 지연');
  assert.equal(label({ delivery_date: '2026-10-20', confirmed_date: '2026-10-21' }), '공장 확정일 초과');
  assert.equal(label({ delivery_date: '2026-02-30' }), '납기 확인');
  assert.equal(label({ status: '입고완료' }), '완료 상태·입고 불일치');
  assert.equal(label({ quantity: 0 }), '수량 확인');
  assert.equal(label({ status: '초안' }), undefined);
  assert.equal(label({ status: '취소' }), undefined);
});
test('전량 입고 후 지연 경보를 유지하지 않고 상태 확인만 남긴다', () => {
  assert.equal(productionRisks([{ ...base, delivery_date: '2026-10-01' }], [], '2026-10-09')[0].label, '입고완료·상태 확인');
  assert.equal(productionRisks([{ ...base, status: '입고완료' }], [], '2026-10-09').length, 0);
});
