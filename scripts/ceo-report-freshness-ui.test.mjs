// Offline browser fixtures only: no account, company records or external requests.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer';

const html=await readFile(new URL('../server/ceo-console.html',import.meta.url),'utf8');
let state='current',unavailable=false;
const fixture=()=>({me:{name:'테스트 대표',email:'test@example.invalid'},today:'2026-10-10',
  decide:[],captures:[],buyers:[],campaigns:[],recent:[],orders:[],watch:[],kpi:null,checkedAt:'2026-10-10T00:00:00Z',
  erpUrl:'https://erp.fixture.invalid',sourceErrors:unavailable?['팀 감시 기준']:[],
  teams:[{team:'마케팅',open:0,overdue:0,newToday:0,doneToday:0}],org:{teams:[],divisions:[],heads:[]},
  agents:[{id:'ag_fixture',team:'마케팅',headline:'저장된 보고',created_at:'2026-10-10T00:00:00Z',freshness:state,needs:[{text:'대표 결정 필요'}]}],
  councils:[{id:'ac_fixture',topic:'공동 준비',teams:['마케팅','물류·CS'],status:'concluded',freshness:state,
    cost:{evidence:{hash:'a'.repeat(64)}},created_at:'2026-10-10T00:00:00Z',messages:[],
    conclusion:{conclusion:'저장된 협의',ceo_decisions:[],open_disagreements:[],actions_by_team:[{team:'마케팅',action:'준비 확인'}]}}]});
const server=createServer((req,res)=>{
  res.setHeader('Content-Type',req.url?.startsWith('/api/')?'application/json':'text/html; charset=utf-8');
  if(req.url==='/api/ceo/overview') res.end(JSON.stringify(fixture()));
  else if(req.url==='/') res.end(html);
  else {res.statusCode=404;res.end('{}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await puppeteer.launch({headless:true});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const base='http://127.0.0.1:'+server.address().port;
  for(const [value,label] of [['current','저장 근거와 일치'],['changed','근거 변경 · 다시 점검 필요'],['unknown','최신 근거 확인 불가']]) {
    state=value;unavailable=value==='unknown';
    await page.goto(base+'/#councils');
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#view')?.textContent.includes('저장된 협의'));
    const text=await page.$eval('#view',e=>e.textContent);
    assert.ok(text.includes(label));
    assert.equal(await page.$$eval('[data-council-direct]',es=>es.length),value==='current'?1:0);
    assert.equal(await page.$eval('#navN',e=>e.hidden),value!=='current');
    if(unavailable) assert.ok(text.includes('현재 조회 미확인: 팀 감시 기준'));
    await page.goto(base+'/#home');
    await page.waitForFunction(()=>document.querySelector('#view')?.textContent.includes('저장된 보고'));
    assert.ok((await page.$eval('#view',e=>e.textContent)).includes(label));
    await page.goto(base+'/#inbox');
    await page.waitForFunction(()=>document.querySelector('#view')?.textContent.includes('협의 결론'));
    assert.equal((await page.$eval('#view',e=>e.textContent)).includes('공동 준비'),value==='current');
  }
  assert.deepEqual(errors,[]);
  console.log('CEO freshness browser PASS: 3 states, home/history/inbox, direct gating, badge and source failure banner; offline fixtures only');
} finally {if(browser) await browser.close();server.closeAllConnections();server.close();}
