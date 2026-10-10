import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { readFileSync } from 'node:fs';

process.env.PGRST_JWT_SECRET = 'work-confirm-synthetic-test-secret';
process.env.POSTGREST_URL = 'http://work-confirm.fixture.invalid';
process.env.ERP_PRIVATE_MODE = 'false';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
const { default: router } = await import('./work');
const { signJwt } = await import('./auth');

// Real Express/auth/confirm handler; DB/RPC responses are fixtures, not SQL execution.
for (const scenario of ['stale', 'missing_version', 'current', 'invalid'] as const) {
  test(`confirm version: ${scenario}`, async () => {
    const originalFetch = globalThis.fetch;
    const app = express(); app.use(express.json()); app.use(router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const member = { id: 'author', email: 'fixture@test.invalid', name: 'fixture', role: '사원', position: '사원', team: '국내 MD', is_active: true };
    const version = '2026-10-10T00:00:00.123456+00:00';
    const card = { id: 'wc_confirm_version', created_by: member.id, team: member.team, kind: 'schedule', status: 'open',
      updated_at: scenario === 'missing_version' ? null : version,
      parsed: { title: 'synthetic schedule', workspace: 'LUMEN', channel: 'W컨셉', startDate: '2026-10-20', discountRate: 20 } };
    let calls = 0;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, 'http://work-confirm.fixture.invalid', 'No external requests');
      if (url.pathname === '/app_users') return new Response(JSON.stringify([member]));
      if (url.pathname === '/work_cards') return new Response(JSON.stringify([card]));
      if (url.pathname === '/rpc/confirm_schedule_card') {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.p_expected_updated_at, version, 'Use the server snapshot, not the client version');
        assert.equal(body.p_id, card.id);
        if (scenario === 'stale') return new Response(JSON.stringify({ code: 'PT409', message: 'stale_work_version' }), { status: 409 });
        if (scenario === 'invalid') return new Response(JSON.stringify({ code: 'P0001', message: 'channel_required' }), { status: 400 });
        assert.deepEqual(body.p_shared, []);
        return new Response(JSON.stringify({ table: 'campaigns', id: 'cmp_fixture' }));
      }
      // Success may request the real syncSoon implementation's member list; no links exist.
      if (url.pathname === '/gcal_links') return new Response('[]');
      throw new Error('Unexpected fixture request ' + url.pathname);
    }) as typeof fetch;
    try {
      const port = (server.address() as { port: number }).port;
      const response = await originalFetch(`http://127.0.0.1:${port}/api/work/${card.id}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + signJwt({ email: member.email, exp: Math.floor(Date.now() / 1000) + 60 }) },
        body: JSON.stringify({ shareTeams: [], expectedUpdatedAt: '2099-01-01T00:00:00Z' }),
      });
      const body = await response.json();
      assert.equal(response.status, scenario === 'current' ? 200 : scenario === 'invalid' ? 400 : 409, JSON.stringify(body));
      if (scenario === 'stale' || scenario === 'missing_version') assert.equal(body.error, 'stale_work_version');
      assert.equal(calls, scenario === 'missing_version' ? 0 : 1);
      if (scenario === 'current') assert.deepEqual(body.ref, { table: 'campaigns', id: 'cmp_fixture' });
    } finally {
      globalThis.fetch = originalFetch;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}

test('forward SQL requires a locked version and disables the legacy entry point (source check only)', () => {
  const sql = readFileSync(new URL('../supabase/migration_schedule_confirm_version.sql', import.meta.url), 'utf8');
  const lock = sql.indexOf('where id = p_id for update');
  const check = sql.indexOf('v_card.updated_at is distinct from p_expected_updated_at');
  const insert = sql.indexOf('insert into public.campaigns');
  assert.ok(lock >= 0 && check > lock && insert > check);
  assert.match(sql, /p_expected_updated_at\s+timestamptz\s*\)/);
  assert.match(sql, /p_expected_updated_at is null/);
  assert.match(sql, /errcode = 'PT409', message = 'stale_work_version'/);
  assert.doesNotMatch(sql, /errcode\s*=\s*'40001'/);
  const legacy = sql.slice(sql.lastIndexOf('create or replace function public.confirm_schedule_card('));
  assert.match(legacy, /raise exception using errcode = '22023', message = 'expected_work_version_required'/);
  assert.doesNotMatch(legacy, /insert into|update public|perform public/);
  assert.match(sql, /revoke all on function public.confirm_schedule_card\(text, jsonb, text, text\[\]\) from public, anon, erp_server/);
  assert.match(sql, /revoke all on function public.confirm_schedule_card\(text, jsonb, text, text\[\], timestamptz\) from public, anon/);
  assert.match(sql, /grant execute on function public.confirm_schedule_card\(text, jsonb, text, text\[\], timestamptz\) to erp_server/);
  assert.doesNotMatch(sql, /security definer|alter table|drop table/i);
});
