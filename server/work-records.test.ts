import assert from 'node:assert/strict';
import test from 'node:test';
import { allRows, reportingCards, prioritizeCards, searchCards, dayStartUtc } from './work-records';

test('과거 검색은 검색 조건과 조회 권한 조건을 AND로 묶는다', async () => {
  let query = '';
  await searchCards('W컨셉 20%', '&or=(created_by.eq.me,team.eq.MD)', async path => { query = path; return { ok: true, status: 200, json: async () => [] }; });
  const params = new URLSearchParams(query.split('?')[1]);
  assert.equal(params.has('or'), false);
  assert.match(params.get('and')!, /^\(or\(raw_text/);
  assert.match(params.get('and')!, /or\(created_by.eq.me,team.eq.MD\)\)$/);
});

test('데일리 기준은 한국 자정이며 직전 24시간이 아니다', () => {
  assert.equal(dayStartUtc(new Date('2026-10-09T01:00:00Z')), '2026-10-08T15:00:00.000Z');
});

test('일 1,000건 이상 보고 자료는 마지막 페이지까지 읽는다', async () => {
  const calls: string[] = [];
  const read = async (path: string) => {
    calls.push(path);
    const offset = Number(new URLSearchParams(path.split('?')[1]).get('offset'));
    return { ok: true, status: 200, json: async () => Array.from({ length: Math.max(0, Math.min(500, 1251 - offset)) }, (_, i) => ({ id: offset + i })) };
  };
  assert.equal((await reportingCards('*', '2026-09-09', read)).length, 1251);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /status.eq.open/);
  assert.match(calls[0], /done_at.gte/);
});

test('페이지 조회 실패는 빈 정상 집계로 바꾸지 않는다', async () => {
  await assert.rejects(allRows('work_cards?select=id', async () => ({ ok: false, status: 503, json: async () => [] })), /503/);
});

test('최신 완료건보다 오래된 연체와 질문 관련 결정을 먼저 읽는다', () => {
  const cards = Array.from({ length: 200 }, (_, i) => ({ id: String(i), status: 'done', raw_text: '완료', created_at: '2026-10-09' }));
  cards.push({ id: 'old', status: 'open', raw_text: 'W컨셉 결정', created_at: '2026-01-01' });
  assert.equal(prioritizeCards(cards, 'W컨셉', 1)[0].id, 'old');
});
