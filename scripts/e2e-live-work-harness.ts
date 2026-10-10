// Real model + real HTTP + disposable DB. Never import the production entry point.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import sessionRouter from '../server/session';
import workRouter from '../server/work';
import ceoRouter, { ceoHostLock } from '../server/ceo';
import { restAsServer } from '../server/auth';
import { verifyWorkHttp } from './e2e-work-http';

const REST = 'http://erp-e2e-api-20261010:3000';
assert.equal(process.env.ERP_E2E_ISOLATED, '20261010');
assert.equal(process.env.ERP_E2E_LIVE_WORK, '1');
assert.equal(process.env.POSTGREST_URL, REST);
assert.equal(process.env.ERP_PRIVATE_MODE, 'false');
assert.equal(process.env.ROOT_DOMAIN, 'fixture.invalid');
assert.ok(process.env.PGRST_JWT_SECRET && process.env.PGRST_JWT_SECRET.length >= 32);
assert.ok(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'isolated-fixture-not-real');
const network = globalThis.fetch;
let modelCalls = 0;
const phases: Record<string, number> = { classify: 0, answer: 0, report: 0 };
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === 'https://api.anthropic.com') {
    assert.equal(url.pathname, '/v1/messages');
    assert.equal(++modelCalls <= 10, true, 'Live model call budget exceeded');
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : '{}');
    const request = JSON.parse(String(raw));
    const system = String(request.system || '');
    const phase = system.includes('업무 카드로 바꾼다') ? 'classify' : system.includes('팀 감독 에이전트') ? 'report' : 'answer';
    phases[phase]++;
  } else if (url.origin !== REST && url.hostname !== '127.0.0.1') {
    throw new Error('Live harness blocks non-test destinations');
  }
  const inherited = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return network(input, { ...init, redirect: 'error', signal: inherited ? AbortSignal.any([inherited, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
}) as typeof fetch;

async function main() {
  const read = async (path: string) => {
    assert.match(path, /^(app_users|work_cards|notifications|campaigns|team_agent_runs|production_orders|trade_statements|settlements|payables)\?/);
    const response = await restAsServer(path);
    assert.ok(response.ok, 'Isolated DB read failed');
    return response.json();
  };
  for (const table of ['app_users', 'work_cards', 'notifications', 'campaigns', 'team_agent_runs', 'production_orders', 'trade_statements', 'settlements', 'payables']) {
    assert.equal((await read(table + '?select=id&limit=1')).length, 0, 'Fresh empty schema required');
  }
  const password = crypto.randomBytes(24).toString('base64url');
  let hash = 0;
  for (const c of password) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  const password_hash = Math.abs(hash).toString(36);
  const users = [
    { id: 'e2e_boss', email: 'wonyoung@atlm.kr', name: '테스트 대표', role: '대표', team: '대표실', position: '대표' },
    { id: 'e2e_staff', email: 'e2e-staff@test.invalid', name: '테스트 직원', role: '사원', team: '국내 MD', position: '사원' },
    { id: 'e2e_leader', email: 'e2e-leader@test.invalid', name: '테스트 팀장', role: '팀장', team: '국내 MD', position: '팀장' },
    { id: 'e2e_marketing', email: 'e2e-marketing@test.invalid', name: '테스트 마케팅', role: '사원', team: '마케팅', position: '사원' },
    { id: 'e2e_logistics', email: 'e2e-logistics@test.invalid', name: '테스트 물류', role: '사원', team: '물류·CS', position: '사원' },
  ];
  const seed = await restAsServer('app_users', { method: 'POST', body: JSON.stringify(users.map(user => ({ ...user, password_hash, is_active: true, work_profile: '격리 시험 계정. W컨셉 기획전 운영. 참여 결정은 팀장 확인이 필요합니다.' }))) });
  assert.ok(seed.ok, 'Synthetic account seed failed');
  const proof = Buffer.from(JSON.stringify({ p: 'ceo_g', email: users[0].email, exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url');
  const key = crypto.createHash('sha256').update('ceo-console:' + process.env.PGRST_JWT_SECRET).digest();
  const ceoCookie = 'ceo_g=' + proof + '.' + crypto.createHmac('sha256', key).update(proof).digest('base64url');
  const app = express();
  app.use(express.json());
  app.use(ceoHostLock());
  app.use(sessionRouter, workRouter, ceoRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const result = await verifyWorkHttp('http://127.0.0.1:' + address.port, {
      bossEmail: users[0].email, staffEmail: users[1].email, leaderEmail: users[2].email,
      password, read, ceoCookie, liveModel: true,
    });
    console.log(JSON.stringify({ liveWorkChain: result.status, checks: result.checks, modelCalls,
      limitations: result.limitations, ids: result.ids }));
    assert.equal(result.status, 'passed', 'Live work chain incomplete');
    assert.ok(phases.classify >= 4 && phases.answer >= 1 && phases.report >= 2, 'Every live model phase must execute');
    for (const table of ['production_orders', 'trade_statements', 'settlements', 'payables']) {
      assert.equal((await read(table + '?select=id&limit=1')).length, 0, 'Work test wrote financial data');
    }
    console.log(JSON.stringify({ liveModelHttpDatabase: 'PASS', modelCalls, phases, financialWrites: 0,
      google: 'test-signed proof; no real OAuth', browser: 'not exercised', scheduler: 'manual only' }));
  } finally { server.closeAllConnections(); server.close(); }
}
main().catch(() => { console.error('LIVE_WORK_CHAIN_FAILED: inspect safe step results'); process.exitCode = 1; })
  .finally(() => { globalThis.fetch = network; });
