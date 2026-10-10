import assert from 'node:assert/strict';
import test from 'node:test';
import { routeFor, type Member } from './work';
import { judge, orgOf } from './agents';
import { cardEvidence, readRows, reportingCards, searchCards, prioritizeCards } from './work-records';
import { schedulePayload } from '../shared/schedule';

const now = new Date('2026-10-10T01:00:00Z');
const employee: Member = { id: 'md', name: 'test MD', team: '국내 MD', role: '직원', position: '대리', email: 'test@example.invalid', profile: '' };
const leader: Member = { ...employee, id: 'leader', name: 'test 팀장', position: '팀장' };

test('확인 요청 → 답변 → 최종 일정 → MD·마케팅·물류 보고의 근거가 이어진다', () => {
  assert.equal(routeFor('request_check', employee, [employee, leader]).owner?.id, leader.id);
  const request = { id: 'request', created_by_name: employee.name, team: employee.team, kind: 'request_check',
    raw_text: 'W컨셉 기획전 참여 여부 확인 요청', status: 'done', created_at: now.toISOString(), done_at: now.toISOString(),
    reply_text: '10월 20일 참여, 할인율은 15%로 확정', replied_by_name: leader.name };
  const confirmed = schedulePayload({ title: 'W컨셉 파니에 토트', channel: 'W컨셉', workspace: 'LUMEN', startDate: '2026-10-20', discountRate: 15 });
  const schedule = { id: 'schedule', created_by_name: employee.name, team: employee.team, kind: 'schedule',
    raw_text: '10월 20일 파니에 토트 20% 예정', status: 'done', created_at: '2026-08-01T01:00:00Z',
    done_at: now.toISOString(), done_by_name: leader.name, confirmed_payload: confirmed,
    shared_teams: ['마케팅', '물류·CS', '마케팅'], related_id: request.id };
  const cards = [request, schedule].map(c => ({ ...c, _org: orgOf(c, new Set()) }));
  const md = judge('국내 MD', cards, new Set(), '2026-10-10', undefined, now);
  assert.equal(md.stats.doneToday, 2);
  assert.equal(md.stats.open, 0);
  assert.equal(md.stats.shared, 0);
  for (const team of ['마케팅', '물류·CS']) {
    const report = judge(team, cards, new Set(), '2026-10-10', undefined, now);
    assert.equal(report.stats.shared, 1);
    assert.equal(report.stats.sharedToday, 1);
    assert.equal(report.stats.doneToday, 0);
    assert.equal(report.stats.open, 0);
    assert.equal(report.status, 'work');
    assert.match(cardEvidence(report.shared[0]), /"discountRate":15/);
    assert.match(cardEvidence(report.shared[0]), /확정\(test 팀장\)/);
    assert.match(cardEvidence(report.shared[0]), /20% 예정/);
  }
  assert.match(cardEvidence(cards[0]), /답변 test 팀장: 10월 20일/);
  assert.equal(judge('영업', cards, new Set(), '2026-10-10', undefined, now).shared.length, 0);
});

test('질문·취소·본인 팀 중복 공유를 다른 팀의 업무로 집계하지 않는다', () => {
  const base = { _org: '국내 MD', created_at: now.toISOString(), done_at: now.toISOString(), shared_teams: ['마케팅', '국내 MD'] };
  const cards = [{ ...base, kind: 'question', status: 'done' }, { ...base, kind: 'schedule', status: 'cancelled' }];
  assert.equal(judge('마케팅', cards, new Set(), '2026-10-10', undefined, now).stats.shared, 0);
});

test('KST 자정 전 완료한 공유와 자체 업무는 오늘 처리로 세지 않는다', () => {
  const base = { _org: '국내 MD', kind: 'schedule', status: 'done', created_at: '2026-09-01T01:00:00Z', done_at: '2026-10-09T14:59:59Z', shared_teams: ['마케팅'] };
  assert.equal(judge('국내 MD', [base], new Set(), '2026-10-10', undefined, now).stats.doneToday, 0);
  assert.equal(judge('마케팅', [base], new Set(), '2026-10-10', undefined, now).stats.sharedToday, 0);
});

test('오래전 등록한 미래 확정 일정도 보고 자료의 조회 조건에 포함한다', async () => {
  let path = '';
  await reportingCards('*', '2026-09-10', async query => { path = query; return { ok: true, status: 200, json: async () => [] }; });
  assert.match(path, /and\(kind.eq.schedule,status.eq.done,confirmed_payload->>endDate.gte.\d{4}-\d{2}-\d{2}\)/);
});

test('질문 근거의 HTTP 실패·잘못된 자료는 0건 정상 조회로 변환하지 않는다', async () => {
  await assert.rejects(readRows('campaigns?select=*', async () => ({ ok: false, status: 503, json: async () => [] })), /503/);
  await assert.rejects(readRows('work_cards?select=*', async () => ({ ok: true, status: 200, json: async () => ({ error: 'bad' }) })), /형식 오류/);
});

test('원문에 없고 확정할 때 추가된 상품·채널도 검색·중요 근거 선정에 사용한다', async () => {
  let path = '';
  await searchCards('파니에', '', async query => { path = query; return { ok: true, status: 200, json: async () => [] }; });
  assert.match(decodeURIComponent(path), /confirmed_payload->>products.ilike.\*파니에\*/);
  const confirmed = { id: 'old', raw_text: '기획전 일정', created_at: '2026-08-01', confirmed_payload: { products: '파니에 토트' } };
  assert.equal(prioritizeCards([{ id: 'new', raw_text: '다른 업무', created_at: '2026-10-10' }, confirmed], '파니에', 1)[0].id, 'old');
});
