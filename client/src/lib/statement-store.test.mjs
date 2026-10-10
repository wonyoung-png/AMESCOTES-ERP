import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v) };
globalThis.statementStoreTest = { fail: false, calls: [] };
const out = await build({ entryPoints: ['client/src/lib/store.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [{ name: 'statement-store', setup(b) {
  b.onResolve({ filter: /^\.\/statement-workflow$/ }, a => ({ path: a.path, namespace: 'test-workflow' }));
  b.onLoad({ filter: /.*/, namespace: 'test-workflow' }, () => ({ loader: 'js', contents: `
    export async function saveStatementBilling(s,date) {
      const t=globalThis.statementStoreTest; t.calls.push({s,date});
      if(t.fail) throw new Error('stale_statement');
      return {statement:{...s,statementNo:'SERVER-001',updatedAt:'server-version'},settlement:null};
    }` }));
  b.onResolve({ filter: /^\.\/db$/ }, a => ({ path: a.path, namespace: 'test-db' }));
  b.onLoad({ filter: /.*/, namespace: 'test-db' }, () => ({ loader: 'js', contents: 'export const db={from(){throw new Error("unexpected bulk write")}};' }));
}}] });
const { store } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const untouched = { id: 'other', status: '청구완료', updatedAt: 'old' };
const original = { id: 'edited', issueDate: '2026-10-10', memo: 'original', updatedAt: 'old-version' };
store.hydrateTradeStatements([untouched, original]);
globalThis.statementStoreTest.fail = true;
await assert.rejects(store.updateTradeStatement(original.id, { memo: 'changed' }), /stale_statement/);
assert.equal(store.getTradeStatements().find(s => s.id === original.id).memo, 'original');
assert.equal(globalThis.statementStoreTest.calls[0].s.updatedAt, 'old-version');
globalThis.statementStoreTest.fail = false;
const saved = await store.updateTradeStatement(original.id, { memo: 'changed' });
assert.equal(saved.updatedAt, 'server-version');
assert.deepEqual(store.getTradeStatements().find(s => s.id === untouched.id), untouched);
await store.addTradeStatement({ id: 'new', issueDate: '2026-10-10', statementNo: '' });
assert.deepEqual(globalThis.statementStoreTest.calls.map(c => c.s.id), ['edited', 'edited', 'new']);
assert.equal(store.getTradeStatements().find(s => s.id === 'new').statementNo, 'SERVER-001');
const source = readFileSync('client/src/pages/TradeStatement.tsx', 'utf8');
assert.match(source, /issuedAt: taxForm\.issuedAt \|\| new Date\(\)\.toISOString\(\)/);
assert.match(source, /localDate\(new Date\(invoiceData\.issuedAt!\)\)/);
assert.match(source.slice(source.indexOf('const openTaxModal'), source.indexOf('// 계산서 발행 완료')), /issuedAt: new Date\(\)\.toISOString\(\)/);
for (const page of ['ProductionOrders', 'SampleManagement']) {
  const text = readFileSync(`client/src/pages/${page}.tsx`, 'utf8');
  assert.match(text, /if \(billingSaveLock\.current\) return;/);
  assert.match(text, /finally \{ billingSaveLock\.current = false; setBillingSaving\(false\); \}/);
  assert.match(text, /disabled=\{billingSaving/);
}
const production = readFileSync('client/src/pages/ProductionOrders.tsx', 'utf8');
assert.equal((production.match(/colorQtyList\.filter\(cq => cq\.qty > 0\)/g) || []).length, 2);
assert.match(production, /if \(billQty <= 0\)/);
console.log('statement store PASS: changed row only, CAS version, failed save cache unchanged, server number, stable tax retry timestamp/date');
