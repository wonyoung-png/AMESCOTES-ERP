import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import puppeteer from 'puppeteer';
import { emptyListing, type Listing } from '@shared/product-registration';

test('real page uses mocked canonical API: stable create retry, master color, deep link, settings, KST schedule and workspace boundary', async () => {
  const root = process.cwd();
  const vite = await createServer({ configFile: false, root: resolve(root, 'client'), envFile: false, plugins: [react(), tailwind()],
    resolve: { alias: { '@': resolve(root, 'client/src'), '@shared': resolve(root, 'shared') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from "react";import {createRoot} from "react-dom/client";import Page from "/src/pages/ProductRegistration.tsx";import {WorkspaceProvider} from "/src/contexts/WorkspaceContext.tsx";import "/src/index.css";createRoot(document.getElementById("root")).render(React.createElement(WorkspaceProvider,null,React.createElement(Page)));</script></body></html>';
  const server = createHttpServer(async (req, res) => {
    if (req.url?.startsWith('/__workflow')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(await vite.transformIndexHtml(req.url, html)); }
    else vite.middlewares(req, res, () => { res.statusCode = 404; res.end(); });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('local fixture server unavailable');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let listing: Listing | null = null;
  let createAttempts = 0;
  let queuedReads = 0;
  let settings: Record<string, unknown> = { id: 'default', approver_ids: ['synthetic-reviewer'], filter_mappings: {}, category_mappings: {} };
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const permission = { allowed: true, can_edit: true, can_approve: true, can_manage_settings: true, user_id: 'synthetic-reviewer' };
  const item = { id: 'synthetic-item', style_no: 'TEST-SKU', name: 'TEST BAG', season: '26FW', colors: [{ name: 'BLACK' }, { name: 'BROWN' }], base_cost_krw: 100 };
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) { void (url.origin === origin || url.protocol === 'data:' ? request.continue() : request.abort()); return; }
    try {
      assert.equal(request.headers()['x-workspace'], 'LUMEN');
      const body = request.postData() ? JSON.parse(request.postData()!) : {};
      calls.push({ path: url.pathname, method: request.method(), body });
      const path = url.pathname.replace('/api/product-registration', '');
      let data: unknown;
      let status = 200;
      if (path === '/access') data = permission;
      else if (path === '/items') data = { items: [item] };
      else if (path === '/monitor/settings') data = { monitor_enabled: true, daily_time: '09:00', weekly_time: '09:30', weekly_day: 1 };
      else if (path === '/settings') { if (request.method() === 'PATCH') settings = { ...settings, ...body }; data = { settings }; }
      else if (path === '' && request.method() === 'POST') {
        createAttempts++;
        assert.match(body.id, /^pl_[a-zA-Z0-9_-]{8,100}$/);
        for (const key of ['sku', 'style_name', 'supply_price', 'season', 'approved_by', 'status']) assert.equal(key in body, false, key);
        assert.equal(body.color_en, 'BLACK');
        listing ||= { ...emptyListing(item.id), ...body, id: body.id, sku: item.style_no, style_name: item.name, season: item.season, supply_price: item.base_cost_krw, created_by: permission.user_id, item };
        assert.equal(body.id, listing.id);
        if (createAttempts === 1) { status = 503; data = { error: 'create_outcome_unknown' }; } else data = { listing, images: [] };
      } else if (path.endsWith('/schedule')) {
        assert.ok(listing); assert.equal(body.revision, listing!.revision);
        assert.equal(body.publish_at, '2099-10-12T09:30:00+09:00');
        listing = { ...listing!, status: '예약됨', publish_at: body.publish_at as string }; data = { listing };
      } else if (path.endsWith('/reapply')) {
        assert.ok(listing); assert.equal(body.revision, listing!.revision); assert.equal(body.confirm, true); assert.equal(body.approval_evidence, 'synthetic-evidence');
        listing = { ...listing!, validation: { queued: true, operation: 'sync' } }; data = { listing, queued: true }; status = 202;
      } else if (path === '') data = { listings: listing ? [listing] : [], permissions: permission, connections: {}, settings };
      else if (listing && path === `/${listing.id}` && request.method() === 'GET') {
        if ((listing.validation as { queued?: boolean } | undefined)?.queued) { queuedReads++; listing = { ...listing, validation: { queued: false, operation: 'sync' } }; }
        data = { listing, images: [] };
      }
      else throw new Error(`unexpected mock API ${request.method()} ${path}`);
      void request.respond({ status, contentType: 'application/json', body: JSON.stringify(data) });
    } catch (error) { errors.push(String(error)); void request.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_assertion_failed' }) }); }
  });
  async function button(text: string) {
    await page.evaluate(text => { const element = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === text && button.offsetParent !== null && !button.disabled); if (!element) throw new Error(`enabled button not found: ${text}`); element.click(); }, text);
  }
  try {
    await page.evaluateOnNewDocument(() => { if (!localStorage.getItem('erp_workspace')) localStorage.setItem('erp_workspace', 'LUMEN'); });
    page.on('dialog', dialog => { void dialog.accept(); });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${origin}/__workflow`, { waitUntil: 'networkidle0' });
    await button('새 등록');
    assert.equal(await page.evaluate(() => document.body.textContent?.includes(' · 저장됨')), false);
    assert.ok(await page.evaluate(() => document.body.textContent?.includes(' · 저장 전')));
    await page.select('#field-item_id', item.id); await page.select('#field-color_en', 'BLACK');
    await page.type('#field-name_ko', 'TEST BAG (BLACK)'); await page.type('#field-name_en', 'TEST BAG (BLACK)');
    await button('임시저장'); await page.waitForFunction(() => document.body.textContent?.includes('create_outcome_unknown'));
    await button('임시저장'); await page.waitForFunction(() => document.body.textContent?.includes(' · 저장됨'));
    assert.equal(createAttempts, 2);
    const savedId = listing!.id;
    listing = { ...listing!, validation: { issues: [{ field: 'desc_en', message: 'synthetic description issue', severity: 'error' }] } };
    await page.goto(`${origin}/__workflow?listing=${encodeURIComponent(savedId)}`, { waitUntil: 'networkidle0' });
    assert.ok(calls.some(call => call.path === `/api/product-registration/${savedId}` && call.method === 'GET'));
    await page.setViewport({ width: 390, height: 1000 });
    assert.ok(await page.$eval('[aria-label="모바일 등록 작업"]', element => element.textContent?.includes('검증 결과 1건')));
    assert.ok(await page.$eval('#preview-scroll-hint', element => (element as HTMLElement).offsetParent !== null && element.textContent?.includes('Shopify')));
    await button('결과로 이동');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'validation-results');
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('synthetic description issue')); if (!button) throw new Error('persisted validation issue missing'); button.click(); });
    assert.deepEqual(await page.evaluate(() => ({ active: document.activeElement?.id, open: document.getElementById('field-desc_en')?.closest('details')?.open })), { active: 'field-desc_en', open: true });
    listing = { ...listing!, validation: {}, status: '승인', created_by: 'another-author', edited_by: 'another-author', approved_revision: listing!.revision, approved_by: permission.user_id, approval_evidence: 'synthetic-evidence', cafe24_product_no: 1, shopify_product_id: 'gid://shopify/Product/1' };
    await page.goto(`${origin}/__workflow?listing=${encodeURIComponent(savedId)}`, { waitUntil: 'networkidle0' });
    await button('승인한 ERP 값 재반영');
    await page.waitForFunction(() => document.body.textContent?.includes('채널 반영 대기'));
    await page.waitForFunction(() => !document.body.textContent?.includes('채널 반영 대기'), { timeout: 15000 });
    assert.equal(queuedReads, 1); assert.equal(calls.filter(call => call.path.endsWith('/reapply')).length, 1);
    await page.evaluate(() => { const input = document.getElementById('field-publish_at') as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2099-10-12T09:30'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    await button('예약'); await page.waitForFunction(() => document.body.textContent?.includes('예약됨'));
    await button('설정'); await page.waitForSelector('#setting-approvers');
    assert.equal(await page.$eval('#setting-approvers', element => (element as HTMLInputElement).value), 'synthetic-reviewer');
    assert.ok(await page.$('input[aria-label$="Shopify 참조"]'));
    await page.select('#setting-mapping-group', 'size');
    assert.equal(await page.$('input[aria-label$="Shopify 참조"]'), null);
    assert.ok(await page.evaluate(() => document.body.textContent?.includes('Shopify는 ERP 사이즈 마스터를 사용')));
    const sizeCheck = await page.$('#setting-mapping-group ~ div input[type="checkbox"]');
    assert.ok(sizeCheck); assert.equal(await sizeCheck.evaluate(element => (element as HTMLInputElement).disabled), false);
    await sizeCheck.click();
    await button('승인자 · 매핑 저장'); await page.waitForFunction(() => !document.body.textContent?.includes('설정 저장 중'));
    const settingsCall = calls.find(call => call.path.endsWith('/settings') && call.method === 'PATCH');
    assert.ok(settingsCall); assert.ok('filter_mappings' in settingsCall.body); assert.equal('channel_mappings' in settingsCall.body, false);
    const sizeMappings = (settingsCall.body.filter_mappings as Record<string, Record<string, { cafe24: string; verified: boolean; shopify_ref?: string }>>).size;
    assert.deepEqual(sizeMappings.MINI, { cafe24: 'MINI', verified: true });
    await page.evaluate(() => localStorage.setItem('erp_workspace', 'OEM')); calls.length = 0;
    await page.goto(`${origin}/__workflow?listing=${encodeURIComponent(savedId)}`, { waitUntil: 'networkidle0' });
    assert.ok(await page.evaluate(() => document.body.textContent?.includes('LUMEN 워크스페이스'))); assert.equal(calls.length, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await vite.close(); await new Promise<void>(done => server.close(() => done())); }
});
