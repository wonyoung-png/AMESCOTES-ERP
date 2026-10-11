import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentSchedulerTick } from './agent-scheduler';

const morning = new Date('2026-10-10T23:30:00.000Z'); // KST 10/11 08:30

test('08:29에는 조회하지 않고 08:30부터 한국 날짜의 기록을 조회한다', async () => {
  const starts: string[] = [], fills: string[][] = [];
  const tick = createAgentSchedulerTick({ completed: async start => { starts.push(start); return []; },
    targets: async () => ['MD'], fill: async teams => { fills.push(teams); return teams.length; } });
  await tick(new Date(morning.getTime() - 1));
  assert.deepEqual(starts, []);
  await tick(morning);
  assert.deepEqual(starts, ['2026-10-10T15:00:00.000Z']);
  assert.deepEqual(fills, [['MD']]);
});

test('오늘 성공한 팀은 다시 생성하지 않고 실패·누락 팀만 재시도한다', async () => {
  const done = new Set<string>(), fills: string[][] = [];
  const tick = createAgentSchedulerTick({ completed: async () => [...done], targets: async () => ['MD', '마케팅'],
    fill: async teams => { fills.push(teams); done.add(teams[0]); return 1; } });
  await tick(morning); await tick(morning); await tick(morning);
  assert.deepEqual(fills, [['MD', '마케팅'], ['마케팅']]);
});

test('첫 조회가 느릴 때 겹친 tick은 중복 보고를 생성하지 않는다', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let queries = 0, fills = 0;
  const tick = createAgentSchedulerTick({ completed: async () => { queries++; await gate; return []; },
    targets: async () => ['MD'], fill: async () => { fills++; return 1; } });
  const first = tick(morning), second = tick(morning);
  release(); await Promise.all([first, second]);
  assert.equal(queries, 1); assert.equal(fills, 1);
});

test('조회 실패를 빈 성공 목록으로 처리하지 않으며 다음 tick은 복구한다', async () => {
  let fail = true, fills = 0;
  const tick = createAgentSchedulerTick({ completed: async () => { if (fail) throw Error('DB unavailable'); return []; },
    targets: async () => ['MD'], fill: async () => { fills++; return 1; } });
  await assert.rejects(tick(morning), /DB unavailable/); assert.equal(fills, 0);
  fail = false; await tick(morning); assert.equal(fills, 1);
});

test('보고 작성·저장 중에도 잠금이 유지되고 완료 후 다시 조회할 수 있다', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let began!: () => void;
  const entered = new Promise<void>(resolve => { began = resolve; });
  let queries = 0, fills = 0;
  const done: string[] = [];
  const tick = createAgentSchedulerTick({ completed: async () => { queries++; return done; }, targets: async () => ['MD'],
    fill: async () => { fills++; began(); await gate; done.push('MD'); return 1; } });
  const first = tick(morning); await entered;
  await tick(morning); assert.equal(queries, 1);
  release(); await first; await tick(morning);
  assert.equal(queries, 2); assert.equal(fills, 1);
});

test('저장 실패 후 잠금이 풀려 다음 tick이 같은 누락 팀을 재시도한다', async () => {
  let fail = true, fills = 0;
  const tick = createAgentSchedulerTick({ completed: async () => [], targets: async () => ['MD'],
    fill: async () => { fills++; if (fail) throw Error('store unavailable'); return 1; } });
  await assert.rejects(tick(morning), /store unavailable/);
  fail = false; await tick(morning); assert.equal(fills, 2);
});

test('자정에는 실행하지 않으며 다음날 아침은 새 한국 날짜로 조회한다', async () => {
  const starts: string[] = [];
  const tick = createAgentSchedulerTick({ completed: async start => { starts.push(start); return ['MD']; },
    targets: async () => ['MD'], fill: async () => { throw Error('must not run'); } });
  await tick(new Date('2026-10-11T15:00:00Z'));
  await tick(new Date('2026-10-11T23:30:00Z'));
  assert.deepEqual(starts, ['2026-10-11T15:00:00.000Z']);
});

test('조회가 응답하지 않아도 취소 신호를 보내고 다음 tick이 복구한다', async () => {
  let hang = true, signal: AbortSignal | undefined, fills = 0;
  const tick = createAgentSchedulerTick({ completed: async (_start, supplied) => {
    signal = supplied;
    if (hang) return new Promise<string[]>(() => {});
    return [];
  }, targets: async () => ['MD'], fill: async () => { fills++; return 1; } }, 10);
  await assert.rejects(tick(morning), /schedule_read_timeout/);
  assert.equal(signal?.aborted, true); assert.equal(fills, 0);
  hang = false; await tick(morning); assert.equal(fills, 1);
});

test('대상 조회 제한시간 후 늦은 응답으로 보고를 쓰지 않는다', async () => {
  let release!: (teams: string[]) => void, hang = true, fills = 0;
  const pending = new Promise<string[]>(resolve => { release = resolve; });
  const tick = createAgentSchedulerTick({ completed: async () => [], targets: async () => hang ? pending : ['MD'],
    fill: async () => { fills++; return 1; } }, 10);
  await assert.rejects(tick(morning), /schedule_read_timeout/);
  hang = false; await tick(morning); release(['MD']); await Promise.resolve();
  assert.equal(fills, 1);
});
