// 팀 감시 데이터 — 팀 에이전트가 업무 카드 말고 실제 ERP·PMS 데이터에서 "제대로 되고 있나"를 본다.
//
// 숫자(facts)와 경고 수(alerts)는 규칙으로 뽑는다. 같은 데이터면 늘 같은 경고 — 지도 색이 흔들리면 안 된다.
// AI 는 이 facts 를 대표가 정한 감시 기준(team_watch)에 비춰 읽고 보고만 쓴다.
//
// 기준 계산은 ERP 대시보드와 같게 맞췄다 (client/src/pages/Dashboard.tsx 69-135, SampleManagement.tsx 374).
// shortcut: 현재 규모는 페이지 조회로 집계한다. 수만 행이 되면 DB 집계로 전환한다.
import { restAsServer } from './auth.js';
import { dailyFetch } from './daily-bridge.js';
import { kstToday } from './work.js';
import { allRows } from './work-records.js';
import { productionRisks } from './production-risk.js';
import { buildMonthlyCashPlan, statementTotal } from '../client/src/lib/cashPlan.js';
import { orgTeam } from './org.js';

export type Watch = { facts: string[]; alerts: number };

const won = (n: number) => (Math.abs(n) >= 1e8 ? (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '억' : Math.round(n / 1e4).toLocaleString() + '만') + '원';
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

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

const stmtAmount = (s: any) => statementTotal({ ...s, lines: Array.isArray(s.lines) ? s.lines : [] });

export const campaignTeams = (team: string, workspace: string) => team === '디자인'
  ? workspace === 'LUMEN' ? ['루멘 디자인'] : workspace === 'AETALOOF' ? ['에탈루프 디자인'] : []
  : TASK_TEAM[team] || (orgTeam(team) ? [team] : []);

/** 팀 → 감시 데이터. 한 표를 못 읽으면 그 표를 쓰는 팀만 "읽지 못함"으로 남기고 나머지는 진행 */
export async function gatherWatch(read = restAsServer, readPms = pms): Promise<Map<string, Watch>> {
  const today = kstToday();
  const in30 = addDays(today, 30);
  const rows = (path: string) => allRows(path + '&order=id.asc', read);
  const [orders, receipts, samples, stmts, settlements, payables, camps, subscriptions, lumen, aeta] = await Promise.all([
    rows('production_orders?status=neq.초안&select=id,order_no,style_no,style_name,vendor_name,quantity,received_qty,status,delivery_date,confirmed_date,sent_at,confirmed_at,hq_supply_items,factory_unit_price_krw,trade_statement_id,workspace').catch(e => e as Error),
    rows('receipt_logs?log_type=eq.inbound&select=id,order_id,log_type,qty').catch(e => e as Error),
    rows('samples?select=id,style_no,style_name,stage,expected_date,assignee,billing_status,cost_krw,brand_code').catch(e => e as Error),
    rows('trade_statements?status=in.(미청구,청구완료)&select=id,statement_no,vendor_name,issue_date,lines,status,workspace').catch(e => e as Error),
    rows('settlements?select=id,buyer_name,due_date,billed_amount_krw,collected_amount_krw,status').catch(e => e as Error),
    rows('payables?select=id,source_type,order_id,amount_krw,paid_amount_krw,due_date,status,memo').catch(e => e as Error),
    rows(`campaigns?or=(and(end_date.gte.${today},start_date.lte.${in30}),and(end_date.lt.${today},status.in.(active,onboarded)))&select=title,channel,start_date,end_date,status,workspace,tasks`).catch(e => e as Error),
    rows('subscriptions?status=neq.해지됨&select=service_name,average_amount,currency,status,next_billing_on').catch(e => e as Error),
    readPms('lumen'), readPms('aetaloof'),
  ]);
  const out = new Map<string, Watch>();
  const add = (team: string, facts: string[], alerts = 0) => {
    const w = out.get(team) || { facts: [], alerts: 0 };
    w.facts.push(...facts); w.alerts += alerts; out.set(team, w);
  };
  const failed = (team: string, what: string, e: Error) => add(team, [`(${what}: 조회 실패 — 판단 보류)`], 1);

  // ── 구독 감시
  if (subscriptions instanceof Error) failed('경영지원', '구독', subscriptions);
  else {
    const review = subscriptions.filter(s => s.status === '검토 필요');
    const due7 = subscriptions.filter(s => s.next_billing_on && s.next_billing_on >= today && s.next_billing_on <= addDays(today, 7));
    const krw = subscriptions.filter(s => s.currency === 'KRW').reduce((n, s) => n + (Number(s.average_amount) || 0), 0);
    add('경영지원', [`검토 필요 구독 ${review.length}건, 이번 달 구독 합계 ${won(krw)}, 7일 안 결제 예정 ${due7.length}건`,
      ...due7.slice(0, 8).map(s => `  · ${s.next_billing_on} ${s.service_name} ${won(Number(s.average_amount) || 0)}`)], review.length);
  }

  // ── 생산 발주
  if (orders instanceof Error || receipts instanceof Error) ['생산관리', '물류·CS', '영업', '제품개발'].forEach(t => failed(t, '생산·입고', orders instanceof Error ? orders : receipts as Error));
  else {
    const risks = productionRisks(orders, receipts, today);
    const activeIds = new Set(risks.filter(r => r.remaining > 0 || r.priority === 0).map(r => r.id));
    const live = orders.filter(o => activeIds.has(o.id));
    const past = live.filter(o => risks.some(r => r.id === o.id && r.label === '납기 지연'));
    const due7 = live.filter(o => o.delivery_date && o.delivery_date >= today && days(today, o.delivery_date) <= 7);
    const notSent = live.filter(o => o.status === '발주생성' && !o.sent_at);
    const noReply = live.filter(o => o.sent_at && !o.confirmed_at && ['발주생성', '생산중'].includes(o.status));
    const noPrice = live.filter(o => !Number(o.factory_unit_price_krw));
    const mat = live.flatMap(o => (Array.isArray(o.hq_supply_items) ? o.hq_supply_items : [])
      .filter((i: any) => i?.purchaseStatus === '미구매').map((i: any) => `${o.order_no} ${i.itemName || ''}`));
    const unbilled = orders.filter(o => o.status === '입고완료' && !o.trade_statement_id);
    const line = (o: any) => `  · ${o.order_no} ${o.style_name || o.style_no || ''} / ${o.vendor_name || '공장 미정'} / 납기 ${o.delivery_date || '없음'} / ${o.status}`;
    add('생산관리', [
      `납기·입고 점검: 확인 필요 ${risks.filter(r => r.priority < 9).length}건 (입고 이력 우선)`,
      ...risks.filter(r => r.priority < 9).slice(0, 8).map(r => `  · ${r.orderNo}: ${r.label} / 입고 ${r.received}, 잔량 ${r.remaining} / ${r.source}`),
      `생산 발주 진행 ${live.length}건 — 납기 지남 ${past.length}, 7일 안 납기 ${due7.length}, 공장에 안 보냄 ${notSent.length}, 공장 답 없음 ${noReply.length}`,
      ...(past.length ? ['납기 지난 발주:', ...past.slice(0, 8).map(line)] : []),
      ...(due7.length ? ['7일 안 납기:', ...due7.slice(0, 8).map(line)] : []),
      `본사 제공 자재 미구매 ${mat.length}건${mat.length ? ': ' + mat.slice(0, 6).join(', ') : ''}`,
    ], risks.filter(r => r.priority < 9 && r.priority !== 2).length + notSent.length + noReply.length
      // 7일 안 납기인데 본사 자재를 아직 안 샀으면 경고 (생산관리 기본 기준)
      + due7.filter(o => Array.isArray(o.hq_supply_items) && o.hq_supply_items.some((i: any) => i?.purchaseStatus === '미구매')).length);
    add('물류·CS', [`7일 안 입고 예정 발주 ${due7.length}건${due7.length ? ': ' + due7.slice(0, 6).map(o => `${o.order_no}(${o.delivery_date})`).join(', ') : ''}`]);
    add('제품개발', [`공장 단가 없는 진행 발주 ${noPrice.length}건${noPrice.length ? ': ' + noPrice.slice(0, 6).map(o => o.order_no).join(', ') : ''}`], noPrice.length);
    const oem = live.filter(o => !o.workspace || o.workspace === 'OEM');
    const byStatus = oem.reduce((m: Record<string, number>, o) => (m[o.status] = (m[o.status] || 0) + 1, m), {});
    add('영업', [`OEM 오더 진행 ${oem.length}건 (${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'})`,
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
    const unb = stmts.filter(s => s.status === '미청구');
    const sum = (l: any[]) => won(l.reduce((v, s) => v + stmtAmount(s), 0));
    const f = [`거래명세표 미청구 ${unb.length}건 ${sum(unb)} (발행일+30일은 예상 수금일)`];
    add('경영지원', f);
    add('영업', f);
  }
  if (settlements instanceof Error) failed('경영지원', '미수금', settlements);
  else {
    const recv = settlements.filter(s => s.status !== '완납' && Number(s.billed_amount_krw) > Number(s.collected_amount_krw));
    const late = recv.filter(s => s.due_date && s.due_date < today);
    add('경영지원', [`미수금 ${recv.length}건 ${won(recv.reduce((n, s) => n + Number(s.billed_amount_krw) - Number(s.collected_amount_krw), 0))} — 수금 예정일 지남 ${late.length}건 (부분 수금 차감)`], late.length);
  }
  if (payables instanceof Error) failed('경영지원', '미지급금', payables);
  if (!(settlements instanceof Error) && !(payables instanceof Error) && !(stmts instanceof Error)) {
    const plan = buildMonthlyCashPlan(
      settlements.map(s => ({ ...s, dueDate: s.due_date, billedAmountKrw: Number(s.billed_amount_krw), collectedAmountKrw: Number(s.collected_amount_krw) })),
      payables.map(p => ({ ...p, sourceType: p.source_type, orderId: p.order_id, amountKrw: Number(p.amount_krw), paidAmountKrw: Number(p.paid_amount_krw), dueDate: p.due_date })),
      stmts.map(s => ({ ...s, issueDate: s.issue_date })), new Date(today + 'T12:00:00'), 2);
    add('경영지원', [...plan.map(p => `${p.key} 자금계획: 입금 ${won(p.incoming)} (확정 ${won(p.confirmedIncoming)}), 출금 ${won(p.outgoing)} (확정 ${won(p.confirmedOutgoing)}), 차액 ${won(p.net)}`), '기초 잔액·은행 잔고 미연동 — 자금 부족 여부 판단 보류']);
  }

  // ── 운영캘린더 준비 항목
  if (camps instanceof Error) Object.values(TASK_TEAM).flat().forEach(t => failed(t, '운영캘린더', camps));
  else {
    for (const c of camps) {
      if (c.status === 'closed') continue;
      if (c.end_date < today) {
        for (const team of ['마케팅', '국내 MD', '글로벌 MD']) add(team, [`종료 확인 필요: "${c.title}" 종료 ${c.end_date}, 상태 ${c.status} — 자동 종료하지 않음`], 1);
        continue;
      }
      const soon = days(today, c.start_date) <= 7;
      for (const t of Array.isArray(c.tasks) ? c.tasks : []) {
        if (!t || t.done || t.status === 'done') continue;
        const overdue = t.dueDate && t.dueDate < today;
        for (const team of campaignTeams(t.team, c.workspace)) {
          add(team, [`기획전 "${c.title}"(${c.start_date}~${c.end_date}, ${c.channel || ''}) 준비 안 됨: ${t.label}${t.dueDate ? ' / 마감 ' + t.dueDate : ''}${t.assignee ? ' / ' + t.assignee : ''}${overdue ? ' — 마감 지남' : ''}`],
            overdue || soon ? 1 : 0);
        }
      }
    }
    const upcoming = camps.filter(c => c.status !== 'closed' && c.end_date >= today);
    const list = upcoming.map(c => `  · ${c.start_date}~${c.end_date} ${c.channel || ''} ${c.title} (${c.workspace || ''}, ${c.status})`);
    for (const team of ['마케팅', '비주얼·콘텐츠', '국내 MD', '글로벌 MD']) add(team, [`30일 안 기획전 ${upcoming.length}건`, ...list.slice(0, 8)]);
  }

  // ── 브랜드 매출·재고·리오더 (PMS)
  const brand = (d: any, name: string) => {
    if (!d) return { dom: [`(${name} 매출: PMS 조회 실패 — 판단 보류)`], glob: [`(${name} 매출: PMS 조회 실패 — 판단 보류)`], off: [`(${name} 매출: PMS 조회 실패 — 판단 보류)`], late: 0 };
    const s = d.sales || {}, y = s.yesterday || {}, m = s.mtd || {}, inv = d.inventory || {}, ro = d.reorder || {};
    const d30: any[] = Array.isArray(s.daily30) ? s.daily30 : [];
    // 일일점검 행이 하나도 없으면 매출 0 이 아니라 아직 수집을 안 하는 브랜드다 (10/8 AETALOOF)
    if (!d30.length && !inv.skus) {
      const none = [`(${name}: PMS 에 매출·재고 데이터가 아직 없음 — 수집 전)`];
      return { dom: none, glob: none, off: none, late: 0 };
    }
    const wk = (k: string, from: number, to?: number) => d30.slice(from, to).reduce((v, r) => v + (Number(r[k]) || 0), 0);
    const trend = (k: string) => `최근 7일 ${won(wk(k, -7))} (그 전 7일 ${won(wk(k, -14, -7))})`;
    return {
      dom: [`${name} 이번 달 매출 ${won(Number(m.total) || 0)}${m.goal ? ` / 목표 ${won(m.goal)} (${m.goal_pct}%, 달 경과 ${m.day_pct}%)` : ''}`,
        `${name} 국내 자사몰 ${trend('cafe24')}, W컨셉·29CM ${trend('platform')}`,
        `${name} 리오더: 지금 발주 ${ro.now?.length ?? 0}종, 2주 안 ${ro.soon?.length ?? 0}종, 입고 늦음 ${ro.late ?? 0}건, 승인 대기 ${ro.approve?.length ?? 0}건`,
        ...(ro.now || []).slice(0, 6).map((r: any) => `  · 지금 발주: ${r.name} 재고 ${r.stock} / 하루 ${r.per_day} / ${r.order_by || ''}까지`),
        `${name} 재고: 품절 ${inv.out ?? '-'}종, 품절 임박 ${inv.low ?? '-'}종, 장기재고 ${inv.dead ?? '-'}종`],
      // 쇼피파이 원화가 2주 내내 0 이면 매출이 없는 게 아니라 PMS 일일점검에 안 들어온 것 — '0원'으로 보고하지 않게
      glob: [wk('shopify', -14) ? `${name} 해외몰(쇼피파이) ${trend('shopify')}` : `(${name} 해외몰 매출: PMS 일일점검에 원화 값이 비어 있음 — 확인 필요, 0원으로 판단하지 말 것)`, `${name} 품절 ${inv.out ?? '-'}종, 품절 임박 ${inv.low ?? '-'}종`],
      off: [`${name} 매장 ${trend('offline')}, 어제 ${won(Number(y.offline) || 0)}`],
      late: Number(ro.late) || 0,
    };
  };
  // 브랜드 API의 분리된 응답을 사용한다. 숫자가 우연히 같다는 이유로 브랜드를 제외하지 않는다.
  const L = brand(lumen, 'LUMEN');
  const A = brand(aeta, 'AETALOOF');
  const unavailable = Number(!lumen) + Number(!aeta);
  add('국내 MD', [...L.dom, ...A.dom], L.late + A.late + unavailable);
  add('글로벌 MD', [...L.glob, ...A.glob], unavailable);
  add('리테일', [...L.off, ...A.off], unavailable);
  return out;
}
