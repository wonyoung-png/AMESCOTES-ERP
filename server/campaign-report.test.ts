import assert from 'node:assert/strict';
import test from 'node:test';

// Real helper/answer/report and Anthropic SDK; every fetch is intercepted.
// No auth HTTP, DB writes, runAgents, or live model inference is exercised.
const REST = 'http://campaign-report.fixture.invalid';
const KEY = 'synthetic-campaign-report-test-only';
process.env.POSTGREST_URL = REST;
process.env.PGRST_JWT_SECRET = 'campaign-report-synthetic-jwt-secret';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
const { answer } = await import('./work');
const { writeTeamReport } = await import('./agents');
const { attachCampaignEvidence } = await import('./campaign-evidence');
type Member = import('./work').Member;

const me: Member = { id: 'fixture_md', name: 'Synthetic MD', team: '국내 MD', role: '사원', position: '사원', email: 'fixture@test.invalid', profile: '' };
const current = { id: 'cmp_prompt_fixture', title: 'Synthetic campaign', workspace: 'LUMEN', channel: 'W컨셉',
  start_date: '2026-10-20', end_date: '2026-10-21', discount_rate: 15, status: 'draft',
  product_discounts: [], category_discounts: [], updated_at: '2026-10-11T01:02:03.123456Z' };
const cases = [
  { name: 'current_discount15', state: 'current', row: current },
  { name: 'rescheduled', state: 'current', row: { ...current, start_date: '2026-11-05', end_date: '2026-11-08' } },
  { name: 'closed', state: 'current', row: { ...current, status: 'closed' } },
  { name: 'missing', state: 'missing', row: null },
  { name: 'unavailable', state: 'unavailable', row: null },
  { name: 'unlinked', state: 'unlinked', row: null },
] as const;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

for (const scenario of cases) for (const path of ['answer', 'team_report'] as const) {
  test(`campaign prompt: ${scenario.name} / ${path}`, async () => {
    const originalFetch = globalThis.fetch;
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = KEY;
    const card = { id: 'wc_prompt_fixture', created_by: me.id, created_by_name: me.name, team: me.team, _org: me.team,
      created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T02:00:00.123456Z',
      kind: 'schedule', status: 'done', raw_text: 'Synthetic campaign 30% 초안', parsed: {}, done_by_name: 'Synthetic leader',
      confirmed_payload: { title: current.title, workspace: current.workspace, channel: current.channel,
        startDate: '2026-10-20', endDate: '2026-10-21', discountRate: 20 },
      shared_teams: ['마케팅'], ...(scenario.state === 'unlinked' ? {} : { result_ref: { table: 'campaigns', id: current.id } }) };
    const prompts: Array<{ system: string; messages: Array<{ content: string }> }> = [];
    const reads: URL[] = [], prohibited: string[] = [];
    let linkedReads = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : undefined;
      const url = new URL(request ? request.url : String(input));
      const method = init?.method || request?.method || 'GET';
      if (url.origin === 'https://api.anthropic.com' && url.pathname === '/v1/messages' && method === 'POST') {
        const headers = new Headers(init?.headers || request?.headers);
        assert.equal(headers.get('x-api-key'), KEY, 'Only a synthetic model key is allowed');
        const body = JSON.parse(String(init?.body ?? await request?.clone().text()));
        prompts.push(body);
        const output = path === 'answer' ? 'synthetic answer marker' : JSON.stringify({ headline: 'synthetic report marker', summary: '· synthetic fixture', needs: [] });
        return json({ id: 'fixture-message', type: 'message', role: 'assistant', model: body.model,
          content: [{ type: 'text', text: output }], stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 } });
      }
      if (url.origin === REST && method === 'GET' && ['/work_cards', '/campaigns', '/gcal_links'].includes(url.pathname)) {
        reads.push(url);
        if (url.pathname === '/work_cards') return json([card]);
        if (url.pathname === '/gcal_links') return json([]);
        if (url.searchParams.has('id')) {
          linkedReads++;
          assert.equal(url.searchParams.get('id'), `in.(${current.id})`, 'Only the authorized card link is queried');
          assert.ok(url.searchParams.get('select')?.split(',').includes('updated_at'));
          assert.equal(url.searchParams.has('end_date'), false, 'Linked lookup cannot infer absence from a date window');
          return scenario.state === 'unavailable' ? json({ message: 'synthetic unavailable' }, 503)
            : json(scenario.row ? [scenario.row] : []);
        }
        // Intentionally empty date-window list: authoritative linked lookup must still win.
        return json([]);
      }
      prohibited.push(`${method} ${url.origin}${url.pathname}`);
      throw new Error('Fixture blocks all other requests');
    }) as typeof fetch;
    try {
      if (path === 'answer') {
        assert.equal(await answer(me, 'Synthetic campaign 현재 일정 할인 상태 알려줘', [me]), 'synthetic answer marker');
        const recent = reads.find(url => url.pathname === '/work_cards' && url.searchParams.has('created_at'));
        assert.ok(recent?.searchParams.get('select')?.split(',').includes('result_ref'), 'Answer must read links from real card selection');
      } else {
        // Runtime runAgents attaches before write. This test explicitly executes that real helper,
        // then the real writer with shared evidence; it does not exercise runAgents/storage.
        const attached = await attachCampaignEvidence([card]);
        assert.equal(attached[0]._campaignEvidence.state, scenario.state);
        const result = await writeTeamReport('마케팅', [], [me], { open: 0, overdue: 0, alerts: 0 }, 'work', [], '', attached);
        assert.equal(result.headline, 'synthetic report marker');
      }
      assert.deepEqual(prohibited, []);
      assert.equal(linkedReads, scenario.state === 'unlinked' ? 0 : 1);
      assert.equal(prompts.length, 1, 'Must reach real model prompt construction, not a fallback');
      const { system, messages } = prompts[0];
      assert.match(system, /확정값은 당시 결정 기록/);
      assert.match(system, /연결된 현재 캘린더 값이 우선/);
      assert.match(system, /과거 확정값을 현재 값처럼 말하지 마라/);
      assert.match(system, /삭제·취소·진행 여부를 추측하지 마라/);
      assert.match(system, /팀별 준비 완료는 서로 다르다/);
      const evidence = messages[0].content;
      const line = evidence.split('\n').find(value => value.includes('id=wc_prompt_fixture'));
      assert.ok(line, 'Linked card must be in the actual prompt');
      assert.match(line, /30% 초안/);
      const historical = line.split(' → 당시 확정(Synthetic leader): ')[1]?.split(' → ')[0];
      assert.ok(historical, 'Historical confirmation must be labeled, not overwritten');
      assert.equal(JSON.parse(historical).discountRate, 20);
      assert.equal(JSON.parse(historical).startDate, '2026-10-20');
      if (scenario.row) {
        const live = line.split(/ → 연결된 현재 운영캘린더 \(조회 [^)]+\): /)[1]?.split(' → ')[0];
        assert.ok(live, 'Current campaign must be separately labeled with lookup time');
        const facts = JSON.parse(live);
        assert.equal(facts.discountRate, 15);
        assert.equal(facts.startDate, scenario.row.start_date);
        assert.equal(facts.endDate, scenario.row.end_date);
        assert.equal(facts.status, scenario.row.status);
        assert.equal(facts.updatedAt, current.updated_at);
        assert.equal(facts.id, current.id);
      } else {
        assert.doesNotMatch(line, /연결된 현재 운영캘린더/);
        if (scenario.state === 'missing') assert.match(line, /현재 캘린더 항목 없음 — 삭제·미등록 사유 미확인/);
        if (scenario.state === 'unavailable') {
          assert.match(line, /최신 캘린더 조회 실패 — 현재 상태 미확인/);
          assert.doesNotMatch(line, /현재 캘린더 항목 없음|삭제·미등록/);
        }
        if (scenario.state === 'unlinked') {
          assert.match(line, /연결 정보 없음 — 현재 상태 미확인/);
          assert.doesNotMatch(line, /현재 캘린더 항목 없음|조회 실패|삭제·미등록/);
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });
}
