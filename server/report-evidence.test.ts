import assert from 'node:assert/strict';
import test from 'node:test';
import { councilStamp, evidenceFreshness, evidenceStamp, reportStamp } from './report-evidence.js';

const card = {id:'wc_1',kind:'schedule',status:'done',confirmed_payload:{discountRate:20},
  result_ref:{table:'campaigns',id:'cp_1'},_campaignEvidence:{state:'current',checkedAt:'first',
    current:{id:'cp_1',status:'confirmed',discount_rate:20,start_date:'2026-10-20',updated_at:'v1'}}};
const stamp = (c:any=card, extras:any={}) => reportStamp('마케팅',[],[c],extras.people||[],
  {open:0},'idle',extras.facts||[],extras.rules||'확인 후 실행',extras.today||'2026-10-10');

test('같은 날 일정·할인·상태·업무 변경도 보고 근거 변경으로 판정한다', () => {
  const original=stamp();
  for (const change of [{discount_rate:15},{start_date:'2026-11-20'},{status:'closed'},{updated_at:'v2'}]) {
    assert.equal(evidenceFreshness(original,stamp({...card,_campaignEvidence:{...card._campaignEvidence,
      current:{...card._campaignEvidence.current,...change}}})),'changed');
  }
  assert.equal(evidenceFreshness(original,stamp({...card,reply_text:'준비 완료'})),'changed');
  assert.equal(evidenceFreshness(original,stamp(card,{people:[{id:'u',profile:'새 담당 범위'}]})),'changed');
  assert.equal(evidenceFreshness(original,stamp(card,{rules:'승인 먼저'})),'changed');
  assert.equal(evidenceFreshness(original,stamp(card,{facts:['품절 2건']})),'changed');
  assert.equal(evidenceFreshness(original,stamp(card,{today:'2026-10-11'})),'changed');
});

test('조회시각·읽음상태·객체 키/카드 순서는 동일 근거를 바꾸지 않는다', () => {
  const fresh=stamp({...card,read_by:['u'],_campaignEvidence:{...card._campaignEvidence,checkedAt:'later'}});
  assert.equal(evidenceFreshness(stamp(),fresh),'current');
  assert.equal(evidenceStamp('s',{a:1,b:2}).hash,evidenceStamp('s',{b:2,a:1}).hash);
  const rows=[{id:'b',kind:'todo'},{id:'a',kind:'todo'}];
  const make=(cs:any[])=>reportStamp('t',cs,[],[],{},'idle',[],'','2026-10-10');
  assert.equal(make(rows).hash,make([...rows].reverse()).hash);
});

test('과거 메타데이터 없음·원천 실패·연결 없음은 최신으로 처리하지 않는다', () => {
  assert.equal(evidenceFreshness(undefined,stamp()),'unknown');
  assert.equal(evidenceFreshness(stamp(),stamp(card,{facts:['현재 상태 미확인 — 조회 실패']})),'unknown');
  assert.equal(evidenceFreshness(stamp(),stamp(card,{facts:['원화 값이 비어 있음 — 확인 필요']})),'unknown');
  for (const state of ['unavailable','missing','unlinked']) {
    assert.equal(evidenceFreshness(stamp(),stamp({...card,_campaignEvidence:{state}})),'unknown');
  }
  const incomplete=evidenceStamp('scope',{x:1},false);
  assert.equal(evidenceFreshness(incomplete,evidenceStamp('scope',{x:1})),'unknown');
  assert.equal(evidenceFreshness(stamp(),evidenceStamp('another',{})),'unknown');
});

test('저장 시점 입력은 이후 입력 변경으로 최신 상태가 되지 않는다', () => {
  const mutable=structuredClone(card),saved=stamp(mutable);
  mutable._campaignEvidence.current.discount_rate=15;
  assert.equal(evidenceFreshness(saved,stamp(mutable)),'changed');
});

test('협의 근거는 조회시각·팀 순서를 제외하고 변경·다음날을 구분한다', () => {
  const c={triggerKey:'card:wc_1',topic:'공동 준비',teams:['마케팅','물류·CS'],
    evidence:{마케팅:['card:wc_1 현재 20% (조회 2026-10-10T00:00:00Z)'], '물류·CS':['card:wc_1 준비 대기']}};
  const saved=councilStamp(c,'2026-10-10');
  assert.equal(evidenceFreshness(saved,councilStamp({...c,teams:[...c.teams].reverse(),
    evidence:{...c.evidence,마케팅:['card:wc_1 현재 20% (조회 2026-10-10T02:00:00Z)']}},'2026-10-10')),'current');
  assert.equal(evidenceFreshness(saved,councilStamp({...c,topic:'새 결정'},'2026-10-10')),'changed');
  assert.equal(evidenceFreshness(saved,councilStamp(c,'2026-10-11')),'changed');
  assert.equal(evidenceFreshness(saved,undefined),'unknown');
});
