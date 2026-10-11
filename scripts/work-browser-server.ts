// Test-only HTTPS API: real routers and real disposable PostgREST, fixed model replies.
// Never import server/index.ts (schedulers) or accept a production endpoint/key.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import express from 'express';
import sessionRouter from '../server/session';
import workRouter from '../server/work';
import captureRouter from '../server/capture';
import usersRouter from '../server/users';
import ceoRouter, { ceoHostGate, ceoHostLock } from '../server/ceo';
import { restAsServer, requireUser } from '../server/auth';
import { workHttpLlmCases } from './e2e-work-http';
import { createAgentSchedulerTick } from '../server/agent-scheduler';
import { completedScheduleTeams, runAgentsOnce, fillScheduleTeams, loadReportContext, reportTeams } from '../server/agents';
import { allRows } from '../server/work-records';
import { ORG } from '../server/org';

assert.equal(process.env.ERP_BROWSER_ISOLATED, '20261010');
assert.equal(process.env.POSTGREST_URL, 'http://127.0.0.1:4192');
assert.equal(process.env.ERP_PRIVATE_MODE, 'false');
assert.equal(process.env.ROOT_DOMAIN, 'localhost:4189');
assert.equal(process.env.ANTHROPIC_API_KEY, 'isolated-fixture-not-real');
assert.ok(process.env.PGRST_JWT_SECRET && process.env.PGRST_JWT_SECRET.length >= 32);
const nativeFetch = globalThis.fetch;
export const calls = { classify: 0, answer: 0, report: 0 };
export const blocked: string[] = [];
let truncateNextReport = false;
let capacityFixtures = false;
export const enableCapacityFixtures = () => { capacityFixtures = true; };
export const capacityTeams = ORG.map(team => team.key);
export const failNextReport = () => { truncateNextReport = true; };
export const inputs = workHttpLlmCases('2026-10-20');
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === 'https://api.anthropic.com') {
    const request = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.clone().text() : '{}')));
    const system = String(request.system || '');
    const message = String(request.messages?.[0]?.content || '');
    let output: string;
    if (system.includes('업무 카드로 바꾼다')) {
      calls.classify++;
      if (capacityFixtures && /^E2E_LOAD_\d{2}_\d{2}$/.test(message)) {
        output = JSON.stringify({ kind: 'todo', relatedId: null, parsed: { summary: message, dueDate: '2099-12-31', shareTeams: [] } });
      } else {
        const example = Object.values(inputs).find(value => value.text === message);
        assert.ok(example, 'Unexpected classifier fixture');
        output = JSON.stringify(example.response);
      }
    } else {
      if (!capacityFixtures) assert.match(message, /discountRate[^\d]*20/, 'Final decision must reach model prompt');
      if (system.includes('팀 감독 에이전트')) {
        calls.report++;
        assert.match(message, /다른 팀에서 공유받은 근거/);
        output = capacityFixtures ? JSON.stringify({ headline: '격리 부하검증 보고', summary: '· 합성 업무의 규칙 집계 검증입니다.\n· 외부 운영 자료는 미확인입니다.', needs: [] })
          : JSON.stringify({ headline: '10/20 확정 20% · 준비 미확인', summary: '· 최종 할인율은 20%입니다.\n· 마케팅·물류 준비 미확인입니다. 공유는 준비 완료 근거가 아닙니다.', needs: [] });
      } else {
        calls.answer++;
        output = '최종 할인율은 20%입니다. 마케팅·물류 준비 미확인입니다.';
      }
    }
    const truncated = system.includes('팀 감독 에이전트') && truncateNextReport;
    if (truncated) truncateNextReport = false;
    return new Response(JSON.stringify({ id: 'browser-fixture', type: 'message', role: 'assistant', model: request.model,
      content: [{ type: 'text', text: output }], stop_reason: truncated ? 'max_tokens' : 'end_turn', stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.origin !== process.env.POSTGREST_URL) {
    blocked.push(url.origin);
    throw new Error('Isolated browser server blocks external destinations');
  }
  return nativeFetch(input, { ...init, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(15000) });
}) as typeof fetch;

export async function read(path: string) {
  assert.match(path, /^(app_users|work_cards|notifications|campaigns|team_agent_runs|production_orders|trade_statements|settlements|payables)\?/);
  const response = await restAsServer(path);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error('Disposable DB read failed: ' + path.split('?')[0] + ' status=' + response.status + ' code=' + error.code + ' message=' + error.message);
  }
  return response.json();
}
// Exercise the real scheduler tick and report write path for one synthetic team.
// Never start wall-clock timers or the production server's other background jobs.
export const scheduledMarketingTick = createAgentSchedulerTick({
  completed: async (dayStart, signal) => completedScheduleTeams(await allRows(`team_agent_runs?trigger=eq.schedule&created_at=gte.${dayStart}&select=team,stats&order=created_at.asc,id.asc`, path => restAsServer(path, { signal }))),
  targets: async () => ['마케팅'],
  fill: async teams => {
    let saved = 0;
    for (const team of teams) saved += completedScheduleTeams(await runAgentsOnce('schedule', team) || []).length;
    return saved;
  },
});
export const scheduledAllTeamsTick = createAgentSchedulerTick({
  completed: async (dayStart, signal) => completedScheduleTeams(await allRows(`team_agent_runs?trigger=eq.schedule&created_at=gte.${dayStart}&select=team,stats&order=created_at.asc,id.asc`, path => restAsServer(path, { signal }))),
  targets: async () => reportTeams((await loadReportContext()).cards),
  fill: fillScheduleTeams,
});
export const users = [
  { id: 'e2e_boss', email: 'wonyoung@atlm.kr', name: '테스트 대표', role: '대표', team: '대표실', position: '대표' },
  { id: 'e2e_staff', email: 'e2e-staff@test.invalid', name: '테스트 직원', role: '사원', team: '국내 MD', position: '사원' },
  { id: 'e2e_leader', email: 'e2e-leader@test.invalid', name: '테스트 팀장', role: '팀장', team: '국내 MD', position: '팀장' },
  { id: 'e2e_marketing', email: 'e2e-marketing@test.invalid', name: '테스트 마케팅', role: '사원', team: '마케팅', position: '사원' },
  { id: 'e2e_logistics', email: 'e2e-logistics@test.invalid', name: '테스트 물류', role: '사원', team: '물류·CS', position: '사원' },
];

export async function start(frontend: string, password: string) {
  for (const table of ['app_users', 'work_cards', 'campaigns', 'notifications', 'team_agent_runs', 'production_orders', 'trade_statements', 'settlements', 'payables']) {
    assert.equal((await read(table + '?select=id&limit=1')).length, 0, 'Fresh empty schema required');
  }
  let hash = 0; for (const c of password) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  const seed = await restAsServer('app_users', { method: 'POST', body: JSON.stringify(users.map(user => ({ ...user,
    password_hash: Math.abs(hash).toString(36), is_active: true, work_profile: '격리 시험 계정. W컨셉 기획전 운영.' }))) });
  assert.ok(seed.ok, 'Synthetic account seed failed');
  const app = express();
  app.use(express.json());
  app.use(ceoHostLock());
  app.use(sessionRouter, workRouter, captureRouter, usersRouter, ceoRouter);
  app.use('/rest/v1', requireUser(), async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.status(405).end(); return; }
    const response = await nativeFetch(process.env.POSTGREST_URL + req.url, { method: req.method,
      headers: { Authorization: req.headers.authorization || '', Accept: req.headers.accept || '*/*' }, redirect: 'error' });
    res.status(response.status);
    for (const header of ['content-type', 'content-range', 'range-unit']) {
      const value = response.headers.get(header); if (value) res.set(header, value);
    }
    res.send(await response.text());
  });
  app.use(ceoHostGate());
  app.get('/browser.js', (_req, res) => res.type('js').send(frontend));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('*', (_req, res) => res.type('html').send('<meta charset="utf-8"><title>ERP 격리 업무 흐름 검증</title><div id="root"></div><script type="module" src="/browser.js"></script>'));
  const server = https.createServer({ key: fs.readFileSync('.codex/browser-test-key.pem'), cert: fs.readFileSync('.codex/browser-test-cert.pem') }, app);
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(4189, '127.0.0.1', resolve); });
  } catch (error) { globalThis.fetch = nativeFetch; throw error; }
  const proof = Buffer.from(JSON.stringify({ p: 'ceo_g', email: users[0].email, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const key = crypto.createHash('sha256').update('ceo-console:' + process.env.PGRST_JWT_SECRET).digest();
  const ceoProof = proof + '.' + crypto.createHmac('sha256', key).update(proof).digest('base64url');
  return { server, ceoProof, restore: () => { globalThis.fetch = nativeFetch; } };
}
