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

export default router;
