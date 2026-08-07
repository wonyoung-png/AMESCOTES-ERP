// AMESCOTES ERP — 대시보드 (Phase 1 개편: 납기위험 중심)
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  store, formatKRW, formatNumber, calcDDay, dDayLabel, dDayColor,
  type Sample,
} from '@/lib/store';
import {
  AlertTriangle, TrendingUp,
  ArrowRight, ShoppingCart, FlaskConical, FileText,
  Activity, Clock, Truck, Microscope, PackageSearch, File, FileSpreadsheet, Camera,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// 문서 아이콘
function DocIconSmall({ fileType }: { fileType: string }) {
  if (fileType === 'pdf') return <File className="w-4 h-4 text-muted-foreground" />;
  if (fileType === 'excel') return <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />;
  return <Camera className="w-4 h-4 text-muted-foreground" />;
}

const STAGE_COLOR: Record<string, string> = {
  '1차':    'bg-primary/10 text-primary border-primary/20',
  '2차':    'bg-primary/10 text-primary border-primary/20',
  '3차':    'bg-[var(--fill-tertiary)] text-foreground border-border',
  '4차':    'bg-[var(--fill-tertiary)] text-foreground border-border',
  '최종승인': 'bg-[var(--system-green)]/10 text-[var(--system-green)] border-[var(--system-green)]/20',
  '반려':   'bg-[var(--system-red)]/10 text-[var(--system-red)] border-[var(--system-red)]/20',
};

export default function Dashboard() {
  const orders = store.getOrders();
  const samples = store.getSamples();
  // 샘플자재구매 — 선택한 샘플 상세 모달
  const [selectedSample, setSelectedSample] = useState<Sample | null>(null);
  const [, navigate] = useLocation();
  const settlements = store.getSettlements();
  const items = store.getItems();
  const settings = store.getSettings();
  const tradeStatements = store.getTradeStatements();

  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  // ── KPI 계산 (제조/OEM 중심) ──
  const monthBilledCount = useMemo(() =>
    store.getTradeStatements().filter(ts => ts.issueDate.startsWith(thisMonth)).length,
    [thisMonth]);

  const monthBilledAmount = useMemo(() => {
    return store.getTradeStatements()
      .filter(ts => ts.issueDate.startsWith(thisMonth))
      .reduce((sum, ts) => {
        return sum + ts.lines.reduce((ls, l) => ls + l.qty * l.unitPrice * (1 + l.taxRate), 0);
      }, 0);
  }, [thisMonth]);

  const totalOutstanding = settlements.reduce((s, st) => {
    return s + Math.max(0, (st.billedAmountKrw || 0) - (st.collectedAmountKrw || 0));
  }, 0);

  const unclaimedStatements = tradeStatements.filter(s => s.status === '미청구');
  const unclaimedAmount = unclaimedStatements.reduce((sum, s) => {
    const total = s.lines.reduce((ls, l) => ls + l.qty * l.unitPrice * (1 + l.taxRate), 0);
    return sum + total;
  }, 0);

  // 납기 위험 분류 (생산 발주 기준)
  const deadlineRisk = useMemo(() => {
    const all = orders
      .filter(o => o.status !== '입고완료')
      .map(o => {
        const next = (o.milestones || []).find(m => !m.actualDate && m.plannedDate);
        const dday = next ? calcDDay(next.plannedDate) : null;
        return { ...o, nextMilestone: next, dday };
      })
      .filter(o => o.dday !== null);

    const critical = all.filter(o => o.dday! <= 1);   // D-1 이하
    const warning  = all.filter(o => o.dday! > 1 && o.dday! <= 7);  // D-7
    const normal   = all.filter(o => o.dday! > 7 && o.dday! <= 30); // 정상 (D-30)
    return { critical, warning, normal, all: all.sort((a, b) => (a.dday ?? 999) - (b.dday ?? 999)) };
  }, [orders]);

  // 자재 입고 대기 (본사제공 미구매)
  const pendingMaterials = useMemo(() =>
    orders.flatMap(o =>
      (o.hqSupplyItems || [])
        .filter(h => h.purchaseStatus === '미구매')
        .map(h => ({ ...h, orderNo: o.orderNo, orderId: o.id }))
    ).slice(0, 6),
    [orders]
  );

  // 자재 요청이 있는 샘플 목록
  const samplesWithMaterials = useMemo(() => {
    const vendors = store.getVendors().filter(v => v.type === '바이어');
    return samples
      .filter(s => (s.materialRequests || []).length > 0)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map(s => ({
        ...s,
        buyerName: vendors.find(v => v.id === s.buyerId)?.name || '미지정',
      }));
  }, [samples]);

  // 미청구 샘플 (거래처별)
  const unbilledSamples = useMemo(() => {
    const groups: Record<string, { name: string; count: number; amount: number }> = {};
    for (const s of samples.filter(x => x.billingStatus === '미청구')) {
      const key = s.styleId;
      if (!groups[key]) groups[key] = { name: s.styleName, count: 0, amount: 0 };
      groups[key].count++;
      groups[key].amount += s.costKrw || (s.costCny || 0) * settings.cnyKrw;
    }
    return Object.values(groups).slice(0, 5);
  }, [samples, settings.cnyKrw]);

  // 오더 파이프라인
  const pipeline = useMemo(() => {
    const stages = [
      { label: '샘플 진행', count: samples.filter(s => s.stage !== '최종승인' && s.stage !== '반려').length, color: 'bg-[var(--chart-1)]' },
      { label: '발주 생성', count: orders.filter(o => o.status === '발주생성').length, color: 'bg-[var(--chart-2)]' },
      { label: '생산 중',   count: orders.filter(o => o.status === '생산중').length,   color: 'bg-[var(--chart-3)]' },
      { label: '선적/통관', count: orders.filter(o => ['선적중','통관중'].includes(o.status)).length, color: 'bg-[var(--chart-4)]' },
      { label: '입고 완료', count: orders.filter(o => o.status === '입고완료').length,  color: 'bg-[var(--chart-5)]' },
    ];
    return stages;
  }, [orders, samples]);

  // 월별 OEM 청구 (거래명세표)
  const monthlyBillingData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ts of tradeStatements) {
      if (!ts.issueDate) continue;
      const m = ts.issueDate.slice(0, 7);
      const total = ts.lines.reduce((ls, l) => ls + l.qty * l.unitPrice * (1 + l.taxRate), 0);
      map[m] = (map[m] || 0) + total;
    }
    return Object.entries(map).sort().slice(-6).map(([month, total]) => ({
      month: month.slice(5) + '월', total,
    }));
  }, [tradeStatements]);

  // 미수금 연체 건
  const overdueSettlements = useMemo(() =>
    settlements.filter(st => {
      const outstanding = (st.billedAmountKrw || 0) - (st.collectedAmountKrw || 0);
      return outstanding > 0 && calcDDay(st.dueDate) < 0;
    }).slice(0, 5),
    [settlements]
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">생산 대시보드</h1>
        <p className="text-sm text-muted-foreground mt-0.5">ATLM 제조 ERP — OEM 생산·납기·정산 현황</p>
      </div>

      {/* ── KPI 7개 ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <KpiCard
          icon={<Microscope className="w-5 h-5 text-primary" />}
          bg="bg-primary/10"
          label="진행중 샘플"
          value={`${samples.filter(s => ['1차','2차','3차','4차'].includes(s.stage)).length}건`}
          sub={`최종승인 ${samples.filter(s => s.stage === '최종승인').length}건`}
        />
        <KpiCard
          icon={<TrendingUp className="w-5 h-5 text-foreground" />}
          bg="bg-[var(--fill-quaternary)]"
          label="이달 청구"
          value={formatKRW(monthBilledAmount)}
          sub={`거래명세 ${monthBilledCount}건`}
        />
        <KpiCard
          icon={<Activity className="w-5 h-5 text-primary" />}
          bg="bg-primary/10"
          label="진행중 발주"
          value={`${orders.filter(o => ['발주생성','샘플승인','생산중','선적중','통관중'].includes(o.status)).length}건`}
          sub={`납기임박 D-7 ${deadlineRisk.warning.length + deadlineRisk.critical.length}건`}
        />
        <KpiCard
          icon={<Truck className="w-5 h-5 text-foreground" />}
          bg="bg-[var(--fill-quaternary)]"
          label="이달 청구"
          value={formatKRW(monthBilledAmount)}
          sub={`${store.getTradeStatements().filter(ts => ts.issueDate.startsWith(thisMonth)).length}건`}
        />
        <KpiCard
          icon={<AlertTriangle className="w-5 h-5 text-[var(--system-red)]" />}
          bg="bg-[var(--fill-quaternary)]"
          label="미수금"
          value={formatKRW(totalOutstanding)}
          sub={overdueSettlements.length > 0 ? <span className="text-[var(--system-red)]">연체 {overdueSettlements.length}건</span> : '연체 없음'}
        />
        <KpiCard
          icon={<Clock className="w-5 h-5 text-[var(--system-orange)]" />}
          bg="bg-[var(--fill-quaternary)]"
          label="납기 위험"
          value={`${deadlineRisk.critical.length + deadlineRisk.warning.length}건`}
          sub={deadlineRisk.critical.length > 0
            ? <span className="text-[var(--system-red)]">긴급 {deadlineRisk.critical.length}건</span>
            : deadlineRisk.warning.length > 0 ? <span className="text-[var(--system-orange)]">주의 {deadlineRisk.warning.length}건</span>
            : '이상 없음'}
        />
        <KpiCard
          icon={<FileText className="w-5 h-5 text-muted-foreground" />}
          bg="bg-[var(--fill-quaternary)]"
          label="미청구"
          value={`${unclaimedStatements.length}건`}
          sub={formatKRW(unclaimedAmount)}
        />
      </div>

      {/* ── 메인 2단 레이아웃 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* 좌측 60% — 납기 위험 현황 */}
        <div className="lg:col-span-3 bg-card rounded-lg border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[var(--system-red)]" />
              납기 위험 현황
            </h3>
            <Link href="/orders" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              전체 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {/* 요약 배지 */}
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--system-red)]/10 border border-[var(--system-red)]/20">
              <span className="text-[var(--system-red)] text-xs font-bold">D-1 이하</span>
              <span className="text-[var(--system-red)] font-bold text-sm">{deadlineRisk.critical.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--system-orange)]/10 border border-[var(--system-orange)]/20">
              <span className="text-[var(--system-orange)] text-xs font-bold">D-7 이내</span>
              <span className="text-[var(--system-orange)] font-bold text-sm">{deadlineRisk.warning.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--system-green)]/10 border border-[var(--system-green)]/20">
              <span className="text-[var(--system-green)] text-xs font-bold">정상</span>
              <span className="text-[var(--system-green)] font-bold text-sm">{deadlineRisk.normal.length}</span>
            </div>
          </div>

          {/* 위험 발주 목록 */}
          <div className="space-y-2">
            {deadlineRisk.all.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">납기 위험 발주가 없습니다</p>
            ) : deadlineRisk.all.slice(0, 8).map(o => (
              <div key={o.id} className={`flex items-center justify-between py-2 px-3 rounded-md border ${
                o.dday! <= 1 ? 'bg-[var(--fill-quaternary)] border-[var(--system-red)]/30' :
                o.dday! <= 7 ? 'bg-[var(--fill-quaternary)] border-[var(--system-orange)]/30' :
                'bg-[var(--fill-quaternary)] border-border'
              }`}>
                <div>
                  <p className="text-sm font-medium text-foreground">{o.orderNo}</p>
                  <p className="text-xs text-muted-foreground">{o.vendorName} · {o.nextMilestone?.stage}</p>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${dDayColor(o.dday!)}`}>
                    {dDayLabel(o.dday!)}
                  </span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{o.nextMilestone?.plannedDate}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 우측 40% */}
        <div className="lg:col-span-2 space-y-4">
          {/* 자재 입고 대기 */}
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ShoppingCart className="w-3.5 h-3.5 text-muted-foreground" />자재 입고 대기
              </h3>
              <Link href="/purchase" className="text-xs text-primary hover:underline flex items-center gap-1">
                전체 <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-1.5">
              {pendingMaterials.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">대기 자재 없음</p>
              ) : pendingMaterials.map((h, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                  <div>
                    <p className="text-xs font-medium text-foreground">{h.itemName}</p>
                    <p className="text-[11px] text-muted-foreground">{h.orderNo}</p>
                  </div>
                  <span className="text-xs font-medium text-foreground">{formatNumber(h.requiredQty)} {h.unit}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 미청구 샘플 */}
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FlaskConical className="w-3.5 h-3.5 text-primary" />미청구 샘플
              </h3>
              <Link href="/samples" className="text-xs text-primary hover:underline flex items-center gap-1">
                전체 <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-1.5">
              {unbilledSamples.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">미청구 샘플 없음</p>
              ) : unbilledSamples.map((g, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                  <div>
                    <p className="text-xs font-medium text-foreground truncate max-w-[120px]">{g.name}</p>
                    <p className="text-[11px] text-muted-foreground">{g.count}건</p>
                  </div>
                  <span className="text-xs font-medium text-primary">{formatKRW(g.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── 하단 2단 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 오더 파이프라인 */}
        <div className="bg-card rounded-lg border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">전체 오더 파이프라인</h3>
          <div className="space-y-2.5">
            {pipeline.map(stage => (
              <div key={stage.label} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-20 shrink-0">{stage.label}</span>
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div
                    className={`${stage.color} h-2 rounded-full transition-all`}
                    style={{ width: stage.count > 0 ? `${Math.min(100, stage.count * 10)}%` : '0%' }}
                  />
                </div>
                <span className="text-xs font-bold text-foreground w-8 text-right">{stage.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 이달 청구 / 연체 미수금 */}
        <div className="bg-card rounded-lg border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">월별 OEM 청구 추이</h3>
          {monthlyBillingData.length === 0 ? (
            <div className="h-[140px] flex items-center justify-center text-muted-foreground text-sm">
              거래명세 청구 데이터가 없습니다
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={monthlyBillingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} />
                <Tooltip formatter={(v: number) => formatKRW(v)} />
                <Bar dataKey="total" name="청구" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {/* 연체 미수금 */}
          {overdueSettlements.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs font-semibold text-[var(--system-red)] mb-2">연체 미수금</p>
              <div className="space-y-1">
                {overdueSettlements.map(st => {
                  const outstanding = (st.billedAmountKrw || 0) - (st.collectedAmountKrw || 0);
                  const overdueDays = Math.abs(calcDDay(st.dueDate));
                  return (
                    <div key={st.id} className="flex items-center justify-between text-xs">
                      <span className="text-foreground">{st.buyerName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--system-red)]">{overdueDays}일 초과</span>
                        <span className="font-mono font-bold text-[var(--system-red)]">{formatKRW(outstanding)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* ── 샘플자재구매 ── */}
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <PackageSearch className="w-4 h-4 text-primary" />
            샘플자재구매
            {samplesWithMaterials.length > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                {samplesWithMaterials.length}건
              </span>
            )}
          </h3>
          <Link href="/samples" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            전체 <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {samplesWithMaterials.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">자재 요청이 있는 샘플이 없습니다</p>
        ) : (
          <div className="space-y-2">
            {samplesWithMaterials.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedSample(s)}
                className="w-full text-left flex items-center justify-between py-2 px-3 rounded-md border border-border hover:bg-muted transition-colors group"
              >
                <div className="flex items-center gap-3">
                  {/* 썸네일 */}
                  {(s.imageUrls || []).length > 0 ? (
                    <img src={s.imageUrls[0]} alt={s.styleNo} className="w-10 h-10 object-cover rounded-md border border-border shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-muted border border-border flex items-center justify-center shrink-0">
                      <Camera className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{s.buyerName}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs font-mono text-muted-foreground">{s.styleNo}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[120px]">{s.styleName}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${STAGE_COLOR[s.stage] || 'bg-muted text-muted-foreground border-border'}`}>
                        {s.stage}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        자재 {(s.materialRequests || []).length}종 요청
                      </span>
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 샘플 접수 상세 모달 */}
      {selectedSample && (
        <Dialog open={!!selectedSample} onOpenChange={() => setSelectedSample(null)}>
          <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-lg sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>{selectedSample.styleNo}</span>
                <span className="text-muted-foreground font-normal text-sm">—</span>
                <span className="text-muted-foreground font-medium text-sm">{selectedSample.styleName}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STAGE_COLOR[selectedSample.stage] || 'bg-muted text-muted-foreground border-border'}`}>
                  {selectedSample.stage}
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2 text-sm">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-2 p-3 bg-muted rounded-md text-xs">
                <div><span className="text-muted-foreground">의뢰일:</span> <span className="text-foreground font-medium">{selectedSample.requestDate}</span></div>
                <div><span className="text-muted-foreground">목표완료:</span> <span className="text-foreground font-medium">{selectedSample.expectedDate || '—'}</span></div>
                <div><span className="text-muted-foreground">장소:</span> <span className="text-foreground font-medium">{selectedSample.location || '—'}</span></div>
                <div><span className="text-muted-foreground">담당자:</span> <span className="text-foreground font-medium">{selectedSample.assignee || '—'}</span></div>
                {selectedSample.color && (
                  <div className="col-span-2"><span className="text-muted-foreground">컬러:</span> <span className="text-foreground font-medium">{selectedSample.color}</span></div>
                )}
                {selectedSample.memo && (
                  <div className="col-span-2"><span className="text-muted-foreground">비고:</span> <span className="text-foreground">{selectedSample.memo}</span></div>
                )}
              </div>

              {/* 이미지 */}
              {Array.isArray(selectedSample.imageUrls) && selectedSample.imageUrls.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">샘플 이미지</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedSample.imageUrls.filter(url => url && typeof url === 'string').map((url, idx) => (
                      <img
                        key={idx}
                        src={url}
                        alt={`이미지 ${idx + 1}`}
                        className="w-16 h-16 object-cover rounded-md border border-border cursor-pointer hover:opacity-80"
                        onClick={() => {
                          try {
                            window.open(url, '_blank', 'noopener,noreferrer');
                          } catch {
                            // URL 열기 실패 시 무시
                          }
                        }}
                        onError={(e) => {
                          // 이미지 로드 실패 시 숨김 처리
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 자재 요청 목록 */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">자재 요청 목록</p>
                <div className="rounded-md border border-border overflow-x-auto">
                  <table className="data-table w-full min-w-[480px] text-xs">
                    <thead>
                      <tr className="bg-muted border-b border-border">
                        <th className="text-muted-foreground font-medium">자재명</th>
                        <th className="text-muted-foreground font-medium">업체</th>
                        <th className="text-muted-foreground font-medium">컬러</th>
                        <th className="num text-muted-foreground font-medium">수량</th>
                        <th className="nw text-muted-foreground font-medium">단위</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(selectedSample.materialRequests || []).map((req, i) => (
                        <tr key={i}>
                          <td className="text-foreground font-medium">{req.itemName}</td>
                          <td className="text-muted-foreground">{req.vendor || <span className="text-muted-foreground">—</span>}</td>
                          <td className="text-muted-foreground">{req.color || <span className="text-muted-foreground">—</span>}</td>
                          <td className="num text-foreground">{req.qty}</td>
                          <td className="text-muted-foreground">{req.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 첨부 문서 */}
              {(selectedSample.documents || []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">첨부 문서</p>
                  <div className="space-y-1">
                    {(selectedSample.documents || []).map((doc, idx) => (
                      <button
                        key={idx}
                        className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-md border border-border hover:bg-muted"
                        onClick={() => window.open(doc.url, '_blank')}
                      >
                        <DocIconSmall fileType={doc.fileType} />
                        <span className="text-xs text-foreground truncate">{doc.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedSample(null)}>닫기</Button>
              <Button
                className="text-xs"
                onClick={() => {
                  const sampleId = selectedSample?.id;
                  setSelectedSample(null);
                  // URL 파라미터로 sampleId를 전달하여 SampleManagement에서 바로 상세 모달 열기
                  navigate(`/samples?openId=${sampleId}`);
                }}
              >
                샘플 관리로 이동
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 최근 활동 피드 ── */}
      {(() => {
        // 최근 샘플 접수 + 발주 등록 통합 피드 (최근 8개)
        type FeedItem = { type: 'sample' | 'order'; label: string; sub: string; date: string; color: string };
        const feedItems: FeedItem[] = [
          ...samples.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map(s => ({
            type: 'sample' as const,
            label: `샘플 접수: ${s.styleNo}`,
            sub: `${s.styleName} — ${s.stage}`,
            date: s.createdAt.split('T')[0],
            color: 'bg-muted border-border',
          })),
          ...orders.filter(o => o.createdAt).slice().sort((a, b) => (b.createdAt||'').localeCompare(a.createdAt||'')).slice(0, 5).map(o => ({
            type: 'order' as const,
            label: `발주 등록: ${o.orderNo}`,
            sub: `${o.styleName ?? ''} × ${(o.qty ?? 0).toLocaleString()}PCS → ${o.vendorName ?? ''}`,
            date: (o.createdAt||'').split('T')[0],
            color: 'bg-muted border-border',
          })),
        ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

        if (feedItems.length === 0) return null;
        return (
          <div className="bg-card rounded-lg border border-border p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">최근 활동</h3>
            <div className="space-y-2">
              {feedItems.map((item, i) => (
                <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-md border ${item.color}`}>
                  <div>
                    <p className="text-xs font-medium text-foreground">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{item.sub}</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 ml-3">{item.date}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function KpiCard({ icon, bg, label, value, sub }: {
  icon: React.ReactNode; bg: string; label: string; value: string; sub: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-8 h-8 rounded-md ${bg} flex items-center justify-center`}>{icon}</div>
      </div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}
