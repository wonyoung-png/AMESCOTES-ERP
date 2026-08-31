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
  // 여정 이벤트 (2026-08-27 확장)
  'page_viewed',
  'collection_viewed',
  'search_submitted',
  'product_viewed',
  'product_added_to_cart',
  'cart_viewed',
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
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Pixel-Key');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

// 픽셀 코드에 박힌 공개 키 — 비밀은 아니고(픽셀 소스는 공개) 무작위 스캐너의 스팸 insert만 거른다
const PIXEL_KEY = 'atlm-ckfnl-2026';
// ponytail: 전역 분당 카운터 — 실 트래픽(분당 수십 건) 대비 넉넉, 폭주 시 429
let rlWindow = 0;
let rlCount = 0;

router.post('/api/pixel/checkout', express.json({ limit: '64kb' }), async (req: Request, res: Response) => {
  try {
    if (req.headers['x-pixel-key'] !== PIXEL_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
    const now = Math.floor(Date.now() / 60_000);
    if (now !== rlWindow) { rlWindow = now; rlCount = 0; }
    if (++rlCount > 1200) { res.status(429).json({ error: 'rate_limited' }); return; }
    const b = req.body || {};
    if (!EVENTS.has(String(b.event))) { res.status(400).json({ error: 'bad_event' }); return; }
    const row = {
      event: String(b.event),
      checkout_token: String(b.checkout_token || '').slice(0, 64) || null,
      client_id: String(b.client_id || '').slice(0, 64) || null,
      country: String(b.country || '').slice(0, 8) || null,
      currency: String(b.currency || '').slice(0, 8) || null,
      total: Number.isFinite(Number(b.total)) ? Number(b.total) : null,
      path: String(b.path || '').slice(0, 200) || null,
      shop: b.shop === 'kr' ? 'kr' : 'intl',
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
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    const from = DATE.test(String(req.query.from)) ? String(req.query.from) : null;
    const to = DATE.test(String(req.query.to)) ? String(req.query.to) : null;
    // from/to(날짜)가 오면 그 범위, 없으면 최근 N일
    let range = `created_at=gte.${new Date(Date.now() - days * 86400_000).toISOString()}`;
    if (from) {
      range = `created_at=gte.${from}T00:00:00Z`;
      if (to) range += `&created_at=lte.${to}T23:59:59Z`;
    }
    // 체크아웃 6종만 — v2 여정 이벤트(page/product/cart)가 퍼널에 섞이면 안 됨
    const shop = req.query.shop === 'kr' ? 'kr' : 'intl';
    const ckFilter = `event=in.(${STEP_ORDER.join(',')})&shop=eq.${shop}`;
    const r = await fetch(
      `${PGRST_URL}/checkout_events?select=event,checkout_token,client_id,country,created_at&${range}&${ckFilter}&order=created_at.desc&limit=50000`,
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

    // 누적 도달 방식 — 뒷단계 이벤트가 있으면 앞단계도 도달한 것으로 센다.
    // (이벤트 유실·익스프레스 결제의 단계 건너뜀이 퍼널을 역전시키지 않게)
    const maxStep = (t: { events: Set<string> }) => {
      let m = -1;
      STEP_ORDER.forEach((ev, i) => { if (t.events.has(ev)) m = i; });
      return m;
    };
    const tokens = [...byToken.values()];
    const steps = STEP_ORDER.map((ev, i) => ({
      event: ev,
      count: tokens.filter(t => maxStep(t) >= i).length,
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
    res.json({ days, from, to, total_checkouts: byToken.size, steps, countries, daily });
  } catch (e) {
    console.error('[pixel] 퍼널 집계 실패:', String(e).split('\n')[0]);
    res.status(502).json({ error: 'funnel_failed' });
  }
});

// 전체 여정 집계 — 방문(첫/재방문) → 상품뷰 → 카트담기 → 체크아웃 → 구매 (공개 GET, 집계값만)
router.get('/api/pixel/journey', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const shop = req.query.shop === 'kr' ? 'kr' : 'intl';
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const r = await fetch(
      `${PGRST_URL}/checkout_events?select=event,client_id,path,total,created_at&created_at=gte.${since}&shop=eq.${shop}&order=created_at.asc&limit=100000`,
      { headers: { Authorization: `Bearer ${mintServiceToken()}` } },
    );
    if (!r.ok) throw new Error(`postgrest ${r.status}`);
    const rows = (await r.json()) as { event: string; client_id: string | null; path: string | null; total: number | null; created_at: string }[];

    // 기간 시작 전 이력 보유 브라우저 = 재방문 판정용 (client_first_seen 뷰)
    const fsRes = await fetch(
      `${PGRST_URL}/client_first_seen?select=client_id&first_seen=lt.${since}&limit=200000`,
      { headers: { Authorization: `Bearer ${mintServiceToken()}` } },
    );
    const oldClients = new Set(
      fsRes.ok ? ((await fsRes.json()) as { client_id: string }[]).map(x => x.client_id) : [],
    );

    const SESSION_GAP = 30 * 60_000; // 세션 = 30분 무활동 단절
    const byClient = new Map<string, { id: string; events: Set<string>; lastTs: number; sessions: number }>();
    const prod = new Map<string, { views: number; adds: number }>();
    const searches = new Map<string, number>();
    const daily = new Map<string, { visitors: Set<string>; adds: number; checkouts: number; completed: number }>();
    for (const row of rows) {
      const cid = row.client_id || 'anon';
      const ts = Date.parse(row.created_at);
      let c = byClient.get(cid);
      if (!c) { c = { id: cid, events: new Set(), lastTs: 0, sessions: 0 }; byClient.set(cid, c); }
      c.events.add(row.event);
      if (ts - c.lastTs > SESSION_GAP) c.sessions += 1;
      c.lastTs = ts;
      const d = row.created_at.slice(0, 10);
      let dd = daily.get(d);
      if (!dd) { dd = { visitors: new Set(), adds: 0, checkouts: 0, completed: 0 }; daily.set(d, dd); }
      dd.visitors.add(cid);
      if (row.event === 'product_added_to_cart') dd.adds += 1;
      if (row.event === 'checkout_started') dd.checkouts += 1;
      if (row.event === 'checkout_completed') dd.completed += 1;
      if (row.path && (row.event === 'product_viewed' || row.event === 'product_added_to_cart')) {
        let p = prod.get(row.path);
        if (!p) { p = { views: 0, adds: 0 }; prod.set(row.path, p); }
        if (row.event === 'product_viewed') p.views += 1; else p.adds += 1;
      }
      if (row.path && row.event === 'search_submitted') {
        searches.set(row.path, (searches.get(row.path) || 0) + 1);
      }
    }
    const clients = [...byClient.values()];
    const has = (ev: string) => clients.filter(c => c.events.has(ev)).length;
    res.json({
      days,
      visitors: {
        total: byClient.size, // 브라우저 기준 추정 방문자 (사파리 쿠키 제한으로 과대 가능)
        returning: clients.filter(c => oldClients.has(c.id)).length,
        sessions: clients.reduce((s, c) => s + c.sessions, 0),
      },
      steps: [
        { step: 'visited', count: byClient.size },
        { step: 'explored', count: clients.filter(c => c.events.has('collection_viewed') || c.events.has('search_submitted')).length },
        { step: 'product_viewed', count: has('product_viewed') },
        { step: 'added_to_cart', count: has('product_added_to_cart') },
        { step: 'checkout_started', count: has('checkout_started') },
        { step: 'completed', count: has('checkout_completed') },
      ],
      top_products: [...prod.entries()]
        .map(([path, v]) => ({ path, ...v }))
        .sort((a, b) => b.views - a.views).slice(0, 30),
      top_searches: [...searches.entries()]
        .map(([q, n]) => ({ q, n }))
        .sort((a, b) => b.n - a.n).slice(0, 30),
      daily: Object.fromEntries([...daily.entries()].map(([d, v]) => [d, {
        visitors: v.visitors.size, adds: v.adds, checkouts: v.checkouts, completed: v.completed,
      }])),
    });
  } catch (e) {
    console.error('[pixel] journey 집계 실패:', String(e).split('\n')[0]);
    res.status(502).json({ error: 'journey_failed' });
  }
});

// 원시 이벤트 (AI 분석용) — 토큰은 앞 8자로 절단해 비식별화, 공개 GET
router.get('/api/pixel/events', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const shop = req.query.shop === 'kr' ? 'kr' : 'intl';
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const r = await fetch(
      `${PGRST_URL}/checkout_events?select=event,checkout_token,country,total,created_at&created_at=gte.${since}&shop=eq.${shop}&event=neq.page_viewed&order=created_at.asc&limit=2000`,
      { headers: { Authorization: `Bearer ${mintServiceToken()}` } },
    );
    if (!r.ok) throw new Error(`postgrest ${r.status}`);
    const rows = (await r.json()) as Record<string, unknown>[];
    res.json(rows.map(row => ({ ...row, checkout_token: String(row.checkout_token || '').slice(0, 8) })));
  } catch (e) {
    console.error('[pixel] events 조회 실패:', String(e).split('\n')[0]);
    res.status(502).json({ error: 'events_failed' });
  }
});

export default router;
