import { fromRow } from './tradeStatementQueries';
import { settlementFromRow } from './settlementQueries';
import type { TradeStatement } from './store';
import { validDate } from '../../../shared/schedule';

export function statementAmount(s: Pick<TradeStatement, 'lines'>) {
  if (!s.lines.length || s.lines.some(l => !l.description.trim() || !Number.isFinite(l.qty) || l.qty <= 0 || !Number.isFinite(l.unitPrice) || l.unitPrice < 0 || !['과세', '면세'].includes(l.taxType) || !Number.isFinite(l.taxRate) || l.taxRate < 0 || l.taxRate > 1)) throw new Error('명세표 품목·수량·단가·세율을 확인해주세요');
  const total = s.lines.reduce((sum, l) => sum + l.qty * l.unitPrice * (l.taxType === '과세' ? 1 + l.taxRate : 1), 0);
  if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) throw new Error('명세표 금액을 확인해주세요');
  return total;
}

/** 폐기된 판매가 대신 현재 납품가만 사용한다. 미확정 단가는 0원 초안으로 남긴다. */
export const statementUnitPrice = (item?: { deliveryPrice?: number; salePriceKrw?: number }) =>
  item && Number.isFinite(item.deliveryPrice) && item.deliveryPrice! > 0 ? item.deliveryPrice! : 0;

/** 명세표와 미수금은 서버 트랜잭션 성공 결과만 화면에 반영한다. */
export async function saveStatementBilling(s: TradeStatement, invoiceDate: string, send: typeof fetch = fetch) {
  if (!s.id || !s.vendorId || !validDate(s.issueDate) || !validDate(invoiceDate) || !['미청구', '청구완료', '수금완료'].includes(s.status)) throw new Error('거래처·날짜·상태를 확인해주세요');
  statementAmount(s);
  const response = await send('/api/statements/save-billing', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statement: s, invoiceDate, expectedUpdatedAt: s.updatedAt || null }),
  });
  let body;
  try { body = await response.json(); }
  catch { throw new Error('명세표 저장 결과 확인이 필요합니다 — 같은 내용으로 재시도해주세요'); }
  if (!response.ok) throw new Error(body.message || '명세표·미수금 저장 실패 — 같은 내용으로 재시도해주세요');
  const result = body.result;
  const billed = s.status !== '미청구' || s.taxInvoice?.issued;
  if (!result?.statement || result.statement.id !== s.id || !result.statement.statement_no
    || (billed && (!result.settlement || result.settlement.invoice_no !== result.statement.statement_no))) {
    throw new Error('명세표·미수금 저장 결과 확인이 필요합니다 — 같은 내용으로 재시도해주세요');
  }
  return { statement: fromRow(result.statement), settlement: result.settlement ? settlementFromRow(result.settlement) : null };
}
