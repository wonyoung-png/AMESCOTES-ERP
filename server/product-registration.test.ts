import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { emptyListing, type Listing, type ListingImage } from '../shared/product-registration.js';
import { createProductRegistrationService, createProductRegistrationRouter, imageDimensions, type RegistrationAdapters, type RegistrationDependencies } from './product-registration.js';
import { createRegistrationStore, listingFromRow, listingToRow, type RegistrationStore, type Settings } from './product-registration-store.js';

const clone = <T>(v: T): T => structuredClone(v);
const writer = { id: 'writer', name: 'Writer', email: 'writer@atlm.kr', role: '직원', team: '국내 MD' };
const approver = { id: 'approver', name: 'Approver', email: 'approver@atlm.kr', role: '직원', team: '글로벌 MD' };
const ceo = { id: 'ceo', name: 'CEO', email: 'wonyoung@atlm.kr', role: '대표', team: '대표' };
function fixture() {
  let now = new Date('2026-10-11T00:00:00Z'), models = 0, failures = 0;
  const rows = new Map<string, Listing>(), images = new Map<string, ListingImage>();
  const items: Record<string, any>[] = [{ id: 'item1', style_no: 'SKU1', name: 'LOG MIDDLE', season: '26FW', base_cost_krw: 100, colors: ['BROWN'], vendors: { code: 'LUMEN' } }, { id: 'other', style_no: 'OTHER', name: 'Other', brand_code: 'OEM' }];
  let settings: Settings = { id: 'default', approver_ids: ['approver'], filter_mappings: { material: { COW_LEATHER: { verified: true, cafe24: 'COWLEATHER', shopify_ref: 'gid/material' } }, color: { BROWN: { verified: true, cafe24: 'BROWN', shopify_ref: 'gid/color' } }, size: { MEDIUM: { verified: true, cafe24: 'MEDIUM', shopify_ref: 'gid/size' } }, design: { SHOULDER: { verified: true, cafe24: 'SHOULDER', shopify_ref: 'gid/design' } } }, category_mappings: { '1': { verified: true } } };
  const events: any[] = [], calls: string[] = [];
  const store: RegistrationStore = {
    listings: async () => clone([...rows.values()]), get: async id => clone(rows.get(id) || null),
    create: async l => { if (rows.has(l.id)) throw Error('duplicate'); rows.set(l.id, clone(l)); return clone(l); },
    claim: async (id, rev, owner) => { const l = rows.get(id); if (!l || l.revision !== rev || (l.lease_owner && Date.parse(l.lease_until || '') > now.getTime())) return null; l.lease_owner = owner; l.lease_until = new Date(now.getTime() + 900_000).toISOString(); return clone(l); },
    save: async (l, rev, owner) => { const old = rows.get(l.id); if (!old || old.revision !== rev || old.lease_owner !== owner) throw Error('lease_lost'); rows.set(l.id, clone(l)); return clone(l); },
    release: async (id, owner) => { const l = rows.get(id); if (l?.lease_owner === owner) { l.lease_owner = null; l.lease_until = null; } },
    renew: async () => {}, items: async () => clone(items), images: async id => clone([...images.values()].filter(i => i.listing_id === id).sort((a, b) => a.position - b.position)),
    putImage: async i => { images.set(i.id, clone(i)); }, removeImage: async id => { images.delete(id); },
    putImages: async batch => { for (const i of batch) images.set(i.id, clone(i)); },
    settings: async () => clone(settings), putSettings: async s => { settings = clone(s); }, users: async () => [writer, approver, ceo, { ...writer, id: 'outsider', team: '제품개발' }],
    event: async (...args) => { events.push(args); }, failure: async () => { failures++; },
  };
  const adapters: RegistrationAdapters = {
    channelStatus: () => ({ cafe24: { connected: false }, shopify: { connected: false } }), checkListing: async () => ({ issues: [] }),
    syncListing: async (l, _images, step) => { const result: any = {}; for (const c of l.publish_channels) { calls.push(`sync:${c}`); await step({ channel: c, step: 'create', key: `${c}:create`, data: c === 'cafe24' ? { cafe24_product_no: 1 } : { shopify_product_id: 'gid/product/1' } }); result[c] = { ok: true, id: c === 'cafe24' ? 1 : 'gid/product/1' }; } return result; },
    publishListing: async (_l, channels) => { const result: any = {}; for (const c of channels) { calls.push(`publish:${c}`); result[c] = { ok: true }; } return result; },
    deleteTestListing: async () => ({ cafe24: { ok: false, pending_manual: ['trash_manual'] }, shopify: { ok: true } }),
    uploadListingImage: async () => ({ source_url: 'https://cdn.shopify.com/file.png', shopify_file_id: 'gid/file/1' }),
    endPreorder: async (l) => { calls.push('preorder-end'); return Object.fromEntries(l.publish_channels.map(c => [c, { ok: true }])); },
  };
  const deps: RegistrationDependencies = { store, adapters: async () => adapters, authenticate: async () => writer, now: () => now, model: async () => { models++; return { suggestions: { desc_ja: 'suggested only' } }; }, sizeMaster: async () => ({ 'LOG MIDDLE': { size: '미디엄' } }) };
  const rawService = createProductRegistrationService(deps);
  // Integration convenience: explicitly execute durable queued commands through the worker.
  const service = { ...rawService, action: async (...args: Parameters<typeof rawService.action>) => {
    const result = await rawService.action(...args);
    if (!result.queued) return result;
    await rawService.tick();
    const listing = (await store.get(args[1]))!;
    return { ...result, listing, channel_results: listing.last_sync_result };
  } };
  const listing: Listing = { ...emptyListing('item1'), id: 'pl_testlisting1', sku: 'SKU1', style_name: 'LOG MIDDLE', color_en: 'BROWN', season: '26FW', created_by: writer.id, edited_by: writer.id, name_ko: 'LOG MIDDLE (BROWN)', name_en: 'LOG MIDDLE (BROWN)', price_krw: 200, price_usd: 100, supply_price: 100, summary_ko: 'summary', simple_ko: 'simple', detail_html_ko: '<p>detail</p>', mobile_detail_html_ko: '<p>detail</p>', desc_en: 'description', desc_ja: '説明', details_en: 'details', details_ja: '情報', care_ko: 'care', cafe24_category_nos: [1], shopify_collection_ids: ['gid/collection'], taxonomy_category_id: 'gid/taxonomy', material: 'COW_LEATHER', color: 'BROWN', size: 'MEDIUM', design: 'SHOULDER', tags_ko: ['로그'], tags_en: ['LOG'], meta_desc_ko: 'description', meta_desc_en: 'description', meta_keywords: 'LOG', handle: 'log-middle-brown', weight_g: 100, origin_cafe24: 'KR', origin_shopify: 'CN', hscode: '4202', cafe24_shipping: { type: 'T' }, cafe24_qty: 5, shopify_qty: 2 };
  rows.set(listing.id, clone(listing));
  for (let n = 0; n < 3; n++) images.set(`im${n}`, { id: `im${n}`, listing_id: listing.id, position: n, role: n === 0 ? 'main' : 'extra', width: 300, height: 400, source_url: `https://cdn.shopify.com/${n}.png`, shopify_file_id: `gid/file/${n}`, alt_ko: '상품', alt_en: 'product' });
  const ready = async () => { await service.action(writer, listing.id, 'validate', { revision: 1 }); await service.action(writer, listing.id, 'request-approval', { revision: 1 }); };
  const approved = async () => { await ready(); return service.action(approver, listing.id, 'approve', { revision: 1 }); };
  return { deps, store, service, rawService, rows, images, items, adapters, listing, ready, approved, events, calls, models: () => models, failures: () => failures, settings: () => settings, clock: (v: string) => { now = new Date(v); } };
}

test('payload roundtrip preserves dedicated revision/editor/approval/snapshot fields', () => {
  const l = { ...emptyListing(), edited_by: 'writer', approval_evidence: 'hash', item_snapshot_hash: 'itemhash', last_sync_at: 'now', item: { secret: 'never persist' } };
  const row = listingToRow(l);
  assert.equal(row.edited_by, 'writer'); assert.equal(row.item_snapshot_hash, 'itemhash'); assert.equal(row.last_sync_at, 'now'); assert.equal((row.payload as any).item, undefined);
  assert.equal(listingFromRow({ ...row, payload: { ...(row.payload as any), status: 'forged' } }).status, l.status);
});
test('team comes from active DB users; workspace and non-MD roles blocked', async () => {
  const f = fixture();
  const req = (workspace: string) => ({ header: () => workspace, query: {} }) as any;
  await assert.rejects(f.service.authorize(req('OEM')), /workspace_must_be_lumen/);
  assert.equal((await f.service.authorize(req('LUMEN'))).team, '국내 MD');
  f.deps.authenticate = async () => ({ ...writer, id: 'outsider' });
  await assert.rejects(f.service.authorize(req('LUMEN')), /forbidden/);
  f.deps.authenticate = async () => null;
  await assert.rejects(f.service.authorize(req('LUMEN')), /no_session/);
});
test('create stable ID retries same row, reads item facts, never writes items', async () => {
  const f = fixture(), input = { id: 'pl_newlisting1', item_id: 'item1', sku: 'forged', supply_price: 9999 };
  const a = await f.service.create(writer, input), b = await f.service.create(writer, input);
  assert.equal(a.listing.id, b.listing.id); assert.equal(a.listing.sku, 'SKU1'); assert.equal(a.listing.supply_price, 100); assert.equal(f.rows.size, 2);
  await assert.rejects(f.service.create(writer, { id: 'pl_oemlisting1', item_id: 'other' }), /not_lumen_item/);
});
test('optimistic edit invalidates approval while preserving channel IDs and creation steps', async () => {
  const f = fixture(); await f.approved();
  const before = f.rows.get(f.listing.id)!;
  const result = await f.service.action(writer, f.listing.id, 'edit', { revision: 1, summary_ko: 'updated' });
  assert.equal(result.listing.revision, 2); assert.equal(result.listing.status, '작성중'); assert.equal(result.listing.approved_by, null); assert.equal(result.listing.shopify_product_id, before.shopify_product_id); assert.ok(result.listing.step_keys['shopify:create']);
  await assert.rejects(f.service.action(writer, f.listing.id, 'edit', { revision: 1 }), /revision_or_lease_conflict/);
});
test('author and current editor including CEO cannot approve own revision', async () => {
  const f = fixture(); await f.ready();
  await assert.rejects(f.service.action(writer, f.listing.id, 'approve', { revision: 1 }), /self_approval/);
  f.rows.get(f.listing.id)!.edited_by = ceo.id;
  await assert.rejects(f.service.action(ceo, f.listing.id, 'approve', { revision: 1 }), /self_approval/);
  assert.equal(f.calls.length, 0);
});
test('item/sku/is_test immutable after creation; readonly cost cannot be forged', async () => {
  const f = fixture();
  for (const patch of [{ item_id: 'other' }, { sku: 'new' }, { is_test: true }]) await assert.rejects(f.service.action(writer, f.listing.id, 'edit', { revision: 1, ...patch }), /identity_immutable/);
  const result = await f.service.action(writer, f.listing.id, 'edit', { revision: 1, supply_price: 1 }); assert.equal(result.listing.supply_price, 100);
});
test('validation caches Opus response and never auto-applies translation suggestions', async () => {
  const f = fixture(); const first = await f.service.action(writer, f.listing.id, 'validate', { revision: 1 });
  assert.deepEqual(first.issues, []); assert.equal(first.suggestions.desc_ja, 'suggested only'); assert.equal(first.listing.desc_ja, '説明');
  await f.service.action(writer, f.listing.id, 'validate', { revision: 1 }); assert.equal(f.models(), 1);
});
test('missing or candidate mappings and unknown sizes cannot request approval', async () => {
  const f = fixture(); delete f.settings().filter_mappings!.material.COW_LEATHER.verified;
  const result = await f.service.action(writer, f.listing.id, 'validate', { revision: 1 }); assert.equal(result.listing.status, '작성중'); assert.equal(f.models(), 0);
  await assert.rejects(f.service.action(writer, f.listing.id, 'request-approval', { revision: 1 }), /validation_required/);
});
test('conservative model budget rejects oversized copy instead of silently truncating', async () => {
  const f = fixture(); f.rows.get(f.listing.id)!.desc_en = '字'.repeat(4000);
  await assert.rejects(f.service.action(writer, f.listing.id, 'validate', { revision: 1 }), /model_input_budget_exceeded/); assert.equal(f.models(), 0);
});
test('approval evidence binds original image/item/mappings before publish', async () => {
  for (const target of ['item', 'image', 'mapping']) {
    const f = fixture(); await f.approved();
    if (target === 'item') f.items[0].base_cost_krw++;
    else if (target === 'image') f.images.get('im0')!.source_url += '?changed';
    else f.settings().filter_mappings!.color.BROWN.shopify_ref = 'gid/new';
    await assert.rejects(f.service.action(approver, f.listing.id, 'publish', { revision: 1 }), /approval_evidence_changed/); assert.equal(f.calls.filter(c => c.startsWith('publish')).length, 0);
  }
});
test('schedule enforces future only; due scheduler publishes and preserves approval evidence', async () => {
  const f = fixture(); await f.approved();
  await assert.rejects(f.service.action(approver, f.listing.id, 'schedule', { revision: 1, publish_at: '2026-10-10T23:00:00Z' }), /future_publish_at_required/);
  await f.service.action(approver, f.listing.id, 'schedule', { revision: 1, publish_at: '2026-10-11T02:00:00Z' });
  f.clock('2026-10-11T01:01:00Z'); await f.service.tick(); assert.ok((f.rows.get(f.listing.id)!.validation as any).preflight_at); assert.equal(f.models(), 1);
  f.clock('2026-10-11T02:00:01Z'); await f.service.tick(); assert.equal(f.rows.get(f.listing.id)!.status, '공개됨');
});
test('partial channel success durable; three attempts max; retry does not replay successful channel', async () => {
  const f = fixture(); await f.approved();
  f.adapters.publishListing = async (_l, channels) => { for (const c of channels) f.calls.push(`publish:${c}`); return Object.fromEntries(channels.map(c => [c, { ok: c === 'cafe24', error: c === 'shopify' ? 'unconnected' : undefined }])); };
  await f.service.action(approver, f.listing.id, 'publish', { revision: 1 });
  await f.service.action(approver, f.listing.id, 'retry', { revision: 1 }); await f.service.action(approver, f.listing.id, 'retry', { revision: 1 });
  assert.equal(f.calls.filter(c => c === 'publish:cafe24').length, 1); assert.equal(f.calls.filter(c => c === 'publish:shopify').length, 3); assert.equal(f.failures(), 3);
  await assert.rejects(f.service.action(approver, f.listing.id, 'retry', { revision: 1 }), /retry_exhausted/);
});
test('lease prevents parallel writers and expired lease recovers using original revision', async () => {
  const f = fixture(), l = f.rows.get(f.listing.id)!; l.lease_owner = 'another'; l.lease_until = '2026-10-11T00:05:00Z';
  await assert.rejects(f.service.action(writer, l.id, 'edit', { revision: 1 }), /revision_or_lease_conflict/);
  f.clock('2026-10-11T00:06:00Z'); await f.service.action(writer, l.id, 'edit', { revision: 1, summary_ko: 'new' }); assert.equal(f.rows.get(l.id)!.lease_owner, null);
});
test('persistent image metadata edits invalidate approval; fake MIME and dimensions rejected', async () => {
  const f = fixture(); await f.approved();
  const result = await f.service.imageAction(writer, f.listing.id, { revision: 1, alt_en: 'new' }, 'im0'); assert.equal(result.listing.revision, 2); assert.equal(result.listing.approved_by, null); assert.equal(f.images.get('im0')!.alt_en, 'new');
  assert.throws(() => imageDimensions(Buffer.from('<script>')), /unsupported_or_invalid_image/);
  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(300, 16); png.writeUInt32BE(400, 20); assert.equal(imageDimensions(png).width, 300);
});
test('test-only CEO delete keeps pending manual channel explicit, never falsely complete', async () => {
  const f = fixture(); await assert.rejects(f.service.action(ceo, f.listing.id, 'delete-test', { revision: 1 }), /test_listing_required/);
  f.rows.get(f.listing.id)!.is_test = true;
  await assert.rejects(f.service.action(writer, f.listing.id, 'delete-test', { revision: 1 }), /ceo_required/);
  const result = await f.service.action(ceo, f.listing.id, 'delete-test', { revision: 1 }); assert.equal(result.listing.status, '삭제대기');
});
test('settings CEO only; partial update preserves mappings and monitor configuration', async () => {
  const f = fixture(), app = express(); app.use(express.json()); app.use(createProductRegistrationRouter(f.deps));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as any;
  try {
    const send = (body: any) => fetch(`http://127.0.0.1:${address.port}/api/product-registration/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Workspace': 'LUMEN' }, body: JSON.stringify(body) });
    assert.equal((await send({ approver_ids: [] })).status, 403);
    f.deps.authenticate = async () => ceo;
    assert.equal((await send({ monitor_enabled: true })).status, 200); assert.ok(f.settings().filter_mappings!.material); assert.deepEqual(f.settings().approver_ids, ['approver']);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
test('store release is CAS, claim uses specified RPC and images upsert Prefer', async () => {
  const calls: any[] = [];
  const write = async (path: string, init: any) => { calls.push({ path, init }); return { ok: true, status: 200, json: async () => path.startsWith('rpc/') ? [] : [{ id: 'pl_test' }], text: async () => '' }; };
  const store = createRegistrationStore(write);
  await store.claim('pl_test', 2, 'owner'); await store.release('pl_test', 'owner'); await store.putImage({ id: 'im1' } as ListingImage);
  assert.equal(calls[0].path, 'rpc/product_registration_claim'); assert.equal(JSON.parse(calls[0].init.body).p_revision, 2); assert.match(calls[1].path, /lease_owner=eq/); assert.equal(calls[2].init.headers.Prefer, 'resolution=merge-duplicates');
});
test('ordinary writer cannot publish/schedule/retry another approver approved content', async () => {
  const f = fixture(); await f.approved();
  await assert.rejects(f.service.action(writer, f.listing.id, 'publish', { revision: 1 }), /self_approval_or_forbidden/);
  await assert.rejects(f.service.action(writer, f.listing.id, 'schedule', { revision: 1, publish_at: '2026-10-12T00:00:00Z' }), /self_approval_or_forbidden/);
});
test('main switch demotes previous main and reorder normalizes all positions', async () => {
  const f = fixture();
  const result = await f.service.imageAction(writer, f.listing.id, { revision: 1, role: 'main', position: 0 }, 'im2');
  assert.equal(result.images[0].id, 'im2'); assert.deepEqual(result.images.map(i => i.position), [0, 1, 2]); assert.equal(result.images.filter(i => i.role === 'main').length, 1);
});
test('approval pending stale image cannot invoke merchant staging', async () => {
  const f = fixture(); await f.ready(); f.images.get('im0')!.alt_en = 'changed';
  await assert.rejects(f.service.action(approver, f.listing.id, 'approve', { revision: 1 }), /validation_required/); assert.equal(f.calls.length, 0);
});
test('unconnected staging records explicit error; not publishable and retry bounded', async () => {
  const f = fixture(); f.adapters.syncListing = async () => { throw Error('unconnected'); };
  const result = await f.approved(); assert.equal(result.listing.status, '오류'); assert.equal(result.channel_results.shopify.error, 'channel_operation_failed');
  await assert.rejects(f.service.action(approver, f.listing.id, 'publish', { revision: 1 }), /staging_required/);
});
test('unknown create response retries stable ID without a second insertion', async () => {
  const f = fixture(), original = f.store.create; let insertions = 0;
  f.store.create = async l => { insertions++; await original(l); throw Error('response_lost'); };
  const input = { id: 'pl_stableunknown', item_id: 'item1' };
  await assert.rejects(f.service.create(writer, input), /response_lost/);
  const retried = await f.service.create(writer, input); assert.equal(retried.listing.id, input.id); assert.equal(insertions, 1);
});
test('approved date-only preorder condition expires after KST end date with no model call', async () => {
  const f = fixture(); Object.assign(f.rows.get(f.listing.id)!, { preorder_enabled: true, preorder_ship_date: '2026-10-12', preorder_end_condition: 'date', preorder_end_date: '2026-10-11' });
  await f.approved(); await f.service.action(approver, f.listing.id, 'publish', { revision: 1 }); const modelCount = f.models();
  f.clock('2026-10-11T14:59:59Z'); await f.service.tick(); assert.equal(f.rows.get(f.listing.id)!.preorder_enabled, true);
  f.clock('2026-10-11T15:00:00Z'); await f.service.tick(); assert.equal(f.rows.get(f.listing.id)!.preorder_enabled, false); assert.equal(f.rows.get(f.listing.id)!.status, '공개됨'); assert.equal(f.models(), modelCount);
  const calls = f.calls.length; await f.service.tick(); assert.equal(f.calls.length, calls);
});
test('SIZE requires only a verified Cafe24 mapping; other filters still require Shopify references', async () => {
  const f = fixture(); delete f.settings().filter_mappings!.size.MEDIUM.shopify_ref;
  await f.approved(); assert.equal(f.rows.get(f.listing.id)!.status, '승인');
  for (const field of ['material', 'color', 'design']) {
    const g = fixture(), codes: Record<string, string> = { material: 'COW_LEATHER', color: 'BROWN', design: 'SHOULDER' };
    delete g.settings().filter_mappings![field][codes[field]].shopify_ref;
    const result = await g.service.action(writer, g.listing.id, 'validate', { revision: 1 });
    assert.ok(result.issues.some((issue: any) => issue.field === field && issue.severity === 'error'));
  }
});
test('unrelated mappings and model sizes do not invalidate approval or worker execution', async () => {
  const f = fixture(); await f.approved(); const evidence = f.rows.get(f.listing.id)!.approval_evidence;
  f.settings().filter_mappings!.color.OTHER = { verified: true, cafe24: 'OTHER', shopify_ref: 'other' };
  f.settings().category_mappings!['999'] = { verified: true };
  f.settings().filter_mappings!.size.MEDIUM.shopify_ref = 'unused-change';
  f.deps.sizeMaster = async () => ({ 'LOG MIDDLE': { size: '미디엄' }, 'OTHER BAG': { size: '라지' } });
  await f.service.action(approver, f.listing.id, 'publish', { revision: 1 });
  assert.equal(f.rows.get(f.listing.id)!.status, '공개됨'); assert.equal(f.rows.get(f.listing.id)!.approval_evidence, evidence);
});
test('selected category and sister mappings remain bound to approval evidence', async () => {
  for (const target of ['category', 'sister']) {
    const f = fixture();
    if (target === 'sister') {
      f.items.push({ ...clone(f.items[0]), id: 'sister-item', style_no: 'SKU2', colors: ['BLACK'] });
      f.rows.set('sister', { ...clone(f.listing), id: 'sister', item_id: 'sister-item', sku: 'SKU2', color_en: 'BLACK', color: 'BLACK' });
      f.rows.get(f.listing.id)!.sister_listing_ids = ['sister'];
      f.settings().filter_mappings!.color.BLACK = { verified: true, cafe24: 'BLACK', shopify_ref: 'black-original' };
    }
    await f.approved();
    if (target === 'category') f.settings().category_mappings!['1'].verified = false;
    else f.settings().filter_mappings!.color.BLACK.shopify_ref = 'black-changed';
    await assert.rejects(f.rawService.action(approver, f.listing.id, 'publish', { revision: 1 }), /approval_evidence_changed/);
  }
});
test('preorder expiring after approval queues stages first, then ends on the next tick', async () => {
  const f = fixture(); Object.assign(f.rows.get(f.listing.id)!, { preorder_enabled: true, preorder_ship_date: '2026-10-12', preorder_end_condition: 'date', preorder_end_date: '2026-10-11' });
  await f.ready(); await f.rawService.action(approver, f.listing.id, 'approve', { revision: 1 });
  f.clock('2026-10-11T15:00:00Z'); await f.rawService.tick();
  assert.deepEqual(f.calls, ['sync:cafe24', 'sync:shopify']); assert.equal(f.rows.get(f.listing.id)!.preorder_enabled, true);
  await f.rawService.tick(); assert.equal(f.calls.at(-1), 'preorder-end'); assert.equal(f.rows.get(f.listing.id)!.preorder_enabled, false);
});
test('expired preorder without staged linked products is gated without any commerce command', async () => {
  const f = fixture(); Object.assign(f.rows.get(f.listing.id)!, { preorder_enabled: true, preorder_ship_date: '2026-10-12', preorder_end_condition: 'date', preorder_end_date: '2026-10-11' });
  await f.ready(); await f.rawService.action(approver, f.listing.id, 'approve', { revision: 1 });
  const l = f.rows.get(f.listing.id)!; (l.validation as any).queued = false;
  f.clock('2026-10-11T15:00:00Z'); await f.rawService.tick();
  assert.equal(f.calls.length, 0); assert.equal(l.status, '승인');
  assert.equal((f.rows.get(l.id)!.validation as any).preorder_gate, 'preorder_end_staging_required');
});
test('ERP/unknown receipt never silently ends receipt-based preorder', async () => {
  const f = fixture(); Object.assign(f.rows.get(f.listing.id)!, { preorder_enabled: true, preorder_ship_date: '2026-10-12', preorder_end_condition: 'receipt' });
  await f.approved(); await f.service.action(approver, f.listing.id, 'publish', { revision: 1 }); f.clock('2026-10-15T00:00:00Z'); await f.service.tick(); assert.equal(f.rows.get(f.listing.id)!.preorder_enabled, true);
});
test('translation works for incomplete draft and missing mappings, remains suggestions-only', async () => {
  const f = fixture(); f.rows.get(f.listing.id)!.desc_ja = ''; f.settings().filter_mappings = {};
  f.adapters.checkListing = async () => { throw Error('must not call channels to translate'); };
  const result = await f.service.action(writer, f.listing.id, 'translate', { revision: 1 });
  assert.equal(result.suggestions.desc_ja, 'suggested only'); assert.equal(result.listing.desc_ja, ''); assert.equal(result.listing.status, '작성중'); assert.equal(f.models(), 1);
});
test('master true SKU (including existing color SKU) is preserved, never synthesized', async () => {
  const f = fixture(); f.items[0].sku = 'REAL-SKU'; f.items[0].colors = [{ name: 'BROWN', sku: 'REAL-BROWN' }];
  const result = await f.service.create(writer, { id: 'pl_realsku001', item_id: 'item1', sku: 'FORGED' });
  assert.equal(result.listing.sku, 'REAL-BROWN');
});
test('positive linked commerce inventory is not authoritative receipt proof and cannot automatically end preorder', async () => {
  const f = fixture(); Object.assign(f.rows.get(f.listing.id)!, { cafe24_qty: 0, shopify_qty: 0, preorder_enabled: true, preorder_ship_date: '2026-10-12', preorder_end_condition: 'receipt' });
  await f.approved(); await f.service.action(approver, f.listing.id, 'publish', { revision: 1 });
  let stocks = { cafe24: 3, shopify: 0 };
  f.adapters.readMonitorSnapshot = async (_l, c) => ({ state: 'ok', checked: ['inventory'], inventory: stocks[c] });
  await f.service.tick(); assert.equal(f.rows.get(f.listing.id)!.preorder_enabled, true);
  stocks.shopify = 2; f.clock('2026-10-11T00:06:00Z'); const syncCount = f.calls.filter(c => c.startsWith('sync')).length;
  await f.service.tick(); const ended = f.rows.get(f.listing.id)!;
  assert.equal(ended.preorder_enabled, true); assert.equal(ended.status, '공개됨'); assert.equal(ended.cafe24_qty, 0); assert.equal(ended.shopify_qty, 0); assert.equal(f.calls.filter(c => c.startsWith('sync')).length, syncCount);
  assert.equal((ended.validation as any).preorder_gate, 'authoritative_commerce_receipt_unsupported');
});
test('unknown commerce inventory, initial-positive inventory and unconnected end adapter do not fake automatic receipt success', async () => {
  for (const condition of ['unknown', 'initial-positive', 'unconnected']) {
    const f = fixture(); Object.assign(f.rows.get(f.listing.id)!, { cafe24_qty: condition === 'initial-positive' ? 5 : 0, shopify_qty: 0, preorder_enabled: true, preorder_ship_date: '2026-10-12', preorder_end_condition: 'receipt' });
    await f.approved(); await f.service.action(approver, f.listing.id, 'publish', { revision: 1 });
    f.adapters.readMonitorSnapshot = async () => condition === 'unknown' ? { state: 'unavailable', checked: [] } : { state: 'ok', checked: ['inventory'], inventory: 2 };
    if (condition === 'unconnected') delete f.adapters.endPreorder;
    await f.service.tick(); assert.equal(f.rows.get(f.listing.id)!.preorder_enabled, true); assert.equal(f.rows.get(f.listing.id)!.status, '공개됨'); assert.ok((f.rows.get(f.listing.id)!.validation as any).preorder_gate);
  }
});
test('store listings/items/users paginate stable ID keysets beyond PostgREST default limit', async () => {
  const paths: string[] = [];
  const write = async (path: string) => {
    paths.push(path);
    const after = new URLSearchParams(path.split('?')[1]).get('id');
    const rows = after ? [{ id: 'id1001' }] : Array.from({ length: 500 }, (_, i) => ({ id: `id${String(i).padStart(4, '0')}` }));
    return { ok: true, status: 200, json: async () => rows, text: async () => '' };
  };
  const store = createRegistrationStore(write);
  assert.equal((await store.listings()).length, 501); assert.equal((await store.items()).length, 501); assert.equal((await store.users()).length, 501);
  assert.equal(paths.length, 6); assert.ok(paths.every(p => p.includes('order=id.asc'))); assert.match(paths[1], /id=gt\./);
});
test('approval sends validated current item cost, not the original stale listing snapshot', async () => {
  const f = fixture(); f.items[0].base_cost_krw = 200;
  let sentCost = 0;
  const sync = f.adapters.syncListing;
  f.adapters.syncListing = async (listing, images, onStep) => { sentCost = listing.supply_price; return sync(listing, images, onStep); };
  await f.approved(); assert.equal(f.rows.get(f.listing.id)!.supply_price, 200); assert.equal(sentCost, 200);
});
test('multiple colors require real unique per-color SKU, never style_no or guessed suffix', async () => {
  const f = fixture(); f.items[0].colors = [{ name: 'BROWN' }, { name: 'BLACK' }]; f.items[0].sku = 'STYLE-SKU';
  await assert.rejects(f.service.create(writer, { id: 'pl_multicolor01', item_id: 'item1', color_en: 'BROWN' }), /explicit_color_sku_required/);
  f.items[0].colors[0].sku = 'REAL-BROWN'; f.items[0].colors[1].sku = 'REAL-BROWN';
  await assert.rejects(f.service.create(writer, { id: 'pl_multicolor01', item_id: 'item1', color_en: 'BROWN' }), /color_sku_not_unique/);
  f.items[0].colors[1].sku = 'REAL-BLACK';
  const result = await f.service.create(writer, { id: 'pl_multicolor01', item_id: 'item1', color_en: 'BROWN' }); assert.equal(result.listing.sku, 'REAL-BROWN');
});
test('changed size master invalidates validation before approval and approval before publication', async () => {
  const beforeApproval = fixture(); await beforeApproval.ready(); beforeApproval.deps.sizeMaster = async () => ({ 'LOG MIDDLE': { size: '라지' } });
  await assert.rejects(beforeApproval.service.action(approver, beforeApproval.listing.id, 'approve', { revision: 1 }), /validation_required/); assert.equal(beforeApproval.calls.length, 0);
  const beforePublish = fixture(); await beforePublish.approved(); beforePublish.deps.sizeMaster = async () => ({ 'LOG MIDDLE': { size: '라지' } });
  await assert.rejects(beforePublish.service.action(approver, beforePublish.listing.id, 'publish', { revision: 1 }), /approval_evidence_changed/); assert.equal(beforePublish.calls.filter(c => c.startsWith('publish')).length, 0);
});
test('every intermediate editor remains prohibited after another editor changes the revision', async () => {
  const f = fixture();
  await f.service.action(approver, f.listing.id, 'edit', { revision: 1, summary_ko: 'approver draft' });
  await f.service.action(writer, f.listing.id, 'edit', { revision: 2, summary_ko: 'writer changes' });
  await f.service.action(writer, f.listing.id, 'validate', { revision: 3 }); await f.service.action(writer, f.listing.id, 'request-approval', { revision: 3 });
  assert.ok((f.rows.get(f.listing.id)!.validation as any).editor_ids.includes(approver.id));
  await assert.rejects(f.service.action(approver, f.listing.id, 'approve', { revision: 3 }), /self_approval_or_forbidden/);
  await f.service.action(ceo, f.listing.id, 'approve', { revision: 3 }); assert.equal(f.rows.get(f.listing.id)!.approved_by, ceo.id);
});
test('unrelated vendor details, item memo and timestamps do not invalidate relevant approved facts', async () => {
  const f = fixture(); await f.approved(); f.items[0].memo = 'internal unrelated'; f.items[0].updated_at = 'new'; f.items[0].vendors.name = 'new vendor label'; f.items[0].vendors.contact_name = 'private unneeded';
  const result = await f.service.action(approver, f.listing.id, 'publish', { revision: 1 }); assert.equal(result.listing.status, '공개됨'); assert.equal((await f.service.joined(result.listing)).item_changed, false);
});
test('passive unsupported receipt observation never changes a public listing to ERROR even when approval evidence has drifted', async () => {
  const f = fixture(); Object.assign(f.rows.get(f.listing.id)!, { preorder_enabled: true, preorder_ship_date: '2026-10-12', preorder_end_condition: 'receipt' }); await f.approved(); await f.service.action(approver, f.listing.id, 'publish', { revision: 1 });
  f.items[0].base_cost_krw = 999; await f.service.tick(); assert.equal(f.rows.get(f.listing.id)!.status, '공개됨'); assert.equal(f.rows.get(f.listing.id)!.preorder_enabled, true); assert.ok((f.rows.get(f.listing.id)!.validation as any).preorder_gate); assert.equal(f.failures(), 0);
});
test('queued approval does not call channels or consume retries before worker execution; retry enqueue is not an attempt', async () => {
  const f = fixture(); await f.ready();
  const queued = await f.rawService.action(approver, f.listing.id, 'approve', { revision: 1 });
  assert.equal(queued.queued, true); assert.equal(f.calls.length, 0); assert.equal((queued.listing.validation as any).retry_count, 0);
  f.adapters.syncListing = async () => ({ cafe24: { ok: false }, shopify: { ok: false } });
  await f.rawService.tick(); assert.equal((f.rows.get(f.listing.id)!.validation as any).retry_count, 1);
  const retry = await f.rawService.action(approver, f.listing.id, 'retry', { revision: 1 }); assert.equal(retry.queued, true); assert.equal((retry.listing.validation as any).retry_count, 1);
});
test('public reapproval sync remains public and preserves its monitor eligibility', async () => {
  const f = fixture(); await f.approved(); await f.service.action(approver, f.listing.id, 'publish', { revision: 1 });
  await f.service.action(writer, f.listing.id, 'edit', { revision: 1, summary_ko: 'new public copy' }); await f.service.action(writer, f.listing.id, 'validate', { revision: 2 }); await f.service.action(writer, f.listing.id, 'request-approval', { revision: 2 });
  f.adapters.readMonitorSnapshot = async () => ({ state: 'ok', checked: ['publication'], active: true, online_store_published: true } as any);
  const result = await f.service.action(approver, f.listing.id, 'approve', { revision: 2 }); assert.equal(result.listing.status, '공개됨');
});
test('explicit reapply requires fresh evidence confirmation; keeps creation intents, original files and inventory initialization', async () => {
  const f = fixture(); await f.approved();
  const l = f.rows.get(f.listing.id)!; l.step_keys['cafe24:inventory_initial:key'] = { data: { quantity: 5 } }; l.step_keys['shopify:create:intent'] = { data: { state: 'pending' } }; l.step_keys['shopify:file_original:key'] = { data: { file_id: 'gid/file' } }; l.step_keys['shopify:product:key'] = { data: { id: 'gid/product' } };
  await assert.rejects(f.rawService.action(approver, l.id, 'reapply', { revision: 1 }), /fresh_reapply_approval_required/);
  const result = await f.rawService.action(approver, l.id, 'reapply', { revision: 1, confirm: true, approval_evidence: l.approval_evidence });
  assert.equal(result.queued, true); assert.ok(result.listing.step_keys['cafe24:inventory_initial:key']); assert.ok(result.listing.step_keys['shopify:create:intent']); assert.ok(result.listing.step_keys['shopify:file_original:key']); assert.equal(result.listing.step_keys['shopify:product:key'], undefined); assert.equal(result.listing.shopify_product_id, l.shopify_product_id);
});
test('lease release failure cannot convert a durably successful edit to an error response', async () => {
  const f = fixture(); f.store.release = async () => { throw Error('release transport failed'); };
  const result = await f.rawService.action(writer, f.listing.id, 'edit', { revision: 1, summary_ko: 'saved' }); assert.equal(result.listing.summary_ko, 'saved'); assert.equal(f.rows.get(f.listing.id)!.revision, 2);
});
test('sister summaries use same model only and exclude unrelated vendor/private facts', async () => {
  const f = fixture(); const sister = { ...clone(f.listing), id: 'pl_sister0001', item_id: 'item2', sku: 'SKU2', color_en: 'BLACK', name_en: 'LOG MIDDLE (BLACK)' };
  f.items.push({ ...clone(f.items[0]), id: 'item2', style_no: 'SKU2', colors: ['BLACK'], vendors: { code: 'LUMEN', contact_name: 'do not send' } }); f.rows.set(sister.id, sister); f.rows.get(f.listing.id)!.sister_listing_ids = [sister.id];
  let input = ''; f.deps.model = async value => { input = value; return { suggestions: {} }; };
  await f.service.action(writer, f.listing.id, 'validate', { revision: 1 }); assert.equal(JSON.parse(input).sister_color_summaries[0].color_en, 'BLACK'); assert.ok(!input.includes('do not send'));
  f.items.at(-1)!.name = 'OTHER MODEL'; await assert.rejects(f.service.action(writer, f.listing.id, 'validate', { revision: 1 }), /not_sister_style/);
});
test('settings route rejects invalid times, weekdays and shape instead of relying on DB checks', async () => {
  const f = fixture(); f.deps.authenticate = async () => ceo; const app = express(); app.use(express.json()); app.use(createProductRegistrationRouter(f.deps)); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try { const port = (server.address() as any).port;
    for (const body of [{ daily_time: '25:00' }, { weekly_time: 1 }, { weekly_day: 7 }, { monitor_enabled: 'false' }, { filter_mappings: [] }]) { const r = await fetch(`http://127.0.0.1:${port}/api/product-registration/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Workspace': 'LUMEN' }, body: JSON.stringify(body) }); assert.equal(r.status, 400); }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('approval HTTP returns 202 only after durable command intent; channel calls occur exclusively in worker', async () => {
  const f = fixture(); await f.ready(); f.deps.authenticate = async () => approver;
  const app = express(); app.use(express.json()); app.use(createProductRegistrationRouter(f.deps)); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const port = (server.address() as any).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/product-registration/${f.listing.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace': 'LUMEN' }, body: JSON.stringify({ revision: 1 }) });
    assert.equal(response.status, 202); const body = await response.json(); assert.equal(body.queued, true); assert.equal(f.calls.length, 0); assert.equal((f.rows.get(f.listing.id)!.validation as any).queued, true);
    await f.rawService.tick(); assert.equal(f.calls.filter(c => c.startsWith('sync')).length, 2);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('index batch joins over 1000 listings with exactly one paginated item read and isolates missing/OEM facts', async () => {
  const f = fixture(); let itemReads = 0; const items = f.store.items;
  f.store.items = async () => { itemReads++; return items(); };
  for (let i = 0; i < 1001; i++) f.rows.set(`pl_batch${i}`, { ...clone(f.listing), id: `pl_batch${i}` });
  f.rows.set('pl_missing', { ...clone(f.listing), id: 'pl_missing', item_id: 'missing' }); f.rows.set('pl_foreign', { ...clone(f.listing), id: 'pl_foreign', item_id: 'other' });
  const result = await f.service.indexListings(); assert.equal(itemReads, 1); assert.equal(result.listings.length, 1004); assert.equal(result.items.length, 1);
  for (const id of ['pl_missing', 'pl_foreign']) { const l = result.listings.find(l => l.id === id) as any; assert.equal(l.workflow_blocked, true); assert.equal(l.item_unavailable, true); assert.equal(l.item, undefined); }
  assert.equal(result.listings.find(l => l.id === 'pl_batch1000')!.item!.id, 'item1');
});
