import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('./dbQueries.ts', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('export async function upsertSample('), source.indexOf('export async function deleteSample('));
const compiled = ts.transpileModule(body.replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(existing, affected = 1) {
  const calls = [];
  let mode = 'read';
  const query = {
    select() { return query; },
    eq(key, value) { calls.push(['eq', key, value]); return query; },
    maybeSingle: async () => ({ data: existing ? { id: 's1' } : null, error: null }),
    update(row) { mode = 'update'; calls.push(['update', row]); return query; },
    insert(row) { mode = 'insert'; calls.push(['insert', row]); return query; },
    then(resolve, reject) { return Promise.resolve({ data: mode === 'update' && affected ? [{ id: 's1' }] : [], error: null }).then(resolve, reject); },
  };
  const db = { from: () => query };
  return { calls, save: new Function('db', 'filterForTable', `${compiled}; return upsertSample;`)(db, (_, row) => row) };
}
test('existing accepted sample uses versioned UPDATE, never INSERT/upsert', async () => {
  const { save, calls } = setup(true);
  await save({ id: 's1', stage: '최종승인', memo: '추가 메모', workflowVersion: 3 });
  assert.equal(calls.filter(c => c[0] === 'update').length, 1);
  assert.equal(calls.filter(c => c[0] === 'insert').length, 0);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'workflow_version' && c[2] === 3));
});
test('new sample inserts; missing/stale existing row is not re-created', async () => {
  const created = setup(false); await created.save({ id: 's1' });
  assert.equal(created.calls.filter(c => c[0] === 'insert').length, 1);
  const stale = setup(true, 0);
  await assert.rejects(stale.save({ id: 's1', workflowVersion: 1 }), /샘플이 변경/);
  assert.equal(stale.calls.filter(c => c[0] === 'insert').length, 0);
});
