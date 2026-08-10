// 지출결의 서버 저장.
//
// localStorage에만 두면 만든 사람 브라우저에서만 보인다 — 경리가 못 본다.
// store의 쓰기가 setAll(KEYS.expenses, ...) 한 곳을 지나므로 거기서 서버에도 올린다.
import { supabase } from './supabase';
import { filterForTable } from './tableColumns';

const toRow = (e: any) => filterForTable('expenses', {
  id: e.id,
  expense_date: e.expenseDate || null,
  expense_type: e.expenseType,
  category: e.category,
  description: e.description,
  amount_krw: e.amountKrw ?? 0,
  lines: e.lines || [],
  order_id: e.orderId || null,
  order_no: e.orderNo || null,
  vendor_id: e.vendorId || null,
  vendor_name: e.vendorName || null,
  has_tax_invoice: !!e.hasTaxInvoice,
  tax_invoice_no: e.taxInvoiceNo || null,
  supply_amount: e.supplyAmount ?? null,
  tax_amount: e.taxAmount ?? null,
  tax_invoice_date: e.taxInvoiceDate || null,
  // 어느 프로젝트 항목의 집행인지 — 예산 계획 대비 실제를 보려면 이게 있어야 한다
  project_item_id: e.projectItemId || null,
  memo: e.memo || null,
  updated_at: new Date().toISOString(),
});

const fromRow = (r: any) => ({
  id: r.id, expenseDate: r.expense_date || '', expenseType: r.expense_type,
  category: r.category, description: r.description || '',
  amountKrw: Number(r.amount_krw || 0),
  lines: Array.isArray(r.lines) ? r.lines : [],
  orderId: r.order_id || undefined, orderNo: r.order_no || undefined,
  vendorId: r.vendor_id || undefined, vendorName: r.vendor_name || undefined,
  hasTaxInvoice: !!r.has_tax_invoice, taxInvoiceNo: r.tax_invoice_no || undefined,
  supplyAmount: r.supply_amount ?? undefined, taxAmount: r.tax_amount ?? undefined,
  taxInvoiceDate: r.tax_invoice_date || undefined,
  projectItemId: r.project_item_id || undefined,
  memo: r.memo || undefined, createdAt: r.created_at || '',
});

export async function fetchExpensesSB(): Promise<any[]> {
  const { data, error } = await supabase.from('expenses').select('*');
  if (error) throw error;
  return (data || []).map(fromRow);
}

/** 화면을 막지 않는다 — 저장 실패는 콘솔로만 알리고 로컬 값은 그대로 둔다 */
export function pushExpenses(list: any[]): void {
  if (!list?.length) return;
  supabase.from('expenses').upsert(list.map(toRow)).then(({ error }) => {
    if (error) console.warn('[expenses] 서버 저장 실패:', error.message);
  });
}

/** 프로젝트 항목별 실제 집행액 — 예산 보기의 '집행' 열 */
export async function fetchSpentByItem(itemIds: string[]): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {};
  const { data, error } = await supabase
    .from('expenses').select('project_item_id,amount_krw').in('project_item_id', itemIds);
  if (error) throw error;
  const out: Record<string, number> = {};
  (data || []).forEach((r: any) => {
    const k = r.project_item_id;
    if (k) out[k] = (out[k] || 0) + Number(r.amount_krw || 0);
  });
  return out;
}
