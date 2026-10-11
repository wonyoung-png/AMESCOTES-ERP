import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyListing, LISTING_EDITABLE_FIELDS } from '@shared/product-registration';
import { editablePayload, ITEM_FACT_FIELDS, kstInput, kstInstant, preorderGateWarning, preorderLabels, registrationApi, sections } from './form';

test('every editable field has a form control or explicit channel/item section', () => {
  const covered = new Set<string>([...sections.flatMap(section => section.fields.map(field => field.key)), ...ITEM_FACT_FIELDS,
    'item_id', 'material', 'color', 'size', 'design', 'shopify_channels', 'publish_at', 'publish_channels', 'preorder_end_condition']);
  assert.deepEqual(LISTING_EDITABLE_FIELDS.filter(key => !covered.has(key)), []);
});
test('save payload never contains item facts, state, approval or channel operation results', () => {
  const listing = { ...emptyListing('fixture'), sku: 'MASTER', style_name: 'MASTER', color_en: 'MASTER', supply_price: 200, id: 'fixture-listing', revision: 4, approved_by: 'not-sent', approved_revision: 4, item: { private: 'not-sent' }, cafe24_product_no: 99 };
  const payload = editablePayload(listing);
  for (const key of [...ITEM_FACT_FIELDS, 'id', 'status', 'revision', 'approved_by', 'approved_revision', 'item', 'cafe24_product_no', 'step_keys']) assert.equal(key in payload, false, key);
  assert.equal(payload.item_id, 'fixture');
  assert.equal(payload.price_usd, 0);
});
test('KST conversion does not depend on the browser timezone and retains explicit offset', () => {
  assert.equal(kstInput('2026-10-12T00:30:00Z'), '2026-10-12T09:30');
  assert.equal(kstInstant('2026-10-12T09:30', Date.parse('2026-10-11T00:00:00Z')), '2026-10-12T09:30:00+09:00');
  assert.equal(kstInput('2026-10-11T16:00:00Z'), '2026-10-12T01:00');
  assert.equal(kstInstant(''), null);
  assert.equal(kstInput('not-a-date'), '');
});
test('KST rejects past timestamps, timezone-less malformed values, and rollover dates', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  for (const input of ['2026-10-10T10:00', '2026-10-11T09:00', '2026-02-30T10:00', '2026-10-12T09:30Z', '2026-10-12T25:00']) assert.throws(() => kstInstant(input, now), input);
});
test('preorder labels use Korean timezone and English month without automatic saved changes', () => {
  assert.deepEqual(preorderLabels('2026-10-14'), { ko: '10/14(수) 예약배송', en: 'PRE ORDER SHIP FROM OCT 14' });
  assert.deepEqual(preorderLabels(''), { ko: '', en: '' });
});

test('preorder gate reasons have human-readable warnings without implying completion', () => {
  assert.match(preorderGateWarning('preorder_end_staging_required')!, /자동 종료 보류.*채널별 상품 반영/);
  assert.match(preorderGateWarning('preorder_end_adapter_unconnected')!, /자동 종료 보류.*종료 기능이 연결되지/);
  assert.match(preorderGateWarning('authoritative_commerce_receipt_unsupported')!, /자동 종료 보류.*재고 증가만으로는 해제되지/);
  for (const reason of [null, undefined, '', 'unknown']) assert.equal(preorderGateWarning(reason), undefined);
});
test('mock transport includes server credentials, LUMEN workspace and optional bearer session', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'synthetic-session' } });
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/product-registration/items');
      assert.equal(init?.credentials, 'include');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('X-Workspace'), 'LUMEN');
      assert.equal(headers.get('Authorization'), 'Bearer synthetic-session');
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };
    assert.deepEqual(await registrationApi('/items'), { items: [] });
    globalThis.fetch = async () => new Response('<html>not mounted</html>', { status: 404 });
    await assert.rejects(registrationApi(), /준비되지 않았습니다/);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'revision_conflict' }), { status: 409 });
    await assert.rejects(registrationApi(), /revision_conflict/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
