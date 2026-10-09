import assert from 'node:assert/strict';
import test from 'node:test';
import { isTeamLeader, routeFor, notify, type Member } from './work';
import { CEO_EMAILS } from './auth';

test('직원은 팀장에게, 팀장은 대표에게, 대표 결정은 본인에게 배정한다', () => {
  const employee: Member = { id: 'staff', name: '직원', team: '국내 MD', position: '사원', role: '사원', email: 'staff@test.invalid', profile: '' };
  const leader: Member = { ...employee, id: 'leader', position: '팀장' };
  const ceo: Member = { ...employee, id: 'ceo', role: '대표', email: CEO_EMAILS[0] };
  const all = [employee, leader, ceo];
  assert.equal(routeFor('request_check', employee, all).owner?.id, 'leader');
  assert.equal(routeFor('request_check', leader, all).owner?.id, 'ceo');
  assert.equal(routeFor('request_check', ceo, all).kind, 'todo');
  assert.equal(routeFor('request_check', ceo, all).owner?.id, 'ceo');
});

test('알림 저장 실패는 이미 저장한 업무를 실패 처리하거나 중복 재입력하게 하지 않는다', async () => {
  const rows = [{ user_id: 'u', card_id: 'c', title: '테스트' }];
  const failure = async () => ({ ok: false, text: async () => 'test failure' }) as Response;
  assert.equal(await notify(rows, failure), false);
  assert.equal(await notify(rows, async () => { throw new Error('test network failure'); }), false);
});

test('업무 확인 요청은 직책 또는 역할이 팀장인 사람에게 간다', () => {
  assert.equal(isTeamLeader({ role: '사원', position: '팀장' }), true);
  assert.equal(isTeamLeader({ role: '생산관리팀장', position: '' }), true);
  assert.equal(isTeamLeader({ role: '팀장', position: '' }), true);
  assert.equal(isTeamLeader({ role: '영업과장', position: '담당자' }), false);
});
