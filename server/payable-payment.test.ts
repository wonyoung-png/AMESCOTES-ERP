import assert from 'node:assert/strict';
import test from 'node:test';
import { validPayment, validPlannedPayables } from './payable-payment';
import { encodePlannedExpense } from '../client/src/lib/cashPlan';

test('지급은 양수 금액과 화면이 확인한 누적 지급액을 필수로 받는다', () => {
  assert.equal(validPayment(100, 0), true);
  assert.equal(validPayment(50, 100), true);
  for (const value of [0, -1, NaN, Infinity, '100', null, undefined]) assert.equal(validPayment(value, 0), false);
  for (const value of [-1, NaN, Infinity, '0', null, undefined]) assert.equal(validPayment(100, value), false);
});
test('분할 계획지출은 회차·정수 금액·실제 날짜·묶음 ID·증빙을 검증한다',()=>{
  const id='test_plan';
  const row={vendorName:'test',amountKrw:1000,dueDate:'2026-11-10',memo:encodePlannedExpense('LUMEN','인테리어','예상','test',id,'계약금','건설중인자산','과세',2000,[])};
  assert.equal(validPlannedPayables(id,[row,row]),true);
  for(const rows of [[],null,[{...row,amountKrw:NaN}],[{...row,amountKrw:1.5}],[{...row,dueDate:'2026-02-30'}],[{...row,vendorName:''}],[{...row,memo:row.memo.replace('test_plan','different')}],[{...row,memo:row.memo.replace('예상','확정')}]]) assert.equal(validPlannedPayables(id,rows),false);
  assert.equal(validPlannedPayables('bad/id',[row]),false);
});
