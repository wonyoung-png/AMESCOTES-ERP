import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

process.env.PGRST_JWT_SECRET = 'reply-boundary-synthetic-test-secret';
process.env.POSTGREST_URL = 'http://reply-boundary.fixture.invalid';
process.env.ERP_PRIVATE_MODE = 'false';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
const { default: router } = await import('./work');
const { signJwt } = await import('./auth');

for (const action of ['reply', 'kind', 'cancel'] as const) for (const scenario of ['leader_for_boss', 'leader_for_staff', 'boss', 'author'] as const) {
  test(`확인 요청 결정권 실 API 검사: ${action}/${scenario}`, async () => {
    const originalFetch = globalThis.fetch;
    const team = '국내 MD';
    const members = [
      { id: 'boss', email: 'wonyoung@atlm.kr', name: '대표', role: '대표', team, is_active: true },
      { id: 'leader', email: 'leader@test.invalid', name: '팀장', role: '팀장', position: '팀장', team, is_active: true },
      { id: 'author', email: 'author@test.invalid', name: '작성자', role: '사원', team, is_active: true },
      { id: 'staff', email: 'staff@test.invalid', name: '담당자', role: '사원', team, is_active: true },
    ];
    const me = members.find(m => m.id === (scenario.startsWith('leader') ? 'leader' : scenario))!;
    const card = { id: 'card', created_by: 'author', assignee_id: scenario === 'leader_for_staff' ? 'staff' : 'boss',
      kind: 'request_check', team, status: 'open', updated_at: '2026-10-11T00:00:00Z' };
    let patches = 0;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, 'http://reply-boundary.fixture.invalid');
      if (url.pathname === '/app_users') {
        const email = url.searchParams.get('email')?.replace(/^eq\./, '');
        return new Response(JSON.stringify(email ? members.filter(m => m.email === email) : members));
      }
      if (url.pathname === '/work_cards') {
        if (init?.method === 'PATCH') { patches++; return new Response(JSON.stringify([{ ...card, status: 'done' }])); }
        return new Response(JSON.stringify([card]));
      }
      if (url.pathname === '/rpc/deliver_work_notifications') return new Response(JSON.stringify({ delivered: 0, pending: false }));
      throw new Error('Unexpected fixture request ' + url.pathname);
    }) as typeof fetch;
    const app = express(); app.use(express.json()); app.use(router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const res = await originalFetch(`http://127.0.0.1:${port}/api/work/card/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + signJwt({ email: me.email, exp: Math.floor(Date.now() / 1000) + 60 }) }, body: JSON.stringify({ text: '합성 검수 답변', kind: 'todo' }),
      });
      const allowed = scenario === 'leader_for_staff' || scenario === 'boss';
      assert.equal(res.status, allowed ? 200 : 403, JSON.stringify(await res.json()));
      assert.equal(patches, allowed ? 1 : 0);
    } finally {
      globalThis.fetch = originalFetch;
      await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    }
  });
}
