// AMESCOTES ERP — 납기 관리
import { useState, useMemo } from 'react';
import { store, calcDDay, dDayColor, dDayLabel, formatNumber, type ProductionOrder, type OrderStatus, type MilestoneStage, type OrderMilestone } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarClock, List, Calendar, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';

const MILESTONE_LABELS: Partial<Record<MilestoneStage, string>> = {
  '샘플1차': '샘플1차',
  '샘플승인': '샘플승인',
  '생산시작': '생산시작',
  '선적': '선적',
  '통관': '통관',
  '입고완료': '입고완료',
  '발주생성': '발주생성',
  '생산중': '생산중',
  '선적중': '선적중',
  '통관중': '통관중',
};

export default function DeadlineManagement() {
  const [orders, setOrders] = useState(() => store.getOrders());
  const items = store.getItems();
  const [view, setView] = useState('list');

  const refresh = () => setOrders(store.getOrders());

  const handleCompleteMilestone = (orderId: string, milestones: OrderMilestone[]) => {
    const today = new Date().toISOString().split('T')[0];
    const nextIdx = milestones.findIndex(m => !m.actualDate);
    if (nextIdx < 0) { toast.error('완료 처리할 마일스톤이 없습니다'); return; }
    const updated = milestones.map((m, i) => i === nextIdx ? { ...m, actualDate: today } : m);
    // 마지막 마일스톤(입고완료) 완료 시 자동으로 status → "입고완료"
    const isLastStage = milestones[nextIdx].stage === '입고완료';
    const isAllDone = updated.every(m => !!m.actualDate);
    const updatePayload: Partial<ProductionOrder> = { milestones: updated, updatedAt: new Date().toISOString() };
    if (isAllDone || isLastStage) {
      updatePayload.status = '입고완료';
    }
    store.updateOrder(orderId, updatePayload);
    refresh();
    if (updatePayload.status === '입고완료') {
      toast.success(`"${milestones[nextIdx].stage}" 완료 → 발주 상태가 "입고완료"로 자동 변경되었습니다 ✅`);
    } else {
      toast.success(`"${milestones[nextIdx].stage}" 마일스톤 완료 처리`);
    }
  };

  // Active orders: not fully completed (입고완료 status)
  const activeOrders = useMemo(() =>
    orders.filter(o => o.status !== '입고완료').sort((a, b) => {
      const aNext = (a.milestones || []).find(m => !m.actualDate && m.plannedDate);
      const bNext = (b.milestones || []).find(m => !m.actualDate && m.plannedDate);
      const aD = aNext ? calcDDay(aNext.plannedDate!) : 999;
      const bD = bNext ? calcDDay(bNext.plannedDate!) : 999;
      return aD - bD;
    }),
    [orders]
  );

  // Calendar data
  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());

  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const days: { day: number; events: { orderNo: string; milestone: string; color: string }[] }[] = [];
    for (let i = 0; i < firstDay; i++) days.push({ day: 0, events: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const events: { orderNo: string; milestone: string; color: string }[] = [];
      orders.forEach(o => {
        (o.milestones || []).forEach(m => {
          if (m.plannedDate === dateStr || m.actualDate === dateStr) {
            const dd = calcDDay(m.plannedDate!);
            const color = dd < 0 ? 'bg-red-500' : dd <= 3 ? 'bg-orange-500' : dd <= 7 ? 'bg-yellow-500' : 'bg-green-500';
            events.push({ orderNo: o.orderNo, milestone: MILESTONE_LABELS[m.stage] || m.stage, color });
          }
        });
      });
      days.push({ day: d, events });
    }
    return days;
  }, [orders, calMonth, calYear]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">납기 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">발주 납기 현황 및 일정 관리</p>
        </div>
      </div>

      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="list" className="gap-1"><List size={14} />리스트</TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1"><Calendar size={14} />캘린더</TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1"><BarChart3 size={14} />타임라인</TabsTrigger>
        </TabsList>

        {/* List View */}
        <TabsContent value="list" className="space-y-3 mt-4">
          {activeOrders.map(order => {
            const item = items.find(i => i.styleNo === order.styleNo);
            const milestones = order.milestones || [];
            const nextMilestone = milestones.find(m => !m.actualDate && m.plannedDate);
            const d = nextMilestone ? calcDDay(nextMilestone.plannedDate!) : 0;
            return (
              <Card key={order.id} className="border-border/60 shadow-sm">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-lg flex flex-col items-center justify-center text-xs font-medium shrink-0 ${dDayColor(d)}`}>
                    <span className="text-lg font-number font-bold">{d < 0 ? `+${Math.abs(d)}` : d}</span>
                    <span className="text-[10px]">{d < 0 ? '지연' : 'D-day'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{order.orderNo}</span>
                      <Badge variant="outline" className="text-xs">{order.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{item?.name || order.styleName} · {formatNumber(order.qty)}pcs</p>
                    {nextMilestone && (
                      <p className="text-xs text-muted-foreground mt-1">
                        다음: <span className="font-medium">{MILESTONE_LABELS[nextMilestone.stage] || nextMilestone.stage}</span> ({nextMilestone.plannedDate})
                      </p>
                    )}
                  </div>
                  {/* Mini milestone progress */}
                  {milestones.length > 0 && (
                    <div className="hidden md:flex items-center gap-1">
                      {milestones.map((m, i) => (
                        <div key={i} className={`w-2 h-2 rounded-full ${m.actualDate ? 'bg-green-500' : 'bg-border'}`}
                          title={`${MILESTONE_LABELS[m.stage] || m.stage}: ${m.actualDate || m.plannedDate || '미정'}`} />
                      ))}
                    </div>
                  )}
                  {/* 마일스톤 완료 버튼 */}
                  {milestones.some(m => !m.actualDate) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs text-green-700 border-green-300 hover:bg-green-50 shrink-0"
                      onClick={() => handleCompleteMilestone(order.id, milestones)}
                    >
                      ✅ 완료
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {activeOrders.length === 0 && (
            <Card className="border-border/60"><CardContent className="py-12 text-center text-muted-foreground">
              <CalendarClock size={32} className="mx-auto mb-2 opacity-30" />진행중인 발주가 없습니다
            </CardContent></Card>
          )}
        </TabsContent>

        {/* Calendar View */}
        <TabsContent value="calendar" className="mt-4">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => {
                if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(calMonth - 1);
              }}>◀</Button>
              <CardTitle className="text-base">{calYear}년 {calMonth + 1}월</CardTitle>
              <Button variant="outline" size="sm" onClick={() => {
                if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(calMonth + 1);
              }}>▶</Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-px bg-border rounded overflow-hidden">
                {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                  <div key={d} className="bg-muted/50 text-center py-2 text-xs font-medium text-muted-foreground">{d}</div>
                ))}
                {calendarDays.map((cell, i) => (
                  <div key={i} className={`bg-card min-h-[80px] p-1 ${cell.day === 0 ? 'bg-muted/20' : ''}`}>
                    {cell.day > 0 && (
                      <>
                        <span className={`text-xs font-number ${cell.day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear() ? 'bg-[#C9A96E] text-white w-5 h-5 rounded-full flex items-center justify-center' : ''}`}>
                          {cell.day}
                        </span>
                        <div className="mt-1 space-y-0.5">
                          {cell.events.slice(0, 3).map((ev, j) => (
                            <div key={j} className={`text-[9px] px-1 py-0.5 rounded text-white truncate ${ev.color}`}>
                              {ev.orderNo.split('-')[0].slice(-4)}-{ev.milestone.slice(0, 2)}
                            </div>
                          ))}
                          {cell.events.length > 3 && <span className="text-[9px] text-muted-foreground">+{cell.events.length - 3}</span>}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timeline/Gantt View */}
        <TabsContent value="timeline" className="mt-4">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <CardContent className="p-4">
              <div className="space-y-3">
                {orders.filter(o => o.status !== '입고완료').map(order => {
                  const milestones = order.milestones || [];
                  const allDates = milestones
                    .flatMap(m => [m.plannedDate, m.actualDate])
                    .filter((d): d is string => !!d)
                    .map(d => new Date(d).getTime());
                  const minDate = Math.min(...allDates, Date.now());
                  const maxDate = Math.max(...allDates, Date.now());
                  const range = maxDate - minDate || 1;
                  const todayPos = ((Date.now() - minDate) / range) * 100;

                  return (
                    <div key={order.id} className="flex items-center gap-3">
                      <div className="w-32 shrink-0">
                        <p className="font-mono text-xs font-medium truncate">{order.orderNo}</p>
                        <p className="text-[10px] text-muted-foreground">{order.status}</p>
                      </div>
                      <div className="flex-1 relative h-6 bg-muted/50 rounded">
                        {/* Today marker */}
                        <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10" style={{ left: `${Math.min(todayPos, 100)}%` }} />
                        {/* Milestone dots */}
                        {milestones.map((m, i) => {
                          const date = m.actualDate || m.plannedDate;
                          if (!date) return null;
                          const pos = ((new Date(date).getTime() - minDate) / range) * 100;
                          return (
                            <div key={i}
                              className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white ${m.actualDate ? 'bg-green-500' : 'bg-[#C9A96E]'}`}
                              style={{ left: `${Math.min(pos, 98)}%` }}
                              title={`${MILESTONE_LABELS[m.stage] || m.stage}: ${date}`}
                            />
                          );
                        })}
                        {/* Progress bar */}
                        {milestones.length > 0 && (() => {
                          const completed = milestones.filter(m => m.actualDate).length;
                          const total = milestones.length;
                          const pct = (completed / total) * 100;
                          return <div className="absolute top-0 left-0 bottom-0 bg-green-200 rounded-l" style={{ width: `${pct}%` }} />;
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" />완료</span>
                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[#C9A96E]" />예정</span>
                <span className="flex items-center gap-1"><div className="w-3 h-px bg-red-400" />오늘</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
