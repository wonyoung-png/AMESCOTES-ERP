import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonthlyCashPlan, buildPlannedExpenseProjects, confirmPlannedExpenseMemo, DEFAULT_ACCOUNT_BY_CATEGORY, encodePlannedExpense, isSafeDocumentUrl, parsePlannedExpense, splitPlannedExpenseAmount } from './cashPlan';
import type { Payable } from './phase1';
import { dailyCashProjection } from './cashPlan';

test('월말 순유입이 양수여도 월초 지급 부족을 잡는다', () => {
  const rows = dailyCashProjection('2026-11', 100, [{ date: '2026-11-20', amount: 1000 }], [{ date: '2026-11-01', amount: 500 }]);
  assert.equal(rows[0].minimum, -400);
  assert.equal(rows.at(-1)!.balance, 600);
  const sameDay = dailyCashProjection('2026-11', 100, [{ date: '2026-11-01', amount: 1000 }], [{ date: '2026-11-01', amount: 500 }]);
  assert.equal(sameDay[0].minimum, -400);
  assert.equal(sameDay[0].balance, 600);
});

test('옛 AETALOOP 메모는 보존하면서 공식 브랜드명으로 읽는다', () => {
  assert.equal(parsePlannedExpense('[자금계획|AETALOOP|촬영|예상] 촬영비')?.workspace, 'AETALOOF');
  assert.equal(parsePlannedExpense(encodePlannedExpense('AETALOOF', '촬영', '예상', '촬영비'))?.workspace, 'AETALOOF');
});

test('미수·미지급 잔액을 예정월별로 합산하고 완납·지급완료는 제외한다', () => {
  const result = buildMonthlyCashPlan([
    { id: 's1', buyerName: 'A', channel: 'B2B직납', invoiceDate: '2026-10-01', dueDate: '2026-11-10', billedAmountKrw: 1000, collectedAmountKrw: 200, status: '완납', createdAt: '' },
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

test('LUMEN 비정기 지출은 예상 단계로 분류하고 메타정보를 보존한다', () => {
  const memo = encodePlannedExpense('LUMEN', '인테리어', '예상', '성수점 계약금');
  const result = buildMonthlyCashPlan([], [{ id: 'p1', vendorName: '시공사', sourceType: 'manual', amountKrw: 5000, paidAmountKrw: 0, dueDate: '2026-11-05', status: 'pending', memo, createdAt: '' }], [], new Date(2026, 10, 1), 1);

  assert.deepEqual(parsePlannedExpense(memo), { workspace: 'LUMEN', category: '인테리어', stage: '예상', groupId: undefined, installment: undefined, account: undefined, taxType: undefined, assetType: undefined, budgetKrw: undefined, documents: undefined, description: '성수점 계약금' });
  assert.equal(result[0].expectedOutgoing, 5000);
  assert.equal(result[0].confirmedOutgoing, 0);
});

test('분할지급은 같은 묶음과 각 회차를 보존한다', () => {
  const memo = encodePlannedExpense('LUMEN', '인테리어', '예상', '성수점 공사', 'project-1', '중도금');
  assert.deepEqual(parsePlannedExpense(memo), { workspace: 'LUMEN', category: '인테리어', stage: '예상', groupId: 'project-1', installment: '중도금', account: undefined, taxType: undefined, assetType: undefined, budgetKrw: undefined, documents: undefined, description: '성수점 공사' });
  assert.equal(parsePlannedExpense(confirmPlannedExpenseMemo(memo))?.stage, '확정');
});

test('계정과목과 부가세를 보존하고 지급총액을 공급가액과 세액으로 나눈다', () => {
  const memo = encodePlannedExpense('LUMEN', '인테리어', '예상', '성수점 공사', 'project-1', '계약금', '건설중인자산', '과세');
  assert.equal(parsePlannedExpense(memo)?.account, '건설중인자산');
  assert.equal(parsePlannedExpense(memo)?.assetType, '자산');
  assert.deepEqual(splitPlannedExpenseAmount(1100000, '과세'), { supply: 1000000, tax: 100000, gross: 1100000 });
  assert.equal(DEFAULT_ACCOUNT_BY_CATEGORY.보증금, '임차보증금');
});

test('프로젝트 예산과 증빙 링크를 회차마다 보존한다', () => {
  const documents = [{ type: '계약서' as const, name: '성수점 계약서', url: 'https://example.com/contract' }];
  const memo = encodePlannedExpense('LUMEN', '인테리어', '예상', '성수점 공사', 'project-1', '계약금', '건설중인자산', '과세', 33000000, documents);
  assert.equal(parsePlannedExpense(memo)?.budgetKrw, 33000000);
  assert.deepEqual(parsePlannedExpense(memo)?.documents, documents);
  assert.equal(isSafeDocumentUrl('javascript:alert(1)'), false);
});

test('실사용 흐름: 공사 분할지급과 OEM 입고가 월별 자금·예산에 중복 없이 이어진다', () => {
  const docs = [{ type: '계약서' as const, name: '성수점 계약서', url: 'https://example.com/contract' }];
  const makeInstallment = (id: string, label: string, amountKrw: number, dueDate: string, stage: '예상' | '확정', paidAmountKrw = 0, status: Payable['status'] = 'pending'): Payable => ({
    id, vendorName: '성수인테리어', projectNo: 'LUMEN 성수점', sourceType: 'manual', amountKrw, paidAmountKrw, dueDate, status,
    memo: encodePlannedExpense('LUMEN', '인테리어', stage, '성수점 공사', 'seongsu-1', label, '건설중인자산', '과세', 36000000, docs), createdAt: '',
  });
  const payables: Payable[] = [
    makeInstallment('contract', '계약금', 11000000, '2026-10-20', '확정', 5000000, 'partial'),
    makeInstallment('middle', '중도금', 11000000, '2026-11-20', '예상'),
    makeInstallment('balance', '잔금', 11000000, '2026-12-20', '예상'),
    { id: 'oem-forecast', vendorName: 'OEM 공장', sourceType: 'processing', orderId: 'oem-1', amountKrw: 50000000, paidAmountKrw: 0, dueDate: '2026-11-30', status: 'pending', createdAt: '' },
    { id: 'oem-receipt', vendorName: 'OEM 공장', sourceType: 'order_receipt', orderId: 'oem-1', amountKrw: 20000000, paidAmountKrw: 0, dueDate: '2026-11-15', status: 'pending', createdAt: '' },
  ];
  const settlements = [{ id: 'sale-1', buyerName: 'W컨셉', channel: 'B2B직납', invoiceDate: '2026-10-31', dueDate: '2026-11-10', billedAmountKrw: 44000000, collectedAmountKrw: 11000000, status: '정상' as const, createdAt: '' }];

  const months = buildMonthlyCashPlan(settlements, payables, [], new Date(2026, 9, 1), 3);
  assert.deepEqual(months.map(m => [m.key, m.confirmedIncoming, m.confirmedOutgoing, m.expectedOutgoing, m.outgoing]), [
    ['2026-10', 0, 6000000, 0, 6000000],
    ['2026-11', 33000000, 20000000, 41000000, 61000000],
    ['2026-12', 0, 0, 11000000, 11000000],
  ]);
  assert.deepEqual(buildPlannedExpenseProjects(payables), [{ id: 'seongsu-1', name: 'LUMEN 성수점', budget: 36000000, planned: 33000000, paid: 5000000, documents: docs }]);

  const confirmedMiddle = payables.map(p => p.id === 'middle' ? { ...p, memo: confirmPlannedExpenseMemo(p.memo)! } : p);
  const november = buildMonthlyCashPlan(settlements, confirmedMiddle, [], new Date(2026, 10, 1), 1)[0];
  assert.equal(november.confirmedOutgoing, 31000000);
  assert.equal(november.expectedOutgoing, 30000000);
  assert.equal(november.outgoing, 61000000);

  const paidMiddle = confirmedMiddle.map(p => p.id === 'middle' ? { ...p, paidAmountKrw: 11000000, status: 'paid' as const } : p);
  assert.equal(buildMonthlyCashPlan(settlements, paidMiddle, [], new Date(2026, 10, 1), 1)[0].outgoing, 50000000);
});
