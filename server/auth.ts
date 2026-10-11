// 세션 공용부 — session.ts 안에만 있던 토큰 검증을 다른 라우터도 쓸 수 있게 뺐다.
//
// 접수함처럼 "누가 올렸나"가 기록으로 남는 기능은 클라이언트가 보낸 사용자 id 를 믿으면 안 된다.
// 쿠키를 서버에서 열어 app_users 를 다시 읽어야 한다.
import crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

const SECRET = process.env.PGRST_JWT_SECRET || '';
const POSTGREST_URL = process.env.POSTGREST_URL || 'http://postgrest:3000';
const PRIVATE_MODE = process.env.ERP_PRIVATE_MODE === 'true';
const readSignal = new AsyncLocalStorage<AbortSignal>();
/** Bound a scheduler's read-only context without changing unrelated requests. */
export const withServerReadSignal = <T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> => readSignal.run(signal, read);

export function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signJwt(payload: Record<string, unknown>): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string): Record<string, unknown> | null {
  if (!SECRET || !token || token.split('.').length !== 3) return null;
  try {
    const [h, b, s] = token.split('.');
    const expected = b64url(crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest());
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString()) as Record<string, unknown>;
    if (Number(payload.exp || 0) * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookie(header: string | undefined, name: string): string {
  if (!header) return '';
  const m = header.split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}

/**
 * 서버가 PostgREST 를 부를 때 쓰는 단명 토큰.
 *
 * 직원 화면도 똑같이 role:'anon' 으로 붙는다. 그래서 접수함처럼 "서버를 거쳐야만" 하는 것은
 * anon 권한으로는 손댈 수 없게 해 두고, 여기서만 erp_server 역할을 쓴다 (코덱스 지적).
 */
export function serviceToken(seconds = 60, role = 'anon'): string {
  return signJwt({ role, iss: 'erp-server', exp: Math.floor(Date.now() / 1000) + seconds });
}

export async function rest(path: string, init: RequestInit & { role?: string } = {}): Promise<Response_> {
  const { role, ...rest_ } = init;
  return fetch(`${POSTGREST_URL}/${path}`, {
    ...rest_,
    signal: rest_.signal ?? (['GET', 'HEAD'].includes((rest_.method || 'GET').toUpperCase()) ? readSignal.getStore() : undefined),
    headers: {
      Authorization: `Bearer ${serviceToken(60, role || 'anon')}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  }) as unknown as Response_;
}

/** 접수함 전용 — anon 으로는 막혀 있는 테이블·함수를 부른다 */
export const restAsServer = (path: string, init: RequestInit = {}) =>
  rest(path, { ...init, role: 'erp_server' });
type Response_ = { ok: boolean; status: number; headers?: Pick<Headers, 'get'>; json(): Promise<any>; text(): Promise<string> };

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export const CEO_EMAILS = ['wonyoung@atlm.kr'];
export const privateAccessAllowed = (email: string, enabled = PRIVATE_MODE) =>
  !enabled || CEO_EMAILS.includes(email.toLowerCase());

/**
 * 쿠키(또는 Authorization 헤더)의 토큰으로 지금 로그인한 사람을 찾는다.
 * 토큰에 든 email 로 app_users 를 다시 읽는다 — 역할이 바뀌었거나 계정이 꺼졌으면 그 즉시 막힌다.
 */
export async function currentUser(req: Request): Promise<SessionUser | null> {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = parseCookie(req.headers.cookie, 'erp_token') || bearer;
  const payload = verifyJwt(token);
  if (!payload?.email) return null;
  try {
    // app_users 는 anon 권한을 거뒀다 (password_hash 노출). 서버 역할로 읽는다
    const r = await rest(`app_users?email=eq.${encodeURIComponent(String(payload.email).toLowerCase())}&select=*`, { role: 'erp_server' });
    if (!r.ok) return null;
    const u = (await r.json())[0];
    if (!u || !u.is_active || !privateAccessAllowed(String(u.email))) return null;
    return { id: String(u.id), email: String(u.email), name: String(u.name || ''), role: String(u.role || '') };
  } catch {
    return null;
  }
}

/** 로그인만 요구한다 */
export function requireUser() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const u = await currentUser(req);
    if (!u) { res.status(401).json({ error: 'no_session' }); return; }
    (req as Request & { user: SessionUser }).user = u;
    next();
  };
}

/** 역할까지 본다. 승인처럼 되돌리기 어려운 것은 서버에서 다시 검사한다 */
export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const u = await currentUser(req);
    if (!u) { res.status(401).json({ error: 'no_session' }); return; }
    if (!roles.includes(u.role)) { res.status(403).json({ error: 'forbidden', need: roles }); return; }
    (req as Request & { user: SessionUser }).user = u;
    next();
  };
}

export const userOf = (req: Request): SessionUser => (req as Request & { user: SessionUser }).user;

