import { db } from './db';
import { tradeStatementRow, fromRow } from './tradeStatementQueries';
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

/** shortcut: 두 저장은 단일 트랜잭션이 아니다. 후속 실패는 명시하고 같은 명세표 ID로 복구한다. */
export async function saveStatementBilling(s: TradeStatement, invoiceDate: string, client = db) {
  if (!s.id || !s.statementNo || !s.vendorId || !validDate(s.issueDate) || !validDate(invoiceDate) || !['미청구', '청구완료', '수금완료'].includes(s.status)) throw new Error('거래처·명세표 번호·날짜·상태를 확인해주세요');
  const amount = statementAmount(s);
  const { data: original, error: originalError } = await client.from('trade_statements').select('*').eq('id', s.id).maybeSingle();
  if (originalError) throw originalError;
  if (original && original.statement_no !== s.statementNo) throw new Error('기존 명세표 번호는 변경할 수 없습니다');
  const { data: sameNumber, error: numberError } = await client.from('trade_statements').select('id').eq('statement_no', s.statementNo);
  if (numberError) throw numberError;
  if (sameNumber?.some(row => row.id !== s.id)) throw new Error('명세표 번호가 이미 사용 중입니다. 기존 전표를 확인해주세요');
  if (original?.tax_invoice?.issued && (!s.taxInvoice?.issued || s.vendorId !== original.vendor_id || amount !== statementAmount(fromRow(original)))) throw new Error('계산서 발행 후 거래처·금액 변경은 정정 절차가 필요합니다');
  if (s.taxInvoice?.issued && (s.status === '미청구' || !Number.isFinite(s.taxInvoice.totalAmount) || Math.abs(s.taxInvoice.totalAmount - amount) > 0.001)) throw new Error('계산서 금액과 명세표 합계·청구 상태를 확인해주세요');
  const { data: linked, error: readError } = await client.from('settlements').select('*').eq('invoice_no', s.statementNo);
  if (readError) throw readError;
  if ((linked || []).length > 1) throw new Error('같은 명세표의 미수금이 중복되어 확인이 필요합니다');
  const previous = linked?.[0];
  const billed = s.status === '청구완료' || s.status === '수금완료' || s.taxInvoice?.issued;
  if (previous && !billed) throw new Error('연결된 미수금이 있습니다. 청구 취소는 별도로 확인해주세요');
  if (billed && amount <= 0) throw new Error('0원 명세표는 청구할 수 없습니다. 납품가를 확인해주세요');
  if (previous && amount < Number(previous.collected_amount_krw || 0)) throw new Error('이미 입금된 금액보다 청구금액을 줄일 수 없습니다');
  if (s.status === '수금완료' && (!previous || Number(previous.collected_amount_krw || 0) !== amount)) throw new Error('매출·미수에서 실제 수금 내역을 먼저 확인해주세요');
  let write = original ? client.from('trade_statements').update(tradeStatementRow(s)).eq('id', s.id)
    : client.from('trade_statements').upsert(tradeStatementRow(s), { onConflict: 'id', ignoreDuplicates: true });
  if (original?.updated_at) write = write.eq('updated_at', original.updated_at);
  const { data: saved, error } = await write.select('*').single();
  if (error) throw error;
  if (!saved) throw new Error('명세표 서버 저장 결과를 확인해주세요');
  if (!billed) return { statement: fromRow(saved), settlement: null };
  try {
    // 기존 수금액·수금일·기한·상태를 덮어쓰지 않는다.
    const patch = { buyer_id: s.vendorId, buyer_name: s.vendorName, billed_amount_krw: amount,
      project_no: s.projectNo || null, workspace: s.workspace || null };
    let result;
    if (previous) {
      result = await client.from('settlements').update(patch).eq('id', previous.id)
        .eq('collected_amount_krw', previous.collected_amount_krw).eq('billed_amount_krw', previous.billed_amount_krw).select('*').single();
    } else {
      const due = new Date(`${invoiceDate}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + 30);
      // 동시 재시도도 같은 ID를 쓰며 이미 저장된 수금 내역은 변경하지 않는다.
      const inserted = await client.from('settlements').upsert({ ...patch, id: `stl_${s.id}`, channel: 'B2B직납',
        invoice_no: s.statementNo, invoice_date: invoiceDate, due_date: due.toISOString().slice(0, 10),
        collected_amount_krw: 0, status: '정상', created_at: new Date().toISOString() }, { onConflict: 'id', ignoreDuplicates: true });
      if (inserted.error) throw inserted.error;
      result = await client.from('settlements').select('*').eq('id', `stl_${s.id}`).single();
    }
    if (result.error) throw result.error;
    if (!result.data || Number(result.data.billed_amount_krw) !== amount || result.data.buyer_id !== s.vendorId) throw new Error('미수금 원본과 명세표가 다릅니다');
    return { statement: fromRow(saved), settlement: settlementFromRow(result.data) };
  } catch {
    throw new Error('명세표는 저장됐지만 미수금 연결에 실패했습니다. 창을 닫지 말고 같은 명세표로 재시도해주세요');
  }
}
