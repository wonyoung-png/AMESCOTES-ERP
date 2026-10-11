import assert from 'node:assert/strict';
import test from 'node:test';
import { workPageQuery, workCountQueries, notificationReadIds } from './work-feed';
import { countRows } from './work-records';
import { submittedWork } from './work-submit';

const actor = { id: 'me', team: '국내 MD', isBoss: false, isLeader: false };
const visibility = '&or=(created_by.eq.me,assignee_id.eq.me,team.eq.MD)';
const condition = (query: string) => new URLSearchParams(query.split('?')[1]).get('and')!;

test('페이지·전체 숫자는 같은 직원 권한을 AND로 묶고 남의 개인 질문을 제외한다', () => {
  const page = condition(workPageQuery(actor, visibility));
  assert.match(page, /or\(kind.neq.question,created_by.eq."me"\)/);
  assert.match(page, /or\(created_by.eq.me,assignee_id.eq.me,team.eq.MD\)/);
  for (const query of Object.values(workCountQueries(actor, visibility))) {
    assert.match(condition(query), /kind.neq.question/);
    assert.match(condition(query), /or\(created_by.eq.me,assignee_id.eq.me,team.eq.MD\)/);
    assert.match(query, /limit=0/);
  }
});

test('카드 경계는 시각·ID 둘 다 사용하고 잘못된 커서는 거부한다', () => {
  const q = condition(workPageQuery(actor, visibility, { id: 'wc_abc', created_at: '2026-10-10T01:00:00.000Z' }));
  assert.match(q, /created_at.lt.2026-10-10T01:00:00.000Z/);
  assert.match(q, /and\(created_at.eq.2026-10-10T01:00:00.000Z,id.lt.wc_abc\)/);
  for (const cursor of [{ id: 'wc_abc)', created_at: '2026-10-10T01:00:00Z' }, { id: 'wc_abc', created_at: 'not-a-date' }]) {
    assert.throws(() => workPageQuery(actor, '', cursor), /invalid_cursor/);
  }
});

test('DB 시간대와 마이크로초를 그대로 유지하여 한국·해외 시간대 페이지를 조회한다', () => {
  for (const timestamp of ['2026-10-11T10:15:30.558709+09:00', '2026-10-10T21:15:30.558709-04:00', '2026-10-11T01:15:30+00:00']) {
    const q = condition(workPageQuery(actor, visibility, { id: 'wc_load251632', created_at: timestamp }));
    assert.ok(q.includes(`created_at.lt.${timestamp}`));
    assert.ok(q.includes(`created_at.eq.${timestamp}`));
  }
  for (const timestamp of ['2026-10-11T10:15:30+99:00', '2026-10-11T10:15:30+09:00)', '2026-10-11T10:15:30.1234567Z']) {
    assert.throws(() => workPageQuery(actor, '', { id: 'wc_abc', created_at: timestamp }), /invalid_cursor/);
  }
});

test('확인·할 일 중복은 OR로 한 번 세며 대표·팀장·본인의 일정 권한을 유지한다', () => {
  const q = condition(workCountQueries(actor, visibility).attention);
  assert.match(q, /or\(and\(created_by.neq."me",read_by.not.cs.\{"me"\}\),and\(status.eq.open/);
  assert.doesNotMatch(condition(workCountQueries(actor, '').todo), /team.eq/);
  assert.match(condition(workCountQueries({ ...actor, isLeader: true }, '').todo), /team.eq."국내 MD"/);
  assert.match(condition(workCountQueries({ ...actor, isBoss: true }, '').todo), /or\(assignee_id.eq."me",kind.eq.schedule\)/);
});

test('알림 확인은 명시한 30건 이내만 허용하며 전체·필터 주입 입력을 거부한다', () => {
  assert.deepEqual(notificationReadIds(['ntf_a', 'ntf_a', 'ntf_b']), ['ntf_a', 'ntf_b']);
  for (const input of [undefined, [], Array(31).fill('ntf_a'), ['ntf_a,ntf_b'], ['ntf_a)'], [123]]) assert.throws(() => notificationReadIds(input), /bad_ids/);
});

test('목록이 30건이어도 전체 1,251건을 세며 조회 실패·누락을 0으로 바꾸지 않는다', async () => {
  const reader = (range: string | null, ok = true) => async () => ({ ok, status: ok ? 200 : 503, headers: { get: () => range }, json: async () => [] });
  assert.equal(await countRows('test', reader('*/1251')), 1251);
  assert.equal(await countRows('test', reader('*/0')), 0);
  for (const range of [null, '*/*', '*/NaN']) await assert.rejects(countRows('test', reader(range)), /확인 불가/);
  await assert.rejects(countRows('test', reader('*/0', false)), /503/);
});

test('업무 재시도는 원본을 반환하고 변경 내용·다른 작성자의 카드 접근을 막는다', async () => {
  let query = '';
  const read = async (path: string) => { query = path; return { ok: true, status: 200, json: async () => [{ id: 'wc_retry', raw_text: '확인 필요', status: 'done' }], text: async () => '' }; };
  assert.equal((await submittedWork('wc_retry', 'me', '확인 필요', read)).status, 'done');
  assert.match(query, /created_by=eq.me/);
  await assert.rejects(submittedWork('wc_retry', 'me', '다른 내용', read), /request_conflict/);
  assert.equal(await submittedWork('wc_retry', 'other', '확인 필요', async () => ({ ok: true, status: 200, json: async () => [], text: async () => '' })), null);
});
