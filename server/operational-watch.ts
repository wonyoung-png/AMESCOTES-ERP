import { createHash } from 'node:crypto';
import { restAsServer } from './auth.js';
import { allRows } from './work-records.js';
import type { Watch } from './watch.js';
const stamp = (rows: unknown) => createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 12);

export const BRAND_APPROVAL_QUERY = 'brand_order_batches?status=in.(draft,in_approval)&select=id,workspace,status,project_no,title,expected_dely,created_by,created_at,updated_at,brand_order_lines(id,style_no,factory_id,qty,color_qtys,route)&order=created_at.asc,id.asc';
export function brandApprovalQueue(rows: any[]) {
  return rows.filter(b => b.status === 'in_approval' || b.status === 'draft' && Array.isArray(b.brand_order_lines) && b.brand_order_lines.length > 0 && b.brand_order_lines.every((l: any) => {
    const qty = Number(l.qty);
    return String(l.style_no || '').trim() && String(l.factory_id || '').trim() && qty > 0 && Number.isInteger(qty)
      && ['oem', 'direct'].includes(l.route || 'oem') && Array.isArray(l.color_qtys)
      && l.color_qtys.length > 0 && l.color_qtys.every((c: any) => Number.isInteger(Number(c.qty)) && Number(c.qty) > 0)
      && l.color_qtys.reduce((n: number, c: any) => n + Number(c.qty), 0) === qty;
  }));
}
export const loadBrandApprovals = async (read = restAsServer) => brandApprovalQueue(await allRows(BRAND_APPROVAL_QUERY, read));

/** Read original records, never manufacture duplicate work cards or approval tasks. */
export async function operationalWatch(today: string, read = restAsServer, approvals?: Promise<any[]>): Promise<Map<string, Watch>> {
  const out = new Map<string, Watch>();
  const add = (teams: string[], facts: string[], alerts = 0) => teams.forEach(team => {
    const w = out.get(team) || { facts: [], alerts: 0 };
    w.facts.push(...facts); w.alerts += alerts; out.set(team, w);
  });
  const since = new Date(Date.parse(today + 'T00:00:00+09:00') - 6 * 864e5).toISOString();
  const sources = [
    { label: '품목', teams: ['제품개발'], query: `items?updated_at=gte.${since}&select=id,style_no,name,updated_at` },
    { label: 'BOM·원가', teams: ['제품개발'], query: `boms?updated_at=gte.${since}&select=id,style_no,style_name,delivery_price,updated_at` },
    { label: '자재', teams: ['제품개발', '생산관리'], query: `materials?updated_at=gte.${since}&select=id,name,spec,unit,unit_price,currency,updated_at` },
  ];
  const changes = await Promise.all(sources.map(async source => {
    try {
      const rows = await allRows(source.query + '&order=id.asc', read);
      return { teams: source.teams, alerts: 0, facts: [`최근 7일 ${source.label} 저장·수정 ${rows.length}건 (변경 전후 비교 아님, 원본 기준 ${stamp(rows)})`,
        ...rows.slice(0, 8).map(r => `  · ${source.label} id=${r.id} ${r.style_no || ''} ${r.name || r.style_name || ''}${source.label === '자재' ? ` / 규격 ${r.spec || '-'} / 단가 ${r.unit_price ?? '미입력'} ${r.currency || ''}/${r.unit || '-'}` : ''} / 저장 ${r.updated_at}`)] };
    } catch { return { teams: source.teams, facts: [`(${source.label}: 조회 실패 — 판단 보류)`], alerts: 1 }; }
  }));
  for (const result of changes) add(result.teams, result.facts, result.alerts);
  try {
    const [samples, vendors] = await Promise.all([
      allRows('samples?select=id,style_no,style_name,buyer_id,brand_code,stage,location,request_date,expected_date&order=id.asc', read),
      allRows('vendors?type=eq.바이어&select=id,name,name_en,brands&order=id.asc', read),
    ]);
    const active = samples.filter(s => !['최종승인', '반려'].includes(s.stage));
    const unresolved = active.filter(s => !s.brand_code && Array.isArray(vendors.find(v => v.id === s.buyer_id)?.brands) && vendors.find(v => v.id === s.buyer_id).brands.length > 1);
    if (unresolved.length) add(['제품개발'], [`브랜드 미지정 샘플 ${unresolved.length}건 — 브랜드팀 일정에 표시되지 않으므로 귀속 확인 필요 (원본 기준 ${stamp(unresolved)})`], unresolved.length);
    const label = (s: any) => {
      const v = vendors.find(v => v.id === s.buyer_id);
      const brands = Array.isArray(v?.brands) ? v.brands.map((b: any) => typeof b === 'string' ? { name: b, code: '' } : b) : [];
      return s.brand_code ? brands.find((b: any) => b.code === s.brand_code)?.name || s.brand_code : brands.length === 1 ? brands[0].name : v?.name_en || v?.name || '브랜드 미확인';
    };
    for (const [team, rows] of [
      ['제품개발', active],
      ['루멘 디자인', active.filter(s => ['LUMEN', '루멘', 'LUM'].includes(String(label(s)).trim().toUpperCase()))],
      ['에탈루프 디자인', active.filter(s => ['AETALOOF', 'AETALOOP', '에탈루프', 'AET'].includes(String(label(s)).trim().toUpperCase()))],
    ] as [string, any[]][]) {
      const late = rows.filter(s => s.expected_date && s.expected_date < today);
      const missing = rows.filter(s => !s.request_date || !s.expected_date);
      const prioritized = [...late, ...missing, ...rows].filter((s, i, list) => list.findIndex(v => v.id === s.id) === i);
      add([team], [`샘플 진행 ${rows.length}건 / 마감 경과 ${late.length}건 / 접수·마감 날짜 미입력 ${missing.length}건 (원본 기준 ${stamp(rows)}, 공장 진행률·완료 여부는 단계 기록 기준)`,
        ...prioritized.slice(0, 8).map(s => `  · 샘플 id=${s.id} ${label(s)} ${s.style_no} ${s.style_name || ''} / ${s.location || '장소 미확인'} / 접수 ${s.request_date || '없음'} / 마감 ${s.expected_date || '없음'} / ${s.stage || '단계 미확인'}`)], new Set([...late, ...missing].map(s => s.id)).size);
    }
  } catch { add(['제품개발', '루멘 디자인', '에탈루프 디자인'], ['(샘플 일정: 조회 실패 — 판단 보류)'], 1); }
  try {
    const batches = await (approvals || loadBrandApprovals(read));
    for (const [workspace, team] of [['LUMEN', '루멘 디자인'], ['AETALOOF', '에탈루프 디자인']]) {
      const pending = batches.filter(b => b.workspace === workspace);
      add([team, '생산관리'], [`${workspace} 브랜드 생산 의뢰 대표 승인 대기 ${pending.length}건 (원본 기준 ${stamp(pending)})`,
        ...pending.slice(0, 8).map(b => `  · 의뢰 id=${b.id} ${b.project_no} ${b.title || ''} / 요청자 ${b.created_by || '미확인'} / 변경 ${b.updated_at}`)], pending.length);
    }
  } catch { add(['루멘 디자인', '에탈루프 디자인', '생산관리'], ['(브랜드 의뢰 승인 대기: 조회 실패 — 판단 보류)'], 1); }
  // Execution follow-up is not another CEO approval request. Direct factory
  // orders do not pass through OEM acceptance and must not be counted as missing.
  try {
    const batches = await allRows('brand_order_batches?status=in.(draft,in_approval,approved,issued)&select=id,workspace,project_no,status,updated_at,brand_order_lines(id,style_no,factory_id,qty,color_qtys,route,po_no,accepted_at)&order=id.asc', read);
    for (const [workspace, team] of [['LUMEN', '루멘 디자인'], ['AETALOOF', '에탈루프 디자인']]) {
      const own = batches.filter(b => b.workspace === workspace);
      const incomplete = own.filter(b => ['draft', 'in_approval'].includes(b.status)
        && (b.status === 'in_approval' || Array.isArray(b.brand_order_lines) && b.brand_order_lines.length > 0)
        && brandApprovalQueue([{ ...b, status: 'draft' }]).length === 0);
      const issue = own.filter(b => b.status === 'approved');
      const accept = own.filter(b => b.status === 'issued' && Array.isArray(b.brand_order_lines)
        && b.brand_order_lines.some((l: any) => (l.route || 'oem') === 'oem' && !l.accepted_at));
      add([team, '생산관리'], [`${workspace} 승인 후 발행 대기 ${issue.length}건 / 발행 후 OEM 수주 확인 대기 ${accept.length}건 (승인 재요청 아님, 원본 기준 ${stamp(own)})`,
        `${workspace} 의뢰 승인 전 작성 확인 ${incomplete.length}건 (필수 항목·수량 확인, 빈 작성본 제외)`,
        ...incomplete.slice(0, 8).map(b => `  · 의뢰 id=${b.id} ${b.project_no} / 작성 확인 필요 / ${b.status}`),
        ...[...issue, ...accept].slice(0, 8).map(b => `  · 의뢰 id=${b.id} ${b.project_no} / ${b.status === 'approved' ? '발행 대기' : 'OEM 수주 확인 대기'} / 변경 ${b.updated_at}`)], issue.length + accept.length);
    }
  } catch { add(['루멘 디자인', '에탈루프 디자인', '생산관리'], ['(브랜드 승인 후 실행: 조회 실패 — 판단 보류)'], 1); }
  try {
    const purchases = await allRows('purchase_items?select=id,order_id,order_no,item_name,qty,purchase_status&order=id.asc', read);
    const pending = purchases.filter(p => !p.purchase_status || p.purchase_status === '미발주');
    const receiving = purchases.filter(p => p.purchase_status === '발주완료');
    const sending = purchases.filter(p => p.purchase_status === '입고완료');
    add(['생산관리'], [`자재 구매 원본 미발주 ${pending.length}건 (생산 발주의 본사 자재와 중복 가능 — 합산 금지, 원본 기준 ${stamp(pending)})`,
      ...pending.slice(0, 8).map(p => `  · 구매 id=${p.id} ${p.order_no || p.order_id || '발주 연결 없음'} ${p.item_name || ''} / 수량 ${p.qty}`),
      `자재 발주완료·입고 대기 ${receiving.length}건 / 입고완료·발송 대기 ${sending.length}건 (구매완료≠공장 도착, 약속일 미확인, 원본 기준 ${stamp([...receiving, ...sending])})`,
      ...[...receiving, ...sending].slice(0, 8).map(p => `  · 구매 id=${p.id} ${p.order_no || p.order_id || ''} ${p.item_name || ''} / ${p.purchase_status} / 수량 ${p.qty}`)], pending.length);
  } catch { add(['생산관리'], ['(자재 구매: 조회 실패 — 판단 보류)'], 1); }
  try {
    const moves = await allRows('china_stock_moves?select=id,workspace,style_no,color,qty,move_type&order=id.asc', read);
    for (const brand of ['LUMEN', 'AETALOOF']) {
      const balances = new Map<string, number>();
      for (const m of moves.filter(m => m.workspace === brand)) {
        const key = JSON.stringify([m.style_no, m.color]);
        const qty = Number(m.qty);
        const valid = m.qty !== null && Number.isSafeInteger(qty) && qty !== 0
          && ['inbound', 'outbound', 'adjust'].includes(m.move_type) && (m.move_type === 'adjust' || qty > 0);
        // Keep a corrupt source invalid even when a later valid move exists.
        balances.set(key, (balances.get(key) ?? 0) + (valid ? m.move_type === 'outbound' ? -qty : qty : NaN));
      }
      const invalid = [...balances.values()].filter(q => !Number.isSafeInteger(q) || q < 0).length;
      add(['물류·CS', '국내 MD', '글로벌 MD'], [`${brand} 중국 거점 재고 ${invalid ? '수량 미확인 — 판단 보류' : `${[...balances.values()].reduce((n, q) => n + q, 0)}개`} / 수량 확인 ${invalid}종 (이동 이력 기준 ${stamp([...balances])}, 국내·운송중 재고와 합산하지 않음)`], invalid);
    }
  } catch { add(['물류·CS', '국내 MD', '글로벌 MD'], ['(중국 거점 재고: 조회 실패 — 판단 보류)'], 1); }
  try {
    const transfers = await allRows('china_stock_transfers?status=eq.in_transit&select=id,workspace,style_no,color,qty,received_qty,sent_date&order=id.asc', read);
    const validQty = (t: any) => t.qty != null && t.received_qty != null && Number.isSafeInteger(Number(t.qty)) && Number(t.qty) > 0
      && Number.isSafeInteger(Number(t.received_qty)) && Number(t.received_qty) >= 0 && Number(t.received_qty) < Number(t.qty);
    const invalid = transfers.filter(t => !validQty(t)).length;
    add(['물류·CS', '국내 MD', '글로벌 MD'], [`중국→본사 이동 도착 확인 대기 ${transfers.length}건 (부분 도착 차감, 원본 기준 ${stamp(transfers)}, 약속 도착일 자료 없음 — 지연 여부 미확인)`,
      ...(invalid ? [`중국→본사 이동 ${invalid}건 수량 불일치 — 판단 보류`] : []),
      ...transfers.slice(0, 8).map(t => `  · 이동 id=${t.id} ${t.workspace} ${t.style_no} ${t.color} / 출발 ${t.sent_date} / ${validQty(t) ? `미도착 ${Number(t.qty) - Number(t.received_qty)}` : '수량 불일치 — 판단 보류'}`)], invalid);
  } catch { add(['물류·CS', '국내 MD', '글로벌 MD'], ['(중국 재고 이동: 조회 실패 — 판단 보류)'], 1); }
  return out;
}

export function shipmentWatch(orders: any[], receipts: any[], today: string): Watch {
  const sums = new Map<string, { inbound: number; defect: number; outbound: number; hasChina: boolean; allInbound: number }>();
  for (const r of receipts) {
    const s = sums.get(r.order_id) || { inbound: 0, defect: 0, outbound: 0, hasChina: false, allInbound: 0 };
    if (r.log_type === 'inbound') {
      s.allInbound += Number(r.qty || 0);
      if (r.destination === 'china') s.hasChina = true;
      else { s.inbound += Number(r.qty || 0); s.defect += Number(r.defect_qty || 0); }
    }
    if (['outbound_oem', 'outbound_3pl'].includes(r.log_type)) s.outbound += Number(r.qty || 0);
    sums.set(r.order_id, s);
  }
  const pending = orders.filter(o => !['초안', '취소', 'cancelled'].includes(o.status)).map(o => {
    const s = sums.get(o.id);
    // Existing RPCs preserve pre-history cumulative values using greatest().
    const received = s?.hasChina ? s.inbound : Math.max(s?.inbound ?? 0, Number(o.received_qty || 0));
    const defect = s?.hasChina ? s.defect : Math.max(s?.defect ?? 0, Number(o.defect_qty || 0));
    const shipped = Math.max(s?.outbound ?? 0, Number(o.shipped_qty || 0));
    const quantity = Number(o.quantity || 0);
    const good = received - defect;
    const unlocatedLegacy = s?.hasChina && Number(o.received_qty || 0) > s.allInbound;
    const invalid = ![received, defect, shipped, quantity].every(n => Number.isFinite(n) && n >= 0) || good < 0 || (quantity > 0 && shipped > quantity) || !!unlocatedLegacy;
    // Factory direct shipments need not have a headquarters inbound record.
    return { o, remaining: Math.max(0, good - shipped), customerRemaining: quantity > 0 ? Math.max(0, quantity - shipped) : null, invalid, shipped, received, defect, defectShippingCheck: defect > 0 && shipped > good };
  }).filter(r => r.invalid || r.defect > 0 || r.remaining > 0 || (r.shipped > 0 && (r.customerRemaining || 0) > 0));
  const overdue = pending.filter(r => !r.invalid && (r.remaining > 0 || (r.customerRemaining || 0) > 0)
    && r.o.delivery_date && r.o.delivery_date < today);
  return { alerts: overdue.length + pending.filter(r => r.invalid || r.defect > 0).length, facts: [
    `입고·출고 후 잔량 확인 ${pending.length}건 — 납기 경과·출고 잔량 ${overdue.length}건 (입고완료≠납품완료, 고객 도착 미확인, 원본 기준 ${stamp(pending)})`,
    ...(pending.some(r => r.defectShippingCheck) ? ['불량 차감 정상품보다 출고가 많음 — 재검수·대체 입고·공장 직송 확인 전 판단 보류'] : []),
    ...pending.slice(0, 8).map(r => `  · 발주 id=${r.o.id} ${r.o.order_no} ${r.o.style_name || r.o.style_no || ''} / 출고 ${r.shipped} / ${r.invalid ? '입출고 수량 불일치 — 판단 보류' : `정상품 출고 잔량 ${r.remaining} / 주문 대비 미출고 ${r.customerRemaining ?? '수량 미확인'}`}${r.defect > 0 ? ` / 불량 ${r.defect} — 처리 확인 필요` : ''}${r.shipped > r.received ? ' / 본사 입고보다 출고 많음 — 공장 직송 여부 확인' : ''} / 납기 ${r.o.delivery_date || '없음'}`),
  ] };
}
