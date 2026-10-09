// 사용자 관리 — app_users 는 서버만 만진다.
//
// 전에는 화면이 PostgREST 에 anon 으로 직접 붙어 app_users 를 select('*') 했다.
// anon 키는 브라우저 번들에 들어 있으니, 로그인 없이도 전 직원의 password_hash 를 읽을 수 있었다.
// (해시가 32비트 simpleHash 라 해시가 곧 비밀번호다.) 그래서:
//  - 읽기·쓰기를 전부 여기로 옮기고 password_hash 는 절대 내보내지 않는다
//  - DB 에서 anon 권한을 거둔다 (migration_app_users_lock.sql)
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireUser, currentUser, restAsServer, userOf, CEO_EMAILS, type SessionUser } from './auth.js';
import { ORG } from './org.js';

const router = Router();

/** client/src/lib/auth.ts ADMIN_EMAILS 와 같다. 화면 검사는 보안 경계가 아니라 여기서 다시 본다 */
const ADMIN_EMAILS = ['wonyoung@atlm.kr', 'wonyoung@atlm.co.kr', 'saintluxpgw@bgrow.co.kr'];
const ROLES = ['대표', '생산관리팀장', '부관리 주임', '영업과장', '팀장', '사원'];
const TEAMS = ORG.map(t => t.key);
const SAFE = 'id,email,name,role,team,rank,position,work_profile,is_active,created_at';

/** client/src/lib/auth.ts simpleHash 와 같은 알고리즘 (session.ts 로그인과 호환) */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function requireAdmin() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const u = await currentUser(req);
    if (!u) { res.status(401).json({ error: 'no_session' }); return; }
    if (!ADMIN_EMAILS.includes(u.email.toLowerCase())) { res.status(403).json({ error: 'forbidden' }); return; }
    (req as Request & { user: SessionUser }).user = u;
    next();
  };
}

const fail = (res: Response, where: string, e: unknown) => {
  console.error(`${where} 실패:`, e);
  res.status(500).json({ error: 'internal' });
};

/** 담당자 고르기용 — 로그인한 직원 누구나. 이름·팀·직급만 */
router.get('/api/users/directory', requireUser(), async (_req: Request, res: Response) => {
  try {
    const r = await restAsServer('app_users?is_active=eq.true&select=id,name,team,rank,position');
    if (!r.ok) { res.status(502).json({ error: 'db' }); return; }
    res.json({ items: await r.json() });
  } catch (e) { fail(res, 'GET /api/users/directory', e); }
});

/** 관리자 목록 */
router.get('/api/users', requireAdmin(), async (_req: Request, res: Response) => {
  try {
    const r = await restAsServer(`app_users?select=${SAFE}&order=created_at.asc`);
    if (!r.ok) { res.status(502).json({ error: 'db' }); return; }
    res.json({ items: await r.json() });
  } catch (e) { fail(res, 'GET /api/users', e); }
});

/** 초대 — 해시는 서버에서 만든다 */
router.post('/api/users', requireAdmin(), async (req: Request, res: Response) => {
  try {
    const { email: e, name: n, role, password, team: rawTeam, position: rawPosition } = (req.body ?? {}) as Record<string, string>;
    const email = String(e || '').trim().toLowerCase();
    const name = String(n || '').trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: 'bad_input' }); return; }
    if (!ROLES.includes(role)) { res.status(400).json({ error: 'bad_role' }); return; }
    const team = String(rawTeam || '').trim();
    const position = String(rawPosition || '').trim().slice(0, 40);
    if (team && !TEAMS.includes(team)) { res.status(400).json({ error: 'bad_team' }); return; }
    if (typeof password !== 'string' || password.length < 6) { res.status(400).json({ error: 'weak_password' }); return; }
    const r = await restAsServer('app_users', {
      method: 'POST',
      body: JSON.stringify({
        id: email, email, name, role, password_hash: simpleHash(password), is_active: true,
        team: team || null, position: position || null,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      res.status(t.includes('duplicate') || t.includes('23505') ? 409 : 502).json({ error: t.includes('23505') ? 'exists' : 'db' });
      return;
    }
    res.json({ ok: true });
  } catch (e) { fail(res, 'POST /api/users', e); }
});

/** 팀·직급·직책·활성 */
router.patch('/api/users/:id', requireAdmin(), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const k of ['team', 'rank', 'position'] as const) {
      if (k in body) patch[k] = body[k] == null || body[k] === '' ? null : String(body[k]).trim().slice(0, 40);
    }
    if (patch.team && !TEAMS.includes(String(patch.team))) { res.status(400).json({ error: 'bad_team' }); return; }
    if ('role' in body) {
      const role = String(body.role || '');
      if (!ROLES.includes(role)) { res.status(400).json({ error: 'bad_role' }); return; }
      patch.role = role;
    }
    if ('is_active' in body) patch.is_active = !!body.is_active;
    if (!Object.keys(patch).length) { res.status(400).json({ error: 'empty' }); return; }

    if (!(await guardCeo(req, res))) return;
    const id = String(req.params.id);
    // 관리자 계정은 끌 수 없다 — 다 꺼지면 아무도 사용자 관리를 못 연다
    if (patch.is_active === false && ADMIN_EMAILS.includes(id.toLowerCase())) { res.status(400).json({ error: 'admin_locked' }); return; }
    const r = await restAsServer(`app_users?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
    });
    if (!r.ok) { res.status(502).json({ error: 'db' }); return; }
    if (!(await r.json()).length) { res.status(404).json({ error: 'not_found' }); return; }
    res.json({ ok: true });
  } catch (e) { fail(res, 'PATCH /api/users/:id', e); }
});

/**
 * 대표 계정은 대표 본인만 손댈 수 있다 — 다른 관리자가 비밀번호를 바꿔 대표로 로그인하는 길을 막는다 (10/8 대표 지시: 비서실은 나만)
 */
async function guardCeo(req: Request, res: Response): Promise<boolean> {
  const r = await restAsServer(`app_users?id=eq.${encodeURIComponent(String(req.params.id))}&select=email`);
  if (!r.ok) { res.status(502).json({ error: 'db' }); return false; }
  const target = String((await r.json())[0]?.email || '').toLowerCase();
  if (CEO_EMAILS.includes(target) && userOf(req).email.toLowerCase() !== target) {
    console.warn(`[users] 대표 계정 변경 차단 ${target} by ${userOf(req).email}`);
    res.status(403).json({ error: 'ceo_locked', message: '대표 계정은 대표 본인만 바꿀 수 있습니다' });
    return false;
  }
  return true;
}

/** 비밀번호 재설정 */
router.post('/api/users/:id/password', requireAdmin(), async (req: Request, res: Response) => {
  try {
    if (!(await guardCeo(req, res))) return;
    const password = (req.body ?? {}).password;
    if (typeof password !== 'string' || password.length < 6) { res.status(400).json({ error: 'weak_password' }); return; }
    const r = await restAsServer(`app_users?id=eq.${encodeURIComponent(String(req.params.id))}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ password_hash: simpleHash(password) }),
    });
    if (!r.ok) { res.status(502).json({ error: 'db' }); return; }
    if (!(await r.json()).length) { res.status(404).json({ error: 'not_found' }); return; }
    console.log(`[users] 비밀번호 재설정 ${req.params.id} by ${userOf(req).email}`);
    res.json({ ok: true });
  } catch (e) { fail(res, 'POST /api/users/:id/password', e); }
});

export default router;
