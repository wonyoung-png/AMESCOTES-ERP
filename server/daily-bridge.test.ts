import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.PGRST_JWT_SECRET = 'synthetic-bridge-test-only';
process.env.ERP_PRIVATE_MODE = 'true';
const { default: router } = await import('./daily-bridge');
const { signJwt } = await import('./auth');

test('brand bridge requires current active CEO account, not just a signed token', async () => {
  const realFetch = globalThis.fetch;
  const app = express(); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  let user: any = null, bridgeReads = 0;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('/app_users?')) return { ok: true, json: async () => user ? [user] : [] };
    bridgeReads++;
    return { ok: true, json: async () => ({ ok: true }) };
  }) as typeof fetch;
  const exp = Math.floor(Date.now() / 1000) + 60;
  const call = (payload?: Record<string, unknown>) => realFetch(`http://127.0.0.1:${port}/api/bridge/daily/summary`,
    { headers: payload ? { Authorization: `Bearer ${signJwt(payload)}` } : {} });
  try {
    for (const payload of [undefined, { role: 'anon', exp }, { role: 'erp_server', exp }, { email: 'wonyoung@atlm.kr', exp: 1 }]) {
      const r = await call(payload); assert.equal(r.status, 401); await r.arrayBuffer();
    }
    for (const row of [null, { email: 'wonyoung@atlm.kr', is_active: false }, { email: 'staff@test.invalid', is_active: true }]) {
      user = row;
      const r = await call({ email: row?.email || 'missing@test.invalid', exp });
      assert.equal(r.status, 401); await r.arrayBuffer();
    }
    assert.equal(bridgeReads, 0, 'rejected caller reached brand service');
    user = { id: 'synthetic_ceo', email: 'wonyoung@atlm.kr', name: 'test', role: '대표', is_active: true };
    const allowed = await call({ email: user.email, exp });
    assert.equal(allowed.status, 200); assert.deepEqual(await allowed.json(), { daily: { ok: true } });
    assert.equal(bridgeReads, 1);
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});
