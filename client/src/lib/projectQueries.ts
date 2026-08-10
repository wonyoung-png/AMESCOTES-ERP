// 대형 프로젝트 — 서버 저장. 직원들이 함께 보는 자료라 localStorage에 두면 안 된다.
import { supabase } from './supabase';
import { filterForTable } from './tableColumns';

export type ProjectStatus = '진행' | '보류' | '완료';

export interface ProjectItem {
  id: string;
  projectId: string;
  /** 프로젝트마다 자유롭게 정한다 — '1. 8월 (D-125~D-100)' 처럼 */
  phase: string;
  /** 팀 성격의 묶음 — '생산 발주', '법규·안전' */
  area: string;
  title: string;
  detail?: string;
  due?: string;
  /** 담당 팀 — TEAMS 중 하나 */
  team?: string;
  /** 담당자 계정. 사외(소방서·세무)는 계정이 없어 owner에만 적는다 */
  ownerUserId?: string;
  /** 사내 팀일 수도, 소방서·세무 같은 사외일 수도 있다 */
  owner?: string;
  budget?: number;
  urgent: boolean;
  /** 이게 안 끝나면 뒤가 막힌다 */
  blocker: boolean;
  done: boolean;
  doneAt?: string;
  sortNo: number;
}

export interface Project {
  id: string;
  workspace: 'LUMEN' | 'AETALOOF';
  title: string;
  kind?: string;
  /** D-day 계산 기준 — 오픈일 역산이 전부다 */
  anchorDate?: string;
  anchorLabel?: string;
  status: ProjectStatus;
  owner?: string;
  budgetCap?: number;
  memo?: string;
  items: ProjectItem[];
}

const rowToItem = (r: any): ProjectItem => ({
  id: r.id, projectId: r.project_id, phase: r.phase || '', area: r.area || '',
  title: r.title, detail: r.detail || undefined, due: r.due || undefined,
  owner: r.owner || undefined, team: r.team || undefined,
  ownerUserId: r.owner_user_id || undefined, budget: r.budget ?? undefined,
  urgent: !!r.urgent, blocker: !!r.blocker, done: !!r.done,
  doneAt: r.done_at || undefined, sortNo: r.sort_no ?? 0,
});

export async function fetchProjects(workspace: 'LUMEN' | 'AETALOOF'): Promise<Project[]> {
  const { data: ps, error } = await supabase
    .from('projects').select('*').eq('workspace', workspace);
  if (error) throw error;
  const rows = (ps || []).filter((p: any) => p.anchor_date || p.kind);  // 발주 손익용 행은 제외
  if (rows.length === 0) return [];
  const { data: its } = await supabase
    .from('project_items').select('*').in('project_id', rows.map((p: any) => p.id));
  const byProject = new Map<string, ProjectItem[]>();
  (its || []).forEach((r: any) => {
    const list = byProject.get(r.project_id) || [];
    list.push(rowToItem(r));
    byProject.set(r.project_id, list);
  });
  return rows.map((p: any) => ({
    id: p.id, workspace: p.workspace, title: p.title, kind: p.kind || undefined,
    anchorDate: p.anchor_date || undefined, anchorLabel: p.anchor_label || undefined,
    status: (p.status as ProjectStatus) || '진행', owner: p.owner || undefined,
    budgetCap: p.budget_cap ?? undefined, memo: p.memo || undefined,
    items: (byProject.get(p.id) || []).sort((a, b) => a.sortNo - b.sortNo),
  })).sort((a, b) => (a.anchorDate || '9999').localeCompare(b.anchorDate || '9999'));
}

export async function upsertProject(p: Partial<Project> & { id: string }) {
  const row = filterForTable('projects', {
    id: p.id, workspace: p.workspace, title: p.title, kind: p.kind,
    anchor_date: p.anchorDate || null, anchor_label: p.anchorLabel,
    status: p.status, owner: p.owner, budget_cap: p.budgetCap, memo: p.memo,
    updated_at: new Date().toISOString(),
  });
  const { error } = await supabase.from('projects').upsert(row);
  if (error) throw error;
}

export async function upsertItems(items: ProjectItem[]) {
  if (items.length === 0) return;
  const rows = items.map(i => filterForTable('project_items', {
    id: i.id, project_id: i.projectId, phase: i.phase, area: i.area,
    title: i.title, detail: i.detail, due: i.due || null, owner: i.owner,
    team: i.team, owner_user_id: i.ownerUserId || null,
    budget: i.budget ?? null, urgent: i.urgent, blocker: i.blocker,
    done: i.done, done_at: i.doneAt || null, sort_no: i.sortNo,
  }));
  // 붙여넣기 임포트는 한 번에 70건 넘게 들어온다 — 나눠 보낸다
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('project_items').upsert(rows.slice(i, i + 100));
    if (error) throw error;
  }
}

export async function deleteProject(id: string) {
  await supabase.from('project_items').delete().eq('project_id', id);
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteItem(id: string) {
  const { error } = await supabase.from('project_items').delete().eq('id', id);
  if (error) throw error;
}

// 팀 목록은 phase1이 정본이다. 여기서 사본을 만들면 기획전과 프로젝트가 갈라진다.
export { CAMPAIGN_TEAMS as TEAMS, normalizeTeam } from './phase1';

export interface Member { id: string; name: string; team?: string; rank?: string; position?: string; }

/** 담당자로 고를 수 있는 사람 = 가입된 계정 */
export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('app_users').select('id,name,team,rank,position,is_active').eq('is_active', true);
  if (error) throw error;
  return (data || []).map((u: any) => ({
    id: u.id, name: u.name, team: u.team || undefined,
    rank: u.rank || undefined, position: u.position || undefined,
  })).sort((a, b) => (a.team || 'zz').localeCompare(b.team || 'zz') || a.name.localeCompare(b.name));
}
