import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { CEO_EMAILS, currentUser, parseCookie, restAsServer } from '../auth';
import { dbAdsTokenStore, type ChannelToken } from './cafe24-auth';
import { ChannelError, json, request, runtime, type Runtime } from './common';

export const CAFE24_CALLBACK = 'https://erp.ameserp.kr/api/ads-council/cafe24/callback';
const prefix = '/api/ads-council/cafe24';
const cookie = '__Secure-erp_cafe24_state';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: prefix };
const readScopes = ['mall.read_order', 'mall.read_store'];

// This dedicated app is read-only for merchant data. Application management is Cafe24's mandatory scope.
export function cafe24ReadToken(value: any, now: number): ChannelToken {
  if (value?.mall_id !== 'atlm1224' || !Array.isArray(value.scopes) ||
      !readScopes.every(s => value.scopes.includes(s)) ||
      value.scopes.some((s: unknown) => ![...readScopes, 'mall.read_application', 'mall.write_application'].includes(String(s))))
    throw new ChannelError('cafe24_read_scope_required');
  const token = (v: unknown) => typeof v === 'string' && /^[^\s\x00-\x1f]{16,2048}$/.test(v);
  const date = (v: unknown) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(v))
      throw new ChannelError('cafe24_invalid_token_expiry');
    // The new app's timezone is explicitly Asia/Seoul, including offset-less token responses.
    const n = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? v : v + '+09:00');
    if (!Number.isFinite(n) || n <= now + 60_000) throw new ChannelError('cafe24_invalid_token_expiry');
    return new Date(n).toISOString();
  };
  if (!token(value.access_token) || !token(value.refresh_token)) throw new ChannelError('cafe24_invalid_token_response');
  return { access_token: value.access_token, refresh_token: value.refresh_token,
    expires_at: date(value.expires_at), refresh_expires_at: date(value.refresh_token_expires_at) };
}

export function createCafe24ConnectRouter(overrides: Partial<{
  authenticate: typeof currentUser; rt: Runtime; tokens: typeof dbAdsTokenStore; rest: typeof restAsServer;
}> = {}) {
  const io = { authenticate: currentUser, rt: runtime(), tokens: dbAdsTokenStore, rest: restAsServer, ...overrides };
  const router = Router();
  const pending = new Map<string, { userId: string; expires: number }>();
  router.use(prefix, async (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    try {
      const user = await io.authenticate(req);
      if (!user || user.role !== '대표' || !CEO_EMAILS.includes(user.email.toLowerCase())) {
        res.status(403).json({ error: 'cafe24_owner_required' }); return;
      }
      if (io.rt.env.CAFE24_ADS_OAUTH_REFRESH_ENABLED !== 'true' ||
          io.rt.env.CAFE24_ADS_CLIENT_ID !== 'x9IHHNGgMF9jcc0YAyb0jB' || !io.rt.env.CAFE24_ADS_CLIENT_SECRET) {
        res.status(503).json({ error: 'cafe24_auth_unconfigured' }); return;
      }
      res.locals.cafe24Owner = user.id;
      next();
    } catch { res.status(503).json({ error: 'cafe24_auth_unavailable' }); }
  });
  router.get(prefix + '/authorize', (req, res) => {
    // Do not let an external navigation initiate an OAuth flow using an existing CEO session.
    if (!['same-origin', 'none'].includes(req.get('sec-fetch-site') || '')) {
      res.status(403).json({ error: 'cafe24_same_origin_required' }); return;
    }
    for (const [key, entry] of pending) if (entry.expires <= io.rt.now()) pending.delete(key);
    if (pending.size >= 50) { res.status(429).json({ error: 'cafe24_auth_busy' }); return; }
    const state = randomUUID();
    pending.set(state, { userId: res.locals.cafe24Owner, expires: io.rt.now() + 600_000 });
    res.cookie(cookie, state, { ...cookieOptions, maxAge: 600_000 });
    const params = new URLSearchParams({ response_type: 'code', client_id: io.rt.env.CAFE24_ADS_CLIENT_ID!,
      redirect_uri: CAFE24_CALLBACK, scope: readScopes.join(','), state });
    res.redirect(302, 'https://atlm1224.cafe24api.com/api/v2/oauth/authorize?' + params);
  });
  router.get(prefix + '/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    let supplied = '';
    try { supplied = parseCookie(req.headers.cookie, cookie); } catch { /* malformed cookies are rejected */ }
    const entry = pending.get(state);
    if (!entry || state !== supplied || entry.expires <= io.rt.now() || entry.userId !== res.locals.cafe24Owner) {
      res.status(400).json({ error: 'cafe24_invalid_state' }); return;
    }
    pending.delete(state);
    res.clearCookie(cookie, cookieOptions);
    if (req.query.error || typeof req.query.code !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(req.query.code)) {
      res.status(400).json({ error: 'cafe24_authorization_denied' }); return;
    }
    const owner = randomUUID();
    let claimed = false;
    try {
      // Existing token schema already exists. Seed only an empty auth record, never overwrite a live token.
      const seed = await io.rest('ads_channel_tokens?on_conflict=channel', { method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates' }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ channel: 'cafe24_ads', access_token: '', refresh_token: '', expires_at: '1970-01-01T00:00:00Z' }) });
      if (!seed.ok) throw new ChannelError('cafe24_token_store_failed');
      const old = await io.tokens.claim(owner);
      if (!old) throw new ChannelError('cafe24_token_refresh_busy');
      claimed = true;
      // Initial setup only. Reconnection requires explicit operator recovery, not silent token rotation.
      if (old.access_token || old.refresh_token) throw new ChannelError('cafe24_already_connected');
      const response = await request({ ...io.rt, env: { ...io.rt.env, PRODUCT_REGISTRATION_WRITES_ENABLED: 'true' } },
        'https://atlm1224.cafe24api.com/api/v2/oauth/token', 'POST', { write: true,
          headers: { Authorization: 'Basic ' + Buffer.from(io.rt.env.CAFE24_ADS_CLIENT_ID + ':' + io.rt.env.CAFE24_ADS_CLIENT_SECRET).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: CAFE24_CALLBACK }) });
      const next = cafe24ReadToken(await json(response), io.rt.now());
      await io.tokens.save(owner, next);
      res.redirect(302, '/ads-analysis?ws=LUMEN&auth=cafe24-connected');
    } catch (error) {
      const code = error instanceof ChannelError && /^cafe24_[a-z_]+$/.test(error.code) ? error.code : 'cafe24_auth_failed';
      res.status(503).json({ error: code });
    } finally {
      if (claimed) await io.tokens.release(owner).catch(() => {});
    }
  });
  return router;
}
