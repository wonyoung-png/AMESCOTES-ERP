import assert from 'node:assert/strict';
import test from 'node:test';
import { judge, missingScheduleTeams } from './agents';

test('팀 에이전트는 하루 1,000건을 잘림 없이 집계한다', () => {
  const now = new Date().toISOString();
  const cards = Array.from({ length: 1000 }, (_, i) => ({
    id: `c${i}`, _org: '국내 MD', kind: 'todo', status: i < 900 ? 'open' : 'done',
    created_at: now, done_at: i < 900 ? null : now, parsed: {},
  }));
  const result = judge('국내 MD', cards, new Set(), '2026-10-09');
  assert.equal(result.stats.total30, 1000);
  assert.equal(result.stats.open, 900);
  assert.equal(result.stats.doneToday, 100);
});

test('일일 점검은 이미 완료된 팀을 제외하고 누락 팀만 찾는다', () => {
  const missing = missingScheduleTeams(['국내 MD', '생산관리']);
  assert.equal(missing.includes('국내 MD'), false);
  assert.equal(missing.includes('생산관리'), false);
  assert.equal(missing.length, 12);
});
