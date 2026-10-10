import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) || null, setItem: (k, v) => mem.set(k, v) };
const out = await build({ entryPoints: [path.join(path.dirname(fileURLToPath(import.meta.url)), 'phase1.ts')],
  bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent', plugins: [{ name: 'shipment-test', setup(b) {
    b.onResolve({ filter: /(^\.\/db$|^sonner$)/ }, a => ({ path: a.path, namespace: 'shipment-test' }));
    b.onLoad({ filter: /.*/, namespace: 'shipment-test' }, () => ({ loader: 'js', contents: `
      export const db = { from: () => ({ upsert: async () => ({ error: null }) }) };
      export const toast = { error() {} };` }));
  }}] });
const { phase1 } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const add = (orderId, logType, qty, defectQty = 0) => phase1.addReceiptLog({ orderId, orderNo: orderId,
  logType, qty, defectQty, receivedDate: '2026-10-10' });

add('mixed', 'inbound', 100, 2);
add('mixed', 'outbound_3pl', 60);
add('mixed', 'outbound_oem', 40);
const mixed = phase1.getOrderReceiptSummary('mixed', 100);
assert.equal(mixed.oemShippedQty, 40, '3PL transfer must not complete OEM delivery');
assert.equal(mixed.threePlQty, 60);
assert.equal(mixed.shippedQty, 100, 'both factory destinations consume the shared shipment capacity');
assert.equal(mixed.unclassifiedShippedQty, 0);
assert.equal(mixed.receivedQty, 100);
assert.equal(mixed.defectQty, 2);
assert.equal(mixed.remaining, 0);

const legacy = phase1.getOrderReceiptSummary('legacy', 100, { receivedQty: 80, defectQty: 3, shippedQty: 70 });
assert.equal(legacy.receivedQty, 80, 'legacy receipts must not disappear when logs are missing');
assert.equal(legacy.defectQty, 3);
assert.equal(legacy.remaining, 20);
assert.equal(legacy.shippedQty, 70, 'legacy aggregate must still limit further shipments');
assert.equal(legacy.unclassifiedShippedQty, 70);
assert.equal(legacy.oemShippedQty, 0, 'unknown destinations must not be guessed as OEM');
assert.equal(legacy.threePlQty, 0);

add('legacy', 'outbound_oem', 20);
const partial = phase1.getOrderReceiptSummary('legacy', 100, { shippedQty: 70 });
assert.equal(partial.shippedQty, 70, 'logs are part of the aggregate, not additional inventory');
assert.equal(partial.oemShippedQty, 20);
assert.equal(partial.unclassifiedShippedQty, 50);

add('full-oem', 'outbound_oem', 30);
add('full-oem', 'outbound_oem', 70);
add('other-order', 'outbound_3pl', 500);
const full = phase1.getOrderReceiptSummary('full-oem', 100, { shippedQty: 30 });
assert.equal(full.oemShippedQty, 100);
assert.equal(full.threePlQty, 0, 'other orders must not affect shipment quantities');
assert.equal(full.shippedQty, 100, 'newer logs must take precedence over stale aggregate');
assert.equal(full.unclassifiedShippedQty, 0);

const empty = phase1.getOrderReceiptSummary('empty', 100);
assert.equal(empty.shippedQty, 0);
assert.equal(empty.oemShippedQty, 0);
assert.equal(empty.threePlQty, 0);
assert.equal(empty.remaining, 100);
console.log('phase1 shipment scenarios=5 PASS');

const input = { id: 'ship_request', orderId: 'server_order', logType: 'outbound_oem', qty: 10,
  deliveryMarket: 'b2b', receivedDate: '2026-10-10' };
const before = JSON.stringify(phase1.getReceiptLogs());
globalThis.fetch = async () => ({ ok: false, json: async () => ({ message: 'rollback' }) });
await assert.rejects(phase1.saveShipment(input), /rollback/);
assert.equal(JSON.stringify(phase1.getReceiptLogs()), before, 'failed shipment must not change cache');
const serverResult = { receipt: { id: input.id }, order: { id: input.orderId, shipped_qty: 10 },
  logs: [{ id: input.id, order_id: input.orderId, log_type: 'outbound_oem', qty: 10, received_date: input.receivedDate }],
  statement: { id: 'server_statement' }, statementCreated: true };
globalThis.fetch = async (url, init) => {
  assert.equal(url, '/api/orders/server_order/ship');
  assert.equal(JSON.parse(init.body).id, input.id);
  return { ok: true, json: async () => ({ result: serverResult }) };
};
assert.equal((await phase1.saveShipment(input)).statement.id, 'server_statement');
await phase1.saveShipment(input);
assert.equal(phase1.getReceiptLogs().filter(r => r.id === input.id).length, 1, 'server retry must replace cache, not add duplicate');
const saved = JSON.stringify(phase1.getReceiptLogs());
globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: { ...serverResult, order: { id: 'wrong' } } }) });
await assert.rejects(phase1.saveShipment(input), /저장 결과/);
assert.equal(JSON.stringify(phase1.getReceiptLogs()), saved);
console.log('atomic shipment cache checks=4 PASS');
