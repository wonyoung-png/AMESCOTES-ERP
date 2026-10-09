import type { Payable } from './phase1';
import type { Settlement } from './store';

export function buildMonthlyCashPlan(settlements: Settlement[], payables: Payable[], startDate = new Date(), count = 12) {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const incoming = settlements
      .filter(s => s.dueDate?.startsWith(key) && s.status !== '완납')
      .reduce((sum, s) => sum + Math.max(0, s.billedAmountKrw - s.collectedAmountKrw), 0);
    const outgoing = payables
      .filter(p => p.dueDate?.startsWith(key) && p.status !== 'paid')
      .reduce((sum, p) => sum + Math.max(0, p.amountKrw - p.paidAmountKrw), 0);
    return { key, label: `${date.getFullYear()}년 ${date.getMonth() + 1}월`, incoming, outgoing, net: incoming - outgoing };
  });
}
