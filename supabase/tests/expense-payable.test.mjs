import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// In-memory fixtures only: no .env, network, real records or operating DB.
const modulePath = process.env.SAMPLE_TEST_PGLITE;
if (!modulePath) throw Error('Set SAMPLE_TEST_PGLITE to the isolated installed PGlite module');
const { PGlite } = await import(pathToFileURL(modulePath).href);
test('isolated SQL: fresh roles, approved snapshots, legacy reuse, atomic conflicts and no duplicate cash plan', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create role anon; create role erp_server;
      create table app_users(id text primary key,role text,team text,position text,is_active boolean,email text);
      create table expenses(id text primary key,amount_krw numeric,vendor_id text,vendor_name text,
        expense_type text,description text,order_no text,lines jsonb,memo text);
      create table capture_inbox(id text primary key,status text,result_ref jsonb,reviewed_payload jsonb,
        reviewed_by text,reviewed_at timestamptz);
      create table payables(id text primary key,vendor_id text,vendor_name text,project_no text,
        source_type text,source_id text,amount_krw numeric,paid_amount_krw numeric,due_date date,status text,memo text,
        updated_at timestamptz default now());
      insert into app_users values('ceo','대표',null,null,true,'wonyoung@atlm.kr'),('finance','팀장','경영지원',null,true,'finance@example.invalid'),
        ('staff','사원','경영지원',null,true,'staff@example.invalid'),('other','팀장','생산관리',null,true,'other@example.invalid'),
        ('inactive','대표',null,null,false,'wonyoung@atlm.kr'),('null-role',null,null,null,true,null),
        ('wrong-ceo','대표','경영지원','팀장',true,'other-ceo@example.invalid');
      grant all on expenses,payables to anon,erp_server;
    `);
    const migration = await readFile(new URL('../migration_expense_payable.sql', import.meta.url), 'utf8');
    await pg.exec(migration); await pg.exec(migration); // additive migration can be replayed
    await pg.exec(await readFile(new URL('../migration_payable_payment_atomic.sql', import.meta.url), 'utf8'));
    const expense = async (id, approved = true, type = '계좌이체') => {
      await pg.query(`insert into expenses(id,amount_krw,vendor_id,vendor_name,expense_type,description,order_no,lines)
        values($1,1000,'vendor','Fixture vendor',$2,'Fixture expense','FIXTURE','[]')`, [id, type]);
      await pg.query(`insert into capture_inbox values($1,$2,$3,$4,'reviewer','2020-01-01')`, [
        'cap_' + id, approved ? 'approved' : 'pending', JSON.stringify({ table: 'expenses', id }),
        JSON.stringify({ amountKrw: 1000, vendorName: 'Fixture vendor', expenseType: type }),
      ]);
    };
    const act = async (id, actor = 'ceo', action = 'link', date = '2026-10-12') =>
      (await pg.query('select expense_payable_action($1,$2,$3,$4) as result', [id, actor, action, date])).rows[0].result;
    const row = async id => (await pg.query('select * from payables where source_id=$1', [id])).rows[0];
    await expense('a');
    for (const actor of ['staff', 'other', 'inactive', 'null-role', 'missing', 'wrong-ceo'])
      await assert.rejects(act('a', actor), /forbidden/);
    assert.equal((await act('a', 'finance', 'inspect', null)).payable, null);
    assert.equal((await pg.query('select count(*)::int as n from payables')).rows[0].n, 0);
    const linked = await act('a', 'finance'); assert.equal(linked.payable.id, 'pay_exp_a');
    await pg.query("update payables set paid_amount_krw=300,status='partial',memo='preserve ledger' where source_id='a'");
    await Promise.all([act('a'), act('a')]);
    assert.equal((await row('a')).paid_amount_krw, '300');
    assert.equal((await row('a')).memo, 'preserve ledger');
    assert.equal((await pg.query('select count(*)::int as n from payables')).rows[0].n, 1);
    await assert.rejects(act('a', 'ceo', 'link', '2026-10-13'), /expense_payable_conflict/);
    await assert.rejects(pg.query("update expenses set amount_krw=2000 where id='a'"), /expense_payable_conflict/);
    await assert.rejects(pg.query("update payables set source_id='other' where source_id='a'"), /expense_payable_conflict/);
    await assert.rejects(pg.query("update payables set due_date='2026-10-13' where source_id='a'"), /expense_payable_conflict/);
    await pg.query("update app_users set role='사원',position=null where id='finance'");
    await assert.rejects(act('a', 'finance'), /forbidden/);
    await expense('draft', false); await assert.rejects(act('draft'), /expense_not_approved/);
    await expense('card', true, '법인카드'); await assert.rejects(act('card'), /expense_mapping_required/);
    await expense('cash', true, '현금'); await assert.rejects(act('cash'), /expense_mapping_required/);
    await expense('changed'); await pg.query("update expenses set vendor_name='Changed' where id='changed'");
    await assert.rejects(act('changed'), /expense_snapshot_mismatch/);
    await expense('missing-vendor');
    await pg.query(`update capture_inbox set reviewed_payload=reviewed_payload-'vendorName' where id='cap_missing-vendor'`);
    await assert.rejects(act('missing-vendor'), /expense_mapping_required/);
    await expense('legacy');
    await pg.query(`insert into payables(id,vendor_id,vendor_name,project_no,source_type,source_id,amount_krw,paid_amount_krw,due_date,status,memo)
      values('legacy-pay','vendor','Fixture vendor','FIXTURE','expense','legacy',1000,700,'2026-10-12','partial','keep')`);
    const old = await act('legacy'); assert.equal(old.payable.id, 'legacy-pay');
    assert.equal(old.payable.paid_amount_krw, 700); assert.equal(old.payable.memo, 'keep');
    await expense('collision');
    await pg.query(`insert into payables(id,source_type,source_id,amount_krw) values('pay_exp_collision','manual','unrelated',77)`);
    await assert.rejects(act('collision'), /expense_payable_conflict/); assert.equal(await row('collision'), undefined);
    await expense('duplicate');
    await assert.rejects(pg.query(`insert into payables(id,source_type,source_id) values('dup1','expense','duplicate'),('dup2','expense','duplicate')`), /duplicate key/);
    assert.equal(await row('duplicate'), undefined);
    await pg.query(`insert into payables(id,source_type,source_id) values('dup1','expense','duplicate')`);
    await assert.rejects(act('duplicate'), /expense_payable_conflict/);
    await expense('rollback');
    await pg.exec(`create function fixture_reject() returns trigger language plpgsql as $$ begin
      if new.source_id='rollback' then raise exception 'fixture_failure'; end if; return new; end $$;
      create trigger fixture_reject before insert on payables for each row execute function fixture_reject();`);
    await assert.rejects(act('rollback'), /fixture_failure/); assert.equal(await row('rollback'), undefined);
    assert.equal((await pg.query("select amount_krw from expenses where id='rollback'")).rows[0].amount_krw, '1000');
    // Existing supplier statement flow: no functions or records from that flow are rewritten.
    assert.equal(/approve_capture|trade_statements|delete\s+from/i.test(migration), false);
    await pg.exec('set role anon');
    await assert.rejects(act('a'), /permission denied/);
    await assert.rejects(pg.query(`insert into payables(id,source_expense_key) values('forged','fake-expense')`), /forbidden/);
    await assert.rejects(pg.query(`update payables set source_expense_key=null,expense_approval_snapshot=null where id='pay_exp_a'`), /forbidden/);
    // Generic UPSERT's BEFORE INSERT must reject even if new approval fields are omitted.
    await assert.rejects(pg.query(`insert into payables(id,amount_krw,paid_amount_krw,status)
      values('pay_exp_a',1000,0,'pending') on conflict(id) do update set paid_amount_krw=0,status='pending'`), /forbidden/);
    await assert.rejects(pg.query(`insert into payables(id,source_type,source_id,amount_krw,paid_amount_krw,status)
      values('unapproved-new','expense','draft',1000,0,'pending')`), /forbidden/);
    await assert.rejects(pg.query(`update payables set source_type='expense',source_id='draft' where id='pay_exp_collision'`), /forbidden/);
    await assert.rejects(pg.query(`update payables set paid_amount_krw=0,status='pending' where id='pay_exp_a'`), /expense_payable_conflict/);
    await assert.rejects(pg.query(`update payables set status='cancelled' where id='pay_exp_a'`), /expense_payable_conflict/);
    await assert.rejects(pg.query(`delete from payables where id='pay_exp_a'`), /expense_payable_conflict/);
    await assert.rejects(pg.query(`delete from expenses where id='a'`), /expense_payable_conflict/);
    assert.equal((await row('a')).paid_amount_krw, '300');
    // UPDATE and the ordinary legacy expense UPSERT still allow memo changes.
    await pg.query(`update payables set memo='memo update allowed' where id='pay_exp_a'`);
    await pg.query(`update expenses set memo='normal memo update allowed' where id='a'`);
    await pg.query(`insert into expenses(id,amount_krw,vendor_id,vendor_name,expense_type,description,order_no,lines,memo)
      values('a',1000,'vendor','Fixture vendor','계좌이체','Fixture expense','FIXTURE','[]','legacy memo')
      on conflict(id) do update set memo=excluded.memo`);
    assert.equal((await pg.query(`select memo from expenses where id='a'`)).rows[0].memo, 'legacy memo');
    await pg.query(`insert into expenses(id,amount_krw,vendor_id,vendor_name,expense_type,description,order_no,lines,memo)
      values('a',1000,'vendor','Fixture vendor','계좌이체','Fixture expense','FIXTURE','[]','whole legacy row')
      on conflict(id) do update set amount_krw=excluded.amount_krw,vendor_id=excluded.vendor_id,
        vendor_name=excluded.vendor_name,expense_type=excluded.expense_type,description=excluded.description,
        order_no=excluded.order_no,lines=excluded.lines,memo=excluded.memo`);
    await assert.rejects(pg.query(`insert into expenses(id,amount_krw) values('a',1)
      on conflict(id) do update set amount_krw=excluded.amount_krw`), /expense_payable_conflict/);
    await assert.rejects(pg.query(`update payables set paid_amount_krw=0,status='pending' where id='legacy-pay'`), /expense_payable_conflict/);
    await pg.exec('reset role; set role erp_server');
    assert.equal((await act('a', 'ceo', 'inspect', null)).payable.id, 'pay_exp_a');
    const paid = (await pg.query(`select record_payable_payment('pay_exp_a',200,300) as result`)).rows[0].result;
    assert.equal(paid.paid_amount_krw, 500); assert.equal(paid.status, 'partial');
    const retry = await act('a'); assert.equal(retry.payable.paid_amount_krw, 500);
    await assert.rejects(pg.query(`select record_payable_payment('pay_exp_a',1,300)`), /stale_payment/);
    await assert.rejects(pg.query(`select record_payable_payment('pay_exp_a',501,500)`), /overpayment/);
    const final = (await pg.query(`select record_payable_payment('pay_exp_a',500,500) as result`)).rows[0].result;
    assert.equal(final.paid_amount_krw, 1000); assert.equal(final.status, 'paid');
    await pg.exec('reset role');
    // The migration also blocks role escalation after a fresh account/email change.
    await pg.query(`update app_users set email='revoked@example.invalid' where id='ceo'`);
    await assert.rejects(act('a'), /forbidden/);
    await pg.query(`update app_users set email='WONYOUNG@ATLM.KR' where id='ceo'`);
    // CaptureInbox's edited inputs arrive as JSON strings but approve_capture
    // already stores the matching numeric amount on the actual expense row.
    await expense('string-amount');
    await pg.query(`update capture_inbox set reviewed_payload=jsonb_set(reviewed_payload,'{amountKrw}','"1000"') where id='cap_string-amount'`);
    assert.equal((await act('string-amount')).payable.amount_krw, 1000);
    for (const invalid of ['NaN','Infinity','-Infinity','', '1,000', 'invalid']) {
      await expense('bad-string-' + invalid.replace(/[^A-Za-z]/g, '') + (invalid.length || 'empty'));
      const id='bad-string-' + invalid.replace(/[^A-Za-z]/g, '') + (invalid.length || 'empty');
      await pg.query(`update capture_inbox set reviewed_payload=jsonb_set(reviewed_payload,'{amountKrw}',$2::jsonb) where id=$1`,
        ['cap_'+id, JSON.stringify(invalid)]);
      await assert.rejects(act(id), /expense_mapping_required/);
    }
  } finally { await pg.close(); }
});
