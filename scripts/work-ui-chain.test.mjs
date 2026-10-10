// Actual React widget/feed/actions; synthetic HTTP/store only, no ERP/AI/employee traffic.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer';

const bundled=await build({stdin:{contents:`
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'; import {Toaster} from 'sonner';
import WorkHub from './client/src/pages/WorkHub'; import WorkChatWidget from './client/src/components/WorkChatWidget';
function App(){const [on,setOn]=useState(true);return <><button id="unmount" onClick={()=>setOn(false)}>Unmount</button>{on&&<><section id="hub"><WorkHub/></section><WorkChatWidget/></>}<Toaster/></>;}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',logLevel:'silent',
define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-boundaries',setup(b){
  b.onResolve({filter:/CaptureInbox$/},()=>({path:'capture',namespace:'fixture'}));
  b.onResolve({filter:/^@\/lib\/phase1$/},()=>({path:'teams',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/db$/},a=>a.importer.endsWith('campaignQueries.ts')?{path:'db',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='capture'?'export default function Capture(){return null;}':
    a.path==='teams'?`export const CAMPAIGN_TEAMS=['국내 MD','마케팅','물류·CS'];`:
    `export const db={from:table=>({select:async()=>{if(table!=='campaigns')throw Error('Unexpected store');const r=await fetch('/fixture/campaigns');return {data:await r.json(),error:null};}})};`}));
}}]});
const a={id:'fixture_a',name:'테스트 MD 팀장',team:'국내 MD',isLeader:true,isBoss:false};
const b={...a,id:'fixture_b',name:'테스트 B'};
let me=a,failed=false,failOlder=false,holdInitial=true,postMode='lost',reads=0;
let held=[];let holdReads=0,holdOlderReads=0,bOnly=null;
const posts=[],campaigns=[],violations=[];
let cards=[{id:'wc_checkfixture',created_at:'2026-10-10T00:00:00Z',created_by:'fixture_staff',created_by_name:'테스트 MD 직원',team:'국내 MD',
  raw_text:'테스트 W컨셉 참여 확인 요청',kind:'request_check',status:'open',parsed:{},assignee_id:a.id,assignee_name:a.name,shared_teams:[],read_by:[]}];
const counts=()=>{
  const unread=cards.filter(c=>c.created_by!==me.id&&c.kind!=='question'&&!c.read_by.includes(me.id));
  const todo=cards.filter(c=>c.status==='open'&&(c.assignee_id===me.id||c.kind==='schedule'&&(c.created_by===me.id||me.isLeader)));
  return {unread:unread.length,todo:todo.length,teamUnread:unread.filter(c=>c.team===me.team).length,sharedUnread:unread.filter(c=>c.team!==me.team&&c.shared_teams.includes(me.team)).length,
    attention:new Set([...unread,...todo].map(c=>c.id)).size};
};
const json=(res,v,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture.invalid');
  if(req.method==='GET'&&url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundled.outputFiles[0].text);return;}
  if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.statusCode=204;res.end();return;}
  if(req.method==='GET'&&url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/fixture.js"></script>');return;}
  if(req.method==='GET'&&url.pathname==='/api/work') {
    reads++;const before=url.searchParams.has('before')?JSON.parse(url.searchParams.get('before')):null;
    const sorted=[...(me.id===b.id&&bOnly?bOnly:cards)].sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
    const selected=sorted.filter(c=>!before||c.created_at<before.created_at||(c.created_at===before.created_at&&c.id<before.id)).slice(0,200);
    const items=url.searchParams.has('countsOnly')?[]:structuredClone(selected),last=items.at(-1);
    const data={items,me:{...me},counts:counts(),nextCursor:items.length===200?{id:last.id,created_at:last.created_at}:null};
    if(!url.searchParams.has('countsOnly')&&(holdInitial||holdReads>0||(before&&holdOlderReads>0))){if(holdReads>0)holdReads--;else if(before&&holdOlderReads>0)holdOlderReads--;held.push(()=>json(res,data));return;}
    const unavailable=failed||(failOlder&&before);json(res,unavailable?{error:'fixture_offline'}:data,unavailable?502:200);return;
  }
  if(req.method==='GET'&&url.pathname==='/api/captures/summary'){json(res,{pending:0});return;}
  if(req.method==='GET'&&url.pathname==='/fixture/campaigns'){json(res,campaigns);return;}
  if(req.method==='POST'&&url.pathname.startsWith('/api/work')) {
    let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);posts.push({path:url.pathname,body});
    if(url.pathname==='/api/work/read'){cards.forEach(c=>{if(body.ids.includes(c.id)&&!c.read_by.includes(me.id))c.read_by.push(me.id);});json(res,{ok:true,marked:body.ids.length});return;}
    if(url.pathname.endsWith('/reply')){const c=cards.find(c=>url.pathname.includes(c.id));c.status='done';c.reply_text=body.text;c.replied_by_name=me.name;json(res,{ok:true,notified:true});return;}
    if(url.pathname.endsWith('/confirm')){
      const c=cards.find(c=>url.pathname.includes(c.id));c.status='done';c.confirmed_payload=body.payload;c.shared_teams=body.shareTeams;c.result_ref={table:'campaigns',id:'cmp_fixture'};
      campaigns.push({id:'cmp_fixture',workspace:body.payload.workspace,title:body.payload.title,channel:body.payload.channel,start_date:body.payload.startDate,end_date:body.payload.endDate,
        discount_rate:body.payload.discountRate,status:'draft',tasks:[],created_at:c.created_at,updated_at:c.created_at});json(res,{ok:true,notified:true});return;
    }
    if(url.pathname==='/api/work'){
      if(body.expectedUserId!==me.id){json(res,{error:'session_changed'},409);return;}
      let c=cards.find(c=>c.id===body.requestId);
      if(!c){c={id:body.requestId,created_at:new Date().toISOString(),created_by:me.id,created_by_name:me.name,team:me.team,
        raw_text:body.text,kind:'todo',status:'open',assignee_id:me.id,parsed:{},shared_teams:[],read_by:[]};cards.push(c);}
      if(postMode==='lost')return;
      if(postMode==='malformed'){res.end('{');return;}
      json(res,{card:c,notified:true});return;
    }
  }
  violations.push(req.method+' '+url.pathname);json(res,{error:'Unexpected fixture request'},500);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;let browser;
const until=async(predicate)=>{const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'Fixture wait exceeded 5 seconds');await new Promise(r=>setTimeout(r,10));}};
try{
  browser=await puppeteer.launch({headless:true});const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',r=>{if(new URL(r.url()).origin===base||r.url().startsWith('data:image/'))r.continue();else{violations.push(r.url());r.abort();}});
  await page.evaluateOnNewDocument(()=>{
    const nativeSet=window.setInterval,nativeClear=window.clearInterval;window.fixtureTimers=new Map();let n=100000;
    window.setInterval=(fn,ms,...args)=>ms===60000?(window.fixtureTimers.set(++n,()=>fn(...args)),n):nativeSet(fn,ms,...args);
    window.clearInterval=id=>window.fixtureTimers.delete(id)||nativeClear(id);
    window.fixtureTick=()=>window.fixtureTimers.forEach(fn=>fn());
    window.fixtureHidden=false;Object.defineProperty(document,'hidden',{get:()=>window.fixtureHidden});
    window.fixtureSignals=[];AbortSignal.timeout=ms=>{const c=new AbortController();window.fixtureSignals.push({ms,c});return c.signal;};
  });
  const text=()=>page.$eval('#hub',e=>e.textContent);
  const click=async(label,root='#hub')=>page.evaluate((label,root)=>{const e=[...document.querySelectorAll(root+' button')].find(e=>e.textContent.trim().startsWith(label));if(!e)throw Error('Button missing: '+label);e.click();},label,root);
  const refresh=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const release=()=>{const ready=held;held=[];ready.forEach(f=>f());};
  await page.goto(base);await page.waitForSelector('#hub [role="status"]');
  assert.ok(!(await text()).includes('처리할 일이 없습니다'));
  holdInitial=false;release();await page.waitForFunction(()=>document.querySelector('#hub').textContent.includes('테스트 W컨셉 참여 확인 요청'));
  await page.waitForFunction(()=>document.querySelector('#hub [role="tab"]').textContent.includes('(1)'));
  await click('확인');await page.waitForFunction(()=>!document.querySelector('#hub [aria-label="안 읽음"]'));
  assert.equal(cards[0].status,'open');assert.ok((await text()).includes('내 할 일1'));
  await page.type('#hub input[placeholder^="답변"]','20%로 진행');await click('답변');
  await page.waitForFunction(()=>document.querySelector('#hub').textContent.includes('처리할 일이 없습니다'));
  assert.equal(cards[0].reply_text,'20%로 진행');assert.equal(cards[0].status,'done');
  assert.equal(await page.$eval('#hub [role="tab"]',e=>e.textContent),'업무 피드');
  cards.push({id:'wc_schedulefixture',created_at:'2026-10-10T01:00:00Z',created_by:'fixture_staff',created_by_name:'테스트 MD 직원',team:'국내 MD',
    raw_text:'테스트 W컨셉 30% 초안',kind:'schedule',status:'open',parsed:{title:'테스트 W컨셉',workspace:'LUMEN',channel:'W컨셉',startDate:'2026-10-20',endDate:'2026-10-21',discountRate:30,shareTeams:['마케팅','물류·CS']},shared_teams:[],read_by:[]});
  await refresh();await page.waitForSelector('#hub input[placeholder="할인율 %"]');
  await page.click('#hub input[placeholder="할인율 %"]');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type('#hub input[placeholder="할인율 %"]','20');
  assert.equal(await page.$eval('#hub input[placeholder="할인율 %"]',e=>e.value),'20');
  await click('캘린더 등록');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ames_campaigns')||'[]').length===1);
  const confirmation=posts.find(p=>p.path.endsWith('/confirm')).body;
  assert.equal(confirmation.payload.discountRate,20);assert.deepEqual(confirmation.shareTeams,['마케팅','물류·CS']);
  // Only the outgoing selection/cache contract is tested here; server readiness is covered separately.
  assert.equal(campaigns[0].status,'draft');assert.deepEqual(campaigns[0].tasks,[]);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ames_campaigns'))[0].discountRate),20);
  await click('우리 팀');await page.waitForFunction(()=>document.querySelector('#hub').textContent.includes('20%'));
  failed=true;await refresh();await page.waitForSelector('#hub [role="alert"]');assert.ok((await text()).includes('20%'));assert.ok(!(await text()).includes('아직 올라온 카드가 없습니다'));
  failed=false;cards[1].raw_text='다른 직원이 변경한 최신 일정';await page.evaluate(()=>window.fixtureTick());
  await page.waitForFunction(()=>document.querySelector('#hub').textContent.includes('다른 직원이 변경한 최신 일정'));
  await page.evaluate(()=>window.fixtureHidden=true);const beforeHidden=reads;await page.evaluate(()=>window.fixtureTick());
  await new Promise(r=>setTimeout(r,80));assert.equal(reads,beforeHidden);
  await page.evaluate(()=>{window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await page.click('button[aria-label="업무 비서 열기"]');await page.waitForSelector('textarea[placeholder^="업무를 한 줄"]');
  await page.type('textarea[placeholder^="업무를 한 줄"]','샘플 검수 결과 정리');await page.click('button[aria-label="보내기"]');
  await page.waitForFunction(()=>window.fixtureSignals.length>0);await until(()=>posts.some(p=>p.path==='/api/work'));
  const submitted=posts.find(p=>p.path==='/api/work').body;assert.equal(submitted.expectedUserId,a.id);
  assert.equal(await page.evaluate(()=>window.fixtureSignals.at(-1).ms),90000);
  me=b;await refresh();await page.waitForFunction(()=>document.querySelector('div.fixed.z-40').textContent.includes('테스트 B'));
  assert.equal(await page.$eval('button[aria-label="보내기"]',e=>e.disabled),true);
  assert.equal(await page.$eval('textarea[placeholder^="업무를 한 줄"]',e=>e.disabled),true);
  assert.ok(await page.$('div.fixed.z-40 [role="status"]'));
  me=a;await refresh();await page.waitForFunction(()=>document.querySelector('div.fixed.z-40').textContent.includes('테스트 MD 팀장'));
  await page.evaluate(()=>window.fixtureSignals.at(-1).c.abort(new DOMException('synthetic timeout','TimeoutError')));
  await page.waitForFunction(()=>document.body.textContent.includes('동일 요청 다시 확인'));
  assert.ok(await page.evaluate(key=>sessionStorage.getItem(key),'ames_work_submit_v1:'+a.id));
  postMode='malformed';await click('동일 요청 다시 확인','body');
  await page.waitForFunction(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='동일 요청 다시 확인');return e&&!e.disabled;});
  me=b;const beforeSwitch=cards.length;await click('동일 요청 다시 확인','body');
  await page.waitForFunction(()=>document.body.textContent.includes('로그인 계정이 변경되었거나 만료되었습니다'));
  assert.equal(cards.length,beforeSwitch);assert.ok(!cards.some(c=>c.id===submitted.requestId&&c.created_by===b.id));
  await refresh();await page.waitForFunction(()=>document.body.textContent.includes('테스트 B'));
  assert.equal(await page.$eval('textarea[placeholder^="업무를 한 줄"]',e=>e.value),'');
  me=a;postMode='ok';await refresh();await page.waitForFunction(()=>document.body.textContent.includes('동일 요청 다시 확인'));
  await click('동일 요청 다시 확인','body');await page.waitForFunction(key=>!sessionStorage.getItem(key),{},'ames_work_submit_v1:'+a.id);
  assert.equal(cards.filter(c=>c.id===submitted.requestId).length,1);
  const retries=posts.filter(p=>p.path==='/api/work').map(p=>p.body);assert.equal(retries.length,4);retries.forEach(p=>assert.deepEqual(p,submitted));
  holdReads=2;await refresh();await until(()=>held.length===2);
  cards.find(c=>c.id===submitted.requestId).raw_text='최종 최신 검수 기록';await refresh();
  await page.waitForFunction(()=>document.querySelector('#hub').textContent.includes('최신 검수 기록'));
  release();await new Promise(r=>setTimeout(r,80));assert.ok((await text()).includes('최신 검수 기록'));
  assert.ok((await page.$eval('div.fixed.z-40',e=>e.textContent)).includes('최신 검수 기록'));
  for(let i=0;i<=210;i++)cards.push({id:'wc_old'+i,created_at:new Date(Date.UTC(2026,8,1)+i*60000).toISOString(),created_by:i===0?'fixture_staff':a.id,
    created_by_name:'테스트 직원',team:a.team,raw_text:'과거 업무 '+i,kind:i===0?'request_check':'todo',status:'open',assignee_id:a.id,parsed:{},shared_teams:[],read_by:[]});
  await refresh();await page.waitForFunction(()=>[...document.querySelectorAll('#hub button')].some(e=>e.textContent==='이전 업무 더 보기'));
  await click('이전 업무 더 보기');await page.waitForSelector('#hub input[placeholder^="답변"]');
  await page.type('#hub input[placeholder^="답변"]','보존할 답변 초안');
  cards.push({...cards[0],id:'wc_newfixture',raw_text:'갱신된 신규 업무',created_at:'2026-10-11T00:00:00Z',kind:'share'});
  await page.evaluate(()=>window.fixtureTick());await page.waitForFunction(()=>document.querySelector('#hub').textContent.includes('갱신된 신규 업무'));
  assert.equal(await page.$eval('#hub input[placeholder^="답변"]',e=>e.value),'보존할 답변 초안');
  failOlder=true;await refresh();await page.waitForSelector('#hub [role="alert"]');
  assert.equal(await page.$eval('#hub input[placeholder^="답변"]',e=>e.value),'보존할 답변 초안');
  failOlder=false;await refresh();await page.waitForFunction(()=>!document.querySelector('#hub [role="alert"]'));
  for(let i=0;i<400;i++)cards.push({...cards.find(c=>c.id==='wc_old0'),id:'wc_deep'+i,created_at:new Date(Date.UTC(2026,7,1)+i*60000).toISOString(),
    raw_text:'더 오래된 업무 '+i,kind:i===399?'request_check':'todo',created_by:i===399?'fixture_staff':a.id});
  await refresh();await page.waitForFunction(()=>[...document.querySelectorAll('#hub button')].some(e=>e.textContent==='이전 업무 더 보기'));
  holdOlderReads=1;await refresh();await until(()=>held.length===1);
  await click('이전 업무 더 보기');await page.waitForFunction(()=>document.querySelector('#hub').textContent.includes('더 오래된 업무 399'));
  await page.evaluate(()=>{const p=[...document.querySelectorAll('#hub p')].find(e=>e.textContent==='더 오래된 업무 399');const input=p.parentElement.querySelector('input');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'교차 응답에도 보존');input.dispatchEvent(new Event('input',{bubbles:true}));});
  release();await new Promise(r=>setTimeout(r,80));
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#hub p')].find(e=>e.textContent==='더 오래된 업무 399').parentElement.querySelector('input').value),'교차 응답에도 보존');
  bOnly=[{...cards[0],id:'wc_b_ancient',created_at:'2020-01-01T00:00:00Z',raw_text:'B 계정의 오래된 고유 업무',created_by:b.id,kind:'todo',assignee_id:b.id}];
  me=b;await refresh();await page.waitForFunction(()=>document.querySelector('#hub').textContent.includes('B 계정의 오래된 고유 업무'));
  assert.ok(!(await text()).includes('더 오래된 업무 399'));
  me=a;await refresh();await page.waitForFunction(()=>document.querySelector('#hub').textContent.includes('테스트 MD 팀장'));
  assert.ok(!(await text()).includes('더 오래된 업무 399')); // A also returns to its initial range, not B's range.
  await page.click('#unmount');await page.waitForFunction(()=>window.fixtureTimers.size===0);const beforeUnmount=reads;
  await refresh();await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await new Promise(r=>setTimeout(r,80));assert.equal(reads,beforeUnmount);
  assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
  console.log('Work UI chain PASS: initial loading, read≠done, reply, confirm/cache/share, auto refresh, failed read retention, hidden pause, timeout/same-ID retry, in-flight account switch, account binding, stale response, paginated draft retention/partial failure/interleaved responses, account-owned range, cleanup; synthetic HTTP only');
}catch(error){const pages=await browser?.pages();console.error('Synthetic UI diagnostic',JSON.stringify({reads,holdReads,held:held.length,posts,campaigns,body:await pages?.at(-1)?.$eval('body',e=>e.textContent)}));throw error;}
finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
