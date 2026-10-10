// Run only in the disposable schema-only stack; never on production data.
import assert from 'node:assert/strict';
import express from 'express';
import sessionRouter from '../server/session';
import inventoryRouter from '../server/inventory';
import { restAsServer } from '../server/auth';

const REST='http://erp-e2e-api-20261010:3000';
assert.equal(process.env.ERP_E2E_ISOLATED,'20261010');
assert.equal(process.env.POSTGREST_URL,REST);
assert.equal(process.env.ERP_PRIVATE_MODE,'false');
assert.ok(process.env.PGRST_JWT_SECRET && process.env.PGRST_JWT_SECRET.length>=32);
const originalFetch=globalThis.fetch;
globalThis.fetch=(async(input: RequestInfo | URL, init?: RequestInit)=>{
  const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  assert.ok(u.origin===REST || u.hostname==='127.0.0.1','External network forbidden');
  return originalFetch(input,{...init,redirect:'error'});
}) as typeof fetch;
const password='E2E-only-20261010!';
function hash(value:string) { let h=0; for(let i=0;i<value.length;i++) h=((h<<5)-h+value.charCodeAt(i))|0; return Math.abs(h).toString(36); }
async function main() {
  const users=await restAsServer('app_users?select=id'); assert.ok(users.ok); assert.equal((await users.json()).length,0);
  const seed=await restAsServer('app_users',{method:'POST',body:JSON.stringify({id:'china_e2e_boss',email:'wonyoung@atlm.kr',name:'격리 테스트 대표',role:'대표',team:'대표실',position:'대표',password_hash:hash(password),is_active:true})}); assert.ok(seed.ok,await seed.text());
  const app=express(); app.use(express.json()); app.use(sessionRouter,inventoryRouter);
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let calls=0;
  try {
    assert.equal((await fetch(base+'/api/inventory/china?workspace=LUMEN')).status,401);
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'wonyoung@atlm.kr',password})}); assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie')!.split(';')[0];
    async function post(action:string,input:object,status=200) {
      calls++;
      const r=await fetch(base+'/api/inventory/china/'+action,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(input)});
      const data=await r.json(); assert.equal(r.status,status,JSON.stringify(data)); return data;
    }
    const ws={workspace:'LUMEN'};
    await post('move',{...ws,id:'http_china_stock',styleNo:'HTTP-CHINA',color:'BLACK',qty:100,moveType:'adjust',moveDate:'2026-10-09',memo:'isolated fixture'});
    await post('transfer',{...ws,id:'http_transfer',styleNo:'HTTP-CHINA',color:'BLACK',qty:100,action:'send',moveDate:'2026-10-09'});
    const receive={...ws,id:'http_transfer',action:'receive',receivedQty:40,arrivalId:'http_first',receivedDate:'2026-10-10',confirmationRef:'FIXTURE-3PL-1'};
    await Promise.all(Array.from({length:25},()=>post('transfer',receive)));
    const read=async()=>{ const r=await restAsServer('china_stock_transfers?id=eq.http_transfer&select=*');assert.ok(r.ok);return (await r.json())[0]; };
    assert.equal((await read()).received_qty,40);
    await post('transfer',{...receive,receivedQty:41},409);
    await post('transfer',{...receive,workspace:'AETALOOF'},409);
    await post('transfer',{...receive,arrivalId:'http_bad',receivedQty:1.5},400);
    await post('transfer',{...receive,arrivalId:null},400);
    await post('transfer',{...ws,id:receive.id,action:'receive',receivedDate:receive.receivedDate,confirmationRef:receive.confirmationRef},409);
    const results=await Promise.all(Array.from({length:25},async(_,i)=>{
      calls++;
      const r=await fetch(base+'/api/inventory/china/transfer',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({...receive,arrivalId:'http_final_'+i,receivedQty:60,confirmationRef:'FIXTURE-3PL-FINAL'})});
      const data=await r.json(); assert.ok([200,409].includes(r.status),JSON.stringify(data));return {status:r.status,index:i};
    }));
    assert.equal(results.filter(r=>r.status===200).length,1); assert.equal(results.filter(r=>r.status===409).length,24);
    const final=await read(); assert.equal(final.received_qty,100);assert.equal(final.status,'received');
    const winner=results.find(r=>r.status===200)!;
    await Promise.all(Array.from({length:25},()=>post('transfer',{...receive,arrivalId:'http_final_'+winner.index,receivedQty:60,confirmationRef:'FIXTURE-3PL-FINAL'})));
    // A late retry of the FIRST arrival still returns success, not an extra receipt.
    const snapshot=await post('transfer',receive);
    const transfer=snapshot.transfers.find((t:any)=>t.id===receive.id);
    assert.equal(transfer.arrivals.length,2); assert.equal(transfer.received_qty,100);
    assert.equal(snapshot.balances.find((b:any)=>b.style_no==='HTTP-CHINA').on_hand,0);
    const moves=await restAsServer('china_stock_moves?style_no=eq.HTTP-CHINA&select=id');assert.ok(moves.ok);assert.equal((await moves.json()).length,2);
    // Reusing an event key for a DIFFERENT transfer must not write either row.
    await post('move',{...ws,id:'http_other_stock',styleNo:'HTTP-OTHER',color:'BLACK',qty:10,moveType:'adjust',moveDate:'2026-10-09',memo:'isolated fixture'});
    await post('transfer',{...ws,id:'http_other_transfer',styleNo:'HTTP-OTHER',color:'BLACK',qty:10,action:'send',moveDate:'2026-10-09'});
    await post('transfer',{...receive,id:'http_other_transfer',receivedQty:4},409);
    const arrivals=await restAsServer('china_stock_arrivals?transfer_id=eq.http_other_transfer&select=id'); assert.ok(arrivals.ok);assert.equal((await arrivals.json()).length,0);
    console.log(JSON.stringify({chinaHttpDatabase:'PASS',calls,identicalPartialRetries:25,competingFinalArrivals:{accepted:1,rejected:24},identicalFinalRetries:25,arrivalHistory:2,physicalStockWritesOnArrival:0,realCompanyRowsUsed:0}));
  } finally {server.close();globalThis.fetch=originalFetch;}
}
main().catch(e=>{console.error(String(e).split('\n')[0]);process.exitCode=1;});
