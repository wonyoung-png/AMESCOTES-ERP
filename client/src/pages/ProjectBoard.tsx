// 대형 프로젝트 — 팝업 오픈·시즌 런칭처럼 몇 달에 걸쳐 여러 팀이 붙는 일.
//
// 기획전(운영 캘린더)은 채널×날짜 축이라 이걸 못 담는다. 여기 축은 팀×페이즈다.
// 화면은 네 가지 질문에만 답한다.
//   전체    — 며칠 남았고, 뭐가 막혀 있나
//   팀별    — 우리 팀이 칠 것만
//   담당자별 — 내가 이번에 칠 것만
//   예산    — 얼마 쓰기로 했고 얼마 잡혀 있나
import { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Link } from 'wouter';
import { phase1, type Campaign } from '@/lib/phase1';
import {
  fetchProjects, upsertProject, upsertItems, deleteProject, deleteItem, fetchMembers,
  TEAMS, type Project, type ProjectItem, type Member,
} from '@/lib/projectQueries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Trash2, AlertTriangle, CalendarClock, Wallet } from 'lucide-react';

type View = 'all' | 'team' | 'owner' | 'budget';

const VIEWS: { id: View; label: string; desc: string }[] = [
  { id: 'all', label: '전체', desc: '남은 날 · 막힌 것' },
  { id: 'team', label: '팀별', desc: '국내영업·디자인·생산 …' },
  { id: 'owner', label: '담당자별', desc: '누가 무엇을 언제까지' },
  { id: 'budget', label: '예산', desc: '상한 대비 잡힌 금액' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);
const won = (n: number) => '₩' + Math.round(n).toLocaleString();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** 마감까지 남은 날. 지난 건 음수 */
function daysTo(d?: string): number | null {
  if (!d) return null;
  const t = new Date(todayStr()).getTime();
  const x = new Date(d).getTime();
  if (Number.isNaN(x)) return null;
  return Math.round((x - t) / 86400000);
}

function DueBadge({ item }: { item: ProjectItem }) {
  if (item.done) return <Badge variant="outline" className="text-[11px] h-5 text-[var(--system-green)] border-transparent bg-[var(--system-green)]/10">완료</Badge>;
  const d = daysTo(item.due);
  if (d === null) return <span className="text-xs text-muted-foreground">기한 없음</span>;
  if (d < 0) return <Badge variant="outline" className="text-[11px] h-5 text-[var(--system-red)] border-transparent bg-[var(--system-red)]/10">{-d}일 지남</Badge>;
  if (d <= 7) return <Badge variant="outline" className="text-[11px] h-5 text-[var(--system-orange)] border-transparent bg-[var(--system-orange)]/10">D-{d}</Badge>;
  return <span className="text-xs text-muted-foreground font-mono">D-{d}</span>;
}

function ItemRow({ item, onToggle, onEdit }: {
  item: ProjectItem; onToggle: (i: ProjectItem) => void; onEdit: (i: ProjectItem) => void;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2 border-b border-border last:border-b-0 hover:bg-[var(--fill-quaternary)]">
      <input
        type="checkbox"
        checked={item.done}
        onChange={() => onToggle(item)}
        onClick={e => e.stopPropagation()}
        className="mt-1 cursor-pointer shrink-0"
      />
      {/* 줄 아무 데나 누르면 고칠 수 있어야 한다 */}
      <button type="button" onClick={() => onEdit(item)} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.blocker && !item.done && (
            <Badge variant="outline" className="text-[11px] h-5 text-[var(--system-red)] border-[var(--system-red)]/30">막힘</Badge>
          )}
          {item.urgent && !item.done && <span className="text-[var(--system-orange)] text-xs">●</span>}
          <span className={`text-sm ${item.done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
            {item.title}
          </span>
        </div>
        {item.detail && <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>}
        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
          {item.team && <span className="text-foreground">{item.team}</span>}
          {item.owner && <span>{item.owner}</span>}
          {item.due && <span className="font-mono">{item.due}</span>}
          {item.budget != null && <span className="font-mono">{won(item.budget)}</span>}
        </div>
      </button>
      <div className="shrink-0"><DueBadge item={item} /></div>
    </div>
  );
}

/** 항목을 어떤 키로 묶어 보여줄지만 다르고, 줄 모양은 같다 */
function GroupedList({
  items, groupBy, emptyText, onToggle, onEdit, onAdd,
}: {
  items: ProjectItem[];
  groupBy: (i: ProjectItem) => string;
  emptyText: string;
  onToggle: (i: ProjectItem) => void;
  onEdit: (i: ProjectItem) => void;
  /** 그 묶음에 바로 항목을 더한다 — 여기서 입력하는 게 기본이다 */
  onAdd?: (groupName: string) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, ProjectItem[]>();
    items.forEach(i => {
      const k = groupBy(i) || '미지정';
      m.set(k, [...(m.get(k) || []), i]);
    });
    return [...m.entries()];
  }, [items, groupBy]);

  if (items.length === 0) {
    return <div className="border border-dashed border-border rounded-lg py-10 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }
  return (
    <div className="space-y-4">
      {groups.map(([name, list]) => {
        const done = list.filter(i => i.done).length;
        return (
          <div key={name} className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--fill-quaternary)] border-b border-border">
              <span className="text-sm font-semibold text-foreground">{name}</span>
              <span className="text-[11px] text-muted-foreground">{done}/{list.length}</span>
              {onAdd && (
                <button type="button" onClick={() => onAdd(name)}
                  className="ml-auto text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <Plus className="w-3 h-3" />항목
                </button>
              )}
            </div>
            {list.map(i => <ItemRow key={i.id} item={i} onToggle={onToggle} onEdit={onEdit} />)}
          </div>
        );
      })}
    </div>
  );
}

export default function ProjectBoard() {
  const { workspace } = useWorkspace();
  const ws = workspace === 'AETALOOF' ? 'AETALOOF' : 'LUMEN';

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<string>('');
  const [view, setView] = useState<View>('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [hideDone, setHideDone] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: '', kind: '팝업·오픈', startDate: '', endDate: '', anchorLabel: '오픈' });
  /** 항목 직접 입력·수정 — 이게 기본 경로다. 붙여넣기는 처음 한 번 옮길 때만 쓴다 */
  const [editing, setEditing] = useState<ProjectItem | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => { fetchMembers().then(setMembers).catch(() => {}); }, []);
  // 이 프로젝트로 무슨 기획전을 돌리는지 — 운영 캘린더에서 소속을 지정한 것들
  const linked: Campaign[] = useMemo(
    () => phase1.getCampaigns(ws).filter(c => (c as any).projectId === selId),
    [ws, selId, projects],
  );

  const load = async () => {
    setLoading(true);
    try {
      const list = await fetchProjects(ws);
      setProjects(list);
      setSelId(prev => (list.some(p => p.id === prev) ? prev : (list[0]?.id || '')));
    } catch (e: any) {
      toast.error('불러오기 실패: ' + (e?.message || e));
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ws]);

  const project = projects.find(p => p.id === selId) || null;
  const items = project?.items || [];

  const shown = useMemo(
    () => items.filter(i => (!hideDone || !i.done) && (ownerFilter === 'all' || (i.owner || '미지정') === ownerFilter)),
    [items, hideDone, ownerFilter],
  );
  const owners = useMemo(
    () => Array.from(new Set(items.map(i => i.owner || '미지정'))).sort(),
    [items],
  );
  // 이미 쓰고 있는 값을 자동완성으로 준다 — 매번 새로 타이핑하면 표기가 갈라진다
  const phaseOpts = useMemo(() => Array.from(new Set(items.map(i => i.phase).filter(Boolean))), [items]);
  const areaOpts = useMemo(() => Array.from(new Set(items.map(i => i.area).filter(Boolean))), [items]);
  const ownerOpts = useMemo(() => Array.from(new Set(items.map(i => i.owner).filter(Boolean) as string[])), [items]);

  /** 새 항목 틀. 어느 묶음에서 눌렀는지에 따라 페이즈·구역을 미리 채운다 */
  const blankItem = (group?: string): ProjectItem => ({
    id: uid(), projectId: selId,
    phase: view === 'all' ? (group || phaseOpts[0] || '') : (phaseOpts[0] || ''),
    area: '',
    team: view === 'team' && group !== '팀 미지정' ? group : undefined,
    title: '', due: undefined, owner: view === 'owner' && group !== '미지정' ? group : undefined,
    urgent: false, blocker: false, done: false, sortNo: items.length,
  });

  const saveItem = async () => {
    if (!editing) return;
    if (!editing.title.trim()) { toast.error('내용을 입력하세요'); return; }
    try {
      await upsertItems([{ ...editing, title: editing.title.trim() }]);
      setEditing(null);
      await load();
    } catch (e: any) { toast.error('저장 실패: ' + (e?.message || e)); }
  };

  const removeItem = async () => {
    if (!editing) return;
    if (!confirm(`"${editing.title}" 항목을 삭제할까요?`)) return;
    try { await deleteItem(editing.id); setEditing(null); await load(); }
    catch (e: any) { toast.error('삭제 실패: ' + (e?.message || e)); }
  };

  const stat = useMemo(() => {
    const done = items.filter(i => i.done).length;
    const blocked = items.filter(i => i.blocker && !i.done).length;
    const late = items.filter(i => !i.done && (daysTo(i.due) ?? 99) < 0).length;
    const week = items.filter(i => { const d = daysTo(i.due); return !i.done && d !== null && d >= 0 && d <= 7; }).length;
    const budget = items.reduce((s, i) => s + (i.budget || 0), 0);
    return { done, blocked, late, week, budget, dday: daysTo(project?.endDate) };
  }, [items, project]);

  const toggle = async (item: ProjectItem) => {
    const next = { ...item, done: !item.done, doneAt: !item.done ? new Date().toISOString() : undefined };
    setProjects(ps => ps.map(p => p.id !== selId ? p : { ...p, items: p.items.map(i => i.id === item.id ? next : i) }));
    try { await upsertItems([next]); } catch (e: any) { toast.error('저장 실패: ' + (e?.message || e)); load(); }
  };

  const createProject = async () => {
    if (!form.title.trim()) { toast.error('프로젝트 이름을 입력하세요'); return; }
    if (!form.endDate) { toast.error('종료일을 입력하세요 — D-day 기준입니다'); return; }
    if (form.startDate && form.startDate > form.endDate) { toast.error('시작일이 종료일보다 늦습니다'); return; }
    const id = uid();
    try {
      await upsertProject({
        id, workspace: ws, title: form.title.trim(), kind: form.kind,
        startDate: form.startDate || undefined, endDate: form.endDate || undefined, anchorLabel: form.anchorLabel,
        status: '진행',
      });
      toast.success('프로젝트가 생성되었습니다');
      setShowNew(false);
      setForm({ title: '', kind: '팝업·오픈', startDate: '', endDate: '', anchorLabel: '오픈' });
      await load();
      setSelId(id);
    } catch (e: any) { toast.error('생성 실패: ' + (e?.message || e)); }
  };

  const removeProject = async () => {
    if (!project) return;
    if (!confirm(`"${project.title}" 프로젝트와 항목 ${items.length}건을 모두 삭제합니다. 계속할까요?`)) return;
    try { await deleteProject(project.id); toast.success('삭제되었습니다'); await load(); }
    catch (e: any) { toast.error('삭제 실패: ' + (e?.message || e)); }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">프로젝트</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            팝업 오픈 · 시즌 런칭처럼 몇 달에 걸쳐 여러 팀이 붙는 일
          </p>
        </div>
        <div className="flex items-center gap-2">
          {project && (
            <Button size="sm" className="gap-1.5" onClick={() => setEditing(blankItem())}>
              <Plus className="w-4 h-4" />항목 추가
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4" />프로젝트
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</div>
      ) : projects.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg py-16 text-center">
          <p className="text-sm text-foreground font-medium">아직 프로젝트가 없습니다</p>
          <p className="text-xs text-muted-foreground mt-1">
운영 캘린더에서 프로젝트를 만들면 여기에 나타납니다
          </p>
          <Button size="sm" className="mt-4 gap-1.5" onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4" />첫 프로젝트 만들기
          </Button>
        </div>
      ) : (
        <>
          {/* 프로젝트 선택 */}
          <div className="flex gap-2 flex-wrap">
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => setSelId(p.id)}
                className={`px-3 py-1.5 rounded-md text-sm border transition-all ${
                  p.id === selId
                    ? 'bg-primary text-primary-foreground border-transparent font-medium'
                    : 'bg-card border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.title}
              </button>
            ))}
          </div>

          {project && (
            <>
              {/* 요약 — 남은 날과 막힌 것을 맨 앞에 */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground">{project.anchorLabel || '마감'}까지</p>
                  <p className="text-xl font-bold text-foreground font-mono">
                    {stat.dday === null ? '—' : stat.dday >= 0 ? `D-${stat.dday}` : `D+${-stat.dday}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {project.startDate ? `${project.startDate} ~ ` : ''}{project.endDate || '종료일 미정'}
                  </p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground">진행</p>
                  <p className="text-xl font-bold text-foreground font-mono">{stat.done}/{items.length}</p>
                  <div className="h-1 bg-[var(--fill-quaternary)] rounded mt-1.5">
                    <div className="h-full bg-primary rounded" style={{ width: `${items.length ? (stat.done / items.length) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className={`border rounded-lg p-3 ${stat.blocked ? 'bg-[var(--system-red)]/5 border-[var(--system-red)]/30' : 'bg-card border-border'}`}>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><AlertTriangle className="w-3 h-3" />막고 있는 것</p>
                  <p className={`text-xl font-bold font-mono ${stat.blocked ? 'text-[var(--system-red)]' : 'text-foreground'}`}>{stat.blocked}</p>
                  <p className="text-[11px] text-muted-foreground">먼저 정해야 뒤가 풀림</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><CalendarClock className="w-3 h-3" />마감</p>
                  <p className="text-xl font-bold text-foreground font-mono">{stat.late} / {stat.week}</p>
                  <p className="text-[11px] text-muted-foreground">지남 / 7일 내</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Wallet className="w-3 h-3" />잡힌 금액</p>
                  <p className="text-xl font-bold text-foreground font-mono">{won(stat.budget)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {project.budgetCap ? `상한 ${won(project.budgetCap)}` : '상한 미정'}
                  </p>
                </div>
              </div>

              {/* 보기 전환 */}
              <div className="flex items-center gap-2 flex-wrap">
                {VIEWS.map(v => (
                  <button
                    key={v.id}
                    onClick={() => setView(v.id)}
                    className={`px-3 py-1.5 rounded-md text-xs border transition-all ${
                      view === v.id ? 'bg-primary text-primary-foreground border-transparent font-medium'
                        : 'bg-card border-border text-muted-foreground hover:text-foreground'
                    }`}
                    title={v.desc}
                  >
                    {v.label}
                  </button>
                ))}
                <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} />
                  완료 숨기기
                </label>
                {view === 'owner' && (
                  <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}
                    className="h-8 text-xs border border-border rounded-md bg-card px-2">
                    <option value="all">전체 담당</option>
                    {owners.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                <Button variant="ghost" size="sm" className="h-8 text-xs text-[var(--system-red)] gap-1"
                  onClick={removeProject}>
                  <Trash2 className="w-3.5 h-3.5" />프로젝트 삭제
                </Button>
              </div>

              {linked.length > 0 && (
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-[var(--fill-quaternary)] border-b border-border">
                    <span className="text-sm font-semibold text-foreground">이 프로젝트로 도는 기획전</span>
                    <span className="text-[11px] text-muted-foreground">{linked.length}건</span>
                    <Link href="/calendar">
                      <a className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">운영 캘린더에서 보기 →</a>
                    </Link>
                  </div>
                  {linked.map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-b-0">
                      <span className="text-sm text-foreground flex-1 min-w-0 truncate">{c.title}</span>
                      <span className="text-[11px] text-muted-foreground">{c.channel}</span>
                      <span className="text-[11px] text-muted-foreground font-mono">{c.startDate} ~ {c.endDate}</span>
                    </div>
                  ))}
                </div>
              )}

              {items.length === 0 ? (
                <div className="border border-dashed border-border rounded-lg py-14 text-center">
                  <p className="text-sm text-foreground font-medium">항목이 없습니다</p>
                  <p className="text-xs text-muted-foreground mt-1">팀과 담당자를 정해 할 일을 하나씩 추가하세요</p>
                  <Button size="sm" className="mt-4 gap-1.5" onClick={() => setEditing(blankItem())}>
                    <Plus className="w-4 h-4" />항목 추가
                  </Button>
                </div>
              ) : view === 'budget' ? (
                <GroupedList items={shown.filter(i => i.budget != null)} groupBy={i => i.phase}
                  emptyText="금액이 적힌 항목이 없습니다" onToggle={toggle} onEdit={setEditing} />
              ) : (
                <GroupedList
                  items={shown}
                  groupBy={view === 'team' ? (i => i.team || '팀 미지정') : view === 'owner' ? (i => i.owner || '미지정') : (i => i.phase)}
                  emptyText="조건에 맞는 항목이 없습니다"
                  onToggle={toggle}
                  onEdit={setEditing}
                  onAdd={g => setEditing(blankItem(g))}
                />
              )}
            </>
          )}
        </>
      )}

      {/* 새 프로젝트 */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>새 프로젝트</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>이름 *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="한남 플래그십 오픈" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>유형</Label>
                <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}
                  className="w-full h-9 text-sm border border-border rounded-md bg-card px-2">
                  {['팝업·오픈', '시즌 런칭', '콜라보', '입점', '스토어 구축', '기타'].map(k => <option key={k}>{k}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>끝나는 날이 무슨 날인가요</Label>
                <Input value={form.anchorLabel} onChange={e => setForm(f => ({ ...f, anchorLabel: e.target.value }))}
                  placeholder="고객오픈 · 행사 종료" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>시작일</Label>
                <Input type="date" value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>종료일 *</Label>
                <Input type="date" value={form.endDate}
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground">이 날짜로 D-day를 셉니다</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>취소</Button>
            <Button onClick={createProject}>만들기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 항목 입력·수정 — 여기가 기본 경로다 */}
      <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{items.some(i => i.id === editing?.id) ? '항목 수정' : '항목 추가'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>내용 *</Label>
                <Input
                  autoFocus
                  value={editing.title}
                  onChange={e => setEditing(v => v && { ...v, title: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') saveItem(); }}
                  placeholder="한정 참(Charm) 디자인 확정 → 중국 공장 견적"
                />
              </div>
              <div className="space-y-1.5">
                <Label>설명</Label>
                <Input value={editing.detail || ''}
                  onChange={e => setEditing(v => v && { ...v, detail: e.target.value || undefined })}
                  placeholder="왜 필요한지 · 판단 근거" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>페이즈</Label>
                  <Input list="phase-opts" value={editing.phase}
                    onChange={e => setEditing(v => v && { ...v, phase: e.target.value })}
                    placeholder="1. 8월 (D-125~D-100)" />
                  <datalist id="phase-opts">{phaseOpts.map(o => <option key={o} value={o} />)}</datalist>
                </div>
                <div className="space-y-1.5">
                  <Label>팀</Label>
                  <select value={editing.team || ''}
                    onChange={e => setEditing(v => v && { ...v, team: e.target.value || undefined })}
                    className="w-full h-9 text-sm border border-border rounded-md bg-card px-2">
                    <option value="">팀 선택</option>
                    {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>마감</Label>
                  <Input type="date" value={editing.due || ''}
                    onChange={e => setEditing(v => v && { ...v, due: e.target.value || undefined })} />
                </div>
                <div className="space-y-1.5">
                  <Label>담당자</Label>
                  <select
                    value={editing.ownerUserId || (editing.owner && !members.some(m => m.name === editing.owner) ? '__ext' : '')}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '__ext') { setEditing(p => p && { ...p, ownerUserId: undefined, owner: '' }); return; }
                      const m = members.find(x => x.id === v);
                      // 팀이 비어 있으면 담당자의 팀을 따라간다
                      setEditing(p => p && {
                        ...p, ownerUserId: m?.id, owner: m?.name,
                        team: p.team || m?.team,
                      });
                    }}
                    className="w-full h-9 text-sm border border-border rounded-md bg-card px-2">
                    <option value="">담당 미지정</option>
                    {members
                      .filter(m => !editing.team || !m.team || m.team === editing.team)
                      .map(m => <option key={m.id} value={m.id}>{m.name}{m.team ? ` · ${m.team}` : ''}</option>)}
                    <option value="__ext">사외 직접 입력…</option>
                  </select>
                  {!editing.ownerUserId && (
                    <Input value={editing.owner || ''}
                      onChange={e => setEditing(v => v && { ...v, owner: e.target.value || undefined })}
                      placeholder="소방서 · 세무 · 용산구청" className="mt-1.5 h-8 text-xs" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>금액</Label>
                  <Input type="number" min={0} value={editing.budget ?? ''}
                    onChange={e => setEditing(v => v && { ...v, budget: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                    placeholder="0" />
                </div>
              </div>
              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={editing.urgent}
                    onChange={e => setEditing(v => v && { ...v, urgent: e.target.checked })} />
                  급함
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={editing.blocker}
                    onChange={e => setEditing(v => v && { ...v, blocker: e.target.checked })} />
                  <span>막고 있음 <span className="text-[11px] text-muted-foreground">— 이게 안 끝나면 뒤가 막힘</span></span>
                </label>
              </div>
            </div>
          )}
          <DialogFooter className="flex items-center">
            {items.some(i => i.id === editing?.id) && (
              <Button variant="ghost" size="sm" className="mr-auto text-[var(--system-red)] gap-1"
                onClick={removeItem}>
                <Trash2 className="w-3.5 h-3.5" />삭제
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(null)}>취소</Button>
            <Button onClick={saveItem}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
