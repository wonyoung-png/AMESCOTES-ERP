/** 날짜·입고 근거만으로 위험을 분류한다. 완료 상태나 발주 수량은 변경하지 않는다. */
export function productionRisks(orders: any[], receipts: any[], today: string) {
  const inbound = new Map<string, number>();
  for (const r of receipts) if (r.log_type === 'inbound') {
    inbound.set(r.order_id, (inbound.get(r.order_id) || 0) + Number(r.qty || 0));
  }
  const date = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  return orders.filter(o => !['초안', '취소', 'cancelled'].includes(o.status)).map(o => {
    const qty = Number(o.quantity ?? o.qty ?? 0);
    const hasLogs = inbound.has(o.id);
    const received = hasLogs ? inbound.get(o.id)! : Number(o.received_qty || 0);
    const remaining = Math.max(0, qty - received);
    const due = o.delivery_date || '';
    const days = date(due) ? Math.round((Date.parse(due) - Date.parse(today)) / 86400000) : null;
    let label = '진행', priority = 9;
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(received) || received < 0 || received > qty) { label = '수량 확인'; priority = 0; }
    else if (o.status === '입고완료' && remaining > 0) { label = '완료 상태·입고 불일치'; priority = 0; }
    else if (remaining === 0) { label = o.status === '입고완료' ? '입고완료' : '입고완료·상태 확인'; priority = o.status === '입고완료' ? 10 : 4; }
    else if (!date(due) || (o.confirmed_date && !date(o.confirmed_date))) { label = '납기 확인'; priority = 3; }
    else if (days! < 0) { label = '납기 지연'; priority = 1; }
    else if (o.confirmed_date && o.confirmed_date > due) { label = '공장 확정일 초과'; priority = 1; }
    else if (days! <= 7) { label = '7일 내 납기'; priority = 2; }
    else if (o.sent_at && !o.confirmed_at) { label = '공장 회신 확인'; priority = 3; }
    return { id: o.id, orderNo: o.order_no, style: o.style_name || o.style_no, due, confirmed: o.confirmed_date || '',
      remaining, received, source: hasLogs ? '입고 이력' : '발주 기록', days, label, priority };
  }).filter(r => r.label !== '입고완료').sort((a, b) => a.priority - b.priority || (a.due || '9999').localeCompare(b.due || '9999'));
}
