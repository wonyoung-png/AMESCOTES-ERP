// 운영 캘린더 · 기획전 — L1 타임라인 + L2 팀 프로젝트 (DESIGN_BRAND_OPS §2.2)
import { useMemo, useState, useCallback, useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  phase1, CAMPAIGN_CHANNELS, type Campaign, type CampaignStatus,
} from '@/lib/phase1';
import {
  type CalendarViewMode, VIEW_LABELS, getBands, periodLabel, eventPosition,
  assignLanes, shiftAnchor, zoomToDate, ymd, weekdayKo, isWeekend, isSunday,
} from '@/lib/calendarTimeline';
import CampaignProjectPanel from '@/components/CampaignProjectPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Link } from 'wouter';
import { fetchProjects, upsertProject, labelOfKind, type Project } from '@/lib/projectQueries';
import ProductDiscountSheet from '@/components/ProductDiscountSheet';
import type { ProductDiscount, CategoryDiscount } from '@/lib/phase1';
import { store } from '@/lib/store';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';

const VIEW_MODES: CalendarViewMode[] = ['year', 'half', 'quarter', 'month', 'week', 'day'];

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: '미온보딩',
  onboarded: '온보딩됨',
  active: '진행중',
  closed: '마감',
};

const STATUS_STYLE: Record<CampaignStatus, string> = {
  draft: 'border-dashed opacity-50 bg-muted',
  onboarded: 'bg-primary/10 border-primary/20',
  active: 'bg-[var(--fill-tertiary)] border-foreground font-medium',
  closed: 'bg-muted opacity-50',
};

interface PlacedEvent extends Campaign {
  _s: number;
  _e: number;
  _lane: number;
}

export default function OperationalCalendar() {
  const { workspace } = useWorkspace();
  const ws = workspace === 'AETALOOF' ? 'AETALOOF' : 'LUMEN';
  const today = new Date();

  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [anchor, setAnchor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all');
  const [, tick] = useState(0);
  const refresh = useCallback(() => tick(n => n + 1), []);

  const [selected, setSelected] = useState<Campaign | null>(null);
  const [showNew, setShowNew] = useState(false);
  // 대형 프로젝트는 여기서 만들고 프로젝트 탭에서 상세를 관리한다
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showDiscounts, setShowDiscounts] = useState(false);
  const itemCategories = useMemo(
    () => Array.from(new Set(store.getItems().map((i: any) => i.erpCategory).filter(Boolean))).sort() as string[],
    [showNew],
  );
  const [pForm, setPForm] = useState({ title: '', kind: '팝업·오픈', startDate: '', endDate: '' });
  const loadProjects = () => fetchProjects(ws).then(setProjects).catch(() => {});
  useEffect(() => { loadProjects(); /* eslint-disable-next-line */ }, [ws]);

  const createProject = async () => {
    if (!pForm.title.trim()) { toast.error('프로젝트 이름을 입력하세요'); return; }
    if (!pForm.endDate) { toast.error('종료일을 입력하세요 — D-day 기준입니다'); return; }
    if (pForm.startDate && pForm.startDate > pForm.endDate) { toast.error('시작일이 종료일보다 늦습니다'); return; }
    const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    try {
      await upsertProject({
        id, workspace: ws, title: pForm.title.trim(), kind: pForm.kind,
        startDate: pForm.startDate || undefined, endDate: pForm.endDate || undefined, anchorLabel: labelOfKind(pForm.kind), status: '진행',
      });
      toast.success('프로젝트를 만들었습니다. 상세 업무는 프로젝트 탭에서 관리합니다');
      setShowNewProject(false);
      setPForm({ title: '', kind: '팝업·오픈', startDate: '', endDate: '' });
      loadProjects();
    } catch (e: any) { toast.error('생성 실패: ' + (e?.message || e)); }
  };
  const [form, setForm] = useState({
    title: '', channel: CAMPAIGN_CHANNELS[0], startDate: '', endDate: '', discountRate: 15, productDiscounts: [] as ProductDiscount[], categoryDiscounts: [] as CategoryDiscount[],
  });

  const campaigns = useMemo(() => {
    return phase1.getCampaigns(ws).filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      return true;
    });
  }, [ws, statusFilter, tick]);

  const bands = useMemo(() => getBands(viewMode, anchor), [viewMode, anchor]);
  const period = periodLabel(viewMode, anchor);

  const colWidth = useMemo(() => {
    const n0 = bands[0]?.cols.length || 1;
    const avail = Math.max(900, typeof window !== 'undefined' ? window.innerWidth - 280 : 900);
    return Math.max(bands[0]?.mincw || 34, (avail - 154) / n0);
  }, [bands]);

  const shift = (dir: 1 | -1) => setAnchor(a => shiftAnchor(viewMode, a, dir));
  const goToday = () => setAnchor(new Date(today.getFullYear(), today.getMonth(), today.getDate()));

  const createCampaign = () => {
    if (!form.title || !form.startDate || !form.endDate) {
      toast.error('제목·기간 필수'); return;
    }
    const row = phase1.addCampaign({
      workspace: ws,
      title: form.title,
      channel: form.channel,
      startDate: form.startDate,
      endDate: form.endDate,
      status: 'onboarded',
      discountRate: form.discountRate,
      productDiscounts: form.productDiscounts.length ? form.productDiscounts : undefined,
      categoryDiscounts: form.categoryDiscounts.length ? form.categoryDiscounts : undefined,
      owner: '국내영업',
    });
    phase1.onboardCampaign(row.id);
    toast.success('기획전이 생성되었습니다. 팀별로 업무를 직접 추가하세요');
    setShowNew(false);
    setForm({ title: '', channel: CAMPAIGN_CHANNELS[0], startDate: '', endDate: '', discountRate: 15, productDiscounts: [], categoryDiscounts: [] });
    refresh();
  };

  /** 캘린더 빈 칸을 누르면 그 날짜가 채워진 채로 등록창이 열린다 */
  const openNewCampaignAt = (ds: string, channel: string) => {
    setForm(f => ({ ...f, startDate: ds, endDate: ds, channel }));
    setShowNew(true);
  };
  const openNewProjectAt = (ds: string) => {
    setPForm(f => ({ ...f, startDate: ds, endDate: ds }));
    setShowNewProject(true);
  };

  const handleZoom = (ds: string) => {
    const next = zoomToDate(ds, viewMode);
    setViewMode(next.view);
    setAnchor(next.anchor);
  };

  const renderBand = (band: ReturnType<typeof getBands>[0], bandIdx: number) => {
    const n = band.cols.length;
    const totalW = n * colWidth;

    const headerCells = band.cols.map((c, i) => {
      const isToday = ymd(c) === ymd(today);
      let label = '';
      let sub = '';
      if (band.unit === 'day') {
        label = viewMode === 'day' ? `${c.getMonth() + 1}월 ${c.getDate()}일` : String(c.getDate());
        sub = viewMode === 'day' ? `${weekdayKo(c)}요일` : weekdayKo(c);
      } else {
        label = `${c.getMonth() + 1}월`;
        sub = String(c.getFullYear());
      }
      return (
        <button
          key={i}
          type="button"
          onClick={() => handleZoom(ymd(c))}
          className={`absolute top-0 h-full flex flex-col items-center justify-center text-[11px] border-r border-border hover:bg-[var(--fill-quaternary)] ${
            isSunday(c) ? 'text-[var(--system-red)]' : isWeekend(c) ? 'bg-[var(--fill-quaternary)]' : ''
          } ${isToday ? 'bg-primary/15 font-bold' : 'text-muted-foreground'}`}
          style={{ left: i * colWidth, width: colWidth }}
        >
          <span className="text-xs font-semibold text-foreground">{label}</span>
          <span className="text-[11px]">{sub}</span>
          {isToday && <span className="text-[11px] text-primary font-bold">오늘</span>}
        </button>
      );
    });

    // 프로젝트 띠 — 기간이 걸치는 프로젝트만. 클릭하면 프로젝트 탭으로 간다.
    const projEvs: PlacedEvent[] = [];
    projects.forEach(pr => {
      if (!pr.endDate) return;
      // 시작이 따로 없으니 앵커(오픈일) 하루짜리로 두되, 항목 마감 중 가장 이른 날부터 그린다
      const firstDue = pr.startDate || pr.items.map(i => i.due).filter(Boolean).sort()[0];
      const pos = eventPosition(firstDue || pr.endDate, pr.endDate, band);
      if (pos) projEvs.push({ ...(pr as any), title: pr.title, status: 'active', _s: pos.s, _e: pos.e, _lane: 0 });
    });
    const projLanes = assignLanes(projEvs);
    const projRow = projEvs.length === 0 ? null : (
      <div key={`${bandIdx}-proj`} className="flex border-b-2 border-border">
        <div className="w-[120px] shrink-0 px-3 py-2 text-xs font-semibold text-foreground border-r border-border bg-card sticky left-0 z-10 flex items-center"
          style={{ minHeight: Math.max(34, projLanes * 30 + 4) }}>
          프로젝트
        </div>
        <div className="relative" style={{ width: totalW, height: Math.max(34, projLanes * 30 + 4) }}>
          {band.cols.map((c, i) => (
            <button key={`pn-${i}`} type="button" title={`${ymd(c)} 프로젝트 등록`}
              onClick={() => openNewProjectAt(ymd(c))}
              className="absolute top-0 h-full hover:bg-primary/5"
              style={{ left: i * colWidth, width: colWidth }} />
          ))}
          {projEvs.map(ev => (
            <Link key={(ev as any).id} href="/projects">
              <a
                className="absolute h-[24px] rounded-md border border-primary/30 bg-primary/10 text-primary text-[11px] px-1.5 truncate text-left z-10 flex items-center hover:bg-primary/20"
                style={{ left: ev._s * colWidth + 2, width: Math.max(24, (ev._e - ev._s + 1) * colWidth - 4), top: (ev._lane ?? 0) * 30 + 4 }}
                title={`${ev.title} — 프로젝트 탭에서 상세 관리`}
              >
                {ev.title}
              </a>
            </Link>
          ))}
        </div>
      </div>
    );
    const projectBand = projRow;

    const channelRows = CAMPAIGN_CHANNELS.map(ch => {
      const evs: PlacedEvent[] = [];
      campaigns.filter(c => c.channel === ch && c.status !== 'draft').forEach(c => {
        const p = eventPosition(c.startDate, c.endDate, band);
        if (p) evs.push({ ...c, _s: p.s, _e: p.e, _lane: 0 });
      });
      const laneCount = assignLanes(evs);
      const laneH = 30;
      const rowH = Math.max(34, laneCount * laneH + 4);

      return (
        <div key={`${bandIdx}-${ch}`} className="flex border-b border-border">
          <div
            className="w-[120px] shrink-0 px-3 py-2 text-xs font-medium text-foreground border-r border-border bg-card sticky left-0 z-10 flex items-center"
            style={{ minHeight: rowH }}
          >
            <span>{ch}</span>
            {laneCount > 1 && (
              <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">{laneCount}건</span>
            )}
          </div>
          <div className="relative" style={{ width: totalW, height: rowH }}>
            {band.unit === 'day' && band.cols.map((c, i) => (
              isWeekend(c) ? (
                <div key={i} className="absolute top-0 h-full bg-[var(--fill-quaternary)] pointer-events-none" style={{ left: i * colWidth, width: colWidth }} />
              ) : null
            ))}
            {/* 빈 칸을 눌러 그 날짜·그 채널로 바로 등록 */}
            {band.cols.map((c, i) => (
              <button key={`n-${i}`} type="button" title={`${ymd(c)} · ${ch} 기획전 등록`}
                onClick={() => openNewCampaignAt(ymd(c), ch)}
                className="absolute top-0 h-full hover:bg-primary/5"
                style={{ left: i * colWidth, width: colWidth }} />
            ))}
            {evs.map(ev => {
              const left = ev._s * colWidth + 2;
              const width = Math.max(24, (ev._e - ev._s + 1) * colWidth - 4);
              const pct = phase1.getCampaignProgress(ev);
              const top = (ev._lane ?? 0) * laneH + 4;
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => setSelected(ev)}
                  className={`absolute h-[24px] rounded-md border text-[11px] px-1.5 truncate text-left z-10 ${STATUS_STYLE[ev.status]}`}
                  style={{ left, width, top }}
                  title={`${ev.title} (${ev.startDate}~${ev.endDate}) ${pct}%`}
                >
                  {ev.title}
                  {(ev.status === 'active' || ev.status === 'onboarded') && ` ${pct}%`}
                </button>
              );
            })}
          </div>
        </div>
      );
    });

    return (
      <div key={bandIdx} className={bandIdx > 0 ? 'mt-4' : ''}>
        <div className="flex border-b border-border bg-muted sticky top-0 z-20">
          <div className="w-[120px] shrink-0 px-3 py-2 text-xs font-semibold text-muted-foreground border-r border-border">채널</div>
          <div className="relative h-11" style={{ width: totalW }}>
            {headerCells}
          </div>
        </div>
        {projectBand}
        {channelRows}
      </div>
    );
  };

  const hint = bands[0]?.unit === 'day'
    ? '빈 칸 클릭 → 그 날짜로 등록 · 날짜 헤더 클릭 → 확대 · 막대 클릭 → 팀 업무'
    : '연간/반기/분기/월/주 뷰 전환 · 막대 클릭 시 팀별 상세 업무 · 완료율은 캘린더에 표시';

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h1 className="text-2xl font-bold text-foreground">운영 캘린더 · 기획전</h1>
          <p className="text-sm text-muted-foreground">{ws} — 기획전별 팀 프로젝트 · 주/월/분기/반기/연간 뷰</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowNewProject(true)}>
            <Plus className="w-4 h-4 mr-1" />프로젝트
          </Button>
          <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" />기획전</Button>
        </div>
      </div>

      {/* 뷰 전환: 연간 · 반기 · 분기 · 월 · 주 · 일 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-muted rounded-md p-1 gap-0.5">
          {VIEW_MODES.map(v => (
            <Button
              key={v}
              size="sm"
              variant={viewMode === v ? 'secondary' : 'ghost'}
              className="h-8 text-xs px-3"
              onClick={() => setViewMode(v)}
            >
              {VIEW_LABELS[v]}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 border rounded-md p-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-semibold min-w-[140px] text-center">{period}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(1)}><ChevronRight className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" className="h-8 ml-1" onClick={goToday}>오늘</Button>
        </div>
        {(['all', 'active', 'onboarded', 'draft', 'closed'] as const).map(s => (
          <Button key={s} size="sm" variant={statusFilter === s ? 'secondary' : 'outline'} onClick={() => setStatusFilter(s)}>
            {s === 'all' ? '전체' : STATUS_LABEL[s]}
          </Button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{hint}</p>

      {/* 타임라인 */}
      <div className="bg-card rounded-lg border border-border overflow-x-auto">
        <div style={{ minWidth: 120 + (bands[0]?.cols.length || 1) * colWidth }}>
          {bands.map((band, i) => renderBand(band, i))}
        </div>
      </div>

      {/* 진행중 기획전 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {campaigns.filter(c => c.status === 'active' || c.status === 'onboarded').map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelected(c)}
            className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary transition-colors"
          >
            <div className="flex justify-between items-start gap-2">
              <span className="font-medium text-sm">{c.title}</span>
              <Badge variant="outline" className="text-[11px] shrink-0">{STATUS_LABEL[c.status]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{c.channel} · {c.startDate} ~ {c.endDate}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {['MD', '마케팅', '비주얼', '디자인', '물류'].map(team => {
                const pct = phase1.getCampaignTeamProgress(c, team);
                if (!c.tasks.some(t => t.team === team)) return null;
                return (
                  <span key={team} className={`text-[11px] px-1.5 py-0.5 rounded ${pct === 100 ? 'bg-[var(--fill-quaternary)] text-[var(--system-green)]' : 'bg-[var(--fill-quaternary)] text-muted-foreground'}`}>
                    {team} {pct}%
                  </span>
                );
              })}
            </div>
            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${phase1.getCampaignProgress(c)}%` }} />
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <CampaignProjectPanel
          campaign={selected}
          onClose={() => setSelected(null)}
          onRefresh={() => {
            refresh();
            const updated = phase1.getCampaign(selected.id);
            if (updated) setSelected(updated);
          }}
        />
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>기획전 생성</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>이름 *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="여름 시즌오프" autoFocus />
            </div>
            {/* 한 줄에 둘씩 — 세로로 늘어지면 한눈에 안 들어온다 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>채널</Label>
                <select className="w-full border border-border rounded-md h-9 px-2 text-sm bg-card" value={form.channel}
                  onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
                  {CAMPAIGN_CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>기본 할인율 %</Label>
                <Input type="number" min="0" max="100" value={form.discountRate}
                  onChange={e => setForm(f => ({ ...f, discountRate: Math.min(100, Math.max(0, +e.target.value)) }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>시작 *</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>종료 *</Label>
                <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>

            {/* 예외 할인은 대부분 안 쓴다 — 접어두고 필요할 때만 편다 */}
            <details className="border border-border rounded-md">
              <summary className="px-3 py-2 text-sm cursor-pointer select-none flex items-center gap-2">
                예외 할인율
                <span className="text-[11px] text-muted-foreground">
                  {form.categoryDiscounts.length || form.productDiscounts.length
                    ? `카테고리 ${form.categoryDiscounts.length} · 상품 ${form.productDiscounts.length}`
                    : `전부 ${form.discountRate}%`}
                </span>
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-2">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {itemCategories.map(c => {
                    const hit = form.categoryDiscounts.find(d => d.category === c);
                    return (
                      <div key={c} className="flex items-center gap-1.5">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer flex-1 min-w-0">
                          <input type="checkbox" checked={!!hit}
                            onChange={e => setForm(f => ({
                              ...f,
                              categoryDiscounts: e.target.checked
                                ? [...f.categoryDiscounts, { category: c, rate: f.discountRate }]
                                : f.categoryDiscounts.filter(d => d.category !== c),
                            }))} />
                          <span className="truncate">{c}</span>
                        </label>
                        <Input type="number" min={0} max={100} disabled={!hit}
                          value={hit ? hit.rate : ''}
                          onChange={e => {
                            const r = Math.min(100, Math.max(0, +e.target.value || 0));
                            setForm(f => ({ ...f, categoryDiscounts: f.categoryDiscounts.map(d => d.category === c ? { ...d, rate: r } : d) }));
                          }}
                          placeholder="—" className="h-7 w-14 text-right text-xs px-1.5" />
                        <span className="text-[11px] text-muted-foreground">%</span>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-full justify-between"
                  onClick={() => setShowDiscounts(true)}>
                  <span className="text-xs">
                    {form.productDiscounts.length ? `상품 ${form.productDiscounts.length}개 지정됨` : '상품별로 다르게 걸기'}
                  </span>
                  <span className="text-muted-foreground">›</span>
                </Button>
              </div>
            </details>
            <p className="text-[11px] text-muted-foreground">업무는 자동 생성되지 않습니다. 만든 뒤 팀 탭에서 등록하세요.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>취소</Button>
            <Button onClick={createCampaign}>만들기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    <Dialog open={showNewProject} onOpenChange={setShowNewProject}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>새 프로젝트</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            팝업 오픈·시즌 런칭처럼 몇 달에 걸친 일입니다. 여기서 만들고 <b>상세 업무는 프로젝트 탭</b>에서 관리합니다.
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>이름 *</Label>
              <Input value={pForm.title} onChange={e => setPForm(f => ({ ...f, title: e.target.value }))}
                placeholder="한남 플래그십 오픈" />
            </div>
            <div className="space-y-1.5">
              <Label>유형</Label>
              <select value={pForm.kind} onChange={e => setPForm(f => ({ ...f, kind: e.target.value }))}
                className="w-full h-9 text-sm border border-border rounded-md bg-card px-2">
                {['팝업·오픈', '시즌 런칭', '콜라보', '입점', '스토어 구축', '기타'].map(k => <option key={k}>{k}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>시작일</Label>
                <Input type="date" value={pForm.startDate}
                  onChange={e => setPForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>종료일 *</Label>
                <Input type="date" value={pForm.endDate}
                  onChange={e => setPForm(f => ({ ...f, endDate: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground">이 날짜로 D-day를 셉니다</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewProject(false)}>취소</Button>
            <Button onClick={createProject}>만들기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    <ProductDiscountSheet
        open={showDiscounts}
        onOpenChange={setShowDiscounts}
        baseRate={form.discountRate}
        value={form.productDiscounts}
        onChange={v => setForm(f => ({ ...f, productDiscounts: v }))}
      />

    </div>
  );
}
