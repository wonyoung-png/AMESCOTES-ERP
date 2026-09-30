// AMESCOTES ERP — 브랜드 대시보드 (LUMEN / AETALOOF)
//
// OEM 대시보드가 "어느 발주가 납기 위험인가"를 보듯, 브랜드 첫 화면은
// "어제 얼마 팔았고, 오늘 무엇을 손대야 하는가"를 본다. 숫자는 PMS가 모아 둔 것을
// /api/dashboard/brand 한 번으로 받고, 체크아웃 퍼널만 ERP 자체(/api/pixel/funnel)에서 읽는다.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, BarChart3, Boxes, CalendarDays, Clock, PackageSearch, Percent, ShoppingCart, TrendingUp, Truck, Activity,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatKRW, formatNumber } from '@/lib/store';

const PMS_API = 'https://daily.54-116-241-64.sslip.io';
const PMS_APP = 'https://daily.54-116-241-64.sslip.io/app/';

// PMS 탭 링크 — Layout의 pmsTabUrl과 같은 규칙 (ERP 토큰을 실어 비밀번호를 다시 묻지 않는다)
const pmsUrl = (tab: string) => {
  const t = localStorage.getItem('erp_token');
  return `${PMS_APP}${t ? `?erp=${encodeURIComponent(t)}` : ''}#${encodeURIComponent(tab)}`;
};

async function pms<T>(path: string, brand: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(PMS_API + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Erp-Token': localStorage.getItem('erp_token') || '',
      'X-Brand': brand.toLowerCase(),
      ...(init.headers as Record<string, string> || {}),
    },
  });
  if (!r.ok) throw new Error(`PMS ${r.status}`);
  return r.json();
}

interface Todo { key: string; label: string; detail: string; tab: string; tone: 'bad' | 'warn' | 'plain' }
interface Sku { sku: string; name: string; image: string; stock: number; sold: number; per_day: number; days_left: number | null; sell_through: number; idle_days: number | null; cost: number; flags: string[]; stock_cost?: number }
interface Brand {
  asof: string; brand: string; todo: Todo[]; has_daily: boolean;
  sales: {
    yesterday: { date: string; total: number | null; orders: number | null; qty: number; shopify_usd: number | null; cafe24: number | null; offline: number | null; shopify: number | null; last_week: number | null };
    mtd: { total: number; orders: number; qty: number; days: number; prev_same: number; platform: number; goal: number | null; goal_pct: number | null; day_pct: number };
    p30: { total_krw?: number; orders?: number; avg_order_value?: number; cafe24_krw?: number; shopify_krw?: number; offline_krw?: number };
    daily30: { date: string; cafe24: number; shopify: number; offline: number; platform: number; total: number }[];
  };
  inventory: { skus: number; stock_qty: number; stock_cost: number; months: number | null; sold28: number; out: number; low: number; dead: number };
  top: Sku[]; dead: Sku[];
  reorder: {
    counts: Record<string, number>; totals: { open_qty: number; open_cost: number; now_qty: number; b2b_qty: number };
    promo: { days: number; factor: number };
    now: { sku: string; name: string; image: string; stock: number; on_order: number; b2b: number; per_day: number; order_by: string; reco: number; reco_cost: number; approval: string }[];
    soon: { sku: string; name: string; stock: number; on_order: number; per_day: number; order_by: string; reco: number }[];
    open_orders: number; late: number;
    eta_week: { id: number; sku: string; name: string; qty: number; received: number; eta: string; factory: string }[];
    approve: { id: number; sku: string; name: string; qty: number; cost: number; note: string }[];
    b2b_week: { id: number; sku: string; name: string; qty: number; received: number; eta: string; partner: string }[];
  };
  promos: { channel: string; title: string; start: string; end: string; today: boolean }[];
  crons: { name: string; label: string; state: string; age_min: number | null; last_error: string | null }[];
}
interface Funnel { total_checkouts: number; steps: { event: string; count: number }[] }

const STEP_LABEL: Record<string, string> = {
  checkout_started: '결제 시작', checkout_contact_info_submitted: '연락처', checkout_address_info_submitted: '주소',
  checkout_shipping_info_submitted: '배송', payment_info_submitted: '결제정보', checkout_completed: '완료',
};
const pct = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null || !b ? null : Math.round(((a - b) / b) * 100);
const Delta = ({ v, suffix = '' }: { v: number | null; suffix?: string }) =>
  v == null ? <span className="text-muted-foreground">비교값 없음</span>
    : <span className={v >= 0 ? 'text-[var(--system-green)]' : 'text-[var(--system-red)]'}>{v >= 0 ? '▲' : '▼'} {Math.abs(v)}%{suffix}</span>;
const won = (v: number | null | undefined) => v == null ? '—' : formatKRW(v);
const TONE: Record<Todo['tone'], string> = {
  bad: 'border-[var(--system-red)]/40 bg-[var(--system-red)]/5',
  warn: 'border-[var(--system-orange)]/40 bg-[var(--system-orange)]/5',
  plain: 'border-border bg-card',
};

function Kpi({ icon, bg, label, value, sub }: { icon: React.ReactNode; bg: string; label: string; value: string; sub: React.ReactNode }) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className={`w-8 h-8 rounded-md ${bg} flex items-center justify-center mb-3`}>{icon}</div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function Section({ title, sub, tab, children }: { title: string; sub?: string; tab?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div><h2 className="font-semibold text-foreground">{title}</h2>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</div>
        {tab && <a className="text-xs text-primary inline-flex items-center gap-1" href={pmsUrl(tab)} target="_blank" rel="noreferrer">{tab} <ArrowRight className="w-3 h-3" /></a>}
      </div>
      {children}
    </section>
  );
}

function Thumb({ src }: { src: string }) {
  return src ? <img src={src} alt="" className="w-8 h-8 rounded object-cover bg-muted" loading="lazy" /> : <div className="w-8 h-8 rounded bg-muted" />;
}

export default function BrandDashboard({ brand }: { brand: string }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['brandDashboard', brand],
    queryFn: () => pms<Brand>('/api/dashboard/brand', brand),
    staleTime: 5 * 60_000, retry: 1,
  });
  const { data: funnel } = useQuery({
    queryKey: ['brandFunnel', brand],
    queryFn: async () => (await fetch(`/api/pixel/funnel?days=7&shop=${brand === 'LUMEN' ? 'kr' : 'kr'}`)).json() as Promise<Funnel>,
    staleTime: 5 * 60_000, retry: 0, enabled: brand === 'LUMEN',
  });
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  // 한국은 UTC+9 — 새벽엔 toISOString()이 전월을 준다. 로컬 달력으로 만든다
  const _d = new Date();
  const month = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}`;
  useEffect(() => { if (data?.sales.mtd.goal) setGoalInput(String(data.sales.mtd.goal)); }, [data]);

  async function saveGoal() {
    await pms('/api/dashboard/goals', brand, { method: 'POST', body: JSON.stringify({ month, amount: Number(goalInput.replace(/,/g, '')) || 0 }) });
    setGoalOpen(false); refetch();
  }

  const chart = useMemo(() => (data?.sales.daily30 || []).map(d => ({ ...d, day: d.date.slice(5) })), [data]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">브랜드 대시보드 불러오는 중…</div>;
  if (error || !data) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-foreground">PMS에서 데이터를 받지 못했습니다. ({String((error as Error)?.message || '')})</p>
        <Button size="sm" onClick={() => refetch()}>다시 시도</Button>
      </div>
    );
  }
  const s = data.sales; const inv = data.inventory; const ro = data.reorder;
  const yd = s.yesterday;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">{brand} 브랜드 운영</h1>
          <p className="text-xs text-muted-foreground">기준 {data.asof} · PMS 집계 (10분 캐시) {ro.promo.days > 0 && `· 프로모션 가중 ×${ro.promo.factor}`}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>{isFetching ? '갱신 중…' : '↻ 새로고침'}</Button>
      </div>

      {/* 0단 · 오늘 할 일 */}
      <section>
        <h2 className="font-semibold text-foreground mb-2">오늘 할 일</h2>
        {data.todo.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">지금 손대야 할 항목이 없습니다.</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {data.todo.map(t => (
              <a key={t.key} href={pmsUrl(t.tab)} target="_blank" rel="noreferrer" className={`rounded-lg border p-3 flex items-start gap-3 hover:opacity-90 ${TONE[t.tone]}`}>
                {t.tone === 'bad' ? <AlertTriangle className="w-4 h-4 mt-0.5 text-[var(--system-red)]" /> : t.tone === 'warn' ? <Clock className="w-4 h-4 mt-0.5 text-[var(--system-orange)]" /> : <Activity className="w-4 h-4 mt-0.5 text-muted-foreground" />}
                <div className="min-w-0"><p className="text-sm font-medium text-foreground">{t.label}</p><p className="text-xs text-muted-foreground truncate">{t.detail}</p></div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* 1단 · KPI */}
      {!data.has_daily && <div className="rounded-lg border border-[var(--system-orange)]/40 bg-[var(--system-orange)]/5 p-3 text-xs">일일점검 데이터가 아직 없습니다. PMS 일일점검 수집이 돌아야 매출 카드가 채워집니다.</div>}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<TrendingUp className="w-4 h-4 text-primary" />} bg="bg-primary/10" label={`어제 매출 (${yd.date.slice(5)})`} value={won(yd.total)}
          sub={<>전주 같은 요일 <Delta v={pct(yd.total, yd.last_week)} />{yd.shopify_usd ? ` · 해외 $${formatNumber(Math.round(yd.shopify_usd))}` : ''}</>} />
        <Kpi icon={<BarChart3 className="w-4 h-4 text-primary" />} bg="bg-primary/10" label="이달 누적 매출" value={won(s.mtd.total)}
          sub={s.mtd.goal
            ? <>목표 {won(s.mtd.goal)} · 진도 <b className={s.mtd.goal_pct! + 5 < s.mtd.day_pct ? 'text-[var(--system-red)]' : 'text-[var(--system-green)]'}>{s.mtd.goal_pct}%</b> (일수 {s.mtd.day_pct}%) <button className="underline" onClick={() => setGoalOpen(true)}>수정</button></>
            : <>전월 동기 <Delta v={pct(s.mtd.total, s.mtd.prev_same)} /> · <button className="underline" onClick={() => setGoalOpen(true)}>목표 입력</button></>} />
        <Kpi icon={<ShoppingCart className="w-4 h-4 text-primary" />} bg="bg-primary/10" label="판매 수량 (이달)" value={`${formatNumber(s.mtd.qty)}개`}
          sub={`어제 ${formatNumber(yd.qty)}개 · 전채널 · W컨셉·29CM 매출 ${won(s.mtd.platform)} 포함`} />
        <Kpi icon={<Boxes className="w-4 h-4 text-[var(--system-orange)]" />} bg="bg-[var(--system-orange)]/10" label="재고" value={`${formatNumber(inv.stock_qty)}개`}
          sub={`원가 ${won(inv.stock_cost)} · ${inv.months != null ? `${inv.months}개월치` : '속도 없음'}`} />
        <Kpi icon={<PackageSearch className="w-4 h-4 text-[var(--system-red)]" />} bg="bg-[var(--system-red)]/10" label="품절 · 임박" value={`${inv.out} · ${inv.low}`}
          sub={`SKU ${formatNumber(inv.skus)}개 중 · 장기재고 ${inv.dead}`} />
        <Kpi icon={<Truck className="w-4 h-4 text-primary" />} bg="bg-primary/10" label="미입고 오더" value={`${formatNumber(ro.totals.open_qty)}개`}
          sub={`${won(ro.totals.open_cost)} · 확정 ${ro.open_orders}건${ro.totals.b2b_qty ? ` · B2B 납품 대기 ${formatNumber(ro.totals.b2b_qty)}` : ''}`} />
      </div>

      {goalOpen && (
        <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3 text-sm">
          <span>{month} 매출 목표 (원)</span>
          <input className="border border-border rounded px-2 py-1 bg-background w-44" value={goalInput} onChange={e => setGoalInput(e.target.value)} placeholder="1000000000" />
          <Button size="sm" onClick={saveGoal}>저장</Button><Button size="sm" variant="ghost" onClick={() => setGoalOpen(false)}>닫기</Button>
        </div>
      )}

      {/* 2단 · 매출 추이 */}
      <Section title="30일 채널별 매출" sub="카페24 · W컨셉·29CM(판매가 기준, 수수료·쿠폰 전) · 오프라인 · 쇼피파이(원화 환산)" tab="채널별 매출">
        {chart.length === 0 ? <p className="text-sm text-muted-foreground">데이터 없음</p> : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${Math.round(v / 1e6)}M`} width={36} />
                <Tooltip formatter={(v: number) => formatKRW(v)} labelFormatter={(l: string) => `${month.slice(0, 4)}-${l}`} />
                <Bar dataKey="cafe24" name="카페24" stackId="a" fill="var(--primary)" />
                <Bar dataKey="platform" name="W컨셉·29CM" stackId="a" fill="var(--muted-foreground)" />
                <Bar dataKey="offline" name="오프라인" stackId="a" fill="var(--system-orange)" />
                <Bar dataKey="shopify" name="쇼피파이" stackId="a" fill="var(--system-green)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* 3단 · 발주 액션 — 리오더 관련은 여기 한 곳에만 */}
      <Section title="발주 액션" sub={`마감 임박 ${ro.now.length + ro.soon.length} · 승인 대기 ${ro.approve.length} · 이번 주 입고 ${ro.eta_week.length} · B2B 납품 ${ro.b2b_week.length} · 예정일 지남 ${ro.late}`} tab="리오더">
        <div className="grid gap-4 md:grid-cols-2">
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground"><th className="text-left font-normal pb-1">발주 마감 임박</th><th className="text-right font-normal pb-1">마감 · 권장</th><th /></tr></thead>
            <tbody>
              {[...ro.now, ...ro.soon].slice(0, 8).map(r => (
                <tr key={r.sku} className="border-t border-border">
                  <td className="py-1.5 pr-2"><div className="text-foreground truncate max-w-[220px]">{r.name}</div><div className="text-muted-foreground">재고 {r.stock} · 미입고 {r.on_order} · 일 {r.per_day}</div></td>
                  <td className="py-1.5 text-right whitespace-nowrap"><div className="text-[var(--system-red)] font-medium">{r.order_by}</div><div className="text-muted-foreground">권장 {formatNumber(r.reco)}</div></td>
                  <td className="py-1.5 pl-2 text-right">{(r as { approval?: string }).approval ? <Badge variant="outline" className="text-[10px]">{(r as { approval?: string }).approval}</Badge> : null}</td>
                </tr>
              ))}
              {!ro.now.length && !ro.soon.length && <tr><td className="py-3 text-muted-foreground" colSpan={3}>2주 안에 발주할 상품이 없습니다.</td></tr>}
            </tbody>
          </table>
          <ul className="text-xs space-y-1.5">
            <li className="text-muted-foreground pb-1">승인 · 입고 · 납품</li>
            {ro.approve.map(o => <li key={'a' + o.id} className="flex justify-between gap-2 border-t border-border pt-1.5"><span className="truncate"><Badge variant="outline" className="text-[10px] mr-1">승인</Badge>{o.name}</span><span className="whitespace-nowrap">{formatNumber(o.qty)}개</span></li>)}
            {ro.eta_week.map(o => <li key={'e' + o.id} className="flex justify-between gap-2 border-t border-border pt-1.5"><span className="truncate"><span className="text-muted-foreground mr-1">{o.eta.slice(5)} 입고</span>{o.name}</span><span className="whitespace-nowrap">{formatNumber(o.qty - o.received)}개</span></li>)}
            {ro.b2b_week.map(o => <li key={'b' + o.id} className="flex justify-between gap-2 border-t border-border pt-1.5"><span className="truncate"><Badge className="text-[10px] mr-1">B2B</Badge>{o.partner} · {o.name}</span><span className="whitespace-nowrap">{formatNumber(o.qty - o.received)}개</span></li>)}
            {!ro.approve.length && !ro.eta_week.length && !ro.b2b_week.length && <li className="text-muted-foreground">이번 주 입고·납품·승인 대기 없음</li>}
          </ul>
        </div>
      </Section>

      {/* 4단 · 상품 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="최근 28일 TOP 10" sub="판매 수량 · 소진율" tab="상품 성과">
          <table className="w-full text-xs">
            <tbody>
              {data.top.map((r, i) => (
                <tr key={r.sku} className="border-t border-border">
                  <td className="py-1.5 pr-2 text-muted-foreground w-5">{i + 1}</td>
                  <td className="py-1.5 pr-2 w-9"><Thumb src={r.image} /></td>
                  <td className="py-1.5 pr-2"><div className="text-foreground truncate max-w-[220px]">{r.name}</div><div className="text-muted-foreground">{r.sku}</div></td>
                  <td className="py-1.5 text-right font-medium">{r.sold}</td>
                  <td className="py-1.5 pl-2 text-right text-muted-foreground">{r.sell_through}%</td>
                </tr>
              ))}
              {!data.top.length && <tr><td className="py-3 text-muted-foreground">판매 이력 없음</td></tr>}
            </tbody>
          </table>
        </Section>
        <Section title="움직임 없는 재고" sub="재고 원가액 순 · 60일 이상 미판매 또는 무판매" tab="상품 성과">
          <table className="w-full text-xs">
            <tbody>
              {data.dead.map(r => (
                <tr key={r.sku} className="border-t border-border">
                  <td className="py-1.5 pr-2 w-9"><Thumb src={r.image} /></td>
                  <td className="py-1.5 pr-2"><div className="text-foreground truncate max-w-[200px]">{r.name}</div><div className="text-muted-foreground">{r.idle_days != null ? `${r.idle_days}일 미판매` : '기간 내 판매 없음'}</div></td>
                  <td className="py-1.5 text-right whitespace-nowrap"><div className="font-medium">{formatNumber(r.stock)}개</div><div className="text-muted-foreground">{won(r.stock_cost)}</div></td>
                </tr>
              ))}
              {!data.dead.length && <tr><td className="py-3 text-muted-foreground">없음</td></tr>}
            </tbody>
          </table>
        </Section>
      </div>

      {/* 5단 · 보조 — 프로모션은 펼침, 퍼널·수집 상태는 접힘 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="프로모션 (4주)" sub="채널 플랜" tab="채널 플랜">
          <ul className="text-xs space-y-1.5">
            {data.promos.slice(0, 8).map((p, i) => (
              <li key={i} className="flex gap-2"><CalendarDays className={`w-3.5 h-3.5 mt-0.5 ${p.today ? 'text-[var(--system-green)]' : 'text-muted-foreground'}`} />
                <span className="truncate"><span className="text-muted-foreground">{p.start.slice(5)}~{p.end.slice(5)}</span> <b>{p.channel}</b> {p.title}</span></li>
            ))}
            {!data.promos.length && <li className="text-muted-foreground">4주 안에 예정된 프로모션 없음</li>}
          </ul>
        </Section>
        <details className="rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer font-semibold text-foreground text-sm">체크아웃 퍼널 (7일) · 수집 상태 <span className="text-xs text-muted-foreground font-normal">— 펼치기</span></summary>
          <div className="grid gap-4 md:grid-cols-2 mt-3">
            <div>
              {funnel?.steps ? (
                <ul className="text-xs space-y-1">
                  {funnel.steps.map(st => {
                    const first = funnel.steps[0]?.count || 0;
                    return (
                      <li key={st.event} className="flex items-center gap-2">
                        <span className="w-14 text-muted-foreground">{STEP_LABEL[st.event] || st.event}</span>
                        <span className="flex-1 h-2 rounded bg-muted overflow-hidden"><span className="block h-full bg-primary" style={{ width: `${first ? (st.count / first) * 100 : 0}%` }} /></span>
                        <span className="w-10 text-right">{st.count}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-xs text-muted-foreground">{brand === 'LUMEN' ? '퍼널 데이터 없음' : '픽셀 미설치'}</p>}
              <a className="text-xs text-primary inline-flex items-center gap-1 mt-2" href={pmsUrl('체크아웃 퍼널')} target="_blank" rel="noreferrer">체크아웃 퍼널 <ArrowRight className="w-3 h-3" /></a>
            </div>
            <ul className="text-xs space-y-1">
              {data.crons.slice(0, 9).map(c => (
                <li key={c.name} className="flex justify-between gap-2">
                  <span className="truncate">{c.label}</span>
                  <span className={c.state === '정상' ? 'text-[var(--system-green)]' : 'text-[var(--system-red)]'}>{c.state}{c.age_min != null ? ` · ${c.age_min >= 60 ? `${Math.round(c.age_min / 60)}h` : `${c.age_min}m`}` : ''}</span>
                </li>
              ))}
              {!data.crons.length && <li className="text-muted-foreground">크론 기록 없음</li>}
            </ul>
          </div>
        </details>
      </div>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Percent className="w-3 h-3" /> 판매속도 = 최근 28일 온라인 4채널 + 매장. 리오더 권장 = 일 수요 × 14주 − 재고 − 미입고 + B2B 납품.</p>
    </div>
  );
}
