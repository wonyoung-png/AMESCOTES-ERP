import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router, { createExpensePayableRouter, validExpenseDueDate } from './expense-payable.js';

async function serve(app: express.Express, work: (base: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try { await work(`http://127.0.0.1:${(server.address() as any).port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
test('due date rejects invalid calendar values and unbounded input', () => {
  assert.equal(validExpenseDueDate('2024-02-29'), true);
  for (const v of ['2023-02-29', '2026-04-31', '2026-13-01', '1899-01-01', '2026-1-1', null, 20261011])
    assert.equal(validExpenseDueDate(v), false);
});
test('actual router rejects anonymous reads and writes', async () => {
  const app = express(); app.use(express.json()); app.use(router);
  await serve(app, async base => {
    for (const method of ['GET', 'POST']) assert.equal((await fetch(base + '/api/expenses/a/payable', { method })).status, 401);
  });
});
test('non-CEO representative email is rejected before either inspection or link RPC', async () => {
  let email = 'other@example.invalid'; let calls = 0;
  const app = express(); app.use(express.json());
  app.use(createExpensePayableRouter({
    auth: () => ((req: any, _res: any, next: any) => {
      req.user = { id: 'fixture-representative', role: '대표', email }; next();
    }),
    write: async () => { calls++; return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; },
  }));
  await serve(app, async base => {
    const get = () => fetch(base + '/api/expenses/a/payable');
    const post = () => fetch(base + '/api/expenses/a/payable', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: '2026-10-12' }),
    });
    assert.equal((await get()).status, 403); assert.equal((await post()).status, 403); assert.equal(calls, 0);
    email = 'WONYOUNG@ATLM.KR';
    assert.equal((await get()).status, 200); assert.equal((await post()).status, 200); assert.equal(calls, 2);
    email = '';
    assert.equal((await get()).status, 403); assert.equal(calls, 2);
  });
});
test('endpoint passes authenticated actor only, rejects bad input, fails closed and maps SQL guards', async () => {
  const calls: any[] = []; let failure = '';
  const app = express(); app.use(express.json());
  app.use(createExpensePayableRouter({
    auth: () => ((req: any, _res: any, next: any) => { req.user = { id: 'session-actor' }; next(); }),
    write: async (path, init) => {
      calls.push({ path, body: JSON.parse(String(init?.body)) });
      return { ok: !failure, status: failure ? 400 : 200,
        json: async () => ({ expenseId: 'a', payable: { id: 'same-payable' } }), text: async () => failure };
    },
  }));
  await serve(app, async base => {
    const post = (body: any) => fetch(base + '/api/expenses/a/payable', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal((await post({ dueDate: '2026-04-31' })).status, 400); assert.equal(calls.length, 0);
    assert.equal((await post({ dueDate: '2026-10-12', actorId: 'forged', amountKrw: 1, approval: 'approved' })).status, 200);
    assert.deepEqual(calls[0], { path: 'rpc/expense_payable_action', body: {
      p_id: 'a', p_actor_id: 'session-actor', p_action: 'link', p_due_date: '2026-10-12',
    } });
    assert.equal((await fetch(base + '/api/expenses/a/payable')).status, 200);
    assert.equal(calls[1].body.p_action, 'inspect'); assert.equal(calls[1].body.p_due_date, null);
    for (const [error, status] of [['forbidden', 403], ['expense_not_approved', 409], ['expense_snapshot_mismatch', 409],
      ['expense_payable_conflict', 409], ['expense_mapping_required', 409], ['expense_not_found', 404], ['missing function', 503]] as const) {
      failure = error; assert.equal((await post({ dueDate: '2026-10-12' })).status, status);
    }
  });
});
