// 실제 모델 분류만 호출한다. ERP 읽기/쓰기·알림·직원 계정 접근은 하지 않는다.
import assert from 'node:assert/strict';
import { classify, routeFor, type Member } from '../server/work';
import { writeTeamReport } from '../server/agents';

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI credential unavailable');
  const network = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== 'https://api.anthropic.com') throw new Error('Live test blocks all ERP/DB and non-model requests');
    return network(input, init);
  }) as typeof fetch;
  const employee: Member = { id: 'synthetic_staff', name: '테스트 직원', team: '국내 MD', position: '사원',
    role: '사원', email: 'synthetic@test.invalid', profile: 'W컨셉 운영 담당. 기획전 참여는 팀장 확인 필요.' };
  const leader: Member = { ...employee, id: 'synthetic_leader', name: '테스트 팀장', role: '팀장', position: '팀장' };
  const boss: Member = { ...employee, id: 'synthetic_boss', name: '테스트 대표', email: 'wonyoung@atlm.kr',
    role: '대표', position: '대표', profile: '회사 최종 결정권자.' };
  const checks = [
    { text: 'W컨셉 기획전 연락이 왔는데 아직 참여 결정하지 못했습니다. 팀장님 확인이 필요합니다.', me: employee, kind: 'request_check' },
    { text: '제가 대표입니다. 내일까지 W컨셉 기획전 참여 여부를 제가 결정해야 합니다.', me: boss, kind: 'todo' },
    { text: '2026년 10월 20일 W컨셉 기획전 파니에 토트 20% 할인 예정입니다.', me: employee, kind: 'schedule' },
    { text: '29CM 샘플 3개 발송 완료했습니다.', me: employee, kind: 'share' },
    { text: '안녕', me: employee, kind: 'question' },
  ];
  try {
    for (const check of checks) {
      const result = await classify({ text: check.text, me: check.me, open: [] });
      assert.notEqual(result.parsed.answer, '지금은 글을 읽지 못했어요. 잠시 후 다시 써 주세요.', 'Model returned failure fallback');
      assert.equal(result.kind, check.kind, `AI classification mismatch: ${check.kind} -> ${result.kind}`);
      const assigned = routeFor(result.kind, check.me, [employee, leader, boss]);
      if (check.kind === 'request_check') assert.equal(assigned.owner?.id, leader.id);
      if (check.me === boss) assert.equal(assigned.owner?.id, boss.id);
      if (check.kind === 'schedule') {
        assert.equal(result.parsed.startDate, '2026-10-20');
        assert.equal(result.parsed.discountRate, 20);
        assert.ok(result.parsed.shareTeams.includes('마케팅'));
        assert.ok(result.parsed.shareTeams.includes('물류·CS'));
      }
      console.log(JSON.stringify({ scenario: check.kind, actual: result.kind, pass: true }));
    }
    const report = await writeTeamReport('마케팅', [], [employee, leader, boss],
      { open: 0, overdue: 0, alerts: 1 }, 'warn',
      ['마케팅 준비 완료 근거는 아직 없습니다. 대표 확인 필요.'], '', [{
        id: 'synthetic_schedule', created_at: new Date().toISOString(), created_by_name: employee.name,
        team: '국내 MD', kind: 'schedule', status: 'done',
        raw_text: 'W컨셉 파니에 토트 30% 할인 검토',
        confirmed_payload: { title: 'W컨셉 파니에 토트', startDate: '2026-10-20', endDate: '2026-10-20', discountRate: 20 },
        done_by_name: leader.name, shared_teams: ['마케팅'], parsed: {},
      }]);
    assert.ok(report.summary && !report.summary.includes('AI 보고 작성 불가'), 'Report model fallback');
    const reportText = report.headline + '\n' + report.summary + '\n' + report.needs.map((n: { text: string }) => n.text).join('\n');
    console.log(JSON.stringify({ syntheticReport: report }));
    assert.match(reportText, /20\s*%/, 'Final discount missing from report');
    // Mentioning the earlier draft is valid only when explicitly qualified as historical.
    for (const line of reportText.split('\n').filter(line => /30\s*%/.test(line))) {
      assert.match(line, /초안|검토|예정|원문|당초|기존|변경|수정/, 'Unqualified draft discount in report');
      assert.match(line, /20\s*%/, 'Draft discount without final-value correction');
    }
    assert.match(reportText, /미확인|미완료|확인\s*필요|근거.*없|준비.*확인|준비.*필요/, 'Shared schedule was not distinguished from marketing preparation');
    assert.ok(report.needs.every((n: { cardId?: string }) => !n.cardId || n.cardId === 'synthetic_schedule'));
    console.log(JSON.stringify({ scenario: 'team_report_final_evidence', pass: true }));
  } finally { globalThis.fetch = network; }
}

main().catch(error => { console.error(String(error).split('\n')[0]); process.exitCode = 1; });
