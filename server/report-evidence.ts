import { createHash } from 'node:crypto';
import { restAsServer } from './auth.js';

export type EvidenceStamp = { version: 1; hash: string; checkedAt: string; complete: boolean; scope: string };
export type Freshness = 'current' | 'changed' | 'unknown';
export function shopReportFreshness(report: any, now = Date.now()): Freshness {
  const evidence = report?.stats?.evidence;
  const age = now - Date.parse(evidence?.checkedAt);
  return report?.model === 'rule-based' && report?.stats?.reportAvailable === true
    && report.stats.complete === true && evidence?.complete === true
    && /^[a-f0-9]{64}$/.test(evidence?.hash || '') && age >= 0 && age < 25 * 3600e3
    ? 'current' : 'unknown';
}
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const incomplete = (lines: string[]) => lines.some(s => /조회 실패|현재 상태 미확인|판단 보류|데이터가 아직 없음|원화 값이 비어 있음/.test(s));
export function evidenceStamp(scope: string, data: unknown, complete = true): EvidenceStamp {
  return { version: 1, hash: createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex'),
    checkedAt: new Date().toISOString(), complete, scope };
}
export function evidenceFreshness(saved: any, current?: EvidenceStamp): Freshness {
  if (saved?.version !== 1 || !/^[a-f0-9]{64}$/.test(saved.hash || '') || !current?.complete || saved.scope !== current.scope) return 'unknown';
  if (saved.hash !== current.hash) return 'changed';
  return saved.complete === true ? 'current' : 'unknown';
}

const isSampleCard = (c: any) => c.parsed?.sampleReview === true || c.result_ref?.table === 'samples';
type SampleReader = (path: string) => Promise<{ ok: boolean; json(): Promise<any> }>;
const SAMPLE_SELECT = 'id,style_id,style_no,style_name,buyer_id,brand_code,stage,completed_at,completed_by,review_status,review_assignee_id,review_card_id,accepted_at,accepted_by,approved_by,sample_unit_price,billing_status,billing_statement_id,billing_date,collected_date,workflow_version,updated_at';

/** Call on the already-authorized report cards, before reportStamp, on every source refresh. */
export async function attachSampleEvidence(cards: any[], read: SampleReader = restAsServer): Promise<any[]> {
  const linkedId = (c: any): string | undefined => isSampleCard(c) && c.result_ref?.table === 'samples'
    && typeof c.result_ref.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(c.result_ref.id)
    && c.parsed?.sampleId === c.result_ref.id
    && (!c.confirmed_payload || c.confirmed_payload.sampleId === c.result_ref.id) ? c.result_ref.id : undefined;
  const ids = [...new Set(cards.map(linkedId).filter((id): id is string => !!id))];
  const states = new Map<string, any>();
  const checkedAt = new Date().toISOString();
  for (let offset = 0; offset < ids.length; offset += 80) {
    const batch = ids.slice(offset, offset + 80);
    try {
      const response = await read(`samples?id=in.(${batch.join(',')})&select=${SAMPLE_SELECT}&limit=${batch.length}`);
      if (!response.ok) throw new Error('sample_read_failed');
      const rows = await response.json();
      if (!Array.isArray(rows) || new Set(rows.map(r => r?.id)).size !== rows.length
        || rows.some(r => !batch.includes(r?.id) || typeof r.updated_at !== 'string' || !r.updated_at
          || !Number.isInteger(r.workflow_version) || r.workflow_version < 0)) throw new Error('sample_read_invalid');
      for (const id of batch) {
        const current = rows.find(r => r.id === id);
        states.set(id, { state: current ? 'current' : 'missing', checkedAt, ...(current ? { current } : {}) });
      }
    } catch {
      for (const id of batch) states.set(id, { state: 'unavailable', checkedAt });
    }
  }
  return cards.map(c => {
    if (!isSampleCard(c)) return c;
    const id = linkedId(c);
    let evidence = id ? states.get(id) : { state: 'unlinked', checkedAt };
    const row = evidence?.current;
    if (row && (row.review_card_id !== c.id || row.review_assignee_id !== c.assignee_id || !row.completed_at
      || (c.status === 'done' ? row.review_status !== 'accepted' || !row.accepted_at || !row.accepted_by
        : c.status !== 'open' || row.review_status !== 'pending'))) evidence = { state: 'mismatch', checkedAt };
    return { ...c, _sampleEvidence: evidence };
  });
}

export function sampleEvidence(c: any): string {
  if (!isSampleCard(c)) return '';
  return c._sampleEvidence?.state === 'current'
    ? ` → 현재 원본 샘플: ${JSON.stringify(c._sampleEvidence.current)}`
    : ' → 샘플 원본 현재 상태 미확인 — 조회 실패·연결·수락 기록 확인 필요';
}

/** Exactly the report's input scope, not a claim that all company data is verified. */
export function reportStamp(team: string, mine: any[], shared: any[], people: any[], stats: unknown,
  status: string, facts: string[], rules: string, today: string): EvidenceStamp {
  const fields = ['id','created_at','created_by','created_by_name','kind','status','team','assignee_id','assignee_name',
    'parsed','raw_text','reply_text','replied_by_name','done_at','done_by_name','confirmed_payload','result_ref','shared_teams'];
  const cards = (rows: any[]) => rows.map(c => ({ id:c.id, ...Object.fromEntries(fields.map(k => [k,c[k] ?? null])),
    campaign: !isSampleCard(c) && c._campaignEvidence ? { state:c._campaignEvidence.state, current:c._campaignEvidence.current ?? null } : null,
    ...(isSampleCard(c) ? { sample: c._sampleEvidence ? { state:c._sampleEvidence.state, current:c._sampleEvidence.current ?? null } : null } : {}),
  })).sort((a,b) => String(a.id).localeCompare(String(b.id)));
  const complete = !incomplete(facts) && [...mine,...shared].every(c => isSampleCard(c)
    ? c._sampleEvidence?.state === 'current' : !c.confirmed_payload || c._campaignEvidence?.state === 'current');
  return evidenceStamp('team:'+team,{ today, mine:cards(mine),shared:cards(shared),people,stats,status,facts,rules },complete);
}
export function councilStamp(c: { triggerKey:string; topic:string; teams:string[]; evidence:Record<string,string[]> },
  today = new Date(Date.now()+9*3600000).toISOString().slice(0,10)): EvidenceStamp {
  const evidence = Object.fromEntries(Object.entries(c.evidence).map(([team,lines]) => [team,
    lines.map(s => s.replace(/ \(조회 \d{4}-\d{2}-\d{2}T[^)]+\)/g,'')).sort()]));
  return evidenceStamp(c.triggerKey,{today,topic:c.topic,teams:[...c.teams].sort(),evidence},!incomplete(Object.values(evidence).flat()));
}
