import assert from 'node:assert/strict';
import test from 'node:test';
import { operationalWatch, shipmentWatch, loadBrandApprovals, brandApprovalQueue } from './operational-watch';

function reader(tables: Record<string, any[]>, fail = '') {
  return async (path: string) => {
    const [table, query] = path.split('?'); const p = new URLSearchParams(query);
    assert.equal(p.get('order') !== null, true);
    if (table === 'brand_order_batches') assert.equal(p.get('status'), 'in.(draft,in_approval)');
    return { ok: table !== fail, status: table === fail ? 503 : 200, json: async () => (tables[table] || []).slice(Number(p.get('offset')), Number(p.get('offset')) + 500) } as Response;
  };
}
test('대표 승인 원본은 페이지 한도를 넘어 전수 조회하고 카드 생성을 요구하지 않는다', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), workspace: 'LUMEN', status: 'in_approval' }));
  assert.equal((await loadBrandApprovals(reader({ brand_order_batches: rows }))).length, 1001);
  const w = await operationalWatch('2026-10-11', reader({ brand_order_batches: rows }));
  assert.match(w.get('루멘 디자인')!.facts.join('\n'), /승인 대기 1001건/);
  assert.match(w.get('에탈루프 디자인')!.facts.join('\n'), /승인 대기 0건/);
});
test('실제 UI의 완성된 draft도 대표 검토에 포함하고 빈 작성본·잘못된 수량은 제외한다', () => {
  const line = { id: 'l', style_no: 'TY', factory_id: 'f', qty: 5, color_qtys: [{ qty: 5 }] };
  const rows = brandApprovalQueue([
    { id: 'ready', status: 'draft', brand_order_lines: [line] },
    { id: 'empty', status: 'draft', brand_order_lines: [] },
    { id: 'invalid', status: 'draft', brand_order_lines: [{ ...line, qty: 10 }] },
    { id: 'submitted', status: 'in_approval', brand_order_lines: [] },
    { id: 'approved', status: 'approved', brand_order_lines: [line] },
  ]);
  assert.deepEqual(rows.map(r => r.id), ['ready', 'submitted']);
});
test('중국 입고를 본사 출고 잔량으로 중복 계산하지 않는다', () => {
  const china = { order_id: 'o', log_type: 'inbound', destination: 'china', qty: 10 };
  const order = { id: 'o', quantity: 10, received_qty: 10, delivery_date: '2020-01-01' };
  const w = shipmentWatch([order], [china], '2026-10-11');
  assert.equal(w.alerts, 0); assert.match(w.facts[0], /잔량 확인 0건/);
  const mixed = shipmentWatch([{ ...order, quantity: 15, received_qty: 15 }], [china, { order_id: 'o', log_type: 'inbound', destination: 'korea', qty: 5 }], '2026-10-11');
  assert.match(mixed.facts.join('\n'), /정상품 출고 잔량 5/);
});
test('원본 수정·구매·부분 도착이 비서실 근거로 들어오고 실제 도착을 단정하지 않는다', async () => {
  const w = await operationalWatch('2026-10-11', reader({
    boms: [{ id: 'b', style_no: 'TY', updated_at: '2026-10-11', delivery_price: 123 }],
    materials: [{ id: 'm', name: '안감', unit_price: 2, currency: 'USD', updated_at: '2026-10-11' }],
    purchase_items: [{ id: 'p', order_no: 'PO', purchase_status: '미발주' }, { id: 'done', purchase_status: '발주완료' }],
    china_stock_transfers: [{ id: 't', workspace: 'LUMEN', qty: 10, received_qty: 4, style_no: 'TY', sent_date: '2026-10-01' }],
  }));
  assert.match(w.get('제품개발')!.facts.join('\n'), /BOM·원가 저장·수정 1건/);
  assert.match(w.get('생산관리')!.facts.join('\n'), /미발주 1건/);
  assert.match(w.get('물류·CS')!.facts.join('\n'), /미도착 6/);
  assert.match(w.get('물류·CS')!.facts.join('\n'), /지연 여부 미확인/);
});
test('원본 조회 실패는 정상 또는 승인 대기 없음이 아니다', async () => {
  const w = await operationalWatch('2026-10-11', reader({}, 'brand_order_batches'));
  assert.match(w.get('생산관리')!.facts.join('\n'), /승인 대기: 조회 실패 — 판단 보류/);
  assert.ok(w.get('생산관리')!.alerts > 0);
  await assert.rejects(loadBrandApprovals(reader({}, 'brand_order_batches')));
});
test('표시에서 빠진 아홉 번째 원본 변경도 보고 근거를 갱신한다', async () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ id: String(i), unit_price: 1 }));
  const a = await operationalWatch('2026-10-11', reader({ materials: rows }));
  rows[8].unit_price = 2;
  const b = await operationalWatch('2026-10-11', reader({ materials: rows }));
  assert.notDeepEqual(a.get('제품개발'), b.get('제품개발'));
});
test('부분 입고·불량·OEM 및 3PL 출고를 차감하고 취소 발주를 제외한다', () => {
  const orders = [{ id: 'o', order_no: 'PO', quantity: 10, received_qty: 10, shipped_qty: 4, status: '입고완료', delivery_date: '2020-01-01' }, { id: 'cancel', received_qty: 5, status: '취소' }];
  const w = shipmentWatch(orders, [{ order_id: 'o', log_type: 'inbound', qty: 10, defect_qty: 2 }, { order_id: 'o', log_type: 'outbound_oem', qty: 3 }, { order_id: 'o', log_type: 'outbound_3pl', qty: 1 }], '2026-10-11');
  assert.match(w.facts.join('\n'), /출고 4 \/ 정상품 출고 잔량 4/); assert.equal(w.alerts, 1);
  assert.match(w.facts.join('\n'), /고객 도착 미확인/);
});
test('출고 수량 불일치는 납품완료가 아니고 이력이 없을 때도 누적값을 보존한다', () => {
  const w = shipmentWatch([{ id: 'a', quantity: 5, received_qty: 5, shipped_qty: 3 }, { id: 'b', quantity: 1, received_qty: 1, shipped_qty: 5 }], [], '2026-10-11');
  assert.match(w.facts.join('\n'), /정상품 출고 잔량 2/);
  assert.match(w.facts.join('\n'), /입출고 수량 불일치 — 판단 보류/); assert.equal(w.alerts, 1);
});

test('부분 이력이 있어도 레거시 누적값을 잃지 않고 공장 직송을 수량 오류로 단정하지 않는다', () => {
  const w = shipmentWatch([{ id: 'o', quantity: 10, received_qty: 10, shipped_qty: 7 }], [{ order_id: 'o', log_type: 'inbound', qty: 2 }, { order_id: 'o', log_type: 'outbound_oem', qty: 2 }], '2026-10-11');
  assert.match(w.facts.join('\n'), /출고 7 \/ 정상품 출고 잔량 3/);
  const direct = shipmentWatch([{ id: 'd', quantity: 10, received_qty: 0, shipped_qty: 4 }], [], '2026-10-11');
  assert.equal(direct.alerts, 0);
  assert.match(direct.facts.join('\n'), /주문 대비 미출고 6/);
  assert.match(direct.facts.join('\n'), /공장 직송 여부 확인/);
});
