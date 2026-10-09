import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) || null, setItem: (k, v) => mem.set(k, v) };
globalThis.persistenceTest = { fail: false, errors: [], writes: [] };
const out = await build({ entryPoints: [path.join(path.dirname(fileURLToPath(import.meta.url)), 'phase1.ts')],
  bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent', plugins: [{ name: 'db-test', setup(b) {
    b.onResolve({ filter: /(^\.\/db$|^sonner$)/ }, a => ({ path: a.path, namespace: 'db-test' }));
    b.onLoad({ filter: /.*/, namespace: 'db-test' }, () => ({ loader: 'js', contents: `
      const t=globalThis.persistenceTest;
      const save=(table,method,row)=>{t.writes.push({table,method,row});return Promise.resolve({error:t.fail?{message:'test database failure'}:null})};
      export const db={from:table=>({upsert:row=>save(table,'upsert',row),insert:row=>save(table,'insert',row),
        update:row=>{const q={eq:()=>q,select:async()=>{const result=await save(table,'update',row);return {...result,data:result.error?null:[{id:row.id}]}}};return q}})};
      export const toast={error:message=>t.errors.push(message)};` }));
  }}] });
const { phase1, pullPayables } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const t = globalThis.persistenceTest;
const input = { vendorName: 'test', sourceType: 'manual', amountKrw: 1000, dueDate: '2026-11-10' };
t.fail = true;
await assert.rejects(phase1.savePayable(input), { message: 'test database failure' });
assert.equal(phase1.getPayables().length, 0, 'failed save must not become local success');
phase1.addReceiptLog({ orderId: 'test', orderNo: 'test', logType: 'inbound', qty: 2, defectQty: 0, receivedDate: '2026-11-10' });
phase1.addDefectCarryover({ styleNo: 'test', orderNo: 'test', vendorName: 'test', amountKrw: 1, reason: 'test', defectDate: '2026-11-10' });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(t.errors.length, 2, 'receipt and defect database response errors must surface');
t.fail = false;
const p = await phase1.savePayable(input);
t.fail = true;
await assert.rejects(phase1.updatePayable(p.id, { memo: 'must-not-save' }), { message: 'test database failure' });
assert.equal(phase1.getPayables()[0].memo, undefined, 'failed confirmation changed cache');
t.fail = false;
await phase1.updatePayable(p.id, { memo: 'changed' });
await new Promise(resolve => setTimeout(resolve, 0));
const update = t.writes.find(x => x.table === 'payables' && x.method === 'update');
assert.ok(update && !('paid_amount_krw' in update.row) && !('status' in update.row), 'editing metadata must not overwrite payment');
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  assert.equal(body.expectedPaid, 0);
  return { ok: false, json: async () => ({ message: 'stale_payment' }) };
};
await assert.rejects(phase1.recordPayablePayment(p.id, 300), /stale_payment/);
assert.equal(phase1.getPayables()[0].paidAmountKrw, 0, 'failed payment changed cache');
globalThis.fetch = async () => ({ ok: true, json: async () => ({ item: { id: p.id, vendor_name: 'test', source_type: 'manual', amount_krw: 1000,
  paid_amount_krw: 300, status: 'partial', due_date: '2026-11-10' } }) });
await phase1.recordPayablePayment(p.id, 300);
assert.equal(phase1.getPayables()[0].paidAmountKrw, 300);
globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
await pullPayables();
assert.equal(phase1.getPayables().length, 0, 'empty server list must clear stale cache');
console.log('phase1 persistence checks=8 PASS');

const receiptInput = { id: 'test_atomic', orderId: 'test_atomic_order', qty: 5, defectQty: 1,
  receivedDate: '2026-10-09', createPayable: true, disposition: 'deduct' };
const receiptCacheBefore = JSON.stringify(phase1.getReceiptLogs());
globalThis.fetch = async () => ({ ok: false, json: async () => ({ message: 'rollback' }) });
await assert.rejects(phase1.saveKoreaReceipt(receiptInput), /rollback/);
assert.equal(JSON.stringify(phase1.getReceiptLogs()), receiptCacheBefore, 'failed atomic receipt changed cache');
const result = { receipt: { id: 'test_atomic' }, order: { id: 'test_atomic_order', received_qty: 5 },
  logs: [{ id: 'test_atomic', order_id: 'test_atomic_order', log_type: 'inbound', qty: 5, defect_qty: 1, received_date: '2026-10-09' }],
  payable: { id: 'pay_test_atomic', source_id: 'test_atomic', source_type: 'order_receipt', amount_krw: 5000, paid_amount_krw: 0, status: 'pending' },
  defect: { id: 'def_test_atomic', qty: 1, amount_krw: 1000, disposition: 'deduct', status: 'pending' } };
const writesBefore = t.writes.length;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ result }) });
await phase1.saveKoreaReceipt(receiptInput);
await phase1.saveKoreaReceipt(receiptInput);
assert.equal(phase1.getReceiptLogs().filter(r => r.id === 'test_atomic').length, 1);
assert.equal(phase1.getPayables().filter(r => r.id === 'pay_test_atomic').length, 1);
assert.equal(phase1.getDefectCarryovers().filter(r => r.id === 'def_test_atomic').length, 1);
assert.equal(t.writes.length, writesBefore, 'server receipt result triggered duplicate browser DB writes');
console.log('atomic receipt cache checks=5 PASS');
