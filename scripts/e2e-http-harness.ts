// Disposable-stack entry point, not an application route or production entry point.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import sessionRouter from '../server/session';
import workRouter from '../server/work';
import ceoRouter, { ceoHostLock } from '../server/ceo';
import receiptRouter from '../server/receipt-workflow';
import payableRouter from '../server/payable-payment';
import { rest, restAsServer, requireUser } from '../server/auth';
import { verifyFinanceHttp } from './e2e-finance-http';
import { verifyWorkHttp, workHttpLlmCases } from './e2e-work-http';

const REST = 'http://erp-e2e-api-20261010:3000';
assert.equal(process.env.ERP_E2E_ISOLATED, '20261010');
assert.equal(process.env.POSTGREST_URL, REST);
assert.equal(process.env.ERP_PRIVATE_MODE, 'false'); // Test members only; production remains true.
assert.ok(process.env.PGRST_JWT_SECRET && process.env.PGRST_JWT_SECRET.length >= 32);
const originalFetch = globalThis.fetch;
const forbidden: string[] = [];
let modelCalls = 0;
let evidenceChecks = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === 'https://api.anthropic.com') {
    modelCalls++;
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : '{}');
    const request = JSON.parse(String(raw));
    const message = String(request.messages?.[0]?.content || '');
    let output: string;
    if (String(request.system).includes('업무 카드로 바꾼다')) {
      const example = Object.values(workHttpLlmCases('2026-10-20')).find(c => c.text === message);
      assert.ok(example, 'Unknown model fixture input');
      output = JSON.stringify(example.response);
    } else if (String(request.system).includes('팀 감독 에이전트')) {
      assert.match(message, /확정.*discountRate[^\d]*20/s, 'Final confirmed payload missing from team report prompt');
      assert.match(message, /다른 팀에서 공유받은 근거/);
      evidenceChecks++;
      output = JSON.stringify({ headline: '10/20 확정 20% · 준비 확인 필요', summary: '· 공유된 일정은 10/20 확정 20%입니다.\n· 공유는 팀 준비 완료 근거가 아닙니다.', needs: [] });
    } else {
      assert.match(message, /확정.*discountRate[^\d]*20/s, 'Final confirmed payload missing from answer prompt');
      evidenceChecks++;
      output = '업무 기록과 확정 일정에 따르면 2026-10-20 W컨셉 파니에 토트 20%입니다. 준비 완료 근거는 아직 확인되지 않았습니다.';
    }
    return new Response(JSON.stringify({ id: 'fixture-' + modelCalls, type: 'message', role: 'assistant', model: request.model, content: [{ type: 'text', text: output }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  // No production DB, real model, Google, SMTP, or PMS network is allowed.
  if (url.origin !== REST && url.hostname !== '127.0.0.1') {
    forbidden.push(url.origin);
    throw new Error('Isolated harness blocks external network');
  }
  return originalFetch(input, { ...init, redirect: 'error' });
}) as typeof fetch;

const password = 'E2E-only-20261010!';
function simpleHash(value: string) { let h = 0; for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0; return Math.abs(h).toString(36); }
const fixtures = {
  bossEmail: 'wonyoung@atlm.kr', staffEmail: 'e2e-staff@test.invalid', leaderEmail: 'e2e-leader@test.invalid', password,
  read: async (path: string) => {
    assert.ok(/^(work_cards|notifications|campaigns|team_agent_runs|production_orders|trade_statements|settlements|payables)\?/.test(path), 'fixture read table not allowed');
    const r = await restAsServer(path);
    assert.ok(r.ok, `fixture read ${path}: ${r.status}`);
    return r.json();
  },
  ceoCookie: '',
};

async function main() {
  const resumeWork = process.env.ERP_E2E_RESUME_WORK === '1';
  const empty = await restAsServer('app_users?select=id');
  assert.ok(empty.ok, 'isolated REST not ready');
  const existing = await empty.json();
  if (resumeWork) assert.deepEqual(existing.map((p: any) => p.id).sort(), ['e2e_boss', 'e2e_staff', 'e2e_leader', 'e2e_marketing', 'e2e_logistics'].sort(), 'Resume requires exact synthetic member IDs');
  else assert.equal(existing.length, 0, 'must start with an empty schema-only database');
  const profiles = [
    { id: 'e2e_boss', email: fixtures.bossEmail, name: '테스트 대표', role: '대표', team: '대표실', position: '대표' },
    { id: 'e2e_staff', email: fixtures.staffEmail, name: '테스트 직원', role: '사원', team: '국내 MD', position: '사원' },
    { id: 'e2e_leader', email: fixtures.leaderEmail, name: '테스트 팀장', role: '팀장', team: '국내 MD', position: '팀장' },
    { id: 'e2e_marketing', email: 'e2e-marketing@test.invalid', name: '테스트 마케팅', role: '사원', team: '마케팅', position: '사원' },
    { id: 'e2e_logistics', email: 'e2e-logistics@test.invalid', name: '테스트 물류', role: '사원', team: '물류·CS', position: '사원' },
  ];
  if (!resumeWork) {
    const seed = await restAsServer('app_users', { method: 'POST', body: JSON.stringify(profiles.map(p => ({ ...p, password_hash: simpleHash(password), is_active: true, work_profile: '격리된 합성 테스트 계정입니다.' }))) });
    assert.ok(seed.ok, 'synthetic member seed failed: ' + await seed.text());
  }
  // A proof signed ONLY with the fresh test-stack secret; real Google OAuth is not exercised.
  const proofBody = Buffer.from(JSON.stringify({ p: 'ceo_g', email: fixtures.bossEmail, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const proofKey = crypto.createHash('sha256').update('ceo-console:' + process.env.PGRST_JWT_SECRET).digest();
  fixtures.ceoCookie = 'ceo_g=' + proofBody + '.' + crypto.createHmac('sha256', proofKey).update(proofBody).digest('base64url');
  const app = express();
  app.use(express.json());
  app.use(ceoHostLock());
  app.use(sessionRouter, receiptRouter, payableRouter, workRouter, ceoRouter);
  // Production's REST proxy is separate from Express. This harness forwards to
  // real PostgREST with the same anon role, never returning fabricated DB data.
  app.use('/rest/v1', requireUser(), async (req, res) => {
    if (!['GET', 'POST', 'PATCH', 'HEAD'].includes(req.method)) { res.status(405).end(); return; }
    const path = req.url.replace(/^\//, '');
    if (!/^(vendors|items|production_orders|trade_statements|settlements|payables)(\?|$)/.test(path)) { res.status(403).end(); return; }
    const r = await rest(path, { method: req.method, headers: { Prefer: req.headers.prefer || 'return=representation' }, ...(['POST', 'PATCH'].includes(req.method) ? { body: JSON.stringify(req.body) } : {}) });
    res.status(r.status).type('json').send(await r.text());
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    if (!resumeWork) console.log(JSON.stringify({ finance: await verifyFinanceHttp(base, fixtures) }));
    const work = await verifyWorkHttp(base, fixtures);
    console.log(JSON.stringify({ work }));
    assert.equal(work.status, 'passed', 'Work HTTP chain not fully passed');
    assert.equal(evidenceChecks, 3, 'Question answer and both team reports must use confirmed records');
    // PMS is an external, unavailable dependency in this isolated stack; blocked
    // reads may produce honest warnings, but no other destination is acceptable.
    assert.ok(forbidden.every(origin => origin === 'http://e2e-unavailable:8000'), 'unexpected network destination');
    console.log(JSON.stringify({ isolatedHttpDatabase: resumeWork ? 'WORK_DEBUG_PASS_NOT_FULL_RUN' : 'PASS', model: 'deterministic fixture, not live', google: 'synthetic signed proof, not OAuth', pms: 'unavailable fixture', modelCalls, prohibitedExternalWrites: 0 }));
  } finally { server.close(); globalThis.fetch = originalFetch; }
}
main().catch(error => { console.error(String(error).split('\n')[0]); process.exitCode = 1; });
