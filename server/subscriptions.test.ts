import test from 'node:test';
import assert from 'node:assert/strict';
import { contractNoticeBy, contractNoticeStage, hasNoticeStage, isContractCancellation, isContractRenewal, isPostCancellationPayment, renewalStage, renewContractTerm, rollBillingDate } from './subscriptions.js';

test('notice_by를 계약 종료일과 통보 일수로 계산한다', () => {
  assert.equal(contractNoticeBy('2027-02-05', 45), '2026-12-22');
});

test('D-30과 D-7 단계는 겹치지 않게 선택된다', () => {
  assert.equal(contractNoticeStage('2026-11-23', '2026-12-22'), 'D-30');
  assert.equal(contractNoticeStage('2026-12-15', '2026-12-22'), 'D-7');
  assert.equal(contractNoticeStage('2026-12-16', '2026-12-22'), 'D-7');
  assert.equal(contractNoticeStage('2026-11-21', '2026-12-22'), null);
});

test('같은 구독과 같은 단계는 한 번만 예약한다', () => {
  const checks = [{ subscription_id: 'sub_1', notice_stage: 'D-30' }];
  assert.equal(hasNoticeStage(checks, 'sub_1', 'D-30'), true);
  assert.equal(hasNoticeStage(checks, 'sub_1', 'D-7'), false);
});

test('기한 경과 시 갱신 개월만큼 다음 주기로 이월한다', () => {
  assert.equal(renewContractTerm('2027-02-05', 6), '2027-08-05');
});

test('자동갱신 계약의 안 씀 응답만 해지 요청으로 분류한다', () => {
  assert.equal(isContractCancellation('안 씀', true), true);
  assert.equal(isContractCancellation('안 씀', false), false);
  assert.equal(isContractCancellation('계속 씀', true), false);
});

test('연간 갱신은 D-30과 D-7에 단계별로 감지한다', () => {
  assert.equal(renewalStage('2026-11-01', '2026-12-01'), 'D-30');
  assert.equal(renewalStage('2026-11-24', '2026-12-01'), 'D-7');
  assert.equal(renewalStage('2026-10-31', '2026-12-01'), null);
});

test('연간이면서 계약형이면 계약 통보 감시가 우선한다', () => {
  assert.equal(isContractRenewal({ auto_renew: true, notice_days: 45, notice_by: '2026-12-22' }), true);
  assert.equal(isContractRenewal({ auto_renew: true, notice_days: null, notice_by: null }), false);
});

test('경과한 결제일을 월·연 주기만큼 미래로 이월한다', () => {
  assert.equal(rollBillingDate('2026-08-31', '월', '2026-10-11'), '2026-10-30');
  assert.equal(rollBillingDate('2025-10-10', '연', '2026-10-11'), '2027-10-10');
});

test('해지일 이후 같은 가맹점 결제만 재결제로 감지한다', () => {
  const sub = { merchant_pattern: 'Adobe Inc.', cancel_requested_at: '2026-10-01T02:00:00Z' };
  assert.equal(isPostCancellationPayment(sub, { merchant_key: 'ADOBE INC', approved_on: '2026-10-02' }), true);
  assert.equal(isPostCancellationPayment(sub, { merchant_key: 'ADOBE INC', approved_on: '2026-10-01' }), false);
  assert.equal(isPostCancellationPayment(sub, { merchant_key: 'FIGMA', approved_on: '2026-10-02' }), false);
});
