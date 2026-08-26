// Shopify 체크아웃 웹픽셀 수집 — intl.atlm.kr 체크아웃 단계별 이탈 측정용.
// 브라우저(샌드박스 픽셀)에서 직접 POST하므로 무인증 + CORS 개방, insert 전용.
import { Router, type Request, type Response } from 'express';
import express from 'express';
import crypto from 'crypto';

const router = Router();
const SECRET = process.env.PGRST_JWT_SECRET || '';
const PGRST_URL = process.env.PGRST_URL || 'http://postgrest:3000';

const EVENTS = new Set([
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_address_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'checkout_completed',
]);

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintServiceToken(ttlSec = 60): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify({
    role: 'anon', iss: 'pixel', exp: Math.floor(Date.now() / 1000) + ttlSec,
  })));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

router.use('/api/pixel', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

router.post('/api/pixel/checkout', express.json({ limit: '64kb' }), async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    if (!EVENTS.has(String(b.event))) { res.status(400).json({ error: 'bad_event' }); return; }
    const row = {
      event: String(b.event),
      checkout_token: String(b.checkout_token || '').slice(0, 64) || null,
      client_id: String(b.client_id || '').slice(0, 64) || null,
      country: String(b.country || '').slice(0, 8) || null,
      currency: String(b.currency || '').slice(0, 8) || null,
      total: Number.isFinite(Number(b.total)) ? Number(b.total) : null,
    };
    const r = await fetch(`${PGRST_URL}/checkout_events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintServiceToken()}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error(`postgrest ${r.status}: ${await r.text()}`);
    res.status(204).end();
  } catch (e) {
    console.error('[pixel] 저장 실패:', String(e).split('\n')[0]);
    res.status(502).json({ error: 'store_failed' });
  }
});

// 단계 순서 — 퍼널 표시용
const STEP_ORDER = [
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_address_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'checkout_completed',
];

// 퍼널 집계 — 민감정보 없는 집계값이라 공개 GET (PMS 체크아웃 퍼널 탭이 호출)
router.get('/api/pixel/funnel', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const r = await fetch(
      `${PGRST_URL}/checkout_events?select=event,checkout_token,client_id,country,created_at&created_at=gte.${since}&limit=50000`,
      { headers: { Authorization: `Bearer ${mintServiceToken()}` } },
    );
    if (!r.ok) throw new Error(`postgrest ${r.status}`);
    const rows = (await r.json()) as {
      event: string; checkout_token: string | null; client_id: string | null;
      country: string | null; created_at: string;
    }[];

    // 체크아웃 1건 = checkout_token (없으면 client_id) 기준으로 이벤트 집합을 모은다
    const byToken = new Map<string, { events: Set<string>; country: string | null; first: string }>();
    for (const row of rows) {
      const key = row.checkout_token || row.client_id || `anon-${row.created_at}`;
      let t = byToken.get(key);
      if (!t) { t = { events: new Set(), country: null, first: row.created_at }; byToken.set(key, t); }
      t.events.add(row.event);
      if (row.country) t.country = row.country;
      if (row.created_at < t.first) t.first = row.created_at;
    }

    const steps = STEP_ORDER.map(ev => ({
      event: ev,
      count: [...byToken.values()].filter(t => t.events.has(ev)).length,
    }));
    const countries: Record<string, { started: number; completed: number }> = {};
    const daily: Record<string, { started: number; completed: number }> = {};
    for (const t of byToken.values()) {
      const c = t.country || '(미입력)';
      countries[c] = countries[c] || { started: 0, completed: 0 };
      countries[c].started += 1;
      const d = t.first.slice(0, 10);
      daily[d] = daily[d] || { started: 0, completed: 0 };
      daily[d].started += 1;
      if (t.events.has('checkout_completed')) { countries[c].completed += 1; daily[d].completed += 1; }
    }
    res.json({ days, total_checkouts: byToken.size, steps, countries, daily });
  } catch (e) {
    console.error('[pixel] 퍼널 집계 실패:', String(e).split('\n')[0]);
    res.status(502).json({ error: 'funnel_failed' });
  }
});

export default router;
