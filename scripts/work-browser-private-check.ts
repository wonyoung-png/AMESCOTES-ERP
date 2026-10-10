// Fresh process: production session router's private-mode constant must load as true.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import express from 'express';
import sessionRouter from '../server/session';
import { signJwt } from '../server/auth';
assert.equal(process.env.ERP_BROWSER_ISOLATED, '20261010');
assert.equal(process.env.ERP_PRIVATE_MODE, 'true');
assert.equal(process.env.POSTGREST_URL, 'http://127.0.0.1:4192');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.origin, process.env.POSTGREST_URL);
  return nativeFetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
}) as typeof fetch;
async function main() {
  const password = fs.readFileSync(0, 'utf8');
  const app = express(); app.use(express.json()); app.use(sessionRouter);
  const server = https.createServer({ key: fs.readFileSync('.codex/browser-test-key.pem'), cert: fs.readFileSync('.codex/browser-test-cert.pem') }, app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (path: string, body?: object, cookie?: string): Promise<{ status: number; value: any }> => new Promise((resolve, reject) => {
    const request = https.request({ hostname: '127.0.0.1', port: address.port, path, method: body ? 'POST' : 'GET', rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(5000) }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode!, value: JSON.parse(text) }));
    }); request.on('error', reject); request.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    assert.equal((await call('/api/login', { email: 'e2e-staff@test.invalid', password })).status, 403);
    const staffToken = signJwt({ role: 'anon', email: 'e2e-staff@test.invalid', exp: Math.floor(Date.now() / 1000) + 600 });
    const blockedSession = await call('/api/session', undefined, 'erp_token=' + staffToken);
    assert.equal(blockedSession.status, 401);
    assert.equal(blockedSession.value.error, 'no_session');
    const boss = await call('/api/login', { email: 'wonyoung@atlm.kr', password }); assert.equal(boss.status, 200);
    assert.equal((await call('/api/session', undefined, 'erp_token=' + boss.value.token)).status, 200);
    console.log('PRIVATE_MODE_HTTP_LOGIN_AND_SESSION_PASS');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); globalThis.fetch = nativeFetch; }
}
main().catch(error => { console.error('PRIVATE_MODE_CHECK_FAILED: ' + error.message); process.exitCode = 1; });
