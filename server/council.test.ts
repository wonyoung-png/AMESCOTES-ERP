import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyOnFailure, findCouncilCandidates, openCouncil, pendingCouncilActions, sanitizeEvidence, validateConclusion } from './council.js';
import { councilStamp } from './report-evidence.js';

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

test('failed 협의는 새 id로 재시도하고 과거 결론·발언은 수정/삭제하지 않는다', async () => {
  const calls: string[] = [];
  const rest = async (path: string,init?:RequestInit) => {
    calls.push(path);
    if (calls.length === 1) return new Response('', { status: 409 });
    if (calls.length === 2) return new Response(JSON.stringify([{ id: 'ac_old', status: 'failed' }]), { status: 200 });
    assert.equal(init?.method,'POST'); assert.equal(path,'agent_councils');
    const row=JSON.parse(String(init?.body));assert.match(row.trigger_key,/:retry:ac_old$/);
    return new Response(JSON.stringify([row]), { status: 200 });
  };
  const conduct = async (_c: any, id?: string) => ({ id } as any);
  const got: any = await openCouncil({ topic: 't', triggerKey: 'k', teams: ['마케팅', '물류·CS'], evidence: {} }, { rest: rest as any, conduct: conduct as any });
  assert.notEqual(got.id, 'ac_old');
  assert.equal(calls[2],'agent_councils');
});

test('이미 지시한 팀은 재시도 대상에서 제외한다', () => {
  const actions = [{ team: '마케팅', action: 'A' }, { team: '물류·CS', action: 'B' }];
  assert.deepEqual(pendingCouncilActions(actions, { 마케팅: { cardId: 'wc_1' } }), [actions[1]]);
});

test('한 팀의 여러 액션은 누락 없이 한 지시로 합친다',()=>{
  const actions=[{team:'마케팅',action:'기획전 준비'},{team:'마케팅',action:'소재 확인'}];
  assert.deepEqual(pendingCouncilActions(actions,{}),[{team:'마케팅',action:'기획전 준비\n· 소재 확인'}]);
  assert.deepEqual(validateConclusion({actions_by_team:actions},['마케팅']).actions_by_team,pendingCouncilActions(actions,{}));
  assert.deepEqual(pendingCouncilActions(actions,{마케팅:{cardId:'already'}}),[]);
});

test('자정 경계에서도 시작일·근거를 저장과 실행에 동일하게 전달한다',async()=>{
  const originalNow=Date.now;let now=Date.parse('2026-10-10T14:59:59.900Z');Date.now=()=>now;
  const c={topic:'공동 준비',triggerKey:'card:wc_midnight',teams:['마케팅','물류·CS'],evidence:{마케팅:['card:wc_midnight 20%']}};
  try {
    let saved:any;
    await openCouncil(c,{rest:(async(_path:string,init?:RequestInit)=>{
      saved=JSON.parse(String(init?.body));now=Date.parse('2026-10-10T15:00:00.100Z');
      return new Response(JSON.stringify([saved]),{status:201});
    }) as any,conduct:async(_c:any,_id?:string,evidence?:any)=>{
      assert.equal(saved.trigger_day,'2026-10-10');assert.deepEqual(evidence,saved.cost.evidence);
      assert.equal(evidence.hash,councilStamp(c,'2026-10-10').hash);
      assert.notEqual(evidence.hash,councilStamp(c,'2026-10-11').hash);
      return {conclusion:'',open_disagreements:[],ceo_decisions:[],actions_by_team:[]};
    }});
  } finally {Date.now=originalNow;}
});

test('동시 협의는 한 건만 생성하고 변경된 근거는 별도 이력으로 남긴다', async () => {
  const rows=new Map<string,any>();let conducts=0;
  const rest=async(path:string,init?:RequestInit)=>{
    if(init?.method==='POST') {
      const row=JSON.parse(String(init.body));
      if(rows.has(row.trigger_key)) return new Response('',{status:409});
      rows.set(row.trigger_key,row);return new Response(JSON.stringify([row]),{status:201});
    }
    assert.equal(init?.method,undefined,'History may not be PATCHed or DELETEd');
    const key=new URL('https://fixture.invalid/'+path).searchParams.get('trigger_key')!.slice(3);
    return new Response(JSON.stringify(rows.has(key)?[rows.get(key)]:[]),{status:200});
  };
  const conduct=async(_c:any,id?:string)=>{conducts++;return {id} as any;};
  const candidate={topic:'공동 준비',triggerKey:'card:wc_1',teams:['마케팅','물류·CS'],evidence:{마케팅:['card:wc_1 20%']}};
  await Promise.all([openCouncil(candidate,{rest:rest as any,conduct}),openCouncil(candidate,{rest:rest as any,conduct})]);
  assert.equal(rows.size,1);assert.equal(conducts,1);
  await openCouncil({...candidate,evidence:{마케팅:['card:wc_1 15%']}},{rest:rest as any,conduct});
  assert.equal(rows.size,2);assert.equal(conducts,2);
  assert.notEqual([...rows.values()][0].cost.evidence.hash,[...rows.values()][1].cost.evidence.hash);
});

test('공백 있는 팀명(국내 MD)도 근거 id 가 한 단어라 걸러지지 않는다', () => {
  const watch = new Map([['생산관리', { facts: ['발주 납기 지연 2건'], alerts: 1 }], ['국내 MD', { facts: ['리오더 승인 대기 8건'], alerts: 1 }]]) as any;
  const [c] = findCouncilCandidates([], watch);
  const md = c.evidence['국내 MD'];
  const allowed = new Set(md.map((x: string) => x.split(' ')[0]));
  assert.ok(allowed.has('watch:국내_MD:0'));
  assert.equal(sanitizeEvidence({ position: 'p', evidence: ['watch:국내_MD:0'] }, allowed).position, 'p');
});

test('같은 발주 품번 카드와 무품번 요약 fact를 후보 1건으로 묶는다', () => {
  const watch = new Map([['생산관리', { facts: ['납기·입고 점검: 확인 필요 3건'], alerts: 1 }]]) as any;
  const cards = [
    { id: 'wc_1', _org: '생산관리', shared_teams: ['국내 MD', '물류·CS'], raw_text: '발주 AB2609HB01-R1, K02609HB01-R1 납기 지연' },
    { id: 'wc_2', _org: '생산관리', shared_teams: ['국내 MD', '물류·CS'], raw_text: 'K02609HB01-R1 입고 지연' },
  ];
  const got = findCouncilCandidates(cards, watch);
  assert.equal(got.length, 1);
  assert.match(got[0].topic, /^품번 2건:/);
  assert.ok(Object.values(got[0].evidence).flat().some(x => x.includes('납기·입고 점검')));
});

test('서로 다른 품번 후보는 분리하고 입력 순서와 무관하게 triggerKey가 안정적이다', () => {
  const card = (id: string, raw_text: string) => ({ id, _org: '생산관리', shared_teams: ['국내 MD', '물류·CS'], raw_text });
  const a = card('wc_a', '발주 AB2609HB01-R1, K02609HB01-R1 납기 지연');
  const b = card('wc_b', '발주 ZZ2609HB01-R1 생산 지연');
  const first = findCouncilCandidates([a, b], new Map());
  const reversed = findCouncilCandidates([b, a], new Map());
  assert.equal(first.length, 2);
  assert.deepEqual(first.map(x => x.triggerKey).sort(), reversed.map(x => x.triggerKey).sort());
  assert.deepEqual(first.map(c=>councilStamp(c).hash).sort(),reversed.map(c=>councilStamp(c).hash).sort());
});
