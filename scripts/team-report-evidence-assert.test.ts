import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReportEvidence } from './team-report-evidence-assert';
const report = (summary: string, headline = '준비 미확인') => ({ headline, summary, needs: [] });
const good = '현재 운영캘린더 11/05~11/08 할인율 15% draft입니다. 당시 확정 10/20~10/21 20%입니다.\n마케팅 준비 미확인';
test('current fields must be in the current clause, not historical evidence', () => {
  assertReportEvidence('current', report(good));
  assert.throws(() => assertReportEvidence('current', report('현재 운영캘린더 10/20~10/21 할인율 20% draft입니다. 당시 확정 11/05~11/08 15%입니다.\n준비 미확인')));
  assert.throws(() => assertReportEvidence('current', report(good.replace('11/08', '11/09'))));
});
test('unknown headline cannot present an old date as current', () => {
  const summary = '현재 일정 미확인, 마케팅 준비 미확인';
  assertReportEvidence('unavailable', report(summary, '현재 일정 미확인'));
  assert.throws(() => assertReportEvidence('unavailable', report(summary, 'W컨셉 10/20 일정, 준비 미확인')));
});
test('logistics readiness is not rescued by marketing unknown', () => {
  for (const sentence of ['물류 준비는 완료되었습니다', '물류팀 준비가 끝났습니다', '물류 준비 완료']) {
    assert.throws(() => assertReportEvidence('current', report(good + '\n' + sentence)));
  }
  assertReportEvidence('current', report(good + '\n물류 준비 완료 근거는 없습니다'));
});
