import type { Payable } from './phase1';
import type { Settlement } from './store';
import type { TradeStatement } from './store';

export type PlannedExpenseStage = '예상' | '확정';
export type PlannedExpenseWorkspace = 'OEM' | 'LUMEN' | 'AETALOOF';
export type PlannedExpenseTaxType = '과세' | '면세' | '불공제';
export type PlannedExpenseDocument = { type: '견적서' | '계약서' | '세금계산서' | '기타'; name: string; url: string };
export const ASSET_ACCOUNTS = ['건설중인자산', '시설장치', '비품', '임차보증금'] as const;
export const PLANNED_EXPENSE_ACCOUNTS = [...ASSET_ACCOUNTS, '수선비', '광고선전비', '지급수수료', '기타'] as const;
export const DEFAULT_ACCOUNT_BY_CATEGORY: Record<string, string> = { 인테리어: '건설중인자산', 집기: '비품', 보증금: '임차보증금', 촬영: '지급수수료', 마케팅: '광고선전비', 팝업: '광고선전비', 기타: '기타' };
export const encodePlannedExpense = (workspace: PlannedExpenseWorkspace, category: string, stage: PlannedExpenseStage, description: string, groupId?: string, installment?: string, account?: string, taxType?: PlannedExpenseTaxType, budgetKrw?: number, documents: PlannedExpenseDocument[] = []) =>
  `[자금계획|${workspace}|${category}|${stage}${groupId ? `|${groupId}|${installment || '지급'}${account ? `|${account}|${taxType || '과세'}|${ASSET_ACCOUNTS.includes(account as typeof ASSET_ACCOUNTS[number]) ? '자산' : '비용'}${budgetKrw ? `|${budgetKrw}|${encodeURIComponent(JSON.stringify(documents))}` : ''}` : ''}` : ''}] ${description.trim()}`;
export const parsePlannedExpense = (memo?: string) => {
  const match = memo?.match(/^\[자금계획\|(OEM|LUMEN|AETALOOF|AETALOOP)\|([^|]+)\|(예상|확정)(?:\|([^|]+)\|([^|\]]+)(?:\|([^|]+)\|(과세|면세|불공제)\|(자산|비용)(?:\|(\d+)\|([^\]]+))?)?)?\]\s*(.*)$/);
  if (!match) return null;
  let documents: PlannedExpenseDocument[] | undefined;
  try { documents = match[10] ? JSON.parse(decodeURIComponent(match[10])) : undefined; } catch { documents = undefined; }
  return { workspace: (match[1] === 'AETALOOP' ? 'AETALOOF' : match[1]) as PlannedExpenseWorkspace, category: match[2], stage: match[3] as PlannedExpenseStage, groupId: match[4], installment: match[5], account: match[6], taxType: match[7] as PlannedExpenseTaxType | undefined, assetType: match[8], budgetKrw: match[9] ? Number(match[9]) : undefined, documents, description: match[11] };
};
export const confirmPlannedExpenseMemo = (memo?: string) => memo?.replace(/^(\[자금계획\|[^|]+\|[^|]+\|)예상(?=\||\])/, '$1확정');
export const splitPlannedExpenseAmount = (gross: number, taxType?: PlannedExpenseTaxType) => {
  const tax = taxType === '과세' ? Math.round(gross / 11) : 0;
  return { supply: gross - tax, tax, gross };
};
export const isSafeDocumentUrl = (value: string) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
};

export function buildPlannedExpenseProjects(payables: Payable[]) {
  const groups = new Map<string, { name: string; budget: number; planned: number; paid: number; documents: PlannedExpenseDocument[] }>();
  payables.forEach(p => {
    const meta = parsePlannedExpense(p.memo);
    if (!meta?.groupId) return;
    const row = groups.get(meta.groupId) || { name: p.projectNo || meta.description, budget: meta.budgetKrw || 0, planned: 0, paid: 0, documents: meta.documents || [] };
    row.planned += p.amountKrw;
    row.paid += p.paidAmountKrw;
    groups.set(meta.groupId, row);
  });
  return Array.from(groups.entries()).map(([id, row]) => ({ id, ...row, budget: row.budget || row.planned }));
}

export const statementTotal = (s: TradeStatement) => s.lines.reduce((sum, line) => {
  const supply = line.qty * line.unitPrice;
  return sum + supply + (line.taxType === '과세' ? supply * line.taxRate : 0);
}, 0);

export function buildMonthlyCashPlan(settlements: Settlement[], payables: Payable[], statements: TradeStatement[] = [], startDate = new Date(), count = 12) {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const confirmedIncoming = settlements
      .filter(s => s.dueDate?.startsWith(key) && s.billedAmountKrw > s.collectedAmountKrw)
      .reduce((sum, s) => sum + Math.max(0, s.billedAmountKrw - s.collectedAmountKrw), 0);
    const expectedIncoming = statements
      .filter(s => s.status === '미청구' && addDays(s.issueDate, 30).startsWith(key))
      .reduce((sum, s) => sum + statementTotal(s), 0);
    const confirmedOutgoing = payables
      .filter(p => p.sourceType !== 'processing' && parsePlannedExpense(p.memo)?.stage !== '예상' && p.dueDate?.startsWith(key) && p.status !== 'paid')
      .reduce((sum, p) => sum + Math.max(0, p.amountKrw - p.paidAmountKrw), 0);
    const expectedProcessing = payables
      .filter(p => p.sourceType === 'processing' && p.dueDate?.startsWith(key) && p.status !== 'paid')
      .reduce((sum, p) => {
        const confirmed = payables.filter(x => x.sourceType === 'order_receipt' && x.orderId === p.orderId)
          .reduce((total, x) => total + x.amountKrw, 0);
        return sum + Math.max(0, p.amountKrw - confirmed - p.paidAmountKrw);
      }, 0);
    const expectedManual = payables
      .filter(p => parsePlannedExpense(p.memo)?.stage === '예상' && p.dueDate?.startsWith(key) && p.status !== 'paid')
      .reduce((sum, p) => sum + Math.max(0, p.amountKrw - p.paidAmountKrw), 0);
    const expectedOutgoing = expectedProcessing + expectedManual;
    const incoming = confirmedIncoming + expectedIncoming;
    const outgoing = confirmedOutgoing + expectedOutgoing;
    return { key, label: `${date.getFullYear()}년 ${date.getMonth() + 1}월`, incoming, outgoing, net: incoming - outgoing, confirmedIncoming, expectedIncoming, confirmedOutgoing, expectedOutgoing };
  });
}

export const expectedStatementDate = (s: TradeStatement) => addDays(s.issueDate, 30);

export function dailyCashProjection(month: string, opening: number, incoming: { date: string; amount: number }[], outgoing: { date: string; amount: number }[]) {
  const [year, mon] = month.split('-').map(Number);
  let balance = opening;
  return Array.from({ length: new Date(year, mon, 0).getDate() }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const inflow = incoming.filter(r => r.date === date).reduce((n, r) => n + r.amount, 0);
    const outflow = outgoing.filter(r => r.date === date).reduce((n, r) => n + r.amount, 0);
    const minimum = balance - outflow;
    balance += inflow - outflow;
    return { date, balance, minimum, inflow, outflow };
  });
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
