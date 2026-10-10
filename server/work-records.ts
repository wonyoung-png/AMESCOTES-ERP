import { restAsServer } from './auth.js';

type Reader = (path: string) => Promise<{ ok: boolean; status: number; headers?: Pick<Headers, 'get'>; json(): Promise<any> }>;

export const dayStartUtc = (now = new Date()) => new Date(new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00+09:00').toISOString();

export async function readRows(query: string, read: Reader = restAsServer): Promise<any[]> {
  const r = await read(query);
  if (!r.ok) throw new Error(`자료 조회 실패 (${r.status})`);
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error('자료 형식 오류');
  return rows;
}

/** 목록 한도와 무관한 전체 건수. 자료 본문은 내려받지 않는다. */
export async function countRows(query: string, read: Reader = path => restAsServer(path, { method: 'HEAD', headers: { Prefer: 'count=exact' } })): Promise<number> {
  const r = await read(query);
  if (!r.ok) throw new Error(`건수 조회 실패 (${r.status})`);
  const total = r.headers?.get('content-range')?.split('/')[1];
  if (!total || !/^\d+$/.test(total) || !Number.isSafeInteger(Number(total))) throw new Error('전체 건수 확인 불가');
  return Number(total);
}

export async function allRows(query: string, read: Reader = restAsServer): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await readRows(`${query}&limit=500&offset=${offset}`, read);
    out.push(...page);
    if (page.length < 500) return out;
  }
}

/** 최근 기록·미결·오늘 처리·앞으로의 확정 일정. 숫자 집계와 AI 표본은 분리한다. */
export async function reportingCards(select: string, since: string, read: Reader = restAsServer) {
  const completedSince = dayStartUtc();
  const today = new Date(Date.parse(completedSince) + 9 * 3600e3).toISOString().slice(0, 10);
  const condition = `or=(created_at.gte.${since},status.eq.open,done_at.gte.${completedSince},and(kind.eq.schedule,status.eq.done,confirmed_payload->>endDate.gte.${today}))`;
  return allRows(`work_cards?kind=neq.question&${condition}&select=${select}&order=created_at.desc,id.desc`, read);
}

export function prioritizeCards(cards: any[], question = '', limit = 120): any[] {
  const terms = question.match(/[\p{L}\p{N}]{2,}/gu) || [];
  const score = (c: any) => {
    const text = cardEvidence(c).toLowerCase();
    return terms.reduce((n, t) => n + (text.includes(t.toLowerCase()) ? 20 : 0), 0)
      + (c.status === 'open' ? 4 : 0) + (c._dir ? 3 : 0)
      + (c.status === 'open' && c.parsed?.dueDate && c.parsed.dueDate < new Date().toISOString().slice(0, 10) ? 5 : 0);
  };
  return [...cards].sort((a, b) => score(b) - score(a) || String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
}

/** 사용자가 볼 수 있는 과거 근거만 검색한다. 날짜 제한으로 미결·과거 결정을 잘라내지 않는다. */
export async function searchCards(question: string, visibility = '', read: Reader = restAsServer): Promise<any[]> {
  const terms = [...new Set(question.match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 8);
  if (!terms.length) return [];
  const fields = ['raw_text', 'reply_text', 'confirmed_payload->>title', 'confirmed_payload->>channel', 'confirmed_payload->>products'];
  const condition = terms.flatMap(t => fields.map(field => `${field}.ilike.*${t}*`)).join(',');
  const visible = new URLSearchParams(visibility).get('or');
  const filter = visible ? `and=${encodeURIComponent(`(or(${condition}),or${visible})`)}` : `or=${encodeURIComponent(`(${condition})`)}`;
  return readRows(`work_cards?kind=neq.question&${filter}&select=*&order=created_at.desc,id.desc&limit=200`, read);
}

/** 직원 질문·팀 보고·대표 질문이 같은 확정 근거를 읽는다. 원문은 삭제하지 않는다. */
export function cardEvidence(c: any): string {
  return `- id=${c.id || '-'} ${String(c.created_at || '').slice(0, 10)} ${c.created_by_name || '-'}(${c.team || '-'}) [${c.kind}/${c.status}] ${c.raw_text || ''}` +
    (c._dir ? ` (대표 지시${c.assignee_name ? '→' + c.assignee_name : ', 받을 계정 없음'})` : '') +
    (c.parsed?.dueDate ? ` (마감 ${c.parsed.dueDate})` : '') +
    (c.reply_text ? ` → 답변 ${c.replied_by_name || c.done_by_name || '-'}: ${c.reply_text}` : '') +
    (c.confirmed_payload ? ` → 확정(${c.done_by_name || '-'}): ${JSON.stringify(c.confirmed_payload)}` : '') +
    (Array.isArray(c.shared_teams) && c.shared_teams.length ? ` → 공유 팀: ${c.shared_teams.join(', ')}` : '');
}
