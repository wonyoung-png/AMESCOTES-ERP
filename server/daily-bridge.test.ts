import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
process.env.PGRST_JWT_SECRET = 'synthetic-bridge-test-only';
process.env.ERP_PRIVATE_MODE = 'true';
const { default: router, validDailyBrand, validDailyGoal } = await import('./daily-bridge');
const { signJwt, verifyJwt } = await import('./auth');

test('브랜드 브리지는 지정 브랜드·달·유한 금액만 허용한다', () => {
  assert.ok(validDailyBrand('lumen')); assert.ok(validDailyBrand('aetaloof'));
  for (const v of ['OEM', '../users', ['lumen'], undefined]) assert.ok(!validDailyBrand(v));
  assert.ok(validDailyGoal({ month: '2026-10', amount: 0 }));
  for (const v of [{month:'2026-13',amount:1}, {month:'2026-01',amount:-1},
    {month:'2026-01',amount:Infinity}, {month:'2026-01',amount:'100'}, null]) assert.ok(!validDailyGoal(v));
});

test('brand bridge requires current active CEO account, not just a signed token', async () => {
  const realFetch = globalThis.fetch;
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  let user: any = null, bridgeReads = 0;
  const downstream: Array<{url: string; init: any}> = [];
  globalThis.fetch = (async (url: string, init: any) => {
    if (String(url).includes('/app_users?')) return { ok: true, json: async () => user ? [user] : [] };
    bridgeReads++; downstream.push({url:String(url),init});
    return { ok: true, json: async () => ({ ok: true }) };
  }) as typeof fetch;
  const exp = Math.floor(Date.now() / 1000) + 60;
  const call = (payload?: Record<string, unknown>, route='summary', body?: any) => realFetch(`http://127.0.0.1:${port}/api/bridge/daily/${route}`,
    { method:body ? 'POST' : 'GET', body:body ? JSON.stringify(body) : undefined,
      headers: {...(payload ? { Authorization: `Bearer ${signJwt(payload)}` } : {}),'Content-Type':'application/json'} });
  try {
    for (const payload of [undefined, { role: 'anon', exp }, { role: 'erp_server', exp }, { email: 'wonyoung@atlm.kr', exp: 1 }]) {
      for (const [route,body] of [['summary',undefined],['brand?brand=lumen',undefined],['goals?brand=lumen',{month:'2026-10',amount:100}]] as const) {
        const r = await call(payload,route,body); assert.equal(r.status, 401); await r.arrayBuffer();
      }
    }
    for (const row of [null, { email: 'wonyoung@atlm.kr', is_active: false }, { email: 'staff@test.invalid', is_active: true }]) {
      user = row;
      const r = await call({ email: row?.email || 'missing@test.invalid', exp });
      assert.equal(r.status, 401); await r.arrayBuffer();
    }
    assert.equal(bridgeReads, 0, 'rejected caller reached brand service');
    user = { id: 'synthetic_ceo', email: 'wonyoung@atlm.kr', name: 'test', role: '대표', is_active: true };
    const payload={email:user.email,exp};
    const allowed = await call(payload);
    assert.equal(allowed.status, 200); assert.deepEqual(await allowed.json(), { daily: { ok: true } });
    assert.equal(bridgeReads, 1);
    assert.equal((await call(payload,'brand?brand=lumen')).status,200);
    assert.ok(downstream.at(-1)!.url.endsWith('/api/dashboard/brand?brand=lumen'));
    assert.equal((await call(payload,'goals?brand=aetaloof',{month:'2026-10',amount:100})).status,200);
    const goal=downstream.at(-1)!;
    assert.equal(verifyJwt(goal.init.headers.Authorization.slice(7))?.email,user.email);
    assert.deepEqual(JSON.parse(goal.init.body),{month:'2026-10',amount:100});
    assert.equal(goal.init.headers['X-Brand'],'aetaloof');
    for (const [route,body] of [['brand?brand=OEM',undefined],['goals?brand=lumen',{month:'2026-13',amount:100}]] as const) {
      assert.equal((await call(payload,route,body)).status,400);
    }
    assert.equal(bridgeReads,3,'invalid input reached brand service');
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});
test('브랜드 조회·목표 변경도 로그인 전에 차단한다', async () => {
  const app=express(); app.use(express.json()); app.use(router);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));
  const port=(server.address() as any).port;
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/bridge/daily/brand?brand=lumen`)).status,401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/bridge/daily/goals?brand=lumen`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  } finally { await new Promise<void>(r=>server.close(()=>r())); }
});
