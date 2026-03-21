// AMESCOTES ERP — 대시보드 (Phase 1 개편: 납기위험 중심)
import { useMemo } from 'react';
import { Link } from 'wouter';
import {
  store, formatKRW, formatNumber, calcDDay, dDayLabel, dDayColor,
} from '@/lib/store';
import {
  AlertTriangle, TrendingUp, Package,
  ArrowRight, ShoppingCart, FlaskConical, FileText,
  Activity, Clock, Truck, Microscope,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

export default function Dashboard() {
  const orders = store.getOrders();
  const samples = store.getSamples();
  const settlements = store.getSettlements();
  const salesRecords = store.getSalesRecords();
  const items = store.getItems();
  const settings = store.getSettings();
  const tradeStatements = store.getTradeStatements();

  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  // ── KPI 계산 ──
  const monthSales = salesRecords
    .filter(r => r.saleDate?.startsWith(thisMonth))
    .reduce((s, r) => s + (r.totalKrw || 0), 0);

  // 이번 달 청구 금액 (거래명세표 기준)
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

    const critical = all.filter(o => o.dday! <= 1);   // 🔴 D-1 이하
    const warning  = all.filter(o => o.dday! > 1 && o.dday! <= 7);  // 🟡 D-7
    const normal   = all.filter(o => o.dday! > 7 && o.dday! <= 30); // 🟢 정상 (D-30)
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
      { label: '샘플 진행', count: samples.filter(s => s.stage !== '최종승인' && s.stage !== '반려').length, color: 'bg-blue-500' },
      { label: '발주 생성', count: orders.filter(o => o.status === '발주생성').length, color: 'bg-stone-400' },
      { label: '생산 중',   count: orders.filter(o => o.status === '생산중').length,   color: 'bg-amber-500' },
      { label: '선적/통관', count: orders.filter(o => ['선적중','통관중'].includes(o.status)).length, color: 'bg-purple-500' },
      { label: '입고 완료', count: orders.filter(o => o.status === '입고완료').length,  color: 'bg-green-500' },
    ];
    return stages;
  }, [orders, samples]);

  // 월별 매출
  const monthlyData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of salesRecords) {
      if (!r.saleDate) continue;
      const m = r.saleDate.slice(0, 7);
      map[m] = (map[m] || 0) + (r.totalKrw || 0);
    }
    return Object.entries(map).sort().slice(-6).map(([month, total]) => ({
      month: month.slice(5) + '월', total,
    }));
  }, [salesRecords]);

  // 미수금 연체 건
  const overdueSettlements = useMemo(() =>
    settlements.filter(st => {
      const outstanding = (st.billedAmountKrw || 0) - (st.collectedAmountKrw || 0);
      return outstanding > 0 && calcDDay(st.dueDate) < 0;
    }).slice(0, 5),
    [settlements]
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-800">대시보드</h1>
        <p className="text-sm text-stone-500 mt-0.5">AMESCOTES 운영 현황 — 납기 위험 중심</p>
      </div>

      {/* ── KPI 7개 ── */}
      <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <KpiCard
          icon={<Microscope className="w-5 h-5 text-blue-600" />}
          bg="bg-blue-50"
          label="진행중 샘플"
          value={`${samples.filter(s => ['1차','2차','3차','4차'].includes(s.stage)).length}건`}
          sub={`최종승인 ${samples.filter(s => s.stage === '최종승인').length}건`}
        />
        <KpiCard
          icon={<TrendingUp className="w-5 h-5 text-green-600" />}
          bg="bg-green-50"
          label="이달 매출"
          value={formatKRW(monthSales)}
          sub={`${salesRecords.filter(r => r.saleDate?.startsWith(thisMonth)).length}건`}
        />
        <KpiCard
          icon={<Activity className="w-5 h-5 text-amber-700" />}
          bg="bg-amber-50"
          label="진행중 발주"
          value={`${orders.filter(o => ['발주생성','샘플승인','생산중','선적중','통관중'].includes(o.status)).length}건`}
          sub={`납기임박 D-7 ${deadlineRisk.warning.length + deadlineRisk.critical.length}건`}
        />
        <KpiCard
          icon={<Truck className="w-5 h-5 text-purple-600" />}
          bg="bg-purple-50"
          label="이달 청구"
          value={formatKRW(monthBilledAmount)}
          sub={`${store.getTradeStatements().filter(ts => ts.issueDate.startsWith(thisMonth)).length}건`}
        />
        <KpiCard
          icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
          bg="bg-red-50"
          label="미수금"
          value={formatKRW(totalOutstanding)}
          sub={overdueSettlements.length > 0 ? <span className="text-red-500">연체 {overdueSettlements.length}건</span> : '연체 없음'}
        />
        <KpiCard
          icon={<Clock className="w-5 h-5 text-orange-500" />}
          bg="bg-orange-50"
          label="납기 위험"
          value={`${deadlineRisk.critical.length + deadlineRisk.warning.length}건`}
          sub={deadlineRisk.critical.length > 0
            ? <span className="text-red-500">🔴 긴급 {deadlineRisk.critical.length}건</span>
            : deadlineRisk.warning.length > 0 ? <span className="text-amber-500">🟡 주의 {deadlineRisk.warning.length}건</span>
            : '이상 없음'}
        />
        <KpiCard
          icon={<FileText className="w-5 h-5 text-stone-600" />}
          bg="bg-stone-100"
          label="미청구"
          value={`${unclaimedStatements.length}건`}
          sub={formatKRW(unclaimedAmount)}
        />
      </div>

      {/* ── 메인 2단 레이아웃 ── */}
      <div className="grid grid-cols-5 gap-4">
        {/* 좌측 60% — 납기 위험 현황 */}
        <div className="col-span-3 bg-white rounded-xl border border-stone-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              🚨 납기 위험 현황
            </h3>
            <Link href="/deadline" className="text-xs text-stone-500 hover:text-stone-700 flex items-center gap-1">
              전체 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {/* 요약 배지 */}
          <div className="flex gap-2 mb-4">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200">
              <span className="text-red-600 text-xs font-bold">🔴 D-1 이하</span>
              <span className="text-red-700 font-bold text-sm">{deadlineRisk.critical.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
              <span className="text-amber-600 text-xs font-bold">🟡 D-7 이내</span>
              <span className="text-amber-700 font-bold text-sm">{deadlineRisk.warning.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200">
              <span className="text-green-600 text-xs font-bold">🟢 정상</span>
              <span className="text-green-700 font-bold text-sm">{deadlineRisk.normal.length}</span>
            </div>
          </div>

          {/* 위험 발주 목록 */}
          <div className="space-y-2">
            {deadlineRisk.all.length === 0 ? (
              <p className="text-xs text-stone-400 py-6 text-center">납기 위험 발주가 없습니다 ✓</p>
            ) : deadlineRisk.all.slice(0, 8).map(o => (
              <div key={o.id} className={`flex items-center justify-between py-2 px-3 rounded-lg border ${
                o.dday! <= 1 ? 'bg-red-50 border-red-200' :
                o.dday! <= 7 ? 'bg-amber-50 border-amber-200' :
                'bg-stone-50 border-stone-100'
              }`}>
                <div>
                  <p className="text-sm font-medium text-stone-800">{o.orderNo}</p>
                  <p className="text-xs text-stone-500">{o.vendorName} · {o.nextMilestone?.stage}</p>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${dDayColor(o.dday!)}`}>
                    {dDayLabel(o.dday!)}
                  </span>
                  <p className="text-[11px] text-stone-400 mt-0.5">{o.nextMilestone?.plannedDate}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 우측 40% */}
        <div className="col-span-2 space-y-4">
          {/* 자재 입고 대기 */}
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
                <ShoppingCart className="w-3.5 h-3.5 text-orange-500" />자재 입고 대기
              </h3>
              <Link href="/purchase" className="text-xs text-orange-600 hover:underline flex items-center gap-1">
                전체 <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-1.5">
              {pendingMaterials.length === 0 ? (
                <p className="text-xs text-stone-400 py-3 text-center">대기 자재 없음</p>
              ) : pendingMaterials.map((h, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-stone-50 last:border-0">
                  <div>
                    <p className="text-xs font-medium text-stone-700">{h.itemName}</p>
                    <p className="text-[11px] text-stone-400">{h.orderNo}</p>
                  </div>
                  <span className="text-xs font-medium text-orange-600">{formatNumber(h.requiredQty)} {h.unit}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 미청구 샘플 */}
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
                <FlaskConical className="w-3.5 h-3.5 text-blue-500" />미청구 샘플
              </h3>
              <Link href="/samples" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                전체 <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-1.5">
              {unbilledSamples.length === 0 ? (
                <p className="text-xs text-stone-400 py-3 text-center">미청구 샘플 없음</p>
              ) : unbilledSamples.map((g, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-stone-50 last:border-0">
                  <div>
                    <p className="text-xs font-medium text-stone-700 truncate max-w-[120px]">{g.name}</p>
                    <p className="text-[11px] text-stone-400">{g.count}건</p>
                  </div>
                  <span className="text-xs font-medium text-amber-700">{formatKRW(g.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── 하단 2단 ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* 오더 파이프라인 */}
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <h3 className="text-sm font-semibold text-stone-700 mb-4">전체 오더 파이프라인</h3>
          <div className="space-y-2.5">
            {pipeline.map(stage => (
              <div key={stage.label} className="flex items-center gap-3">
                <span className="text-xs text-stone-500 w-20 shrink-0">{stage.label}</span>
                <div className="flex-1 bg-stone-100 rounded-full h-2">
                  <div
                    className={`${stage.color} h-2 rounded-full transition-all`}
                    style={{ width: stage.count > 0 ? `${Math.min(100, stage.count * 10)}%` : '0%' }}
                  />
                </div>
                <span className="text-xs font-bold text-stone-700 w-8 text-right">{stage.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 이달 매출 / 연체 미수금 */}
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <h3 className="text-sm font-semibold text-stone-700 mb-3">월별 매출 추이</h3>
          {monthlyData.length === 0 ? (
            <div className="h-[140px] flex items-center justify-center text-stone-400 text-sm">
              매출 데이터가 없습니다
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ece8" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} />
                <Tooltip formatter={(v: number) => formatKRW(v)} />
                <Bar dataKey="total" name="매출" fill="#C9A96E" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {/* 연체 미수금 */}
          {overdueSettlements.length > 0 && (
            <div className="mt-3 pt-3 border-t border-stone-100">
              <p className="text-xs font-semibold text-red-600 mb-2">연체 미수금</p>
              <div className="space-y-1">
                {overdueSettlements.map(st => {
                  const outstanding = (st.billedAmountKrw || 0) - (st.collectedAmountKrw || 0);
                  const overdueDays = Math.abs(calcDDay(st.dueDate));
                  return (
                    <div key={st.id} className="flex items-center justify-between text-xs">
                      <span className="text-stone-700">{st.buyerName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-red-500">{overdueDays}일 초과</span>
                        <span className="font-mono font-bold text-red-600">{formatKRW(outstanding)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* ── 최근 활동 피드 ── */}
      {(() => {
        // 최근 샘플 접수 + 발주 등록 통합 피드 (최근 8개)
        type FeedItem = { type: 'sample' | 'order'; label: string; sub: string; date: string; color: string };
        const feedItems: FeedItem[] = [
          ...samples.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map(s => ({
            type: 'sample' as const,
            label: `📋 샘플 접수: ${s.styleNo}`,
            sub: `${s.styleName} — ${s.stage}`,
            date: s.createdAt.split('T')[0],
            color: 'bg-blue-50 border-blue-100',
          })),
          ...orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map(o => ({
            type: 'order' as const,
            label: `📦 발주 등록: ${o.orderNo}`,
            sub: `${o.styleName} × ${o.qty.toLocaleString()}PCS → ${o.vendorName}`,
            date: o.createdAt.split('T')[0],
            color: 'bg-amber-50 border-amber-100',
          })),
        ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

        if (feedItems.length === 0) return null;
        return (
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h3 className="text-sm font-semibold text-stone-700 mb-3">🕐 최근 활동</h3>
            <div className="space-y-2">
              {feedItems.map((item, i) => (
                <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${item.color}`}>
                  <div>
                    <p className="text-xs font-medium text-stone-800">{item.label}</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">{item.sub}</p>
                  </div>
                  <span className="text-[11px] text-stone-400 shrink-0 ml-3">{item.date}</span>
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
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>{icon}</div>
      </div>
      <p className="text-xs text-stone-500 mb-0.5">{label}</p>
      <p className="text-lg font-bold text-stone-800 leading-tight">{value}</p>
      <p className="text-xs text-stone-400 mt-0.5">{sub}</p>
    </div>
  );
}
