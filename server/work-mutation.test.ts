import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
process.env.PGRST_JWT_SECRET='work-mutation-synthetic-test-secret';
process.env.POSTGREST_URL='http://work-mutation.fixture.invalid';
process.env.ERP_PRIVATE_MODE='false';
const { default: router, classify }=await import('./work');
const { signJwt }=await import('./auth');

for (const scenario of [
  {route:'reply',kind:'request_check',next:'schedule',body:{text:'old decision'}},
  {route:'done',kind:'todo',next:'schedule',body:{note:'old completion'}},
  {route:'kind',kind:'todo',next:'request_check',body:{kind:'share'}},
  {route:'cancel',kind:'todo',next:'request_check',body:{}},
  {route:'done',kind:'todo',next:'todo',body:{note:'stale owner'}},
]) test(`${scenario.route}: stale open state cannot overwrite a newer kind/routing`,async()=>{
  const originalFetch=globalThis.fetch;
  const app=express();app.use(express.json());app.use(router);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const member={id:'boss',email:'wonyoung@atlm.kr',name:'fixture',role:'대표',position:'대표',team:'대표실',is_active:true};
  let card:any={id:'wc_mutation',team:'국내 MD',created_by:'staff',kind:scenario.kind,status:'open',parsed:{},updated_at:'2026-10-10T00:00:00.000001+00:00'};
  let writes=0,notifications=0;
  globalThis.fetch=(async(input:any,init?:RequestInit)=>{
    const u=new URL(String(input));
    assert.equal(u.origin,'http://work-mutation.fixture.invalid','No external requests');
    if(u.pathname==='/app_users') return new Response(JSON.stringify([member]));
    if(u.pathname==='/work_cards' && init?.method!=='PATCH') {
      const old=structuredClone(card);
      card={...card,kind:scenario.next,assignee_id:'new-owner',updated_at:'2026-10-10T00:00:01+00:00'};
      return new Response(JSON.stringify([old]));
    }
    if(u.pathname==='/work_cards' && init?.method==='PATCH') {
      const matches=[...u.searchParams].filter(([k])=>k!=='select').every(([k,v])=>v.startsWith('eq.')?String(card[k])===v.slice(3):false);
      if(matches) {writes++;card={...card,...JSON.parse(String(init.body))};}
      return new Response(JSON.stringify(matches?[card]:[]));
    }
    if(u.pathname==='/notifications') {notifications++;return new Response('[]');}
    throw new Error('Unexpected fixture request '+u.pathname);
  }) as typeof fetch;
  try {
    const port=(server.address() as {port:number}).port;
    const r=await originalFetch(`http://127.0.0.1:${port}/api/work/wc_mutation/${scenario.route}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+signJwt({email:member.email,exp:Math.floor(Date.now()/1000)+60})},body:JSON.stringify(scenario.body)});
    assert.equal(r.status,409,JSON.stringify(await r.json()));
    assert.equal(writes,0);assert.equal(notifications,0);
    assert.equal(card.kind,scenario.next);assert.equal(card.status,'open');assert.equal(card.assignee_id,'new-owner');
  } finally {
    globalThis.fetch=originalFetch;await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));
  }
});

test('잘못된 AI 분류는 공유 카드로 공개하지 않고 개인 안내로 남긴다',async()=>{
  const originalFetch=globalThis.fetch;
  const previousKey=process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY='synthetic-classification-test-only';
  const me={id:'fixture',email:'fixture@test.invalid',name:'fixture',role:'사원',position:'사원',team:'국내 MD',profile:''};
  try {
    for(const output of [{kind:'invented',parsed:{}},{kind:'share',parsed:[]},{kind:'share',parsed:'not object'}]) {
      globalThis.fetch=(async(input:any)=>{
        assert.equal(new URL(String(input instanceof Request?input.url:input)).origin,'https://api.anthropic.com');
        return new Response(JSON.stringify({id:'fixture',type:'message',role:'assistant',model:'fixture',content:[{type:'text',text:JSON.stringify(output)}],stop_reason:'end_turn',usage:{input_tokens:0,output_tokens:0}}),{headers:{'Content-Type':'application/json'}});
      }) as typeof fetch;
      const result=await classify({text:'uncertain fixture',me,open:[]});
      assert.equal(result.kind,'question');assert.ok(result.parsed.answer);assert.equal(result.relatedId,null);
    }
  } finally {globalThis.fetch=originalFetch;if(previousKey===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=previousKey;}
});
