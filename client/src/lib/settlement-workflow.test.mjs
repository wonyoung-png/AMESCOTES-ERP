import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v) };
globalThis.settlementTest = { rows: {}, writes: [] };
const plugin = { name: 'settlement-db', setup(b) {
  b.onResolve({ filter: /^\.\/db$/ }, a => ({ path: a.path, namespace: 'test-db' }));
  b.onLoad({ filter: /.*/, namespace: 'test-db' }, () => ({ loader: 'js', contents: `
    const t=globalThis.settlementTest;
    export const db={from(table){let start=0,end=Infinity;const q={
      select(){return q},order(){return q},range(a,b){start=a;end=b;return q},eq(){return q},limit(){return q},
      then(done){return Promise.resolve({data:(t.rows[table]||[]).slice(start,end+1),error:null}).then(done)},
      upsert(row){t.writes.push({table,row});return Promise.resolve({error:null})}
    };return q}};` }));
}};
async function bundled(file) {
  const out = await build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[plugin]});
  return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
const { store } = await bundled('client/src/lib/store.ts');
const { settlementRow, fetchSettlements, saveSettlement } = await bundled('client/src/lib/settlementQueries.ts');
const original = {id:'test_collect',buyerId:'test_buyer',buyerName:'test',channel:'B2B직납',invoiceNo:'TEST-001',
  invoiceDate:'2026-10-10',dueDate:'2026-11-10',billedAmountKrw:1100,collectedAmountKrw:300,collectedDate:'2026-10-10',status:'정상',createdAt:'old'};
const untouched = {...original,id:'untouched',invoiceNo:'OTHER'};
store.hydrateSettlements([original,untouched]);
store.hydrateTradeStatements([{id:'linked',statementNo:'TEST-001',status:'청구완료'}]);
let requests=[],fail=true;
globalThis.fetch=async(url,init)=>{
  assert.equal(url,'/api/settlements/save');assert.equal(init.method,'POST');
  const input=JSON.parse(init.body); requests.push(input);
  return fail ? {ok:false,json:async()=>({message:'stale_settlement'})} : {ok:true,json:async()=>({result:{
    settlement:{...settlementRow(input.settlement),status:'완납'},
    statement:{id:'linked',statement_no:'TEST-001',status:'수금완료',collected_date:'2026-10-10',updated_at:'new-version'}
  }})};
};
await assert.rejects(store.updateSettlement(original.id,{collectedAmountKrw:1100},original),/stale_settlement/);
assert.equal(store.getSettlements()[0].collectedAmountKrw,300,'failed save changed cache');
assert.equal(store.getTradeStatements()[0].status,'청구완료');
fail=false;
await store.updateSettlement(original.id,{collectedAmountKrw:1100},original);
assert.equal(store.getSettlements().find(s=>s.id===original.id).status,'완납');
assert.deepEqual(store.getSettlements().find(s=>s.id===untouched.id),untouched);
assert.equal(store.getTradeStatements()[0].status,'수금완료');
assert.equal(requests[1].expected.collected_amount_krw,300);
assert.equal(requests.length,2,'save used multiple requests');
for(const response of [{ok:true,json:async()=>({result:{settlement:{id:'wrong'}}})},
  {ok:true,json:async()=>{throw Error('not JSON')}}]) {
  await assert.rejects(saveSettlement(original,original,async()=>response),/결과/);
}
globalThis.settlementTest.rows.settlements=Array.from({length:1001},(_,i)=>({...settlementRow(original),id:'page_'+i}));
assert.equal((await fetchSettlements()).length,1001,'list truncated at PostgREST page size');

const { syncFromDb } = await bundled('client/src/lib/syncFromDb.ts');
globalThis.settlementTest.rows.settlements=[settlementRow(original)];
globalThis.settlementTest.rows.trade_statements=[{id:'linked',statement_no:'TEST-001',status:'청구완료'}];
store.hydrateSettlements([original,untouched]);
store.hydrateTradeStatements([{id:'local_only',statementNo:'LOCAL'}]);
await syncFromDb();
assert.equal(store.getSettlements().length,1,'local-only financial record remained in ledger');
assert.equal(JSON.parse(memory.get('ames_settlements_unsynced'))[0].id,'untouched');
assert.equal(JSON.parse(memory.get('ames_trade_statements_unsynced'))[0].id,'local_only');
assert.equal(globalThis.settlementTest.writes.filter(w=>['trade_statements','settlements'].includes(w.table)).length,0,'startup uploaded financial cache');
const page=readFileSync('client/src/pages/SettlementManagement.tsx','utf8');
assert.match(page,/if \(lock.current \|\| !loaded\) return;/);
assert.match(page,/id: form.id!/);
assert.match(page,/function calcElapsedDays/);
assert.match(page,/Math.max\(0, calcElapsedDays\(s.dueDate\)\)/);
console.log('settlement regression PASS: atomic cache, failure, expected snapshot, pagination, startup archive/no upload, UI guards');
