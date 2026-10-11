import assert from 'node:assert/strict';
import test from 'node:test';
import { gatherWatch } from './watch';
import { teamEvidence } from './agents';
import { evidenceFreshness } from './report-evidence';
import { kstToday } from './work';

// Real watch/report evidence functions; mutable synthetic reads, NOT live DB/API/UI.
function fixture() {
  const tables: Record<string, any[]> = {};
  const failures = new Set<string>();
  const requests: string[] = [];
  const read = async (path: string) => {
    requests.push(path);
    const [table, query] = path.split('?');
    const params = new URLSearchParams(query);
    assert.ok(params.get('order'), 'Each source must have stable pagination order');
    let rows = tables[table] || [];
    if (table === 'brand_order_batches') rows = rows.filter(r => params.get('status')!.slice(4, -1).split(',').includes(r.status));
    if (table === 'china_stock_transfers') rows = rows.filter(r => r.status === 'in_transit');
    const offset = Number(params.get('offset') || 0);
    return new Response(JSON.stringify(rows.slice(offset, offset + Number(params.get('limit') || 500))), {
      status: failures.has(table) ? 503 : 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  const pms = async () => ({ sales: { daily30: [{ shopify: 1 }] }, inventory: { skus: 1 } });
  const snapshot = async (team: string) => {
    const watch = await gatherWatch(read, pms);
    const ctx = { cards: [], all: [], watch, rules: new Map<string, string>(), bossIds: new Set<string>(), today: kstToday(), sourceErrors: [] };
    return { facts: watch.get(team)!.facts.join('\n'), evidence: teamEvidence(team, ctx) };
  };
  return { tables, failures, requests, snapshot };
}

test('brand approval -> original issued state invalidates report without duplicate work cards', async () => {
  const f = fixture();
  f.tables.brand_order_batches = [{ id: 'batch', workspace: 'LUMEN', status: 'in_approval', project_no: 'TEST' }];
  const before = await f.snapshot('생산관리');
  assert.match(before.facts, /LUMEN 브랜드 생산 의뢰 대표 승인 대기 1건/);
  assert.equal(evidenceFreshness(before.evidence, before.evidence), 'current');
  f.tables.brand_order_batches[0].status = 'issued';
  const after = await f.snapshot('생산관리');
  assert.match(after.facts, /LUMEN 브랜드 생산 의뢰 대표 승인 대기 0건/);
  assert.equal(evidenceFreshness(before.evidence, after.evidence), 'changed');
  assert.equal(f.requests.some(p => p.startsWith('work_cards?')), false);
});

test('material purchase completion clears original pending and invalidates saved report', async () => {
  const f = fixture();
  f.tables.purchase_items = [{ id: 'purchase', qty: 10, purchase_status: '미발주' }];
  const before = await f.snapshot('생산관리');
  f.tables.purchase_items[0].purchase_status = '발주완료';
  const after = await f.snapshot('생산관리');
  assert.match(before.facts, /자재 구매 원본 미발주 1건/);
  assert.match(after.facts, /자재 구매 원본 미발주 0건/);
  assert.equal(evidenceFreshness(before.evidence, after.evidence), 'changed');
});

test('partial shipping -> all good stock shipped updates remaining but never asserts customer arrival', async () => {
  const f = fixture();
  f.tables.production_orders = [{ id: 'order', quantity: 10, received_qty: 10, status: '입고완료', workspace: 'OEM', factory_unit_price_krw: 1 }];
  f.tables.receipt_logs = [{ id: 'in', order_id: 'order', log_type: 'inbound', destination: 'korea', qty: 10 },
    { id: 'out', order_id: 'order', log_type: 'outbound_oem', qty: 4 }];
  const before = await f.snapshot('물류·CS');
  assert.match(before.facts, /정상품 출고 잔량 6/);
  f.tables.receipt_logs[1].qty = 10;
  const after = await f.snapshot('물류·CS');
  assert.match(after.facts, /입고·출고 후 잔량 확인 0건/);
  assert.match(after.facts, /고객 도착 미확인/);
  assert.equal(evidenceFreshness(before.evidence, after.evidence), 'changed');
});

test('China partial arrival -> full arrival removes pending and invalidates report', async () => {
  const f = fixture();
  f.tables.china_stock_transfers = [{ id: 'transfer', workspace: 'LUMEN', style_no: 'TEST', color: 'black', qty: 10, received_qty: 4, status: 'in_transit' }];
  const before = await f.snapshot('물류·CS');
  assert.match(before.facts, /미도착 6/);
  f.tables.china_stock_transfers[0].received_qty = 10;
  f.tables.china_stock_transfers[0].status = 'received';
  const after = await f.snapshot('물류·CS');
  assert.match(after.facts, /이동 도착 확인 대기 0건/);
  assert.equal(evidenceFreshness(before.evidence, after.evidence), 'changed');
});

test('original read failure -> recovery preserves uncertainty then changes the saved evidence', async () => {
  const f = fixture();
  const before = await f.snapshot('생산관리');
  f.failures.add('purchase_items');
  const failed = await f.snapshot('생산관리');
  assert.match(failed.facts, /자재 구매: 조회 실패 — 판단 보류/);
  assert.equal(failed.evidence.complete, false);
  assert.equal(evidenceFreshness(before.evidence, failed.evidence), 'unknown');
  f.failures.clear();
  f.tables.purchase_items = [{ id: 'purchase', qty: 2, purchase_status: '미발주' }];
  const recovered = await f.snapshot('생산관리');
  assert.equal(recovered.evidence.complete, true);
  assert.equal(evidenceFreshness(before.evidence, recovered.evidence), 'changed');
});

test('ninth material price change updates real report evidence beyond visible detail limit', async () => {
  const f = fixture();
  f.tables.materials = Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: 'test lining', unit_price: 2, currency: 'USD', updated_at: new Date().toISOString() }));
  const before = await f.snapshot('제품개발');
  f.tables.materials[8].unit_price = 3;
  const after = await f.snapshot('제품개발');
  assert.equal(evidenceFreshness(before.evidence, after.evidence), 'changed');
});

for (const received of [null, -1, 10, 11, 'invalid']) {
  test(`invalid in-transit received quantity ${received} must hold CEO report judgement`, async () => {
    const f = fixture();
    f.tables.china_stock_transfers = [{ id: 'bad', qty: 10, received_qty: received, status: 'in_transit' }];
    const current = await f.snapshot('물류·CS');
    assert.match(current.facts, /이동.*수량 불일치 — 판단 보류/);
    assert.equal(current.evidence.complete, false);
  });
}

test('bad China movement cannot be reset by a subsequent valid movement or reported as verified total', async () => {
  const f = fixture();
  f.tables.china_stock_moves = [
    { id: 'bad', workspace: 'LUMEN', style_no: 'TEST', color: 'black', qty: 'invalid', move_type: 'inbound' },
    { id: 'good', workspace: 'LUMEN', style_no: 'TEST', color: 'black', qty: 5, move_type: 'inbound' },
  ];
  const current = await f.snapshot('물류·CS');
  assert.match(current.facts, /LUMEN 중국 거점 재고 수량 미확인 — 판단 보류/);
  assert.equal(current.evidence.complete, false);
});

test('approved -> issued -> OEM accepted remains visible without reopening CEO approval', async () => {
  const f = fixture();
  const batch = { id: 'batch', workspace: 'LUMEN', status: 'approved', brand_order_lines: [{ id: 'line', route: 'oem', accepted_at: null }] };
  f.tables.brand_order_batches = [batch, { id: 'direct', workspace: 'LUMEN', status: 'issued', brand_order_lines: [{ route: 'direct' }] }];
  const approved = await f.snapshot('생산관리');
  assert.match(approved.facts, /LUMEN 브랜드 생산 의뢰 대표 승인 대기 0건/);
  assert.match(approved.facts, /LUMEN 승인 후 발행 대기 1건 \/ 발행 후 OEM 수주 확인 대기 0건/);
  batch.status = 'issued';
  const issued = await f.snapshot('생산관리');
  assert.match(issued.facts, /LUMEN 승인 후 발행 대기 0건 \/ 발행 후 OEM 수주 확인 대기 1건/);
  assert.equal(evidenceFreshness(approved.evidence, issued.evidence), 'changed');
  batch.status = 'split';
  const accepted = await f.snapshot('생산관리');
  assert.match(accepted.facts, /발행 후 OEM 수주 확인 대기 0건/);
  assert.equal(evidenceFreshness(issued.evidence, accepted.evidence), 'changed');
});

test('incomplete nonempty drafts are visible as preparation, not actionable CEO approval', async () => {
  const f = fixture();
  f.tables.brand_order_batches = [
    { id: 'incomplete', workspace: 'LUMEN', status: 'draft', brand_order_lines: [{ qty: 5 }] },
    { id: 'empty', workspace: 'LUMEN', status: 'draft', brand_order_lines: [] },
  ];
  const current = await f.snapshot('생산관리');
  assert.match(current.facts, /대표 승인 대기 0건/);
  assert.match(current.facts, /LUMEN 의뢰 승인 전 작성 확인 1건/);
  assert.match(current.facts, /의뢰 id=incomplete/);
});

test('purchase ordered -> received -> dispatched remains visible until final handoff', async () => {
  const f = fixture();
  const purchase = { id: 'purchase', qty: 10, purchase_status: '발주완료' };
  f.tables.purchase_items = [purchase];
  const material = { itemName: 'test lining', purchaseStatus: '구매완료' };
  f.tables.production_orders = [{ id: 'order', order_no: 'TEST', quantity: 10, received_qty: 0, status: '생산중', hq_supply_items: [material] }];
  const ordered = await f.snapshot('생산관리');
  assert.match(ordered.facts, /자재 발주완료·입고 대기 1건 \/ 입고완료·발송 대기 0건/);
  assert.match(ordered.facts, /본사 제공 자재 구매완료·미발송 1건/);
  purchase.purchase_status = '입고완료';
  const received = await f.snapshot('생산관리');
  assert.match(received.facts, /자재 발주완료·입고 대기 0건 \/ 입고완료·발송 대기 1건/);
  purchase.purchase_status = '발송완료';
  material.purchaseStatus = '발송완료';
  const sent = await f.snapshot('생산관리');
  assert.match(sent.facts, /입고완료·발송 대기 0건/);
  assert.match(sent.facts, /본사 제공 자재 구매완료·미발송 0건/);
  assert.equal(evidenceFreshness(ordered.evidence, received.evidence), 'changed');
  assert.equal(evidenceFreshness(received.evidence, sent.evidence), 'changed');
});

test('full shipment with unresolved defects cannot disappear as zero checks', async () => {
  const f = fixture();
  f.tables.production_orders = [{ id: 'order', quantity: 100, received_qty: 100, defect_qty: 20, shipped_qty: 100, status: '입고완료' }];
  f.tables.receipt_logs = [{ id: 'in', order_id: 'order', log_type: 'inbound', destination: 'korea', qty: 100, defect_qty: 20 },
    { id: 'out', order_id: 'order', log_type: 'outbound_oem', qty: 100 }];
  const current = await f.snapshot('물류·CS');
  assert.match(current.facts, /잔량 확인 1건/);
  assert.match(current.facts, /불량 20/);
  assert.match(current.facts, /재검수·대체 입고·공장 직송 확인 전 판단 보류/);
  assert.equal(current.evidence.complete, false);
});
