// Daily Check 데이터 브리지 — ERP에서 Daily(매출·재고 등) 데이터를 읽는 공용 계층.
// 같은 도커 네트워크의 daily(http://daily:8000)를 서비스 JWT로 호출 (읽기 전용 원칙).
import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';

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
export async function dailyFetch(path: string): Promise<unknown> {
  const r = await fetch(`${DAILY_URL}${path}`, {
    headers: { Authorization: `Bearer ${mintServiceToken()}` },
  });
  if (!r.ok) throw new Error(`daily ${path} → ${r.status}`);
  return r.json();
}

// 브리지 증명·요약 — 로그인 세션 보유자만 (미들웨어 없이 간단 검증)
function hasValidSession(req: Request): boolean {
  const bearer = req.headers.authorization || '';
  const cookie = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith('erp_token='));
  const token = bearer.toLowerCase().startsWith('bearer ')
    ? bearer.slice(7)
    : cookie ? decodeURIComponent(cookie.slice('erp_token='.length)) : '';
  if (!token || token.split('.').length !== 3) return false;
  try {
    const [h, b, s] = token.split('.');
    const expected = b64url(crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest());
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return false;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString()) as { exp?: number };
    return Number(payload.exp || 0) * 1000 > Date.now();
  } catch { return false; }
}

router.get('/api/bridge/daily/summary', async (req: Request, res: Response) => {
  try {
    if (!hasValidSession(req)) { res.status(401).json({ error: 'unauthorized' }); return; }
    const health = await dailyFetch('/api/health');
    res.json({ daily: health });
  } catch (e) {
    console.error('daily bridge 실패:', e);
    res.status(502).json({ error: 'daily_unavailable' });
  }
});

export default router;
