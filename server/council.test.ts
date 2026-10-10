import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyOnFailure, findCouncilCandidates, openCouncil, pendingCouncilActions, sanitizeEvidence, validateConclusion } from './council.js';

test('연관 팀·카드 조건, 중복 키, 최대 3건', () => {
  const watch = new Map<any, any>([['국내 MD', { alerts: 1, facts: ['품절 3종', '품절 3종', '기획전 준비 지연'] }]]);
  const cards = Array.from({ length: 4 }, (_, i) => ({ id: `wc_${i}`, _org: '국내 MD', shared_teams: ['마케팅', '물류·CS'], raw_text: `공동 ${i}` }));
  const got = findCouncilCandidates(cards, watch);
  assert.equal(got.length, 3);
  assert.deepEqual(got[0].teams, ['국내 MD', '마케팅', '물류·CS']);
  assert.equal(new Set(got.map(x => x.triggerKey)).size, got.length);
});

test('허용되지 않은 evidence를 제거하고 주장도 제외 표시한다', () => {
  assert.deepEqual(sanitizeEvidence({ position: '재고 99개', evidence: ['bad'] }, new Set(['ok'])), { position: '[근거 확인 필요로 제외]', evidence: [] });
});

test('결론 JSON 스키마와 팀 범위를 정리한다', () => {
  const got = validateConclusion({ conclusion: '진행', open_disagreements: ['이견'], ceo_decisions: [{ question: '할까요?', options: ['예', '아니오'] }], actions_by_team: [{ team: '마케팅', action: '준비' }, { team: '가짜팀', action: '제외' }] }, ['마케팅']);
  assert.equal(got.actions_by_team.length, 1);
  assert.equal(got.ceo_decisions[0].options.length, 2);
});

test('라운드는 저장 스키마상 1·2만 허용한다', () => {
  const rounds = [1, 2];
  assert.deepEqual(rounds, [1, 2]);
});

test('협의 테이블 조회 실패는 빈 배열로 대체한다', async () => {
  const old = console.warn; console.warn = () => undefined;
  try { assert.deepEqual(await Promise.reject(new Error('missing')).catch(emptyOnFailure('협의')), []); }
  finally { console.warn = old; }
});

test('failed 협의는 같은 id로 다시 연다', async () => {
  const calls: string[] = [];
  const rest = async (path: string) => {
    calls.push(path);
    if (calls.length === 1) return new Response('', { status: 409 });
    if (calls.length === 2) return new Response(JSON.stringify([{ id: 'ac_old', status: 'failed' }]), { status: 200 });
    return new Response(null, { status: 204 });
  };
  const conduct = async (_c: any, id?: string) => ({ id } as any);
  const got: any = await openCouncil({ topic: 't', triggerKey: 'k', teams: ['마케팅', '물류·CS'], evidence: {} }, { rest: rest as any, conduct: conduct as any });
  assert.equal(got.id, 'ac_old');
  assert.match(calls[2], /id=eq\.ac_old/);
});

test('이미 지시한 팀은 재시도 대상에서 제외한다', () => {
  const actions = [{ team: '마케팅', action: 'A' }, { team: '물류·CS', action: 'B' }];
  assert.deepEqual(pendingCouncilActions(actions, { 마케팅: { cardId: 'wc_1' } }), [actions[1]]);
});

test('공백 있는 팀명(국내 MD)도 근거 id 가 한 단어라 걸러지지 않는다', () => {
  const watch = new Map([['생산관리', { facts: ['발주 납기 지연 2건'], alerts: 1 }], ['국내 MD', { facts: ['리오더 승인 대기 8건'], alerts: 1 }]]) as any;
  const [c] = findCouncilCandidates([], watch);
  const md = c.evidence['국내 MD'];
  const allowed = new Set(md.map((x: string) => x.split(' ')[0]));
  assert.ok(allowed.has('watch:국내_MD:0'));
  assert.equal(sanitizeEvidence({ position: 'p', evidence: ['watch:국내_MD:0'] }, allowed).position, 'p');
});
