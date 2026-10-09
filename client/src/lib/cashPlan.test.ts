import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonthlyCashPlan } from './cashPlan';

test('미수·미지급 잔액을 예정월별로 합산하고 완납·지급완료는 제외한다', () => {
  const result = buildMonthlyCashPlan([
    { id: 's1', buyerName: 'A', channel: 'B2B직납', invoiceDate: '2026-10-01', dueDate: '2026-11-10', billedAmountKrw: 1000, collectedAmountKrw: 200, status: '정상', createdAt: '' },
    { id: 's2', buyerName: 'B', channel: 'B2B직납', invoiceDate: '2026-10-01', dueDate: '2026-11-20', billedAmountKrw: 500, collectedAmountKrw: 500, status: '완납', createdAt: '' },
  ], [
    { id: 'p1', vendorName: '공장', sourceType: 'manual', amountKrw: 600, paidAmountKrw: 100, dueDate: '2026-11-15', status: 'partial', createdAt: '' },
    { id: 'p2', vendorName: '자재', sourceType: 'manual', amountKrw: 300, paidAmountKrw: 300, dueDate: '2026-11-16', status: 'paid', createdAt: '' },
  ], new Date(2026, 10, 1), 1);

  assert.deepEqual(result[0], { key: '2026-11', label: '2026년 11월', incoming: 800, outgoing: 500, net: 300 });
});
