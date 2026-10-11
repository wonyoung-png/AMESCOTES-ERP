import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router,{createSampleWorkflowRouter,validSampleAction} from './sample-workflow.js';

test('sample action validates photos, bounded amount, version and buyer identity',()=>{
  const complete={version:0,imageUrls:['https://example.invalid/fixture.png']};
  assert.equal(validSampleAction(complete,'complete'),true);
  for(const patch of [{version:null},{version:-1},{imageUrls:[]},{imageUrls:['javascript:alert(1)']},{imageUrls:[42]},
    {imageUrls:Array(6).fill('https://example.invalid/fixture.png')}])assert.equal(validSampleAction({...complete,...patch},'complete'),false);
  const review={version:1,styleName:'Fixture',buyerId:'fixture_buyer',brandCode:'FB',sampleUnitPrice:100};
  assert.equal(validSampleAction(review,'accept'),true);
  for(const patch of [{sampleUnitPrice:'100'},{sampleUnitPrice:Infinity},{sampleUnitPrice:-1},{styleName:' '},{buyerId:'a,b'}])
    assert.equal(validSampleAction({...review,...patch},'accept'),false);
});
async function serve(app:express.Express,work:(base:string)=>Promise<void>){
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try{await work(`http://127.0.0.1:${(server.address() as any).port}`);}finally{await new Promise<void>(r=>server.close(()=>r()));}
}
test('actual sample API rejects anonymous completion, approval and billing before any DB write',async()=>{
  const app=express();app.use(express.json());app.use(router);
  await serve(app,async base=>{for(const path of ['/api/samples/a/complete','/api/samples/a/accept','/api/samples/workflow/bill']){
    const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,401);
  }});
});
test('sample API takes actor only from session, guards selection, and fails closed without migration',async()=>{
  const writes:any[]=[];let unavailable=false;
  const app=express();app.use(express.json());app.use(createSampleWorkflowRouter({
    auth:()=>((req:any,_res:any,next:any)=>{req.user={id:'server-actor',role:'사원',email:'fixture@example.invalid'};next();}),
    write:async(path,init)=>{writes.push({path,body:JSON.parse(String(init?.body))});return {ok:!unavailable,status:unavailable?404:200,
      json:async()=>({id:'a',review_card_id:'wc_fixture'}),text:async()=>unavailable?'PGRST202 missing function':''};},
    notify:async()=>false,
  }));
  await serve(app,async base=>{
    const post=async(path:string,body:any)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const r=await post('/api/samples/a/complete',{version:0,imageUrls:['https://example.invalid/photo.png'],actorId:'forged',completedAt:'2099-01-01'});
    assert.equal(r.status,200);assert.equal(writes[0].body.p_actor_id,'server-actor');assert.equal((await r.json()).notified,false);
    const before=writes.length;assert.equal((await post('/api/samples/workflow/bill',{ids:['a','a']})).status,400);assert.equal(writes.length,before);
    unavailable=true;assert.equal((await post('/api/samples/workflow/bill',{ids:['a']})).status,503);
  });
});
