import assert from 'node:assert/strict';
import test from 'node:test';
import {effectiveWorkTeam,workVisibility,workTeamCondition} from './work-visibility';

test('only validated CEO directives override legacy routing, without mutating saved rows',()=>{
  const c={created_by:'boss',team:'국내 MD',parsed:{directive:{team:'마케팅'}}};
  assert.equal(effectiveWorkTeam(c,['boss']),'마케팅');assert.equal(c.team,'국내 MD');
  assert.equal(effectiveWorkTeam({...c,created_by:'staff'},['boss']),'국내 MD');
  assert.equal(effectiveWorkTeam({...c,parsed:{directive:{team:'unknown'}}},['boss']),'국내 MD');
});

test('feed/AI/read visibility and team counts share the same validated team predicate',()=>{
  const me={id:'worker',team:'마케팅',isBoss:false};
  const condition=new URLSearchParams(workVisibility(me,['boss'])).get('or');
  assert.ok(condition?.includes(workTeamCondition(me.team,['boss'])));
  assert.ok(condition?.includes('created_by.in.("boss")'));
  assert.ok(condition?.includes('parsed->directive->>team.is.null'));
  assert.equal(workVisibility({...me,isBoss:true},['boss']),'');
  assert.equal(workTeamCondition('마케팅',[]),'team.eq."마케팅"');
});
