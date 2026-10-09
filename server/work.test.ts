import assert from 'node:assert/strict';
import test from 'node:test';
import { isTeamLeader } from './work';

test('업무 확인 요청은 직책 또는 역할이 팀장인 사람에게 간다', () => {
  assert.equal(isTeamLeader({ role: '사원', position: '팀장' }), true);
  assert.equal(isTeamLeader({ role: '생산관리팀장', position: '' }), true);
  assert.equal(isTeamLeader({ role: '팀장', position: '' }), true);
  assert.equal(isTeamLeader({ role: '영업과장', position: '담당자' }), false);
});
