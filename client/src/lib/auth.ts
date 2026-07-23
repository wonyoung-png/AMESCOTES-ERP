// AMESCOTES ERP — 인증 유틸리티
// localStorage 기반 (Phase 1 프로토타입용)
// AMESCOTES ERP — 인증 유틸리티
// localStorage 기반 (Phase 1 프로토타입용)
//
// ⚠️ 보안 주의:
//   - 사내망(192.168.0.6:3000) 전용 + 팀원 5명 임시 운영 전제
//   - 2~3주 후 Supabase Auth(bcrypt + JWT)로 반드시 마이그레이션
//   - 원본 평문 비밀번호는 10_팀원비밀번호_대표님보관용.md 파일에만 보관
//   - 아래 passwordHash 는 simpleHash() 결과값을 사전 계산하여 리터럴로 박은 것
//     (코드에 평문이 남지 않도록)
//
// 버전: 2026-04-16-team (데모 계정 → 팀원 실계정 마이그레이션)

import { store, genId, type AppUser, type UserRole } from './store';
import { supabase } from './supabase';

// 간단한 해시 (Phase 1 임시용 — Phase 2 에서 Supabase Auth로 교체)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ─────────────────────────────────────────────────────────────
//  자동 마이그레이션 — 기기별 최초 1회 기존 데모 계정 삭제
// ─────────────────────────────────────────────────────────────
const AUTH_VERSION_KEY = 'auth_version';
const CURRENT_VERSION = '2026-06-01-pwreset';

function runMigrationIfNeeded(): void {
  const currentVersion = localStorage.getItem(AUTH_VERSION_KEY);
  if (currentVersion !== CURRENT_VERSION) {
    // 기존 데모 계정 / 세션 정리
    localStorage.removeItem('users');
    localStorage.removeItem('currentUser');
    localStorage.setItem(AUTH_VERSION_KEY, CURRENT_VERSION);
  }
}

// ─────────────────────────────────────────────────────────────
//  기본 계정 초기화 (최초 1회)
// ─────────────────────────────────────────────────────────────
export function initDefaultUsers(): void {
  runMigrationIfNeeded();

  const existing = store.getUsers();
  if (existing.length > 0) {
    // 캐시/마이그레이션 타이밍과 무관하게 대표 계정 비번을 항상 최신값으로 보정
    // (비번: atlm2026 → simpleHash = '5a33sm')
    const rep = existing.find(u => u.email === 'wonyoung@atlm.kr');
    if (rep && rep.passwordHash !== '5a33sm') {
      store.updateUser(rep.id, { passwordHash: '5a33sm' });
    }
    return;
  }

  // passwordHash = simpleHash(평문비밀번호) 결과를 사전 계산한 값
  // 평문은 10_팀원비밀번호_대표님보관용.md 참조
  const defaults: Omit<AppUser, 'id' | 'createdAt'>[] = [
    { email: 'wonyoung@atlm.kr',      passwordHash: '5a33sm', name: '이원영',       role: '대표',         isActive: true }, // 비번: atlm2026 (2026-06-01 재설정)
    { email: 'pm@atlm.kr',            passwordHash: '27io5c', name: '생산관리팀장',  role: '생산관리팀장',  isActive: true },
    { email: 'mgr@atlm.kr',           passwordHash: 'xkvehy', name: '부관리 주임',   role: '부관리 주임',   isActive: true },
    { email: 'staff@atlm.kr',         passwordHash: '8nuuz1', name: '사원',         role: '사원',         isActive: true },
    { email: 'sales@atlm.kr',         passwordHash: 'fse155', name: '영업과장',     role: '영업과장',     isActive: true },
  ];

  for (const d of defaults) {
    store.addUser({ ...d, id: genId(), createdAt: new Date().toISOString() });
  }
}

export async function login(email: string, password: string): Promise<AppUser | null> {
  const users = store.getUsers();
  const normEmail = email.toLowerCase();

  // 1) Supabase Auth 우선 — RLS(DB 잠금) 전환 후에도 유효한 정식 세션 확보
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error && data.session) {
      const user = users.find(u => u.email.toLowerCase() === normEmail && u.isActive);
      if (user) { store.setCurrentUser(user); return user; }
      // 로컬 레코드 없는 신규 직원 → 기본 '사원'으로 생성 (권한 상향은 대표가 조정)
      const fresh: AppUser = {
        id: genId(), email, name: email.split('@')[0], role: '사원',
        passwordHash: '', isActive: true, createdAt: new Date().toISOString(),
      };
      store.addUser(fresh);
      store.setCurrentUser(fresh);
      return fresh;
    }
  } catch { /* 네트워크 오류 등 → 레거시 폴백 */ }

  // 2) 레거시 폴백 — Auth 계정 미생성 과도기 동안만 유효 (RLS 켜면 DB 접근 불가)
  const hash = simpleHash(password);
  const user = users.find(u => u.email.toLowerCase() === normEmail && u.passwordHash === hash && u.isActive);
  if (!user) return null;
  store.setCurrentUser(user);
  return user;
}

export function logout(): void {
  store.setCurrentUser(null);
  supabase.auth.signOut().catch(() => { /* 세션 없으면 무시 */ });
}

export function getCurrentUser(): AppUser | null {
  return store.getCurrentUser();
}

export function isAuthenticated(): boolean {
  return store.getCurrentUser() !== null;
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
};

export function hasPermission(requiredRole: UserRole): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === '대표') return true;
  return ROLE_LEVEL[user.role] >= ROLE_LEVEL[requiredRole];
}
