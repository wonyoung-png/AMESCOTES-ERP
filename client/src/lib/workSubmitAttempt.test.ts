import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkSubmitAttempt, workSubmitSessionKey } from './workSubmitAttempt';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

function memory() {
  const rows = new Map<string, string>();
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
}

test('lost committed response: reject changed text, restore original ID and retry once', async () => {
  const storage = memory();
  let attempt = createWorkSubmitAttempt('staff', storage);
  const calls: string[] = [], records = new Set<string>();
  let lose = true;
  const send = async (body: { text: string; requestId: string }) => {
    assert.ok(storage.getItem(workSubmitSessionKey('staff')), 'Persist before any send');
    calls.push(JSON.stringify(body)); records.add(body.requestId);
    if (lose) { lose = false; return null; }
    return { id: body.requestId };
  };
  await assert.rejects(attempt.run(' 팀장 확인 필요 ', send), /미확인/);
  const original = attempt.request;
  await assert.rejects(attempt.run('다른 업무', send), /원문/);
  assert.equal(calls.length, 1);
  attempt = createWorkSubmitAttempt('staff', storage);
  assert.deepEqual(attempt.request, original);
  await attempt.run('팀장 확인 필요', send);
  assert.equal(calls[0], calls[1]); assert.equal(records.size, 1);
  assert.equal(attempt.request, null); assert.equal(storage.getItem(workSubmitSessionKey('staff')), null);
});

test('user keys isolate pending requests and malformed/foreign snapshots fail closed', async () => {
  const storage = memory();
  const first = createWorkSubmitAttempt('staff', storage);
  await assert.rejects(first.run('원문', async () => null));
  assert.equal(createWorkSubmitAttempt('boss', storage).request, null);
  for (const value of ['{bad', JSON.stringify({version:1,userId:'boss',text:'원문',requestId:'wc_valid'}),
    JSON.stringify({version:1,userId:'staff',text:' 원문 ',requestId:'wc_valid'}),
    JSON.stringify({version:1,userId:'staff',text:'원문',requestId:'bad-id'})]) {
    storage.setItem(workSubmitSessionKey('staff'), value);
    const attempt = createWorkSubmitAttempt('staff', storage);
    assert.ok(attempt.blocked);
    await assert.rejects(attempt.run('새 업무', async () => { assert.fail('Must not send'); }), /이전 요청/);
    assert.equal(storage.getItem(workSubmitSessionKey('staff')), value);
  }
});

test('unavailable storage never sends; unexpected response keeps frozen request', async () => {
  const broken = { ...memory(), setItem: () => { throw Error('quota'); } };
  await assert.rejects(createWorkSubmitAttempt('staff', broken).run('원문', async () => { assert.fail('Must not send'); }), /전송하지/);
  const inaccessible = { ...memory(), getItem: () => { throw Error('disabled'); } };
  const blocked = createWorkSubmitAttempt('staff', inaccessible);
  await assert.rejects(blocked.run('원문', async () => { assert.fail('Must not send'); }), /이전 요청/);
  const attempt = createWorkSubmitAttempt('staff', memory());
  await assert.rejects(attempt.run('원문', async () => ({ id: 'wc_wrong' })), /미확인/);
  assert.equal(attempt.request?.text, '원문');
  await assert.rejects(attempt.run('원문', async () => { throw Error('network'); }), /network/);
  assert.equal(attempt.request?.text, '원문');
});

test('concurrent send and cleanup failure cannot discard or replace request', async () => {
  const storage = memory();
  const attempt = createWorkSubmitAttempt('staff', storage);
  let finish!: (result: { id: string }) => void;
  const pending = attempt.run('원문', () => new Promise<{ id: string }>(resolve => { finish = resolve; }));
  await assert.rejects(attempt.run('원문', async () => { assert.fail('Must not send twice'); }), /확인 중/);
  finish({ id: attempt.request!.requestId }); await pending;
  const cleanupFailure = createWorkSubmitAttempt('staff', { ...storage, removeItem: () => { throw Error('disabled'); } });
  await assert.rejects(cleanupFailure.run('원문', async body => ({ id: body.requestId })), /업무는 저장/);
  assert.ok(cleanupFailure.request); assert.ok(storage.getItem(workSubmitSessionKey('staff')));
});

test('real widget: lost response blocks editing; same tab reload restores exact retry', { timeout: 90000 }, async () => {
  const bundled = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import Widget from './client/src/components/WorkChatWidget';
      createRoot(document.getElementById('root')).render(<Widget/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'widget-fixture', setup(b) {
      b.onResolve({ filter: /^@\/components\/WorkCardActions$|^sonner$/ }, args => ({path:args.path,namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'}, args => ({loader:'js', contents: args.path === 'sonner'
        ? 'export const toast={error:()=>{},warning:()=>{},success:()=>{}};'
        : `export const CardActions=()=>null, isTodo=()=>false, isUnread=()=>false, fmtTime=x=>x, PROFILE_PLACEHOLDER='', PROFILE_MAX=1000;
          export const fetchWork=async()=>({items:[],me:{id:'fixture_staff',name:'직원',team:'국내 MD'},counts:{todo:0,attention:0}});
          export const announceWorkChanged=()=>window.dispatchEvent(new Event('work:changed'));
          export const postWork=async(text,requestId)=>{
            const calls=JSON.parse(localStorage.getItem('fixture_calls')||'[]'); calls.push({text,requestId});
            localStorage.setItem('fixture_calls',JSON.stringify(calls));
            const rows=JSON.parse(localStorage.getItem('fixture_rows')||'[]');
            if(!rows.includes(requestId)) rows.push(requestId);
            localStorage.setItem('fixture_rows',JSON.stringify(rows));
            if(calls.length===1) { await new Promise(r=>setTimeout(r,100)); return null; }
            return {id:requestId};
          };` }));
    }}],
  });
  const server = createServer((req,res) => {
    if(req.url==='/fixture.js') {res.setHeader('Content-Type','text/javascript');res.end(bundled.outputFiles[0].text);}
    else if(req.url==='/') {res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/fixture.js"></script>');}
    else {res.statusCode=404;res.end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address(); assert.ok(address && typeof address!=='string');
  const origin=`http://127.0.0.1:${address.port}`;
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
  let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;
  try {
    browser=await puppeteer.launch({headless:true,protocolTimeout:30000,...(chrome?{executablePath:chrome}:{})});
    const page=await browser.newPage(); page.setDefaultTimeout(10000);
    const forbidden:string[]=[],errors:string[]=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on('request',r=>{if(!r.url().startsWith(origin+'/')) {forbidden.push(r.url());void r.abort();}else void r.continue();});
    await page.goto(origin);
    await page.click('[aria-label="업무 비서 열기"]');
    await page.waitForFunction(()=>!(document.querySelector('textarea') as HTMLTextAreaElement)?.disabled);
    await page.type('textarea','팀장 확인 필요');
    await page.click('[aria-label="보내기"]');
    await page.waitForSelector('[role="alert"]');
    assert.equal(await page.$eval('textarea',el=>(el as HTMLTextAreaElement).disabled),true);
    assert.equal(await page.$eval('[aria-label="보내기"]',el=>(el as HTMLButtonElement).disabled),true);
    const original=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture_calls')!)[0]);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture_calls')!).length),1);
    await page.reload();
    await page.click('[aria-label="업무 비서 열기"]');
    await page.waitForSelector('[role="alert"]');
    assert.match(await page.$eval('[role="alert"]',el=>el.textContent||''),/팀장 확인 필요/);
    assert.match(await page.$eval('[role="alert"]',el=>el.textContent||''),/다른 탭·기기/);
    await page.evaluate(()=> (Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='동일 요청 다시 확인') as HTMLButtonElement).click());
    await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
    const calls=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture_calls')!));
    assert.deepEqual(calls,[original,original]);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture_rows')!).length),1);
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),workSubmitSessionKey('fixture_staff')),null);
    assert.equal(await page.$eval('textarea',el=>(el as HTMLTextAreaElement).disabled),false);
    assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
  } finally {
    await browser?.close();
    await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  }
});
