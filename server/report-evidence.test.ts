import assert from 'node:assert/strict';
import test from 'node:test';
import { attachSampleEvidence, councilStamp, evidenceFreshness, evidenceStamp, reportStamp, sampleEvidence, shopReportFreshness } from './report-evidence.js';
import { attachCampaignEvidence, campaignEvidence } from './campaign-evidence.js';

test('불완전·실패한 자사몰 점검은 최신 결정 근거가 될 수 없다', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const evidence = { complete: true, hash: 'a'.repeat(64), checkedAt: new Date(now).toISOString() };
  const report = { model: 'rule-based', stats: { reportAvailable: true, complete: true, evidence } };
  assert.equal(shopReportFreshness(report, now), 'current');
  assert.equal(shopReportFreshness({ ...report, stats: { ...report.stats, complete: false } }, now), 'unknown');
  assert.equal(shopReportFreshness({ ...report, stats: { ...report.stats, evidence: { ...evidence, complete: false } } }, now), 'unknown');
  assert.equal(shopReportFreshness(report, now + 25 * 3600e3), 'unknown');
});

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

const sampleCard = { id:'wc_sample',kind:'request_check',status:'done',assignee_id:'lead',
  parsed:{sampleReview:true,sampleId:'sample_a'},result_ref:{table:'samples',id:'sample_a'},
  confirmed_payload:{sampleId:'sample_a',acceptedBy:'lead',sampleUnitPrice:50000},
  _campaignEvidence:{state:'unlinked'} };
const sampleRow = { id:'sample_a',style_name:'Reviewed',buyer_id:'buyer',brand_code:'FB',
  review_card_id:'wc_sample',review_assignee_id:'lead',review_status:'accepted',
  completed_at:'2026-10-10T01:00:00Z',accepted_at:'2026-10-10T02:00:00Z',accepted_by:'lead',
  sample_unit_price:50000,billing_status:'미청구',billing_statement_id:null,workflow_version:2,updated_at:'v2' };
const sampleStamp = (cards:any[]) => reportStamp('제품개발',cards,[],[],{},'idle',[],'','2026-10-11');
const readSample = (rows:any[]) => async () => ({ok:true,json:async()=>rows});

test('수락 샘플은 캠페인 연결 대신 현재 원본으로 검증하고 청구·가격·바이어 변경을 감지한다',async()=>{
  let path='';
  const cards=await attachSampleEvidence([sampleCard],async p=>{path=p;return {ok:true,json:async()=>[sampleRow]};});
  assert.match(path,/^samples\?id=in\.\(sample_a\)/);
  assert.equal(cards[0]._sampleEvidence.state,'current');
  const saved=sampleStamp(cards);assert.equal(saved.complete,true);
  assert.equal(evidenceFreshness(saved,sampleStamp(await attachSampleEvidence([sampleCard],readSample([sampleRow])))),'current');
  for(const change of [{sample_unit_price:75000},{buyer_id:'another'},{brand_code:'NEW'},
    {style_name:'Renamed'},{billing_status:'청구완료',billing_statement_id:'statement'},
    {billing_status:'수금완료',collected_date:'2026-10-11'},{workflow_version:3}]) {
    const current=sampleStamp(await attachSampleEvidence([sampleCard],readSample([{...sampleRow,...change}])));
    assert.equal(evidenceFreshness(saved,current),'changed');
  }
  const later=structuredClone(cards);later[0]._sampleEvidence.checkedAt='later';
  later[0]._campaignEvidence={state:'unavailable'};
  assert.equal(evidenceFreshness(saved,sampleStamp(later)),'current');
  assert.equal((sampleCard as any)._sampleEvidence,undefined);
});

test('샘플 원본 삭제·조회실패·잘못된 연결·검증 누락은 최신 상태로 인정하지 않는다',async()=>{
  const saved=sampleStamp(await attachSampleEvidence([sampleCard],readSample([sampleRow])));
  for(const read of [readSample([]),async()=>({ok:false,json:async()=>[]}),async()=>{throw Error('offline');},
    readSample([{...sampleRow,review_card_id:'another'}]),readSample([{...sampleRow,review_assignee_id:'other'}]),
    readSample([{...sampleRow,review_status:'pending'}]),readSample([{...sampleRow,workflow_version:undefined}]),
    readSample([sampleRow,sampleRow]),readSample([{...sampleRow,id:'unexpected'}])]) {
    assert.equal(evidenceFreshness(saved,sampleStamp(await attachSampleEvidence([sampleCard],read))),'unknown');
  }
  assert.equal(evidenceFreshness(saved,sampleStamp([sampleCard])),'unknown');
  let reads=0;
  for(const c of [{...sampleCard,result_ref:{table:'samples',id:'unsafe,id'}},
    {...sampleCard,parsed:{sampleReview:true,sampleId:'wrong'}},
    {...sampleCard,confirmed_payload:{sampleId:'wrong'}}]) {
    const cards=await attachSampleEvidence([c],async()=>{reads++;return {ok:true,json:async()=>[sampleRow]};});
    assert.equal(cards[0]._sampleEvidence.state,'unlinked');assert.equal(sampleStamp(cards).complete,false);
  }
  assert.equal(reads,0);
});

test('수락 대기 샘플도 원본을 검증하고 일반 일정 카드는 기존 검증을 유지한다',async()=>{
  const pending={...sampleCard,status:'open',confirmed_payload:null};
  const current={...sampleRow,review_status:'pending',accepted_at:null,accepted_by:null};
  const cards=await attachSampleEvidence([pending,card],readSample([current]));
  assert.equal(cards[0]._sampleEvidence.state,'current');assert.equal(sampleStamp(cards).complete,true);
  assert.equal(cards[1],card);
  assert.equal(sampleStamp([pending]).complete,false);
});

test('샘플 카드는 캠페인 연결 판정을 건너뛰고 보고에는 현재 샘플 원본을 넣는다',async()=>{
  const original={...sampleCard};delete (original as any)._campaignEvidence;
  const campaignChecked=await attachCampaignEvidence([original],async()=>{throw Error('campaign lookup forbidden');});
  assert.equal(campaignChecked[0],original);assert.equal(campaignEvidence(original),'');
  await attachCampaignEvidence([{...original,result_ref:{table:'campaigns',id:'cmp_a'}}],async()=>{throw Error('sample marker must not query campaigns');});
  const [verified]=await attachSampleEvidence(campaignChecked,readSample([sampleRow]));
  assert.match(sampleEvidence(verified),/현재 원본 샘플.*"sample_unit_price":50000/);
  assert.match(sampleEvidence(original),/샘플 원본 현재 상태 미확인/);
  assert.equal(sampleEvidence(card),'');
});

test('샘플 원본은 중복 없이 배치 조회하며 일부 실패가 다른 배치의 검증을 바꾸지 않는다',async()=>{
  const cards=Array.from({length:81},(_,i)=>({...sampleCard,id:`wc_${i}`,parsed:{sampleReview:true,sampleId:`s_${i}`},
    result_ref:{table:'samples',id:`s_${i}`},confirmed_payload:{sampleId:`s_${i}`}}));
  let reads=0;
  const enriched=await attachSampleEvidence([...cards,cards[0]],async path=>{
    reads++;const ids=path.match(/id=in\.\(([^)]+)\)/)![1].split(',');
    return {ok:reads===1,json:async()=>ids.map(id=>({...sampleRow,id,review_card_id:`wc_${id.slice(2)}`}))};
  });
  assert.equal(reads,2);assert.equal(enriched[0]._sampleEvidence.state,'current');
  assert.equal(enriched[80]._sampleEvidence.state,'unavailable');assert.equal(enriched[81]._sampleEvidence.state,'current');
});

test('실제 agents 자료 조회·보고 최신성 흐름이 샘플 원본을 매번 다시 읽는다',async()=>{
  const {loadReportContext,teamEvidence}=await import('./agents.js');
  const {_campaignEvidence,...rawSampleCard}=sampleCard;
  const previousFetch=globalThis.fetch;let source={...sampleRow};let sourceReads=0;
  globalThis.fetch=async input=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    const table=url.pathname.split('/').at(-1);
    let rows:any[]=[];
    if(table==='work_cards')rows=[{...rawSampleCard,team:'제품개발',created_by:'staff',created_by_name:'Fixture Staff',created_at:new Date().toISOString()}];
    if(table==='app_users')rows=[{id:'staff',name:'Fixture Staff',team:'제품개발',role:'사원',email:'fixture@example.invalid',is_active:true}];
    if(table==='samples') {rows=[source];if(url.searchParams.get('id'))sourceReads++;}
    return new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json'}});
  };
  try {
    const first=await loadReportContext();assert.equal(first.cards[0]._sampleEvidence.state,'current');
    assert.equal(first.cards[0]._campaignEvidence,undefined);first.watch=new Map();
    const saved=teamEvidence('제품개발',first);assert.equal(saved.complete,true);
    source={...source,sample_unit_price:75000,workflow_version:3};
    const second=await loadReportContext();second.watch=new Map();
    assert.equal(evidenceFreshness(saved,teamEvidence('제품개발',second)),'changed');
    assert.equal(sourceReads,2);
  }finally{globalThis.fetch=previousFetch;}
});
