import assert from 'node:assert/strict';
import test from 'node:test';
import { reportHeadline } from './agents';
const uncertain = { confirmed_payload: { title: '테스트 W컨셉', channel: 'W컨셉' }, _campaignEvidence: { state: 'unavailable' } };
test('unknown campaign dates cannot look current in its headline', () => {
  assert.equal(reportHeadline('W컨셉 10/20 일정, 준비 미확인', [uncertain], '마케팅'), '마케팅 · 현재 일정 미확인');
  assert.equal(reportHeadline('W컨셉 20% 행사', [uncertain], '마케팅'), '마케팅 · 현재 일정 미확인');
});
test('unknown shared campaign does not hide other work deadlines', () => {
  assert.equal(reportHeadline('소재 검수 10/12 마감', [uncertain], '마케팅'), '소재 검수 10/12 마감');
  assert.equal(reportHeadline('29CM 10/20 행사', [uncertain], '마케팅'), '29CM 10/20 행사');
  assert.equal(reportHeadline('W컨셉 10/20 행사', [{ ...uncertain, _campaignEvidence: { state: 'current' } }], '마케팅'), 'W컨셉 10/20 행사');
});
