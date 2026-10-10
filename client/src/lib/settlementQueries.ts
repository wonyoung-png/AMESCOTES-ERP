import { db } from './db';
import { fromRow } from './tradeStatementQueries';
import type { Settlement } from './store';

export const settlementRow = (s: any) => ({
  id: s.id,
  buyer_id: s.buyerId || null,
  buyer_name: s.buyerName || null,
  project_no: s.projectNo || null,
  workspace: s.workspace || null,
  channel: s.channel,
  invoice_no: s.invoiceNo || null,
  invoice_date: s.invoiceDate || null,
  due_date: s.dueDate || null,
  billed_amount_krw: s.billedAmountKrw ?? 0,
  collected_amount_krw: s.collectedAmountKrw ?? 0,
  collected_date: s.collectedDate || null,
  status: s.status,
  memo: s.memo || null,
  created_at: s.createdAt || new Date().toISOString(),
});

export const settlementFromRow = (r: any) => ({
  id: r.id,
  buyerId: r.buyer_id || undefined,
  buyerName: r.buyer_name || '',
  projectNo: r.project_no || undefined,
  workspace: r.workspace || undefined,
  channel: r.channel,
  invoiceNo: r.invoice_no || undefined,
  invoiceDate: r.invoice_date || '',
  dueDate: r.due_date || '',
  billedAmountKrw: Number(r.billed_amount_krw) || 0,
  collectedAmountKrw: Number(r.collected_amount_krw) || 0,
  collectedDate: r.collected_date || undefined,
  status: r.status,
  memo: r.memo || undefined,
  createdAt: r.created_at || '',
});

export async function fetchSettlements(): Promise<Settlement[]> {
  const rows: Settlement[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db.from('settlements').select('*').order('id').range(start, start + 999);
    if (error) throw error;
    rows.push(...(data || []).map(settlementFromRow));
    if ((data || []).length < 1000) return rows;
  }
}

export async function saveSettlement(s: Settlement, expected: Settlement | null, send: typeof fetch = fetch) {
  const response = await send('/api/settlements/save', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settlement: s, expected: expected ? settlementRow(expected) : null }),
  });
  let body;
  try { body = await response.json(); }
  catch { throw new Error('수금 저장 결과 확인이 필요합니다 — 같은 내용으로 재시도해주세요'); }
  if (!response.ok) throw new Error(body.message || '미수금 저장에 실패했습니다');
  if (body.result?.settlement?.id !== s.id) throw new Error('미수금 저장 결과 확인이 필요합니다');
  return { settlement: settlementFromRow(body.result.settlement),
    statement: body.result.statement ? fromRow(body.result.statement) : null };
}

export async function deleteSettlementSB(id: string): Promise<void> {
  const { error } = await db.from('settlements').delete().eq('id', id);
  if (error) throw new Error(String(error.message).includes('protected_settlement')
    ? '수금 또는 명세표 연결이 있는 미수금은 삭제할 수 없습니다 — 정정 절차가 필요합니다' : error.message);
}
