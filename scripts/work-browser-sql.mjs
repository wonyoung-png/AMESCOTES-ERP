// Real database regression checks against the disposable restored schema only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function verifyDatabaseWorkflows({ client, root }) {
  assert.equal(process.env.ERP_BROWSER_ISOLATED, '20261010');
  assert.equal(process.env.POSTGREST_URL, 'http://127.0.0.1:4192');
  const port = await client.query("SELECT current_setting('port') AS port");
  assert.equal(port.rows[0].port, '4191');
  await client.query('SET search_path=public,pg_catalog; SET client_min_messages=notice; SET plpgsql.check_asserts=on');
  const files = [
    'brand_workflow_regression.sql', 'receipt_atomic_regression.sql',
    'china_stock_regression.sql', 'china_partial_arrivals_regression.sql',
    'schedule_workflow_regression.sql', 'schedule_confirm_version_regression.sql',
    'work_read_regression.sql', 'work_notification_outbox_regression.sql',
  ];
  const snapshot = async () => {
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const counts = {};
    for (const { tablename } of tables.rows) {
      const escaped = tablename.replaceAll('"', '""');
      counts[tablename] = (await client.query(`SELECT count(*)::int AS n FROM public."${escaped}"`)).rows[0].n;
    }
    return counts;
  };
  const before = await snapshot();
  assert.ok(Object.values(before).every(count => count === 0), 'Fresh empty schema required before SQL fixtures');
  const results = [];
  for (const file of files) {
    const sql = await fs.readFile(path.join(root, 'supabase/tests', file), 'utf8');
    assert.match(sql, /\bbegin\s*;/i);
    assert.match(sql, /rollback\s*;\s*$/i);
    const notices = [];
    const onNotice = notice => notices.push(notice.message);
    client.on('notice', onNotice);
    try {
      const commands = await client.query(sql);
      assert.ok(commands.some(result => result.command === 'DO'), file + ' must execute its assertion blocks');
      assert.deepEqual(await snapshot(), before, file + ' must leave no fixture rows');
      results.push({ file, status: 'PASS', notices, rollbackVerified: true });
      console.log('PASS DB ' + file + ' ' + notices.join('; '));
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(file + ': ' + error.message, { cause: error });
    } finally { client.off('notice', onNotice); }
  }
  return { status: 'PASS', files: results, limits: ['Real SQL/RPC execution, not full browser screens', 'Synthetic rows only; all fixtures rolled back'] };
}
