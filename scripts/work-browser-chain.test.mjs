// Actual React + HTTPS routers + PostgreSQL/PostgREST. Model fixtures only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import net from 'node:net';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const root = process.cwd();
const runId = crypto.randomUUID();
const resultPath = path.join(root, '.codex/work-browser-chain-result.json');
await fs.writeFile(resultPath, JSON.stringify({ status: 'RUNNING', runId }));
let client, postgres, postgrest, browser, api, debugPage, databaseDir;
let result, failure;
const checks = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
const pgBin = process.env.ERP_PG_BIN;
try {
const pgClientModule = process.env.ERP_PG_CLIENT;
assert.ok(pgBin && pgClientModule && path.isAbsolute(pgBin) && path.isAbsolute(pgClientModule), 'Explicit existing PostgreSQL runtime required');
const { Client } = createRequire(import.meta.url)(pgClientModule);
const schemaPath = process.env.ERP_BROWSER_SCHEMA;
assert.ok(schemaPath && path.isAbsolute(schemaPath), 'Explicit schema-only snapshot path required');
let snapshot;
try { snapshot = JSON.parse(await fs.readFile(schemaPath, 'utf8')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const commands = (process.env.ERP_SCHEMA_COMMAND_IDS || '').split(',');
  assert.equal(commands.length, 3, 'Supply three explicit schema-only export command IDs for first snapshot');
  assert.ok(commands.every(command => /^[0-9a-f-]{36}$/.test(command)));
const chunks = commands.map(command => {
  const result = JSON.parse(execFileSync('aws', ['--profile', 'ames-new', '--region', 'ap-northeast-2', 'ssm', 'get-command-invocation',
    '--command-id', command, '--instance-id', 'i-0cf424d627db8b063', '--output', 'json', '--no-cli-pager'], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', AWS_CLI_FILE_ENCODING: 'UTF-8' } }));
  assert.equal(result.Status, 'Success');
  const lines = result.StandardOutputContent.trim().split('\n');
  return { hash: lines[0].slice('SCHEMA_SHA='.length), length: Number(lines[1].slice('SCHEMA_LENGTH='.length)), data: lines[2] };
});
assert.ok(chunks.every(chunk => chunk.hash === chunks[0].hash && chunk.length === chunks[0].length), 'Schema changed between chunks');
const encoded = chunks.map(chunk => chunk.data).join('');
assert.equal(encoded.length, chunks[0].length);
assert.equal(crypto.createHash('sha256').update(encoded).digest('hex'), chunks[0].hash);
  snapshot = { schemaOnly: true, extractedAt: new Date().toISOString(), sourceVersion: process.env.ERP_SCHEMA_SOURCE_VERSION, sha256: chunks[0].hash, encoded };
  assert.match(snapshot.sourceVersion || '', /^[0-9a-f]{40}$/);
  await fs.writeFile(schemaPath, JSON.stringify(snapshot));
}
assert.equal(snapshot.schemaOnly, true);
assert.ok(Number.isFinite(Date.parse(snapshot.extractedAt)));
assert.match(snapshot.sourceVersion || '', /^[0-9a-f]{40}$/);
assert.equal(crypto.createHash('sha256').update(snapshot.encoded).digest('hex'), snapshot.sha256);
const schema = gunzipSync(Buffer.from(snapshot.encoded, 'base64')).toString('utf8');
assert.ok(!/^COPY .* FROM stdin/m.test(schema), 'Rows must never be copied');
const tempRoot = process.env.ERP_BROWSER_TEMP || path.join(root, '.codex');
assert.ok(path.isAbsolute(tempRoot), 'Explicit absolute test temp directory required');
databaseDir = await fs.mkdtemp(path.join(tempRoot, 'erp-browser-db-'));
const password = crypto.randomBytes(24).toString('base64url');
const secret = crypto.randomBytes(48).toString('base64url');
Object.assign(process.env, { ERP_BROWSER_ISOLATED: '20261010', POSTGREST_URL: 'http://127.0.0.1:4192', PGRST_JWT_SECRET: secret,
  ERP_PRIVATE_MODE: 'false', ROOT_DOMAIN: 'localhost:4189', ERP_HOST: 'localhost:4189', PMS_COOKIE_DOMAIN: '',
  ANTHROPIC_API_KEY: 'isolated-fixture-not-real', DAILY_URL: 'http://blocked.invalid' });
for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']) delete process.env[key];
  for (const port of [4189, 4191, 4192]) await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const passwordFile = path.join(databaseDir, 'test-password');
  await fs.writeFile(passwordFile, password + '\n');
  // Native initdb inherits Windows system variables; the installed wrapper drops them.
  // Password file must be outside the data directory which initdb requires to be empty.
  const pgData = path.join(databaseDir, 'data');
  execFileSync(path.join(pgBin, 'initdb.exe'), ['-D', pgData, '-U', 'postgres', '--auth=password', '--pwfile=' + passwordFile,
    '--encoding=UTF8', '--locale=C'], { env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  await fs.unlink(passwordFile);
  postgres = true; // Track attempted start: pg_ctl can time out after creating a live process.
  execFileSync(path.join(pgBin, 'pg_ctl.exe'), ['start', '-D', pgData, '-o', '-p 4191 -h 127.0.0.1', '-w', '-l', path.join(databaseDir, 'postgres.log')],
    { env: process.env, windowsHide: true, stdio: 'ignore' });
  postgres = true;
  for (let i = 0; i < 40; i++) {
    const attempt = new Client({ host: '127.0.0.1', port: 4191, user: 'postgres', password, database: 'postgres' });
    try { await attempt.connect(); client = attempt; break; } catch { await attempt.end(); await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(client, 'Local PostgreSQL not ready');
  const roles = new Set(['anon', 'authenticated', 'service_role', 'erp_server', 'authenticator']);
  for (const match of schema.matchAll(/(?:TO|FROM) ([a-z_][a-z_0-9]*)[;,]/g)) if (!['PUBLIC', 'postgres'].includes(match[1])) roles.add(match[1]);
  for (const role of roles) await client.query('CREATE ROLE "' + role + '" NOLOGIN');
  await client.query(schema);
  await client.query('ALTER ROLE authenticator LOGIN PASSWORD $password$' + password + '$password$');
  for (const role of roles) if (role !== 'authenticator') await client.query('GRANT "' + role + '" TO authenticator');
  // Production pg_auth_members: erp_server inherits anon; schema dump omits role membership.
  await client.query('GRANT anon TO erp_server');
  await client.query('ALTER ROLE authenticator SET pgrst.db_pre_request TO \'\'');
  const empty = await client.query('SELECT count(*)::int AS n FROM public.app_users'); assert.equal(empty.rows[0].n, 0);
  pass('schema_only_empty_database');
  postgrest = spawn(path.join(root, '.codex/postgrest-portable/postgrest.exe'), [], { env: { ...process.env,
    PGRST_DB_URI: `postgres://authenticator:${password}@127.0.0.1:4191/postgres`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: secret, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: '4192' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  postgrest.stderr.on('data', data => { console.error('POSTGREST ' + String(data).replaceAll(password, '[test-password]').slice(0, 600)); });
  let spawnError;
  postgrest.on('error', error => { spawnError = error; });
  let ready = false;
  for (let i = 0; i < 40; i++) { try { const response = await fetch(process.env.POSTGREST_URL); if (response.ok) { ready = true; break; } if (i === 1) console.error('REST_READY_STATUS=' + response.status); } catch (error) { if (i === 1) console.error('REST_READY_ERROR=' + error.message + ' ' + error.cause?.code); } await new Promise(resolve => setTimeout(resolve, 250)); }
  if (spawnError) throw spawnError;
  assert.ok(ready, 'Local PostgREST not ready, exit=' + postgrest.exitCode);
  assert.equal(postgrest.exitCode, null, 'Must use the newly spawned PostgREST');
  const frontend = await build({ stdin: { contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {Toaster} from 'sonner';import {Link,Route,Switch} from 'wouter';
import Login from './client/src/pages/Login';import WorkHub from './client/src/pages/WorkHub';import WorkChatWidget from './client/src/components/WorkChatWidget';
import OperationalCalendar from './client/src/pages/OperationalCalendar';import {WorkspaceProvider} from './client/src/contexts/WorkspaceContext';
import {logout,getCurrentUser} from './client/src/lib/auth';
function App(){const [user,setUser]=useState(getCurrentUser());return <WorkspaceProvider>{!user?<Login onLogin={()=>setUser(getCurrentUser())}/>:<>
<nav><Link href="/work">업무함</Link> <Link href="/calendar">운영 캘린더</Link> <button onClick={()=>{logout();setUser(null)}}>로그아웃</button><span>{user.name}</span></nav>
<main><Switch><Route path="/calendar"><OperationalCalendar/></Route><Route><WorkHub/></Route></Switch></main><WorkChatWidget/></>}<Toaster/></WorkspaceProvider>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);
`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({ PROD: true, VITE_ENABLE_DEMO_SEED: 'false', BASE_URL: '/' }) } });
  const serverFile = path.join(root, '.codex/work-browser-server.cjs');
  await build({ entryPoints: ['scripts/work-browser-server.ts'], outfile: serverFile, bundle: true, platform: 'node', format: 'cjs',
    packages: 'external', loader: { '.html': 'text' }, logLevel: 'silent' });
  const harness = createRequire(import.meta.url)(serverFile);
  api = await harness.start(frontend.outputFiles[0].text, password);
  const privateFile = path.join(root, '.codex/work-browser-private-check.cjs');
  await build({ entryPoints: ['scripts/work-browser-private-check.ts'], outfile: privateFile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const privateResult = execFileSync(process.execPath, [privateFile], { input: password, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, ERP_PRIVATE_MODE: 'true' }, windowsHide: true });
  assert.ok(privateResult.includes('PRIVATE_MODE_HTTP_LOGIN_AND_SESSION_PASS'));
  pass('private_mode_staff_login_and_existing_session_blocked_boss_allowed');
  browser = await puppeteer.launch({ headless: true, acceptInsecureCerts: true,
    args: ['--host-resolver-rules=MAP ceo.localhost 127.0.0.1'] });
  const errors = [];
  const contexts = {};
  async function guardPage(page, name) {
    page.on('response', response => { if (response.url().includes('/rest/v1/campaigns')) console.log('CAMPAIGN_HTTP ' + name + ' ' + response.status()); });
    page.on('requestfailed', request => { if (request.url().includes('/rest/v1/')) console.log('REST_FAILED ' + name + ' ' + request.failure()?.errorText); });
    page.on('pageerror', error => errors.push(name + ': ' + error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (['https://localhost:4189', 'https://ceo.localhost:4189'].includes(url.origin) || url.protocol === 'data:') request.continue();
      else request.abort();
    });
  }
  async function actor(name) {
    const user = harness.users.find(user => user.id === 'e2e_' + name); assert.ok(user);
    const context = await browser.createBrowserContext(); const page = await context.newPage(); contexts[name] = { context, page };
    await guardPage(page, name);
    await page.goto('https://localhost:4189/work?ws=LUMEN');
    await page.waitForSelector('#email'); await page.type('#email', user.email); await page.type('#password', password);
    await page.click('button[type="submit"]'); await page.waitForSelector('button[aria-label="업무 비서 열기"]');
    await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('업무 피드'));
    return page;
  }
  const staff = await actor('staff'), leader = await actor('leader'), marketing = await actor('marketing'), boss = await actor('boss');
  debugPage = staff;
  pass('actual_login_four_separate_browser_sessions');
  async function send(page, text) {
    await page.bringToFront();
    if (!(await page.$('textarea[placeholder^="업무를 한 줄"]'))) await page.click('button[aria-label="업무 비서 열기"]');
    await page.waitForFunction(() => !document.querySelector('textarea[placeholder^="업무를 한 줄"]')?.disabled);
    await page.type('textarea[placeholder^="업무를 한 줄"]', text);
    const response = page.waitForResponse(response => response.url() === 'https://localhost:4189/api/work' && response.request().method() === 'POST');
    await page.click('button[aria-label="보내기"]'); const result = await response; assert.equal(result.status(), 200); return (await result.json()).card;
  }
  const request = await send(staff, harness.inputs.request.text);
  assert.equal(request.assignee_id, 'e2e_leader');
  await leader.reload(); await leader.waitForSelector('main input[placeholder^="답변"]');
  assert.ok(await leader.$('main [aria-label="안 읽음"]'));
  const clickText = (page, text, selector = 'main button') => page.evaluate((text, selector) => {
    const button = [...document.querySelectorAll(selector)].find(button => button.textContent.trim().startsWith(text)); if (!button) throw Error('Missing button: ' + text); button.click();
  }, text, selector);
  await clickText(leader, '확인');
  await leader.waitForFunction(() => !document.querySelector('main [aria-label="안 읽음"]'));
  const readRequest = (await harness.read('work_cards?id=eq.' + request.id + '&select=*'))[0];
  assert.equal(readRequest.status, 'open'); assert.ok(readRequest.read_by.includes('e2e_leader'));
  await leader.type('main input[placeholder^="답변"]', '20%로 진행'); await clickText(leader, '답변');
  await leader.waitForFunction(() => document.querySelector('main')?.textContent.includes('처리할 일이 없습니다'));
  const reply = (await harness.read('work_cards?id=eq.' + request.id + '&select=*'))[0];
  assert.equal(reply.status, 'done'); assert.equal(reply.reply_text, '20%로 진행');
  pass('request_leader_unread_read_reply_persisted');
  const schedule = await send(staff, harness.inputs.schedule.text);
  await staff.click('button[aria-label="닫기"]'); await staff.reload();
  await staff.waitForSelector('main input[placeholder="할인율 %"]');
  await staff.$eval('main input[placeholder="할인율 %"]', input => { input.focus(); input.select(); });
  await staff.keyboard.press('Backspace'); await staff.type('main input[placeholder="할인율 %"]', '20');
  const confirmResponse = staff.waitForResponse(response => response.url().endsWith('/' + schedule.id + '/confirm') && response.request().method() === 'POST');
  await clickText(staff, '캘린더 등록');
  console.log('STEP calendar confirmation clicked');
  const confirmResult = await confirmResponse;
  assert.equal(confirmResult.status(), 200, 'Calendar confirmation: ' + await confirmResult.text());
  console.log('STEP confirmation HTTP 200');
  await staff.waitForFunction(() => !document.querySelector('main input[placeholder="할인율 %"]'), { polling: 100 });
  console.log('STEP schedule form closed');
  const confirmed = (await harness.read('work_cards?id=eq.' + schedule.id + '&select=*'))[0];
  assert.equal(confirmed.confirmed_payload.discountRate, 20); assert.deepEqual(confirmed.shared_teams, ['마케팅', '물류·CS']);
  const campaign = (await harness.read('campaigns?id=eq.' + confirmed.result_ref.id + '&select=*'))[0];
  assert.equal(campaign.discount_rate, 20); assert.equal(campaign.status, 'draft');
  await staff.waitForFunction(() => localStorage.getItem('ames_campaigns')?.includes('E2E W컨셉'), { polling: 100 });
  console.log('STEP campaign cache ready');
  await staff.click('nav a[href="/calendar"]'); await staff.waitForFunction(() => document.querySelector('main')?.textContent.includes('E2E W컨셉'), { polling: 100 });
  console.log('STEP calendar first view loaded');
  await staff.reload(); await staff.waitForFunction(() => document.querySelector('main')?.textContent.includes('E2E W컨셉'));
  pass('corrected_20_percent_calendar_persisted_after_reload');
  await marketing.reload(); await clickText(marketing, '공유받음', 'main button');
  await marketing.waitForFunction(() => document.querySelector('main')?.textContent.includes('E2E_WORK_SCHEDULE_30'));
  assert.ok((await marketing.$eval('main', main => main.textContent)).includes('20%'));
  assert.equal(await marketing.$('main input[placeholder="할인율 %"]'), null);
  const denied = await marketing.evaluate(async id => {
    const response = await fetch('/api/work/' + id + '/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return response.status;
  }, schedule.id);
  assert.equal(denied, 403);
  assert.deepEqual((await harness.read('work_cards?id=eq.' + schedule.id + '&select=*'))[0], confirmed);
  pass('marketing_real_shared_feed_without_edit_authority');
  const question = await send(staff, harness.inputs.question.text);
  assert.ok(question.parsed.answer.includes('20%')); assert.ok(question.parsed.answer.includes('미확인'));
  const savedQuestion = (await harness.read('work_cards?id=eq.' + question.id + '&select=*'))[0]; assert.equal(savedQuestion.parsed.answer, question.parsed.answer);
  pass('question_answer_from_confirmed_evidence_saved');
  const bossTask = await send(boss, harness.inputs.boss.text); assert.equal(bossTask.assignee_id, 'e2e_boss');
  pass('representative_decision_stays_with_representative');
  const cookie = (await contexts.boss.context.cookies()).find(cookie => cookie.name === 'erp_token'); assert.ok(cookie);
  await contexts.boss.context.setCookie({ name: 'erp_token', value: cookie.value, domain: 'ceo.localhost', path: '/', secure: true, httpOnly: true },
    { name: 'ceo_g', value: api.ceoProof, domain: 'ceo.localhost', path: '/', secure: true, httpOnly: true });
  const ceo = await contexts.boss.context.newPage();
  debugPage = ceo;
  await ceo.bringToFront();
  await guardPage(ceo, 'ceo');
  await ceo.goto('https://ceo.localhost:4189/'); await ceo.waitForSelector('a[data-v="map"]'); await ceo.click('a[data-v="map"]');
  await ceo.waitForSelector('.map-node[data-team="마케팅"]');
  await ceo.$eval('.map-node[data-team="마케팅"]', node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await ceo.waitForSelector('button[data-run="마케팅"]');
  const reportResponse = ceo.waitForResponse(response => response.url().endsWith('/api/ceo/agents/run') && response.request().method() === 'POST');
  await ceo.click('button[data-run="마케팅"]'); assert.equal((await reportResponse).status(), 200);
  await ceo.waitForFunction(() => document.querySelector('#view')?.textContent.includes('10/20 확정 20%'));
  const reports = await harness.read('team_agent_runs?team=eq.' + encodeURIComponent('마케팅') + '&select=*');
  assert.equal(reports.length, 1); assert.ok(reports[0].summary.includes('미확인'));
  await ceo.reload();
  await ceo.waitForSelector('.map-node[data-team="마케팅"]');
  await ceo.$eval('.map-node[data-team="마케팅"]', node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await ceo.waitForFunction(() => document.querySelector('#view')?.textContent.includes('10/20 확정 20%'), { polling: 100 });
  await ceo.screenshot({ path: path.join(root, '.codex/work-browser-report-20261010.jpg'), type: 'jpeg' });
  pass('actual_ceo_screen_manual_report_stored_reload');
  assert.deepEqual(harness.calls, { classify: 4, answer: 1, report: 1 });
  for (const table of ['production_orders', 'trade_statements', 'settlements', 'payables']) assert.equal((await harness.read(table + '?select=id')).length, 0);
  assert.deepEqual(errors, []);
  pass('no_financial_rows_no_browser_runtime_errors');
  result = { status: 'PASS', runId, checks, model: 'fixed fixtures, not live intelligence', authentication: 'real test account login; CEO proof test-signed, not Google OAuth',
    schemaSnapshot: { extractedAt: snapshot.extractedAt, sourceVersion: snapshot.sourceVersion, sha256: snapshot.sha256 },
    frontend: 'actual Login/WorkHub/WorkChatWidget/OperationalCalendar/CEO console; test wrapper instead of full ERP shell',
    database: 'real local PostgreSQL and PostgREST 12.2.12; production schema only, no company rows', financialWrites: 0,
    limits: ['No real Google OAuth', 'No scheduler', 'No live model', 'No production browser writes', 'No 25-user browser load test'], calls: harness.calls };
} catch (error) {
  failure = error;
  console.error('BROWSER_CHAIN_FAILED: ' + error.message);
  if (debugPage) {
    let timer;
    try {
      const state = await Promise.race([debugPage.evaluate(() => ({ url: location.href, text: document.querySelector('main')?.textContent, campaigns: localStorage.getItem('ames_campaigns') })),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('diagnostic timeout')), 2000); })]);
      console.log('TEST_STATE=' + JSON.stringify(state));
    } catch { /* Diagnostics must never delay service cleanup. */ }
    finally { clearTimeout(timer); }
  }
} finally {
  const cleanupErrors = [];
  const killOwned = child => {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    }
  };
  const clean = async (name, fn, force) => {
    let timer;
    try { await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('cleanup timeout')), 10000); })]); }
    catch (error) { cleanupErrors.push(name + ': ' + error.message); try { if (force) force(); } catch (forced) { cleanupErrors.push(name + ' force: ' + forced.message); } }
    finally { clearTimeout(timer); }
  };
  if (browser) await clean('browser', () => browser.close(), () => killOwned(browser.process()));
  if (api) await clean('api', async () => { try { api.server.closeAllConnections(); await new Promise(resolve => api.server.close(resolve)); } finally { api.restore(); } });
  if (postgrest && postgrest.exitCode === null && postgrest.signalCode === null) await clean('postgrest', () => new Promise(resolve => {
    postgrest.once('exit', resolve); postgrest.kill();
  }), () => killOwned(postgrest));
  if (client) await clean('client', () => client.end());
  if (postgres) await clean('postgres', async () => {
    try { execFileSync(path.join(pgBin, 'pg_ctl.exe'), ['status', '-D', path.join(databaseDir, 'data')], { windowsHide: true, stdio: 'ignore', timeout: 2000 }); }
    catch (error) { if (error.status === 3) return; throw error; }
    execFileSync(path.join(pgBin, 'pg_ctl.exe'), ['stop', '-D', path.join(databaseDir, 'data'), '-m', 'fast', '-w'], { windowsHide: true, stdio: 'ignore', timeout: 8000 });
  }, () => execFileSync(path.join(pgBin, 'pg_ctl.exe'), ['stop', '-D', path.join(databaseDir, 'data'), '-m', 'immediate', '-w'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }));
  if (failure || cleanupErrors.length || !result) {
    await fs.writeFile(resultPath, JSON.stringify({ status: 'FAIL', runId, checks, error: failure?.message, cleanupErrors }, null, 2));
    process.exitCode = 1;
  } else {
    result.cleanup = 'all local services stopped';
    await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
  console.log(cleanupErrors.length ? 'LOCAL_CLEANUP_FAILED' : 'ISOLATED_LOCAL_SERVICES_STOPPED');
  if (cleanupErrors.length) process.exit(1);
}
