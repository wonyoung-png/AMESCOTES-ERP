// Run: node --import tsx --test scripts/pre-ui-workload.test.ts
// Actual: reportingCards/allRows/countRows, orgOf/isDirective/judge, routeFor,
// schedulePayload, prioritizeCards/cardEvidence and gatherWatch.
// Mock: injected PostgREST readers (preselected fixture rows + HTTP-shaped pages),
// PMS responses and clock. Filters are asserted, NOT evaluated by a cloned SQL engine.
// No HTTP router/auth, DB/RLS, schedule persistence, cancellation write, AI prose,
// financial correctness or browser coverage. Unexpected fetches fail immediately.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { allRows, cardEvidence, countRows, prioritizeCards, reportingCards } from '../server/work-records';
import { isDirective, judge, orgOf } from '../server/agents';
import { routeFor, type Member } from '../server/work';
import { ORG } from '../server/org';
import { gatherWatch } from '../server/watch';
import { schedulePayload } from '../shared/schedule';

const NOW = new Date('2026-10-10T01:00:00.000Z');
const TODAY = '2026-10-10';
const SINCE = '2026-09-10T01:00:00.000Z';
const OLD = '2026-08-01T01:00:00.000Z';
const RECENT = '2026-10-08T01:00:00.000Z';
const BEFORE_MIDNIGHT = '2026-10-09T14:59:59.999Z';
const MIDNIGHT = '2026-10-09T15:00:00.000Z';
const boss: Member = { id: 'ceo', name: '테스트 대표', team: '', position: '대표', role: '대표', email: 'wonyoung@atlm.kr', profile: '' };
const bossIds = new Set([boss.id]);
// All teams represented, including actual organization names used by orgOf.
const roster = [0, 1, 2, 3, 4].flatMap(index => ORG.flatMap(team => {
  const person = team.members[index];
  return person ? [{ id: `employee${ORG.indexOf(team)}x${index}`, name: person.name,
    team: team.key, position: index === 0 ? '팀장' : person.rank,
    role: '직원', email: `fixture${ORG.indexOf(team)}x${index}@example.invalid`, profile: '' }] : [];
})).slice(0, 25) satisfies Member[];

type Card = {
  id: string; created_by: string; created_by_name: string; team: string;
  kind: string; status: string; created_at: string; raw_text: string;
  assignee_id?: string; assignee_name?: string; parsed?: Record<string, any>;
  done_at?: string; done_by_name?: string; reply_text?: string; replied_by_name?: string;
  confirmed_payload?: Record<string, any>; shared_teams?: string[];
};

function fixture() {
  const source: Card[] = [], reportRows: Card[] = [], expectedOwned: string[] = [];
  for (const [employeeIndex, employee] of roster.entries()) {
    for (let cycle = 0; cycle < 4; cycle++) {
      const schedule = schedulePayload({ title: `${employee.team} 파니에 토트 ${cycle}`,
        channel: 'W컨셉', workspace: 'LUMEN', startDate: '2026-10-20', endDate: '2026-10-22',
        discountRate: 15, products: '파니에 토트' });
      const shared = ['마케팅', '물류·CS', employee.team, '마케팅'];
      // Each cycle has 13 source rows, 11 reporting rows, 10 owned business rows.
      // Explicit scenario membership is the oracle; no copy of production filters.
      const scenarios: Partial<Card>[] = [
        { kind: 'todo', status: 'open', created_at: OLD, parsed: { dueDate: '2026-09-01' } },
        { kind: 'todo', status: 'open', parsed: { dueDate: '2026-10-12' } },
        { kind: 'request_check', status: 'open', created_at: OLD, assignee_id: boss.id },
        { kind: 'request_check', status: 'done', created_at: NOW.toISOString(), done_at: MIDNIGHT,
          reply_text: '할인율 15%로 확정', replied_by_name: `${employee.team} 팀장` },
        { kind: 'schedule', status: 'done', done_at: NOW.toISOString(), confirmed_payload: schedule, shared_teams: shared },
        { kind: 'share', status: 'done', created_at: NOW.toISOString(), done_at: NOW.toISOString() },
        { kind: 'schedule', status: 'cancelled', done_at: NOW.toISOString(), shared_teams: shared },
        { kind: 'question', status: 'done', created_at: NOW.toISOString(), shared_teams: shared },
        { kind: 'schedule', status: 'done', created_at: OLD, done_at: OLD, confirmed_payload: schedule, shared_teams: shared },
        { kind: 'share', status: 'done', done_at: BEFORE_MIDNIGHT },
        { kind: 'todo', status: 'done', created_at: OLD, done_at: NOW.toISOString() },
        { kind: 'schedule', status: 'cancelled', created_at: OLD, done_at: OLD, shared_teams: shared },
        { kind: 'todo', status: 'done', done_at: RECENT },
      ];
      scenarios.forEach((scenario, index) => {
        const card: Card = { id: `wc_${String(employeeIndex).padStart(2, '0')}${cycle}${String(index).padStart(2, '0')}`,
          created_by: employee.id, created_by_name: employee.name, team: employee.team,
          kind: 'todo', status: 'open', created_at: RECENT,
          raw_text: `${employee.name} / ${employee.team} / 작업 ${cycle}-${index}${index === 4 || index === 8 ? ' W컨셉 20% 예정' : ''}`,
          assignee_id: employee.id, assignee_name: employee.name, done_by_name: `${employee.team} 팀장`, ...scenario };
        source.push(card);
        if (![7, 11].includes(index)) reportRows.push(card);
        if (![6, 7, 11].includes(index)) expectedOwned.push(card.id);
      });
    }
  }
  reportRows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  return { source, reportRows, expectedOwned };
}

function reader(rows: Card[], calls: string[], failOffset = -1, malformed = false) {
  return async (path: string) => {
    calls.push(path);
    const params = new URLSearchParams(path.split('?')[1]);
    assert.equal(params.get('limit'), '500');
    const offset = Number(params.get('offset'));
    return { ok: offset !== failOffset || malformed, status: offset === failOffset ? 503 : 200,
      json: async () => offset === failOffset && malformed ? { error: 'invalid page' } : structuredClone(rows.slice(offset, offset + 500)) };
  };
}

const tagged = (rows: Card[]) => rows.map(card => ({ ...card, _org: orgOf(card, bossIds), _dir: isDirective(card, bossIds) }));
const ids = (rows: { id: string }[]) => rows.map(row => row.id).sort();

beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const blockedFetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Live network is forbidden in workload regression'); });
  t.after(() => assert.equal(blockedFetch.mock.callCount(), 0, 'no fetch attempt, including swallowed failures'));
});

test('25 employees × 52 records: reporting selects 1,100 rows over three real pages', async () => {
  const { source, reportRows } = fixture();
  assert.equal(roster.length, 25);
  assert.equal(source.length, 1300);
  for (const employee of roster) assert.equal(source.filter(c => c.created_by === employee.id).length, 52);
  const calls: string[] = [];
  const rows = await reportingCards('*', SINCE, reader(reportRows, calls));
  assert.equal(rows.length, 1100);
  assert.deepEqual(ids(rows), ids(reportRows));
  assert.equal(new Set(ids(rows)).size, 1100);
  assert.deepEqual(calls.map(path => Number(new URLSearchParams(path.split('?')[1]).get('offset'))), [0, 500, 1000]);
  for (const path of calls) {
    const params = new URLSearchParams(path.split('?')[1]);
    assert.equal(params.get('kind'), 'neq.question');
    assert.equal(params.get('order'), 'created_at.desc,id.desc');
    assert.equal(params.get('or'), `(created_at.gte.${SINCE},status.eq.open,done_at.gte.${MIDNIGHT},and(kind.eq.schedule,status.eq.done,confirmed_payload->>endDate.gte.${TODAY}))`);
  }
  assert.equal(rows.filter(c => c.created_at === OLD && c.status === 'open').length, 200);
  assert.equal(rows.filter(c => c.created_at === OLD && c.kind === 'schedule').length, 100);
  const total = await countRows('work_cards?select=id&limit=0', async () => ({ ok: true, status: 200,
    headers: { get: () => `*/${reportRows.length}` }, json: async () => { throw new Error('HEAD must not read a body'); } }));
  assert.equal(total, rows.length);
});

test('team totals reconcile to 1,000 unique source IDs; shares never inflate owned work', async () => {
  const { source, reportRows, expectedOwned } = fixture();
  const before = JSON.stringify(source);
  const cards = tagged(await reportingCards('*', SINCE, reader(reportRows, [])));
  const rawCards = tagged(source);
  const owned: Card[] = [];
  for (const team of ORG) {
    const people = roster.filter(employee => employee.team === team.key).length;
    const report = judge(team.key, cards, bossIds, TODAY, undefined, NOW);
    const receivedPeople = ['마케팅', '물류·CS'].includes(team.key) ? 25 - people : 0;
    assert.deepEqual(report.stats, { open: 12 * people, overdue: 4 * people, orders: 0,
      toCeo: 4 * people, newToday: 8 * people, doneToday: 16 * people, total30: 24 * people,
      shared: 8 * receivedPeople, sharedToday: 4 * receivedPeople, alerts: 0 }, team.key);
    assert.equal(report.status, 'warn', team.key);
    assert.equal(report.mine.length, 40 * people);
    const rawReport = judge(team.key, rawCards, bossIds, TODAY, undefined, NOW);
    assert.deepEqual(rawReport.stats, report.stats, 'questions and old/recent cancellations never enter totals');
    assert.deepEqual(ids(rawReport.mine), ids(report.mine));
    assert.deepEqual(ids(rawReport.shared), ids(report.shared));
    assert.equal(report.shared.some(card => report.mine.includes(card)), false);
    assert.ok([...report.mine, ...report.shared].every(c => c.kind !== 'question' && c.status !== 'cancelled'));
    owned.push(...report.mine);
  }
  assert.deepEqual(ids(owned), [...expectedOwned].sort());
  assert.equal(new Set(ids(owned)).size, 1000);
  assert.equal(JSON.stringify(source), before, 'report generation preserves original source records');
});

test('confirmed values, replies and old pending evidence survive sampling without changing totals', () => {
  const { reportRows } = fixture();
  const cards = tagged(reportRows);
  const snapshot = JSON.stringify(cards);
  const sample = prioritizeCards(cards, '', 120);
  assert.equal(sample.length, 120);
  assert.equal(sample.filter(c => c.kind === 'todo' && c.created_at === OLD && c.status === 'open').length, 100);
  const schedules = prioritizeCards(cards, '파니에', 200);
  assert.equal(schedules.length, 200);
  assert.ok(schedules.every(c => c.kind === 'schedule' && c.status === 'done'));
  const byId = new Map(reportRows.map(c => [c.id, c]));
  for (const card of schedules) {
    assert.equal(cardEvidence(card), cardEvidence(byId.get(card.id)!));
    assert.ok(cardEvidence(card).includes(`id=${card.id}`));
    assert.match(cardEvidence(card), /20% 예정/);
    assert.match(cardEvidence(card), /"discountRate":15/);
    assert.match(cardEvidence(card), /확정\(/);
    assert.match(cardEvidence(card), /공유 팀:/);
  }
  for (const card of cards.filter(c => c.reply_text)) assert.match(cardEvidence(card), /답변 .* 팀장: 할인율 15%로 확정/);
  assert.equal(JSON.stringify(cards), snapshot);
  assert.equal(ORG.reduce((sum, team) => sum + judge(team.key, cards, bossIds, TODAY, undefined, NOW).stats.open, 0), 300);
});

test('real roster routing and trusted CEO directives preserve team ownership', () => {
  for (const employee of roster) {
    const leader = roster.find(person => person.team === employee.team && person.position === '팀장')!;
    assert.equal(routeFor('request_check', employee, [...roster, boss]).owner?.id,
      employee.position === '팀장' ? boss.id : leader.id);
  }
  assert.equal(routeFor('request_check', boss, [...roster, boss]).kind, 'todo');
  const directive = { id: 'wc_directive', created_by: boss.id, created_by_name: boss.name, team: '',
    kind: 'todo', status: 'open', created_at: OLD, raw_text: '생산 납기 확인',
    parsed: { directive: { team: '생산관리' }, dueDate: '2026-09-01' } };
  assert.equal(isDirective(directive, bossIds), true);
  assert.equal(orgOf(directive, bossIds), '생산관리');
  const forged = { ...directive, created_by: roster[0].id, created_by_name: roster[0].name, team: roster[0].team };
  assert.equal(isDirective(forged, bossIds), false);
  assert.equal(orgOf(forged, bossIds), roster[0].team);
  const report = judge('생산관리', tagged([directive]), bossIds, TODAY, undefined, NOW);
  assert.equal(report.stats.orders, 1);
  assert.equal(report.stats.overdue, 1);
  assert.match(cardEvidence({ ...directive, _dir: true }), /받을 계정 없음/);
});

test('real watch rules read 200 confirmed schedules; sharing does not complete preparation', async () => {
  const { reportRows } = fixture();
  const schedules = reportRows.filter(c => c.confirmed_payload);
  assert.equal(schedules.length, 200);
  const campaigns = schedules.map(c => ({ id: c.id, title: c.confirmed_payload!.title, channel: c.confirmed_payload!.channel,
    start_date: c.confirmed_payload!.startDate, end_date: c.confirmed_payload!.endDate,
    workspace: c.confirmed_payload!.workspace, status: 'active', tasks: [
      { team: '마케팅', label: '광고 준비', dueDate: '2026-10-09', done: false },
      { team: '물류CS', label: '출고 준비', dueDate: '2026-10-09', done: false },
      { team: '디자인', label: '배너 완료', dueDate: '2026-10-09', done: true },
    ] }));
  const tables: Record<string, any[]> = { campaigns, production_orders: [], receipt_logs: [], samples: [],
    trade_statements: [], settlements: [], payables: [], subscriptions: [] };
  const calls: string[] = [], brands: string[] = [];
  const watch = await gatherWatch(async path => {
    calls.push(path);
    const [table, query] = path.split('?');
    assert.ok(Object.hasOwn(tables, table), `unexpected table: ${table}`);
    const params = new URLSearchParams(query);
    assert.equal(params.get('order'), 'id.asc');
    assert.equal(params.get('limit'), '500');
    const offset = Number(params.get('offset'));
    return { ok: true, status: 200, json: async () => tables[table].slice(offset, offset + 500), text: async () => '' };
  }, async brand => { brands.push(brand); return { sales: { daily30: [] }, inventory: {} }; });
  assert.equal(calls.length, 8);
  assert.deepEqual(brands.sort(), ['aetaloof', 'lumen']);
  assert.equal(watch.get('마케팅')!.alerts, 200);
  assert.equal(watch.get('물류·CS')!.alerts, 200);
  assert.equal(watch.has('루멘 디자인'), false, 'completed design preparation is not escalated');
  assert.match(watch.get('마케팅')!.facts.join('\n'), /30일 안 기획전 200건/);
  assert.ok(watch.get('마케팅')!.facts.some(fact => fact.includes(campaigns[0].title) && fact.includes('광고 준비')));
  const report = judge('마케팅', tagged(reportRows), bossIds, TODAY, watch.get('마케팅'), NOW);
  assert.equal(report.stats.alerts, 200);
  assert.equal(report.stats.open, 12 * roster.filter(e => e.team === '마케팅').length);
  assert.equal(report.status, 'warn');
});

test('a full final page requires an empty sentinel page', async () => {
  const { reportRows } = fixture();
  const calls: string[] = [];
  const rows = await allRows('work_cards?select=*', reader(reportRows.slice(0, 1000), calls));
  assert.equal(rows.length, 1000);
  assert.deepEqual(calls.map(path => new URLSearchParams(path.split('?')[1]).get('offset')), ['0', '500', '1000']);
});

test('late page failure or malformed body rejects the whole workload, never partial success', async () => {
  const { reportRows } = fixture();
  for (const offset of [500, 1000]) {
    await assert.rejects(reportingCards('*', SINCE, reader(reportRows, [], offset)), /503/);
    await assert.rejects(reportingCards('*', SINCE, reader(reportRows, [], offset, true)), /자료 형식 오류/);
  }
});
