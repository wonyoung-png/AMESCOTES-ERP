import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Isolated PostgreSQL/WASM only. Never loads .env or contacts the operating DB.
const modulePath=process.env.SAMPLE_TEST_PGLITE;
if(!modulePath)throw Error('Set SAMPLE_TEST_PGLITE to an isolated installed @electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const pg=new PGlite();
// Match the repository's actual vendors schema, rather than inventing a buyer flag.
assert.match(await readFile(new URL('../schema.sql',import.meta.url),'utf8'),/create table if not exists vendors\s*\([\s\S]*?\btype text\b/);
await pg.exec(`
 create role anon; create role erp_server;
 create table vendors(id text primary key,name text,type text,code text,vendor_code text,brands jsonb);
 create table app_users(id text primary key,email text,name text,role text,position text,team text,is_active boolean);
 create table samples(id text primary key,style_no text,style_name text,buyer_id text,brand_code text,stage text,request_date date,
   image_urls text[],sample_unit_price numeric,approved_by text,billing_status text default '미청구',billing_statement_id text,billing_date date,memo text);
 create table trade_statements(id text primary key,statement_no text,vendor_id text,vendor_name text,vendor_code text,
   issue_date date,lines jsonb,status text,tax_invoice_no text,collected_date date,created_at timestamptz,updated_at timestamptz);
 create table work_cards(id text primary key,created_by text,created_by_name text,team text,raw_text text,kind text,parsed jsonb,
   assignee_id text,assignee_name text,result_ref jsonb,status text default 'open',done_by_name text,done_at timestamptz,
   confirmed_payload jsonb,reply_text text,replied_by_name text,updated_at timestamptz);
 alter table work_cards add column shared_teams text[] default '{}';
 alter table work_cards add column created_at timestamptz default now();
 create table notifications(id text primary key,user_id text,card_id text,title text,body text,link text);
 grant select on app_users to erp_server; grant all on work_cards,notifications to erp_server;
 grant all on samples to anon;
 insert into vendors values('buyer','Fixture buyer','바이어','TEST','TEST','[{"name":"Fixture Brand","code":"FB"}]');
 insert into vendors values('factory','Fixture factory','공장','FACT','FACT','[]');
 insert into app_users values('staff','fixture-staff@example.invalid','Fixture Staff','사원','','제품개발',true),
 ('lead','fixture-lead@example.invalid','Fixture Lead','팀장','팀장','제품개발',true),
 ('other','fixture-other@example.invalid','Other','사원','','마케팅',true),
 ('ceo','wonyoung@atlm.kr','대표','대표','','',true);
 insert into samples(id,style_no,style_name,buyer_id,brand_code,stage,request_date,image_urls)
 values('a','HQ-FIXTURE','Fixture','buyer','FB','1차','2020-01-01',array['https://example.invalid/photo.png']),
 ('b','HQ-FIXTURE2','Fixture2','buyer','FB','1차','2020-01-01',array['https://example.invalid/photo.png']),
 ('no-photo','EMPTY','Empty','buyer','FB','1차','2020-01-01',array[]::text[]),
 ('future','FUTURE','Future','buyer','FB','1차','2099-01-01',array['https://example.invalid/photo.png']);
`);
await pg.exec(await readFile(new URL('../migration_work_notification_outbox.sql',import.meta.url),'utf8'));
await pg.exec(await readFile(new URL('../migration_sample_workflow.sql',import.meta.url),'utf8'));
const row=async id=>(await pg.query('select * from samples where id=$1',[id])).rows[0];
const act=async(id,action,actor,version,payload={})=>(await pg.query('select act_sample_workflow($1,$2,$3,$4,$5) as result',[id,action,actor,version,JSON.stringify(payload)])).rows[0].result;
const bill=async(ids,actor='lead',statement=null,month=null)=>(await pg.query('select bill_accepted_samples($1,$2,$3,$4) as result',[ids,actor,statement,month])).rows[0].result;
const review={styleName:'Reviewed Fixture',buyerId:'buyer',brandCode:'FB',sampleUnitPrice:50000};

test('PostgreSQL atomic sample workflow, permissions, retries, billing and original preservation',async()=>{
 try {
  await pg.exec('set role erp_server');
  await assert.rejects(act('a','complete','other',0),/forbidden/);
  await assert.rejects(act('no-photo','complete','staff',0),/photo_required/);
  await assert.rejects(act('future','complete','staff',0),/before_reception/);
  await assert.rejects(act('a','accept','lead',0,review),/forbidden|sample_not_completed/);
  await assert.rejects(act('a','complete','staff',99),/stale_sample/);
  const completed=await act('a','complete','staff',0);
  assert.ok(completed.completed_at); assert.equal(completed.review_status,'pending');assert.equal(completed.review_assignee_id,'lead');
  await act('a','complete','staff',0); // lost response retry preserves the original timestamp/card
  assert.equal((await row('a')).completed_at.toISOString(),new Date(completed.completed_at).toISOString());
  assert.equal((await pg.query('select count(*)::int as n from work_cards')).rows[0].n,1);
  await pg.query('select deliver_work_notifications(null)');await pg.query('select deliver_work_notifications(null)');
  assert.equal((await pg.query('select count(*)::int as n from notifications')).rows[0].n,1);
  await pg.exec('reset role; set role anon');
  await assert.rejects(pg.query("delete from samples where id='a'"),/protected_sample/);
  await pg.exec('reset role; set role erp_server');
  await assert.rejects(bill(['a']),/sample_not_accepted/);
  await assert.rejects(act('a','accept','staff',completed.workflow_version,review),/forbidden/);
  await assert.rejects(act('a','accept','lead',0,review),/stale_sample/);
  const accepted=await act('a','accept','lead',completed.workflow_version,review);
  assert.equal(accepted.review_status,'accepted');assert.equal(accepted.approved_by,'Fixture Lead');assert.equal(accepted.sample_unit_price,50000);
  assert.equal((await pg.query('select status from work_cards')).rows[0].status,'done');
  const doneB=await act('b','complete','staff',0);
  await assert.rejects(act('b','accept','lead',doneB.workflow_version,{...review,buyerId:'factory',brandCode:''}),/buyer_required/);
  assert.equal((await row('b')).review_status,'pending');
  await act('b','accept','lead',doneB.workflow_version,{...review,sampleUnitPrice:25000});
  const month=new Date(Date.now()+9*3600_000).toISOString().slice(0,7);
  await assert.rejects(bill(['a','b'],'lead',null,'2020-01'),/sample_not_accepted/);
  await assert.rejects(bill(['a'],'staff'),/forbidden/);
  const single=await bill(['a']);const sid=single[0].statementId;
  await bill(['a','b'],'lead',sid,month);
  await bill(['b']);await bill(['a','b'],'lead',null,month); // alternate single/bulk retry
  const st=(await pg.query('select * from trade_statements')).rows;
  assert.equal(st.length,1);assert.equal(st[0].lines.length,2);assert.equal(st[0].lines.reduce((sum,l)=>sum+l.unitPrice,0),75000);
  assert.ok(st[0].statement_no);assert.equal((await row('b')).billing_statement_id,sid);
  // Existing lines and retry paths must also revalidate a vendor whose type changed.
  await pg.exec("reset role; update vendors set type='공장' where id='buyer'; set role erp_server");
  await assert.rejects(bill(['a']),/buyer_required/);
  await pg.exec("reset role; update vendors set type='바이어' where id='buyer'; set role erp_server");
  const billedA=await row('a');
  await assert.rejects(act('a','unbill','staff',billedA.workflow_version),/forbidden/);
  await assert.rejects(act('a','unbill','lead',0),/stale_sample/);
  await pg.query("update trade_statements set tax_invoice_no='FIXTURE-INVOICE' where id=$1",[sid]);
  await assert.rejects(act('a','unbill','lead',billedA.workflow_version),/statement_not_editable/);
  await pg.query("update trade_statements set tax_invoice_no=null,collected_date=current_date where id=$1",[sid]);
  await assert.rejects(act('a','unbill','lead',billedA.workflow_version),/statement_not_editable/);
  await pg.query('update trade_statements set collected_date=null where id=$1',[sid]);
  // Force failure after statement-line removal: both original records must roll back.
  await pg.exec(`reset role;
    create function fixture_unbill_failure() returns trigger language plpgsql as $$
    begin if old.billing_statement_id is not null and new.billing_statement_id is null then
      raise exception 'fixture_unbill_failure'; end if; return new; end $$;
    create trigger fixture_unbill_failure before update on samples for each row execute function fixture_unbill_failure();
    set role erp_server;`);
  await assert.rejects(act('a','unbill','lead',billedA.workflow_version),/fixture_unbill_failure/);
  assert.equal((await row('a')).billing_statement_id,sid);
  assert.equal((await pg.query('select lines from trade_statements where id=$1',[sid])).rows[0].lines.length,2);
  await pg.exec('reset role; drop trigger fixture_unbill_failure on samples; set role erp_server');
  const unbilled=await act('a','unbill','lead',billedA.workflow_version);
  assert.equal(unbilled.billing_status,'미청구');assert.equal(unbilled.billing_statement_id,null);assert.equal(unbilled.billing_date,null);
  assert.deepEqual((await pg.query('select lines from trade_statements where id=$1',[sid])).rows[0].lines.map(l=>l.id),['sample-line-b']);
  await act('a','unbill','lead',billedA.workflow_version); // lost response retry
  await bill(['a'],'lead',sid);
  await act('a','unbill','ceo',(await row('a')).workflow_version); // CEO proxy
  await bill(['a'],'lead',sid);
  assert.equal((await pg.query('select lines from trade_statements where id=$1',[sid])).rows[0].lines.length,2);
  await pg.exec('reset role; set role anon');
  await assert.rejects(pg.query("delete from samples where id='a'"),/protected_sample/);
  await pg.query("update samples set memo='accepted memo' where id='a'");
  assert.equal((await row('a')).memo,'accepted memo');
  await assert.rejects(pg.query("insert into samples(id,stage) values('a','최종승인') on conflict(id) do update set memo='forged'"),/sample_workflow_required/);
  await pg.exec("insert into samples(id,stage) values('deletable','1차'); delete from samples where id='deletable'");
  assert.equal(await row('deletable'),undefined);
  await assert.rejects(pg.query("update samples set stage='최종승인' where id='no-photo'"),/sample_workflow_required/);
  await assert.rejects(pg.query("update samples set accepted_by='staff' where id='a'"),/sample_workflow_required/);
  await assert.rejects(pg.query("update samples set image_urls=array['forged'] where id='a'"),/sample_review_required/);
  await assert.rejects(act('no-photo','complete','staff',0),/permission denied/);
  await pg.exec('reset role');
  await pg.exec("insert into samples(id,style_no,style_name,buyer_id,brand_code,stage,request_date,image_urls) values('c','C','C','buyer','FB','1차','2020-01-01',array['https://example.invalid/photo.png']); set role erp_server");
  const c=await act('c','complete','staff',0);await act('c','accept','lead',c.workflow_version,review);
  await pg.exec("update trade_statements set status='청구완료' where id='"+sid+"'");
  await assert.rejects(bill(['c'],'lead',sid),/statement_not_editable/);
  await assert.rejects(act('a','unbill','lead',(await row('a')).workflow_version),/statement_not_editable/);
  assert.equal((await row('c')).billing_status,'미청구'); // failed append rolls back sample and statement
  assert.equal((await pg.query('select lines from trade_statements')).rows[0].lines.length,2);
  await pg.exec('reset role');
  await pg.query("update vendors set type='공장' where id='buyer'");
  await pg.exec('set role erp_server');
  await assert.rejects(bill(['c']),/buyer_required/); // first charge, not only reuse
  await pg.exec("reset role; update vendors set type='바이어' where id='buyer'; set role erp_server");
  await pg.query("update trade_statements set status='수금완료',collected_date=current_date where id=$1",[sid]);
  await pg.query("update samples set billing_status='수금완료' where id='a'");
  await bill(['a']);
  assert.equal((await row('a')).billing_status,'수금완료');
  assert.equal((await pg.query('select status from trade_statements where id=$1',[sid])).rows[0].status,'수금완료');
  await assert.rejects(act('a','unbill','lead',(await row('a')).workflow_version),/statement_not_editable/);
  await pg.exec('reset role');
  await assert.rejects(pg.query("delete from samples where id='a'"),/protected_sample/);
 } finally {await pg.close();}
});
