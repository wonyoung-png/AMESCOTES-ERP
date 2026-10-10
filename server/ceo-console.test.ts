import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./ceo-console.html', import.meta.url), 'utf8');
// 실제 배포 함수에 합성 데이터를 넣어 검증한다. DOM이나 실자료는 변경하지 않는다.
const source = html.slice(html.indexOf('function agentList()'), html.indexOf('function mapView()'));
const list = new Function('D', source + '\nreturn agentList();');
const data = (alerts = 0) => ({
  org: { teams: [{ key: '생산관리', division: '생산' }] }, decide: [],
  teams: [{ team: '생산관리', open: 0, overdue: 0, newToday: 0, doneToday: 2 }],
  agents: [{ team: '생산관리', status: 'warn', headline: '과거 보고', stats: { open: 99, toCeo: 9, facts: ['과거'] } }],
  watch: [{ team: '생산관리', alerts, facts: ['현재'] }],
});

test('대표 콘솔의 실제 인라인 스크립트 문법', () => {
  for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('오늘 작성한 옛 보고의 경고 색과 숫자도 현재 근거로 대체한다', () => {
  const [a] = list(data());
  assert.equal(a.status, 'idle');
  assert.equal(a.stats.open, 0);
  assert.equal(a.stats.toCeo, 0);
  assert.equal(a.stats.doneToday, 2);
  assert.deepEqual(a.stats.facts, ['현재']);
  assert.equal(a.liveFacts, true);
});

test('현재 운영 경고와 대표 확인 요청으로 지도 상태를 결정한다', () => {
  assert.equal(list(data(1))[0].status, 'warn');
  const d: any = data();
  d.decide = [{ kind: 'request_check', _org: '생산관리' }];
  assert.equal(list(d)[0].status, 'report');
  assert.equal(list(d)[0].stats.toCeo, 1);
});

test('지도는 오늘 공유받은 근거를 표시하되 팀 완료 건수에 더하지 않는다', () => {
  const d: any = data();
  d.teams[0].shared = 3;
  d.teams[0].sharedToday = 1;
  const [a] = list(d);
  assert.equal(a.status, 'work');
  assert.equal(a.stats.shared, 3);
  assert.equal(a.stats.sharedToday, 1);
  assert.equal(a.stats.doneToday, 2);
});
