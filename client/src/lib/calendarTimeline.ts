// 운영 캘린더 타임라인 — design/프로토타입_운영캘린더.html 로직 이식

export type CalendarViewMode = 'year' | 'half' | 'quarter' | 'month' | 'week' | 'day';

export const VIEW_LABELS: Record<CalendarViewMode, string> = {
  year: '연간',
  half: '반기',
  quarter: '분기',
  month: '월',
  week: '주',
  day: '일',
};

export interface TimelineBand {
  unit: 'day' | 'month';
  start: Date;
  cols: Date[];
  mincw: number;
}

export function ymd(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function parseYmd(s: string): Date {
  const [y, mo, d] = s.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

export function addDays(dt: Date, n: number): Date {
  const x = new Date(dt);
  x.setDate(x.getDate() + n);
  return x;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function startOfWeek(dt: Date): Date {
  const x = new Date(dt);
  const w = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - w);
  return x;
}

function monthIdx(dt: Date): number {
  return dt.getFullYear() * 12 + dt.getMonth();
}

function monthBand(start: Date, count: number, mincw: number): TimelineBand {
  const cols: Date[] = [];
  for (let i = 0; i < count; i++) cols.push(new Date(start.getFullYear(), start.getMonth() + i, 1));
  return { unit: 'month', start, cols, mincw };
}

export function getBands(view: CalendarViewMode, anchor: Date): TimelineBand[] {
  if (view === 'day') {
    return [{ unit: 'day', start: new Date(anchor), cols: [new Date(anchor)], mincw: 200 }];
  }
  if (view === 'week') {
    const s = startOfWeek(anchor);
    const cols = Array.from({ length: 7 }, (_, i) => addDays(s, i));
    return [{ unit: 'day', start: s, cols, mincw: 96 }];
  }
  if (view === 'month') {
    const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const days = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    const cols = Array.from({ length: days }, (_, i) => addDays(s, i));
    return [{ unit: 'day', start: s, cols, mincw: 34 }];
  }
  if (view === 'quarter') {
    const q = Math.floor(anchor.getMonth() / 3);
    return [monthBand(new Date(anchor.getFullYear(), q * 3, 1), 3, 150)];
  }
  if (view === 'half') {
    return [monthBand(new Date(anchor.getFullYear(), anchor.getMonth() < 6 ? 0 : 6, 1), 6, 120)];
  }
  const y = anchor.getFullYear();
  return [monthBand(new Date(y, 0, 1), 6, 120), monthBand(new Date(y, 6, 1), 6, 120)];
}

export function periodLabel(view: CalendarViewMode, anchor: Date): string {
  const y = anchor.getFullYear();
  if (view === 'day') return `${y}년 ${anchor.getMonth() + 1}월 ${anchor.getDate()}일`;
  if (view === 'week') {
    const s = startOfWeek(anchor);
    const e = addDays(s, 6);
    return `${ymd(s).slice(0, 10)} – ${ymd(e).slice(5)}`;
  }
  if (view === 'month') return `${y}년 ${anchor.getMonth() + 1}월`;
  if (view === 'quarter') return `${y}년 ${Math.floor(anchor.getMonth() / 3) + 1}분기`;
  if (view === 'half') return `${y}년 ${anchor.getMonth() < 6 ? '상반기' : '하반기'}`;
  return `${y}년`;
}

export interface TimelineEventPos {
  s: number;
  e: number;
  lane: number;
}

export function eventPosition(
  startDate: string,
  endDate: string,
  band: TimelineBand,
): { s: number; e: number } | null {
  const s = parseYmd(startDate);
  const e = parseYmd(endDate);
  let si: number;
  let ei: number;
  if (band.unit === 'day') {
    si = diffDays(band.start, s);
    ei = diffDays(band.start, e);
  } else {
    si = monthIdx(s) - monthIdx(band.start);
    ei = monthIdx(e) - monthIdx(band.start);
  }
  const n = band.cols.length;
  if (ei < 0 || si > n - 1) return null;
  return { s: Math.max(0, si), e: Math.min(n - 1, ei) };
}

export function assignLanes<T extends { _s: number; _e: number; _lane?: number }>(list: T[]): number {
  const sorted = [...list].sort((a, b) => a._s - b._s || a._e - b._e);
  const laneEnds: number[] = [];
  sorted.forEach((e) => {
    let put = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      // lane i 사용 가능 = 이전 이벤트 종료 컬럼이 현재 시작보다 앞서야 함
      if (laneEnds[i] < e._s) { put = i; break; }
    }
    if (put < 0) { put = laneEnds.length; laneEnds.push(-1); }
    e._lane = put;
    laneEnds[put] = e._e;
  });
  return Math.max(1, laneEnds.length);
}

/** 날짜 구간 겹침 (캘린더 행 분리용) */
export function dateRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function shiftAnchor(view: CalendarViewMode, anchor: Date, dir: 1 | -1): Date {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  if (view === 'quarter') return new Date(anchor.getFullYear(), anchor.getMonth() + 3 * dir, 1);
  if (view === 'half') return new Date(anchor.getFullYear(), anchor.getMonth() + 6 * dir, 1);
  return new Date(anchor.getFullYear() + dir, anchor.getMonth(), 1);
}

export function zoomToDate(ds: string, currentView: CalendarViewMode): { view: CalendarViewMode; anchor: Date } {
  const anchor = parseYmd(ds);
  if (currentView === 'year' || currentView === 'half' || currentView === 'quarter') {
    return { view: 'month', anchor };
  }
  if (currentView === 'month' || currentView === 'week') {
    return { view: 'day', anchor };
  }
  return { view: currentView, anchor };
}

export function weekdayKo(dt: Date): string {
  return ['월', '화', '수', '목', '금', '토', '일'][(dt.getDay() + 6) % 7];
}

export function isWeekend(dt: Date): boolean {
  return dt.getDay() === 0 || dt.getDay() === 6;
}

export function isSunday(dt: Date): boolean {
  return dt.getDay() === 0;
}
