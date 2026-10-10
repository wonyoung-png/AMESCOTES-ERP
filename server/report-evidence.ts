import { createHash } from 'node:crypto';

export type EvidenceStamp = { version: 1; hash: string; checkedAt: string; complete: boolean; scope: string };
export type Freshness = 'current' | 'changed' | 'unknown';
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

/** Exactly the report's input scope, not a claim that all company data is verified. */
export function reportStamp(team: string, mine: any[], shared: any[], people: any[], stats: unknown,
  status: string, facts: string[], rules: string, today: string): EvidenceStamp {
  const fields = ['id','created_at','created_by','created_by_name','kind','status','team','assignee_id','assignee_name',
    'parsed','raw_text','reply_text','replied_by_name','done_at','done_by_name','confirmed_payload','result_ref','shared_teams'];
  const cards = (rows: any[]) => rows.map(c => ({ id:c.id, ...Object.fromEntries(fields.map(k => [k,c[k] ?? null])),
    campaign: c._campaignEvidence ? { state:c._campaignEvidence.state, current:c._campaignEvidence.current ?? null } : null,
  })).sort((a,b) => String(a.id).localeCompare(String(b.id)));
  const complete = !incomplete(facts) && [...mine,...shared].every(c => !c.confirmed_payload || c._campaignEvidence?.state === 'current');
  return evidenceStamp('team:'+team,{ today, mine:cards(mine),shared:cards(shared),people,stats,status,facts,rules },complete);
}
export function councilStamp(c: { triggerKey:string; topic:string; teams:string[]; evidence:Record<string,string[]> },
  today = new Date(Date.now()+9*3600000).toISOString().slice(0,10)): EvidenceStamp {
  const evidence = Object.fromEntries(Object.entries(c.evidence).map(([team,lines]) => [team,
    lines.map(s => s.replace(/ \(조회 \d{4}-\d{2}-\d{2}T[^)]+\)/g,'')).sort()]));
  return evidenceStamp(c.triggerKey,{today,topic:c.topic,teams:[...c.teams].sort(),evidence},!incomplete(Object.values(evidence).flat()));
}
