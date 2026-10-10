// Actual console HTML/handlers with synthetic API; no real account/model/DB.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer';
const html=await readFile(new URL('../server/ceo-console.html',import.meta.url),'utf8');
let mode='normal',posts=0,overviewFailure=false,hold=false,release,latest='점검 전';
let holdOverview=false,heldOverview;
const fixture=()=>({me:{id:'fixture_boss',name:'테스트 대표',email:'test@fixture.invalid'},today:'2026-10-10',decide:[],captures:[],buyers:[],campaigns:[],recent:[],orders:[],watch:[],kpi:null,councils:[],sourceErrors:[],checkedAt:'2026-10-10T00:00:00Z',erpUrl:'https://erp.fixture.invalid',
  teams:[{team:'마케팅',open:1,overdue:0,newToday:0,doneToday:0}],org:{teams:[{key:'마케팅',division:'브랜드',members:[],focus:'마케팅'}],divisions:['브랜드'],heads:[]},
  agents:[{id:'fixture_run',team:'마케팅',headline:latest,created_at:'2026-10-10T00:00:00Z',freshness:mode==='normal'?'current':'unknown',needs:[],stats:{}}]});
const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type',req.url?.startsWith('/api/')?'application/json':'text/html; charset=utf-8');
  if(req.url==='/') {res.end(html);return;}
  if(req.url==='/favicon.ico') {res.statusCode=204;res.end();return;}
  if(req.url==='/api/ceo/overview') {
    const status=overviewFailure?503:200,body=JSON.stringify(overviewFailure?{error:'fixture_offline'}:fixture());
    const finish=()=>{res.statusCode=status;res.end(body);};
    if(holdOverview) {holdOverview=false;heldOverview=finish;}else finish();return;
  }
  if(req.url==='/api/ceo/agents/run') {
    posts++;latest='실행 후 저장된 팀 보고';
    const finish=()=>{
      if(mode==='lost') {res.end('{');return;}
      const body={runs:[{team:'마케팅'}],saved:1,reportFailures:mode==='ai_failure'?['마케팅']:[],saveFailures:mode==='partial'?['생산관리']:[]};
      if(mode==='partial') {res.statusCode=503;body.error='partial_agent_run';body.message='일부 팀 저장 실패';}
      res.end(JSON.stringify(body));
    };
    if(hold) release=finish;else finish();return;
  }
  res.statusCode=404;res.end('{}');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try {
  browser=await puppeteer.launch({headless:true});const page=await browser.newPage(),errors=[],blocked=[];
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  const base='http://127.0.0.1:'+server.address().port;
  page.on('request',r=>{if(new URL(r.url()).origin===base||r.url().startsWith('data:image/'))r.continue();
    else if(r.url()==='https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css')r.respond({status:200,contentType:'text/css',body:''});
    else{blocked.push(r.url());r.abort();}});
  await page.goto(base+'/#map');await page.waitForSelector('button[data-run=""]');
  hold=true;await page.click('button[data-run=""]');
  await page.waitForFunction(()=>[...document.querySelectorAll('button[data-run]')].every(b=>b.disabled));
  await page.evaluate(()=>{location.hash='#home';});await page.waitForFunction(()=>document.querySelector('#crumb').textContent==='홈');
  await page.evaluate(()=>{location.hash='#map';});await page.waitForSelector('button[data-run=""]');
  assert.equal(await page.$eval('button[data-run=""]',e=>e.disabled),true);
  await page.$eval('button[data-run=""]',e=>e.click());assert.equal(posts,1);
  hold=false;release();await page.waitForFunction(()=>document.querySelector('#agentRunStatus').textContent.includes('정상 보고 1팀'));
  assert.equal(await page.$eval('#agentRunStatus',e=>e.getAttribute('role')),'status');
  assert.ok((await page.$eval('#view',e=>e.textContent)).includes('실행 후 저장된 팀 보고'));
  for(const [scenario,marker] of [['ai_failure','보고 재점검: 마케팅'],['partial','저장 재점검: 생산관리'],['lost','점검 결과를 확인하지 못했습니다'],['normal','최신 화면 조회 실패']]) {
    mode=scenario;overviewFailure=scenario==='normal';
    await page.click('button[data-run=""]');
    await page.waitForFunction(marker=>document.querySelector('#agentRunStatus').textContent.includes(marker),{},marker);
    assert.equal(await page.$eval('#agentRunStatus',e=>e.getAttribute('role')),'alert');
    if(!overviewFailure) assert.ok((await page.$eval('#view',e=>e.textContent)).includes('실행 후 저장된 팀 보고'));
  }
  overviewFailure=false;mode='normal';await page.reload();await page.waitForSelector('button[data-run=""]');
  await page.click('button[data-run=""]');await page.waitForFunction(()=>document.querySelector('#agentRunStatus').getAttribute('role')==='status');
  for(const staleFailure of [false,true]) {
    await page.waitForFunction(()=>[...document.querySelectorAll('button[data-run]')].every(b=>!b.disabled));
    holdOverview=true;heldOverview=null;latest='늦은 과거 보고';overviewFailure=staleFailure;
    await page.evaluate(()=>{void load();});
    const end=Date.now()+5000;while(!heldOverview) {assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,10));}
    overviewFailure=false;await page.$eval('button[data-run=""]',e=>e.click());
    await page.waitForFunction(()=>document.querySelector('#view').textContent.includes('실행 후 저장된 팀 보고')&&
      [...document.querySelectorAll('button[data-run]')].every(b=>!b.disabled));
    heldOverview();await new Promise(r=>setTimeout(r,80));
    assert.ok((await page.$eval('#view',e=>e.textContent)).includes('실행 후 저장된 팀 보고'));
    assert.ok(!(await page.$eval('#view',e=>e.textContent)).includes('불러오지 못했습니다'));
  }
  assert.equal(posts,8);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  console.log('CEO manual run UI PASS: normal/AI failure/partial save/lost JSON/read failure, refreshed saved reports, navigation busy guard/recovery; synthetic APIs only');
} finally {await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
