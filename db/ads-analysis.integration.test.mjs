import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// In-memory PostgreSQL/WASM only: no .env, HTTP, model imports or operating DB.
// Parallel promises exercise serialized contenders, NOT separate PostgreSQL sessions.
const modulePath = process.env.SAMPLE_TEST_PGLITE;
if (!modulePath) throw Error('Set SAMPLE_TEST_PGLITE to an isolated installed @electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const pg = new PGlite();
const migration = await readFile(new URL('./016_ads_analysis.sql', import.meta.url), 'utf8');
const query = async (sql, params = []) => (await pg.query(sql, params)).rows;
const rpc = async (name, params) => (await query(`select ${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) as result`, params))[0].result;
const json = value => JSON.stringify(value);
const run = (id = 'run_a', patch = {}) => ({ id, market: 'lm-kr', kind: 'question', question: 'Fixture question', day: '2026-10-11', status: 'queued', ...patch });
const open = (value = run(), key = 'request_a', actor = 'actor_a', cap = 5) => rpc('ads_open_run', [json(value), key, actor, cap]);
const claim = (owner = 'worker_a') => rpc('ads_claim_run', [owner]);
const renew = (id = 'run_a', owner = 'worker_a') => rpc('ads_renew_run', [id, owner]);
const save = (value, owner = 'worker_a', expected = 'queued', job = null) => rpc('ads_save_run', [value.id, owner, expected, json(value), job ? json(job) : null]);
const beginCall = (id = 'run_a', owner = 'worker_a', stage = 'plan') => rpc('ads_begin_call', [id, owner, stage]);
const claimJob = (runner = 'runner_a', token = '0123456789abcdefghij-token') => rpc('ads_claim_job', [runner, token]);
const finishJob = (id, runner, token, result, error = null) => rpc('ads_finish_job', [id, runner, token, result == null ? null : json(result), error]);
const score = (id, value) => rpc('ads_score_run', [id, json(value)]);
const fixtureAdmin = async sql => { await pg.exec('reset role'); try { await pg.exec(sql); } finally { await pg.exec('set role erp_server'); } };
const job = (id = 'job_a', phase = 'independent') => ({ id, phase, task: { phase, question: 'Fixture question', snapshot: { id: 'snapshot_a' } }, expires_at: new Date(Date.now() + 300_000).toISOString() });
async function stagedJob() {
  await open(); const row = await claim();
  await save({ ...row.payload, status: 'independent', snapshot: { id: 'snapshot_a', facts: [] } }, 'worker_a', 'queued', job());
  return claimJob();
}

before(async () => {
  await pg.exec('create role anon; create role erp_server; create role authenticated;');
  await pg.exec(migration);
  await pg.exec(migration);
});
beforeEach(async () => {
  await pg.exec('reset role; truncate ads_analysis_jobs,ads_analysis_runs,ads_analysis_budget,ads_analysis_notices; set role erp_server;');
});
after(async () => { await pg.close(); });

test('full migration reruns without changing saved runs, budgets or grants', async () => {
  const original = await open(); await claim(); await beginCall();
  const beforeRun = (await query('select * from ads_analysis_runs'))[0];
  await fixtureAdmin(migration);
  assert.deepEqual((await query('select * from ads_analysis_runs'))[0], beforeRun);
  assert.equal(original.id, 'run_a');
  assert.equal(Number((await query('select reserved_usd from ads_analysis_budget'))[0].reserved_usd), 0.60);
});

test('same request/actor retries return original ID without reserving a second budget', async () => {
  const first = await open();
  const retry = await open(run('new_random_id'), 'request_a');
  assert.equal(retry.id, first.id); assert.deepEqual(retry.payload, first.payload);
  assert.equal((await query('select * from ads_analysis_runs')).length, 1);
  assert.equal(Number((await query('select reserved_usd from ads_analysis_budget'))[0].reserved_usd), 0.60);
});
test('waiting Codex stage defers only itself and permits another market/question to proceed', async () => {
 for(const phase of ['independent','cross_review']) {
  await fixtureAdmin('truncate ads_analysis_jobs,ads_analysis_runs,ads_analysis_budget,ads_analysis_notices');
  await open(run('waiting'));await open(run('other',{market:'lm-gl'}),'other_request');
  const first=await claim();assert.equal(first.id,'waiting');
  await save({...first.payload,status:phase},'worker_a','queued');
  assert.equal((await claim()).id,'waiting');
  await save({...first.payload,status:phase},'worker_a',phase);
  const deferred=(await query('select next_check_at>now() as deferred from ads_analysis_runs where id=$1',['waiting']))[0];assert.equal(deferred.deferred,true);
  const other=await claim('worker_b');assert.equal(other.id,'other');
  await save({...other.payload,status:'completed'},'worker_b','queued');
  assert.equal(await claim(),null);
  await fixtureAdmin("update ads_analysis_runs set next_check_at=now()-interval '1 second' where id='waiting'");
  const again=await claim('worker_c');assert.equal(again.id,'waiting');
  await assert.rejects(save({...again.payload,status:phase},'worker_a',phase),/ads_lease_lost/);
  await save({...again.payload,status:'finalizing'},'worker_c',phase);
  assert.equal((await claim('worker_d')).id,'waiting');
 }
});

test('actor, market and question request conflicts do not mutate the original or budget', async () => {
  const first = await open();
  await assert.rejects(open(run('run_b'), 'request_a', 'actor_b'), /ads_request_conflict/);
  await assert.rejects(open(run('run_b', { market: 'lm-gl' })), /ads_request_conflict/);
  await assert.rejects(open(run('run_b', { question: 'Changed question' })), /ads_request_conflict/);
  assert.deepEqual((await query('select payload from ads_analysis_runs'))[0].payload, first.payload);
  assert.equal(Number((await query('select reserved_usd from ads_analysis_budget'))[0].reserved_usd), 0.60);
});

test('concurrent-style contenders share one daily budget; denied/duplicate-ID inserts roll back reservation', async () => {
  const contenders = await Promise.allSettled([
    open(run('run_a'), 'key_a', 'actor_a', 0.60),
    open(run('run_b'), 'key_b', 'actor_b', 0.60),
  ]);
  assert.equal(contenders.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(String(contenders.find(r => r.status === 'rejected').reason), /ads_daily_cap/);
  const winner = contenders.find(r => r.status === 'fulfilled').value;
  await assert.rejects(open(run(winner.id), 'different_key', 'actor_a', 5), /duplicate key/);
  assert.equal(Number((await query('select reserved_usd from ads_analysis_budget'))[0].reserved_usd), 0.60);
  await open(run('other_day', { day: '2026-10-12' }), 'other_day_key', 'actor_a', 0.60);
  assert.equal((await query('select * from ads_analysis_budget')).length, 2);
});

test('parallel same-key retries preserve one original run and one reservation', async () => {
  const rows = await Promise.all([open(run('run_a')), open(run('run_b')), open(run('run_c'))]);
  assert.ok(rows.every(row => row.id === rows[0].id));
  assert.equal((await query('select * from ads_analysis_runs')).length, 1);
  assert.equal(Number((await query('select reserved_usd from ads_analysis_budget'))[0].reserved_usd), 0.60);
});

test('run claims fence wrong owners, stale expected stages and expired leases; expiry is recoverable', async () => {
  await open(); const row = await claim();
  assert.equal(row.lease_owner, 'worker_a'); assert.equal(await claim('worker_b'), null);
  const next = { ...row.payload, status: 'planning' };
  await assert.rejects(save(next, 'worker_b'), /ads_lease_lost/);
  await assert.rejects(save(next, 'worker_a', 'planning'), /ads_lease_lost/);
  await fixtureAdmin("update ads_analysis_runs set lease_until=now()-interval '1 second'");
  await assert.rejects(save(next), /ads_lease_lost/);
  const recovered = await claim('worker_b'); assert.equal(recovered.id, row.id);
  await assert.rejects(save(next), /ads_lease_lost/);
  const saved = await save(next, 'worker_b'); assert.equal(saved.status, 'planning'); assert.equal(saved.lease_owner, null);
});

test('renew extends an owned unexpired lease to 120 seconds without changing payload or status', async () => {
  await open(); await claim();
  await fixtureAdmin("update ads_analysis_runs set lease_until=now()+interval '10 seconds'");
  const before = (await query('select * from ads_analysis_runs'))[0];
  assert.equal(await renew(), true);
  const after = (await query("select *, extract(epoch from lease_until-now()) as remaining from ads_analysis_runs"))[0];
  assert.ok(Number(after.remaining) > 115 && Number(after.remaining) <= 120);
  assert.ok(after.lease_until > before.lease_until);
  assert.equal(after.lease_owner, before.lease_owner);
  assert.equal(after.status, before.status); assert.deepEqual(after.payload, before.payload);
});

test('renew rejects wrong/missing owner and run without changing the current lease', async () => {
  await open(); await claim();
  const before = (await query('select * from ads_analysis_runs'))[0];
  for (const owner of ['worker_b', '', null]) await assert.rejects(renew('run_a', owner), /ads_lease_lost/);
  await assert.rejects(renew('missing'), /ads_lease_lost/);
  assert.deepEqual((await query('select * from ads_analysis_runs'))[0], before);
});

test('renew never revives expired lease; after reclaim the previous owner remains fenced', async () => {
  await open(); await claim();
  await fixtureAdmin("update ads_analysis_runs set lease_until=now()-interval '1 second'");
  const expired = (await query('select * from ads_analysis_runs'))[0];
  await assert.rejects(renew(), /ads_lease_lost/);
  assert.deepEqual((await query('select * from ads_analysis_runs'))[0], expired);
  await claim('worker_b');
  await assert.rejects(renew(), /ads_lease_lost/);
  assert.equal(await renew('run_a', 'worker_b'), true);
  assert.equal((await query('select lease_owner from ads_analysis_runs'))[0].lease_owner, 'worker_b');
});

test('renew rejects completed/failed runs even when owner and future lease still match', async () => {
  await open(); await claim();
  for (const status of ['completed', 'failed']) {
    await fixtureAdmin(`update ads_analysis_runs set status='${status}',lease_until=now()+interval '60 seconds'`);
    const before = (await query('select * from ads_analysis_runs'))[0];
    await assert.rejects(renew(), /ads_lease_lost/);
    assert.deepEqual((await query('select * from ads_analysis_runs'))[0], before);
  }
});

test('save guards run identity/scope and freezes snapshot after first durable attachment', async () => {
  await open(); const row = await claim();
  for (const patch of [{ market: 'lm-gl' }, { question: 'Changed' }, { day: '2026-10-12' }]) {
    await assert.rejects(save({ ...row.payload, ...patch, status: 'planning' }), /ads_scope_changed/);
  }
  const snapshot = { id: 'snapshot_a', facts: [{ id: 'spend', value: 10 }] };
  await save({ ...row.payload, status: 'planning', snapshot });
  const second = await claim();
  await assert.rejects(save({ ...second.payload, snapshot: { ...snapshot, facts: [] } }, 'worker_a', 'planning'), /ads_snapshot_changed/);
  const removed = { ...second.payload }; delete removed.snapshot;
  await assert.rejects(save(removed, 'worker_a', 'planning'), /ads_snapshot_changed/);
  await save({ ...second.payload, status: 'independent' }, 'worker_a', 'planning');
  assert.deepEqual((await query('select payload from ads_analysis_runs'))[0].payload.snapshot, snapshot);
});

test('begin_call is durable once per stage, requires current owner and never silently replays an uncertain invocation', async () => {
  await open(); await claim();
  await assert.rejects(beginCall('run_a', 'worker_b'), /ads_call_already_attempted/);
  await assert.rejects(beginCall('run_a', 'worker_a', 'unknown'), /invalid_ads_stage/);
  assert.equal(await beginCall(), true);
  await assert.rejects(beginCall(), /ads_call_already_attempted/);
  await fixtureAdmin("update ads_analysis_runs set lease_until=now()-interval '1 second'");
  await assert.rejects(beginCall('run_a', 'worker_a', 'independent'), /ads_call_already_attempted/);
  await claim('worker_b'); await assert.rejects(beginCall('run_a', 'worker_b'), /ads_call_already_attempted/);
  assert.equal(await beginCall('run_a', 'worker_b', 'independent'), true);
  assert.deepEqual((await query('select payload from ads_analysis_runs'))[0].payload.calls, { plan: 'attempted', independent: 'attempted' });
});

test('jobs claim once and require both runner identity and unguessable token for result writes', async () => {
  const claimed = await stagedJob();
  assert.equal(claimed.status, 'claimed'); assert.equal(claimed.runner_id, 'runner_a');
  assert.equal(await claimJob('runner_b', 'another-unguessable-token'), null);
  await assert.rejects(finishJob(claimed.id, 'runner_b', claimed.claim_token, { state: 'ok' }), /ads_job_stale/);
  await assert.rejects(finishJob(claimed.id, 'runner_a', 'wrong-token', { state: 'ok' }), /ads_job_stale/);
  const finished = await finishJob(claimed.id, 'runner_a', claimed.claim_token, { state: 'ok' });
  assert.equal(finished.status, 'completed');
});

test('same result retry returns original; changed result/error is a conflict; failure retry remains failure', async () => {
  const claimed = await stagedJob(), result = { conclusion: 'Fixture', evidence: [{ factId: 'spend', value: 10 }] };
  const finished = await finishJob(claimed.id, 'runner_a', claimed.claim_token, result);
  assert.deepEqual(await finishJob(claimed.id, 'runner_a', claimed.claim_token, result), finished);
  await assert.rejects(finishJob(claimed.id, 'runner_a', claimed.claim_token, { conclusion: 'Changed' }), /ads_result_conflict/);
  await assert.rejects(finishJob(claimed.id, 'runner_a', claimed.claim_token, result, 'runner_failed'), /ads_result_conflict/);
  const row = await claim(); await save({ ...row.payload, status: 'cross_review' }, 'worker_a', 'independent', job('job_b', 'cross_review'));
  const failedJob = await claimJob();
  const failed = await finishJob(failedJob.id, 'runner_a', failedJob.claim_token, null, 'runner_failed');
  assert.equal(failed.status, 'failed');
  assert.deepEqual(await finishJob(failedJob.id, 'runner_a', failedJob.claim_token, null, 'runner_failed'), failed);
});

test('late results and results for terminal runs cannot finish; expired jobs are not reissued', async () => {
  const claimed = await stagedJob();
  await fixtureAdmin("update ads_analysis_jobs set expires_at=now()-interval '1 second'");
  await assert.rejects(finishJob(claimed.id, 'runner_a', claimed.claim_token, { state: 'ok' }), /ads_job_stale/);
  assert.equal(await claimJob(), null);
  assert.equal((await query('select status from ads_analysis_jobs'))[0].status, 'expired');
  await fixtureAdmin("update ads_analysis_jobs set status='claimed',expires_at=now()+interval '5 minutes'; update ads_analysis_runs set status='failed'");
  await assert.rejects(finishJob(claimed.id, 'runner_a', claimed.claim_token, { state: 'ok' }), /ads_job_stale/);
});

test('anonymous/authenticated roles cannot read/write tables or execute any analysis RPC', async () => {
  await open();
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`reset role; set role ${role}`);
    try {
      for (const table of ['ads_analysis_runs', 'ads_analysis_budget', 'ads_analysis_jobs', 'ads_analysis_notices']) {
        await assert.rejects(query(`select * from ${table}`), /permission denied/);
        await assert.rejects(pg.exec(`delete from ${table}`), /permission denied/);
      }
      for (const call of [() => open(), () => claim(), () => renew(), () => save(run()), () => beginCall(), () => claimJob(),
        () => finishJob('job_a', 'runner_a', '0123456789abcdefghij-token', {}), () => score('run_a', {})]) {
        await assert.rejects(call(), /permission denied/);
      }
    } finally { await pg.exec('reset role; set role erp_server'); }
  }
});

test('score requires completed run aged at least 14 days and persists only the first score', async () => {
  await open(); const value = { state: 'scored', models: { claude: { evaluated: 1, correct: 1 } } };
  assert.equal(await score('run_a', value), false);
  await fixtureAdmin("update ads_analysis_runs set created_at=now()-interval '15 days'");
  assert.equal(await score('run_a', value), false);
  await fixtureAdmin("update ads_analysis_runs set status='completed',created_at=now()-interval '13 days 23 hours'");
  assert.equal(await score('run_a', value), false);
  await fixtureAdmin("update ads_analysis_runs set created_at=now()-interval '14 days 1 second'");
  assert.equal(await score('run_a', value), true);
  assert.equal(await score('run_a', { state: 'changed' }), false);
  assert.deepEqual((await query('select payload from ads_analysis_runs'))[0].payload.score, value);
});
