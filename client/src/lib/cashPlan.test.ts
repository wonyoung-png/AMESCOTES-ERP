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
  ], [], new Date(2026, 10, 1), 1);

  assert.deepEqual(result[0], { key: '2026-11', label: '2026년 11월', incoming: 800, outgoing: 500, net: 300, confirmedIncoming: 800, expectedIncoming: 0, confirmedOutgoing: 500, expectedOutgoing: 0 });
});

test('발주 예상지출에서 같은 발주의 입고 확정액을 빼 중복 집계하지 않는다', () => {
  const result = buildMonthlyCashPlan([], [
    { id: 'forecast', vendorName: '공장', sourceType: 'processing', orderId: 'o1', amountKrw: 1000, paidAmountKrw: 0, dueDate: '2026-11-30', status: 'pending', createdAt: '' },
    { id: 'actual', vendorName: '공장', sourceType: 'order_receipt', orderId: 'o1', amountKrw: 400, paidAmountKrw: 0, dueDate: '2026-11-20', status: 'pending', createdAt: '' },
  ], [], new Date(2026, 10, 1), 1);

  assert.equal(result[0].outgoing, 1000);
  assert.equal(result[0].confirmedOutgoing, 400);
  assert.equal(result[0].expectedOutgoing, 600);
});

test('미청구 명세표는 발행일 30일 뒤 예상입금으로 잡는다', () => {
  const result = buildMonthlyCashPlan([], [], [{
    id: 't1', statementNo: '202610-A-001', vendorId: 'v1', vendorName: '바이어', vendorCode: 'A', issueDate: '2026-10-15',
    lines: [{ id: 'l1', description: '제품', qty: 2, unitPrice: 1000, taxType: '과세', taxRate: 0.1 }], status: '미청구', createdAt: '',
  }], new Date(2026, 10, 1), 1);

  assert.equal(result[0].expectedIncoming, 2200);
  assert.equal(result[0].confirmedIncoming, 0);
});
