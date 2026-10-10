import { ORG } from './org.js';

type Actor = { id: string; team: string; isBoss: boolean };
const teams = ORG.map(t => t.key);
const list = (values: string[]) => '(' + values.map(v => JSON.stringify(v)).join(',') + ')';

export function effectiveWorkTeam(card: any, bossIds: string[]): string {
  const team = card.parsed?.directive?.team;
  return bossIds.includes(card.created_by) && teams.includes(team) ? team : card.team;
}

/** Legacy directives use their validated target team without rewriting history. */
export function workTeamCondition(team: string, bossIds: string[], op: 'eq' | 'neq' = 'eq'): string {
  if (!bossIds.length) return `team.${op}.${JSON.stringify(team)}`;
  const field = 'parsed->directive->>team';
  const valid = `created_by.in.${list(bossIds)},${field}.in.${list(teams)}`;
  const invalid = `or(created_by.not.in.${list(bossIds)},${field}.is.null,${field}.not.in.${list(teams)})`;
  return `or(and(${valid},${field}.${op}.${JSON.stringify(team)}),and(${invalid},team.${op}.${JSON.stringify(team)}))`;
}

export function workVisibility(me: Actor, bossIds: string[]): string {
  if (me.isBoss) return '';
  const id = JSON.stringify(me.id), team = JSON.stringify(me.team);
  return '&or=' + encodeURIComponent(`(created_by.eq.${id},assignee_id.eq.${id}`
    + (me.team ? `,${workTeamCondition(me.team,bossIds)},shared_teams.cs.{${team}}` : '') + ')');
}
