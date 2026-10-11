import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Only in-memory PostgreSQL/WASM. No .env, operating DB, network or persisted DB directory.
const modulePath = process.env.SAMPLE_TEST_PGLITE;
if (!modulePath) throw Error('Set SAMPLE_TEST_PGLITE to the isolated PGlite dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const migration = await read('migration_sample_settlement.sql');
const base = await read('migration_settlement_atomic.sql');
const rpcBody = sql => sql.slice(sql.indexOf('create or replace function public.save_settlement'), sql.indexOf('end $$;', sql.indexOf('create or replace function public.save_settlement')) + 7).replaceAll('\r\n', '\n');

test('additive RPC preserves the entire base body except marked sample linkage additions', () => {
  const stripped = rpcBody(migration).replace(/^  +-- sample-settlement ([\w ]+) begin\n[\s\S]*?^  +-- sample-settlement \1 end\n/gm, '');
  assert.equal(stripped, rpcBody(base));
  assert.ok(migration.indexOf("hashtext('sample-bill:'") < migration.indexOf("hashtextextended('statement:'"));
  assert.doesNotMatch(migration, /disable trigger|security definer|create.*guard_sample_workflow/i);
});

test('isolated PostgreSQL sample settlement, exact lineage, retries and atomic rollback', async t => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create role anon; create role erp_server;
      create table vendors(id text primary key,name text,type text,code text,vendor_code text,brands jsonb);
      create table app_users(id text primary key,email text,name text,role text,position text,team text,is_active boolean);
      create table samples(id text primary key,style_no text,style_name text,buyer_id text,brand_code text,stage text,request_date date,
        image_urls text[],sample_unit_price numeric,approved_by text,billing_status text default '미청구',billing_statement_id text,billing_date date,memo text);
      create table trade_statements(id text primary key,statement_no text,vendor_id text,vendor_name text,vendor_code text,
        workspace text,project_no text,issue_date date,lines jsonb,status text,tax_invoice jsonb,tax_invoice_no text,collected_date date,memo text,
        created_at timestamptz default now(),updated_at timestamptz default now());
      create table settlements(id text primary key,buyer_id text,buyer_name text,project_no text,workspace text,channel text,
        invoice_no text,invoice_date date,due_date date,billed_amount_krw numeric,collected_amount_krw numeric,collected_date date,
        status text,memo text,created_at timestamptz default now());
      create table work_cards(id text primary key,created_by text,created_by_name text,team text,raw_text text,kind text,parsed jsonb,
        assignee_id text,assignee_name text,result_ref jsonb,status text default 'open',done_by_name text,done_at timestamptz,
        confirmed_payload jsonb,reply_text text,replied_by_name text,updated_at timestamptz,shared_teams text[] default '{}',created_at timestamptz default now());
      create table notifications(id text primary key,user_id text,card_id text,title text,body text,link text);
      grant select on app_users to erp_server; grant all on work_cards,notifications to erp_server;
      grant insert on vendors to erp_server; -- Existing regression inserts only synthetic buyers.
      grant all on samples to anon;
      insert into vendors values('buyer','Fixture buyer','바이어','TEST','TEST','[]'),('other','Other buyer','바이어','OTHER','OTHER','[]');
    `);
    await pg.exec(await read('migration_work_notification_outbox.sql'));
    await pg.exec(await read('migration_sample_workflow.sql'));
    const shipment = await read('migration_shipment_billing_atomic.sql');
    const amountStart = shipment.indexOf('create or replace function public.erp_statement_amount');
    await pg.exec(shipment.slice(amountStart, shipment.indexOf('end $$;', amountStart) + 7));
    const billingStart = shipment.indexOf('create or replace function public.save_statement_billing');
    await pg.exec(shipment.slice(billingStart, shipment.indexOf('end $$;', billingStart) + 7));
    await pg.exec('revoke all on function public.erp_statement_amount(jsonb) from public,anon; grant execute on function public.erp_statement_amount(jsonb) to erp_server');
    await pg.exec('revoke all on function public.save_statement_billing(jsonb) from public,anon; grant execute on function public.save_statement_billing(jsonb) to erp_server');
    await pg.exec(base);
    await pg.exec(migration); await pg.exec(migration); // rerunnable, no historical data writes

    const jsonRows = async table => (await pg.query(`select to_jsonb(r) as row from ${table} r order by id`)).rows.map(r => r.row);
    const snapshot = async () => ({ samples: await jsonRows('samples'), settlements: await jsonRows('settlements'), statements: await jsonRows('trade_statements') });
    const sample = async id => (await pg.query('select to_jsonb(s) as row from samples s where id=$1', [id])).rows[0].row;
    const preserve = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['billing_status', 'workflow_version'].includes(key)));
    const seed = async root => {
      await pg.exec('reset role');
      const ids = [root + '_a', root + '_b'];
      const lines = ids.map((id, i) => ({ id: 'sample-line-' + id, memo: id, description: 'Fixture sample', qty: 1, unitPrice: (i + 1) * 1000, taxType: '과세', taxRate: 0.1 }));
      await pg.query(`insert into trade_statements(id,statement_no,vendor_id,vendor_name,workspace,project_no,issue_date,lines,status)
        values($1,$2,'buyer','Fixture buyer','OEM',$1,'2026-10-11',$3,'청구완료')`, [root, 'INV_' + root, JSON.stringify(lines)]);
      for (const [i, id] of ids.entries()) {
        await pg.query(`insert into samples(id,style_no,style_name,buyer_id,brand_code,stage,request_date,image_urls,sample_unit_price,
          approved_by,billing_status,billing_statement_id,billing_date,memo,completed_at,completed_by,review_status,review_assignee_id,
          review_card_id,accepted_at,accepted_by) values($1,'STYLE','Fixture','buyer','FB','최종승인','2020-01-01',array['https://example.invalid/photo.png'],
          $2,'Reviewer','청구완료',$3,'2026-10-11','preserve','2026-10-10','staff','accepted','reviewer','review-card','2026-10-11','reviewer')`, [id, (i + 1) * 1000, root]);
      }
      const input = { id: 'stl_' + root, buyerId: 'buyer', buyerName: 'Fixture buyer', projectNo: root, workspace: 'OEM', channel: 'B2B직납',
        invoiceNo: 'INV_' + root, invoiceDate: '2026-10-11', dueDate: '2099-01-01', billedAmountKrw: 3300, collectedAmountKrw: 0 };
      await pg.exec('set role erp_server');
      const save = async (amount, expected = null, patch = {}) => (await pg.query('select public.save_settlement($1::jsonb) as result', [JSON.stringify({
        settlement: { ...input, collectedAmountKrw: amount, ...(amount ? { collectedDate: '2026-10-11' } : {}), ...patch }, expected,
      })])).rows[0].result;
      return { root, ids, lines, save, input };
    };

    await t.test('existing settlement SQL regression passes unchanged under the additive RPC', async () => {
      try { await pg.exec(await read('tests/settlement_atomic_regression.sql')); }
      catch (error) { await pg.exec('rollback; reset role'); throw error; }
    });

    await t.test('partial → complete; protected values intact; same-state retries do not bump sample versions', async () => {
      const f = await seed('happy'), before = await Promise.all(f.ids.map(sample));
      const zero = await f.save(0);
      const partial = await f.save(1000, zero.settlement);
      assert.equal(partial.statement.status, '청구완료');
      assert.equal(partial.statement.collected_date, null);
      for (const [i, id] of f.ids.entries()) assert.deepEqual(await sample(id), before[i]);
      await f.save(1000, zero.settlement); // lost-response retry with old expected snapshot
      const full = await f.save(3300, partial.settlement);
      assert.equal(full.settlement.status, '완납'); assert.equal(full.statement.status, '수금완료');
      assert.equal(full.statement.collected_date, '2026-10-11');
      for (const [i, id] of f.ids.entries()) {
        const after = await sample(id);
        assert.equal(after.billing_status, '수금완료'); assert.equal(after.workflow_version, before[i].workflow_version + 1);
        assert.deepEqual(preserve(after), preserve(before[i]));
      }
      const completed = await snapshot(); await f.save(3300, partial.settlement);
      assert.deepEqual(await snapshot(), completed);
    });

    await t.test('reapplying additive migration does not mutate existing billing or protected values', async () => {
      await pg.exec('reset role'); const before = await snapshot();
      await pg.exec(migration); assert.deepEqual(await snapshot(), before);
    });

    await t.test('partial amount restores only billing status; unrelated buyer stays unchanged', async () => {
      const f = await seed('partial');
      await pg.exec("reset role; update samples set billing_status='수금완료' where id='partial_a';");
      await pg.query(`insert into samples(id,buyer_id,review_status,billing_status,memo) values('unrelated','other','accepted','청구완료','keep')`);
      const a = await sample(f.ids[0]), unrelated = await sample('unrelated');
      await pg.exec('set role erp_server'); await f.save(1000);
      assert.equal((await sample(f.ids[0])).billing_status, '청구완료');
      assert.deepEqual(preserve(await sample(f.ids[0])), preserve(a));
      assert.deepEqual(await sample('unrelated'), unrelated);
    });

    const mismatches = [
      ['other_buyer', "update samples set buyer_id='other' where id=$1"],
      ['unaccepted', "update samples set review_status='pending' where id=$1"],
      ['no_acceptance', 'update samples set accepted_at=null where id=$1'],
      ['unbilled', "update samples set billing_status='미청구' where id=$1"],
      ['wrong_link', "update samples set billing_statement_id='wrong' where id=$1"],
      ['missing_link', 'update samples set billing_statement_id=null where id=$1'],
      ['price', 'update samples set sample_unit_price=999 where id=$1'],
    ];
    for (const [root, change] of mismatches) await t.test(root + ' rejects and rolls back every ledger', async () => {
      const f = await seed(root), initial = await f.save(0);
      await pg.exec('reset role'); await pg.query(change, [f.ids[0]]); await pg.exec('set role erp_server');
      const before = await snapshot();
      await assert.rejects(f.save(3300, initial.settlement), /sample_settlement_mismatch/);
      assert.deepEqual(await snapshot(), before);
    });

    const lineChanges = [
      ['missing_row', lines => lines.slice(1)],
      ['orphan', lines => [{ ...lines[0], id: 'sample-line-absent', memo: 'absent' }, lines[1]]],
      ['identity_conflict', lines => [{ ...lines[0], memo: 'unrelated' }, lines[1]]],
      ['duplicate_row', lines => [...lines, lines[0]]],
      ['row_quantity', lines => [{ ...lines[0], qty: 2 }, lines[1]]],
    ];
    for (const [root, change] of lineChanges) await t.test(root + ' lineage mismatch rolls back', async () => {
      const f = await seed(root); const lines = change(f.lines);
      await pg.exec('reset role'); await pg.query('update trade_statements set lines=$1 where id=$2', [JSON.stringify(lines), root]);
      const amount = Number((await pg.query('select public.erp_statement_amount($1::jsonb) as amount', [JSON.stringify(lines)])).rows[0].amount);
      await pg.exec('set role erp_server'); const before = await snapshot();
      await assert.rejects(f.save(amount, null, { billedAmountKrw: amount }), /sample_settlement_mismatch/);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('verified legacy memo-only line works without inventing a historical sample link', async () => {
      const f = await seed('memo');
      const lines = f.lines.map((line, i) => ({ ...line, id: 'legacy-row-' + i }));
      await pg.exec('reset role'); await pg.query('update trade_statements set lines=$1 where id=$2', [JSON.stringify(lines), f.root]);
      await pg.exec('set role erp_server'); await f.save(3300);
      for (const id of f.ids) assert.equal((await sample(id)).billing_status, '수금완료');
    });

    await t.test('sample trigger failure after financial writes atomically rolls everything back', async () => {
      const f = await seed('trigger'), initial = await f.save(0);
      await pg.exec(`reset role; create function fixture_sample_reject() returns trigger language plpgsql as $$ begin
        if new.id='trigger_b' and new.billing_status='수금완료' then raise exception 'fixture_sample_failure'; end if; return new; end $$;
        create trigger fixture_sample_reject before update on samples for each row execute function fixture_sample_reject(); set role erp_server;`);
      const before = await snapshot(); await assert.rejects(f.save(3300, initial.settlement), /fixture_sample_failure/);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('protected sample trigger stays enabled; anonymous billing mutation/RPC remains denied', async () => {
      assert.equal((await pg.query("select tgenabled from pg_trigger where tgname='sample_workflow_guard'")).rows[0].tgenabled, 'O');
      await pg.exec('reset role; set role anon');
      await assert.rejects(pg.query("update samples set billing_status='수금완료' where id='partial_a'"), /sample_workflow_required/);
      await assert.rejects(pg.query("select public.save_settlement('{}')"), /permission denied/);
    });
  } finally { await pg.close(); }
});
