import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ceoLoopbackRequest} from './e2e-work-http';

const TEXT='CEO_DIRECTIVE_FIXTURE 촬영 소재 검수';
const NOTE='소재 검수 완료, 최종 파일 확인했습니다.';
let evidence:{id:string;phase:'open'|'done';prompts:number}|undefined;

/** Validate the actual router's model input, not the fixture's answer alone. */
export function directiveFlowModel(request:any):string|undefined {
  if(!evidence) return undefined;
  const message=String(request.messages?.[0]?.content||'');
  const line=message.split('\n').find(s=>s.startsWith('- id='+evidence!.id+' '));
  assert.ok(line,'Same directive must reach the report/secretary model prompt');
  assert.ok(line.includes('[todo/'+evidence.phase+']'));
  assert.ok(line.includes(TEXT));
  if(evidence.phase==='done') assert.ok(line.includes(NOTE),'Completion result must reach the same-card prompt');
  evidence.prompts++;
  if(String(request.system).includes('팀 감독 에이전트')) return JSON.stringify({
    headline:evidence.phase==='done'?'대표 지시 검수 완료':'대표 지시 검수 진행 중',
    summary:evidence.phase==='done'?'· '+NOTE:'· 대표 지시 검수를 진행 중입니다.',
    needs:evidence.phase==='done'?[]:[{text:'검수 결과 확인 필요',cardId:evidence.id}],
  });
  assert.ok(String(request.system).includes('비서실장'),'Only secretary/report model fixtures are allowed');
  return '대표님, '+NOTE+' 근거 업무 '+evidence.id+'입니다.';
}

type Fixtures={bossEmail:string;staffEmail:string;password:string;ceoCookie:string;
  failNextDelivery:()=>void;loseNextDirectiveResponse:()=>void;flushNotifications:(id:string)=>Promise<boolean>;
  setMarketingTeam:(team:string)=>Promise<void>;
  misrouteDirective:(id:string)=>Promise<void>;
  read:(path:string)=>Promise<any[]>};
export async function verifyCeoDirectiveHttp(base:string,fixtures:Fixtures) {
  assert.equal(new URL(base).hostname,'127.0.0.1','Only isolated loopback testing allowed');
  const login=async(email:string)=>{
    const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password:fixtures.password})});assert.equal(r.status,200);
    const cookie=r.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);return cookie;
  };
  const [boss,marketing,foreign]=await Promise.all([login(fixtures.bossEmail),login('e2e-marketing@test.invalid'),login(fixtures.staffEmail)]);
  const ceo=async(path:string,body?:object)=>{
    const r=await ceoLoopbackRequest(new URL(base+path),{Host:'ceo.fixture.invalid',Origin:'https://ceo.fixture.invalid',
      Cookie:boss+'; '+fixtures.ceoCookie,'Content-Type':'application/json'},body);
    return {status:r.status,data:await r.json()};
  };
  const staff=async(path:string,cookie=marketing,body?:object)=>{
    const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
  };
  let legacyId='';
  await fixtures.setMarketingTeam('국내 MD');
  try {
    const mismatch=await ceo('/api/ceo/directive',{team:'마케팅',text:'계정 팀 불일치 테스트',requestId:'wc_'+randomUUID().replaceAll('-','')});
    assert.equal(mismatch.status,200);assert.equal(mismatch.data.delivered,null);
    const row=(await fixtures.read('work_cards?id=eq.'+mismatch.data.cardId+'&select=*'))[0];
    assert.equal(row.team,'마케팅');assert.equal(row.assignee_id,null);
    legacyId=row.id;await fixtures.misrouteDirective(row.id);
    const wrongFeed=await staff('/api/work',foreign);assert.equal(wrongFeed.status,200);
    assert.ok(!wrongFeed.data.items.some((c:any)=>c.id===row.id),'Legacy mismatched team must not leak the directive');
    assert.ok(!(await staff('/api/work',foreign)).data.items.some((c:any)=>c.id===row.id));
    const wrongLeader=await login('e2e-leader@test.invalid');
    assert.equal((await staff('/api/work/'+row.id+'/done',wrongLeader,{note:'wrong team'})).status,403);
  } finally {await fixtures.setMarketingTeam('마케팅');}
  const legacyFeed=await staff('/api/work');assert.equal(legacyFeed.status,200);
  const legacyCard=legacyFeed.data.items.find((c:any)=>c.id===legacyId);
  assert.ok(legacyCard);assert.equal(legacyCard.team,'마케팅');assert.equal(legacyCard._directive,true);
  assert.equal((await fixtures.read('work_cards?id=eq.'+legacyId+'&select=team'))[0].team,'국내 MD','History must not be rewritten');
  const before=(await ceo('/api/ceo/overview')).data;
  const beforeTeam=before.teams.find((t:any)=>t.team==='마케팅');
  const beforeFeed=await staff('/api/work');assert.equal(beforeFeed.status,200);
  const body={team:'마케팅',text:TEXT,dueDate:'2026-01-01',requestId:'wc_'+randomUUID().replaceAll('-','')};
  fixtures.loseNextDirectiveResponse();assert.equal((await ceo('/api/ceo/directive',body)).status,500);
  fixtures.failNextDelivery();
  const made=await ceo('/api/ceo/directive',body);
  assert.equal(made.data.notified,false,'Stored directive must honestly report pending delivery');
  assert.equal((await fixtures.read('notifications?card_id=eq.'+body.requestId+'&select=id')).length,0);
  const replay=await ceo('/api/ceo/directive',body);assert.equal(replay.status,200);assert.equal(replay.data.notified,true);
  assert.equal((await ceo('/api/ceo/directive',{...body,text:'different input'})).status,409);
  assert.equal(made.status,200);assert.ok(made.data.delivered,'A real active synthetic marketing account must receive it');
  const id=made.data.cardId;assert.match(id,/^wc_/);
  const rows=await fixtures.read('work_cards?id=eq.'+id+'&select=*');assert.equal(rows.length,1);
  const original=rows[0];assert.equal(original.assignee_id,'e2e_marketing');assert.equal(original.kind,'todo');
  assert.equal(original.parsed.directive.team,'마케팅');assert.equal(original.status,'open');
  const notices=await fixtures.read('notifications?card_id=eq.'+id+'&select=*');assert.equal(notices.length,1);
  assert.equal(notices[0].user_id,'e2e_marketing');
  const feed=await staff('/api/work');assert.equal(feed.status,200);
  assert.equal(feed.data.items.filter((c:any)=>c.id===id).length,1);
  assert.equal(feed.data.counts.todo,beforeFeed.data.counts.todo+1);
  const foreignFeed=await staff('/api/work',foreign);assert.equal(foreignFeed.status,200);
  assert.ok(!foreignFeed.data.items.some((c:any)=>c.id===id),'Private directive cannot leak to another team');
  assert.equal((await staff('/api/work/'+id+'/done',foreign,{note:'unauthorized'})).status,403);
  assert.equal((await fixtures.read('work_cards?id=eq.'+id+'&select=status'))[0].status,'open');
  assert.equal((await staff('/api/work/'+id+'/kind',boss,{kind:'share'})).status,400);
  assert.deepEqual((await fixtures.read('work_cards?id=eq.'+id+'&select=*'))[0],original);
  const pending=(await ceo('/api/ceo/overview')).data;
  const pendingTeam=pending.teams.find((t:any)=>t.team==='마케팅');
  assert.equal(pendingTeam.open,beforeTeam.open+1);assert.equal(pendingTeam.orders,beforeTeam.orders+1);
  assert.equal(pendingTeam.overdue,beforeTeam.overdue+1);
  assert.equal(pending.orders.filter((c:any)=>c.id===id&&c.team==='마케팅'&&c.status==='open').length,1);
  evidence={id,phase:'open',prompts:0};
  try {
    const first=await ceo('/api/ceo/agents/run',{team:'마케팅'});assert.equal(first.status,200);
    const firstRun=first.data.runs[0];assert.equal(firstRun.stats.orders,pendingTeam.orders);
    assert.ok(firstRun.needs.some((n:any)=>n.cardId===id));
    const savedFirst=(await fixtures.read('team_agent_runs?id=eq.'+firstRun.id+'&select=*'))[0];
    fixtures.failNextDelivery();
    const completion=await Promise.all([staff('/api/work/'+id+'/done',marketing,{note:NOTE}),staff('/api/work/'+id+'/done',marketing,{note:NOTE})]);
    assert.deepEqual(completion.map(r=>r.status).sort(),[200,409]);
    assert.equal(completion.find(r=>r.status===200)!.data.notified,false);
    assert.equal((await fixtures.read('notifications?card_id=eq.'+id+'&select=id')).length,1);
    assert.equal(await fixtures.flushNotifications(id),true);
    const completed=(await fixtures.read('work_cards?id=eq.'+id+'&select=*'))[0];
    assert.equal(completed.status,'done');assert.equal(completed.reply_text,NOTE);
    assert.equal(completed.done_by_name,original.assignee_name);assert.ok(completed.done_at);
    assert.deepEqual(completed.parsed.directive,original.parsed.directive);
    assert.equal((await staff('/api/work/'+id+'/done',marketing,{note:'retry overwrite'})).status,409);
    assert.deepEqual((await fixtures.read('work_cards?id=eq.'+id+'&select=*'))[0],completed);
    const allNotices=await fixtures.read('notifications?card_id=eq.'+id+'&select=*');assert.equal(allNotices.length,2);
    assert.equal(allNotices.filter(n=>n.user_id==='e2e_boss').length,1);assert.match(allNotices.find(n=>n.user_id==='e2e_boss').body,/검수 완료/);
    const doneFeed=await staff('/api/work');assert.equal(doneFeed.data.counts.todo,beforeFeed.data.counts.todo);
    const changed=(await ceo('/api/ceo/overview')).data;
    assert.equal(changed.agents.find((a:any)=>a.id===firstRun.id).freshness,'changed');
    assert.ok(!changed.decide.some((c:any)=>c.id===id));
    const afterTeam=changed.teams.find((t:any)=>t.team==='마케팅');
    assert.equal(afterTeam.orders,beforeTeam.orders);assert.equal(afterTeam.open,beforeTeam.open);
    assert.equal(afterTeam.overdue,beforeTeam.overdue);assert.equal(afterTeam.doneToday,beforeTeam.doneToday+1);
    assert.equal(changed.orders.filter((c:any)=>c.id===id&&c.status==='done'&&c.reply_text===NOTE).length,1);
    const other=(teams:any[])=>teams.filter(t=>t.team!=='마케팅').map(t=>({team:t.team,open:t.open,orders:t.orders,doneToday:t.doneToday}));
    assert.deepEqual(other(changed.teams),other(before.teams),'One team completion must not become other teams completion');
    evidence.phase='done';
    const refreshed=await ceo('/api/ceo/agents/run',{team:'마케팅'});assert.equal(refreshed.status,200);
    const run=refreshed.data.runs[0];assert.notEqual(run.id,firstRun.id);assert.deepEqual(run.needs,[]);
    assert.match(run.summary,/검수 완료/);assert.equal(run.stats.orders,beforeTeam.orders);
    assert.equal((await ceo('/api/ceo/overview')).data.agents.find((a:any)=>a.id===run.id).freshness,'current');
    assert.deepEqual((await fixtures.read('team_agent_runs?id=eq.'+firstRun.id+'&select=*'))[0],savedFirst);
    const answer=await ceo('/api/ceo/ask',{question:TEXT+' 완료 결과 알려주세요'});assert.equal(answer.status,200);
    assert.ok(answer.data.answer.includes(id));assert.ok(answer.data.answer.includes(NOTE));
    assert.equal(evidence.prompts,3);
    console.log(JSON.stringify({actualCeoDirectiveChain:'PASS',assignedAndNotified:true,privateFeed:true,foreignCompletionBlocked:true,
      concurrentCompletionOneWinner:true,todoRemoved:true,teamCountsCorrect:true,completionHistoryPreserved:true,
      lostCreationResponseSingleCard:true,creationAndCompletionDeliveryRecovered:true,protectedDirectiveKind:true,
      mismatchedAccountCannotLeakOrGrantForeignTeamCompletion:true,
      oldReportMarkedChanged:true,newReportCurrent:true,secretarySameCardCompletionEvidence:true,promptChecks:3}));
  } finally {evidence=undefined;}
}
