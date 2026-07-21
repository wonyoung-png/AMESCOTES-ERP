// 운영 캘린더 · 기획전 — L1 타임라인 + L2 팀 프로젝트 (DESIGN_BRAND_OPS §2.2)
import { useMemo, useState, useCallback } from 'react';
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
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';

const VIEW_MODES: CalendarViewMode[] = ['year', 'half', 'quarter', 'month', 'week', 'day'];

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: '미온보딩',
  onboarded: '온보딩됨',
  active: '진행중',
  closed: '마감',
};

const STATUS_STYLE: Record<CampaignStatus, string> = {
  draft: 'border-dashed opacity-50 bg-stone-100',
  onboarded: 'bg-blue-50 border-blue-200',
  active: 'bg-emerald-50 border-emerald-300 font-medium',
  closed: 'bg-stone-50 opacity-50',
};

interface PlacedEvent extends Campaign {
  _s: number;
  _e: number;
  _lane: number;
}

export default function OperationalCalendar() {
  const { workspace } = useWorkspace();
  const ws = workspace === 'AETALOOP' ? 'AETALOOP' : 'LUMEN';
  const today = new Date();

  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [anchor, setAnchor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all');
  const [, tick] = useState(0);
  const refresh = useCallback(() => tick(n => n + 1), []);

  const [selected, setSelected] = useState<Campaign | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    title: '', channel: CAMPAIGN_CHANNELS[0], startDate: '', endDate: '', discountRate: 15,
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
      owner: 'MD',
    });
    phase1.onboardCampaign(row.id);
    toast.success('기획전이 생성되었습니다. 팀별로 업무를 직접 추가하세요');
    setShowNew(false);
    setForm({ title: '', channel: CAMPAIGN_CHANNELS[0], startDate: '', endDate: '', discountRate: 15 });
    refresh();
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
          className={`absolute top-0 h-full flex flex-col items-center justify-center text-[10px] border-r border-stone-100 hover:bg-stone-100 ${
            isSunday(c) ? 'text-red-500' : isWeekend(c) ? 'bg-stone-50' : ''
          } ${isToday ? 'bg-[#C9A96E]/20 font-bold' : 'text-stone-500'}`}
          style={{ left: i * colWidth, width: colWidth }}
        >
          <span className="text-xs font-semibold text-stone-800">{label}</span>
          <span className="text-[9px]">{sub}</span>
          {isToday && <span className="text-[8px] text-[#C9A96E] font-bold">오늘</span>}
        </button>
      );
    });

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
        <div key={`${bandIdx}-${ch}`} className="flex border-b border-stone-100">
          <div
            className="w-[120px] shrink-0 px-3 py-2 text-xs font-medium text-stone-700 border-r border-stone-200 bg-white sticky left-0 z-10 flex items-center"
            style={{ minHeight: rowH }}
          >
            <span>{ch}</span>
            {laneCount > 1 && (
              <span className="ml-1.5 text-[9px] text-stone-400 font-normal">{laneCount}건</span>
            )}
          </div>
          <div className="relative" style={{ width: totalW, height: rowH }}>
            {band.unit === 'day' && band.cols.map((c, i) => (
              isWeekend(c) ? (
                <div key={i} className="absolute top-0 h-full bg-stone-50/80 pointer-events-none" style={{ left: i * colWidth, width: colWidth }} />
              ) : null
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
                  className={`absolute h-[24px] rounded-md border text-[10px] px-1.5 truncate text-left z-10 ${STATUS_STYLE[ev.status]}`}
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
        <div className="flex border-b border-stone-200 bg-stone-50 sticky top-0 z-20">
          <div className="w-[120px] shrink-0 px-3 py-2 text-xs font-semibold text-stone-500 border-r border-stone-200">채널</div>
          <div className="relative h-11" style={{ width: totalW }}>
            {headerCells}
          </div>
        </div>
        {channelRows}
      </div>
    );
  };

  const hint = bands[0]?.unit === 'day'
    ? '날짜 헤더 클릭 → 확대 · 막대 클릭 → 팀 프로젝트 업무'
    : '연간/반기/분기/월/주 뷰 전환 · 막대 클릭 시 팀별 상세 업무 · 완료율은 캘린더에 표시';

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">운영 캘린더 · 기획전</h1>
          <p className="text-sm text-stone-500">{ws} — 기획전별 팀 프로젝트 · 주/월/분기/반기/연간 뷰</p>
        </div>
        <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" />기획전</Button>
      </div>

      {/* 뷰 전환: 연간 · 반기 · 분기 · 월 · 주 · 일 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-stone-100 rounded-lg p-1 gap-0.5">
          {VIEW_MODES.map(v => (
            <Button
              key={v}
              size="sm"
              variant={viewMode === v ? 'default' : 'ghost'}
              className="h-8 text-xs px-3"
              onClick={() => setViewMode(v)}
            >
              {VIEW_LABELS[v]}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 border rounded-lg p-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-semibold min-w-[140px] text-center">{period}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(1)}><ChevronRight className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" className="h-8 ml-1" onClick={goToday}>오늘</Button>
        </div>
        {(['all', 'active', 'onboarded', 'draft', 'closed'] as const).map(s => (
          <Button key={s} size="sm" variant={statusFilter === s ? 'default' : 'outline'} onClick={() => setStatusFilter(s)}>
            {s === 'all' ? '전체' : STATUS_LABEL[s]}
          </Button>
        ))}
      </div>

      <p className="text-xs text-stone-400">{hint}</p>

      {/* 타임라인 */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-x-auto">
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
            className="text-left bg-white border rounded-xl p-4 hover:border-[#C9A96E] transition-colors"
          >
            <div className="flex justify-between items-start gap-2">
              <span className="font-medium text-sm">{c.title}</span>
              <Badge variant="outline" className="text-[10px] shrink-0">{STATUS_LABEL[c.status]}</Badge>
            </div>
            <p className="text-xs text-stone-500 mt-1">{c.channel} · {c.startDate} ~ {c.endDate}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {['MD', '마케팅', '비주얼', '디자인', '물류'].map(team => {
                const pct = phase1.getCampaignTeamProgress(c, team);
                if (!c.tasks.some(t => t.team === team)) return null;
                return (
                  <span key={team} className={`text-[9px] px-1.5 py-0.5 rounded ${pct === 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                    {team} {pct}%
                  </span>
                );
              })}
            </div>
            <div className="mt-2 h-1.5 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#C9A96E] rounded-full" style={{ width: `${phase1.getCampaignProgress(c)}%` }} />
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
        <DialogContent>
          <DialogHeader><DialogTitle>기획전 생성</DialogTitle></DialogHeader>
          <p className="text-xs text-stone-500 -mt-2">업무는 자동 생성되지 않습니다. 생성 후 팀 탭에서 직접 등록하세요.</p>
          <div className="space-y-3">
            <div><Label>이름</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="여름 시즌오프" /></div>
            <div>
              <Label>채널</Label>
              <select className="w-full border rounded-md h-9 px-2 text-sm" value={form.channel}
                onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
                {CAMPAIGN_CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>시작</Label><Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><Label>종료</Label><Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div><Label>할인율 %</Label><Input type="number" value={form.discountRate} onChange={e => setForm(f => ({ ...f, discountRate: +e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>취소</Button>
            <Button onClick={createCampaign}>기획전 생성</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
