import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('./ProductionOrders.tsx',import.meta.url),'utf8');
const helper=transformSync(readFileSync(new URL('../lib/productionOrderPersistence.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'}).code;
const {persistProductionOrderSent,persistProductionOrderFactoryConfirm}=await import(`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`);
const original={id:'order',updatedAt:'original-version'};
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
function makeTransmission(update, ready = true){
  let modal={...original},batch={orders:[{...original}]},failed=0;
  const snippet=source.slice(source.indexOf('  const markSent = async'),source.indexOf('  /** 공장 회신 기록'));
  const code=transformSync(snippet,{loader:'ts'}).code;
  const mark=new Function('transmissionPending','transmissionRecorded','persistProductionOrderSent','updateProductionOrderMetadata','setPoTarget','setBatchSheet','refresh','onSaveFail','pickWorkOrderBom','workOrderColors','boms','toast',code+';return markSent;')(
    {current:new Set()},{current:new Set()},persistProductionOrderSent,async(...args)=>(await update(...args))||{updatedAt:'saved-version'},f=>modal=f(modal),f=>batch=f(batch),()=>{},()=>()=>failed++,()=>({bom:{},ambiguous:false}),()=>({ready,missingColors:ready?[]:['BLACK']}),[],{error:()=>failed++});
  return {mark,state:()=>({modal,batch,failed})};
}
test('repeated delivery confirmation writes once and updates both modal snapshots',async()=>{
  let release,writes=0;const t=makeTransmission(async()=>{writes++;await new Promise(r=>release=r);});
  const first=t.mark(original);assert.equal(await t.mark(original),false);release();assert.equal(await first,true);
  assert.equal(await t.mark(original),true);assert.equal(writes,1);assert.ok(t.state().modal.sentAt);assert.equal(t.state().batch.orders[0].sentAt,t.state().modal.sentAt);assert.equal(t.state().modal.updatedAt,'saved-version');
});
test('failed transmission stays unrecorded and can be retried',async()=>{
  let fail=true;const t=makeTransmission(async()=>{if(fail)throw Error('test save');});
  assert.equal(await t.mark(original),false);assert.equal(t.state().modal.sentAt,undefined);assert.equal(t.state().failed,1);
  fail=false;assert.equal(await t.mark(original),true);assert.ok(t.state().modal.sentAt);
});
test('missing color BOM blocks delivery even with a saved manual document', async()=>{
  let writes=0; const t=makeTransmission(async()=>writes++,false);
  assert.equal(await t.mark({...original,workOrderHtml:'수기 작업지시서'}),false);
  assert.equal(writes,0); assert.equal(t.state().modal.sentAt,undefined);
});

test('stale transmission uses original version + delivery guards and never records success',async()=>{
  let writes=0;const t=makeTransmission(async(id,patch,expected)=>{
    writes++;assert.equal(id,'order');assert.deepEqual(Object.keys(patch),['sentAt']);
    assert.deepEqual(expected,{updatedAt:'original-version',sentAt:null,confirmedAt:null});throw Error('발주가 변경되었습니다');
  });
  assert.equal(await t.mark(original),false);assert.equal(await t.mark(original),false);
  assert.equal(writes,2);assert.equal(t.state().modal.sentAt,undefined);assert.equal(t.state().modal.updatedAt,'original-version');
});

function makeFactoryConfirm(update){
  let target={...original,deliveryDate:'2026-12-01'},modal={...target},batch={orders:[{...target}]},success=0,errors=0;
  const snippet=source.slice(source.indexOf('  const saveFactoryConfirm = async'),source.indexOf('  /** 묶음번호:'));
  const code=transformSync(snippet,{loader:'ts'}).code;
  const save=new Function('confirmTarget','confirmForm','factoryConfirmPending','persistProductionOrderFactoryConfirm','updateProductionOrderMetadata','setPoTarget','setBatchSheet','setConfirmTarget','refresh','toast',code+';return saveFactoryConfirm;')(
    target,{confirmedDate:'2026-12-02',confirmNote:'회신'}, {current:new Set()},persistProductionOrderFactoryConfirm,update,
    f=>modal=f(modal),f=>batch=f(batch),f=>target=f(target),()=>{}, {success:()=>success++,error:()=>errors++});
  return {save,state:()=>({target,modal,batch,success,errors})};
}

test('stale factory confirmation keeps dialog and snapshots unmodified',async()=>{
  const t=makeFactoryConfirm(async(id,patch,expected)=>{
    assert.deepEqual(Object.keys(patch).sort(),['confirmNote','confirmedAt','confirmedDate']);
    assert.equal(expected.updatedAt,'original-version');assert.equal(expected.sentAt,null);assert.equal(expected.confirmedAt,null);throw Error('conflict');
  });
  await t.save();assert.equal(t.state().success,0);assert.equal(t.state().errors,1);assert.ok(t.state().target);assert.equal(t.state().modal.confirmedAt,undefined);
});

test('factory confirmation duplicate clicks save once and update modal versions only after success',async()=>{
  let writes=0,release;const t=makeFactoryConfirm(async()=>{writes++;await new Promise(r=>release=r);return {updatedAt:'confirmed-version'};});
  const first=t.save();await t.save();assert.equal(writes,1);assert.equal(t.state().success,0);release();await first;
  assert.equal(t.state().success,1);assert.equal(t.state().target,null);assert.equal(t.state().modal.updatedAt,'confirmed-version');assert.equal(t.state().batch.orders[0].confirmNote,'회신');
});
