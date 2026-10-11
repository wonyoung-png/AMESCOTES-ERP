import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { emptyListing, FILTER_CODES, type Listing, type ListingImage } from '../shared/product-registration.js';
import { createMonitorReader } from './channels/monitor.js';
import { buildMonitorReport, createShopMonitor, createShopMonitorRouter, DEFAULT_MONITOR_SETTINGS, descriptionHash,
  dueMonitorSlots, inspectListing, listingFromRow, monitorImageHead, validMonitorSettings,
  type ChannelSnapshot, type MonitorIO, type MonitorScan, type MonitorSlot, type SavedIssue } from './shop-monitor.js';

const now = new Date('2026-10-12T01:00:00Z'); // Monday 10:00 KST
const DAY = 864e5;
const slot: MonitorSlot = { id: 'shop_weekly_2026-10-12', schedule_id: 'shop_weekly', run_date: '2026-10-12', mode: 'weekly' };
const listing = (overrides: Partial<Listing> = {}): Listing => ({ ...emptyListing(), id: 'listing_one', status: '공개됨',
  item_id: 'item_one', created_by: 'md', sku: 'LOG', style_name: 'LOG MIDDLE', color_en: 'BROWN',
  name_ko: 'LOG MIDDLE (BROWN)', name_en: 'LOG MIDDLE (BROWN)', price_krw: 1000, price_usd: 10,
  detail_html_ko: '<p>설명</p>', desc_en: '<p>Description</p>', desc_ja: '説明', details_ja: '製品情報',
  cafe24_category_nos: [13, 14], shopify_collection_ids: ['collection_one'],
  material: 'COW_LEATHER', color: 'BROWN', size: 'MEDIUM', design: 'SHOULDER',
  meta_title_ko: '상품 제목', meta_desc_ko: '상품 설명', meta_title_en: 'Product title', meta_desc_en: 'Product description',
  cafe24_product_no: 123, shopify_product_id: 'gid://shopify/Product/123', ...overrides });
const images = (): ListingImage[] => ['main', 'extra', 'extra'].map((role, position) => ({ id: 'image_' + position,
  listing_id: 'listing_one', position, role: role as ListingImage['role'], source_url: 'https://cdn.shopify.com/image' + position + '.png',
  width: 300, height: 400, alt_en: 'Product', alt_ko: '상품' }));
function snapshot(channel: 'cafe24' | 'shopify', l = listing()): ChannelSnapshot {
  const filters = { material: ['verified_material'], color: ['verified_color'], size: ['verified_size'], design: ['verified_design'] };
  return { state: 'ok', checked: ['name', 'price', 'description', 'image_count', 'categories', 'filters', 'seo_title', 'seo_description', 'images', 'ja', 'publication'],
    name: l.name_en, price: channel === 'cafe24' ? l.price_krw : l.price_usd,
    description: channel === 'cafe24' ? l.detail_html_ko : l.desc_en, image_count: 3,
    categories: channel === 'cafe24' ? l.cafe24_category_nos : l.shopify_collection_ids, filters,
    seo_title: channel === 'cafe24' ? l.meta_title_ko : l.meta_title_en,
    seo_description: channel === 'cafe24' ? l.meta_desc_ko : l.meta_desc_en,
    images: [{ url: 'https://cdn.shopify.com/image.png', alt: 'Product', status: 200 }], page_status: 200,
    active: true, online_store_published: true, ja_description: '説明', ja_details: '製品情報',
    inventory: channel === 'cafe24' ? 3 : 700, expected: { filters } };
}
function memoryIO(overrides: Partial<MonitorIO> = {}) {
  const claims = new Map<string, { owner: string; complete: boolean }>();
  const saved: any[] = [], attempts: string[] = [], failures: string[] = [];
  const io: MonitorIO = {
    settings: async () => ({ ...DEFAULT_MONITOR_SETTINGS }),
    load: async () => ({ listings: [listing()], images: images(), previous: [] }),
    read: async (l, c) => snapshot(c, l), head: async () => 200,
    claim: async (s, owner) => { attempts.push(s.id); if (claims.has(s.id)) return false; claims.set(s.id, { owner, complete: false }); return true; },
    finish: async (s, owner, scan, report) => {
      assert.equal(claims.get(s.id)?.owner, owner); assert.equal(claims.get(s.id)?.complete, false);
      claims.set(s.id, { owner, complete: true }); saved.push({ scan, report }); return true;
    },
    fail: async (s, owner) => { assert.equal(claims.get(s.id)?.owner, owner); failures.push(s.id); claims.delete(s.id); }, ...overrides,
  };
  return { io, claims, saved, attempts, failures };
}

test('Shopify size has no custom-reference field in FIELDS v1 and cannot create a false missing mapping alert', () => {
  const s = snapshot('shopify');
  delete s.filters!.size;
  delete s.expected!.filters!.size;
  const scan = inspectListing(listing(), images(), { cafe24: snapshot('cafe24'), shopify: s }, 'weekly', now);
  assert.equal(scan.issues.some(i => i.kind === 'shopify:filter_mapping_size' || i.kind === 'shopify:filter_size'), false);
  assert.ok(scan.checked.kinds.includes('shopify:filter_mapping_size'));
});

test('edited previously-public listings remain in daily actual-publication monitoring while reapproval is pending', async () => {
  const draft = listing({ status: '작성중', validation: { previously_public: true } });
  const reads: string[] = [];
  const f = memoryIO({ load: async () => ({ listings: [draft], images: images(), previous: [] }),
    read: async (l, channel) => { reads.push(channel); return { ...snapshot(channel, l), active: false, online_store_published: false }; } });
  await createShopMonitor(f.io).manual('daily', 'review_pending_public', now);
  assert.deepEqual(reads.sort(), ['cafe24', 'shopify']);
  assert.ok(f.saved[0].scan.issues.some((i: any) => i.kind === 'cafe24:publication_error'));
  assert.ok(f.saved[0].scan.issues.some((i: any) => i.kind === 'shopify:publication_error'));
});

test('KST schedules latest missed daily/weekly once, deterministic IDs, CEO settings validation', () => {
  assert.deepEqual(dueMonitorSlots(DEFAULT_MONITOR_SETTINGS, now).map(s => s.id), ['shop_daily_2026-10-12', 'shop_weekly_2026-10-12']);
  assert.deepEqual(dueMonitorSlots(DEFAULT_MONITOR_SETTINGS, new Date('2026-10-12T00:20:00Z')).map(s => s.id), ['shop_daily_2026-10-12', 'shop_weekly_2026-10-05']);
  assert.deepEqual(dueMonitorSlots(DEFAULT_MONITOR_SETTINGS, new Date('2026-10-11T23:59:00Z')).map(s => s.id), ['shop_daily_2026-10-11', 'shop_weekly_2026-10-05']);
  assert.equal(dueMonitorSlots({ ...DEFAULT_MONITOR_SETTINGS, monitor_enabled: false }, now).length, 0);
  assert.equal(validMonitorSettings({ ...DEFAULT_MONITOR_SETTINGS, weekly_day: 7 }), false);
  assert.equal(validMonitorSettings({ ...DEFAULT_MONITOR_SETTINGS, daily_time: '9:00' }), false);
  assert.equal(validMonitorSettings({ ...DEFAULT_MONITOR_SETTINGS, monitor_enabled: 'true' }), false);
  assert.equal(dueMonitorSlots({ ...DEFAULT_MONITOR_SETTINGS, weekly_time: '25:00' }, now).length, 0);
});
test('real columns override forged payload approval/source/status fields', () => {
  const row = listingFromRow({ id: 'real', item_id: 'realitem', status: '작성중', payload: { id: 'forged', status: '공개됨', price_usd: 10 } });
  assert.equal(row.id, 'real'); assert.equal(row.status, '작성중'); assert.equal(row.item_id, 'realitem'); assert.equal(row.price_usd, 10);
});
test('same registered facts have no drift, channel inventory/origin independence', () => {
  const out = inspectListing(listing({ cafe24_qty: 3, shopify_qty: 700, origin_cafe24: 'CN', origin_shopify: 'KR' }), images(),
    { cafe24: snapshot('cafe24'), shopify: snapshot('shopify') }, 'weekly', now);
  assert.deepEqual(out.issues, []);
  assert.equal(descriptionHash('abc\r\n'), descriptionHash('abc\n'));
});
test('diffs name/price/description/image count/categories/filter/SEO detected without storing raw provider values', () => {
  const remote = snapshot('cafe24');
  Object.assign(remote, { name: 'secret_token_name', price: 2, description: 'private-description', image_count: 1, categories: [999], filters: {}, seo_title: '', seo_description: '' });
  const out = inspectListing(listing(), images(), { cafe24: remote, shopify: snapshot('shopify') }, 'weekly', now);
  for (const field of ['name', 'price', 'description', 'image_count', 'categories', 'seo_title', 'seo_description']) assert.ok(out.issues.some(i => i.kind === 'cafe24:drift_' + field), field);
  for (const field of ['material', 'color', 'size', 'design']) assert.ok(out.issues.some(i => i.kind === 'cafe24:filter_' + field));
  assert.ok(out.issues.some(i => i.kind === 'cafe24:missing_seo_title'));
  assert.doesNotMatch(JSON.stringify(out), /secret_token_name|private-description/);
});
test('missing product, 404 image, alt, JA missing/prohibited and publication errors', () => {
  const remote = snapshot('shopify');
  Object.assign(remote, { ja_description: '', ja_details: '', ja_title: '日本語', ja_meta_title: '日本語', online_store_published: false,
    images: [{ url: 'https://cdn.shopify.com/broken.png', alt: '', status: 404 }] });
  const kinds = inspectListing(listing(), images(), { cafe24: { state: 'missing', checked: [] }, shopify: remote }, 'weekly', now).issues.map(i => i.kind);
  for (const kind of ['cafe24:missing', 'shopify:image_404', 'shopify:alt_missing', 'shopify:ja_missing', 'shopify:ja_title_prohibited', 'shopify:publication_error']) assert.ok(kinds.includes(kind), kind);
});
test('unknown never clears unchecked prior drifts; no invented filter references; 90-second tag grace', () => {
  const remote = snapshot('cafe24'); delete remote.expected;
  let out = inspectListing(listing(), images(), { cafe24: remote, shopify: { state: 'unavailable', checked: [] } }, 'weekly', now);
  assert.ok(out.issues.some(i => i.kind === 'cafe24:filter_mapping_material'));
  assert.ok(out.issues.some(i => i.kind === 'shopify:unavailable'));
  assert.ok(!out.checked.kinds.includes('shopify:drift_price'));
  out = inspectListing(listing({ last_sync_at: new Date(now.getTime() - 60_000).toISOString() }), images(), { cafe24: remote }, 'weekly', now);
  assert.ok(!out.checked.kinds.some(k => k.startsWith('cafe24:filter_') && !k.endsWith('_unknown')));
  assert.ok(out.issues.some(i => i.kind === 'cafe24:filter_settling_unknown'));
  out = inspectListing(listing({ last_sync_at: new Date(now.getTime() - 90_001).toISOString() }), images(), { cafe24: remote }, 'weekly', now);
  assert.ok(out.issues.some(i => i.kind === 'cafe24:filter_mapping_material'));
});
test('daily only light checks, next 24h preflight, overdue publication/preorder/cap alert not mutation', () => {
  const l = listing({ status: '예약됨', publish_at: new Date(now.getTime() + 3600e3).toISOString(), preorder_enabled: true,
    preorder_ship_date: '2026-10-10', preorder_limit: 10 });
  const remote = snapshot('shopify'); remote.checked.push('preorder_ordered'); remote.preorder_ordered = 10;
  const out = inspectListing(l, images(), { shopify: remote }, 'daily', now);
  assert.ok(out.issues.some(i => i.kind === 'preflight'));
  assert.ok(out.issues.some(i => i.kind === 'preorder_overdue'));
  assert.ok(out.issues.some(i => i.kind === 'shopify:preorder_cap'));
  assert.ok(!out.checked.kinds.includes('shopify:drift_name'));
  assert.ok(inspectListing({ ...l, publish_at: now.toISOString() }, images(), {}, 'daily', now).issues.some(i => i.kind === 'publish_overdue'));
  assert.equal(l.preorder_enabled, true);
  assert.equal(remote.active, true);
});
test('report top10; CEO needs only third KST calendar day; recurrence does not use resolved first_seen', () => {
  const out = inspectListing(listing({ status: '오류' }), images(), {}, 'weekly', now);
  const previous = out.issues.map(i => ({ ...i, first_seen: '2026-10-09T15:30:00Z', last_seen: now.toISOString() }));
  const scan: MonitorScan = { issues: [...out.issues, ...Array.from({ length: 15 }, (_, n) => ({ ...out.issues[0], id: 'i_' + n, listing_id: 'listing_' + n }))],
    checked: [out.checked], listings: 16, inventory: [{ listing_id: 'listing_one', cafe24: 3, shopify: 700 }] };
  const report = buildMonitorReport(slot, scan, previous, now);
  assert.equal(report.stats.top10.length, 10); assert.ok(report.needs.length > 0);
  assert.equal(report.trigger, 'shop_weekly'); assert.equal(report.model, 'rule-based');
  assert.match(report.stats.evidence.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(report.stats.evidence.checkedAt, now.toISOString());
  assert.ok(report.needs.every(i => i.source === 'product_registration' && !('cardId' in i)));
  assert.equal(buildMonitorReport(slot, scan, previous.map(i => ({ ...i, resolved_at: now.toISOString() })), now).needs.length, 0);
  assert.equal(buildMonitorReport(slot, scan, previous.map(i => ({ ...i, first_seen: '2026-10-10T15:30:00Z' })), now).needs.length, 0);
});
test('committed shared claim prevents duplicate ticks and independent worker concurrent same request', async () => {
  const memory = memoryIO(); const runner = createShopMonitor(memory.io);
  await runner.tick(now); await runner.tick(new Date(now.getTime() + 60_000));
  assert.equal(memory.saved.length, 2); assert.equal(memory.saved[0].report.trigger, 'shop_daily'); assert.equal(memory.saved[1].report.trigger, 'shop_weekly');
  const other = createShopMonitor(memory.io);
  await Promise.all([runner.manual('weekly', 'request-unique', now), other.manual('weekly', 'request-unique', now)]);
  assert.equal(memory.saved.length, 3);
  assert.equal(memory.saved[2].report.trigger, 'shop_manual');
  assert.ok(memory.saved.every(s => !('cards' in s.scan)));
});
test('failed report transaction is never complete and retries; fenced finish false handled as failure', async () => {
  const memory = memoryIO(); let reject = true;
  const realFinish = memory.io.finish;
  memory.io.finish = async (...args) => { if (reject) throw new Error('SECRET db password'); return realFinish(...args); };
  const runner = createShopMonitor(memory.io);
  await assert.rejects(runner.manual('weekly', 'request-save', now), error => error instanceof Error && error.message === 'monitor_run_failed');
  assert.equal(memory.saved.length, 0); assert.equal(memory.claims.size, 0); assert.equal(memory.failures.length, 1);
  reject = false; await runner.manual('weekly', 'request-save', now); assert.equal(memory.saved.length, 1);
  const lost = memoryIO({ finish: async () => false });
  await assert.rejects(createShopMonitor(lost.io).manual('daily', 'request-lost', now), /monitor_run_failed/);
  assert.equal(lost.saved.length, 0); assert.equal(lost.failures.length, 1);
});
test('lost manual response returns committed original report and no duplicate run', async () => {
  const memory = memoryIO();
  memory.io.saved = async () => ({ state: 'completed', report: memory.saved[0]?.report });
  const runner = createShopMonitor(memory.io);
  const first = await runner.manual('weekly', 'request-response', now);
  const retry = await runner.manual('weekly', 'request-response', now);
  assert.equal(retry.duplicate, true); assert.equal(retry.state, 'completed'); assert.deepEqual(retry.report, first.report);
  assert.equal(memory.saved.length, 1);
});
test('disabled reports do not claim scheduled runs; private drafts/deleted listings are not monitored', async () => {
  const memory = memoryIO({ settings: async () => ({ ...DEFAULT_MONITOR_SETTINGS, monitor_enabled: false }),
    load: async () => ({ listings: [listing({ status: '작성중', cafe24_product_no: null, shopify_product_id: null }),
      listing({ id: 'deleted', status: '삭제됨' })], images: [], previous: [] }) });
  const runner = createShopMonitor(memory.io);
  await runner.tick(now); assert.equal(memory.attempts.length, 0);
  const result = await runner.manual('weekly', 'request-disabled', now);
  assert.equal(result.report?.stats.total, 0); assert.equal(result.report?.stats.alerts, 0);
});
test('unabortable late read cannot write after timeout; own lock releases and settings failure retries', async () => {
  let release!: (value: any) => void;
  const memory = memoryIO({ load: () => new Promise(resolve => { release = resolve; }) });
  const runner = createShopMonitor(memory.io, 15);
  const promise = runner.manual('daily', 'request-timeout', now);
  await assert.rejects(promise, /monitor_run_failed/);
  release({ listings: [], images: [], previous: [] }); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(memory.saved.length, 0);
  memory.io.load = async () => ({ listings: [], images: [], previous: [] });
  await runner.manual('daily', 'request-timeout', now); assert.equal(memory.saved.length, 1);
  let first = true; memory.io.settings = async () => { if (first) { first = false; throw Error('secret'); } return DEFAULT_MONITOR_SETTINGS; };
  await assert.rejects(runner.tick(now)); await runner.tick(now);
  assert.equal(memory.saved.length, 3);
});
test('provider errors redact raw errors and unknown data cannot produce confirmed clean report', async () => {
  const memory = memoryIO({ read: async () => { throw Error('Authorization Bearer actual-secret https://token.invalid'); } });
  const runner = createShopMonitor(memory.io);
  const result = await runner.manual('weekly', 'request-redact', now);
  assert.doesNotMatch(JSON.stringify(result), /actual-secret|token.invalid|Authorization/);
  assert.equal(memory.saved[0].report.stats.complete, false);
  assert.match(memory.saved[0].report.stats.evidence.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(memory.saved[0].report.stats.reportAvailable, true); // fresh report of unknown observations, not a stale report
  assert.equal(memory.saved[0].report.status, 'warn');
  assert.equal(memory.saved[0].report.needs.length, 0);
});
test('image HEAD is read-only, credential free, rejects SSRF/redirects and reports 404', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const read = async (url: any, init: any) => { calls.push({ url, init }); return new Response(null, { status: 404 }); };
  const signal = new AbortController().signal;
  assert.equal(await monitorImageHead('https://cdn.shopify.com/image.png', signal, read as typeof fetch), 404);
  for (const url of ['http://127.0.0.1/admin', 'https://cdn.shopify.com.evil.invalid/x', 'https://user:secret@cdn.shopify.com/x', 'https://cdn.shopify.com:1234/x'])
    assert.equal(await monitorImageHead(url, signal, read as typeof fetch), undefined);
  assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'HEAD'); assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.headers, undefined);
});
test('uncertain image HEAD does not resolve prior 404', () => {
  const remote = snapshot('shopify'); delete remote.images![0].status;
  const out = inspectListing(listing(), images(), { cafe24: snapshot('cafe24'), shopify: remote }, 'weekly', now);
  assert.ok(out.issues.some(i => i.kind === 'shopify:image_unknown'));
  assert.ok(!out.checked.kinds.includes('shopify:image_404'));
});
test('real channel reader consumed through monitor with mocked read-only Cafe24 requests and publication guard', async () => {
  const calls: { url: string; method: string }[] = [];
  const l = listing();
  const mappings = Object.fromEntries(['material', 'color', 'size', 'design'].map(field => [field,
    { [l[field as keyof Listing] as string]: { verified: true, cafe24: FILTER_CODES[field as keyof typeof FILTER_CODES][l[field as keyof Listing] as string].cafe24 } }]));
  const tags = Object.entries(mappings).flatMap(([field, values]) => [Object.values(values)[0].cafe24, field.toUpperCase() + 'ALL']);
  const store = { settings: async () => ({ filter_mappings: mappings }), sisters: async () => [], images: async () => images() };
  const read = (async (url: any, init: any) => {
    const target = String(url); const method = init?.method || 'GET'; calls.push({ url: target, method });
    if (target.includes('/api/v2/admin/')) {
      let body: any = {};
      if (target.includes('/seo?')) body = { seo: { meta_title: l.meta_title_ko, meta_description: l.meta_desc_ko, meta_alt: 'Product' } };
      else if (target.includes('/inventories?')) body = { inventory: { quantity: 3 } };
      else if (target.includes('/variants?')) body = { variants: [{ variant_code: 'P123A' }] };
      else body = { product: { product_name: l.name_ko, price: '1000', description: l.detail_html_ko, category: [{ category_no: 13 }, { category_no: 14 }],
        product_tag: tags, detail_image: 'https://atlm.kr/web/first.png', additionalimages: [{ additional_image: 'https://atlm.kr/web/second.png' },
          { additional_image: 'https://atlm.kr/web/third.png' }], display: 'F', selling: 'F' } };
      return Response.json(body);
    }
    return new Response(null, { status: method === 'HEAD' && target.endsWith('first.png') ? 404 : 200 });
  }) as typeof fetch;
  let refreshes = 0;
  const reader = createMonitorReader({ env: { CAFE24_ERP_CLIENT_ID: 'fixture', CAFE24_ERP_CLIENT_SECRET: 'fixture' }, fetch: read, now: () => now.getTime(), sleep: async () => {} }, store as any,
    { read: async () => ({ access_token: 'fixture-not-real', refresh_token: 'fixture-not-real', expires_at: new Date(now.getTime() + DAY).toISOString() }),
      claim: async () => { refreshes++; throw Error('must not refresh'); }, save: async () => { throw Error('must not save'); }, release: async () => {} } as any);
  const remote = await reader(l, 'cafe24', new AbortController().signal);
  assert.equal(remote.state, 'ok'); assert.equal(remote.inventory, 3); assert.equal(refreshes, 0);
  assert.ok(calls.every(c => c.method === 'GET' || c.method === 'HEAD'));
  const out = inspectListing(l, images(), { cafe24: remote, shopify: snapshot('shopify') }, 'weekly', now);
  assert.ok(out.issues.some(i => i.kind === 'cafe24:image_404'));
  assert.ok(out.issues.some(i => i.kind === 'cafe24:publication_error')); // detail can return 200 while display/selling are off
  assert.doesNotMatch(JSON.stringify(out), /fixture-not-real/);
});
test('pure mocked source has no model clients or imports to generic AI work/agents runners; SQL contract matches', async () => {
  const source = await readFile(new URL('./shop-monitor.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /import .*['"]\.\/(?:work|agents)\.js['"]|@anthropic|messages\.create|openai|\.mutation\(/);
  const migration = await readFile(new URL('../db/15_product_registration.sql', import.meta.url), 'utf8');
  assert.match(migration, /product_shop_monitor_claim\(p_id text,p_schedule_id text,p_run_date date,p_owner text,p_ttl_seconds integer/);
  assert.match(migration, /product_shop_monitor_finish\(p_id text,p_owner text,p_issues jsonb,p_checked jsonb,p_result jsonb,p_report jsonb,p_cards jsonb\)/);
  assert.match(migration, /p_cards IS DISTINCT FROM '\[\]'::jsonb/);
  assert.match(migration, /lease_owner=p_owner AND lease_until>now\(\) AND status='running' FOR UPDATE/);
});
test('CEO-only settings/manual endpoints, no anonymous/staff IO and approved settings columns only', async () => {
  let reads = 0, writes: any[] = [], runs = 0;
  const app = express(); app.use(express.json());
  app.use(createShopMonitorRouter({
    auth: (req, res, next) => { const who = req.headers['x-user']; if (!who) { res.status(401).end(); return; }
      (req as any).user = { id: 'server_actor', email: who === 'ceo' ? 'wonyoung@atlm.kr' : 'staff@example.invalid', role: '대표' }; next(); },
    settings: async () => { reads++; return DEFAULT_MONITOR_SETTINGS; },
    saveSettings: async (settings, actor) => { writes.push({ settings, actor }); return [settings]; },
    manual: async () => { runs++; return { duplicate: true }; },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as any).port;
  const call = (path: string, who?: string, method = 'GET', body?: any) => fetch(`http://127.0.0.1:${port}/api/shop-monitor/${path}`,
    { method, headers: { 'Content-Type': 'application/json', ...(who ? { 'x-user': who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await call('settings')).status, 401); assert.equal((await call('settings', 'staff')).status, 403);
    assert.equal((await call('run', 'staff', 'POST', { mode: 'weekly', request_id: 'request-123' })).status, 403);
    assert.equal(reads + runs + writes.length, 0);
    assert.equal((await call('settings', 'ceo')).status, 200);
    assert.equal((await call('settings', 'ceo', 'PUT', { ...DEFAULT_MONITOR_SETTINGS, approver_ids: ['intruder'], updated_by: 'spoof' })).status, 200);
    assert.deepEqual(writes[0], { settings: DEFAULT_MONITOR_SETTINGS, actor: 'server_actor' });
    assert.equal((await call('settings', 'ceo', 'PUT', { ...DEFAULT_MONITOR_SETTINGS, weekly_day: 99 })).status, 400);
    assert.equal((await call('run', 'ceo', 'POST', { mode: 'weekly', request_id: 'request-123' })).status, 200);
    assert.equal((await call('run', 'ceo', 'POST', { mode: 'weekly' })).status, 400);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
