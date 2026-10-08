// 팀 감시 데이터 — 팀 에이전트가 업무 카드 말고 실제 ERP·PMS 데이터에서 "제대로 되고 있나"를 본다.
//
// 숫자(facts)와 경고 수(alerts)는 규칙으로 뽑는다. 같은 데이터면 늘 같은 경고 — 지도 색이 흔들리면 안 된다.
// AI 는 이 facts 를 대표가 정한 감시 기준(team_watch)에 비춰 읽고 보고만 쓴다.
//
// 기준 계산은 ERP 대시보드와 같게 맞췄다 (client/src/pages/Dashboard.tsx 69-135, SampleManagement.tsx 374).
// ponytail: 점검 1회마다 표 5개를 통째로 읽는다(지금 수백 행). 수만 행이 되면 PostgREST 쪽 집계로.
import { restAsServer } from './auth.js';
import { dailyFetch } from './daily-bridge.js';
import { kstToday } from './work.js';

export type Watch = { facts: string[]; alerts: number };

const won = (n: number) => (Math.abs(n) >= 1e8 ? (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '억' : Math.round(n / 1e4).toLocaleString() + '만') + '원';
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

const LIMIT = 2000;
let truncated: string[] = [];
async function rows(path: string): Promise<any[]> {
  const r = await restAsServer(`${path}&limit=${LIMIT}`);
  if (!r.ok) throw new Error(`${path.split('?')[0]} 조회 실패 ${r.status}`);
  const j = await r.json();
  // 한도에 닿으면 일부만 본 것 — 조용히 넘기지 않고 보고에 남긴다 (코덱스 지적)
  if (j.length >= LIMIT) truncated.push(path.split('?')[0]);
  return j;
}
/** PMS 는 느리거나 꺼져 있을 수 있다 — 6초 넘으면 없는 걸로 */
async function pms(brand: string): Promise<any | null> {
  try {
    return await Promise.race([dailyFetch(`/api/dashboard/brand?brand=${brand}`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
  } catch (e) { console.warn(`[watch] PMS ${brand} 실패:`, String(e).split('\n')[0]); return null; }
}

/** 운영캘린더 준비 항목의 팀 이름(CAMPAIGN_TEAMS) → 조직도 팀 */
const TASK_TEAM: Record<string, string[]> = {
  '국내영업': ['국내 MD'], '해외영업': ['글로벌 MD'], '비주얼컨텐츠': ['비주얼·콘텐츠'], '디자인': ['루멘 디자인', '에탈루프 디자인'],
  '생산': ['생산관리'], '마케팅': ['마케팅'], '물류CS': ['물류·CS'], '쇼룸': ['리테일'],
};

const stmtAmount = (s: any) => (Array.isArray(s.lines) ? s.lines : [])
  .reduce((v: number, l: any) => v + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0) * (1 + (Number(l.taxRate) || 0)), 0);

/** 팀 → 감시 데이터. 한 표를 못 읽으면 그 표를 쓰는 팀만 "읽지 못함"으로 남기고 나머지는 진행 */
export async function gatherWatch(): Promise<Map<string, Watch>> {
  const today = kstToday();
  const in30 = addDays(today, 30);
  truncated = [];
  const [orders, samples, stmts, camps, lumen, aeta] = await Promise.all([
    rows('production_orders?status=neq.초안&select=order_no,style_no,style_name,vendor_name,status,delivery_date,sent_at,confirmed_at,hq_supply_items,factory_unit_price_krw,trade_statement_id,workspace&order=delivery_date.asc').catch(e => e as Error),
    rows('samples?select=style_no,style_name,stage,expected_date,assignee,billing_status,cost_krw,brand_code').catch(e => e as Error),
    rows('trade_statements?status=in.(미청구,청구완료)&select=statement_no,vendor_name,issue_date,lines,status,workspace').catch(e => e as Error),
    rows(`campaigns?end_date=gte.${today}&start_date=lte.${in30}&select=title,channel,start_date,end_date,status,workspace,tasks&order=start_date.asc`).catch(e => e as Error),
    pms('lumen'), pms('aetaloof'),
  ]);
  const out = new Map<string, Watch>();
  const add = (team: string, facts: string[], alerts = 0) => {
    const w = out.get(team) || { facts: [], alerts: 0 };
    w.facts.push(...facts); w.alerts += alerts; out.set(team, w);
  };
  const failed = (team: string, what: string, e: Error) => add(team, [`(${what}: 지금 읽지 못함 — ${e.message})`]);

  // ── 생산 발주
  if (orders instanceof Error) ['생산관리', '물류·CS', '영업', '제품개발'].forEach(t => failed(t, '생산 발주', orders));
  else {
    const live = orders.filter(o => o.status !== '입고완료');
    const past = live.filter(o => o.delivery_date && o.delivery_date < today);
    const due7 = live.filter(o => o.delivery_date && o.delivery_date >= today && days(today, o.delivery_date) <= 7);
    const notSent = orders.filter(o => o.status === '발주생성' && !o.sent_at);
    const noReply = orders.filter(o => o.sent_at && !o.confirmed_at && ['발주생성', '생산중'].includes(o.status));
    const noPrice = live.filter(o => !Number(o.factory_unit_price_krw));
    const mat = live.flatMap(o => (Array.isArray(o.hq_supply_items) ? o.hq_supply_items : [])
      .filter((i: any) => i?.purchaseStatus === '미구매').map((i: any) => `${o.order_no} ${i.itemName || ''}`));
    const unbilled = orders.filter(o => o.status === '입고완료' && !o.trade_statement_id);
    const line = (o: any) => `  · ${o.order_no} ${o.style_name || o.style_no || ''} / ${o.vendor_name || '공장 미정'} / 납기 ${o.delivery_date || '없음'} / ${o.status}`;
    add('생산관리', [
      `생산 발주 진행 ${live.length}건 — 납기 지남 ${past.length}, 7일 안 납기 ${due7.length}, 공장에 안 보냄 ${notSent.length}, 공장 답 없음 ${noReply.length}`,
      ...(past.length ? ['납기 지난 발주:', ...past.slice(0, 8).map(line)] : []),
      ...(due7.length ? ['7일 안 납기:', ...due7.slice(0, 8).map(line)] : []),
      `본사 제공 자재 미구매 ${mat.length}건${mat.length ? ': ' + mat.slice(0, 6).join(', ') : ''}`,
    ], past.length + notSent.length + noReply.length
      // 7일 안 납기인데 본사 자재를 아직 안 샀으면 경고 (생산관리 기본 기준)
      + due7.filter(o => Array.isArray(o.hq_supply_items) && o.hq_supply_items.some((i: any) => i?.purchaseStatus === '미구매')).length);
    add('물류·CS', [`7일 안 입고 예정 발주 ${due7.length}건${due7.length ? ': ' + due7.slice(0, 6).map(o => `${o.order_no}(${o.delivery_date})`).join(', ') : ''}`]);
    add('제품개발', [`공장 단가 없는 진행 발주 ${noPrice.length}건${noPrice.length ? ': ' + noPrice.slice(0, 6).map(o => o.order_no).join(', ') : ''}`], noPrice.length);
    const byStatus = live.reduce((m: Record<string, number>, o) => (m[o.status] = (m[o.status] || 0) + 1, m), {});
    add('영업', [`OEM 오더 진행 ${live.length}건 (${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'})`,
      `입고 끝났는데 거래명세표 없는 발주 ${unbilled.length}건${unbilled.length ? ': ' + unbilled.slice(0, 6).map(o => o.order_no).join(', ') : ''}`], unbilled.length);
  }

  // ── 샘플 (지금 ERP 샘플은 OEM 바이어 것뿐 — 제품개발)
  if (samples instanceof Error) failed('제품개발', '샘플', samples);
  else {
    const prog = samples.filter(s => !['최종승인', '반려'].includes(s.stage));
    const late = prog.filter(s => s.expected_date && s.expected_date < today);
    add('제품개발', [
      `진행 중 샘플 ${prog.length}건 — 예정일 지남 ${late.length}`,
      ...late.slice(0, 8).map(s => `  · ${s.style_name || s.style_no} ${s.stage} / 예정 ${s.expected_date} / 담당 ${s.assignee || '-'}`),
    ], late.length);
    const sb = samples.filter(s => s.billing_status === '미청구');
    add('경영지원', [`미청구 샘플비 ${sb.length}건 ${won(sb.reduce((v, s) => v + (Number(s.cost_krw) || 0), 0))}`]);
  }

  // ── 청구·수금
  if (stmts instanceof Error) ['영업', '경영지원'].forEach(t => failed(t, '거래명세표', stmts));
  else {
    const unb = stmts.filter(s => s.status === '미청구'), recv = stmts.filter(s => s.status === '청구완료');
    const old = recv.filter(s => s.issue_date && days(s.issue_date, today) > 60);
    const sum = (l: any[]) => won(l.reduce((v, s) => v + stmtAmount(s), 0));
    const f = [`거래명세표 미청구 ${unb.length}건 ${sum(unb)}`, `청구했고 수금 전 ${recv.length}건 ${sum(recv)} (60일 넘은 것 ${old.length}건)`,
      ...old.slice(0, 6).map(s => `  · ${s.statement_no} ${s.vendor_name} ${s.issue_date} ${won(stmtAmount(s))}`)];
    add('경영지원', f, old.length);
    add('영업', f.slice(0, 2));
  }

  // ── 운영캘린더 준비 항목
  if (camps instanceof Error) Object.values(TASK_TEAM).flat().forEach(t => failed(t, '운영캘린더', camps));
  else {
    for (const c of camps) {
      const soon = days(today, c.start_date) <= 7;
      for (const t of Array.isArray(c.tasks) ? c.tasks : []) {
        if (!t || t.done || t.status === 'done') continue;
        const overdue = t.dueDate && t.dueDate < today;
        for (const team of TASK_TEAM[t.team] || []) {
          add(team, [`기획전 "${c.title}"(${c.start_date}~${c.end_date}, ${c.channel || ''}) 준비 안 됨: ${t.label}${t.dueDate ? ' / 마감 ' + t.dueDate : ''}${t.assignee ? ' / ' + t.assignee : ''}${overdue ? ' — 마감 지남' : ''}`],
            overdue || soon ? 1 : 0);
        }
      }
    }
    const list = camps.map(c => `  · ${c.start_date}~${c.end_date} ${c.channel || ''} ${c.title} (${c.workspace || ''}, ${c.status})`);
    for (const team of ['마케팅', '비주얼·콘텐츠', '국내 MD', '글로벌 MD']) add(team, [`30일 안 기획전 ${camps.length}건`, ...list.slice(0, 8)]);
  }

  // ── 브랜드 매출·재고·리오더 (PMS)
  const brand = (d: any, name: string) => {
    if (!d) return { dom: [`(${name} 매출: PMS 지금 읽지 못함)`], glob: [`(${name} 매출: PMS 지금 읽지 못함)`], off: [`(${name} 매출: PMS 지금 읽지 못함)`], late: 0 };
    const s = d.sales || {}, y = s.yesterday || {}, m = s.mtd || {}, inv = d.inventory || {}, ro = d.reorder || {};
    const d30: any[] = Array.isArray(s.daily30) ? s.daily30 : [];
    const wk = (k: string, from: number, to?: number) => d30.slice(from, to).reduce((v, r) => v + (Number(r[k]) || 0), 0);
    const trend = (k: string) => `최근 7일 ${won(wk(k, -7))} (그 전 7일 ${won(wk(k, -14, -7))})`;
    return {
      dom: [`${name} 이번 달 매출 ${won(Number(m.total) || 0)}${m.goal ? ` / 목표 ${won(m.goal)} (${m.goal_pct}%, 달 경과 ${m.day_pct}%)` : ''}`,
        `${name} 국내 자사몰 ${trend('cafe24')}, W컨셉·29CM ${trend('platform')}`,
        `${name} 리오더: 지금 발주 ${ro.now?.length ?? 0}종, 2주 안 ${ro.soon?.length ?? 0}종, 입고 늦음 ${ro.late ?? 0}건, 승인 대기 ${ro.approve?.length ?? 0}건`,
        ...(ro.now || []).slice(0, 6).map((r: any) => `  · 지금 발주: ${r.name} 재고 ${r.stock} / 하루 ${r.per_day} / ${r.order_by || ''}까지`),
        `${name} 재고: 품절 ${inv.out ?? '-'}종, 품절 임박 ${inv.low ?? '-'}종, 장기재고 ${inv.dead ?? '-'}종`],
      glob: [`${name} 해외몰(쇼피파이) ${trend('shopify')}`, `${name} 품절 ${inv.out ?? '-'}종, 품절 임박 ${inv.low ?? '-'}종`],
      off: [`${name} 매장 ${trend('offline')}, 어제 ${won(Number(y.offline) || 0)}`],
      late: Number(ro.late) || 0,
    };
  };
  // 10/8 실측: PMS 가 AETALOOF 요청에도 LUMEN 과 똑같은 숫자를 준다 — 그대로 쓰면 경고가 두 번 센다. 같으면 빼고 그 사실만 남긴다
  const same = !!lumen && !!aeta && JSON.stringify((lumen as any).sales) === JSON.stringify((aeta as any).sales);
  const L = brand(lumen, 'LUMEN');
  const A = same ? { dom: ['(AETALOOF: PMS 가 LUMEN 과 같은 값을 줘서 제외 — 브랜드 분리 확인 필요)'], glob: [], off: [], late: 0 } : brand(aeta, 'AETALOOF');
  add('국내 MD', [...L.dom, ...A.dom], L.late + A.late);
  add('글로벌 MD', [...L.glob, ...A.glob]);
  add('리테일', [...L.off, ...A.off]);
  if (truncated.length) for (const w of Array.from(out.values())) w.facts.push(`(주의: ${truncated.join(', ')} ${LIMIT}건 넘어 일부만 봄)`);
  return out;
}
