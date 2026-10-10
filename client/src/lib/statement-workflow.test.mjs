import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: ['client/src/lib/statement-workflow.ts'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'statement-db', setup(b) {
  b.onResolve({ filter: /^\.\/db$/ }, a => ({ path: a.path, namespace: 'test-db' }));
  b.onLoad({ filter: /.*/, namespace: 'test-db' }, () => ({ contents: 'export const db={};', loader: 'js' }));
}}] });
const { statementAmount, statementUnitPrice, saveStatementBilling } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
const statement = { id: 'test_statement', statementNo: '202610-TEST-001', vendorId: 'test_buyer', vendorName: 'test', vendorCode: 'TEST', projectNo: 'test_project', workspace: 'OEM', issueDate: '2026-10-10', createdAt: '2026-10-10T00:00:00Z', status: '청구완료', lines: [{ id: 'test_line', description: 'test product', qty: 10, unitPrice: 100, taxType: '과세', taxRate: 0.1 }] };
function fixture() {
  const state = { trade_statements: [], settlements: [], writes: [], fail: '', stale: false };
  const client = { from(table) {
    let op = 'select', value, options, filters = [];
    const run = () => {
      if (state.fail === table + ':' + op) return { data: null, error: new Error('test failure') };
      let rows = state[table].filter(row => filters.every(([key, val]) => row[key] === val));
      if (op !== 'select') {
        state.writes.push({ table, op, value: structuredClone(value), filters: [...filters] });
        if (op === 'update') {
          if (state.stale) rows = [];
          rows.forEach(row => Object.assign(row, value));
        } else {
          let row = state[table].find(row => row.id === value.id);
          if (row && !options?.ignoreDuplicates) Object.assign(row, value);
          if (!row) { row = structuredClone(value); state[table].push(row); }
          rows = [row];
        }
      }
      return { data: rows, error: null };
    };
    const q = { select() { return q; }, eq(key, val) { filters.push([key, val]); return q; },
      upsert(v, opts) { op = 'upsert'; value = v; options = opts; return q; }, update(v) { op = 'update'; value = v; return q; },
      async single() { const r = run(); return r.error ? r : r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: new Error('no single row') }; },
      async maybeSingle() { const r = run(); return r.error ? r : { data: r.data[0] || null, error: null }; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); } };
    return q;
  } };
  return { state, client };
}
const paid = { id: 'legacy_settlement', invoice_no: statement.statementNo, buyer_id: 'test_buyer', billed_amount_krw: 1100, collected_amount_krw: 300, due_date: '2026-12-01', collected_date: '2026-10-10', status: '일부수금' };
assert.equal(statementAmount(statement), 1100);
assert.equal(statementAmount({ lines: [...statement.lines, { ...statement.lines[0], taxType: '면세' }] }), 2100);
assert.equal(statementUnitPrice({ deliveryPrice: 200, salePriceKrw: 999 }), 200);
assert.equal(statementUnitPrice({ salePriceKrw: 999 }), 0);
for (const line of [{ qty: -1 }, { unitPrice: NaN }, { taxRate: Infinity }, { description: ' ' }]) assert.throws(() => statementAmount({ lines: [{ ...statement.lines[0], ...line }] }));
{
  const { state, client } = fixture();
  const result = await saveStatementBilling({ ...statement, status: '미청구', lines: [{ ...statement.lines[0], unitPrice: 0 }] }, '2026-10-10', client);
  assert.equal(result.settlement, null); assert.equal(state.settlements.length, 0);
}
{
  const { state, client } = fixture();
  const result = await saveStatementBilling(statement, '2026-10-10', client);
  assert.equal(result.settlement.billedAmountKrw, 1100);
  assert.equal(result.settlement.dueDate, '2026-11-09');
  assert.equal(result.settlement.projectNo, 'test_project');
  state.settlements[0].collected_amount_krw = 300;
  await saveStatementBilling(statement, '2026-10-11', client);
  assert.equal(state.settlements.length, 1);
  assert.equal(state.settlements[0].collected_amount_krw, 300);
  assert.equal(state.settlements[0].invoice_date, '2026-10-10');
}
{
  const { state, client } = fixture(); state.settlements.push(structuredClone(paid));
  const result = await saveStatementBilling({ ...statement, lines: [{ ...statement.lines[0], qty: 20 }] }, '2026-10-11', client);
  assert.equal(result.settlement.billedAmountKrw, 2200);
  assert.equal(result.settlement.collectedAmountKrw, 300);
  assert.equal(result.settlement.dueDate, '2026-12-01');
  const patch = state.writes.find(w => w.table === 'settlements').value;
  assert.ok(!('collected_amount_krw' in patch) && !('status' in patch) && !('due_date' in patch));
}
{
  const { state, client } = fixture(); state.fail = 'trade_statements:upsert';
  await assert.rejects(saveStatementBilling(statement, '2026-10-10', client), /test failure/);
  assert.equal(state.settlements.length, 0);
}
{
  const { state, client } = fixture(); state.fail = 'settlements:upsert';
  await assert.rejects(saveStatementBilling(statement, '2026-10-10', client), /명세표는 저장됐지만/);
  assert.equal(state.trade_statements.length, 1); assert.equal(state.settlements.length, 0);
  state.fail = ''; await saveStatementBilling(statement, '2026-10-10', client);
  assert.equal(state.trade_statements.length, 1); assert.equal(state.settlements.length, 1);
}
for (const change of [{ status: '미청구' }, { status: '수금완료' }, { lines: [{ ...statement.lines[0], unitPrice: 0 }] }, { lines: [{ ...statement.lines[0], qty: 1 }] }]) {
  const { state, client } = fixture(); state.settlements.push(structuredClone(paid));
  await assert.rejects(saveStatementBilling({ ...statement, ...change }, '2026-10-10', client));
  assert.equal(state.writes.length, 0);
}
{
  const { state, client } = fixture(); state.settlements.push(structuredClone(paid), { ...paid, id: 'duplicate' });
  await assert.rejects(saveStatementBilling(statement, '2026-10-10', client), /중복/); assert.equal(state.writes.length, 0);
}
{
  const { state, client } = fixture(); state.settlements.push(structuredClone(paid)); state.stale = true;
  await assert.rejects(saveStatementBilling(statement, '2026-10-10', client), /미수금 연결에 실패/);
  assert.equal(state.settlements[0].collected_amount_krw, 300);
}
{
  const { state, client } = fixture(); state.trade_statements.push({ id: statement.id, statement_no: statement.statementNo, vendor_id: 'test_buyer', lines: statement.lines, tax_invoice: { issued: true } });
  await assert.rejects(saveStatementBilling({ ...statement, taxInvoice: { issued: true, totalAmount: 2200 }, lines: [{ ...statement.lines[0], qty: 20 }] }, '2026-10-10', client), /정정 절차/);
  assert.equal(state.writes.length, 0);
}
{
  const { state, client } = fixture(); state.trade_statements.push({ id: 'other', statement_no: statement.statementNo });
  await assert.rejects(saveStatementBilling(statement, '2026-10-10', client), /번호가 이미/); assert.equal(state.writes.length, 0);
}
{
  const { state, client } = fixture();
  await assert.rejects(saveStatementBilling({ ...statement, taxInvoice: { issued: true, totalAmount: NaN } }, '2026-10-10', client), /계산서 금액/); assert.equal(state.writes.length, 0);
}
console.log('statement workflow regression PASS: billed creation, price source, partial failure/retry, payment preservation, status guards, duplicates and stale payment');
