type Actor = { id: string; team: string; isBoss: boolean; isLeader: boolean };
export type WorkCursor = { created_at: string; id: string };

/** 개인 질문과 직원 조회 권한을 페이지·전체 숫자 모두 같은 AND 조건으로 적용한다. */
function filter(conditions: string[], visibility: string) {
  const visible = new URLSearchParams(visibility).get('or');
  if (visible) conditions.push(`or${visible}`);
  return `and=${encodeURIComponent(`(${conditions.join(',')})`)}`;
}

export function workPageQuery(me: Actor, visibility: string, before?: WorkCursor) {
  const conditions = [`or(kind.neq.question,created_by.eq.${JSON.stringify(me.id)})`];
  if (before) {
    if (!/^wc_[a-z0-9]{1,40}$/.test(before.id) || typeof before.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(before.created_at) || !Number.isFinite(Date.parse(before.created_at))) throw new Error('invalid_cursor');
    conditions.push(`or(created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id}))`);
  }
  return `work_cards?select=*&order=created_at.desc,id.desc&limit=200&${filter(conditions, visibility)}`;
}

export function workCountQueries(me: Actor, visibility: string, teamConditions?: {own:string;other:string}) {
  const id = JSON.stringify(me.id), team = JSON.stringify(me.team);
  const schedule = me.isBoss ? 'kind.eq.schedule' : `and(kind.eq.schedule,or(created_by.eq.${id}${me.isLeader && me.team ? `,team.eq.${team}` : ''}))`;
  const todo = `and(status.eq.open,or(assignee_id.eq.${id},${schedule}))`;
  const unread = `and(created_by.neq.${id},read_by.not.cs.{${id}})`;
  const query = (...conditions: string[]) => `work_cards?select=id&limit=0&${filter(['kind.neq.question', ...conditions], visibility)}`;
  return { attention: query(`or(${unread},${todo})`), todo: query(todo), unread: query(unread),
    teamUnread: query(unread, teamConditions?.own || `team.eq.${team}`), sharedUnread: query(unread, teamConditions?.other || `team.neq.${team}`, `shared_teams.cs.{${team}}`) };
}

export function notificationReadIds(input: unknown): string[] {
  if (!Array.isArray(input) || !input.length || input.length > 30 || input.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new Error('bad_ids');
  return [...new Set(input)];
}
