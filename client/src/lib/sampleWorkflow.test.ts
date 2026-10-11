import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleBillable,sampleCompletionMonth} from './sampleWorkflow';
import type {Sample} from './store';
test('billable is completed+accepted+priced+buyer and excludes linked or paid samples',()=>{
  const s={completedAt:'2026-09-30T16:00:00Z',reviewStatus:'accepted',buyerId:'fixture',billingStatus:'미청구',sampleUnitPrice:100} as Sample;
  assert.equal(sampleBillable(s),true);assert.equal(sampleCompletionMonth(s),'2026-10');
  for(const patch of [{completedAt:undefined},{reviewStatus:'pending'},{buyerId:''},{billingStatus:'수금완료'},
    {billingStatementId:'already'},{sampleUnitPrice:NaN},{sampleUnitPrice:-1},{sampleUnitPrice:undefined}])assert.equal(sampleBillable({...s,...patch} as Sample),false);
  assert.equal(sampleBillable({...s,sampleUnitPrice:0}),true);
});
