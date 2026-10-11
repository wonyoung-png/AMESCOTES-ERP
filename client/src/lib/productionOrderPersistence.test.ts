import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { filterForTable, toSnakeCase } from './tableColumns';
import { persistProductionOrderSent, persistProductionOrderFactoryConfirm, type UpdateProductionOrderMetadata } from './productionOrderPersistence';

const original = {id:'po-1',updatedAt:'version-1',sentAt:undefined,confirmedAt:undefined,deliveryDate:'2026-12-01'};
function database() {
  const row = {id:'po-1',updatedAt:'version-1',sentAt:null as string|null,confirmedAt:null as string|null,
    qty:100,status:'생산중',receivedQty:30,shippedQty:8,expenseId:'finance-new',tradeStatementId:'statement-new',factoryUnitPriceKrw:9000};
  const calls: any[] = [];
  const update: UpdateProductionOrderMetadata = async (id,patch,expected) => {
    calls.push({id,patch,expected});
    if(id!==row.id || expected.updatedAt!==row.updatedAt || expected.sentAt!==row.sentAt || expected.confirmedAt!==row.confirmedAt)throw Error('발주가 변경되었습니다');
    Object.assign(row,patch,{updatedAt:'version-2'});
    return {updatedAt:row.updatedAt};
  };
  return {row,calls,update};
}

test('delivery saves metadata only and keeps current receipts/finance despite stale payload fields',async()=>{
  const m=database(),before={...m.row};
  const stale={...original,qty:1,receivedQty:0,shippedQty:0,status:'발주생성',expenseId:'finance-old'};
  const saved=await persistProductionOrderSent(stale,m.update,'sent-time');
  assert.deepEqual(m.calls[0].patch,{sentAt:'sent-time'});
  assert.deepEqual(m.calls[0].expected,{updatedAt:'version-1',sentAt:null,confirmedAt:null});
  for(const field of ['qty','status','receivedQty','shippedQty','expenseId','tradeStatementId','factoryUnitPriceKrw'] as const)assert.equal(m.row[field],before[field]);
  assert.deepEqual(saved,{sentAt:'sent-time',updatedAt:'version-2',persistedUpdatedAt:'version-2'});
});

test('newer receipt/finance version rejects both stale operations without mutation or retry',async()=>{
  for(const confirm of [false,true]){
    const m=database();m.row.updatedAt='receipt-version';const before={...m.row};
    await assert.rejects(confirm?persistProductionOrderFactoryConfirm(original,{confirmedDate:'2026-12-02',confirmNote:'note'},m.update,'confirm-time'):persistProductionOrderSent(original,m.update,'sent-time'),/변경/);
    assert.deepEqual(m.row,before);assert.equal(m.calls.length,1);assert.equal(m.calls[0].expected.updatedAt,'version-1');
  }
});

test('sent/confirmed guards independently reject changed transmission evidence',async()=>{
  for(const field of ['sentAt','confirmedAt'] as const){
    const m=database();m.row[field]='someone-else';const before={...m.row};
    await assert.rejects(persistProductionOrderSent(original,m.update,'sent-time'),/변경/);assert.deepEqual(m.row,before);
    await assert.rejects(persistProductionOrderFactoryConfirm(original,{confirmedDate:'',confirmNote:''},m.update),/변경/);assert.deepEqual(m.row,before);
  }
});

test('factory reply patches only confirmation fields, keeps prior sent guard and clears empty note',async()=>{
  const m=database();m.row.sentAt='sent-earlier';const order={...original,sentAt:'sent-earlier'};
  const saved=await persistProductionOrderFactoryConfirm(order,{confirmedDate:'',confirmNote:''},m.update,'confirm-time');
  assert.deepEqual(m.calls[0].patch,{confirmedAt:'confirm-time',confirmedDate:'2026-12-01',confirmNote:null});
  assert.equal(m.calls[0].expected.sentAt,'sent-earlier');assert.equal(m.row.receivedQty,30);assert.equal(saved.updatedAt,'version-2');assert.equal(saved.confirmNote,undefined);
});

test('missing original version blocks before DB; missing success version cannot be optimistic success',async()=>{
  let calls=0;const update:UpdateProductionOrderMetadata=async()=>{calls++;return {updatedAt:''};};
  await assert.rejects(persistProductionOrderSent({...original,updatedAt:''},update),/저장 버전/);assert.equal(calls,0);
  await assert.rejects(persistProductionOrderFactoryConfirm({...original,updatedAt:''},{confirmedDate:'',confirmNote:''},update),/저장 버전/);assert.equal(calls,0);
  await assert.rejects(persistProductionOrderSent(original,update),/저장 결과/);assert.equal(calls,1);
});

// Execute the parent's REAL exported functions, with only their DB transport replaced.
const source=readFileSync(new URL('./dbQueries.ts',import.meta.url),'utf8');
const start=source.indexOf('export async function upsertOrder(');
const end=source.indexOf('export async function startProductionAfterPurchases(',start);
assert.ok(start>=0&&end>start);
const compiled=transformSync(source.slice(start,end),{loader:'ts',format:'cjs'}).code;
function actualDatabase(existing:Record<string,any>|null,zero=false){
  let row=existing?{...existing}:null;const calls:any[]=[];
  const db={from(table:string){
    assert.equal(table,'production_orders');let mode='read',patch:Record<string,any>={},conditions:[string,unknown][]=[];
    const query:any={
      update(value:Record<string,any>){mode='update';patch=value;calls.push(['update',value]);return query;},
      insert(value:Record<string,any>){mode='insert';patch=value;calls.push(['insert',value]);return query;},
      upsert(){throw Error('whole-row upsert forbidden');},
      eq(key:string,value:unknown){conditions.push([key,value]);calls.push(['eq',key,value]);return query;},
      is(key:string,value:unknown){conditions.push([key,value]);calls.push(['is',key,value]);return query;},
      select(columns:string){calls.push(['select',columns]);return query;},
      then(resolve:any,reject:any){
        let data:Record<string,any>[]=[];
        if(mode==='insert'){assert.equal(row,null);row={...patch};data=[row];}
        else if(row&&conditions.every(([key,value])=>(row![key]??null)===value)){
          if(mode==='read')data=[{...row}];
          else if(!zero){row={...row,...patch};data=[{...row}];}
        }
        return Promise.resolve({data,error:null}).then(resolve,reject);
      },
    };return query;
  }};
  const module={exports:{}};
  new Function('module','exports','db','filterForTable','toSnakeCase',compiled)(module,module.exports,db,filterForTable,toSnakeCase);
  return {functions:module.exports as {upsertOrder:(o:any)=>Promise<void>;updateProductionOrderMetadata:UpdateProductionOrderMetadata},calls,row:()=>row};
}
const dbRow=()=>({id:'po-1',updated_at:'version-1',created_at:'original-created',sent_at:null,confirmed_at:null,
  quantity:100,received_qty:30,shipped_qty:8,expense_id:'finance-new',status:'생산중'});

test('actual metadata PATCH uses snake whitelist + original CAS and preserves receipts/finance',async()=>{
  const m=actualDatabase(dbRow());const saved=await persistProductionOrderSent({...original,updatedAt:'edited-ui-time',persistedUpdatedAt:'version-1'},m.functions.updateProductionOrderMetadata,'sent-time');
  const patch=m.calls.find(c=>c[0]==='update')[1];assert.deepEqual(Object.keys(patch).sort(),['sent_at','updated_at']);
  assert.ok(m.calls.some(c=>c[0]==='eq'&&c[1]==='updated_at'&&c[2]==='version-1'));
  assert.ok(m.calls.some(c=>c[0]==='is'&&c[1]==='sent_at'));assert.ok(m.calls.some(c=>c[0]==='is'&&c[1]==='confirmed_at'));
  assert.equal(m.row()!.received_qty,30);assert.equal(m.row()!.expense_id,'finance-new');assert.equal(saved.persistedUpdatedAt,m.row()!.updated_at);
  await persistProductionOrderFactoryConfirm({...original,...saved,updatedAt:'different-ui-time'},{confirmedDate:'2026-12-02',confirmNote:'reply'},m.functions.updateProductionOrderMetadata,'reply-time');
  assert.equal(m.row()!.confirmed_date,'2026-12-02');assert.equal(m.row()!.confirm_note,'reply');
  assert.ok(m.calls.some(c=>c[0]==='eq'&&c[1]==='sent_at'&&c[2]==='sent-time'));
});

test('actual metadata zero-row and stale evidence rejects without applying any patch',async()=>{
  for(const change of ['version','sent','confirmed','zero']){
    const row=dbRow();if(change==='version')row.updated_at='receipt-new';if(change==='sent')(row as any).sent_at='other';if(change==='confirmed')(row as any).confirmed_at='other';
    const m=actualDatabase(row,change==='zero');await assert.rejects(persistProductionOrderSent(original,m.functions.updateProductionOrderMetadata),/변경/);assert.deepEqual(m.row(),row);
  }
  const m=actualDatabase(dbRow());await assert.rejects(m.functions.updateProductionOrderMetadata('po-1',{quantity:1} as any,{updatedAt:'version-1',sentAt:null,confirmedAt:null}),/항목/);assert.equal(m.calls.length,0);
});

test('actual generic save stale snapshot rejects despite new UI updatedAt and preserves receipts',async()=>{
  const row={...dbRow(),updated_at:'receipt-new'},m=actualDatabase(row);
  await assert.rejects(m.functions.upsertOrder({...original,persistedUpdatedAt:'version-1',updatedAt:'fresh-ui-time',qty:1,receivedQty:0,expenseId:'finance-old'}),/변경/);
  assert.deepEqual(m.row(),row);assert.ok(m.calls.some(c=>c[0]==='eq'&&c[1]==='updated_at'&&c[2]==='version-1'));assert.ok(!m.calls.some(c=>c[0]==='insert'));
});

test('actual generic existing without stamp refuses; genuine new order INSERTs, never upserts',async()=>{
  const existing=actualDatabase(dbRow());await assert.rejects(existing.functions.upsertOrder({...original,qty:1}),/원본 버전/);assert.ok(!existing.calls.some(c=>c[0]==='update'||c[0]==='insert'));
  const fresh=actualDatabase(null),order={...original,qty:100,createdAt:'new-created',persistedUpdatedAt:undefined as string|undefined};await fresh.functions.upsertOrder(order);
  assert.equal(fresh.calls.filter(c=>c[0]==='insert').length,1);assert.equal(fresh.calls.filter(c=>c[0]==='update').length,0);assert.equal(order.persistedUpdatedAt,fresh.row()!.updated_at);
});

test('actual generic correct stamp UPDATE preserves created_at and advances persisted stamp; zero rows rejects',async()=>{
  const m=actualDatabase(dbRow()),order={...original,persistedUpdatedAt:'version-1',qty:110,createdAt:'must-not-overwrite'};await m.functions.upsertOrder(order);
  assert.equal(m.row()!.created_at,'original-created');assert.equal(m.row()!.quantity,110);assert.equal(order.persistedUpdatedAt,m.row()!.updated_at);
  assert.ok(!('created_at' in m.calls.find(c=>c[0]==='update')[1]));assert.ok(!m.calls.some(c=>c[0]==='insert'));
  const zero=actualDatabase(dbRow(),true);await assert.rejects(zero.functions.upsertOrder({...original,persistedUpdatedAt:'version-1',qty:110}),/변경/);assert.equal(zero.row()!.quantity,100);
});
