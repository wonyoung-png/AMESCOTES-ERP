import assert from 'node:assert/strict';
import test from 'node:test';
import { validPayment } from './payable-payment';

test('지급은 양수 금액과 화면이 확인한 누적 지급액을 필수로 받는다', () => {
  assert.equal(validPayment(100, 0), true);
  assert.equal(validPayment(50, 100), true);
  for (const value of [0, -1, NaN, Infinity, '100', null, undefined]) assert.equal(validPayment(value, 0), false);
  for (const value of [-1, NaN, Infinity, '0', null, undefined]) assert.equal(validPayment(100, value), false);
});
