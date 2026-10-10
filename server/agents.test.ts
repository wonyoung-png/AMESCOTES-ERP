import assert from 'node:assert/strict';
import test from 'node:test';
import { judge, missingScheduleTeams, completedScheduleTeams, reportTeams, fillScheduleTeams, AgentRunFailure, agentRunResult, type AgentRun } from './agents';
import { dayStartUtc } from './work-records';

test('한국 자정 완료를 포함하고 취소·재개 업무를 완료로 세지 않는다', () => {
  const midnight = dayStartUtc();
  const cards = ['done', 'cancelled', 'open'].map(status => ({ _org: '국내 MD', kind: 'todo', status,
    created_at: midnight, done_at: midnight, parsed: {} }));
  const result = judge('국내 MD', cards, new Set(), '2026-10-09');
  assert.equal(result.stats.doneToday, 1);
  assert.equal(result.stats.newToday, 2);
});

test('팀 에이전트는 하루 1,000건을 잘림 없이 집계한다', () => {
  const now = new Date().toISOString();
  const cards = Array.from({ length: 1000 }, (_, i) => ({
    id: `c${i}`, _org: '국내 MD', kind: 'todo', status: i < 900 ? 'open' : 'done',
    created_at: now, done_at: i < 900 ? null : now, parsed: {},
  }));
  const result = judge('국내 MD', cards, new Set(), '2026-10-09');
  assert.equal(result.stats.total30, 1000);
  assert.equal(result.stats.open, 900);
  assert.equal(result.stats.doneToday, 100);
});

test('일일 점검은 이미 완료된 팀을 제외하고 누락 팀만 찾는다', () => {
  const missing = missingScheduleTeams(['국내 MD', '생산관리']);
  assert.equal(missing.includes('국내 MD'), false);
  assert.equal(missing.includes('생산관리'), false);
  assert.equal(missing.length, 12);
});

test('AI 보고 실패의 규칙 집계는 일일 보고 성공으로 세지 않으며 과거 기록은 호환된다', () => {
  const completed = completedScheduleTeams([
    { team: '국내 MD', stats: { reportAvailable: false } },
    { team: '마케팅', stats: { reportAvailable: true } },
    { team: '생산관리' },
  ]);
  assert.deepEqual(completed, ['마케팅', '생산관리']);
  assert.ok(missingScheduleTeams(completed).includes('국내 MD'));
  assert.ok(!missingScheduleTeams(completed).includes('마케팅'));
});

test('팀 미지정 업무도 생성·일일 보고의 동일 대상이며 대표실·질문·취소는 제외한다', () => {
  const teams = reportTeams([
    {_org:'팀 미지정',kind:'todo',status:'open'},
    {_org:'대표실',kind:'todo',status:'open'},
    {_org:'질문만',kind:'question',status:'done'},
    {_org:'취소만',kind:'todo',status:'cancelled'},
  ]);
  assert.equal(teams.size,15);
  assert.deepEqual(missingScheduleTeams([...teams].filter(t=>t!=='팀 미지정'),teams),['팀 미지정']);
});

test('첫 팀 저장 실패·두 번째 AI 실패 후에도 다음 팀 점검을 계속한다', async () => {
  const called:string[]=[];
  const saved=await fillScheduleTeams(['국내 MD','마케팅','생산관리'],async team=>{
    called.push(team);
    if(team==='국내 MD') throw Error('synthetic store failed');
    return [{team,stats:{reportAvailable:team==='생산관리'}} as AgentRun];
  });
  assert.deepEqual(called,['국내 MD','마케팅','생산관리']);assert.equal(saved,1);
});

test('수동 점검 결과는 저장된 정상 보고·AI 실패·미저장 팀을 분리한다', () => {
  const runs=[{team:'국내 MD',stats:{reportAvailable:true}},{team:'마케팅',stats:{reportAvailable:false}}] as AgentRun[];
  const failure=new AgentRunFailure(runs,['생산관리']);
  const result=agentRunResult(failure.runs,failure.failedTeams);
  assert.equal(result.saved,2);assert.deepEqual(result.reportFailures,['마케팅']);assert.deepEqual(result.saveFailures,['생산관리']);
  assert.equal(result.runs,runs);assert.match(failure.message,/2\/3/);
});
