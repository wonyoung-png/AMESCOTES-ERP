// 거래명세표 서버 저장.
//
// 테이블은 진작 있었는데 올리는 길이 '매출·영업이익' 화면을 열 때 도는 일괄 업로드 하나뿐이고,
// 내려받는 길은 아예 없었다. 그래서 만든 사람 브라우저에만 남았다 — 경리도 다른 담당자도 못 본다.
// expenses 와 같은 방식으로 맞춘다: store 의 쓰기가 한 곳을 지나니 거기서 서버에도 올린다.
import { db } from './db';

export const tradeStatementRow = (s: any) => ({
  id: s.id,
  statement_no: s.statementNo,
  vendor_id: s.vendorId || null,
  vendor_name: s.vendorName || null,
  vendor_code: s.vendorCode || null,
  project_no: s.projectNo || null,
  workspace: s.workspace || null,
  issue_date: s.issueDate || null,
  lines: s.lines || [],
  status: s.status,
  tax_invoice: s.taxInvoice || null,
  tax_invoice_no: s.taxInvoiceNo || null,
  collected_date: s.collectedDate || null,
  memo: s.memo || null,
  created_at: s.createdAt || new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

export const fromRow = (r: any) => ({
  id: r.id,
  statementNo: r.statement_no || '',
  vendorId: r.vendor_id || '',
  vendorName: r.vendor_name || '',
  vendorCode: r.vendor_code || '',
  projectNo: r.project_no || undefined,
  workspace: r.workspace || undefined,
  issueDate: r.issue_date || '',
  // 옛 현장 접수만 10(%)로 저장했다. DB 원본은 보존하고 화면에서는 비율로 읽는다.
  lines: Array.isArray(r.lines) ? r.lines.map((line: any) => line?.taxRate === 10
    && String(line.memo || '').startsWith('현장 접수') ? { ...line, taxRate: 0.1 } : line) : [],
  status: r.status,
  taxInvoice: r.tax_invoice || undefined,
  taxInvoiceNo: r.tax_invoice_no || undefined,
  collectedDate: r.collected_date || undefined,
  memo: r.memo || undefined,
  createdAt: r.created_at || '',
  updatedAt: r.updated_at || r.created_at || undefined,
});

export async function fetchTradeStatementsSB(): Promise<any[]> {
  const { data, error } = await db.from('trade_statements').select('*');
  if (error) throw error;
  return (data || []).map(fromRow);
}

/**
 * 올리기와 지우기를 보낸 순서대로 처리한다.
 *
 * 둘을 그냥 띄우면 지우기가 먼저 끝나고 그 전에 시작한 올리기가 나중에 끝나서, 지운 행이
 * 되살아난다 (코덱스 지적). 전표가 멋대로 돌아오는 건 사람이 알아채기도 어렵다.
 */
let chain: Promise<unknown> = Promise.resolve();
const queue = (fn: () => PromiseLike<unknown>) => { chain = chain.then(fn, fn); };

/**
 * 지우기는 올리기와 따로 가야 한다.
 * 남은 것만 다시 upsert 하면 지운 행은 서버에 그대로 남아, 다음 접속에 되살아난다.
 */
export function deleteTradeStatementSB(id: string): void {
  queue(() => db.from('trade_statements').delete().eq('id', id).then(({ error }) => {
    if (error) console.warn('[trade_statements] 서버 삭제 실패:', error.message);
  }));
}

/**
 * 아직 청구하지 않은(미청구) 명세표만 — "기존 명세표에 추가" 목록에 쓴다.
 * 청구·수금이 끝난 전표에 줄을 더하면 이미 보낸 금액과 어긋난다. 서버도 같은 이유로 막는다.
 */
export async function fetchOpenStatements(vendorId: string): Promise<any[]> {
  if (!vendorId) return [];
  const { data, error } = await db.from('trade_statements')
    .select('*').eq('vendor_id', vendorId).eq('status', '미청구')
    .order('issue_date', { ascending: false }).limit(20);
  if (error) throw error;
  return (data || []).map(fromRow);
}
