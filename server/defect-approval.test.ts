import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router, { createDefectApprovalRouter, validDefectApproval } from './defect-approval.js';

const body = { payableId: 'pay_fixture', amount: 100, reason: 'Fixture confirmation', factoryResponsible: true,
  expectedDefect: { id: 'def_fixture' }, expectedPayable: { id: 'pay_fixture' } };
test('bounded confirmation validation', () => {
  assert.equal(validDefectApproval(body), true);
  for (const patch of [{ amount: 0 }, { amount: -1 }, { amount: 0.5 }, { amount: Infinity }, { amount: '100' },
    { amount: Number.MAX_SAFE_INTEGER + 1 }, { reason: ' ' }, { reason: 'x'.repeat(1001) }, { factoryResponsible: false },
    { payableId: 'a,b' }, { expectedDefect: null }, { expectedPayable: [] }])
    assert.ok(!validDefectApproval({ ...body, ...patch }));
});
async function serve(app: express.Express, work: (base: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try { await work(`http://127.0.0.1:${(server.address() as any).port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
test('real router rejects anonymous reads and approval', async () => {
  const app = express(); app.use(express.json()); app.use(router);
  await serve(app, async base => {
    assert.equal((await fetch(base + '/api/defects/approval-context')).status, 401);
    assert.equal((await fetch(base + '/api/defects/def_fixture/approve', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 401);
  });
});
test('role checked before write, actor from session, migration unavailable and SQL conflicts visible', async () => {
  let role = '사원'; let failure = ''; const calls: any[] = [];
  const app = express(); app.use(express.json()); app.use(createDefectApprovalRouter({
    auth: () => (req: any, _res: any, next: any) => { req.user = { id: 'fixture-boss', role, email:'wonyoung@atlm.kr' }; next(); },
    rows: async () => [],
    write: async (path, init) => { calls.push({ path, body: JSON.parse(String(init?.body)) });
      return { ok: !failure, status: failure ? 400 : 200, text: async () => failure,
        json: async () => path.endsWith('version') ? 1 : { approvedAmount: 100, retry: true } }; },
  }));
  await serve(app, async base => {
    const post = (data: any = body) => fetch(base + '/api/defects/def_fixture/approve', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await post()).status, 403); assert.equal(calls.length, 0);
    assert.equal((await fetch(base + '/api/defects/approval-context')).status, 403); assert.equal(calls.length, 0);
    role = '대표'; assert.equal((await post({ ...body, actorId: 'forged' })).status, 200);
    assert.equal(calls[0].body.p_actor_id, 'fixture-boss');
    assert.equal((await post({ ...body, amount: -1 })).status, 400); assert.equal(calls.length, 1);
    failure = 'stale_payable'; assert.equal((await post()).status, 409);
    failure = 'PGRST202 missing function'; assert.equal((await post()).status, 503);
    assert.equal((await fetch(base + '/api/defects/approval-context')).status, 503);
    failure = ''; const context = await fetch(base + '/api/defects/approval-context');
    assert.equal((await context.json()).canApprove, true);
  });
});
