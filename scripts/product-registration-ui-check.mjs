// Local component QA only. Every API request is mocked, all non-local requests blocked.
import { createServer as createHttpServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const artifact = path.join(root, '.impeccable/review');
await mkdir(artifact, { recursive: true });
const vite = await createServer({ configFile: false, root: path.join(root, 'client'), envFile: false,
  plugins: [react(), tailwind()], resolve: { alias: { '@': path.join(root, 'client/src'), '@shared': path.join(root, 'shared') } },
  server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>상품 등록 모의 검증</title></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import Page from '/src/pages/ProductRegistration.tsx'; import {WorkspaceProvider} from '/src/contexts/WorkspaceContext.tsx'; import '/src/index.css';
localStorage.setItem('erp_workspace','LUMEN');
createRoot(document.getElementById('root')).render(React.createElement(WorkspaceProvider,null,React.createElement(Page)));
</script></body></html>`;
const http = createHttpServer(async (req, res) => {
  if (req.url?.startsWith('/__registration_qa')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(await vite.transformIndexHtml(req.url, html));
  } else vite.middlewares(req, res, () => { res.statusCode = 404; res.end(); });
});
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const port = http.address().port;
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.QA_BROWSER_PATH || await puppeteer.executablePath(), args: ['--no-sandbox'] });
const page = await browser.newPage(); const errors = [];
page.on('pageerror', e => errors.push(e.message));
const permissions = { allowed: true, can_edit: true, can_approve: true, can_manage_settings: true, user_id: 'synthetic-reviewer' };
const items = [{ id: 'synthetic-item', style_no: 'SYNTHETIC-ONLY', name: '검증용 가방', workspace: 'LUMEN', brand: 'LUMEN' }];
const apiCalls = [];
await page.setRequestInterception(true);
page.on('request', request => {
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/')) {
    apiCalls.push({ method: request.method(), path: url.pathname });
    const response = url.pathname.endsWith('/access') ? permissions : url.pathname.endsWith('/items') ? { items }
      : url.pathname.endsWith('/settings') ? { id: 'default', approver_ids: [], filter_mappings: {}, category_mappings: {} }
      : { listings: [], permissions, connections: { cafe24: { connected: false }, shopify: { connected: false } }, settings: {} };
    void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  } else if (url.hostname === '127.0.0.1' && Number(url.port) === port || url.protocol === 'data:') void request.continue();
  else void request.abort();
});
const checks = [];
try {
  await page.goto(`http://127.0.0.1:${port}/__registration_qa`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('상품 등록') && !document.body.innerText.includes('불러오는 중'));
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 1000 });
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      const label = `${width === 1440 ? 'desktop' : 'mobile'}${dark ? '-dark' : ''}`;
      await page.screenshot({ path: path.join(artifact, `${label}.png`), fullPage: true });
      const sizes = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(sizes.scroll <= sizes.viewport + 1, `${label}: horizontal overflow`); checks.push(`${label}: list no overflow`);
    }
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(b => /새 등록|새 상품|등록 시작/.test(b.innerText)); if (!button) throw Error('new registration button missing'); button.click(); });
  await page.waitForFunction(() => document.querySelector('select') && document.body.innerText.includes('임시저장'));
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 1000 });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.screenshot({ path: path.join(artifact, width === 1440 ? 'editor-desktop.png' : 'editor-mobile.png'), fullPage: true });
    const sizes = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(sizes.scroll <= sizes.viewport + 1, `editor ${width}: horizontal overflow`); checks.push(`editor ${width}: no overflow`);
  }
  assert.deepEqual(errors, []);
  assert.ok(apiCalls.length && apiCalls.every(c => c.method === 'GET'), 'QA must not issue channel/DB writes');
  const report = { mockOnly: true, externalRequestsBlocked: true, checks, errors, apiCalls };
  await writeFile(path.join(artifact, 'product-registration-ui-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); await vite.close(); await new Promise(resolve => http.close(resolve)); }
