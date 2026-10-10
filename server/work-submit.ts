import { readRows } from './work-records.js';
import { restAsServer } from './auth.js';

/** 통신 재시도는 같은 업무를 반환한다. 남의 업무·바뀐 원문은 재사용하지 않는다. */
export async function submittedWork(id: string, authorId: string, text: string, read = restAsServer) {
  const rows = await readRows(`work_cards?id=eq.${encodeURIComponent(id)}&created_by=eq.${encodeURIComponent(authorId)}&select=*&limit=1`, read);
  const card = rows[0];
  if (card && card.raw_text !== text) throw new Error('request_conflict');
  return card || null;
}
