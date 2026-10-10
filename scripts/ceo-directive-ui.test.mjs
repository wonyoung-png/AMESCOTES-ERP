// Offline synthetic browser: test ambiguous responses and DOM replacement/reload.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer';

const html=await readFile(new URL('../server/ceo-console.html',import.meta.url),'utf8');
const teams=['마케팅','국내 MD'];
const fixture={me:{id:'fixture_boss',name:'테스트 대표',email:'test@example.invalid'},today:'2026-10-10',
  decide:[],captures:[],buyers:[],campaigns:[],recent:[],orders:[],watch:[],kpi:null,checkedAt:'2026-10-10T00:00:00Z',
  erpUrl:'https://erp.fixture.invalid',sourceErrors:[],
  teams:teams.map(team=>({team,open:0,overdue:0,newToday:0,doneToday:0})),
  org:{teams:teams.map(key=>({key,members:[],division:'브랜드'})),divisions:['브랜드'],heads:[]},agents:[],councils:[]};
const requests=[],saved=new Set();
const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type',req.url?.startsWith('/api/')?'application/json':'text/html; charset=utf-8');
  if(req.url==='/api/ceo/overview') res.end(JSON.stringify(fixture));
  else if(req.url==='/') res.end(html);
  else if(req.url==='/api/ceo/directive') {
    let raw='';for await(const chunk of req) raw+=chunk;
    const body=JSON.parse(raw);requests.push(body);saved.add(body.requestId);
    if(requests.length===1) {res.end('{');return;}
    if(requests.length===2) {res.statusCode=503;res.end('{"error":"temporary_failure"}');return;}
    setTimeout(()=>res.end(JSON.stringify({ok:true,cardId:body.requestId,delivered:'테스트 담당자',notified:true})),200);
  } else {res.statusCode=404;res.end('{}');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await puppeteer.launch({headless:true});const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const base='http://127.0.0.1:'+server.address().port;
  const form='form.order:not(.watch)',button=form+' button',text=form+' textarea';
  await page.goto(base+'/#map');await page.waitForSelector(text);
  await page.type(text,'검수 결과 확인');await page.$eval(form+' input',e=>e.value='2026-10-20');
  await page.click(button);
  await page.waitForFunction(s=>document.querySelector(s)?.textContent==='같은 지시 다시 전달',{},button);
  const first=requests[0];assert.match(first.requestId,/^wc_[a-z0-9]+$/);
  await page.evaluate(()=>{window.fixtureStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('retry cache blocked');};});
  await page.click(button);
  await page.waitForFunction(()=>document.querySelector('#view').textContent.includes('지시를 보내지 않았습니다'));
  assert.equal(requests.length,1);assert.equal(await page.$eval(text,e=>e.disabled),true);
  await page.evaluate(()=>{Storage.prototype.setItem=window.fixtureStorageSet;});
  await page.click('[data-team="국내 MD"].map-node');
  await page.click('[data-team="마케팅"].map-node');
  assert.equal(await page.$eval(text,e=>e.value),first.text);
  await page.goto(base+'/#home');await page.goto(base+'/#map');
  await page.waitForSelector(text);await page.reload();await page.waitForSelector(text);
  assert.equal(await page.$eval(text,e=>e.disabled),true);
  assert.equal(await page.$eval(form+' input',e=>e.value),first.dueDate);
  await page.click(button);
  await page.waitForFunction(s=>!document.querySelector(s)?.disabled,{},button);
  assert.equal(requests.length,2);assert.deepEqual(requests[1],first);
  await page.reload();await page.waitForSelector(text);await page.click(button);
  // Re-render while the request is in flight: the retry button must stay blocked.
  await page.click('[data-team="국내 MD"].map-node');await page.click('[data-team="마케팅"].map-node');
  assert.equal(await page.$eval(button,e=>e.disabled),true);
  await page.waitForFunction(s=>!document.querySelector(s)?.disabled,{},button);
  assert.equal(requests.length,3);assert.deepEqual(requests[2],first);assert.equal(saved.size,1);
  assert.equal(await page.$eval(text,e=>e.value),'');
  // A different CEO account must never inherit another account's uncertain send.
  await page.evaluate(p=>sessionStorage.setItem('ceo-directives:fixture_boss',JSON.stringify({[p.team]:p})),first);
  fixture.me.id='another_fixture_boss';await page.reload();await page.waitForSelector(text);
  assert.equal(await page.$eval(text,e=>e.value),'');
  assert.equal(await page.$eval(text,e=>e.disabled),false);
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('blocked fixture');};});
  await page.type(text,'저장 차단 테스트');await page.click(button);
  await page.waitForFunction(()=>document.querySelector('#view').textContent.includes('지시를 보내지 않았습니다'));
  assert.equal(requests.length,3,'Blocked cache must fail before sending, not cause uncertain duplicates');
  assert.equal(await page.$eval(text,e=>e.disabled),false);
  assert.deepEqual(errors,[]);
  console.log('CEO directive browser PASS: same request after response loss, team/hash navigation, reload, 503 retry, in-flight re-render; one saved fixture');
} finally {if(browser)await browser.close();server.closeAllConnections();server.close();}
