import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Isolated in-memory PostgreSQL only. Never reads .env or connects to operating DB.
if (!process.env.SAMPLE_TEST_PGLITE) throw new Error('Supply isolated PGlite runtime');
const { PGlite } = await import(pathToFileURL(process.env.SAMPLE_TEST_PGLITE).href);
async function fixture(run) {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE erp_server;
      CREATE TABLE items(id text PRIMARY KEY);
      CREATE TABLE team_agent_runs(id text PRIMARY KEY,team text,created_at timestamptz,status text,
        headline text,summary text,needs jsonb,stats jsonb,model text,trigger text);
      GRANT SELECT,INSERT ON team_agent_runs TO erp_server;
      INSERT INTO items VALUES('fixture-item');`);
    await pg.exec(await readFile(new URL('./15_product_registration.sql', import.meta.url), 'utf8'));
    await pg.exec(`INSERT INTO product_listings(id,item_id,created_by,edited_by,validation)
      VALUES('fixture-listing','fixture-item','author','last-editor','{"editor_ids":["middle-editor"]}');`);
    await run(pg);
  } finally { await pg.close(); }
}

test('DB15 executes and enforces approval participants, original revision and exclusive leases', async () => fixture(async pg => {
  for (const approver of ['author', 'last-editor', 'middle-editor']) {
    await assert.rejects(pg.query(`UPDATE product_listings SET approved_by=$1,approved_revision=1,status='승인' WHERE id='fixture-listing'`, [approver]));
  }
  await pg.exec(`UPDATE product_listings SET approved_by='independent',approved_revision=1,status='승인' WHERE id='fixture-listing';`);
  assert.equal((await pg.query(`SELECT * FROM product_registration_claim('fixture-listing',2,'worker',600)`)).rows.length, 0);
  assert.equal((await pg.query(`SELECT * FROM product_registration_claim('fixture-listing',1,'worker',600)`)).rows.length, 1);
  assert.equal((await pg.query(`SELECT * FROM product_registration_claim('fixture-listing',1,'other',600)`)).rows.length, 0);
  await pg.exec(`UPDATE product_listings SET lease_until=now()-interval '1 second' WHERE id='fixture-listing'`);
  assert.equal((await pg.query(`SELECT * FROM product_registration_claim('fixture-listing',1,'other',600)`)).rows.length, 1);
}));

test('DB15 browser roles cannot read channel credentials or invoke registration/monitor writes', async () => fixture(async pg => {
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`SET ROLE ${role}`);
    await assert.rejects(pg.query('SELECT * FROM channel_tokens'));
    await assert.rejects(pg.query(`SELECT * FROM product_registration_claim('fixture-listing',1,'browser',600)`));
    await assert.rejects(pg.query(`SELECT product_shop_monitor_claim('run','daily','2026-10-11','browser',600)`));
    await pg.exec('RESET ROLE');
  }
}));

test('DB15 monitor report and issue commit atomically; lost owner/duplicate report cannot complete', async () => fixture(async pg => {
  const claim = async (id, owner = 'worker') => (await pg.query(`SELECT product_shop_monitor_claim($1,$1,'2026-10-11',$2,600) AS claimed`, [id, owner])).rows[0].claimed;
  const report = { id: 'fixture-report', team: '자사몰관리', model: 'rule-based', trigger: 'shop_manual', status: 'warn', headline: 'fixture', needs: [], stats: {} };
  const issue = [{ id: 'issue', listing_id: 'fixture-listing', kind: 'fixture', message: 'fixture' }];
  const finish = (id, owner, payload = report) => pg.query(`SELECT product_shop_monitor_finish($1,$2,$3::jsonb,'[]','{}',$4::jsonb,'[]') AS finished`, [id, owner, JSON.stringify(issue), JSON.stringify(payload)]);
  assert.equal(await claim('run1'), true);
  assert.equal(await claim('run1', 'other'), false);
  assert.equal((await finish('run1', 'other')).rows[0].finished, false);
  await assert.rejects(finish('run1', 'worker', { ...report, trigger: null }));
  assert.equal((await pg.query('SELECT * FROM product_shop_monitor_issues')).rows.length, 0);
  assert.equal((await finish('run1', 'worker')).rows[0].finished, true);
  assert.equal(await claim('run1'), false);
  await pg.exec(`UPDATE product_shop_monitor_issues SET message='unchanged' WHERE id='issue'`);
  assert.equal(await claim('run2'), true);
  await assert.rejects(finish('run2', 'worker')); // duplicate report id rolls back issue update
  assert.equal((await pg.query(`SELECT message FROM product_shop_monitor_issues WHERE id='issue'`)).rows[0].message, 'unchanged');
  assert.equal((await pg.query(`SELECT status FROM product_shop_monitor_runs WHERE id='run2'`)).rows[0].status, 'running');
}));
