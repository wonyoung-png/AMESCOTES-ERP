import { restAsServer } from './auth.js';

type Reader = (path: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export const dayStartUtc = (now = new Date()) => new Date(new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00+09:00').toISOString();

export async function allRows(query: string, read: Reader = restAsServer): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await read(`${query}&limit=500&offset=${offset}`);
    if (!r.ok) throw new Error(`자료 조회 실패 (${r.status})`);
    const page = await r.json();
    if (!Array.isArray(page)) throw new Error('자료 형식 오류');
    out.push(...page);
    if (page.length < 500) return out;
  }
}

/** 최근 기록 + 오래된 미결 + 오늘 처리한 오래된 건. 숫자 집계와 AI 표본은 분리한다. */
export async function reportingCards(select: string, since: string, read: Reader = restAsServer) {
  const completedSince = dayStartUtc();
  const condition = `or=(created_at.gte.${since},status.eq.open,done_at.gte.${completedSince})`;
  return allRows(`work_cards?kind=neq.question&${condition}&select=${select}&order=created_at.desc,id.desc`, read);
}

export function prioritizeCards(cards: any[], question = '', limit = 120): any[] {
  const terms = question.match(/[\p{L}\p{N}]{2,}/gu) || [];
  const score = (c: any) => {
    const text = `${c.raw_text || ''} ${c.reply_text || ''}`.toLowerCase();
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
  const condition = terms.flatMap(t => [`raw_text.ilike.*${t}*`, `reply_text.ilike.*${t}*`]).join(',');
  const visible = new URLSearchParams(visibility).get('or');
  const filter = visible ? `and=${encodeURIComponent(`(or(${condition}),or${visible})`)}` : `or=${encodeURIComponent(`(${condition})`)}`;
  const r = await read(`work_cards?kind=neq.question&${filter}&select=*&order=created_at.desc,id.desc&limit=200`);
  if (!r.ok) throw new Error(`과거 자료 검색 실패 (${r.status})`);
  return r.json();
}
