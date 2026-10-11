import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Isolated WASM PostgreSQL, synthetic fixtures only; no dotenv/network/operating DB.
if (!process.env.DEFECT_TEST_PGLITE) throw Error('Set DEFECT_TEST_PGLITE to isolated @electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(process.env.DEFECT_TEST_PGLITE).href);
const pg = new PGlite();
const sql = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const table = (source, name) => {
  const match = source.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\);`, 'i'));
  assert.ok(match, `Known schema table ${name}`); return match[0];
};
const schema = await sql('schema.sql');
const phase = await sql('migration_phase1_manufacturing.sql');
await pg.exec(`create role anon; create role authenticated; create role erp_server;
  ${table(schema, 'vendors')} ${table(schema, 'production_orders')}
  ${['receipt_logs', 'defect_carryovers', 'payables', 'brand_order_batches'].map(name => table(phase, name)).join('\n')}
  create table app_users(id text primary key,role text,is_active boolean,email text,team text,position text);
  create table expenses(id text primary key,amount_krw numeric,vendor_id text,vendor_name text,
    expense_type text,description text,order_no text,lines jsonb,memo text);
  create table capture_inbox(id text primary key,status text,result_ref jsonb,reviewed_payload jsonb,
    reviewed_by text,reviewed_at timestamptz);
  -- Columns required by existing receipt_atomic and payable_generation RPCs.
  alter table production_orders add column order_no text, add column vendor_name text, add column project_no text;
  alter table production_orders add column factory_unit_price_krw numeric, add column received_qty integer,
    add column defect_qty integer, add column received_date date, add column color_qtys jsonb,
    add column workspace text, add column brand_batch_id text, add column style_name text;
  alter table defect_carryovers add column qty integer, add column disposition text;
  grant select,insert,update,delete on all tables in schema public to anon,authenticated,erp_server;
  insert into app_users(id,role,is_active,email) values ('boss','대표',true,'wonyoung@atlm.kr'),('staff','사원',true,'staff@example.invalid'),('inactive','대표',false,'wonyoung@atlm.kr'),('otherboss','대표',true,'other@example.invalid');
  insert into vendors(id,name) values ('factory','Fixture Factory'),('other','Fixture Other');
`);
await pg.exec(await sql('migrations/20260807_phase1_missing_cols.sql'));
const migration = await sql('migration_defect_approval.sql');
await pg.exec(await sql('migration_payable_payment_atomic.sql')); // base FIRST; never overwrite the latest cancel guard
await pg.exec(migration);
await pg.exec(migration); // rerunnable additive migration
await pg.exec(await sql('migration_expense_payable.sql'));
await pg.exec(await sql('migration_receipt_atomic.sql'));
await pg.exec(await sql('migration_payable_generation.sql'));
const row = async (table, id) => (await pg.query(`select to_jsonb(t) as value from ${table} t where id=$1`, [id])).rows[0]?.value;
async function fixture(id, disposition = 'deduct', paid = 0) {
  await pg.query(`insert into production_orders(id,order_no,vendor_id,vendor_name,project_no,status) values($1,$1,'factory','Fixture Factory',$1,'입고완료')`, [id]);
  await pg.query(`insert into receipt_logs(id,order_id,order_no,project_no,qty,defect_qty,log_type) values($1,$1,$1,$1,10,2,'inbound')`, [id]);
  await pg.query(`insert into defect_carryovers(id,order_no,project_no,vendor_id,vendor_name,amount_krw,qty,disposition,reason,status)
    values('def_'||$1,$1,$1,'factory','Fixture Factory',200,2,$2,'Fixture candidate','pending')`, [id, disposition]);
  await pg.query(`insert into payables(id,order_id,project_no,vendor_id,source_type,source_id,payee_type,receipt_log_ids,amount_krw,paid_amount_krw,status)
    values('pay_'||$1,$1,$1,'factory','order_receipt',$1,'factory_direct',jsonb_build_array($1::text),1000,$2,$3)`, [id, paid, paid ? 'partial' : 'pending']);
  return { payableId: 'pay_' + id, amount: 150, factoryResponsible: true, reason: 'Fixture actual defect',
    expectedDefect: await row('defect_carryovers', 'def_' + id), expectedPayable: await row('payables', 'pay_' + id) };
}
const approve = async (id, input, actor = 'boss') => (await pg.query('select approve_defect_deduction($1,$2,$3) as result',
  ['def_' + id, actor, JSON.stringify(input)])).rows[0].result;
async function rejectUnchanged(id, input, pattern, actor) {
  const before = await row('payables', 'pay_' + id);
  await assert.rejects(approve(id, input, actor), pattern);
  assert.deepEqual(await row('payables', 'pay_' + id), before);
  assert.equal((await row('defect_carryovers', 'def_' + id)).status, 'pending');
}
test('existing receipt RPC generates a pending candidate without money consumption; explicit confirmation deducts', async () => {
  await pg.exec(`insert into production_orders(id,order_no,vendor_id,vendor_name,project_no,status,quantity,factory_unit_price_krw)
    values('receipt_order','FIXTURE-R','factory','Fixture Factory','FIXTURE-P','생산완료',10,100); set role erp_server;`);
  const receipt = { id: 'from_receipt', orderId: 'receipt_order', qty: 10, defectQty: 2,
    receivedDate: '2026-10-11', createPayable: true, disposition: 'deduct', destination: 'korea' };
  const saved = (await pg.query('select record_korea_receipt($1) as result',[JSON.stringify(receipt)])).rows[0].result;
  assert.equal(saved.defect.status,'pending'); assert.equal(saved.defect.amount_krw,200);
  assert.equal(saved.payable.amount_krw,1000); assert.equal(saved.payable.paid_amount_krw,0);
  const input = {payableId:saved.payable.id,amount:125,reason:'Fixture confirmed',factoryResponsible:true,
    expectedDefect:saved.defect,expectedPayable:saved.payable};
  const approved = await approve('from_receipt',input); assert.equal(approved.payable.amount_krw,875);
  const retryReceipt = (await pg.query('select record_korea_receipt($1) as result',[JSON.stringify(receipt)])).rows[0].result;
  assert.equal(retryReceipt.payable.amount_krw,875); assert.equal(retryReceipt.defect.status,'applied');
  await pg.exec('reset role');
});
test('actual PostgreSQL confirms once, preserves candidate estimate and payments, returns original on retry', async () => {
  const input = await fixture('one', 'deduct', 300);
  assert.equal((await row('payables','pay_one')).amount_krw, 1000); // no automatic consumption
  await rejectUnchanged('one', input, /forbidden/, 'staff');
  await rejectUnchanged('one', input, /forbidden/, 'inactive');
  await rejectUnchanged('one', input, /forbidden/, 'otherboss');
  await pg.exec('set role erp_server');
  const result = await approve('one', input);
  assert.equal(result.approvedAmount, 150); assert.equal(result.payable.amount_krw, 850);
  assert.equal(result.payable.paid_amount_krw, 300); assert.equal(result.payable.status, 'partial');
  const defect = await row('defect_carryovers','def_one');
  assert.equal(defect.amount_krw, 200); assert.equal(defect.approved_amount_krw, 150); assert.equal(defect.approved_by, 'boss');
  await pg.query('select record_payable_payment($1,550,300)', ['pay_one']);
  const retry = await approve('one', { ...input, amount: 999, reason: 'changed retry' });
  assert.deepEqual(retry, { ...result, retry: true });
  assert.equal((await row('payables','pay_one')).amount_krw, 850);
  assert.equal((await row('payables','pay_one')).paid_amount_krw, 850);
  await assert.rejects(approve('one',{...input,payableId:'pay_other'}),/approval_conflict/);
  await pg.exec('reset role');
});
test('wrong factory/order/receipt, non-deductible, paid/cancelled, over residual, stale snapshots reject atomically', async () => {
  for (const disposition of ['rework','repair']) {
    const input = await fixture(disposition, disposition);
    await rejectUnchanged(disposition, input, /not_deductible/);
  }
  const input = await fixture('bounds', 'deduct', 900);
  await rejectUnchanged('bounds', input, /over_deduction/);
  for (const patch of [{ factoryResponsible: false }, { amount: 0 }, { amount: 1.5 }, { amount: -1 }, { reason: '' }])
    await rejectUnchanged('bounds', { ...input, ...patch }, /invalid_approval/);
  await rejectUnchanged('bounds', { ...input, amount: 50, expectedDefect: { ...input.expectedDefect, amount_krw: 1 } }, /stale_defect/);
  await rejectUnchanged('bounds', { ...input, amount: 50, expectedPayable: { ...input.expectedPayable, paid_amount_krw: 0 } }, /stale_payable/);
  for (const [column, value] of [['vendor_id','other'],['order_id','one'],['source_id','other'],['payee_type','china_corp'],['status','paid'],['status','cancelled']]) {
    const id = 'bad_' + column + '_' + value;
    const data = await fixture(id);
    // Deliberately corrupt a synthetic administrator fixture to test approval's own matching/status checks.
    await pg.exec("select set_config('ames.defect_approval','on',false)");
    await pg.query(`update payables set ${column}=$1 ${column==='source_id' ? ", receipt_log_ids='[]'" : ''} where id=$2`, [value, 'pay_'+id]);
    await pg.exec("select set_config('ames.defect_approval','off',false)");
    data.expectedPayable = await row('payables','pay_'+id);
    await rejectUnchanged(id, data, column==='status' ? /payable_not_pending/ : /defect_mismatch/);
  }
  const exact = await fixture('exact','deduct',850); await approve('exact',exact);
  assert.equal((await row('payables','pay_exact')).amount_krw,850);
  assert.equal((await row('payables','pay_exact')).status,'paid');
  const nullQty=await fixture('nullqty');
  await pg.exec("update receipt_logs set defect_qty=null where id='nullqty'; update defect_carryovers set qty=null where id='def_nullqty'");
  nullQty.expectedDefect=await row('defect_carryovers','def_nullqty');
  await rejectUnchanged('nullqty',nullQty,/defect_mismatch/);
});
test('SQL grants and generic saves cannot forge approvals or restore deducted payable amount', async () => {
  const input = await fixture('guard');
  await pg.exec('set role anon');
  await assert.rejects(approve('guard',input),/permission denied/);
  await assert.rejects(pg.query("update defect_carryovers set status='applied' where id='def_guard'"),/defect_approval_required/);
  await assert.rejects(pg.query("update defect_carryovers set approved_by='boss' where id='def_guard'"),/defect_approval_required/);
  await pg.exec("select set_config('ames.defect_approval','on',false)");
  await assert.rejects(pg.query("update defect_carryovers set status='applied' where id='def_guard'"),/defect_approval_required/);
  await pg.exec('reset role; set role erp_server'); await approve('guard',input);
  await assert.rejects(pg.query("update payables set amount_krw=1000 where id='pay_guard'"),/defect_approval_required/);
  await assert.rejects(pg.query("update defect_carryovers set status='pending' where id='def_guard'"),/defect_approval_required/);
  await pg.exec('reset role');
  await assert.rejects(pg.query("delete from defect_carryovers where id='def_guard'"),/defect_approval_required/);
  await assert.rejects(pg.query("delete from payables where id='pay_guard'"),/defect_approval_required/);
  await pg.exec('reset role; set role anon');
  await assert.rejects(pg.query("update payables set amount_krw=1000 where id='pay_guard'"),/defect_approval_required/);
  await pg.exec('reset role');
});
test('payable update rolls back when saving the approval fails; intervening payment makes snapshot stale',async()=>{
  const input=await fixture('rollback');
  await pg.exec(`create function fixture_reject_approval() returns trigger language plpgsql as $$ begin
    if new.id='def_rollback' and new.approved_at is not null then raise exception 'fixture_save_failure'; end if; return new; end $$;
    create trigger fixture_save_failure before update on defect_carryovers for each row execute function fixture_reject_approval();`);
  await rejectUnchanged('rollback',input,/fixture_save_failure/);
  await pg.exec('set role erp_server');
  await pg.query("select record_payable_payment('pay_rollback',50,0)");
  await rejectUnchanged('rollback',input,/stale_payable/);
  await pg.exec('reset role');
});
test('candidate liability is protected before/after approval; generic NULL-field upserts and payment resets are blocked',async()=>{
  const input=await fixture('money_guard','deduct',300);
  for(const role of ['anon','authenticated','erp_server']){
    await pg.exec('set role '+role);
    for(const command of [
      "update payables set amount_krw=850 where id='pay_money_guard'",
      "update payables set paid_amount_krw=0,status='pending' where id='pay_money_guard'",
      "update payables set paid_amount_krw=400,status='partial' where id='pay_money_guard'",
      "update payables set status='cancelled' where id='pay_money_guard'",
      "update payables set source_id=null,receipt_log_ids='[]',source_type=null where id='pay_money_guard'",
      "delete from payables where id='pay_money_guard'",
      "insert into payables(id,amount_krw,paid_amount_krw,status) values('pay_money_guard',850,0,'pending') on conflict(id) do update set amount_krw=excluded.amount_krw,paid_amount_krw=excluded.paid_amount_krw,status=excluded.status",
    ]) {
      // A monotonic erp_server payment is authorized, so test that path through the real RPC below.
      if(role==='erp_server' && command.includes('paid_amount_krw=400'))continue;
      await assert.rejects(pg.exec(command),/defect_approval_required/);
    }
    await pg.exec("update payables set memo='safe memo' where id='pay_money_guard'; reset role");
  }
  assert.equal((await row('payables','pay_money_guard')).amount_krw,1000);
  assert.equal((await row('defect_carryovers','def_money_guard')).approved_at,null);
  await pg.exec('set role anon');
  await assert.rejects(pg.exec("delete from defect_carryovers where id='def_money_guard'"),/defect_approval_required/);
  await assert.rejects(pg.exec("update defect_carryovers set id='hidden_candidate',disposition='repair' where id='def_money_guard'"),/defect_approval_required/);
  // Removing receipt evidence cannot unlock money while its receipt candidate still exists.
  await pg.exec("delete from receipt_logs where id='money_guard'");
  await assert.rejects(pg.exec("update payables set amount_krw=850 where id='pay_money_guard'"),/defect_approval_required/);
  await pg.exec("reset role; insert into receipt_logs(id,order_id,order_no,project_no,qty,defect_qty,log_type) values('money_guard','money_guard','money_guard','money_guard',10,2,'inbound')");
  input.expectedPayable=await row('payables','pay_money_guard');
  await pg.exec('set role erp_server');await approve('money_guard',input);
  await pg.exec('reset role; set role anon');
  await assert.rejects(pg.exec("update payables set paid_amount_krw=0,status='pending' where id='pay_money_guard'"),/defect_approval_required/);
  await pg.exec('reset role; set role erp_server');
  const partial=(await pg.query("select record_payable_payment('pay_money_guard',100,300) as r")).rows[0].r;
  assert.equal(partial.paid_amount_krw,400);assert.equal(partial.status,'partial');
  await assert.rejects(pg.query("select record_payable_payment('pay_money_guard',1,300)"),/stale_payment/);
  await assert.rejects(pg.query("select record_payable_payment('pay_money_guard',451,400)"),/overpayment/);
  const paid=(await pg.query("select record_payable_payment('pay_money_guard',450,400) as r")).rows[0].r;
  assert.equal(paid.paid_amount_krw,850);assert.equal(paid.status,'paid');
  await pg.exec('reset role');
});
test('additive payment replacement rejects cancelled/paid/null status and survives latest migration reapplication',async()=>{
  await pg.exec(migration);await pg.exec(await sql('migration_expense_payable.sql'));
  for(const [id,status] of [['cancelled','cancelled'],['already_paid','paid'],['missing_status',null]]){
    await pg.query("insert into payables(id,amount_krw,paid_amount_krw,status) values($1,1000,0,$2)",[id,status]);
    await pg.exec('set role erp_server');
    await assert.rejects(pg.query('select record_payable_payment($1,100,0)',[id]),/payable_not_pending/);
    assert.equal((await row('payables',id)).paid_amount_krw,0);
    await pg.exec('reset role');
  }
  assert.equal((await pg.query("select has_function_privilege('anon','public.record_payable_payment(text,numeric,numeric)','execute') as allowed")).rows[0].allowed,false);
});
test('zero-price receipt candidate still follows server price finalization without consuming candidate money',async()=>{
  await pg.exec("insert into production_orders(id,order_no,vendor_id,vendor_name,project_no,status,quantity,factory_unit_price_krw) values('price_order','FIXTURE-PRICE','factory','Fixture Factory','PRICE','생산완료',10,0); set role erp_server");
  const receipt={id:'price_receipt',orderId:'price_order',qty:10,defectQty:2,receivedDate:'2026-10-11',createPayable:false,disposition:'deduct',destination:'korea'};
  await pg.query('select record_korea_receipt($1)',[JSON.stringify(receipt)]);
  assert.equal(await row('payables','pay_price_receipt'),undefined);
  assert.equal((await row('defect_carryovers','def_price_receipt')).amount_krw,0);
  await pg.query("update production_orders set factory_unit_price_krw=100 where id='price_order'");
  const result=(await pg.query("select generate_receipt_payables('price_order') as r")).rows[0].r;
  assert.equal(result.created,1);assert.equal(result.items[0].amount_krw,1000);
  assert.equal((await row('defect_carryovers','def_price_receipt')).amount_krw,200);
  assert.equal((await row('defect_carryovers','def_price_receipt')).status,'pending');
  const retry=(await pg.query("select generate_receipt_payables('price_order') as r")).rows[0].r;
  assert.equal(retry.created,0);assert.equal(retry.items[0].amount_krw,1000);
  await pg.exec('reset role');
});
test('expense and defect triggers coexist: approved expense links once and real payment preserves money',async()=>{
  await pg.exec(`insert into expenses(id,amount_krw,vendor_id,vendor_name,expense_type,description,order_no,lines)
    values('integrated_expense',1000,'factory','Fixture Factory','계좌이체','Fixture expense','FIXTURE-EXP','[]');
    insert into capture_inbox values('integrated_capture','approved','{"table":"expenses","id":"integrated_expense"}',
      '{"amountKrw":"1000","vendorName":"Fixture Factory","expenseType":"계좌이체"}','boss',now()); set role erp_server;`);
  const act=async()=>(await pg.query("select expense_payable_action('integrated_expense','boss','link','2026-10-12') as r")).rows[0].r;
  const linked=await act();assert.equal(linked.payable.amount_krw,1000);
  await pg.query("select record_payable_payment('pay_exp_integrated_expense',300,0)");
  assert.equal((await act()).payable.paid_amount_krw,300);
  await pg.query("select record_payable_payment('pay_exp_integrated_expense',700,300)");
  const retry=await act();assert.equal(retry.payable.paid_amount_krw,1000);assert.equal(retry.payable.status,'paid');
  await pg.exec('reset role; set role anon');
  await assert.rejects(pg.exec("update payables set paid_amount_krw=0,status='pending' where id='pay_exp_integrated_expense'"),/expense_payable_conflict/);
  await assert.rejects(pg.exec("delete from expenses where id='integrated_expense'"),/expense_payable_conflict/);
  await pg.exec('reset role');
});
test.after(async () => { await pg.close(); });
