/**
 * AMESCOTES 조직도 (임시) — 2026 조직도 기준
 * R3 승인 역할(md / production / md_lead / design_lead / ceo) 매핑용
 */
import type { Workspace } from './phase1';

export type R3Role = 'md' | 'production' | 'md_lead' | 'design_lead' | 'ceo';

export interface OrgMember {
  id: string;
  name: string;
  title: string;           // 직책
  unitId: string;
  isVacant?: boolean;
  concurrent?: boolean;    // 겸직
  r3Roles?: R3Role[];      // 기본 부여 역할 (임시)
  brands?: Array<'LUMEN' | 'AETALOOP'>;
}

export interface OrgUnit {
  id: string;
  name: string;
  parentId: string | null;
  headMemberId?: string;
  sort: number;
}

const ORG_FLAG = 'ames_org_chart_v1';
const ROLE_OVERRIDE_KEY = 'ames_org_r3_overrides_v1';

/** 본부·팀 트리 */
export const ORG_UNITS: OrgUnit[] = [
  { id: 'ceo', name: '대표이사', parentId: null, headMemberId: 'm-lee-wy', sort: 0 },
  { id: 'japan', name: '일본법인', parentId: 'ceo', headMemberId: 'm-min-jy', sort: 10 },
  { id: 'china', name: '중국법인', parentId: 'ceo', headMemberId: 'm-china-vacant', sort: 20 },
  { id: 'mgmt', name: '경영관리팀', parentId: 'ceo', headMemberId: 'm-kim-jg', sort: 30 },
  { id: 'sales', name: '영업팀', parentId: 'ceo', headMemberId: 'm-jung-js', sort: 40 },
  { id: 'mkt', name: '마케팅팀', parentId: 'ceo', headMemberId: 'm-baik-su', sort: 50 },

  { id: 'brand', name: '브랜드본부', parentId: 'ceo', headMemberId: 'm-ahn-sj', sort: 100 },
  { id: 'brand-lumen', name: '루멘디자인스튜디오', parentId: 'brand', headMemberId: 'm-park-jy', sort: 110 },
  { id: 'brand-aetaloop', name: '에탈루프디자인스튜디오', parentId: 'brand', headMemberId: 'm-kim-cy', sort: 120 },
  { id: 'brand-visual', name: '비주얼&컨텐츠팀', parentId: 'brand', headMemberId: 'm-ahn-sj', sort: 130 },

  { id: 'md', name: '머천다이징본부', parentId: 'ceo', headMemberId: 'm-yang-rr', sort: 200 },
  { id: 'md-domestic', name: '국내MD팀', parentId: 'md', headMemberId: 'm-kim-db', sort: 210 },
  { id: 'md-global', name: '글로벌MD팀', parentId: 'md', headMemberId: 'm-yang-rr', sort: 220 },
  { id: 'md-retail', name: '리테일팀', parentId: 'md', headMemberId: 'm-park-hj', sort: 230 },

  { id: 'prod', name: '생산본부', parentId: 'ceo', headMemberId: 'm-prod-vacant', sort: 300 },
  { id: 'prod-dev', name: '제품개발팀', parentId: 'prod', headMemberId: 'm-choi-sw', sort: 310 },
  { id: 'prod-mgmt', name: '생산관리팀', parentId: 'prod', headMemberId: 'm-han-ss', sort: 320 },
  { id: 'prod-logi', name: '물류&CS팀', parentId: 'prod', headMemberId: 'm-choi-jw', sort: 330 },
];

/** 인원 (조직도 그대로 · 임시) */
export const ORG_MEMBERS: OrgMember[] = [
  { id: 'm-lee-wy', name: '이원엽', title: '대표이사', unitId: 'ceo', r3Roles: ['ceo'] },

  { id: 'm-min-jy', name: '민지영', title: '법인장', unitId: 'japan' },
  { id: 'm-china-vacant', name: '(공석)', title: '법인장', unitId: 'china', isVacant: true },
  { id: 'm-kim-jg', name: '김재구', title: '차장', unitId: 'mgmt' },
  { id: 'm-jung-js', name: '정진선', title: '차장', unitId: 'sales' },
  { id: 'm-baik-su', name: '백성운', title: '과장', unitId: 'mkt' },

  // 브랜드
  { id: 'm-ahn-sj', name: '안수정', title: '처장', unitId: 'brand', r3Roles: ['design_lead'] },
  { id: 'm-park-jy', name: '박지영', title: '대리', unitId: 'brand-lumen', brands: ['LUMEN'], r3Roles: ['design_lead'] },
  { id: 'm-kim-sb', name: '김수빈', title: '대리', unitId: 'brand-lumen', brands: ['LUMEN'] },
  { id: 'm-song-yj', name: '송예진', title: '주임', unitId: 'brand-lumen', brands: ['LUMEN'] },
  { id: 'm-kim-cy', name: '김채윤', title: '대리', unitId: 'brand-aetaloop', brands: ['AETALOOP'], r3Roles: ['design_lead'] },
  { id: 'm-choi-jh', name: '최지혜', title: '대리', unitId: 'brand-visual' },
  { id: 'm-han-yj', name: '한유진', title: '주임', unitId: 'brand-visual' },
  // 안수정 비주얼 겸직 표시용
  { id: 'm-ahn-sj-v', name: '안수정', title: '처장(겸)', unitId: 'brand-visual', concurrent: true },

  // MD
  { id: 'm-yang-rr', name: '양리리', title: '차장', unitId: 'md', r3Roles: ['md_lead', 'md'] },
  { id: 'm-kim-db', name: '김단비', title: '대리', unitId: 'md-domestic', r3Roles: ['md'] },
  { id: 'm-kim-yj', name: '김유진', title: '사원', unitId: 'md-domestic', r3Roles: ['md'] },
  { id: 'm-seo-my', name: '서미연', title: '대리', unitId: 'md-global', r3Roles: ['md'] },
  { id: 'm-won-ce', name: '원채은', title: '대리', unitId: 'md-global', r3Roles: ['md'] },
  { id: 'm-yang-rr-g', name: '양리리', title: '차장(겸)', unitId: 'md-global', concurrent: true },
  { id: 'm-park-hj', name: '박혜진', title: '과장', unitId: 'md-retail' },
  { id: 'm-lee-sj', name: '이세진', title: '대리', unitId: 'md-retail' },
  { id: 'm-kim-nr', name: '김나리', title: '대리', unitId: 'md-retail' },
  { id: 'm-seo-yj', name: '서영준', title: '사원', unitId: 'md-retail' },

  // 생산
  { id: 'm-prod-vacant', name: '(공석)', title: '본부장', unitId: 'prod', isVacant: true },
  { id: 'm-choi-sw', name: '최세웅', title: '차장', unitId: 'prod-dev', r3Roles: ['production'] },
  { id: 'm-kim-gs', name: '김길성', title: '실장', unitId: 'prod-dev', r3Roles: ['production'] },
  { id: 'm-lee-sw', name: '이상원', title: '과장', unitId: 'prod-dev' },
  { id: 'm-jung-sc', name: '정상철', title: '주임', unitId: 'prod-dev' },
  { id: 'm-kang-dh', name: '강동환', title: '사원', unitId: 'prod-dev' },
  { id: 'm-han-ss', name: '한선석', title: '차장', unitId: 'prod-mgmt', r3Roles: ['production'] },
  { id: 'm-im-nc', name: '임남철', title: '부장', unitId: 'prod-mgmt', r3Roles: ['production'] },
  { id: 'm-kim-yj2', name: '김영재', title: '부장', unitId: 'prod-mgmt', r3Roles: ['production'] },
  { id: 'm-yu-yj', name: '유연재', title: '주임', unitId: 'prod-mgmt' },
  { id: 'm-han-ys', name: '한유상', title: '사원', unitId: 'prod-mgmt' },
  { id: 'm-choi-jw', name: '최재원', title: '과장', unitId: 'prod-logi' },
  { id: 'm-kim-sg', name: '김성구', title: '대리', unitId: 'prod-logi' },
];

export const R3_ROLE_LABEL: Record<R3Role, string> = {
  md: 'MD',
  production: '생산(납기)',
  md_lead: 'MD팀장',
  design_lead: '디자인팀장',
  ceo: '대표',
};

/** 단계 → R3 역할 */
export const R3_STEP_ROLE: Record<number, R3Role> = {
  1: 'md',
  2: 'production',
  3: 'md',
  4: 'md_lead',
  5: 'design_lead',
  6: 'ceo',
};

type RoleOverride = Partial<Record<R3Role, string>>; // role → memberId

function loadOverrides(): RoleOverride {
  try {
    return JSON.parse(localStorage.getItem(ROLE_OVERRIDE_KEY) || '{}');
  } catch { return {}; }
}

export function saveRoleOverride(role: R3Role, memberId: string) {
  const cur = loadOverrides();
  cur[role] = memberId;
  localStorage.setItem(ROLE_OVERRIDE_KEY, JSON.stringify(cur));
}

export function clearRoleOverrides() {
  localStorage.removeItem(ROLE_OVERRIDE_KEY);
}

export function getMembersByUnit(unitId: string): OrgMember[] {
  return ORG_MEMBERS.filter(m => m.unitId === unitId && !m.concurrent);
}

export function getUnitChildren(parentId: string | null): OrgUnit[] {
  return ORG_UNITS.filter(u => u.parentId === parentId).sort((a, b) => a.sort - b.sort);
}

export function getMember(id: string): OrgMember | undefined {
  return ORG_MEMBERS.find(m => m.id === id);
}

/** 역할 기본 담당자 (오버라이드 > 기본 r3Roles, 브랜드별 design_lead 분기) */
export function getAssigneeForRole(role: R3Role, workspace?: Workspace): OrgMember | null {
  const overrides = loadOverrides();
  if (overrides[role]) {
    const m = getMember(overrides[role]!);
    if (m && !m.isVacant) return m;
  }

  if (role === 'design_lead') {
    if (workspace === 'AETALOOP') {
      return getMember('m-kim-cy') || null;
    }
    if (workspace === 'LUMEN') {
      return getMember('m-park-jy') || getMember('m-ahn-sj') || null;
    }
    return getMember('m-ahn-sj') || null;
  }

  if (role === 'ceo') return getMember('m-lee-wy') || null;
  if (role === 'md_lead') return getMember('m-yang-rr') || null;
  if (role === 'production') return getMember('m-han-ss') || getMember('m-im-nc') || null;
  if (role === 'md') return getMember('m-kim-db') || getMember('m-seo-my') || getMember('m-yang-rr') || null;

  const found = ORG_MEMBERS.find(m => !m.isVacant && !m.concurrent && m.r3Roles?.includes(role));
  return found || null;
}

export function getAssigneeForStep(step: number, workspace?: Workspace): OrgMember | null {
  const role = R3_STEP_ROLE[step];
  if (!role) return null;
  return getAssigneeForRole(role, workspace);
}

export function listMembersForRole(role: R3Role): OrgMember[] {
  return ORG_MEMBERS.filter(m =>
    !m.isVacant && !m.concurrent && (m.r3Roles?.includes(role) || role === 'md' && m.unitId.startsWith('md')),
  );
}

export function ensureOrgChartSeeded(): void {
  if (!localStorage.getItem(ORG_FLAG)) {
    localStorage.setItem(ORG_FLAG, new Date().toISOString());
  }
}

/** R3 역할 요약 (화면용) */
export function getR3RoleBoard(workspace?: Workspace): Array<{
  role: R3Role;
  label: string;
  member: OrgMember | null;
}> {
  return (Object.keys(R3_ROLE_LABEL) as R3Role[]).map(role => ({
    role,
    label: R3_ROLE_LABEL[role],
    member: getAssigneeForRole(role, workspace),
  }));
}
