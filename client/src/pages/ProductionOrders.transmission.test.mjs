import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('./ProductionOrders.tsx',import.meta.url),'utf8');
test('printing individual or batch orders never records factory delivery',()=>{
  const printButtons=[...source.matchAll(/<Button onClick=\{\(\) => \{ printDoc\((poSheetRef|batchSheetRef)\.current\); \}\}>/g)];
  assert.equal(printButtons.length,2);
  assert.doesNotMatch(source,/void markSent\(poTarget\); printDoc/);
  assert.doesNotMatch(source,/sheet\.orders\.forEach\(o => void markSent\(o\)\)/);
});
test('delivery recording requires explicit confirmation, batch saves are sequential',()=>{
  assert.match(source,/confirm\('이 발주서와 작업지시서를 공장에 실제로 전달하셨습니까\?'\)/);
  assert.match(source,/for \(const order of sheet\.orders\) if \(!\(await markSent\(order\)\)\) break/);
});
function makeTransmission(upsert, ready = true){
  let modal={id:'order'},batch={orders:[{id:'order'}]},failed=0;
  const snippet=source.slice(source.indexOf('  const markSent = async'),source.indexOf('  /** 공장 회신 기록'));
  const code=transformSync(snippet,{loader:'ts'}).code;
  const mark=new Function('transmissionPending','transmissionRecorded','upsertOrder','setPoTarget','setBatchSheet','refresh','onSaveFail','pickWorkOrderBom','workOrderColors','boms','toast',code+';return markSent;')(
    {current:new Set()},{current:new Set()},upsert,f=>modal=f(modal),f=>batch=f(batch),()=>{},()=>()=>failed++,()=>({bom:{},ambiguous:false}),()=>({ready,missingColors:ready?[]:['BLACK']}),[],{error:()=>failed++});
  return {mark,state:()=>({modal,batch,failed})};
}
test('repeated delivery confirmation writes once and updates both modal snapshots',async()=>{
  let release,writes=0;const t=makeTransmission(async()=>{writes++;await new Promise(r=>release=r);});
  const first=t.mark({id:'order'});assert.equal(await t.mark({id:'order'}),false);release();assert.equal(await first,true);
  assert.equal(await t.mark({id:'order'}),true);assert.equal(writes,1);assert.ok(t.state().modal.sentAt);assert.equal(t.state().batch.orders[0].sentAt,t.state().modal.sentAt);
});
test('failed transmission stays unrecorded and can be retried',async()=>{
  let fail=true;const t=makeTransmission(async()=>{if(fail)throw Error('test save');});
  assert.equal(await t.mark({id:'order'}),false);assert.equal(t.state().modal.sentAt,undefined);assert.equal(t.state().failed,1);
  fail=false;assert.equal(await t.mark({id:'order'}),true);assert.ok(t.state().modal.sentAt);
});
test('missing color BOM blocks delivery even with a saved manual document', async()=>{
  let writes=0; const t=makeTransmission(async()=>writes++,false);
  assert.equal(await t.mark({id:'order',workOrderHtml:'수기 작업지시서'}),false);
  assert.equal(writes,0); assert.equal(t.state().modal.sentAt,undefined);
});
