// AMESCOTES ERP — 인증 유틸리티
// localStorage 기반 (Phase 1 프로토타입용)

import { store, genId, type AppUser, type UserRole } from './store';

// 간단한 해시 (데모용 — 실제 운영에서는 서버사이드 bcrypt 사용)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// 기본 계정 초기화 (최초 1회)
export function initDefaultUsers(): void {
  const existing = store.getUsers();
  if (existing.length > 0) return;

  const defaults: Omit<AppUser, 'id' | 'createdAt'>[] = [
    { email: 'ceo@amescotes.com',       passwordHash: simpleHash('admin1234'), name: '대표님',     role: '대표',         isActive: true },
    { email: 'pm@amescotes.com',         passwordHash: simpleHash('pm1234'),    name: '생산관리팀장', role: '생산관리팀장',  isActive: true },
    { email: 'manager@amescotes.com',    passwordHash: simpleHash('mgr1234'),   name: '부관리 주임', role: '부관리 주임',   isActive: true },
    { email: 'staff@amescotes.com',      passwordHash: simpleHash('staff1234'), name: '사원',       role: '사원',         isActive: true },
    { email: 'sales@amescotes.com',      passwordHash: simpleHash('sales1234'), name: '영업과장',   role: '영업과장',     isActive: true },
  ];

  for (const d of defaults) {
    store.addUser({ ...d, id: genId(), createdAt: new Date().toISOString() });
  }
}

export function login(email: string, password: string): AppUser | null {
  const users = store.getUsers();
  const hash = simpleHash(password);
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.passwordHash === hash && u.isActive);
  if (!user) return null;
  store.setCurrentUser(user);
  return user;
}

export function logout(): void {
  store.setCurrentUser(null);
}

export function getCurrentUser(): AppUser | null {
  return store.getCurrentUser();
}

export function isAuthenticated(): boolean {
  return store.getCurrentUser() !== null;
}

// 권한 체크
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
