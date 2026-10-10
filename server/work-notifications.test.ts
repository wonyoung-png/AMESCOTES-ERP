import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
process.env.PGRST_JWT_SECRET = 'notification-retry-synthetic-secret';
process.env.POSTGREST_URL = 'http://notification.fixture.invalid';
process.env.ERP_PRIVATE_MODE = 'false';
const { deliverWorkNotifications, directiveNotificationsReady } = await import('./work-notifications');
const { default: router } = await import('./work');
const { signJwt } = await import('./auth');

test('directive readiness rejects missing or outdated DB triggers before mutations', async () => {
  for (const r of [new Response('',{status:404}),new Response('0'),new Response('{}'),new Response('{')]) {
    assert.equal(await directiveNotificationsReady(async()=>r),false);
  }
  assert.equal(await directiveNotificationsReady(async()=>{throw new Error('offline');}),false);
  assert.equal(await directiveNotificationsReady(async(path,init)=>{
    assert.equal(path,'rpc/directive_notification_version');assert.equal(init?.method,'POST');
    return new Response('1');
  }),true);
});

test('delivery only calls bounded RPC and handles failures/unknown result without success claims', async () => {
  for (const result of [new Response('',{status:503}),new Response('{}'),new Response('{'),new Response('{"delivered":0,"pending":true}')]) {
    assert.equal(await deliverWorkNotifications('wc_fixture',async(path,init)=>{
      assert.equal(path,'rpc/deliver_work_notifications');
      assert.deepEqual(JSON.parse(String(init?.body)),{p_card_id:'wc_fixture'});
      return result;
    }),false);
  }
  assert.equal(await deliverWorkNotifications(null,async()=>{throw new Error('network fixture');}),false);
  assert.equal(await deliverWorkNotifications('wc_fixture',async()=>new Response('{"delivered":2,"pending":false}')),true);
});

test('same saved submission retries delivery without classifying/inserting work or writing notifications', async () => {
  const realFetch = globalThis.fetch;
  const member = {id:'author',email:'fixture@test.invalid',name:'fixture',role:'사원',team:'국내 MD',is_active:true};
  const card = {id:'wc_retryfixture',created_by:member.id,raw_text:'already saved fixture',kind:'request_check',status:'open'};
  let flushes=0;
  globalThis.fetch=(async(input:any,init?:RequestInit)=>{
    const url=new URL(String(input));assert.equal(url.origin,'http://notification.fixture.invalid');
    if(url.pathname==='/app_users') return new Response(JSON.stringify([member]));
    if(url.pathname==='/work_cards') {assert.ok(!init?.method || init.method==='GET');return new Response(JSON.stringify([card]));}
    if(url.pathname==='/rpc/deliver_work_notifications') {
      assert.equal(JSON.parse(String(init?.body)).p_card_id,card.id);flushes++;
      return flushes===1?new Response('',{status:503}):new Response('{"delivered":1,"pending":false}');
    }
    assert.fail('Unexpected request '+url.pathname);
  }) as typeof fetch;
  const app=express();app.use(express.json());app.use(router);const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));
  try {
    for(const expected of [false,true]) {
      const response=await realFetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/work`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+signJwt({email:member.email,exp:Math.floor(Date.now()/1000)+60})},
        body:JSON.stringify({text:card.raw_text,requestId:card.id,...(expected?{expectedUserId:member.id}:{})}),
      });
      assert.equal(response.status,200);const body=await response.json();
      assert.equal(body.reused,true);assert.equal(body.notified,expected);assert.equal(body.card.id,card.id);
    }
    assert.equal(flushes,2);
  } finally {globalThis.fetch=realFetch;await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});

test('stale browser identity cannot submit under another authenticated account', async () => {
  const realFetch=globalThis.fetch;
  const member={id:'fixture_b',email:'b@test.invalid',name:'테스트 B',role:'사원',team:'국내 MD',is_active:true};
  let reads=0;const violations:string[]=[];
  globalThis.fetch=(async(input:any)=>{
    const url=new URL(String(input));
    if(url.origin==='http://notification.fixture.invalid'&&url.pathname==='/app_users') {reads++;return new Response(JSON.stringify([member]));}
    violations.push(url.origin+url.pathname);throw new Error('Prohibited test request');
  }) as typeof fetch;
  const app=express();app.use(express.json());app.use(router);const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));
  try {
    for(const expectedUserId of ['fixture_a','',null,{}]) {
      const before=reads;
      const response=await realFetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/work`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+signJwt({email:member.email,exp:Math.floor(Date.now()/1000)+60})},
        body:JSON.stringify({text:'A의 보존 업무',requestId:'wc_identityfixture',expectedUserId}),
      });
      assert.equal(response.status,409);assert.equal((await response.json()).error,'session_changed');
      assert.equal(reads-before,1,'Only authentication lookup; no members, work, model or mutation');
    }
    assert.deepEqual(violations,[]);
  } finally {globalThis.fetch=realFetch;server.closeAllConnections();await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
