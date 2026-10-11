import { createHash } from 'node:crypto';
import type { Channel, Listing, ListingImage } from '../../shared/product-registration';

export interface StepEvent { channel: Channel; step: string; key: string; data: Record<string, unknown>; }
export type OnStep = (event: StepEvent) => Promise<void>;
export interface ChannelResult { ok: boolean; id?: string | number; steps: string[]; error?: string; pending_manual?: string[]; }
export type ChannelResults = Partial<Record<Channel, ChannelResult>>;
export interface Runtime {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  signal?: AbortSignal;
}
export const runtime = (overrides: Partial<Runtime> = {}): Runtime => ({
  env: process.env, fetch: globalThis.fetch.bind(globalThis),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), now: Date.now, ...overrides,
});
export function deadlineSignal(signal?: AbortSignal, timeout = 30_000) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
}
export async function pause(rt: Runtime, ms: number) {
  if (rt.signal?.aborted) throw new ChannelError('channel_deadline_exceeded');
  if (!rt.signal) return rt.sleep(ms);
  let listener: (() => void) | undefined;
  try { await Promise.race([rt.sleep(ms), new Promise<never>((_, reject) => {
    listener = () => reject(new ChannelError('channel_deadline_exceeded')); rt.signal!.addEventListener('abort', listener, { once:true });
  })]); } finally { if (listener) rt.signal.removeEventListener('abort', listener); }
}
export function assertWrites(rt: Runtime) {
  if (rt.env.PRODUCT_REGISTRATION_WRITES_ENABLED !== 'true') throw new ChannelError('writes_disabled');
}
export class ChannelError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export class UncertainWrite extends ChannelError {
  constructor() { super('uncertain_write_reconcile_before_retry'); }
}
// Only safe error codes reach public results. Provider bodies may contain credentials or merchant data.
export const errorCode = (error: unknown) => error instanceof ChannelError ? error.code : 'channel_operation_failed';
export function fingerprint(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export async function step<T extends Record<string, unknown>>(
  listing: Listing, channel: Channel, name: string, payload: unknown, onStep: OnStep,
  execute: () => Promise<T>, verify: (data: T) => Promise<boolean>,
): Promise<T> {
  const key = `${channel}:${name}:${fingerprint(payload)}`;
  const old = listing.step_keys?.[key] as { data?: T } | T | undefined;
  const previous = old && ('data' in old ? old.data : old) as T | undefined;
  if (previous && await verify(previous)) return previous;
  // Persist intent BEFORE a non-idempotent write. A lost response must not become a second create.
  await onStep({ channel, step: `${name}:intent`, key: `${key}:intent`, data: { state: 'pending' } });
  const data = await execute();
  if (!await verify(data)) throw new ChannelError(`${channel}_${name}_verification_failed`);
  await onStep({ channel, step: name, key, data });
  listing.step_keys[key] = data;
  return data;
}
export function completedSteps(listing: Listing, channel: Channel, name: string): Record<string, unknown>[] {
  return Object.entries(listing.step_keys || {}).filter(([key]) => key.startsWith(`${channel}:${name}:`) && !key.endsWith(':intent'))
    .map(([, value]: any) => value?.data || value).filter(value => value && typeof value === 'object');
}
export const hasIntent = (listing: Listing, channel: Channel, name: string, payload: unknown) =>
  !!listing.step_keys?.[`${channel}:${name}:${fingerprint(payload)}:intent`];

export interface RequestOptions { write?: boolean; replaySafe?: boolean; headers?: HeadersInit; body?: BodyInit; }
export async function request(rt: Runtime, url: string, method = 'GET', options: RequestOptions = {}): Promise<Response> {
  if (options.write) assertWrites(rt);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (rt.signal?.aborted) throw new ChannelError('channel_deadline_exceeded');
    let response: Response;
    try {
      response = await rt.fetch(url, { method, headers: options.headers, body: options.body,
        signal: deadlineSignal(rt.signal), redirect: 'error' });
    } catch {
      if (rt.signal?.aborted) throw new ChannelError('channel_deadline_exceeded');
      if (options.write && !options.replaySafe) throw new UncertainWrite();
      if (attempt === 3) throw new ChannelError('channel_timeout_or_network_error');
      await pause(rt,500 * 2 ** attempt); continue;
    }
    if (response.ok || response.status === 404) return response;
    const retry = response.status === 429 || response.status >= 500;
    // A 5xx may follow a committed create; only retry reads and explicitly idempotent replacements.
    if (options.write && !options.replaySafe && response.status >= 500) throw new UncertainWrite();
    if (!retry || attempt === 3) throw new ChannelError(`channel_http_${response.status}`);
    const header = response.headers.get('retry-after');
    const retryMs = header ? Math.max(0, Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - rt.now()) : 0;
    await pause(rt,Math.min(60_000, Math.max(retryMs, 500 * 2 ** attempt)));
  }
  throw new ChannelError('channel_retry_exhausted');
}
export async function json(response: Response): Promise<any> {
  if (response.status === 404) throw new ChannelError('channel_not_found');
  try { return await response.json(); } catch { throw new ChannelError('channel_invalid_response'); }
}
export function imageOrder(images: ListingImage[]) {
  return [...images].filter(i => i.role !== 'detail_view').sort((a, b) =>
    Number(b.role === 'main') - Number(a.role === 'main') || a.position - b.position);
}
export async function sourceBytes(rt: Runtime, image: ListingImage): Promise<Buffer> {
  // ERP originals are Shopify Files. No arbitrary URL fetches/redirects/internal network access.
  const url = new URL(image.source_url);
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.shopify.com' || url.username || url.password)
    throw new ChannelError('untrusted_image_source');
  const response = await request(rt, url.href);
  if (!response.ok || !/^image\/(jpeg|png|webp|gif)$/.test((response.headers.get('content-type') || '').split(';')[0]))
    throw new ChannelError('invalid_image_source');
  const reader = response.body?.getReader();
  if (!reader) throw new ChannelError('invalid_image_source');
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break;
    length += part.value.length; if (length > 10 * 1024 * 1024) throw new ChannelError('image_too_large'); chunks.push(part.value);
  } } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
