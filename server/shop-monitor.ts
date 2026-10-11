// Rule-only office runner. Never imports work/agents/model clients or channel write APIs.
import { createHash, randomUUID } from 'node:crypto';
import bagSizeMaster from '../data/bag_size_master.json';
import { Router, type RequestHandler } from 'express';
import { CEO_EMAILS, requireUser, restAsServer, userOf } from './auth.js';
import { allRows } from './work-records.js';
import { readMonitorSnapshot } from './channels/monitor.js';
import { validateListing, type Channel, type Listing, type ListingImage } from '../shared/product-registration.js';

export type MonitorMode = 'daily' | 'weekly';
export type MonitorSettings = { monitor_enabled: boolean; daily_time: string; weekly_time: string; weekly_day: number };
export const DEFAULT_MONITOR_SETTINGS: MonitorSettings = { monitor_enabled: true, daily_time: '09:00', weekly_time: '09:30', weekly_day: 1 };
const DAY = 864e5;
const FILTERS = ['material', 'color', 'size', 'design'] as const;
const COMPARISONS = ['name', 'price', 'description', 'image_count', 'categories', 'filters', 'seo_title', 'seo_description'] as const;
type Comparison = typeof COMPARISONS[number];
export interface ChannelSnapshot {
  state: 'ok' | 'missing' | 'unavailable';
  // Fields not actually read must NOT be listed: unknown is not an empty value.
  checked: string[];
  name?: string; price?: number | string; description?: string; image_count?: number;
  categories?: (string | number)[]; filters?: Partial<Record<typeof FILTERS[number], string[]>>;
  seo_title?: string; seo_description?: string;
  images?: { url: string; alt?: string; status?: number }[];
  page_status?: number; active?: boolean; online_store_published?: boolean;
  ja_description?: string; ja_details?: string; ja_title?: string; ja_meta_title?: string; ja_meta_description?: string;
  inventory?: number; preorder_ordered?: number;
  // Use adapter's exact outbound normalization (HTML wrappers, manual collections, filters).
  expected?: Partial<Pick<ChannelSnapshot, Comparison>>;
}
export type ShopMonitorReader = (listing: Listing, channel: Channel, signal: AbortSignal) => Promise<ChannelSnapshot>;
export type MonitorIssue = { id: string; listing_id: string; kind: string; message: string; details: Record<string, unknown> };
export type SavedIssue = MonitorIssue & { first_seen: string; last_seen: string; resolved_at?: string | null };
export type CheckedScope = { listing_id: string; kinds: string[] };
export type MonitorScan = { issues: MonitorIssue[]; checked: CheckedScope[]; listings: number;
  inventory: { listing_id: string; cafe24?: number; shopify?: number }[]; source_hash?: string };
export type MonitorSlot = { id: string; schedule_id: string; run_date: string; mode: MonitorMode; manual?: boolean };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const descriptionHash = (value: unknown) => hash(String(value ?? '').replace(/\r\n/g, '\n').trim());
const kstDay = (date: Date) => new Date(date.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || '상품';
const existsText = (value: unknown) => typeof value === 'string' && !!value.trim();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const publiclyVisible = (listing: Listing) => listing.status === '공개됨'
  || (listing.validation as { previously_public?: boolean } | undefined)?.previously_public === true;
const setEqual = (a: unknown, b: unknown) => Array.isArray(a) && Array.isArray(b)
  && JSON.stringify([...new Set(a.map(String))].sort()) === JSON.stringify([...new Set(b.map(String))].sort());

export function validMonitorSettings(value: any): value is MonitorSettings {
  return !!value && typeof value.monitor_enabled === 'boolean' && Number.isInteger(value.weekly_day)
    && value.weekly_day >= 0 && value.weekly_day <= 6
    && [value.daily_time, value.weekly_time].every(v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v));
}
export function listingFromRow(row: Record<string, any>): Listing {
  const { payload, ...columns } = row;
  return { ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}), ...columns } as Listing;
}
// Most recent due slot only: one catch-up, not a backlog burst after downtime.
export function dueMonitorSlots(settings: MonitorSettings, now = new Date()): MonitorSlot[] {
  if (!settings.monitor_enabled || !validMonitorSettings(settings)) return [];
  const day = kstDay(now), midnight = Date.parse(day + 'T00:00:00+09:00');
  const at = (time: string) => Number(time.slice(0, 2)) * 3600e3 + Number(time.slice(3)) * 60e3;
  let daily = midnight + at(settings.daily_time);
  if (daily > now.getTime()) daily -= DAY;
  const dow = new Date(midnight + 9 * 3600e3).getUTCDay();
  let weekly = midnight - ((dow - settings.weekly_day + 7) % 7) * DAY + at(settings.weekly_time);
  if (weekly > now.getTime()) weekly -= 7 * DAY;
  return ([['daily', daily], ['weekly', weekly]] as const).map(([mode, time]) => {
    const run_date = kstDay(new Date(time)), schedule_id = 'shop_' + mode;
    return { id: schedule_id + '_' + run_date, schedule_id, run_date, mode };
  });
}

function expectedSnapshot(listing: Listing, images: ListingImage[], channel: Channel): Partial<ChannelSnapshot> {
  return { name: channel === 'cafe24' ? listing.name_ko : listing.name_en,
    price: channel === 'cafe24' ? listing.price_krw : listing.price_usd,
    description: channel === 'cafe24' ? listing.detail_html_ko : listing.desc_en,
    image_count: images.filter(i => i.role !== 'detail_view' && i.role !== 'list').length,
    categories: channel === 'cafe24' ? listing.cafe24_category_nos : listing.shopify_collection_ids,
    seo_title: channel === 'cafe24' ? listing.meta_title_ko : listing.meta_title_en,
    seo_description: channel === 'cafe24' ? listing.meta_desc_ko : listing.meta_desc_en };
}

export function inspectListing(listing: Listing, images: ListingImage[], snapshots: Partial<Record<Channel, ChannelSnapshot>>,
  mode: MonitorMode, now = new Date(), sizeMaster: Record<string, { size: string }> = {}) {
  const issues: MonitorIssue[] = [], checked = new Set<string>();
  const add = (kind: string, message: string, details: Record<string, unknown> = {}) => {
    checked.add(kind);
    if (!issues.some(i => i.kind === kind)) issues.push({ id: 'smi_' + hash(JSON.stringify([listing.id, kind])).slice(0, 32),
      listing_id: listing.id, kind, message, details });
  };
  const check = (kind: string, bad: boolean, message: string, details: Record<string, unknown> = {}) => {
    checked.add(kind); if (bad) add(kind, message, details);
  };
  const today = kstDay(now);
  check('registration_error', listing.status === '오류', '상품 등록·반영 오류 — 담당자 확인 필요');
  check('publish_overdue', listing.status === '예약됨' && !!listing.publish_at && Date.parse(listing.publish_at) <= now.getTime(), '예약 공개 시각이 지났습니다');
  check('preorder_overdue', listing.preorder_enabled && !!listing.preorder_ship_date && listing.preorder_ship_date < today, '예약 발송일 경과 — 해제 여부 승인 확인 필요');
  check('preorder_end_overdue', listing.preorder_enabled && listing.preorder_end_condition === 'date'
    && !!listing.preorder_end_date && listing.preorder_end_date < today, '프리오더 종료일 경과 — 담당자 확인 필요');
  const soon = listing.status === '예약됨' && !!listing.publish_at && Date.parse(listing.publish_at) > now.getTime()
    && Date.parse(listing.publish_at) <= now.getTime() + DAY;
  if (soon) {
    // Never invoke the model. Future-time validation belongs only to scheduling.
    const errors = validateListing({ ...listing, publish_at: null }, images, sizeMaster, now).filter(i => i.severity === 'error');
    check('preflight', !!errors.length, '24시간 내 공개 예정 상품 사전 검증 미통과', { count: errors.length });
  }
  if (mode === 'weekly') {
    check('erp_ja_missing', !existsText(listing.desc_ja) || !existsText(listing.details_ja), 'ERP 일본어 설명·제품정보 누락');
    check('erp_alt_missing', images.some(i => !existsText(i.alt_en) || !existsText(i.alt_ko)), 'ERP 이미지 설명 누락');
  }
  for (const channel of ['cafe24', 'shopify'] as const) {
    if (!(channel === 'cafe24' ? listing.cafe24_product_no : listing.shopify_product_id)) {
      if (publiclyVisible(listing) && listing.publish_channels?.includes(channel)) add(channel + ':missing', '공개 상품의 채널 연결 누락');
      continue;
    }
    const s = snapshots[channel];
    if (!s || s.state === 'unavailable') { add(channel + ':unavailable', '채널 현재 상태 미확인 — 재조회 필요'); continue; }
    check(channel + ':unavailable', false, '');
    check(channel + ':missing', s.state === 'missing', '채널에서 상품을 찾지 못했습니다');
    if (s.state !== 'ok') continue;
    const actual = new Set(s.checked);
    if (publiclyVisible(listing) && listing.publish_channels?.includes(channel)) {
      const known = actual.has('publication');
      check(channel + ':publication_unknown', !known, '공개 상태 현재 미확인');
      if (known) check(channel + ':publication_error', channel === 'cafe24' ? s.page_status !== 200 || s.active === false
        : s.active !== true || s.online_store_published !== true || (s.page_status !== undefined && s.page_status !== 200), '공개 상품 상세페이지·온라인 스토어 공개 오류');
    }
    if (listing.preorder_enabled && listing.preorder_limit != null) {
      if (actual.has('preorder_ordered')) check(channel + ':preorder_cap', finite(s.preorder_ordered) && s.preorder_ordered >= listing.preorder_limit,
        '프리오더 판매 한도 도달 — 채널 통제 승인 확인 필요');
      else add(channel + ':preorder_cap_unknown', '프리오더 한도 집계 미확인 — 한도 보장을 주장하지 않습니다');
    }
    if (actual.has('preorder_ordered')) check(channel + ':preorder_cap_unknown', false, '');
    if (mode !== 'weekly') continue;
    const expected = { ...expectedSnapshot(listing, images, channel), ...s.expected };
    // Newly written Cafe24 tags are eventually consistent; don't confirm drift yet.
    const tagSettling = channel === 'cafe24' && !!listing.last_sync_at && now.getTime() - Date.parse(listing.last_sync_at) < 90_000;
    check(channel + ':filter_settling_unknown', tagSettling, '채널 태그 반영 대기 — 90초 뒤 재확인');
    for (const field of COMPARISONS.filter(f => f !== 'filters')) {
      if (!actual.has(field)) continue;
      const left = expected[field], right = s[field];
      const same = field === 'description' ? descriptionHash(left) === descriptionHash(right)
        : field === 'price' ? Number.isFinite(Number(right)) && Number(left) === Number(right)
        : field === 'categories' ? setEqual(left, right) : left === right;
      check(channel + ':drift_' + field, !same, 'ERP와 채널 값 불일치 — 승인 후 ERP 값 반영 제안', { field });
    }
    if (actual.has('filters') && !tagSettling) {
      for (const field of FILTERS) {
        // FIELDS v1 stores Shopify size in the shared master, not a custom reference.
        // No missing reference exists to alert on; size validation remains in ERP.
        if (channel === 'shopify' && field === 'size') {
          check(channel + ':filter_mapping_size', false, '');
          check(channel + ':filter_size', false, '');
          continue;
        }
        const target = expected.filters?.[field];
        // No fabricated Shopify reference or unconfirmed filter mapping fallback.
        if (!target?.length) { add(channel + ':filter_mapping_' + field, '필터 대응값 미확정 — 대표 설정 확인 필요', { field }); continue; }
        check(channel + ':filter_mapping_' + field, false, '');
        check(channel + ':filter_' + field, !target.every(value => s.filters?.[field]?.includes(value)), '채널 필터 누락·불일치', { field });
      }
    }
    for (const field of ['seo_title', 'seo_description'] as const) if (actual.has(field)) {
      check(channel + ':missing_' + field, !existsText(s[field]), '채널 SEO 제목·설명 누락', { field });
    }
    if (actual.has('images')) {
      check(channel + ':alt_missing', !!s.images?.some(i => !existsText(i.alt)), '채널 이미지 설명 누락');
      // A timed-out HEAD is not proof that yesterday's 404 was repaired.
      if (!s.images?.some(i => i.status === undefined)) check(channel + ':image_404', !!s.images?.some(i => i.status === 404), '채널 이미지 404');
      else if (s.images?.some(i => i.status === 404)) add(channel + ':image_404', '채널 이미지 404');
      check(channel + ':image_unknown', !!s.images?.some(i => i.status === undefined || i.status !== 200 && i.status !== 404), '채널 이미지 응답 미확인');
    }
    if (channel === 'shopify' && actual.has('ja')) {
      check('shopify:ja_missing', !existsText(s.ja_description) || !existsText(s.ja_details), '채널 일본어 설명·제품정보 누락');
      const ja = /[\u3040-\u30ff\u3400-\u9fff]/;
      check('shopify:ja_title_prohibited', [s.ja_title, s.ja_meta_title, s.ja_meta_description].some(v => existsText(v) && ja.test(v!)), '日本語 제목·SEO 번역 금지 원칙 위반');
    }
    check(channel + ':verification_incomplete', [...COMPARISONS, 'images', ...(channel === 'shopify' ? ['ja'] : [])]
      .some(field => !actual.has(field)), '전수 점검 일부 자료 미조회 — 정합 확인 불가');
  }
  return { issues, checked: { listing_id: listing.id, kinds: [...checked].sort() } };
}

export function buildMonitorReport(slot: MonitorSlot, scan: MonitorScan, previous: SavedIssue[], now = new Date()) {
  const old = new Map(previous.map(i => [i.listing_id + '\0' + i.kind, i]));
  const top = [...scan.issues].sort((a, b) => a.listing_id.localeCompare(b.listing_id) || a.kind.localeCompare(b.kind));
  const prolonged = top.filter(i => {
    const before = old.get(i.listing_id + '\0' + i.kind);
    if (!before || before.resolved_at || !Number.isFinite(Date.parse(before.first_seen))) return false;
    return Date.parse(kstDay(now)) - Date.parse(kstDay(new Date(before.first_seen))) >= 2 * DAY;
  });
  const limited = top.slice(0, 10).map(i => ({ listing_id: safeId(i.listing_id), kind: i.kind, message: i.message,
    action: 'ERP 값 반영은 상품 등록 화면에서 재승인 후 진행' }));
  const complete = !scan.issues.some(i => /unknown|unavailable|incomplete|mapping/.test(i.kind));
  const sourceHash = scan.source_hash || hash(JSON.stringify([scan.checked, scan.issues]));
  return { id: 'ag_' + hash(slot.id).slice(0, 32), team: '자사몰관리', created_at: now.toISOString(),
    status: scan.issues.length ? 'warn' : 'idle', headline: `자사몰 ${scan.listings}건 · 확인 ${scan.issues.length}건`,
    summary: limited.length ? limited.map(i => `· ${i.listing_id}: ${i.message}`).join('\n') : '· ERP 등록 상품 점검 완료 — 확인 사항 없음',
    // No generic work cards: they would send the office issue to a model-based team runner.
    needs: prolonged.slice(0, 10).map(i => ({ text: `${safeId(i.listing_id)} · ${i.message} · 3일 이상 지속, 대표 결정 필요`,
      listingId: i.listing_id, issueId: i.id, source: 'product_registration' })),
    stats: { total: scan.listings, alerts: scan.issues.length, top10: limited, prolonged: prolonged.length,
      inventory: scan.inventory, reportAvailable: true, ruleBased: true, mode: slot.mode, checkedAt: now.toISOString(),
      complete, evidence: { version: 1, scope: 'shop:' + slot.mode, sourceHash, hash: sourceHash,
        checkedAt: now.toISOString(), complete } },
    model: 'rule-based', trigger: slot.manual ? 'shop_manual' : 'shop_' + slot.mode };
}

/** Race an abort as well as forwarding its signal: a broken adapter must not hold the runner forever. */
async function deadline<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal): Promise<T> {
  const control = new AbortController();
  const relay = () => control.abort();
  parent?.addEventListener('abort', relay, { once: true });
  if (parent?.aborted) relay();
  const timer = setTimeout(relay, ms);
  let rejectAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error('monitor_read_timeout'));
    control.signal.addEventListener('abort', rejectAbort, { once: true });
    if (control.signal.aborted) rejectAbort();
  });
  try { return await Promise.race([fn(control.signal), cancelled]); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', relay); control.signal.removeEventListener('abort', rejectAbort); }
}

// HEAD only, no credentials/redirects. Never fetch a listing-supplied internal URL.
export async function monitorImageHead(url: string, signal: AbortSignal, read: typeof fetch = fetch): Promise<number | undefined> {
  try {
    const u = new URL(url);
    const allowed = ['cdn.shopify.com', 'atlm.kr', 'atlm1224.cafe24.com', 'atlm1224.cafe24img.com'];
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !allowed.includes(u.hostname)) return undefined;
    return await deadline(async s => (await read(u.href, { method: 'HEAD', signal: s, redirect: 'error' })).status, 10_000, signal);
  } catch { return undefined; }
}

export interface MonitorIO {
  settings(signal: AbortSignal): Promise<MonitorSettings>;
  load(signal: AbortSignal): Promise<{ listings: Listing[]; images: ListingImage[]; previous: SavedIssue[]; sizeMaster?: Record<string, { size: string }> }>;
  read: ShopMonitorReader;
  head(url: string, signal: AbortSignal): Promise<number | undefined>;
  claim(slot: MonitorSlot, owner: string): Promise<boolean>;
  finish(slot: MonitorSlot, owner: string, scan: MonitorScan, report: ReturnType<typeof buildMonitorReport>): Promise<boolean>;
  fail(slot: MonitorSlot, owner: string): Promise<void>;
  saved?(slot: MonitorSlot): Promise<{ state: 'completed' | 'running' | 'unknown'; report?: ReturnType<typeof buildMonitorReport> }>;
}
export function createShopMonitor(io: MonitorIO, readTimeoutMs = 120_000) {
  let running = false;
  const run = async (slot: MonitorSlot, now: Date) => {
    const owner = randomUUID();
    if (!await io.claim(slot, owner)) {
      // Manual retries can recover a committed report after a lost HTTP response.
      const saved = slot.manual && io.saved ? await io.saved(slot) : { state: 'unknown' as const };
      return { duplicate: true, ...saved };
    }
    try {
      const { scan, previous } = await deadline(async signal => {
        const data = await io.load(signal);
        const targets = data.listings.filter(l => !['삭제됨', '삭제대기'].includes(l.status)
          && (['승인', '예약됨', '공개됨', '오류'].includes(l.status) || l.cafe24_product_no || l.shopify_product_id));
        const scan: MonitorScan = { issues: [], checked: [], listings: targets.length, inventory: [] };
        const sourceHashes: string[] = [];
        for (const listing of targets) {
          if (signal.aborted) throw new Error('monitor_read_timeout');
          const snapshots: Partial<Record<Channel, ChannelSnapshot>> = {};
          for (const channel of ['cafe24', 'shopify'] as const) {
            if (!(channel === 'cafe24' ? listing.cafe24_product_no : listing.shopify_product_id)) continue;
            // A lightweight daily pass does not read every unpublished draft from providers.
            if (slot.mode === 'daily' && !publiclyVisible(listing) && !listing.preorder_enabled) continue;
            try {
              const snapshot = await io.read(listing, channel, signal);
              if (slot.mode === 'weekly' && snapshot.state === 'ok' && snapshot.checked.includes('images')) {
                for (const image of snapshot.images || []) if (image.status === undefined) image.status = await io.head(image.url, signal);
              }
              snapshots[channel] = snapshot;
            } catch { snapshots[channel] = { state: 'unavailable', checked: [] }; }
          }
          const out = inspectListing(listing, data.images.filter(i => i.listing_id === listing.id), snapshots, slot.mode, now, data.sizeMaster);
          // Unpublished daily rows were intentionally not read; do not report a provider outage.
          if (slot.mode === 'daily' && !publiclyVisible(listing) && !listing.preorder_enabled) {
            out.issues = out.issues.filter(i => !i.kind.endsWith(':unavailable'));
            out.checked.kinds = out.checked.kinds.filter(k => !k.endsWith(':unavailable'));
          }
          scan.issues.push(...out.issues); scan.checked.push(out.checked);
          // Persist only hashes, never raw provider bodies, credentials, descriptions or URLs.
          sourceHashes.push(hash(JSON.stringify([listing, data.images.filter(i => i.listing_id === listing.id), snapshots])));
          const inventory: MonitorScan['inventory'][number] = { listing_id: listing.id };
          for (const channel of ['cafe24', 'shopify'] as const) if (finite(snapshots[channel]?.inventory)) inventory[channel] = snapshots[channel]!.inventory;
          scan.inventory.push(inventory);
        }
        scan.source_hash = hash(JSON.stringify(sourceHashes));
        return { scan, previous: data.previous };
      }, readTimeoutMs);
      const report = buildMonitorReport(slot, scan, previous, now);
      // Completed only inside the DB transaction that actually saved this report.
      if (!await io.finish(slot, owner, scan, report)) throw new Error('monitor_save_failed');
      return { duplicate: false, report };
    } catch {
      await io.fail(slot, owner).catch(() => undefined);
      throw new Error('monitor_run_failed'); // Provider/DB errors may contain credentials: never forward.
    }
  };
  return {
    async tick(now = new Date()) {
      if (running) return { busy: true };
      running = true;
      try {
        const settings = await deadline(s => io.settings(s), 15_000);
        const results = [];
        for (const slot of dueMonitorSlots(settings, now)) {
          try { results.push(await run(slot, now)); } catch { results.push({ failed: true }); }
        }
        return { results };
      } finally { running = false; }
    },
    async manual(mode: MonitorMode, requestId: string, now = new Date()) {
      if (running) return { busy: true };
      running = true;
      try {
        const schedule_id = 'shop_manual_' + mode + '_' + hash(requestId).slice(0, 32), run_date = kstDay(now);
        return await run({ id: schedule_id + '_' + run_date, schedule_id, run_date, mode, manual: true }, now);
      } finally { running = false; }
    },
  };
}

let channelReader: ShopMonitorReader = readMonitorSnapshot;
export function configureShopMonitorReader(reader: ShopMonitorReader) { channelReader = reader; }
async function db(path: string, init: RequestInit = {}, signal?: AbortSignal) {
  return deadline(async s => {
    const r = await restAsServer(path, { ...init, signal: s });
    if (!r.ok) throw new Error('monitor_storage_unavailable');
    return r.status === 204 ? undefined : r.json();
  }, 15_000, signal);
}
const rpc = (name: string, body: unknown) => db('rpc/' + name, { method: 'POST', body: JSON.stringify(body) });
const dbIO: MonitorIO = {
  async settings(signal) {
    const rows = await db('product_registration_settings?id=eq.default&select=monitor_enabled,daily_time,weekly_day,weekly_time', {}, signal);
    if (!validMonitorSettings(rows?.[0])) throw new Error('monitor_settings_unavailable');
    return rows[0];
  },
  async load(signal) {
    const read = (path: string) => restAsServer(path, { signal });
    const [listings, images, previous, sizeMaster] = await Promise.all([
      allRows('product_listings?workspace=eq.LUMEN&status=neq.삭제됨&select=*&order=id.asc', read),
      allRows('product_listing_images?select=*&order=listing_id.asc,position.asc,id.asc', read),
      allRows('product_shop_monitor_issues?resolved_at=is.null&select=*&order=id.asc', read),
      Promise.resolve(bagSizeMaster),
    ]);
    return { listings: listings.map(listingFromRow), images, previous, sizeMaster };
  },
  read: (listing, channel, signal) => channelReader(listing, channel, signal), head: monitorImageHead,
  claim: async (slot, owner) => await rpc('product_shop_monitor_claim', { p_id: slot.id, p_schedule_id: slot.schedule_id,
    p_run_date: slot.run_date, p_owner: owner, p_ttl_seconds: 600 }) === true,
  finish: async (slot, owner, scan, report) => await rpc('product_shop_monitor_finish', { p_id: slot.id, p_owner: owner,
    p_issues: scan.issues, p_checked: scan.checked, p_result: report.stats, p_report: report, p_cards: [] }) === true,
  fail: async (slot, owner) => { await db(`product_shop_monitor_runs?id=eq.${encodeURIComponent(slot.id)}&lease_owner=eq.${encodeURIComponent(owner)}&status=eq.running`,
    { method: 'PATCH', body: JSON.stringify({ status: 'failed' }) }); },
  async saved(slot) {
    const rows = await db(`product_shop_monitor_runs?id=eq.${encodeURIComponent(slot.id)}&select=status&limit=1`);
    if (rows?.[0]?.status !== 'completed') return { state: rows?.[0]?.status === 'running' ? 'running' : 'unknown' };
    const reports = await db(`team_agent_runs?id=eq.${'ag_' + hash(slot.id).slice(0, 32)}&team=eq.${encodeURIComponent('자사몰관리')}&select=*&limit=1`);
    return reports?.[0] ? { state: 'completed', report: reports[0] } : { state: 'unknown' };
  },
};
const runner = createShopMonitor(dbIO);
export function startShopMonitor(reader?: ShopMonitorReader) {
  if (reader) configureShopMonitorReader(reader);
  if (timer) return;
  const tick = () => runner.tick().catch(() => console.warn('[shop-monitor] 점검 저장·조회 미확인'));
  timer = setInterval(tick, 60_000); timer.unref(); void tick();
}
let timer: ReturnType<typeof setInterval> | undefined;

export function createShopMonitorRouter(deps = {
  auth: requireUser() as RequestHandler, settings: () => deadline(s => dbIO.settings(s), 15_000),
  saveSettings: (settings: MonitorSettings, actor: string) => db('product_registration_settings?id=eq.default', {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...settings, updated_by: actor, updated_at: new Date().toISOString() }),
  }), manual: runner.manual,
}) {
  const router = Router(), base = '/api/shop-monitor';
  router.use(base, deps.auth, (req, res, next) => {
    if (!CEO_EMAILS.includes(String(userOf(req)?.email || '').toLowerCase())) { res.status(403).json({ error: 'forbidden' }); return; }
    res.set('Cache-Control', 'no-store'); next();
  });
  router.get(base + '/settings', async (_req, res) => {
    try { res.json(await deps.settings()); } catch { res.status(503).json({ error: 'monitor_settings_unavailable' }); }
  });
  router.put(base + '/settings', async (req, res) => {
    if (!validMonitorSettings(req.body)) { res.status(400).json({ error: 'invalid_monitor_settings' }); return; }
    const { monitor_enabled, daily_time, weekly_time, weekly_day } = req.body;
    try {
      const settings = { monitor_enabled, daily_time, weekly_time, weekly_day };
      const saved = await deps.saveSettings(settings, userOf(req).id);
      if (!Array.isArray(saved) || saved.length !== 1) throw new Error('not_saved');
      res.json(settings);
    } catch { res.status(503).json({ error: 'monitor_settings_save_failed' }); }
  });
  router.post(base + '/run', async (req, res) => {
    if (!['daily', 'weekly'].includes(req.body?.mode) || typeof req.body?.request_id !== 'string'
      || !/^[a-zA-Z0-9_-]{8,100}$/.test(req.body.request_id)) { res.status(400).json({ error: 'invalid_monitor_request' }); return; }
    try {
      const result = await deps.manual(req.body.mode, req.body.request_id);
      res.status('busy' in result ? 409 : 200).json(result);
    } catch { res.status(503).json({ error: 'monitor_run_failed', message: '점검 결과 저장 미확인 — 같은 요청 번호로 다시 확인해 주세요.' }); }
  });
  return router;
}
export default createShopMonitorRouter();
