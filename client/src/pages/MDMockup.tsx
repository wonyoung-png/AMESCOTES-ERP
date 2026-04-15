// MD 대시보드 디자인 초안 — 비그로우 데이터웨이브 제안용
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Cell,
} from 'recharts';

const GOLD = '#C9A96E';
const GOLD_BG = '#FDF8F0';
const GOLD_LIGHT = '#E8D5B0';

// ── 예시 데이터 ────────────────────────────────────
const RAW = [
  { name: '파니에 쁘띠_탄브라운', code: 'A25-001', price: 218000, cost: 60000, qty: 100, ad: 1000000, shipping: 4000, inv: 500 },
  { name: '스퀘어넥 원피스_블랙',   code: 'A25-002', price: 185000, cost: 52000, qty: 130, ad:  800000, shipping: 4000, inv: 400 },
  { name: '플리츠 스커트_아이보리', code: 'A25-003', price: 145000, cost: 38000, qty:  80, ad:  400000, shipping: 4000, inv: 200 },
  { name: '린넨 팬츠_베이지',       code: 'A25-004', price: 132000, cost: 35000, qty:  95, ad:  350000, shipping: 4000, inv: 180 },
  { name: '트위드 재킷_크림',       code: 'A25-005', price: 298000, cost: 95000, qty:  55, ad: 1200000, shipping: 4000, inv: 300 },
  { name: '니트 가디건_그레이',     code: 'A25-006', price: 168000, cost: 48000, qty: 110, ad:  900000, shipping: 4000, inv: 350 },
  { name: '슬리브리스_화이트',      code: 'A25-007', price:  98000, cost: 28000, qty:  75, ad:  300000, shipping: 4000, inv: 150 },
  { name: '벨벳 블라우스_버건디',   code: 'A25-008', price: 125000, cost: 42000, qty:  40, ad:  600000, shipping: 4000, inv: 250 },
  { name: '와이드 데님_인디고',     code: 'A25-009', price: 158000, cost: 55000, qty:  62, ad:  700000, shipping: 4000, inv: 220 },
  { name: '미디 스커트_카키',       code: 'A25-010', price: 118000, cost: 33000, qty: 100, ad:  450000, shipping: 4000, inv: 280 },
];

const TOTAL_REVENUE = RAW.reduce((s, p) => s + p.price * p.qty, 0);

const data = RAW.map(p => {
  const revenue = p.price * p.qty;
  const variable = p.cost * p.qty + p.ad + p.shipping * p.qty;
  const profit = revenue - variable;
  const profitRate = profit / revenue * 100;
  const invValue = p.inv * p.cost;
  const turnover = invValue > 0 ? revenue / invValue : 0;
  const gmroi = (profitRate / 100) * turnover;
  const salesShare = revenue / TOTAL_REVENUE * 100;
  const contribution = salesShare * gmroi;
  return { ...p, revenue, profit, profitRate, invValue, turnover, gmroi, salesShare, contribution };
}).sort((a, b) => b.contribution - a.contribution);

const fmt  = (n: number) => n.toLocaleString('ko-KR');
const fmtP = (n: number) => n.toFixed(2) + '%';
const fmtN = (n: number) => n.toFixed(3);
const short = (s: string) => s.length > 9 ? s.slice(0, 9) + '…' : s;

const MATRIX_COLOR: Record<string, string> = { STAR: '#F59E0B', CASH: '#10B981', INVEST: '#3B82F6', DROP: '#EF4444' };
function matrixCell(d: typeof data[0]) {
  if (d.salesShare >= 15 && d.gmroi >= 0.4) return 'STAR';
  if (d.salesShare <  15 && d.gmroi >= 0.4) return 'CASH';
  if (d.salesShare >= 15 && d.gmroi <  0.4) return 'INVEST';
  return 'DROP';
}

// ── 커스텀 버블 dot ───────────────────────────────
const BubbleDot = (props: any) => {
  const { cx, cy, payload } = props;
  const r = Math.max(6, payload.contribution * 5);
  return <circle cx={cx} cy={cy} r={r} fill={GOLD} fillOpacity={0.7} stroke={GOLD} strokeWidth={1} />;
};

export default function MDMockup() {
  const totalProfit = data.reduce((s, r) => s + r.profit, 0);
  const avgGmroi = data.reduce((s, r) => s + r.gmroi, 0) / data.length;

  return (
    <div style={{ fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif", background: '#F7F5F2', minHeight: '100vh', fontSize: 13 }}>

      {/* ── 헤더 ── */}
      <div style={{ background: '#1C1C1E', padding: '0 28px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ color: GOLD, fontWeight: 700, fontSize: 15, letterSpacing: 0.5 }}>AMESCOTES</span>
          <span style={{ color: '#9CA3AF', fontSize: 10, border: '1px solid #374151', borderRadius: 4, padding: '2px 8px' }}>MD 성과 분석 초안</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {['자사몰', '쿠팡', '네이버', '카카오'].map(ch => (
            <span key={ch} style={{ color: '#9CA3AF', fontSize: 11, cursor: 'pointer', padding: '4px 10px', borderRadius: 6, background: ch === '자사몰' ? '#374151' : 'transparent' }}>{ch}</span>
          ))}
          <span style={{ background: GOLD, color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>2026년 4월</span>
        </div>
      </div>

      {/* ── 공식 바 ── */}
      <div style={{ background: '#2D2D2F', padding: '7px 28px', display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 10, color: '#9CA3AF' }}>
        {[
          ['매출구성비', '= 상품매출 ÷ 총매출 × 100'],
          ['GMROI', '= 이익률 × 재고회전율'],
          ['공헌도', '= 매출구성비 × GMROI'],
        ].map(([k, v]) => (
          <span key={k}><span style={{ color: GOLD, fontWeight: 600 }}>{k}</span> {v}</span>
        ))}
        <span style={{ marginLeft: 'auto' }}>기준: 2026년 4월 · 자사몰</span>
      </div>

      <div style={{ padding: '20px 28px', maxWidth: 1400, margin: '0 auto' }}>

        {/* ── KPI 카드 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: '월 총 매출', value: '1억', sub: fmt(TOTAL_REVENUE) + '원', badge: '▲ 12%', badgeColor: '#065F46', badgeBg: '#D1FAE5', highlight: false },
            { label: '총 판매수량', value: fmt(data.reduce((s,r)=>s+r.qty,0))+'개', sub: '전월 대비', badge: '▲ 8%', badgeColor: '#065F46', badgeBg: '#D1FAE5', highlight: false },
            { label: '총 공헌이익', value: Math.round(totalProfit/10000)+'만', sub: '이익률 ' + fmtP(totalProfit/TOTAL_REVENUE*100), badge: '▲ 3%', badgeColor: '#065F46', badgeBg: '#D1FAE5', highlight: false },
            { label: '★ 최고 공헌도', value: fmtN(data[0].contribution), sub: data[0].name.slice(0,8)+'…', badge: '1위', badgeColor: '#92400E', badgeBg: GOLD_LIGHT, highlight: true },
            { label: '★ 평균 GMROI', value: fmtN(avgGmroi), sub: '전월 0.398 대비', badge: '▲ 5.8%', badgeColor: '#92400E', badgeBg: GOLD_LIGHT, highlight: true },
            { label: '★ 재고회전율', value: fmtN(data.reduce((s,r)=>s+r.turnover,0)/data.length), sub: '목표 0.8 대비', badge: '▼ 20%', badgeColor: '#991B1B', badgeBg: '#FEE2E2', highlight: true },
          ].map((kpi, i) => (
            <div key={i} style={{ background: kpi.highlight ? GOLD_BG : '#fff', border: `1px solid ${kpi.highlight ? GOLD : '#E5E7EB'}`, borderRadius: 12, padding: '14px 16px', position: 'relative' }}>
              <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 6 }}>{kpi.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: kpi.highlight ? GOLD : '#1C1C1E', lineHeight: 1 }}>{kpi.value}</div>
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>{kpi.sub}</div>
              <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: kpi.badgeBg, color: kpi.badgeColor }}>{kpi.badge}</span>
            </div>
          ))}
        </div>

        {/* ── 차트 2개 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14 }}>상품별 매출구성비 (%)</div>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={data} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="name" tickFormatter={short} tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={v => v.toFixed(1)+'%'} />
                <Tooltip formatter={(v: number) => [fmtP(v), '매출구성비']} labelFormatter={short} />
                <Bar dataKey="salesShare" radius={[4,4,0,0]}>
                  {data.map((_, i) => <Cell key={i} fill={i < 2 ? GOLD : '#E5E7EB'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14 }}>GMROI × 매출구성비 버블차트 <span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 400 }}>(원 크기 = 공헌도)</span></div>
            <ResponsiveContainer width="100%" height={190}>
              <ScatterChart margin={{ top: 0, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="salesShare" name="매출구성비" tick={{ fontSize: 9 }} tickFormatter={v => v.toFixed(1)+'%'} label={{ value: '매출구성비(%)', position: 'insideBottom', offset: -2, fontSize: 9 }} />
                <YAxis dataKey="gmroi" name="GMROI" tick={{ fontSize: 9 }} label={{ value: 'GMROI', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                <ZAxis dataKey="contribution" range={[40, 400]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number, name: string) => [typeof v === 'number' ? v.toFixed(3) : v, name]} />
                <Scatter data={data} shape={<BubbleDot />} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── 메인 테이블 ── */}
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>상품별 MD 성과 분석</span>
            <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 8 }}>공헌도 내림차순 · 4월 자사몰 기준</span>
          </div>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>★ 강조 열 = 핵심 지표 (매출구성비 · GMROI · 공헌도)</span>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                {['상품명','판매가','원가','판매수량','매출액','이익률'].map(h => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: h === '상품명' ? 'left' : 'right', fontSize: 10, fontWeight: 600, color: '#6B7280', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
                {['매출구성비','GMROI','공헌도'].map(h => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: GOLD, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => {
                const rankColor = ['#C9A96E','#9CA3AF','#D97706'][i] ?? '#E5E7EB';
                const rankTextColor = i < 3 ? '#fff' : '#6B7280';
                const maxShare = Math.max(...data.map(d => d.salesShare));
                const maxGmroi = Math.max(...data.map(d => d.gmroi));
                const maxContrib = Math.max(...data.map(d => d.contribution));
                const cell = matrixCell(r);
                return (
                  <tr key={r.code} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: rankColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: rankTextColor, flexShrink: 0 }}>{i+1}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{r.name}</div>
                          <div style={{ fontSize: 10, color: '#9CA3AF' }}>{r.code} · <span style={{ color: MATRIX_COLOR[cell], fontWeight: 600 }}>{cell}</span></div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12 }}>{fmt(r.price)}원</td>
                    <td style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12 }}>{fmt(r.cost)}원</td>
                    <td style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12 }}>{r.qty}개</td>
                    <td style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12 }}>{fmt(r.revenue)}원</td>
                    <td style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12, color: r.profitRate >= 60 ? '#059669' : r.profitRate < 40 ? '#DC2626' : '#1C1C1E', fontWeight: r.profitRate >= 60 ? 600 : 400 }}>{fmtP(r.profitRate)}</td>
                    {/* 핵심 3지표 with mini bar */}
                    {[
                      { val: fmtP(r.salesShare), pct: r.salesShare / maxShare },
                      { val: fmtN(r.gmroi),      pct: r.gmroi / maxGmroi },
                      { val: fmtN(r.contribution), pct: r.contribution / maxContrib },
                    ].map((col, ci) => (
                      <td key={ci} style={{ textAlign: 'right', padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <span style={{ fontWeight: 700, color: ci === 2 ? '#1C1C1E' : GOLD, fontSize: ci === 2 ? 13 : 12 }}>{col.val}</span>
                          <div style={{ width: 48, height: 4, background: '#F3F4F6', borderRadius: 2, flexShrink: 0 }}>
                            <div style={{ width: `${col.pct * 100}%`, height: '100%', background: [GOLD, '#3B82F6', '#10B981'][ci], borderRadius: 2 }} />
                          </div>
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#FAFAFA', borderTop: '2px solid #E5E7EB' }}>
                <td colSpan={4} style={{ padding: '9px 14px', fontSize: 12, fontWeight: 700 }}>합계</td>
                <td style={{ textAlign: 'right', padding: '9px 14px', fontSize: 12, fontWeight: 700 }}>{fmt(data.reduce((s,r)=>s+r.revenue,0))}원</td>
                <td style={{ textAlign: 'right', padding: '9px 14px', fontSize: 12, fontWeight: 700 }}>{fmtP(totalProfit/TOTAL_REVENUE*100)}</td>
                <td style={{ textAlign: 'right', padding: '9px 14px', fontSize: 12, fontWeight: 700, color: GOLD }}>{fmtP(data.reduce((s,r)=>s+r.salesShare,0))}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── 하단: 매트릭스 + 요약 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>GMROI × 매출구성비 포지셔닝 매트릭스</div>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 14 }}>기준: GMROI 0.4 / 매출구성비 15%</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { key: 'STAR',   emoji: '⭐', label: 'STAR — 핵심 상품',    bg: '#FFF8E1', border: '#FCD34D', textColor: '#D97706', desc: '높은 수익성 + 높은 매출 기여. 지속 투자.' },
                { key: 'CASH',   emoji: '💰', label: 'CASH COW — 수익 효자', bg: '#F0FDF4', border: '#86EFAC', textColor: '#059669', desc: '수익성 좋으나 구성비 낮음. 판매량 확대 필요.' },
                { key: 'INVEST', emoji: '🔵', label: 'INVEST — 육성 필요',   bg: '#EFF6FF', border: '#93C5FD', textColor: '#2563EB', desc: '구성비는 높으나 수익성 개선 필요. 비용 점검.' },
                { key: 'DROP',   emoji: '🔴', label: 'DROP — 재검토',        bg: '#FEF2F2', border: '#FCA5A5', textColor: '#DC2626', desc: '수익성·구성비 모두 낮음. 할인·단종 검토.' },
              ].map(q => {
                const items = data.filter(d => matrixCell(d) === q.key);
                return (
                  <div key={q.key} style={{ background: q.bg, border: `1px solid ${q.border}`, borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: q.textColor, marginBottom: 4 }}>{q.emoji} {q.label}</div>
                    <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 6 }}>{q.desc}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{items.map(d => d.name.slice(0,8)).join(', ') || '해당 없음'}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>월 요약 <span style={{ fontSize: 10, background: GOLD_LIGHT, color: '#92400E', borderRadius: 4, padding: '2px 6px', marginLeft: 4 }}>26SS 4월</span></div>
            {[
              { k: '총 매출', v: fmt(TOTAL_REVENUE)+'원' },
              { k: '총 공헌이익', v: fmt(Math.round(totalProfit))+'원', positive: true },
              { k: '평균 이익률', v: fmtP(totalProfit/TOTAL_REVENUE*100) },
              { k: '평균 GMROI', v: fmtN(avgGmroi), gold: true },
              { k: '평균 재고회전율', v: fmtN(data.reduce((s,r)=>s+r.turnover,0)/data.length) },
              { k: 'STAR 상품 수', v: data.filter(d=>matrixCell(d)==='STAR').length+'개', positive: true },
              { k: '재검토 상품 수', v: data.filter(d=>matrixCell(d)==='DROP').length+'개', negative: true },
            ].map(item => (
              <div key={item.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}>
                <span style={{ fontSize: 11, color: '#6B7280' }}>{item.k}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: item.gold ? GOLD : item.positive ? '#059669' : item.negative ? '#DC2626' : '#1C1C1E' }}>{item.v}</span>
              </div>
            ))}
            <div style={{ marginTop: 14, background: GOLD, color: '#fff', borderRadius: 8, padding: '10px', textAlign: 'center', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              📊 리포트 PDF 출력
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
