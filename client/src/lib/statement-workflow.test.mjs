import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: ['client/src/lib/statement-workflow.ts'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'statement-db', setup(b) {
  b.onResolve({ filter: /^\.\/db$/ }, a => ({ path: a.path, namespace: 'test-db' }));
  b.onLoad({ filter: /.*/, namespace: 'test-db' }, () => ({ contents: 'export const db={};', loader: 'js' }));
}}] });
const { statementAmount, statementUnitPrice, saveStatementBilling } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
const queryBundle = await build({ entryPoints: ['client/src/lib/tradeStatementQueries.ts'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'legacy-db', setup(b) {
  b.onResolve({ filter: /^\.\/db$/ }, a => ({ path: a.path, namespace: 'test-db' }));
  b.onLoad({ filter: /.*/, namespace: 'test-db' }, () => ({ contents: 'export const db={};', loader: 'js' }));
}}] });
const { fromRow } = await import('data:text/javascript;base64,' + Buffer.from(queryBundle.outputFiles[0].text).toString('base64'));
const legacyLine = { description: 'test', qty: 1, unitPrice: 100, taxType: '과세', taxRate: 10, memo: '현장 접수 납품 test' };
assert.ok(Math.abs(statementAmount(fromRow({ lines: [legacyLine] })) - 110) < 0.000001);
assert.equal(legacyLine.taxRate, 10, 'legacy source remains unchanged');
assert.equal(fromRow({ lines: [{ ...legacyLine, memo: 'other source' }] }).lines[0].taxRate, 10, 'unknown rate is not guessed');
const statement = { id: 'test_statement', statementNo: '', vendorId: 'test_buyer', vendorName: 'test', vendorCode: 'TEST', projectNo: 'test_project', workspace: 'OEM', issueDate: '2026-10-10', createdAt: '2026-10-10T00:00:00Z', status: '청구완료', lines: [{ id: 'test_line', description: 'test product', qty: 10, unitPrice: 100, taxType: '과세', taxRate: 0.1 }] };
assert.equal(statementAmount(statement), 1100);
assert.equal(statementAmount({ lines: [...statement.lines, { ...statement.lines[0], taxType: '면세' }] }), 2100);
assert.equal(statementUnitPrice({ deliveryPrice: 200, salePriceKrw: 999 }), 200);
assert.equal(statementUnitPrice({ salePriceKrw: 999 }), 0);
for (const line of [{ qty: -1 }, { unitPrice: NaN }, { taxRate: Infinity }, { description: ' ' }]) assert.throws(() => statementAmount({ lines: [{ ...statement.lines[0], ...line }] }));
const row = { id: statement.id, statement_no: '202610-TEST-001', vendor_id: statement.vendorId, lines: statement.lines,
  status: statement.status, updated_at: '2026-10-10T01:00:00Z', project_no: 'test_project', workspace: 'OEM' };
const settlement = { id: 'stl_test_statement', invoice_no: row.statement_no, buyer_id: row.vendor_id,
  billed_amount_krw: 1100, collected_amount_krw: 300, due_date: '2026-12-01', status: '일부수금' };
let calls = 0;
const send = async (url, init) => {
  calls++;
  assert.equal(url, '/api/statements/save-billing'); assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'include');
  const input = JSON.parse(init.body);
  assert.equal(input.statement.id, statement.id); assert.equal(input.expectedUpdatedAt, statement.updatedAt || null);
  return { ok: true, json: async () => ({ result: { statement: row, settlement } }) };
};
const result = await saveStatementBilling(statement, '2026-10-10', send);
assert.equal(calls, 1, 'billing must use a single server request');
assert.equal(result.statement.statementNo, row.statement_no);
assert.equal(result.statement.updatedAt, row.updated_at);
assert.equal(result.settlement.collectedAmountKrw, 300);
assert.equal(result.settlement.dueDate, '2026-12-01');
await saveStatementBilling(statement, '2026-10-10', send);
assert.equal(calls, 2, 'retry must reuse the original statement id');
const draft = await saveStatementBilling({ ...statement, status: '미청구' }, '2026-10-10',
  async () => ({ ok: true, json: async () => ({ result: { statement: { ...row, status: '미청구' }, settlement: null } }) }));
assert.equal(draft.settlement, null);
for (const message of ['rollback', 'stale_statement', 'duplicate_settlement', 'collection_required']) {
  await assert.rejects(saveStatementBilling(statement, '2026-10-10',
    async () => ({ ok: false, json: async () => ({ message }) })), new RegExp(message));
}
await assert.rejects(saveStatementBilling(statement, '2026-10-10', async () => { throw new Error('network failure'); }), /network failure/);
await assert.rejects(saveStatementBilling(statement, '2026-10-10', async () => ({ ok: true, json: async () => { throw new Error('not JSON'); } })), /저장 결과/);
for (const badResult of [{ statement: row, settlement: null }, { statement: { ...row, id: 'wrong' }, settlement },
  { statement: row, settlement: { ...settlement, invoice_no: 'wrong' } }]) {
  await assert.rejects(saveStatementBilling(statement, '2026-10-10', async () => ({ ok: true, json: async () => ({ result: badResult }) })), /저장 결과/);
}
console.log('statement atomic API regression PASS: one request, server numbering, versions, result validation and failure/retry');
