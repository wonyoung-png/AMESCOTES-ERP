import crypto from 'node:crypto';
import { restAsServer } from './auth.js';
import type { Listing, ListingImage } from '../shared/product-registration.js';

export type Settings = { id: string; approver_ids: string[]; filter_mappings?: Record<string, any>; category_mappings?: Record<string, any>; daily_time?: string; weekly_time?: string; weekly_day?: number; monitor_enabled?: boolean; updated_by?: string; updated_at?: string };
export interface RegistrationStore {
  listings(): Promise<Listing[]>;
  get(id: string): Promise<Listing | null>;
  create(listing: Listing): Promise<Listing>;
  claim(id: string, revision: number, owner: string): Promise<Listing | null>;
  save(listing: Listing, expectedRevision: number, owner: string): Promise<Listing>;
  release(id: string, owner: string): Promise<void>;
  renew(id: string, owner: string): Promise<void>;
  items(): Promise<Record<string, any>[]>;
  images(id: string): Promise<ListingImage[]>;
  putImage(image: ListingImage): Promise<void>;
  putImages(images: ListingImage[]): Promise<void>;
  removeImage(id: string): Promise<void>;
  settings(): Promise<Settings>;
  putSettings(settings: Settings): Promise<void>;
  users(): Promise<Record<string, any>[]>;
  event(id: string, actor: string, type: string, details: unknown): Promise<void>;
  failure(listing: Listing): Promise<void>;
}
const columns = ['id', 'item_id', 'workspace', 'created_at', 'status', 'revision', 'created_by', 'edited_by', 'approved_by', 'approved_revision', 'approval_evidence', 'item_snapshot_hash', 'publish_at', 'publish_channels', 'step_keys', 'cafe24_product_no', 'shopify_product_id', 'lease_owner', 'lease_until', 'validation', 'last_sync_at', 'last_sync_result', 'updated_at'];
const virtual = ['item', 'item_changed'];
export function listingFromRow(row: Record<string, any>): Listing {
  const { payload, ...dedicated } = row;
  return { ...payload, ...dedicated } as Listing;
}
export function listingToRow(listing: Listing): Record<string, unknown> {
  const row: Record<string, unknown> = {}, payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(listing)) {
    if (virtual.includes(key)) continue;
    (columns.includes(key) ? row : payload)[key] = value;
  }
  return { ...row, payload };
}
const eq = (value: string) => encodeURIComponent(JSON.stringify(value));
export function createRegistrationStore(write = restAsServer): RegistrationStore {
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await write(path, { method, signal: AbortSignal.timeout(15_000), headers: { Prefer: 'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`product_registration_db_${response.status}`);
    return response.status === 204 ? [] : response.json();
  }
  async function all(path: string) {
    const result: Record<string, any>[] = []; let after = '';
    for (;;) {
      const page = await request(`${path}${path.includes('?') ? '&' : '?'}order=id.asc&limit=500${after ? `&id=gt.${eq(after)}` : ''}`);
      if (!Array.isArray(page)) throw new Error('invalid_registration_rows');
      result.push(...page);
      if (page.length < 500) return result;
      const next = String(page.at(-1)?.id || '');
      if (!next || next === after) throw new Error('registration_pagination_stalled');
      after = next;
    }
  }
  const patchLease = async (id: string, owner: string, patch: unknown, renewing = false) => {
    const rows = await request(`product_listings?id=eq.${eq(id)}&lease_owner=eq.${eq(owner)}${renewing ? `&lease_until=gt.${encodeURIComponent(new Date().toISOString())}` : ''}`, 'PATCH', patch);
    if (!rows.length) throw new Error('lease_lost');
  };
  return {
    listings: async () => (await all('product_listings?select=*')).map(listingFromRow),
    get: async id => { const rows = await request(`product_listings?id=eq.${eq(id)}&select=*`); return rows[0] ? listingFromRow(rows[0]) : null; },
    create: async listing => {
      // A caller retries with the SAME ID. A transport failure must not create another row.
      const rows = await request('product_listings', 'POST', listingToRow(listing));
      if (!rows[0]) throw new Error('create_outcome_unknown');
      return listingFromRow(rows[0]);
    },
    claim: async (id, revision, owner) => { const rows = await request('rpc/product_registration_claim', 'POST', { p_id: id, p_revision: revision, p_owner: owner, p_ttl_seconds: 900 }); return rows[0] ? listingFromRow(rows[0]) : null; },
    save: async (listing, expectedRevision, owner) => {
      const rows = await request(`product_listings?id=eq.${eq(listing.id)}&revision=eq.${expectedRevision}&lease_owner=eq.${eq(owner)}&lease_until=gt.${encodeURIComponent(new Date().toISOString())}`, 'PATCH', listingToRow({ ...listing, updated_at: new Date().toISOString() }));
      if (!rows[0]) throw new Error('revision_or_lease_conflict');
      return listingFromRow(rows[0]);
    },
    release: (id, owner) => patchLease(id, owner, { lease_owner: null, lease_until: null }),
    renew: (id, owner) => patchLease(id, owner, { lease_until: new Date(Date.now() + 900_000).toISOString() }, true),
    items: async () => all('items?select=*,vendors!items_buyer_id_fkey(id,code,name,type)'),
    images: async id => (await all(`product_listing_images?listing_id=eq.${eq(id)}`)).sort((a, b) => a.position - b.position) as ListingImage[],
    putImage: async image => { const r = await write('product_listing_images?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(image) }); if (!r.ok) throw new Error('image_save_failed'); },
    putImages: async images => { if (!images.length) return; const r = await write('product_listing_images?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(images) }); if (!r.ok) throw new Error('images_save_failed'); },
    removeImage: async id => { await request(`product_listing_images?id=eq.${eq(id)}`, 'DELETE'); },
    settings: async () => (await request('product_registration_settings?id=eq.default'))[0] || { id: 'default', approver_ids: [] },
    putSettings: async settings => {
      const response = await write('product_registration_settings?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(settings) });
      if (!response.ok) throw new Error('settings_save_failed');
    },
    users: async () => all('app_users?is_active=eq.true&select=id,email,name,team,role'),
    event: async (id, actor, action, details) => { const listing = await request(`product_listings?id=eq.${eq(id)}&select=revision`); await request('product_listing_events', 'POST', { id: `ple_${crypto.randomUUID()}`, listing_id: id, actor_id: actor, action, revision: listing[0]?.revision, summary: details }); },
    failure: async listing => {
      const cardId = `product_failure_${listing.id}_${listing.revision}`;
      const users = await all('app_users?is_active=eq.true&select=id,name,team');
      const author = users.find((u: any) => u.id === listing.created_by), assignee = users.find((u: any) => u.id === (listing.approved_by || listing.created_by));
      if (!author || !assignee) throw new Error('failure_recipient_unavailable');
      const response = await write('work_cards?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ id: cardId, created_by: author.id, created_by_name: author.name, assignee_id: assignee.id, assignee_name: assignee.name, team: assignee.team, kind: 'request_check', raw_text: `상품 등록 실패: ${listing.name_en || listing.sku}. ERP 상품 등록에서 결과를 확인하고 재시도해 주세요.`, status: 'open', parsed: { listing_id: listing.id, revision: listing.revision } }) });
      if (!response.ok) throw new Error('failure_card_save_failed');
      const { notify } = await import('./work.js');
      if (!await notify([...new Set([listing.created_by, listing.approved_by].filter(Boolean))].map(user_id => ({ user_id: user_id!, card_id: cardId, title: '상품 등록·공개 실패' })), write)) throw new Error('failure_notice_save_failed');
    },
  };
}
