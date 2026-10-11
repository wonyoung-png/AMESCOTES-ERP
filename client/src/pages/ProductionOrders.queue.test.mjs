import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

const source=readFileSync(new URL('./ProductionOrders.tsx',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('  const patchWorkOrder = '),source.indexOf('  /**',source.indexOf('  const patchWorkOrder = ')+10));
const code=transformSync(snippet,{loader:'ts'}).code;
const dbSource=readFileSync(new URL('../lib/dbQueries.ts',import.meta.url),'utf8');
const upsertCode=transformSync(dbSource.slice(dbSource.indexOf('export async function upsertOrder('),dbSource.indexOf('export async function updateProductionOrderMetadata(')),{loader:'ts',format:'cjs'}).code;

function setup({failFirst=false,externalAfterFirst=false}={}){
  let row={id:'order',updated_at:'v0',created_at:'original-created',quantity:10,received_qty:3},writes=0,refreshes=0;
  const updates=[],errors=[];
  const db={from(){let patch,conditions=[];const query={
    update(value){patch=value;updates.push({...value});return query;},
    eq(key,value){conditions.push([key,value]);return query;},select(){return query;},
    insert(){throw Error('unexpected insert');},upsert(){throw Error('unexpected upsert');},
    then(resolve,reject){return Promise.resolve().then(()=>{
      if(failFirst&&writes===0)throw Error('predecessor failed');
      if(!conditions.every(([key,value])=>row[key]===value))return {data:[],error:null};
      writes++;row={...row,...patch,updated_at:`v${writes}`};const receipt={id:row.id,updated_at:row.updated_at};
      if(externalAfterFirst&&writes===1)row={...row,updated_at:'other-user',received_qty:9};
      return {data:[receipt],error:null};
    }).then(resolve,reject);},
  };return query;}};
  const module={exports:{}};new Function('module','exports','db','filterForTable',upsertCode)(module,module.exports,db,(_,row)=>row);
  let modal={id:'order',persistedUpdatedAt:'v0',updatedAt:'ui-original',qty:10,receivedQty:3,createdAt:'original-created'};
  const woLive={current:modal},woSave={current:Promise.resolve()},woAcknowledged={current:new WeakMap()};
  const patch=new Function('woLive','woSave','woAcknowledged','setWorkOrderTarget','upsertOrder','refresh','toast',code+';return patchWorkOrder;')(
    woLive,woSave,woAcknowledged,f=>{modal=typeof f==='function'?f(modal):f;woLive.current=modal;},module.exports.upsertOrder,()=>refreshes++,{error:e=>errors.push(e)});
  return {patch,wait:()=>woSave.current,state:()=>({row,modal,writes,updates,errors,refreshes}),reopen:order=>{modal=order;woLive.current=order;}};
}

test('actual queued edits CAS against predecessor receipt and persist both rapid inputs',async()=>{
  const m=setup();m.patch(()=>({cautionNote:'first'}));m.patch(()=>({changeNote:'second'}));await m.wait();
  assert.equal(m.state().writes,2);assert.equal(m.state().row.caution_note,'first');assert.equal(m.state().row.change_note,'second');
  assert.equal(m.state().modal.persistedUpdatedAt,'v2');assert.equal(m.state().errors.length,0);
  m.patch(()=>({cautionNote:'third'}));await m.wait();assert.equal(m.state().writes,3);assert.equal(m.state().row.change_note,'second');assert.equal(m.state().row.caution_note,'third');
});

test('failed predecessor cannot be bypassed by already queued or subsequent UI edits',async()=>{
  const m=setup({failFirst:true});m.patch(()=>({cautionNote:'first'}));m.patch(()=>({changeNote:'second'}));await m.wait();
  assert.equal(m.state().updates.length,1);assert.equal(m.state().writes,0);assert.equal(m.state().refreshes,0);
  m.patch(()=>({changeNote:'third'}));await m.wait();assert.equal(m.state().updates.length,1);assert.equal(m.state().row.updated_at,'v0');assert.equal(m.state().errors.length,3);
});

test('another user receipt after first acknowledgment makes second queued edit fail CAS',async()=>{
  const m=setup({externalAfterFirst:true});m.patch(()=>({cautionNote:'first'}));m.patch(()=>({changeNote:'second'}));await m.wait();
  assert.equal(m.state().writes,1);assert.equal(m.state().row.updated_at,'other-user');assert.equal(m.state().row.received_qty,9);assert.equal(m.state().row.change_note,null);assert.equal(m.state().errors.length,1);
  m.patch(()=>({changeNote:'third'}));await m.wait();assert.equal(m.state().updates.length,2);assert.equal(m.state().row.received_qty,9);
});

test('reopened stale snapshot cannot borrow a different draft acknowledgment',async()=>{
  const m=setup();m.patch(()=>({cautionNote:'first'}));await m.wait();
  m.reopen({id:'order',persistedUpdatedAt:'v0',updatedAt:'stale-ui',qty:10,receivedQty:0});m.patch(()=>({changeNote:'stale-reopened'}));await m.wait();
  assert.equal(m.state().writes,1);assert.equal(m.state().row.caution_note,'first');assert.equal(m.state().row.change_note,null);assert.equal(m.state().errors.length,1);
});
