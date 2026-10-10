// Daily Check 데이터 브리지 — ERP에서 Daily(매출·재고 등) 데이터를 읽는 공용 계층.
// 조회는 같은 도커 네트워크의 Daily를 서비스 JWT로 읽고, 목표 쓰기는 실제 사용자 JWT를 전달한다.
import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { requireUser, parseCookie } from './auth.js';

const router = Router();
const SECRET = process.env.PGRST_JWT_SECRET || '';
const DAILY_URL = process.env.DAILY_URL || 'http://daily:8000';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintServiceToken(ttlSec = 60): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify({
    role: 'anon', iss: 'erp-bridge', exp: Math.floor(Date.now() / 1000) + ttlSec,
  })));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

/** Daily API 호출 헬퍼 — 교차 기능 개발 시 재사용 */
export async function dailyFetch(path: string, timeoutMs = 30000): Promise<unknown> {
  const r = await fetch(`${DAILY_URL}${path}`, {
    headers: { Authorization: `Bearer ${mintServiceToken()}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`daily ${path} → ${r.status}`);
  return r.json();
}

// ERP 공통 인증으로 현재 계정 활성 상태·대표 전용 제한까지 확인한다.
router.get('/api/bridge/daily/summary', requireUser(), async (_req: Request, res: Response) => {
  try {
    const health = await dailyFetch('/api/health');
    res.json({ daily: health });
  } catch (e) {
    console.error('daily bridge 실패:', e);
    res.status(502).json({ error: 'daily_unavailable' });
  }
});

export function validDailyBrand(brand: unknown): brand is string {
  return brand === 'lumen' || brand === 'aetaloof';
}
export function validDailyGoal(value: any) {
  return !!value && typeof value.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)
    && Number.isFinite(value.amount) && value.amount >= 0 && value.amount <= Number.MAX_SAFE_INTEGER;
}
router.get('/api/bridge/daily/brand', requireUser(), async (req, res) => {
  const brand = req.query.brand;
  if (!validDailyBrand(brand)) { res.status(400).json({ message: '브랜드를 확인해주세요' }); return; }
  try { res.json(await dailyFetch(`/api/dashboard/brand?brand=${brand}`)); }
  catch (e) { console.error('[daily bridge] brand', e); res.status(502).json({ message: '브랜드 운영 조회에 실패했습니다' }); }
});
router.post('/api/bridge/daily/goals', requireUser(), async (req, res) => {
  const brand = req.query.brand;
  if (!validDailyBrand(brand) || !validDailyGoal(req.body)) {
    res.status(400).json({ message: '브랜드·목표월·금액을 확인해주세요' }); return;
  }
  try {
    // 쓰기는 서비스 계정이 아니라 검증된 실제 사용자의 토큰을 전달한다.
    const token = parseCookie(req.headers.cookie, 'erp_token') || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const r = await fetch(`${DAILY_URL}/api/dashboard/goals?brand=${brand}`, {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Brand': brand },
      body: JSON.stringify({ month: req.body.month, amount: req.body.amount }),
    });
    if (!r.ok) { res.status(r.status >= 500 ? 502 : r.status).json({ message: '목표 저장에 실패했습니다' }); return; }
    res.json(await r.json());
  } catch (e) { console.error('[daily bridge] goals', e); res.status(502).json({ message: '목표 저장 결과를 확인하지 못했습니다 — 다시 조회해주세요' }); }
});
export default router;
