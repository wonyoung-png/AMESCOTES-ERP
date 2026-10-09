import { db } from './db';

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

let chain: Promise<unknown> = Promise.resolve();
const queue = (fn: () => PromiseLike<unknown>) => { chain = chain.then(fn, fn); };

export function pushSettlements(list: any[]): void {
  if (!list?.length) return;
  queue(() => db.from('settlements').upsert(list.map(settlementRow)).then(({ error }) => {
    if (error) console.warn('[settlements] 서버 저장 실패:', error.message);
  }));
}

export function deleteSettlementSB(id: string): void {
  queue(() => db.from('settlements').delete().eq('id', id).then(({ error }) => {
    if (error) console.warn('[settlements] 서버 삭제 실패:', error.message);
  }));
}
