import assert from 'node:assert/strict';
import test from 'node:test';
import { createChinaStockAttempt, chinaStockSessionKey, type ChinaRequest } from './chinaStockAttempt';

const outbound = (): ChinaRequest => ({kind:'outbound',workspace:'LUMEN',action:'move',input:{
  id:'fixed-id',styleNo:'SKU1',color:'BLACK',qty:4,moveType:'outbound',moveDate:'2026-10-10',memo:'원본',
}});

for (const firstKind of ['outbound', 'transfer'] as const) {
  test(`${firstKind}: committed response lost, changed kind/body/id cannot debit twice`, async () => {
    const attempt = createChinaStockAttempt();
    const first = outbound();
    first.input.qty=8;
    if (firstKind === 'transfer') { first.kind='transfer'; first.action='transfer'; first.input.action='send'; }
    const calls: {workspace:string;action:string;input:object}[] = [];
    const rows = new Set<string>();
    let stock = 10, inTransit = 0, loseResponse = true;
    const send = async (workspace:string, action:string, input:object) => {
      calls.push({workspace,action,input:structuredClone(input)});
      const body = input as Record<string,unknown>;
      const key = (action === 'transfer' ? 'transfer_' : '') + body.id;
      if (!rows.has(key)) {
        rows.add(key); stock -= Number(body.qty);
        if (action === 'transfer') inTransit += Number(body.qty);
      }
      if (loseResponse) { loseResponse=false; throw new Error('response lost AFTER commit'); }
      return {stock,inTransit};
    };
    await assert.rejects(attempt.run(first, send), /AFTER commit/);
    // Latest stock is already reduced; retry must not compare the frozen qty to it.
    assert.equal(stock, 2);
    first.input.qty = 99; first.input.id='new-id'; first.workspace='AETALOOF';
    const changed = outbound(); changed.kind=firstKind === 'outbound' ? 'transfer' : 'outbound';
    changed.action=changed.kind === 'transfer' ? 'transfer' : 'move';
    changed.input={id:'different-id',qty:5,action:'send',moveDate:'2026-10-11'};
    const result = await attempt.run(changed,send);
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(rows.size, 1); assert.equal(result.result.stock, 2);
    assert.equal(result.result.inTransit, firstKind === 'transfer' ? 8 : 0);
    assert.equal(result.request.kind, firstKind); assert.equal(result.request.input.qty,8);
    assert.equal(result.request.input.id,'fixed-id');
  });
}

for (const kind of ['adjust', 'receive'] as const) {
  test(`${kind}: dates, evidence and quantity stay frozen through repeated failures`, async () => {
    const attempt = createChinaStockAttempt();
    const candidate:ChinaRequest = {kind,workspace:'LUMEN',action:kind==='receive'?'transfer':'move',
      input:{id:'fixed',qty:-3,action:kind==='receive'?'receive':undefined,receivedDate:'2026-10-10',confirmationRef:'receipt-1',memo:'근거'}};
    const bodies:string[]=[];
    const send = async (_workspace:string,_action:string,input:object) => {
      bodies.push(JSON.stringify(input));
      // A sender mutating its argument cannot corrupt the stored original.
      (input as Record<string,unknown>).qty=100;
      throw new Error('unknown outcome');
    };
    await assert.rejects(attempt.run(candidate,send));
    candidate.input={id:'new',qty:10,receivedDate:'2026-10-11',confirmationRef:'receipt-2'};
    await assert.rejects(attempt.run(candidate,send));
    assert.equal(bodies[1], bodies[0]);
    assert.equal(attempt.request?.input.qty,-3);
    const exposed = attempt.request!; exposed.input.id='mutated';
    assert.equal(attempt.request?.input.id,'fixed');
  });
}

test('synchronous guard blocks concurrent sends and clearing in flight; explicit clear permits next request', async () => {
  const attempt = createChinaStockAttempt();
  let finish!: (value:number)=>void;
  let calls=0;
  const first = attempt.run(outbound(),async()=>{calls++;return new Promise<number>(resolve=>{finish=resolve;});});
  await assert.rejects(attempt.run(outbound(),async()=>{calls++;return 2;}), /응답/);
  assert.throws(()=>attempt.clear(),/응답/); assert.equal(calls,1);
  finish(1); await first;
  attempt.clear(); assert.equal(attempt.request,null);
  const next = outbound(); next.input.id='next'; next.input.qty=2;
  const saved = await attempt.run(next,async()=>2);
  assert.equal(saved.request.input.id,'next'); assert.equal(saved.request.input.qty,2);
});

function sessionFixture() {
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key) ?? null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const session={workspace:'LUMEN',userId:'user-1',storage:()=>storage};
  return {values,storage,session,key:chinaStockSessionKey('LUMEN','user-1')};
}

test('persist before send, remount reuses same body, workspace/user keys are isolated, success clears', async()=>{
  const f=sessionFixture();const first=createChinaStockAttempt(f.session);
  await assert.rejects(first.run(outbound(),async()=>{
    assert.deepEqual(JSON.parse(f.values.get(f.key)!),outbound());throw new Error('lost');
  }));
  const restored=createChinaStockAttempt(f.session);
  assert.deepEqual(restored.request,outbound());
  assert.equal(createChinaStockAttempt({...f.session,workspace:'AETALOOF'}).request,null);
  assert.equal(createChinaStockAttempt({...f.session,userId:'user-2'}).request,null);
  const changed=outbound();changed.kind='transfer';changed.action='transfer';changed.input.id='changed';
  const saved=await restored.run(changed,async(_ws,action,input)=>{assert.equal(action,'move');assert.deepEqual(input,outbound().input);return 6;});
  assert.equal(saved.request.input.qty,4);restored.clear();assert.equal(f.storage.getItem(f.key),null);
});

test('storage get/set/silent write failures and corrupt stored shape never send; failed removal preserves pending', async()=>{
  for(const failure of ['get','set','silent'] as const) {
    const f=sessionFixture();
    const storage={...f.storage,
      getItem:(key:string)=>{if(failure==='get')throw new Error('denied');return f.storage.getItem(key);},
      setItem:(key:string,value:string)=>{if(failure==='set')throw new Error('quota');if(failure!=='silent')f.storage.setItem(key,value);},
    };
    let calls=0;const attempt=createChinaStockAttempt({...f.session,storage:()=>storage});
    await assert.rejects(attempt.run(outbound(),async()=>++calls));assert.equal(calls,0);assert.ok(attempt.storageError);
  }
  for(const invalid of ['{',JSON.stringify({...outbound(),workspace:'AETALOOF'}),JSON.stringify({...outbound(),kind:'transfer'}),JSON.stringify({...outbound(),input:{...outbound().input,qty:0}})]) {
    const f=sessionFixture();f.values.set(f.key,invalid);const attempt=createChinaStockAttempt(f.session);
    let calls=0;await assert.rejects(attempt.run(outbound(),async()=>++calls));assert.equal(calls,0);
    assert.equal(f.values.get(f.key),invalid);attempt.clear();assert.equal(f.values.has(f.key),false);
  }
  const f=sessionFixture();f.values.set(f.key,JSON.stringify(outbound()));
  const attempt=createChinaStockAttempt({...f.session,storage:()=>({...f.storage,removeItem:()=>{throw new Error('denied');}})});
  assert.throws(()=>attempt.clear());assert.deepEqual(attempt.request,outbound());assert.ok(f.values.has(f.key));
});

test('late old completion cannot delete or overwrite a newer persisted request', async()=>{
  const f=sessionFixture();const old=createChinaStockAttempt(f.session);
  let finish!:()=>void;
  const sending=old.run(outbound(),async()=>new Promise<void>(resolve=>{finish=resolve;}));
  const restored=createChinaStockAttempt(f.session);restored.clear();
  const next=outbound();next.input.id='next';
  await restored.run(next,async()=>1);
  finish();await sending;
  assert.throws(()=>old.clear());assert.equal(JSON.parse(f.values.get(f.key)!).input.id,'next');
});

test('adjustment and arrival restore their original quantity/date/evidence', async()=>{
  for(const kind of ['adjust','receive'] as const) {
    const f=sessionFixture();
    const request:ChinaRequest=kind==='adjust'
      ? {...outbound(),kind,input:{...outbound().input,moveType:'adjust',qty:-3}}
      : {kind,workspace:'LUMEN',action:'transfer',input:{id:'transfer-id',action:'receive',receivedDate:'2026-10-10',confirmationRef:'receipt-1'}};
    await assert.rejects(createChinaStockAttempt(f.session).run(request,async()=>{throw new Error('lost');}));
    const restored=createChinaStockAttempt(f.session);
    assert.deepEqual(restored.request,request);
    await restored.run(outbound(),async(_ws,action,input)=>{assert.equal(action,request.action);assert.deepEqual(input,request.input);return 1;});
  }
});

test('receive shape: legacy neither-field requests replay unchanged; new pair is required and validated', async()=>{
  const legacy:ChinaRequest={kind:'receive',workspace:'LUMEN',action:'transfer',input:{id:'transfer-id',action:'receive',receivedDate:'2026-10-10',confirmationRef:'old-receipt'}};
  for(const extra of [{},{receivedQty:3,arrivalId:'arrival-fixed'}]) {
    const f=sessionFixture(), request={...legacy,input:{...legacy.input,...extra}};
    f.values.set(f.key,JSON.stringify(request));
    const restored=createChinaStockAttempt(f.session);
    assert.equal(restored.storageError,'');assert.deepEqual(restored.request,request);
    await restored.run(outbound(),async(_ws,_action,input)=>{assert.deepEqual(input,request.input);return 1;});
  }
  for(const extra of [{receivedQty:3},{arrivalId:'arrival-fixed'},{receivedQty:0,arrivalId:'a'},{receivedQty:-1,arrivalId:'a'},
    {receivedQty:1.5,arrivalId:'a'},{receivedQty:2147483648,arrivalId:'a'},{receivedQty:'3',arrivalId:'a'},
    {receivedQty:3,arrivalId:''},{receivedQty:3,arrivalId:null},{receivedQty:3,arrivalId:'bad/id'},{receivedQty:null,arrivalId:'a'}]) {
    const f=sessionFixture(),request={...legacy,input:{...legacy.input,...extra}};
    f.values.set(f.key,JSON.stringify(request));
    const restored=createChinaStockAttempt(f.session);assert.ok(restored.storageError);
    let calls=0;await assert.rejects(restored.run(request,async()=>++calls));assert.equal(calls,0);
    const fresh=sessionFixture();
    await assert.rejects(createChinaStockAttempt(fresh.session).run(request,async()=>++calls));assert.equal(calls,0);
  }
});

test('partial receive response loss freezes arrivalId/quantity/proof across workspace/user remount', async()=>{
  const f=sessionFixture();
  const request:ChinaRequest={kind:'receive',workspace:'LUMEN',action:'transfer',input:{id:'transfer-id',action:'receive',receivedQty:3,arrivalId:'arrival-fixed',receivedDate:'2026-10-10',confirmationRef:'receipt-3'}};
  let received=0;const arrivals=new Map<string,object>();let calls=0;
  const send=async(_ws:string,_action:string,input:object)=>{
    calls++;const body=input as Record<string,unknown>;
    if(!arrivals.has(String(body.arrivalId))){arrivals.set(String(body.arrivalId),structuredClone(input));received+=Number(body.receivedQty);throw new Error('committed response lost');}
    assert.deepEqual(input,arrivals.get(String(body.arrivalId)));
    return {received,remaining:4-received};
  };
  await assert.rejects(createChinaStockAttempt(f.session).run(request,send));assert.equal(received,3);
  assert.equal(createChinaStockAttempt({...f.session,workspace:'AETALOOF'}).request,null);
  assert.equal(createChinaStockAttempt({...f.session,userId:'other-user'}).request,null);
  const restored=createChinaStockAttempt(f.session);
  request.input={...request.input,receivedQty:1,arrivalId:'changed',confirmationRef:'changed-proof',receivedDate:'2026-10-11'};
  const saved=await restored.run(request,send);
  assert.equal(calls,2);assert.equal(arrivals.size,1);assert.deepEqual(saved.result,{received:3,remaining:1});
  assert.equal(saved.request.input.arrivalId,'arrival-fixed');assert.equal(saved.request.input.receivedQty,3);
});

for (const transferMode of [false,true]) test(`real ChinaWarehouse UI (${transferMode?'transfer':'outbound'}): lost response locks fields, closing cannot start a new debit, original retry succeeds`, async () => {
  const { build } = await import('esbuild');
  const { default: puppeteer } = await import('puppeteer');
  const { existsSync } = await import('node:fs');
  const bundle = await build({
    stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import ChinaWarehouse from './client/src/pages/ChinaWarehouse';
      import {FixtureProvider} from '@/contexts/WorkspaceContext';
      function Harness(){const [visible,setVisible]=useState(true);return <FixtureProvider><button onClick={()=>setVisible(!visible)}>{visible?'다른 페이지':'창고 페이지'}</button>{visible?<ChinaWarehouse/>:<p>다른 페이지</p>}</FixtureProvider>}
      createRoot(document.getElementById('root')).render(<Harness/>);`,resolveDir:process.cwd(),loader:'tsx'},
    bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    define:{'process.env.NODE_ENV':'"production"'},
    plugins:[{name:'isolated-china-fixture',setup(build){
      build.onResolve({filter:/^@\/(contexts\/WorkspaceContext|lib\/(store|phase1|chinaStock))$/},args=>({path:args.path,namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:
        args.path.endsWith('WorkspaceContext') ? `import React,{createContext,useContext,useState} from 'react';const C=createContext({workspace:'LUMEN'});export const useWorkspace=()=>useContext(C);
          export function FixtureProvider({children}){const [workspace,setWorkspace]=useState('LUMEN');return <C.Provider value={{workspace}}><button onClick={()=>setWorkspace('AETALOOF')}>브랜드 AETALOOF</button><button onClick={()=>setWorkspace('LUMEN')}>브랜드 LUMEN</button>{children}</C.Provider>;}`
        : args.path.endsWith('/store') ? `export const store={getCurrentUser:()=>({id:'user-1'}),getItems:()=>[{id:'sku',styleNo:'SKU1',name:'품목'}]};export const formatNumber=String;`
        : args.path.endsWith('/phase1') ? `export const phase1={getChinaStockMoves:()=>[]};`
        : `export const chinaStockRequest=(workspace,action,input)=>window.fixtureSend(workspace,action,input);`,loader:'tsx',resolveDir:process.cwd()}));
    }}],
  });
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
  const {createServer}=await import('node:http');
  const server=createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
    else{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/fixture.js"></script>');}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address && typeof address!=='string');
  const origin=`http://127.0.0.1:${address.port}`;
  let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;
  try {
    browser=await puppeteer.launch({headless:true,...(chrome?{executablePath:chrome}:{})});
    const page=await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.setRequestInterception(true);
    const external:string[]=[];
    page.on('request',request=>{if(request.url().startsWith(origin+'/') || request.url().startsWith('data:'))void request.continue();else{external.push(request.url());void request.abort();}});
    const calls:{workspace:string;action:string;input:Record<string,unknown>}[]=[];
    const rows=new Map<string,Record<string,unknown>>();
    const arrivals=new Map<string,Record<string,unknown>>();
    await page.exposeFunction('fixtureSend',async(workspace:string,action?:string,input?:Record<string,unknown>)=>{
      if(action && input){
        calls.push({workspace,action,input:structuredClone(input)});
        if(action==='transfer' && input.action==='receive') {
          const transfer=rows.get(workspace+'transfer_'+input.id);assert.ok(transfer);
          const arrivalKey=String(input.arrivalId);
          if(!arrivals.has(arrivalKey)) {
            const received=[...arrivals.values()].filter(a=>a.transfer_id===input.id).reduce((sum,a)=>sum+Number(a.qty),0);
            assert.ok(Number(input.receivedQty)>0 && Number(input.receivedQty)<=Number(transfer.qty)-received);
            arrivals.set(arrivalKey,{id:input.arrivalId,transfer_id:input.id,qty:input.receivedQty,received_date:input.receivedDate,confirmation_ref:input.confirmationRef,created_by:'user-1',created_at:'2026-10-10T00:00:00Z'});
            throw new Error('도착 처리 후 응답 유실');
          }
          const existing=arrivals.get(arrivalKey)!;assert.equal(existing.qty,input.receivedQty);assert.equal(existing.confirmation_ref,input.confirmationRef);assert.equal(existing.received_date,input.receivedDate);
        } else {
          const id=(action==='transfer'?'transfer_':'')+input.id;
          if(!rows.has(workspace+id)){rows.set(workspace+id,{...input,workspace,id});throw new Error('응답 유실');}
        }
      }
      const moves=[...rows.values()].filter(row=>row.workspace===workspace);
      const outboundQty=moves.reduce((total,row)=>total+Number(row.qty),0);
      return {workspace,balances:[{workspace,styleNo:'SKU1',styleName:'품목',color:'BLACK',onHand:10-outboundQty,inboundQty:10,outboundQty}],moves,
        transfers:moves.filter(row=>String(row.id).startsWith('transfer_')).map(row=>{
          const id=String(row.id).slice(9),history=[...arrivals.values()].filter(a=>a.transfer_id===id);
          const received_qty=history.reduce((sum,a)=>sum+Number(a.qty),0);
          return {id,workspace,style_no:row.styleNo,color:row.color,qty:row.qty,sent_date:row.moveDate,received_qty,arrivals:history,status:received_qty===Number(row.qty)?'received':'in_transit'};
        })};
    });
    await page.goto(origin+'/');
    const clickText=async(text:string)=>{await page.evaluate(text=>{
      const button=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);
      if(!button)throw new Error('button missing: '+text);button.click();
    },text);};
    await page.waitForFunction(()=>document.body.textContent?.includes('서버 조회 완료'));
    await clickText('출고');
    await page.waitForSelector('[role="dialog"]').catch(async error=>{throw new Error(`${error}\n${errors.join('\n')}\n${await page.$eval('body',el=>el.textContent)}`);});
    await page.$eval('[role="dialog"] input[type="number"]',el=>{(el as HTMLInputElement).value='';});
    await page.type('[role="dialog"] input[type="number"]','4');
    if(transferMode) await page.click('[role="dialog"] input[type="checkbox"]');
    await clickText(transferMode?'한국 이동 확정':'출고 확정');
    await page.waitForFunction(()=>document.querySelector('[role="dialog"] input[type="checkbox"]')?.hasAttribute('disabled'));
    assert.equal(await page.$eval('[role="dialog"] input[type="number"]',el=>el.matches(':disabled')),true);
    await page.waitForFunction(()=>[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].some(b=>b.textContent?.trim()==='닫기 (취소 아님)' && !b.disabled));
    await clickText('닫기 (취소 아님)');
    await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
    await clickText('출고 등록');
    assert.equal(await page.$('[role="dialog"]'),null);
    const pending=await page.evaluate(key=>sessionStorage.getItem(key),chinaStockSessionKey('LUMEN','user-1'));
    assert.ok(pending);assert.equal(calls.length,1);
    await clickText('다른 페이지');await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
    await clickText('창고 페이지');await page.waitForSelector('[role="alert"]');
    await clickText('브랜드 AETALOOF');await page.waitForFunction(()=>document.body.textContent?.includes('AETALOOF —') && !document.querySelector('[role="alert"]'));
    await clickText('브랜드 LUMEN');await page.waitForSelector('[role="alert"]');
    await page.reload();await page.waitForSelector('[role="alert"]');
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),chinaStockSessionKey('LUMEN','user-1')),pending);
    assert.ok((await page.$eval('[role="alert"]',el=>el.textContent))?.includes(JSON.parse(pending).input.id));
    await clickText('출고 등록');assert.equal(await page.$('[role="dialog"]'),null);assert.equal(calls.length,1);
    await clickText('서버 새로 조회');
    await page.waitForFunction(()=>document.body.textContent?.includes('서버 조회 완료'));
    await clickText('원래 요청 그대로 재시도');
    await page.waitForFunction(()=>document.querySelectorAll('[role="alert"]').length===0);
    assert.equal(calls.length,2); assert.deepEqual(calls[1],calls[0]);
    assert.equal((calls[0] as {action:string}).action,transferMode?'transfer':'move');
    assert.equal(await page.$eval('tbody tr td:nth-child(6)',el=>el.textContent?.trim()),'6');
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('span')].some(el=>el.textContent?.includes('4개') && el.textContent.includes('운송중'))),transferMode);
    assert.deepEqual(errors,[]);
    assert.deepEqual(external,[]);
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),chinaStockSessionKey('LUMEN','user-1')),null);
    if(transferMode) {
      await clickText('한국 도착 기록');await page.waitForSelector('#cn-arrival-qty');
      assert.equal(await page.$eval('#cn-arrival-qty',el=>(el as HTMLInputElement).value),'4');
      await page.focus('#cn-arrival-qty');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type('#cn-arrival-qty','5');
      await page.type('#cn-arrival-ref','3PL-proof-partial');
      await clickText('도착 수량 저장');assert.equal(calls.length,2,'Over-remaining quantity must not send');
      await page.focus('#cn-arrival-qty');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type('#cn-arrival-qty','3');
      assert.equal(await page.$eval('#cn-arrival-qty',el=>(el as HTMLInputElement).value),'3');
      await clickText('도착 수량 저장');
      await page.waitForFunction(()=>document.querySelector('#cn-arrival-qty')?.hasAttribute('disabled'));
      await page.waitForFunction(()=>[...document.querySelectorAll<HTMLButtonElement>('button')].some(b=>b.textContent?.trim()==='원래 요청 그대로 재시도' && !b.disabled));
      const frozenReceive=calls[2];assert.equal(frozenReceive.input.receivedQty,3);
      assert.match(String(frozenReceive.input.arrivalId),/^[0-9a-f-]{36}$/);
      const receivePending=await page.evaluate(key=>sessionStorage.getItem(key),chinaStockSessionKey('LUMEN','user-1'));
      await page.reload();await page.waitForSelector('[role="alert"]');
      assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),chinaStockSessionKey('LUMEN','user-1')),receivePending);
      await page.waitForFunction(()=>document.body.textContent?.includes('누적 도착 3개 · 남은 운송중 1개'));
      await clickText('원래 요청 그대로 재시도');await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
      assert.deepEqual(calls[3],frozenReceive);assert.equal(arrivals.size,1);
      assert.ok((await page.$eval('body',el=>el.textContent))?.includes('3PL-proof-partial'));
      assert.equal(await page.$eval('tbody tr td:nth-child(6)',el=>el.textContent?.trim()),'6','Receiving must not debit China stock again');
      await clickText('한국 도착 기록');await page.waitForSelector('#cn-arrival-qty');
      assert.equal(await page.$eval('#cn-arrival-qty',el=>(el as HTMLInputElement).value),'1');
      await page.type('#cn-arrival-ref','3PL-proof-final');await clickText('도착 수량 저장');
      await page.waitForFunction(()=>document.querySelector('#cn-arrival-qty')?.hasAttribute('disabled'));
      await page.waitForFunction(()=>[...document.querySelectorAll<HTMLButtonElement>('button')].some(b=>b.textContent?.trim()==='원래 요청 그대로 재시도' && !b.disabled));
      await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
      await clickText('원래 요청 그대로 재시도');await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
      assert.deepEqual(calls[5],calls[4]);assert.notEqual(calls[4].input.arrivalId,frozenReceive.input.arrivalId);
      assert.equal(arrivals.size,2);assert.ok((await page.$eval('body',el=>el.textContent))?.includes('누적 도착 4개 · 남은 운송중 0개'));
      assert.ok((await page.$eval('body',el=>el.textContent))?.includes('도착 완료'));
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent?.trim()==='한국 도착 기록')),false);
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    }
    const completedCalls=calls.length;
    // Real UI storage quota failure: persistence fails before the mocked server is called.
    await clickText('출고');await page.waitForSelector('[role="dialog"]');
    await page.evaluate("Storage.prototype.setItem=function(){throw new DOMException('fixture quota','QuotaExceededError');};");
    await clickText('출고 확정');
    await page.waitForFunction(()=>document.body.textContent?.includes('탭 세션 요청 저장 실패'));
    assert.equal(calls.length,completedCalls);
  } finally { await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});
