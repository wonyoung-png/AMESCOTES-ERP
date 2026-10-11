import assert from 'node:assert/strict';

type Report = { headline: string; summary: string | null; needs: Array<{ text: string }> };
export function assertReportEvidence(scenario: string, report: Report) {
  const text = [report.headline, report.summary, ...report.needs.map(n => n.text)].join('\n');
  if (scenario === 'current' || scenario === 'closed') {
    // Only an explicitly CURRENT calendar clause can satisfy current-value checks.
    // Historical clauses must never rescue incorrect current facts.
    const current = (report.summary || '').split(/\n|[。]/).flatMap(line => line.split(/당시|과거|기존|초기 확정/))
      .filter(part => /현재\s*(?:운영)?캘린더/.test(part)).join('\n');
    assert.match(current, /15\s*%/, 'Current discount missing');
    assert.doesNotMatch(current, /(?:20|30)\s*%/, 'Historical discount presented as current');
    assert.match(current, /11[월./-]\s*0?5/, 'Current start date missing');
    assert.match(current, /(?:11[월./-]\s*0?8|[~～–-]\s*0?8(?:일|\b))/, 'Current end date missing');
    assert.match(current, scenario === 'closed' ? /종료|closed/ : /초안|draft/);
  }
  if (scenario === 'missing' || scenario === 'unavailable') {
    assert.match(report.headline, /미확인|확인.*불가/);
    assert.doesNotMatch(report.headline, /\d+\s*%|\d+[월./-]\s*\d+/, 'Unknown headline cannot show historical values');
    assert.match(text, /현재.*(?:미확인|확인.*(?:불가|필요)|없|실패)|최신.*(?:실패|미확인)/);
    assert.doesNotMatch(text, /(?:현재|최종)\s*(?:할인율|할인).*20\s*%/);
  }
  if (scenario === 'done') assert.match(text, /BLUE_FINAL/);
  else assert.match(text, /준비.*미확인|준비.*기록.*없|준비.*근거.*없/);
  for (const clause of text.split(/[\n.!?。]/)) {
    if (/물류[^\n]*준비[^\n]*(?:완료|끝|ready)/i.test(clause)) {
      assert.match(clause, /미확인|확인.*(?:불가|필요)|(?:근거|기록).*없|뜻하지|아니|않|미완료/, 'Unsupported logistics readiness');
    }
  }
}
