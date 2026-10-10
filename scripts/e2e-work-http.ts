import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

class WorkHttpStatusError extends Error {
  constructor(path: string, status: number, expected: number) {
    super(`path=${path.split('?')[0]} status=${status} expected=${expected}`);
  }
}

// Undici fetch can discard a custom Host. Use native HTTP ONLY for the already
// validated loopback destination; the real ceo.* host gate must remain enabled.
async function ceoLoopbackRequest(url: URL, headers: Record<string, string>, body?: object): Promise<Response> {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: serialized === undefined ? 'GET' : 'POST', headers, signal: AbortSignal.timeout(45_000),
    }, incoming => {
      const chunks: Buffer[] = [];
      incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
      incoming.on('error', reject);
      incoming.on('end', () => {
        const status = incoming.statusCode || 500;
        resolve(new Response([204,205,304].includes(status) ? null : Buffer.concat(chunks), { status }));
      });
    });
    request.on('error', reject);
    request.end(serialized);
  });
}

/** Main owns bootstrap/seed; this module imports no server code and starts no server.
 * Mount the real session/work/ceo routers and ceoHostLock against ONLY disposable
 * PostgREST/DB. Supply a server-role read(path) callback, or a GET-only /rest/v1
 * bridge guarded by real requireUser().
 * Disable private mode/schedulers ONLY in that harness. Intercept ALL outbound
 * non-loopback traffic (Anthropic deterministic fixtures, PMS/Google blocked or
 * synthetic); never use live keys, profiles, Google grants or production data.
 * No row cleanup: keep synthetic evidence until main disposes of the harness.
 */
export const WORK_HTTP_HARNESS_CONTRACT = {
  ceoHost: 'ceo.fixture.invalid',
  ceoOrigin: 'https://ceo.fixture.invalid',
  restPrefix: '/rest/v1/',
  restTables: ['work_cards', 'notifications', 'campaigns', 'team_agent_runs'],
  // Main supplies signed fixture ceo_g via fixtures.ceoCookie. No live Google
  // verification is tested; the real CEO cookie verifier must remain enabled.
  users: {
    staff: { team: '국내 MD', role: '사원', position: '사원', is_active: true },
    leader: { team: '국내 MD', role: '팀장', position: '팀장', is_active: true },
    boss: { team: '대표실', role: '대표', email: 'wonyoung@atlm.kr', is_active: true },
  },
  reportFixture: { headline: '격리 점검', summary: '· 최종 20%; 마케팅·물류 준비 미확인', needs: [] },
} as const;

/** Match classifier prompts by marker; echo the ISO date from schedule text.
 * Wrap JSON.stringify(response) in an Anthropic text content block with normal
 * id/type/role/model/usage/stop_reason fields. Team report prompts contain
 * '팀 감독 에이전트'; use reportFixture ONLY for those prompts, not classification.
 * Fixture tests wiring/persistence/permission, not actual model intelligence.
 */
export function workHttpLlmCases(startDate: string) {
  assert.match(startDate, /^\d{4}-\d{2}-\d{2}$/);
  return {
    request: {
      text: 'E2E_WORK_REQUEST_CHECK: W컨셉 기획전 30% 예정, 팀장님 확인 필요',
      response: { kind: 'request_check', relatedId: null, parsed: { summary: 'W컨셉 할인 확인 요청', title: 'W컨셉 할인 확인 요청' } },
    },
    schedule: {
      text: `E2E_WORK_SCHEDULE_30: W컨셉 ${startDate} 파니에 토트 할인 30% 예정`,
      response: { kind: 'schedule', relatedId: null, parsed: { summary: 'W컨셉 기획전 30% 예정', title: 'E2E W컨셉 기획전 · 파니에 토트 30%',
        channel: 'W컨셉', startDate, endDate: startDate, discountRate: 30, products: '파니에 토트', workspace: 'LUMEN', shareTeams: ['마케팅', '물류·CS'] } },
    },
    boss: {
      text: 'E2E_WORK_CEO_SELF_DECISION: 나 내일까지 W컨셉 참여 결정해야 함',
      response: { kind: 'todo', relatedId: null, parsed: { summary: '대표 본인 참여 결정', title: '대표 본인 참여 결정' } },
    },
    question: {
      text: 'E2E_WORK_QUESTION: W컨셉 기획전 최종 비율과 준비 상태 알려줘',
      response: { kind: 'question', relatedId: null, parsed: { answer: '' } },
      answerFixture: '최종 20%, 마케팅·물류 준비 미확인',
    },
  };
}

type Fixtures = { bossEmail: string; staffEmail: string; leaderEmail: string; password: string;
  read?: (path: string) => Promise<any[]>; ceoCookie?: string; marketingId?: string; logisticsId?: string };
type Row = Record<string, any>;
type Check = { name: string; status: 'passed' | 'failed' | 'blocked'; detail?: string };
export interface WorkHttpResult {
  status: 'passed' | 'failed' | 'partial';
  checks: Check[];
  ids: { requestCard?: string; scheduleCard?: string; campaign?: string; bossCard?: string; agentRuns: string[] };
  llmInputs: ReturnType<typeof workHttpLlmCases>;
  limitations: string[];
}

export async function verifyWorkHttp(base: string, fixtures: Fixtures): Promise<WorkHttpResult> {
  const startDate = '2026-10-20'; // Agreed deterministic classifier/harness date.
  const cases = workHttpLlmCases(startDate);
  const result: WorkHttpResult = { status: 'failed', checks: [], ids: { agentRuns: [] }, llmInputs: cases,
    limitations: ['LLM responses are deterministic harness fixtures; actual AI quality is not tested.',
      'No cleanup/DELETE/DROP; all created evidence remains in the disposable harness.',
      'Marketing/logistics cookie logins, shared feeds and notification badges are tested; browser UI rendering is not tested.',
      'CEO second-factor cookie is signed by the isolated harness; no live Google verification is claimed.'] };
  let step = 'isolated harness safety';
  const pass = (name: string) => { step = name; result.checks.push({ name, status: 'passed' }); };
  try {
    const url = new URL(base);
    assert.ok(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only loopback harness URLs allowed');
    assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Use a bare loopback origin');
    const origin = url.origin;
    // Match the actual router's CEO_URL policy (ROOT_DOMAIN is captured on import).
    // Main may set ROOT_DOMAIN=fixture.invalid; an unset router expects empty Origin.
    const ceoHeaders = { Host: WORK_HTTP_HARNESS_CONTRACT.ceoHost,
      Origin: process.env.ROOT_DOMAIN ? `https://ceo.${process.env.ROOT_DOMAIN}` : '' };
    const http = async (path: string, cookie = '', body?: object, ceo = false) => {
      assert.ok(path.startsWith('/') && !path.startsWith('//'));
      const headers = { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(ceo ? ceoHeaders : {}) };
      const response = ceo ? await ceoLoopbackRequest(new URL(origin + path), headers, body) : await fetch(origin + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(45_000),
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      let data: Row = {};
      try { data = JSON.parse(text); } catch { /* Status checks also handle non-JSON failures. */ }
      return { response, data, path };
    };
    const ok = (reply: Awaited<ReturnType<typeof http>>, expected = 200) => {
      if (reply.response.status !== expected) throw new WorkHttpStatusError(reply.path, reply.response.status, expected);
      return reply.data;
    };
    pass('loopback-only target');

    step = 'anonymous authentication boundaries';
    for (const path of ['/api/session', '/api/work', '/api/notifications']) ok(await http(path), 401);
    if (!fixtures.read) ok(await http('/rest/v1/work_cards?select=id&limit=1'), 401);
    ok(await http('/api/work', '', { text: cases.request.text }), 401);
    ok(await http('/api/ceo/agents/run', '', { team: '마케팅' }, true), 401);
    pass(step);

    const login = async (email: string) => {
      step = 'real login + cookie session';
      const reply = await http('/api/login', '', { email, password: fixtures.password });
      const data = ok(reply);
      const cookie = reply.response.headers.getSetCookie().map(header => header.split(';')[0]).join('; ');
      assert.match(cookie, /(?:^|; )erp_token=/, 'Real login must set the session cookie');
      const restored = ok(await http('/api/session', cookie));
      assert.equal(restored.user.id, data.user.id);
      assert.equal(restored.user.email.toLowerCase(), email.toLowerCase());
      return { cookie, user: restored.user as Row };
    };
    const staff = await login(fixtures.staffEmail), leader = await login(fixtures.leaderEmail), boss = await login(fixtures.bossEmail);
    pass('three real logins + cookie-only session restoration');
    step = 'seeded profile and CEO permissions';
    const staffFeed = ok(await http('/api/work', staff.cookie));
    const leaderFeed = ok(await http('/api/work', leader.cookie));
    const bossFeed = ok(await http('/api/work', boss.cookie));
    assert.equal(staffFeed.me.team, '국내 MD'); assert.equal(staffFeed.me.isLeader, false);
    assert.equal(leaderFeed.me.team, staffFeed.me.team); assert.equal(leaderFeed.me.isLeader, true);
    assert.equal(bossFeed.me.isBoss, true);
    for (const actor of [staff, leader]) {
      ok(await http('/api/ceo/overview', actor.cookie, undefined, true), 403);
      ok(await http('/api/ceo/agents/run', actor.cookie, { team: '마케팅' }, true), 403);
    }
    const lockedBoss = await http('/api/ceo/overview', boss.cookie, undefined, true);
    ok(lockedBoss, 401); assert.equal(lockedBoss.data.error, 'google_required');
    pass(step);

    const rows = async (table: string, query: string) => {
      assert.ok((WORK_HTTP_HARNESS_CONTRACT.restTables as readonly string[]).includes(table));
      const reply = fixtures.read ? await fixtures.read(`${table}?${query}`) : ok(await http(`/rest/v1/${table}?${query}`, boss.cookie));
      assert.ok(Array.isArray(reply), `${table}: expected real PostgREST row array`);
      return reply as Row[];
    };
    const oneCard = async (id: string) => {
      const found = await rows('work_cards', `id=eq.${encodeURIComponent(id)}&select=*`);
      assert.equal(found.length, 1); return found[0];
    };
    const requestId = () => 'wc_' + randomUUID().replaceAll('-', '');
    step = 'staff request -> assigned leader -> persisted notification';
    const requestBody = { text: cases.request.text, requestId: requestId() };
    const request = ok(await http('/api/work', staff.cookie, requestBody));
    result.ids.requestCard = request.card.id;
    assert.equal(request.card.id, requestBody.requestId); assert.equal(request.card.kind, 'request_check');
    assert.equal(request.card.created_by, staff.user.id); assert.equal(request.card.assignee_id, leader.user.id);
    assert.equal(request.notified, true);
    const leaderNotifications = ok(await http('/api/notifications', leader.cookie));
    assert.ok(leaderNotifications.items.some((n: Row) => n.card_id === request.card.id && n.user_id === leader.user.id));
    const noticeQuery = `card_id=eq.${request.card.id}&user_id=eq.${encodeURIComponent(leader.user.id)}&select=*`;
    assert.equal((await rows('notifications', noticeQuery)).length, 1);
    const replay = ok(await http('/api/work', staff.cookie, requestBody));
    assert.equal(replay.reused, true); assert.equal(replay.card.id, request.card.id);
    assert.equal((await rows('notifications', noticeQuery)).length, 1, 'Retry must not notify twice');
    assert.equal((await oneCard(request.card.id)).assignee_id, leader.user.id);
    pass(step);

    step = 'author cannot self-reply; leader reply persists and notifies staff';
    ok(await http(`/api/work/${request.card.id}/reply`, staff.cookie, { text: '본인 임의 승인' }), 403);
    assert.equal((await oneCard(request.card.id)).status, 'open');
    const replyText = 'E2E_WORK_LEADER_REPLY: 30%가 아니라 20%로 진행하세요';
    const reply = ok(await http(`/api/work/${request.card.id}/reply`, leader.cookie, { text: replyText }));
    assert.equal(reply.notified, true);
    const replied = await oneCard(request.card.id);
    assert.equal(replied.status, 'done'); assert.equal(replied.reply_text, replyText);
    assert.equal(replied.replied_by_name, leader.user.name);
    assert.ok(ok(await http('/api/notifications', staff.cookie)).items.some((n: Row) => n.card_id === request.card.id && n.body === replyText));
    ok(await http(`/api/work/${request.card.id}/reply`, leader.cookie, { text: replyText }), 409);
    pass(step);

    step = '30% draft -> staff-confirmed 20% campaign + shared teams';
    const schedule = ok(await http('/api/work', staff.cookie, { text: cases.schedule.text, requestId: requestId() }));
    result.ids.scheduleCard = schedule.card.id;
    assert.equal(schedule.card.kind, 'schedule'); assert.equal(Number(schedule.card.parsed.discountRate), 30);
    const title = `E2E 확정 W컨셉 20% ${schedule.card.id}`;
    const confirmedBody = { payload: { title, channel: 'W컨셉', startDate, endDate: startDate, discountRate: 20, products: '파니에 토트', workspace: 'LUMEN' }, shareTeams: ['마케팅', '물류·CS'] };
    ok(await http(`/api/work/${schedule.card.id}/confirm`, staff.cookie, { ...confirmedBody, payload: { ...confirmedBody.payload, discountRate: 101 } }), 400);
    assert.equal((await oneCard(schedule.card.id)).status, 'open');
    assert.equal((await rows('campaigns', `title=eq.${encodeURIComponent(title)}&select=id`)).length, 0);
    const confirmed = ok(await http(`/api/work/${schedule.card.id}/confirm`, staff.cookie, confirmedBody));
    assert.equal(confirmed.ok, true); assert.equal(confirmed.notified, true); assert.equal(confirmed.ref.table, 'campaigns');
    result.ids.campaign = confirmed.ref.id;
    const campaigns = await rows('campaigns', `id=eq.${encodeURIComponent(confirmed.ref.id)}&select=*`);
    assert.equal(campaigns.length, 1); const campaign = campaigns[0];
    assert.equal(Number(campaign.discount_rate), 20); assert.equal(campaign.start_date, startDate);
    assert.equal(campaign.end_date, startDate); assert.equal(campaign.workspace, 'LUMEN'); assert.equal(campaign.owner, staff.user.name);
    const settled = await oneCard(schedule.card.id);
    assert.equal(settled.status, 'done'); assert.equal(Number(settled.parsed.discountRate), 30, 'Original suggestion must remain available');
    assert.equal(Number(settled.confirmed_payload.discountRate), 20); assert.equal(settled.done_by_name, staff.user.name);
    assert.deepEqual([...settled.shared_teams].sort(), ['마케팅', '물류·CS'].sort());
    assert.equal(settled.result_ref.id, campaign.id); assert.deepEqual(campaign.tasks, [], 'Shared schedule does not imply completed preparations');
    for (const userId of [fixtures.marketingId || 'e2e_marketing', fixtures.logisticsId || 'e2e_logistics']) {
      const notices = await rows('notifications', `card_id=eq.${schedule.card.id}&user_id=eq.${encodeURIComponent(userId)}&select=*`);
      assert.equal(notices.length, 1, 'Actual shared-team notification must be persisted');
    }
    ok(await http(`/api/work/${schedule.card.id}/confirm`, staff.cookie, confirmedBody), 400);
    assert.equal((await rows('campaigns', `title=eq.${encodeURIComponent(title)}&select=id`)).length, 1, 'Duplicate confirmation must not create another campaign');
    pass(step);

    const marketing = await login('e2e-marketing@test.invalid');
    const logistics = await login('e2e-logistics@test.invalid');
    step = 'marketing/logistics real sessions see shared final schedule without own task counts';
    assert.equal(marketing.user.id, fixtures.marketingId || 'e2e_marketing');
    assert.equal(logistics.user.id, fixtures.logisticsId || 'e2e_logistics');
    for (const [actor, team] of [[marketing, '마케팅'], [logistics, '물류·CS']] as const) {
      const feed = ok(await http('/api/work', actor.cookie));
      assert.equal(feed.me.team, team);
      const sharedCard = feed.items.find((card: Row) => card.id === schedule.card.id);
      assert.ok(sharedCard, 'Actual authenticated shared-team feed must include the confirmed card');
      assert.equal(sharedCard.status, 'done'); assert.equal(Number(sharedCard.confirmed_payload.discountRate), 20);
      assert.ok(sharedCard.shared_teams.includes(team));
      assert.equal(sharedCard.created_by, staff.user.id); assert.notEqual(sharedCard.assignee_id, actor.user.id);
      assert.equal(Number(feed.counts.todo), 0, 'A received shared schedule is not an own task');
      const today = ok(await http('/api/work/today', actor.cookie));
      assert.equal(Number(today.counts.open), 0); assert.equal(Number(today.counts.checks), 0);
      assert.ok(!today.items.some((card: Row) => card.id === schedule.card.id), 'Shared confirmed schedule must not enter personal unfinished work');
    }
    pass(step);

    step = 'notification ownership: foreign ID stays unchanged; own read decrements badge once';
    const noticeFor = async (actor: typeof marketing) => {
      const list = ok(await http('/api/notifications', actor.cookie));
      const notification = list.items.find((notice: Row) => notice.card_id === schedule.card.id && notice.user_id === actor.user.id);
      assert.ok(notification); assert.equal(notification.read_at, null); assert.ok(Number(list.unread) >= 1);
      return notification as Row;
    };
    const marketingNotice = await noticeFor(marketing), logisticsNotice = await noticeFor(logistics);
    for (const [actor, ownNotice, foreignNotice] of [[marketing, marketingNotice, logisticsNotice], [logistics, logisticsNotice, marketingNotice]] as const) {
      const before = ok(await http('/api/notifications', actor.cookie));
      const foreignQuery = `id=eq.${encodeURIComponent(foreignNotice.id)}&select=*`;
      const foreignBefore = await rows('notifications', foreignQuery);
      assert.equal(foreignBefore.length, 1);
      assert.equal(ok(await http('/api/notifications/read', actor.cookie, { ids: [foreignNotice.id] })).ok, true);
      assert.deepEqual(await rows('notifications', foreignQuery), foreignBefore, 'Foreign notification DB row must not change');
      assert.equal(Number(ok(await http('/api/notifications', actor.cookie)).unread), Number(before.unread), 'Foreign ID must not change own unread badge');
      assert.equal(ok(await http('/api/notifications/read', actor.cookie, { ids: [ownNotice.id] })).ok, true);
      const after = ok(await http('/api/notifications', actor.cookie));
      assert.equal(Number(after.unread), Number(before.unread) - 1);
      const persisted = await rows('notifications', `id=eq.${encodeURIComponent(ownNotice.id)}&select=*`);
      assert.equal(persisted.length, 1); assert.equal(persisted[0].user_id, actor.user.id);
      assert.ok(typeof persisted[0].read_at === 'string' && Number.isFinite(Date.parse(persisted[0].read_at)));
      assert.equal(ok(await http('/api/notifications/read', actor.cookie, { ids: [ownNotice.id] })).ok, true);
      assert.equal(Number(ok(await http('/api/notifications', actor.cookie)).unread), Number(after.unread), 'Repeated read must not decrement badge twice');
    }
    pass(step);

    step = 'actual question/answer path preserves final 20% and preparation uncertainty';
    const question = ok(await http('/api/work', staff.cookie, { text: cases.question.text, requestId: requestId() }));
    assert.equal(question.card.kind, 'question'); assert.equal(question.card.status, 'done');
    const answer = String(question.card.parsed.answer || '');
    assert.match(answer, /20\s*%/); assert.match(answer, /미확인|미검증|불명|unknown|확인되지|준비.*확인\s*필요|준비.*근거.*(?:아닙|없)/);
    assert.doesNotMatch(answer, /준비(?:가|는)?\s*완료(?:됐|되었습니다|했습니다)/);
    const storedQuestion = await oneCard(question.card.id);
    assert.equal(storedQuestion.parsed.answer, answer);
    pass(step);

    step = 'CEO self-decision stays assigned to CEO';
    const own = ok(await http('/api/work', boss.cookie, { text: cases.boss.text, requestId: requestId() }));
    result.ids.bossCard = own.card.id;
    assert.equal(own.card.kind, 'todo'); assert.equal(own.card.assignee_id, boss.user.id); assert.equal(own.card.created_by, boss.user.id);
    const owned = await oneCard(own.card.id); assert.equal(owned.assignee_id, boss.user.id);
    ok(await http(`/api/work/${own.card.id}/done`, staff.cookie, { note: '직원이 대신 완료' }), 403);
    assert.equal((await oneCard(own.card.id)).status, 'open');
    pass(step);

    step = 'CEO test verification cookie';
    if (!fixtures.ceoCookie) {
      result.checks.push({ name: 'actual CEO agents API + persisted marketing/logistics reports', status: 'blocked', detail: 'Harness ceo_g fixture cookie is unavailable; actual Google authentication is intentionally not invoked.' });
      result.status = 'partial'; return result;
    }
    const proof = fixtures.ceoCookie.startsWith('ceo_g=') ? fixtures.ceoCookie.split(';')[0] : `ceo_g=${encodeURIComponent(fixtures.ceoCookie)}`;
    const ceoCookie = `${boss.cookie}; ${proof}`;
    step = 'actual CEO agents API + persisted marketing/logistics reports';
    for (const team of ['마케팅', '물류·CS']) {
      const run = ok(await http('/api/ceo/agents/run', ceoCookie, { team }, true));
      assert.equal(run.runs.length, 1); const report = run.runs[0];
      assert.equal(report.team, team); assert.equal(report.trigger, 'manual');
      assert.ok(Number(report.stats.shared) >= 1, 'Confirmed schedule must be counted as shared evidence');
      assert.equal(Number(report.stats.open), 0, 'Shared schedule is not an own-team open task');
      assert.equal(Number(report.stats.doneToday), 0, 'Shared schedule is not team preparation completion');
      assert.ok(typeof report.headline === 'string' && report.headline.trim());
      assert.match(String(report.summary), /20\s*%/);
      assert.match(String(report.summary), /미확인|미검증|불명|unknown|확인되지|준비.*확인\s*필요|준비.*근거.*(?:아닙|없)/);
      assert.doesNotMatch(String(report.summary), /AI 보고 작성 불가|준비(?:가|는)?\s*완료(?:됐|되었습니다|했습니다)/);
      const saved = await rows('team_agent_runs', `id=eq.${encodeURIComponent(report.id)}&select=*`);
      assert.equal(saved.length, 1); assert.equal(saved[0].team, team);
      assert.deepEqual(saved[0].stats, report.stats); assert.equal(saved[0].summary, report.summary);
      result.ids.agentRuns.push(report.id);
    }
    pass(step); result.status = 'passed';
  } catch (error) {
    // Never return login payloads, cookies, JWTs, fixture passwords or HTTP bodies.
    const detail = error instanceof WorkHttpStatusError ? error.message
      : error instanceof Error && error.name === 'AssertionError' ? 'Assertion failed; inspect isolated harness evidence for this step.' : 'HTTP/fixture contract failed; inspect isolated harness logs.';
    result.checks.push({ name: step, status: 'failed', detail });
  }
  return result;
}
