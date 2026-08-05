// 서버 검증 로그인 — Basic Auth 게이트 제거 후의 보안 경계.
// 성공 시 PGRST_JWT_SECRET으로 서명한 12시간 토큰 발급 → PostgREST 접근은 이 토큰으로만 가능.
import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';

const router = Router();

const SECRET = process.env.PGRST_JWT_SECRET || '';
const POSTGREST_URL = process.env.POSTGREST_URL || 'http://postgrest:3000';
const SESSION_HOURS = 12;
// PMS SSO — 서브도메인 모듈(daily 등)이 같은 세션을 쓰도록 상위 도메인 쿠키 발급
const COOKIE_DOMAIN = process.env.PMS_COOKIE_DOMAIN || '';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJwt(payload: Record<string, unknown>): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

// client/src/lib/auth.ts simpleHash와 동일 알고리즘 (기존 저장 해시 호환)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

router.post('/api/login', async (req: Request, res: Response) => {
  try {
    if (!SECRET) { res.status(500).json({ error: 'server_not_configured' }); return; }
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) { res.status(400).json({ error: 'missing_credentials' }); return; }

    const now = Math.floor(Date.now() / 1000);
    const svcToken = signJwt({ role: 'anon', iss: 'erp-server', exp: now + 60 });
    const r = await fetch(
      `${POSTGREST_URL}/app_users?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=*`,
      { headers: { Authorization: `Bearer ${svcToken}` } },
    );
    if (!r.ok) { res.status(502).json({ error: 'db_unavailable' }); return; }
    const rows = (await r.json()) as Array<Record<string, unknown>>;
    const u = rows[0];

    if (!u || !u.is_active || u.password_hash !== simpleHash(password)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    const exp = now + SESSION_HOURS * 3600;
    const token = signJwt({ role: 'anon', iss: 'erp-server', email: u.email, name: u.name, exp });
    res.cookie('erp_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: SESSION_HOURS * 3600 * 1000,
      ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    });
    res.json({
      token,
      user: {
        id: u.id, email: u.email, name: u.name, role: u.role,
        passwordHash: '', isActive: u.is_active, createdAt: u.created_at,
      },
    });
  } catch (e) {
    console.error('POST /api/login 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/api/logout', (_req: Request, res: Response) => {
  res.clearCookie('erp_token', { ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}) });
  res.json({ ok: true });
});

export default router;
