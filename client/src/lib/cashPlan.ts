import type { Payable } from './phase1';
import type { Settlement } from './store';
import type { TradeStatement } from './store';

export type PlannedExpenseStage = '예상' | '확정';
export type PlannedExpenseWorkspace = 'OEM' | 'LUMEN' | 'AETALOOP';
export const encodePlannedExpense = (workspace: PlannedExpenseWorkspace, category: string, stage: PlannedExpenseStage, description: string, groupId?: string, installment?: string) =>
  `[자금계획|${workspace}|${category}|${stage}${groupId ? `|${groupId}|${installment || '지급'}` : ''}] ${description.trim()}`;
export const parsePlannedExpense = (memo?: string) => {
  const match = memo?.match(/^\[자금계획\|(OEM|LUMEN|AETALOOP)\|([^|]+)\|(예상|확정)(?:\|([^|]+)\|([^\]]+))?\]\s*(.*)$/);
  return match ? { workspace: match[1] as PlannedExpenseWorkspace, category: match[2], stage: match[3] as PlannedExpenseStage, groupId: match[4], installment: match[5], description: match[6] } : null;
};
export const confirmPlannedExpenseMemo = (memo?: string) => memo?.replace(/^(\[자금계획\|[^|]+\|[^|]+\|)예상(?=\||\])/, '$1확정');

export const statementTotal = (s: TradeStatement) => s.lines.reduce((sum, line) => {
  const supply = line.qty * line.unitPrice;
  return sum + supply + (line.taxType === '과세' ? supply * line.taxRate : 0);
}, 0);

export function buildMonthlyCashPlan(settlements: Settlement[], payables: Payable[], statements: TradeStatement[] = [], startDate = new Date(), count = 12) {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const confirmedIncoming = settlements
      .filter(s => s.dueDate?.startsWith(key) && s.status !== '완납')
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

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
