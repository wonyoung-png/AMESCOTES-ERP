// AMESCOTES ERP — 인증 유틸리티
//
// 로그인은 서버(/api/login)만 판정한다. 계정·비밀번호 해시는 브라우저에 두지 않는다.
// (2026-10-07) 전에는 기본 계정과 해시를 번들에 박아 두고, 서버가 안 되면 로컬 해시로 로그인시켰다.
// 해시가 32비트라 같은 값을 내는 문자열을 쉽게 만들 수 있어 사실상 비밀번호가 공개된 상태였다 — 제거.

import { store, type AppUser, type UserRole } from './store';

/** 전체 페이지·사용자 관리 접근 가능한 관리자 목록 (server/users.ts 와 같아야 한다) */
export const ADMIN_EMAILS = ['wonyoung@atlm.kr', 'wonyoung@atlm.co.kr', 'saintluxpgw@bgrow.co.kr'];
export const ADMIN_EMAIL = ADMIN_EMAILS[0]; // 하위 호환
export function isAdminEmail(email?: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

// ─────────────────────────────────────────────────────────────
//  예전 로컬 계정 정리 — 기기에 남은 해시 사본을 지운다
// ─────────────────────────────────────────────────────────────
const AUTH_VERSION_KEY = 'auth_version';
const CURRENT_VERSION = '2026-10-07-server-only';

export function initDefaultUsers(): void {
  if (localStorage.getItem(AUTH_VERSION_KEY) !== CURRENT_VERSION) {
    // 예전 버전이 깔아 둔 기본 계정(해시 포함)을 지운다. 세션은 서버 쿠키로 다시 이어진다
    // 실제 키는 store.ts KEYS — ames_users 에 예전 해시 사본이 들어 있다 (코덱스 지적)
    // 로그인 화면에서만 불리므로 ames_current_user 를 지워도 쓰던 세션이 끊기지 않는다
    for (const k of ['ames_users', 'ames_current_user', 'users', 'currentUser']) localStorage.removeItem(k);
    localStorage.setItem(AUTH_VERSION_KEY, CURRENT_VERSION);
  }
}

export async function login(email: string, password: string): Promise<AppUser | null> {
  const normEmail = email.trim().toLowerCase();
  // 서버 검증 로그인 — 성공 시 12시간 세션 토큰 발급. 서버가 안 되면 로그인도 안 된다 (로컬 폴백 없음)
  let res: Response;
  try {
    res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normEmail, password }),
    });
  } catch { return null; } // 통신 실패 — 화면이 멈추지 않게 실패로 돌려준다
  if (!res.ok) return null;
  const { token, user } = (await res.json()) as { token: string; user: AppUser };
  localStorage.setItem('erp_token', token);
  // 로컬 캐시 동기화 (기존 화면들의 store.getUsers() 호환). 서버는 passwordHash 를 빈 값으로 준다
  const local = store.getUsers().find(u => u.email.toLowerCase() === normEmail);
  if (!local) store.addUser(user);
  store.setCurrentUser(user);
  return user;
}

/** 셸(OS)에서 로그인한 쿠키 세션을 이어받아 localStorage에 복원 */
export async function restoreSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/session');
    if (!res.ok) return false;
    const { token, user } = (await res.json()) as { token: string; user: AppUser };
    localStorage.setItem('erp_token', token);
    const local = store.getUsers().find(u => u.email.toLowerCase() === user.email.toLowerCase());
    if (!local) store.addUser(user);
    store.setCurrentUser(user);
    return true;
  } catch {
    return false;
  }
}

export function logout(): void {
  store.setCurrentUser(null);
  localStorage.removeItem('erp_token');
  fetch('/api/logout', { method: 'POST' }).catch(() => { /* 쿠키 제거 실패는 무시 */ });
}

export function getCurrentUser(): AppUser | null {
  return store.getCurrentUser();
}

export function isAuthenticated(): boolean {
  if (store.getCurrentUser() === null) return false;
  const token = localStorage.getItem('erp_token');
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number };
    if (!payload.exp || payload.exp * 1000 < Date.now()) return false;
  } catch { return false; }
  return true;
}

// ─────────────────────────────────────────────────────────────
//  권한 체크
// ─────────────────────────────────────────────────────────────
const ROLE_LEVEL: Record<UserRole, number> = {
  '대표': 5,
  '생산관리팀장': 4,
  '부관리 주임': 3,
  '사원': 2,
  '영업과장': 3,
  '팀장': 4,
};

export function hasPermission(requiredRole: UserRole): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === '대표') return true;
  return ROLE_LEVEL[user.role] >= ROLE_LEVEL[requiredRole];
}
