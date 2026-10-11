import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.env.SAMPLE_TEST_PGLITE) throw Error('Supply isolated PGlite runtime');
const { PGlite } = await import(pathToFileURL(process.env.SAMPLE_TEST_PGLITE).href);
test('ads auth schema is repeatable, browser-inaccessible, exclusive and independent of product tokens', async () => {
  const pg=new PGlite();
  try {
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE erp_server;
      CREATE TABLE channel_tokens(channel text PRIMARY KEY CHECK(channel='cafe24_erp'),access_token text);
      INSERT INTO channel_tokens VALUES('cafe24_erp','synthetic-existing-product-token');`);
    const sql=await readFile(new URL('./16_ads_commerce_tokens.sql',import.meta.url),'utf8');
    await pg.exec(sql); await pg.exec(sql);
    for(const role of ['anon','authenticated']) {
      await pg.exec('SET ROLE '+role);
      await assert.rejects(pg.query('SELECT * FROM ads_channel_tokens'));
      await assert.rejects(pg.query("SELECT * FROM ads_commerce_token_claim('browser',90)"));
      await pg.exec('RESET ROLE');
    }
    await pg.exec(`SET ROLE erp_server;
      INSERT INTO ads_channel_tokens(channel,access_token,refresh_token,expires_at)
      VALUES('cafe24_ads','','','1970-01-01T00:00:00Z');`);
    assert.equal((await pg.query("SELECT * FROM ads_commerce_token_claim('owner',90)")).rows.length,1);
    assert.equal((await pg.query("SELECT * FROM ads_commerce_token_claim('other',90)")).rows.length,0);
    assert.equal((await pg.query("UPDATE ads_channel_tokens SET access_token='synthetic-token' WHERE lease_owner='other' RETURNING channel")).rows.length,0);
    await assert.rejects(pg.query("DELETE FROM ads_channel_tokens"));
    await pg.exec('RESET ROLE');
    assert.equal((await pg.query('SELECT access_token FROM channel_tokens')).rows[0].access_token,'synthetic-existing-product-token');
    await assert.rejects(pg.query("INSERT INTO ads_channel_tokens(channel,access_token,refresh_token,expires_at) VALUES('cafe24_erp','','',now())"));
  } finally { await pg.close(); }
});
