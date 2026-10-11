import { randomUUID } from 'node:crypto';
import { restAsServer } from '../auth';
import { ChannelError, deadlineSignal, json, request, type Runtime } from './common';

export interface ChannelToken { access_token: string; refresh_token: string; expires_at: string; refresh_expires_at?: string | null; }
export interface TokenStore {
  read(signal?: AbortSignal): Promise<ChannelToken | null>;
  claim(owner: string): Promise<ChannelToken | null>;
  save(owner: string, token: ChannelToken): Promise<void>;
  release(owner: string): Promise<void>;
}
const rpc = async (name: string, body: unknown) => {
  const response = await restAsServer(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new ChannelError('cafe24_token_store_failed');
  return response.json();
};
function tokenStore(channel: 'cafe24_erp' | 'cafe24_ads'): TokenStore {
  const table = channel === 'cafe24_ads' ? 'ads_channel_tokens' : 'channel_tokens';
  return {
  async read(signal) {
    const r = await restAsServer(`${table}?channel=eq.${channel}&select=access_token,refresh_token,expires_at,refresh_expires_at`, { signal: deadlineSignal(signal,10_000) });
    if (!r.ok) throw new ChannelError('cafe24_token_store_failed');
    return (await r.json())[0] || null;
  },
  async claim(owner) { const value = await rpc(channel === 'cafe24_ads' ? 'ads_commerce_token_claim' : 'product_registration_token_claim', { p_owner: owner, p_ttl_seconds: 90 }); return Array.isArray(value) ? value[0] || null : null; },
  async save(owner, token) {
    const r = await restAsServer(`${table}?channel=eq.${channel}&lease_owner=eq.${encodeURIComponent(owner)}&lease_until=gt.${encodeURIComponent(new Date().toISOString())}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ ...token, lease_owner: null, lease_until: null, updated_at: new Date().toISOString() }),
    });
    if (!r.ok || (await r.json()).length !== 1) throw new ChannelError('cafe24_token_lease_lost');
  },
  async release(owner) {
    const r = await restAsServer(`${table}?channel=eq.${channel}&lease_owner=eq.${encodeURIComponent(owner)}`, {
      method: 'PATCH', signal: AbortSignal.timeout(10_000), body: JSON.stringify({ lease_owner: null, lease_until: null }),
    });
    if (!r.ok) throw new ChannelError('cafe24_token_store_failed');
  },
  };
}
export const dbTokenStore = tokenStore('cafe24_erp');
export const dbAdsTokenStore = tokenStore('cafe24_ads');
export function cafe24Auth(rt: Runtime, tokens: TokenStore = dbTokenStore, validateNext?: (value: any, now: number) => ChannelToken) {
  const configured = () => !!rt.env.CAFE24_ERP_CLIENT_ID && !!rt.env.CAFE24_ERP_CLIENT_SECRET;
  const validate = (token: ChannelToken | null) => {
    if (!token?.access_token || !token.refresh_token) throw new ChannelError('cafe24_erp_app_unconnected');
    return token;
  };
  return {
    configured,
    async token(allowRefresh = true): Promise<string> {
      if (!configured()) throw new ChannelError('cafe24_erp_app_unconnected');
      const old = validate(await tokens.read(rt.signal));
      if (Date.parse(old.expires_at) > rt.now() + 60_000) return old.access_token;
      if (!allowRefresh) throw new ChannelError('cafe24_token_expired_readonly');
      if (rt.env.PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED !== 'true') throw new ChannelError('cafe24_oauth_refresh_disabled');
      const owner = randomUUID(); const claimed = await tokens.claim(owner);
      if (!claimed) throw new ChannelError('cafe24_token_refresh_busy');
      try {
        const current = validate(claimed);
        if (Date.parse(current.expires_at) > rt.now() + 60_000) return current.access_token;
        if (current.refresh_expires_at && Date.parse(current.refresh_expires_at) <= rt.now()) throw new ChannelError('cafe24_reauthorization_required');
        const oauthRuntime: Runtime = {...rt,env:{...rt.env,PRODUCT_REGISTRATION_WRITES_ENABLED:'true'}};
        const response = await request(oauthRuntime, 'https://atlm1224.cafe24api.com/api/v2/oauth/token', 'POST', {
          // Separate capability: this exact fixed OAuth URL never mutates merchant products.
          // Keep request's unsafe-write retry semantics with an isolated local gate.
          write: true, headers: { Authorization: `Basic ${Buffer.from(`${rt.env.CAFE24_ERP_CLIENT_ID}:${rt.env.CAFE24_ERP_CLIENT_SECRET}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refresh_token }),
        });
        const next = await json(response);
        if (!next.access_token || !next.refresh_token || !next.expires_at) throw new ChannelError('cafe24_invalid_refresh_response');
        // Do not retry a rotating OAuth request. If persistence fails, require operator recovery.
        await tokens.save(owner, validateNext ? validateNext(next, rt.now()) : { access_token: next.access_token, refresh_token: next.refresh_token,
          expires_at: next.expires_at, refresh_expires_at: next.refresh_token_expires_at || current.refresh_expires_at });
        return next.access_token;
      } finally { await tokens.release(owner); }
    },
  };
}
