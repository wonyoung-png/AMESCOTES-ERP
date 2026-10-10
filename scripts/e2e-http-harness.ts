// Disposable-stack entry point, not an application route or production entry point.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import sessionRouter from '../server/session';
import workRouter from '../server/work';
import ceoRouter, { ceoHostLock } from '../server/ceo';
import receiptRouter from '../server/receipt-workflow';
import payableRouter from '../server/payable-payment';
import { rest, restAsServer, requireUser } from '../server/auth';
import { verifyFinanceHttp } from './e2e-finance-http';
import { verifyWorkHttp, workHttpLlmCases, ceoLoopbackRequest } from './e2e-work-http';
import { deliverWorkNotifications } from '../server/work-notifications';
import { loadReportContext } from '../server/agents';
import { findCouncilCandidates, openCouncil } from '../server/council';
import { orgTeam } from '../server/org';
import {directiveFlowModel,verifyCeoDirectiveHttp} from './e2e-ceo-directive-http';

const REST = 'http://erp-e2e-api-20261010:3000';
assert.equal(process.env.ERP_E2E_ISOLATED, '20261010');
assert.equal(process.env.POSTGREST_URL, REST);
assert.equal(process.env.ERP_PRIVATE_MODE, 'false'); // Test members only; production remains true.
assert.ok(process.env.PGRST_JWT_SECRET && process.env.PGRST_JWT_SECRET.length >= 32);
const originalFetch = globalThis.fetch;
const forbidden: string[] = [];
let modelCalls = 0;
let evidenceChecks = 0;
let mutationRace: { id: string; kind: string } | null = null;
let changedCampaignCard: string | null = null;
let changedCampaignPrompts = 0;
let changedCampaignSource: { id: string; updatedAt: string } | null = null;
let deliveryFailure: 'before' | 'after' | null = null;
let rulesUnavailable=false;
let directiveResponseLost=false;
let directedRecordFailure=false;
function assertChangedCampaignLine(message: string) {
  assert.ok(changedCampaignCard && changedCampaignSource);
  const line = message.split('\n').find(line => line.startsWith('- id=' + changedCampaignCard + ' '));
  assert.ok(line, 'The historical card itself must be present');
  assert.match(line, /당시 확정.*"discountRate":20/);
  const current = line.split('연결된 현재 운영캘린더')[1];
  assert.ok(current, 'The same historical card must carry linked current evidence');
  for (const field of [`"id":"${changedCampaignSource.id}"`, '"discountRate":15', '"startDate":"2026-11-20"',
    `"updatedAt":${JSON.stringify(changedCampaignSource.updatedAt)}`]) assert.ok(current.includes(field), 'Missing same-card current field: ' + field);
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === 'https://api.anthropic.com') {
    modelCalls++;
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : '{}');
    const request = JSON.parse(String(raw));
    const message = String(request.messages?.[0]?.content || '');
    let output: string;
    const directiveOutput=directiveFlowModel(request);
    if(directiveOutput!==undefined) output=directiveOutput;
    else if (String(request.system).includes('업무 카드로 바꾼다')) {
      const example = changedCampaignCard && message === 'CURRENT_CAMPAIGN_FIXTURE 현재 일정 할인 알려줘'
        ? { response: { kind: 'question', relatedId: null, parsed: { answer: '' } } }
        : Object.values(workHttpLlmCases('2026-10-20')).find(c => c.text === message);
      assert.ok(example, 'Unknown model fixture input');
      output = JSON.stringify(example.response);
    } else if (String(request.system).includes('팀 감독 에이전트')) {
      assert.match(message, /확정.*discountRate[^\d]*20/s, 'Final confirmed payload missing from team report prompt');
      assert.match(message, /다른 팀에서 공유받은 근거/);
      if (changedCampaignCard) {
        assertChangedCampaignLine(message); changedCampaignPrompts++;
      } else evidenceChecks++;
      output = JSON.stringify({ headline: changedCampaignCard ? '현재 11/20 15% · 당시 결정 20%' : '10/20 확정 20% · 준비 확인 필요', summary: changedCampaignCard ? '· 현재 11/20 15%, 당시 결정 20%입니다.' : '· 공유된 일정은 10/20 확정 20%입니다.\n· 공유는 팀 준비 완료 근거가 아닙니다.', needs: [] });
    } else {
      assert.match(message, /확정.*discountRate[^\d]*20/s, 'Final confirmed payload missing from answer prompt');
      if (changedCampaignCard) {
        assertChangedCampaignLine(message); changedCampaignPrompts++;
      } else evidenceChecks++;
      output = changedCampaignCard ? '현재 일정은 2026-11-20 15%, 당시 확정 결정은 20%입니다.' : '업무 기록과 확정 일정에 따르면 2026-10-20 W컨셉 파니에 토트 20%입니다. 준비 완료 근거는 아직 확인되지 않았습니다.';
    }
    return new Response(JSON.stringify({ id: 'fixture-' + modelCalls, type: 'message', role: 'assistant', model: request.model, content: [{ type: 'text', text: output }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  // No production DB, real model, Google, SMTP, or PMS network is allowed.
  if (url.origin !== REST && url.hostname !== '127.0.0.1') {
    forbidden.push(url.origin);
    throw new Error('Isolated harness blocks external network');
  }
  if(url.origin===REST && url.pathname==='/team_watch' && rulesUnavailable) return new Response('',{status:503});
  if(url.origin===REST && url.pathname==='/work_cards' && init?.method==='POST' && directiveResponseLost
    && JSON.parse(String(init.body)).parsed?.directive) {
    directiveResponseLost=false;
    const committed=await originalFetch(input,{...init,redirect:'error'});assert.ok(committed.ok);await committed.text();
    throw new Error('Synthetic council directive committed response lost');
  }
  if(url.origin===REST && url.pathname==='/agent_councils' && init?.method==='PATCH' && directedRecordFailure
    && JSON.parse(String(init.body)).directed_cards) {
    directedRecordFailure=false;return new Response('',{status:503});
  }
  if (url.origin === REST && url.pathname === '/rpc/deliver_work_notifications' && deliveryFailure) {
    const failure = deliveryFailure; deliveryFailure = null;
    if (failure === 'after') {
      const committed = await originalFetch(input,{...init,redirect:'error'});
      assert.ok(committed.ok); await committed.text();
    }
    throw new Error('Synthetic notification delivery response failure: '+failure);
  }
  if (url.origin===REST && url.pathname==='/work_cards' && (!init?.method || init.method==='GET')
    && mutationRace && url.searchParams.get('id')==='eq.'+mutationRace.id && url.searchParams.get('select')==='*') {
    const race=mutationRace; mutationRace=null;
    const snapshot=await originalFetch(input,{...init,redirect:'error'});
    assert.ok(snapshot.ok);
    const changed=await originalFetch(REST+'/work_cards?id=eq.'+race.id,{method:'PATCH',headers:init?.headers,
      body:JSON.stringify({kind:race.kind,assignee_id:'e2e_leader',updated_at:'2099-01-01T00:00:00.000001Z'}),redirect:'error'});
    assert.ok(changed.ok,'Synthetic concurrent DB update failed');
    return snapshot;
  }
  return originalFetch(input, { ...init, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(15000) });
}) as typeof fetch;

const password = 'E2E-only-20261010!';
function simpleHash(value: string) { let h = 0; for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0; return Math.abs(h).toString(36); }
const fixtures = {
  bossEmail: 'wonyoung@atlm.kr', staffEmail: 'e2e-staff@test.invalid', leaderEmail: 'e2e-leader@test.invalid', password,
  read: async (path: string) => {
    assert.ok(/^(work_cards|notifications|campaigns|team_agent_runs|agent_councils|agent_council_messages|production_orders|trade_statements|settlements|payables)\?/.test(path), 'fixture read table not allowed');
    const r = await restAsServer(path);
    assert.ok(r.ok, `fixture read ${path}: ${r.status}`);
    return r.json();
  },
  ceoCookie: '',
  failNextDelivery:()=>{deliveryFailure='before';},
  loseNextDirectiveResponse:()=>{directiveResponseLost=true;},
  flushNotifications:deliverWorkNotifications,
  setMarketingTeam:async(team:string)=>{
    const response=await restAsServer('app_users?id=eq.e2e_marketing',{method:'PATCH',body:JSON.stringify({team})});assert.ok(response.ok);
  },
  misrouteDirective:async(id:string)=>{
    assert.match(id,/^wc_[a-z0-9]+$/);
    const response=await restAsServer('work_cards?id=eq.'+id,{method:'PATCH',body:JSON.stringify({team:'국내 MD'})});assert.ok(response.ok);
  },
};

async function main() {
  const resumeWork = process.env.ERP_E2E_RESUME_WORK === '1';
  const workOnly = process.env.ERP_E2E_WORK_ONLY === '1';
  const empty = await restAsServer('app_users?select=id');
  assert.ok(empty.ok, 'isolated REST not ready');
  const existing = await empty.json();
  if (resumeWork) assert.deepEqual(existing.map((p: any) => p.id).sort(), ['e2e_boss', 'e2e_staff', 'e2e_leader', 'e2e_marketing', 'e2e_logistics'].sort(), 'Resume requires exact synthetic member IDs');
  else assert.equal(existing.length, 0, 'must start with an empty schema-only database');
  const profiles = [
    { id: 'e2e_boss', email: fixtures.bossEmail, name: '테스트 대표', role: '대표', team: '대표실', position: '대표' },
    { id: 'e2e_staff', email: fixtures.staffEmail, name: '테스트 직원', role: '사원', team: '국내 MD', position: '사원' },
    { id: 'e2e_leader', email: fixtures.leaderEmail, name: '테스트 팀장', role: '팀장', team: '국내 MD', position: '팀장' },
    { id: 'e2e_marketing', email: 'e2e-marketing@test.invalid', name: '테스트 마케팅', role: '사원', team: '마케팅', position: '사원' },
    { id: 'e2e_logistics', email: 'e2e-logistics@test.invalid', name: '테스트 물류', role: '사원', team: '물류·CS', position: '사원' },
  ];
  if (!resumeWork) {
    const seed = await restAsServer('app_users', { method: 'POST', body: JSON.stringify(profiles.map(p => ({ ...p, password_hash: simpleHash(password), is_active: true, work_profile: '격리된 합성 테스트 계정입니다.' }))) });
    assert.ok(seed.ok, 'synthetic member seed failed: ' + await seed.text());
  }
  // A proof signed ONLY with the fresh test-stack secret; real Google OAuth is not exercised.
  const proofBody = Buffer.from(JSON.stringify({ p: 'ceo_g', email: fixtures.bossEmail, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const proofKey = crypto.createHash('sha256').update('ceo-console:' + process.env.PGRST_JWT_SECRET).digest();
  fixtures.ceoCookie = 'ceo_g=' + proofBody + '.' + crypto.createHmac('sha256', proofKey).update(proofBody).digest('base64url');
  const app = express();
  app.use(express.json());
  app.use(ceoHostLock());
  app.use(sessionRouter, receiptRouter, payableRouter, workRouter, ceoRouter);
  // Production's REST proxy is separate from Express. This harness forwards to
  // real PostgREST with the same anon role, never returning fabricated DB data.
  app.use('/rest/v1', requireUser(), async (req, res) => {
    if (!['GET', 'POST', 'PATCH', 'HEAD'].includes(req.method)) { res.status(405).end(); return; }
    const path = req.url.replace(/^\//, '');
    if (!/^(vendors|items|production_orders|trade_statements|settlements|payables)(\?|$)/.test(path)) { res.status(403).end(); return; }
    const r = await rest(path, { method: req.method, headers: { Prefer: req.headers.prefer || 'return=representation' }, ...(['POST', 'PATCH'].includes(req.method) ? { body: JSON.stringify(req.body) } : {}) });
    res.status(r.status).type('json').send(await r.text());
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    if (!resumeWork && !workOnly) console.log(JSON.stringify({ finance: await verifyFinanceHttp(base, fixtures) }));
    const work = await verifyWorkHttp(base, fixtures);
    console.log(JSON.stringify({ work }));
    assert.equal(work.status, 'passed', 'Work HTTP chain not fully passed');
    assert.equal(evidenceChecks, 3, 'Question answer and both team reports must use confirmed records');
    if(workOnly) {
      const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fixtures.bossEmail,password})});
      assert.equal(login.status,200); const cookie=login.headers.get('set-cookie')!.split(';')[0];
      const staffLogin=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fixtures.staffEmail,password})});
      assert.equal(staffLogin.status,200); const staffCookie=staffLogin.headers.get('set-cookie')!.split(';')[0];
      const noticeRows=async(id:string)=>fixtures.read('notifications?card_id=eq.'+id+'&select=*');
      for (const failure of ['before','after','concurrent'] as const) {
        const id='wc_'+crypto.randomUUID().replaceAll('-',''),text='isolated delivery '+failure;
        const seed=await restAsServer('work_cards',{method:'POST',body:JSON.stringify({id,kind:'request_check',status:'open',created_by:'e2e_staff',created_by_name:'테스트 직원',team:'국내 MD',raw_text:text,assignee_id:'e2e_leader'})});
        assert.ok(seed.ok,'Work + pending notification must commit without the application delivery step');
        assert.equal((await noticeRows(id)).length,0);
        if(failure==='concurrent') await Promise.all([deliverWorkNotifications(id),deliverWorkNotifications(id)]);
        else {
          deliveryFailure=failure;
          assert.equal(await deliverWorkNotifications(id),false);
          assert.equal((await noticeRows(id)).length,failure==='before'?0:1);
        }
        const replay=await fetch(base+'/api/work',{method:'POST',headers:{'Content-Type':'application/json',Cookie:staffCookie},body:JSON.stringify({text,requestId:id})});
        assert.equal(replay.status,200);const replayBody=await replay.json();
        assert.equal(replayBody.reused,true);assert.equal(replayBody.notified,true);
        const notices=await noticeRows(id);assert.equal(notices.length,1);
        const read=await restAsServer('notifications?id=eq.'+notices[0].id,{method:'PATCH',body:JSON.stringify({read_at:'2026-10-10T00:00:00Z'})});assert.ok(read.ok);
        assert.equal(await deliverWorkNotifications(id),true);
        assert.equal((await noticeRows(id))[0].read_at,'2026-10-10T00:00:00+00:00');
        console.log(JSON.stringify({actualNotificationRecovery:failure,status:'PASS',notifications:1,readPreserved:true}));
      }
      for(const s of [
        {route:'reply',kind:'request_check',next:'schedule',body:{text:'stale reply'}},
        {route:'done',kind:'todo',next:'schedule',body:{note:'stale done'}},
        {route:'kind',kind:'todo',next:'request_check',body:{kind:'share'}},
        {route:'cancel',kind:'todo',next:'request_check',body:{}},
        {route:'done',kind:'todo',next:'todo',body:{note:'stale owner'}},
        {route:'confirm',kind:'schedule',next:'schedule',body:{payload:{title:'stale confirmation',workspace:'LUMEN',channel:'W컨셉',startDate:'2026-10-20',discountRate:20},shareTeams:[]}},
      ]) {
        const id='wc_'+crypto.randomUUID().replaceAll('-','');
        const seed=await restAsServer('work_cards',{method:'POST',body:JSON.stringify({id,kind:s.kind,status:'open',created_by:'e2e_staff',created_by_name:'테스트 직원',team:'국내 MD',raw_text:'isolated mutation race',parsed:{}})});
        assert.ok(seed.ok,'Synthetic work seed'); mutationRace={id,kind:s.next};
        const r=await fetch(base+`/api/work/${id}/${s.route}`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(s.body)});
        assert.equal(r.status,409,JSON.stringify(await r.json())); assert.equal(mutationRace,null,'Race injection did not execute');
        const saved=await fixtures.read('work_cards?id=eq.'+id+'&select=*');
        assert.equal(saved[0].status,'open');assert.equal(saved[0].kind,s.next);assert.equal(saved[0].assignee_id,'e2e_leader');
        assert.equal((await fixtures.read('notifications?card_id=eq.'+id+'&select=id')).length,0);
        console.log(JSON.stringify({actualWorkMutationCase:s.route,nextKind:s.next,status:'PASS'}));
      }
      console.log(JSON.stringify({actualWorkMutationRaces:'PASS',cases:6,staleWrites:0,staleNotifications:0}));
      const ceoHeaders={'Content-Type':'application/json',Cookie:cookie+'; '+fixtures.ceoCookie,Host:'ceo.fixture.invalid',Origin:'https://ceo.fixture.invalid'};
      const overview=async()=>{
        const response=await ceoLoopbackRequest(new URL(base+'/api/ceo/overview'),ceoHeaders);
        assert.equal(response.status,200);return response.json();
      };
      const oldReport=(await fixtures.read('team_agent_runs?id=eq.'+work.ids.agentRuns[0]+'&select=*'))[0];
      assert.equal(oldReport.team,'마케팅');
      const before=await overview();
      assert.equal(before.agents.find((a:any)=>a.id===oldReport.id).freshness,'current');
      rulesUnavailable=true;
      const unknown=await overview();assert.ok(unknown.sourceErrors.includes('팀 감시 기준'));
      assert.equal(unknown.agents.find((a:any)=>a.id===oldReport.id).freshness,'unknown');
      const failedReport=await ceoLoopbackRequest(new URL(base+'/api/ceo/agents/run'),ceoHeaders,{team:'마케팅'});
      assert.equal(failedReport.status,500);
      assert.equal((await fixtures.read('team_agent_runs?select=id')).length,2,'Source failure must not generate a report');
      rulesUnavailable=false;
      const context=await loadReportContext();
      const candidate=findCouncilCandidates(context.cards,context.watch).find(c=>c.triggerKey.startsWith('card:'));
      assert.ok(candidate,'Confirmed shared schedule must be a council candidate');
      const conduct=async(_c:any,id?:string)=>{
        const saved=await restAsServer('agent_councils?id=eq.'+id,{method:'PATCH',body:JSON.stringify({status:'concluded',
          conclusion:{conclusion:'격리된 근거 점검',open_disagreements:[],ceo_decisions:[],actions_by_team:[{team:'마케팅',action:'준비 확인'},{team:'마케팅',action:'소재 확인'}]}})});
        assert.ok(saved.ok);return {conclusion:'격리된 근거 점검',open_disagreements:[],ceo_decisions:[],actions_by_team:[]};
      };
      await Promise.all([openCouncil(candidate,{rest:restAsServer,conduct}),openCouncil(candidate,{rest:restAsServer,conduct})]);
      const oldCouncils=await fixtures.read('agent_councils?select=*');
      assert.equal(oldCouncils.length,1);const oldCouncil=oldCouncils[0];
      assert.equal((await overview()).councils.find((c:any)=>c.id===oldCouncil.id).freshness,'current');
      const wrongHash=await ceoLoopbackRequest(new URL(base+'/api/ceo/councils/'+oldCouncil.id+'/direct'),ceoHeaders,{evidenceHash:'wrong'});
      assert.equal(wrongHash.status,409);
      const campaignId = work.ids.campaign!;
      const update = await restAsServer('campaigns?id=eq.'+campaignId,{method:'PATCH',body:JSON.stringify({title:'CURRENT_CAMPAIGN_FIXTURE',discount_rate:15,start_date:'2026-11-20',end_date:'2026-11-21',updated_at:new Date().toISOString()})});
      assert.ok(update.ok);
      const after=await overview();
      assert.equal(after.agents.find((a:any)=>a.id===oldReport.id).freshness,'changed');
      assert.equal(after.councils.find((c:any)=>c.id===oldCouncil.id).freshness,'changed');
      const workCount=(await fixtures.read('work_cards?select=id')).length;
      const staleDirect=await ceoLoopbackRequest(new URL(base+'/api/ceo/councils/'+oldCouncil.id+'/direct'),ceoHeaders,{evidenceHash:oldCouncil.cost.evidence.hash});
      assert.equal(staleDirect.status,409);assert.equal((await staleDirect.json()).error,'stale_council_evidence');
      assert.equal((await fixtures.read('work_cards?select=id')).length,workCount,'Stale council must not create instructions');
      const newContext=await loadReportContext();
      const updatedCandidate=findCouncilCandidates(newContext.cards,newContext.watch).find(c=>c.triggerKey===candidate.triggerKey)!;
      assert.ok(updatedCandidate);await openCouncil(updatedCandidate,{rest:restAsServer,conduct});
      const newCouncils=await fixtures.read('agent_councils?select=*');assert.equal(newCouncils.length,2);
      const currentCouncil=newCouncils.find((c:any)=>c.id!==oldCouncil.id)!;
      assert.deepEqual((await fixtures.read('agent_councils?id=eq.'+oldCouncil.id+'&select=*'))[0],oldCouncil,'Old council history must not be overwritten');
      const changedSource=(await fixtures.read('campaigns?id=eq.'+campaignId+'&select=id,updated_at'))[0];
      changedCampaignSource={id:changedSource.id,updatedAt:changedSource.updated_at};
      changedCampaignCard='wc_'+crypto.randomUUID().replaceAll('-','');
      const historical=await restAsServer('work_cards',{method:'POST',body:JSON.stringify({id:changedCampaignCard,kind:'schedule',status:'done',team:'국내 MD',created_by:'e2e_staff',created_by_name:'테스트 직원',created_at:'2026-01-01T00:00:00Z',done_at:'2026-01-01T00:00:00Z',raw_text:'past decision',confirmed_payload:{title:'past decision',startDate:'2026-01-01',endDate:'2026-01-02',discountRate:20},result_ref:{table:'campaigns',id:campaignId},shared_teams:['마케팅']})});
      assert.ok(historical.ok);
      const question=await fetch(base+'/api/work',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({text:'CURRENT_CAMPAIGN_FIXTURE 현재 일정 할인 알려줘',requestId:'wc_'+crypto.randomUUID().replaceAll('-','')})});
      assert.equal(question.status,200); const questionCard=(await question.json()).card;
      assert.match(questionCard.parsed.answer,/현재.*15%/);
      const report=await ceoLoopbackRequest(new URL(base+'/api/ceo/agents/run'),{'Content-Type':'application/json',Cookie:cookie+'; '+fixtures.ceoCookie,Host:'ceo.fixture.invalid',Origin:'https://ceo.fixture.invalid'},{team:'마케팅'});
      assert.equal(report.status,200); const run=(await report.json()).runs[0];
      assert.match(run.headline,/현재.*15%/);
      assert.equal((await fixtures.read('team_agent_runs?id=eq.'+run.id+'&select=headline'))[0].headline,run.headline);
      assert.equal((await fixtures.read('work_cards?id=eq.'+changedCampaignCard+'&select=confirmed_payload'))[0].confirmed_payload.discountRate,20);
      assert.equal(changedCampaignPrompts,2);
      assert.equal((await overview()).agents.find((a:any)=>a.id===run.id).freshness,'current');
      assert.deepEqual((await fixtures.read('team_agent_runs?id=eq.'+oldReport.id+'&select=*'))[0],oldReport,'Old report must not be rewritten');
      const member=await restAsServer('app_users?id=eq.e2e_marketing',{method:'PATCH',body:JSON.stringify({name:orgTeam('마케팅')!.members[0].name})});assert.ok(member.ok);
      const currentUrl=new URL(base+'/api/ceo/councils/'+currentCouncil.id+'/direct'),currentBody={evidenceHash:currentCouncil.cost.evidence.hash};
      directiveResponseLost=true;
      const lost=await ceoLoopbackRequest(currentUrl,ceoHeaders,currentBody);assert.equal(lost.status,207);
      directedRecordFailure=true;
      const markerFailure=await ceoLoopbackRequest(currentUrl,ceoHeaders,currentBody);assert.equal(markerFailure.status,207);
      const duplicates=await Promise.all([ceoLoopbackRequest(currentUrl,ceoHeaders,currentBody),ceoLoopbackRequest(currentUrl,ceoHeaders,currentBody)]);
      assert.ok(duplicates.every(r=>r.status===200));
      const directives=await fixtures.read('work_cards?kind=eq.todo&select=id,parsed');
      const councilDirectives=directives.filter((c:any)=>c.parsed?.directive?.councilId===currentCouncil.id);
      assert.match(councilDirectives[0]?.parsed?.directive?.text,/준비 확인.*소재 확인/s);
      assert.equal(councilDirectives.length,1);const councilNotices=await noticeRows(councilDirectives[0].id);assert.equal(councilNotices.length,1);
      const markRead=await restAsServer('notifications?id=eq.'+councilNotices[0].id,{method:'PATCH',body:JSON.stringify({read_at:'2026-10-10T00:00:00Z'})});assert.ok(markRead.ok);
      assert.equal((await ceoLoopbackRequest(currentUrl,ceoHeaders,currentBody)).status,200);
      assert.equal((await noticeRows(councilDirectives[0].id))[0].read_at,'2026-10-10T00:00:00+00:00');
      const unavailable=await restAsServer('campaigns?id=eq.'+campaignId,{method:'PATCH',body:JSON.stringify({status:'closed'})});assert.ok(unavailable.ok);
      const closed=await ceoLoopbackRequest(currentUrl,ceoHeaders,currentBody);
      assert.equal(closed.status,409);assert.equal((await fixtures.read('work_cards?select=id')).length,workCount+3);
      console.log(JSON.stringify({actualReportFreshness:'PASS',sameDayChanged:true,refreshedCurrent:true,oldReportsPreserved:true,
        actualCouncilFreshness:'PASS',concurrentDedup:true,changedEvidenceNewHistory:true,staleAndClosedDirectBlocked:true,
        ruleFailureUnknownWithoutNewReports:true,directiveLostResponseAndParallelRetrySingleCardAndNotice:true,noticeReadPreserved:true}));
      console.log(JSON.stringify({actualChangedCampaignEvidence:'PASS',historicalDiscount:20,currentDiscount:15,pastDecisionRescheduled:true,questionAndReportStored:true,promptChecks:2}));
      await verifyCeoDirectiveHttp(base,fixtures);
      for(const table of ['production_orders','trade_statements','settlements','payables']) assert.equal((await fixtures.read(table+'?select=id')).length,0,'Work-only run wrote financial/business transactions');
    }
    // PMS is an external, unavailable dependency in this isolated stack; blocked
    // reads may produce honest warnings, but no other destination is acceptable.
    assert.ok(forbidden.every(origin => origin === 'http://e2e-unavailable:8000'), 'unexpected network destination');
    console.log(JSON.stringify({ isolatedHttpDatabase: resumeWork ? 'WORK_DEBUG_PASS_NOT_FULL_RUN' : workOnly ? 'WORK_ONLY_PASS_NO_FINANCE_RUN' : 'PASS', model: 'deterministic fixture, not live', google: 'synthetic signed proof, not OAuth', pms: 'unavailable fixture', modelCalls, prohibitedExternalWrites: 0 }));
  } finally { server.closeAllConnections(); server.close(); globalThis.fetch = originalFetch; }
}
main().catch(error => { console.error(String(error).split('\n')[0]); process.exitCode = 1; });
