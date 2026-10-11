// Synthetic-only reviewer evidence. All API responses are intercepted; no live writes.
import { createServer as createHttpServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { emptyListing } from '@shared/product-registration';

const root = process.cwd(), artifact = resolve(root, '.impeccable/review');
const populatedOnly = process.argv.includes('--populated-only');
await mkdir(artifact, { recursive: true });
const vite = await createServer({ configFile: false, root: resolve(root, 'client'), envFile: false,
  plugins: [react(), tailwind()], resolve: { alias: { '@': resolve(root, 'client/src'), '@shared': resolve(root, 'shared') } },
  server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from "react";import {createRoot} from "react-dom/client";import Page from "/src/pages/ProductRegistration.tsx";import {WorkspaceProvider} from "/src/contexts/WorkspaceContext.tsx";import "/src/index.css";localStorage.setItem("erp_workspace","LUMEN");createRoot(document.getElementById("root")).render(React.createElement(WorkspaceProvider,null,React.createElement(Page)));</script></body></html>';
const server = createHttpServer(async (req, res) => {
  if (req.url?.startsWith('/__registration_qa')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(await vite.transformIndexHtml(req.url, html)); }
  else vite.middlewares(req, res, () => { res.statusCode = 404; res.end(); });
});
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('local QA server unavailable');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage(), errors: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error instanceof Error ? error.message : String(error)));
const permissions = { allowed: true, can_edit: true, can_approve: true, can_manage_settings: true, user_id: 'synthetic-reviewer' };
const item = { id: 'synthetic-item', style_no: 'SYNTHETIC-ONLY', name: 'SYNTHETIC BAG', season: '26FW', colors: ['BLACK'], base_cost_krw: 100, workspace: 'LUMEN' };
const listing = { ...emptyListing(item.id), id: 'pl_synthetic_review', created_by: 'synthetic-writer', edited_by: 'synthetic-writer', item,
  sku: item.style_no, style_name: item.name, color_en: 'BLACK', season: item.season, name_en: 'SYNTHETIC BAG (BLACK)', name_ko: 'SYNTHETIC BAG (BLACK)', price_krw: 1000, price_usd: 10,
  material: 'COW_LEATHER', color: 'BLACK', size: 'MEDIUM', design: 'SHOULDER', validation: { issues: [
    { field: 'desc_en', message: '모의 검증: EN 설명을 확인하세요.', severity: 'error' },
    { field: 'images', message: '모의 검증: 권장 3:4 비율을 확인하세요.', severity: 'warning' },
  ] } };
const images = [0, 1, 2].map(position => ({ id: `synthetic-image-${position}`, listing_id: listing.id, position, role: position ? 'extra' : 'main', width: 750, height: 1000, alt_ko: `모의 이미지 ${position + 1}`, alt_en: `Synthetic image ${position + 1}`,
  source_url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1000"><rect width="750" height="1000" fill="#eeeeee"/><text x="375" y="500" text-anchor="middle" font-size="36" fill="#333333">SYNTHETIC IMAGE ${position + 1}</text></svg>`)}` }));
const apiCalls: { method: string; path: string }[] = [];
await page.setRequestInterception(true);
page.on('request', request => {
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/')) {
    apiCalls.push({ method: request.method(), path: url.pathname });
    const response = url.pathname.endsWith('/access') ? permissions : url.pathname.endsWith('/items') ? { items: [item] }
      : url.pathname.endsWith('/settings') ? { settings: { id: 'default', approver_ids: [], filter_mappings: {}, category_mappings: {} } }
      : url.pathname.endsWith(`/${listing.id}`) ? { listing, images }
      : { listings: [], permissions, connections: { cafe24: { connected: false }, shopify: { connected: false } }, settings: {} };
    void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  } else void (url.origin === origin || url.protocol === 'data:' ? request.continue() : request.abort());
});
async function capture(filename: string, width: number, dark = false) {
  await page.setViewport({ width, height: 1000 });
  await page.evaluate(dark => { document.documentElement.classList.toggle('dark', dark); window.scrollTo(0, 0); }, dark);
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width + 1, `${filename}: horizontal overflow`);
  await page.screenshot({ path: resolve(artifact, filename), fullPage: true }); checks.push(`${filename}: no overflow`);
}
try {
  await page.goto(`${origin}/__registration_qa`, { waitUntil: 'networkidle0' });
  if (!populatedOnly) {
  for (const [name, width, dark] of [['desktop', 1440, false], ['desktop-dark', 1440, true], ['mobile', 390, false], ['mobile-dark', 390, true]] as const) await capture(`${name}.png`, width, dark);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '새 등록')?.click());
  await page.waitForSelector('#field-item_id');
  assert.ok(await page.evaluate(() => document.body.textContent?.includes(' · 저장 전')));
  assert.equal(await page.evaluate(() => document.body.textContent?.includes(' · 저장됨')), false);
  await capture('editor-desktop.png', 1440); await capture('editor-mobile.png', 390);
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="모바일 등록 작업"] button')].find(button => button.textContent?.trim() === '검증')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForFunction(() => document.querySelector('[aria-label="모바일 등록 작업"]')?.textContent?.includes('검증 결과'));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '결과로 이동')?.click());
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'validation-results'); checks.push('mobile validation count + jump: pass');
  assert.ok(await page.$eval('#preview-scroll-hint', element => (element as HTMLElement).offsetParent !== null)); checks.push('mobile Shopify horizontal scroll hint: pass');
  }
  await page.goto(`${origin}/__registration_qa?listing=${listing.id}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#field-images img');
  await page.evaluate(() => { document.querySelectorAll<HTMLImageElement>('#field-images img').forEach(image => { image.loading = 'eager'; }); });
  await page.waitForFunction(() => document.querySelectorAll('#field-images img').length === 3 && [...document.querySelectorAll<HTMLImageElement>('#field-images img')].every(image => image.complete && image.naturalWidth > 0));
  await capture('editor-populated-desktop.png', 1440); await capture('editor-populated-mobile.png', 390);
  assert.ok(await page.$eval('[aria-label="모바일 등록 작업"]', element => element.textContent?.includes('검증 결과 2건')));
  assert.deepEqual(errors, []); assert.ok(apiCalls.every(call => call.method === 'GET'));
  const report = { mockOnly: true, externalRequestsBlocked: true, checks, errors, apiCalls };
  await writeFile(resolve(artifact, 'product-registration-ui-fix-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  console.log(JSON.stringify({ errors, apiCalls, diagnostic: await page.evaluate(() => ({ text: document.body.innerText.slice(0, 600), images: [...document.querySelectorAll<HTMLImageElement>('#field-images img')].map(image => ({ complete: image.complete, width: image.naturalWidth, src: image.src.slice(0, 100) })) })) }));
  throw error;
} finally { await browser.close(); await vite.close(); await new Promise<void>(done => server.close(() => done())); }
