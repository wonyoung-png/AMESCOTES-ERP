// AMESCOTES ERP — 납기 관리
import { useQuery } from '@tanstack/react-query';
import { fetchOrders, upsertOrder } from '@/lib/supabaseQueries';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Package } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { store, calcDDay, dDayColor, dDayLabel, formatNumber, type ProductionOrder, type MilestoneStage, type OrderMilestone, type OrderStatus } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarClock, List, Calendar, BarChart3, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
  const { data: orders = [], refetch: refetchOrders } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
  const items = store.getItems();
  const [view, setView] = useState('list');

  const refresh = () => refetchOrders();

  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [statusTarget, setStatusTarget] = useState<ProductionOrder | null>(null);
  const ORDER_STATUSES: OrderStatus[] = ['발주생성', '생산중', '생산완료', '입고완료'];

  /** 납기 화면에서 바로 발주 상태를 바꾼다 (생산발주 탭과 같은 값) */
  const changeStatus = async (order: ProductionOrder, status: OrderStatus) => {
    try {
      await upsertOrder({ ...order, status, updatedAt: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.success(`${order.orderNo} → ${status}`);
    } catch (e) {
      toast.error(`상태 변경 실패: ${(e as Error).message}`);
    }
  };

  /** 작업지시서를 생산발주 화면에서 열도록 발주번호를 넘긴다 */
  const openWorkOrder = (order: ProductionOrder) => {
    localStorage.setItem('ames_open_work_order', order.id);
    navigate('/orders');
  };

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

    // 입고완료 시 상태만 갱신 (매출관리는 Phase 2)
    if (updatePayload.status === '입고완료') {
      toast.success(`"${milestones[nextIdx].stage}" 완료 → 발주 "입고완료"`);
    } else {
      toast.success(`"${milestones[nextIdx].stage}" 마일스톤 완료 처리`);
    }

    refresh();
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
    const days: { day: number; events: { orderId: string; orderNo: string; milestone: string; color: string; status: string }[] }[] = [];
    for (let i = 0; i < firstDay; i++) days.push({ day: 0, events: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const events: { orderId: string; orderNo: string; milestone: string; color: string; status: string }[] = [];
      orders.forEach(o => {
        const ms = o.milestones || [];
        ms.forEach(m => {
          if (m.plannedDate === dateStr || m.actualDate === dateStr) {
            const dd = calcDDay(m.plannedDate!);
            const color = dd < 0 ? 'bg-[var(--system-red)]' : dd <= 7 ? 'bg-[var(--system-orange)]' : 'bg-[var(--system-green)]';
            events.push({ orderId: o.id, orderNo: o.orderNo, milestone: MILESTONE_LABELS[m.stage] || m.stage, color, status: o.status });
          }
        });
        // 마일스톤을 아직 안 잡은 발주도 발주일·납기일은 달력에 보여준다
        if (ms.length === 0) {
          if (o.orderDate === dateStr) {
            events.push({ orderId: o.id, orderNo: o.orderNo, milestone: '발주', color: 'bg-[var(--system-green)]', status: o.status });
          }
          if (o.deliveryDate === dateStr) {
            const dd = calcDDay(o.deliveryDate);
            const color = dd < 0 ? 'bg-[var(--system-red)]' : dd <= 7 ? 'bg-[var(--system-orange)]' : 'bg-primary';
            events.push({ orderId: o.id, orderNo: o.orderNo, milestone: '납기', color, status: o.status });
          }
        }
      });
      days.push({ day: d, events });
    }
    return days;
  }, [orders, calMonth, calYear]);

  return (
    <div className="p-4 md:p-6 space-y-4">
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
        </TabsList>

        {/* List View */}
        <TabsContent value="list" className="space-y-3 mt-4">
          {activeOrders.map(order => {
            const item = items.find(i => i.styleNo === order.styleNo);
            const milestones = order.milestones || [];
            const nextMilestone = milestones.find(m => !m.actualDate && m.plannedDate);
            // D-Day: deliveryDate 우선, 없으면 다음 마일스톤 날짜 사용
            const dDaySource = order.deliveryDate || nextMilestone?.plannedDate;
            const d = dDaySource ? Math.ceil((new Date(dDaySource).getTime() - Date.now()) / 86400000) : null;
            return (
              <Card key={order.id} className="border-border">
                <CardContent className="p-4 flex flex-wrap items-center gap-4">
                  <div className={`w-14 h-14 rounded-md flex flex-col items-center justify-center text-xs font-medium shrink-0 ${d !== null ? dDayColor(d) : 'bg-muted text-muted-foreground'}`}>
                    {d !== null ? (
                      <>
                        <span className="text-lg font-number font-bold">{d < 0 ? `+${Math.abs(d)}` : d}</span>
                        <span className="text-[11px]">{d < 0 ? '지연' : 'D-day'}</span>
                      </>
                    ) : (
                      <span className="text-[11px] text-center px-1">납기일<br/>미설정</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{order.orderNo}</span>
                      <Select value={order.status} onValueChange={v => changeStatus(order, v as OrderStatus)}>
                        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ORDER_STATUSES.map(st => <SelectItem key={st} value={st} className="text-xs">{st}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
                        onClick={() => openWorkOrder(order)}>
                        <Package className="w-3.5 h-3.5" />작업지시서
                      </Button>
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
                        <div key={i} className={`w-2 h-2 rounded-full ${m.actualDate ? 'bg-[var(--system-green)]' : 'bg-border'}`}
                          title={`${MILESTONE_LABELS[m.stage] || m.stage}: ${m.actualDate || m.plannedDate || '미정'}`} />
                      ))}
                    </div>
                  )}
                  {/* 마일스톤 완료 버튼 */}
                  {milestones.some(m => !m.actualDate) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs text-[var(--system-green)] shrink-0"
                      onClick={() => handleCompleteMilestone(order.id, milestones)}
                    >
                      <Check className="w-4 h-4" />완료
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {activeOrders.length === 0 && (
            <Card className="border-border"><CardContent className="py-12 text-center text-muted-foreground">
              <CalendarClock size={32} className="mx-auto mb-2 opacity-30" />진행중인 발주가 없습니다
            </CardContent></Card>
          )}
        </TabsContent>

        {/* Calendar View */}
        <TabsContent value="calendar" className="mt-4">
          <Card className="border-border">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => {
                if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(calMonth - 1);
              }}><ChevronLeft className="w-4 h-4" /></Button>
              <CardTitle className="text-base">{calYear}년 {calMonth + 1}월</CardTitle>
              <Button variant="outline" size="sm" onClick={() => {
                if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(calMonth + 1);
              }}><ChevronRight className="w-4 h-4" /></Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
              <div className="grid grid-cols-7 gap-px bg-border rounded overflow-hidden min-w-[560px]">
                {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                  <div key={d} className="bg-muted/50 text-center py-2 text-xs font-medium text-muted-foreground">{d}</div>
                ))}
                {calendarDays.map((cell, i) => (
                  <div key={i} className={`bg-card min-h-[80px] p-1 ${cell.day === 0 ? 'bg-muted/20' : ''}`}>
                    {cell.day > 0 && (
                      <>
                        <span className={`text-xs font-number ${cell.day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear() ? 'bg-primary text-primary-foreground w-5 h-5 rounded-full flex items-center justify-center' : ''}`}>
                          {cell.day}
                        </span>
                        <div className="mt-1 space-y-0.5">
                          {cell.events.slice(0, 3).map((ev, j) => (
                            <button
                              key={j}
                              type="button"
                              onClick={() => setStatusTarget((orders as ProductionOrder[]).find(o => o.id === ev.orderId) || null)}
                              title={`${ev.orderNo} · ${ev.milestone} · ${ev.status} — 클릭해 상태 변경`}
                              className={`w-full text-left text-[11px] px-1 py-0.5 rounded text-white truncate ${ev.color} hover:opacity-80`}
                            >
                              {ev.orderNo.split('-')[0].slice(-4)}-{ev.milestone.slice(0, 2)}
                            </button>
                          ))}
                          {cell.events.length > 3 && <span className="text-[11px] text-muted-foreground">+{cell.events.length - 3}</span>}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timeline/Gantt View */}
      </Tabs>

      {/* 캘린더에서 일정을 누르면 발주 상태를 바로 바꾼다 */}
      <Dialog open={!!statusTarget} onOpenChange={o => { if (!o) setStatusTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{statusTarget?.orderNo}</DialogTitle></DialogHeader>
          {statusTarget && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {statusTarget.styleName} · {formatNumber(statusTarget.qty)}pcs
                {statusTarget.deliveryDate && ` · 납기 ${statusTarget.deliveryDate}`}
              </p>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">발주 상태</p>
                <Select
                  value={statusTarget.status}
                  onValueChange={v => { changeStatus(statusTarget, v as OrderStatus); setStatusTarget(null); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ORDER_STATUSES.map(st => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" className="w-full gap-1.5" onClick={() => openWorkOrder(statusTarget)}>
                <Package className="w-4 h-4" />작업지시서 보기
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
