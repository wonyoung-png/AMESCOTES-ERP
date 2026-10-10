import { restAsServer } from './auth.js';

type Reader = (path: string) => Promise<{ ok: boolean; json(): Promise<any> }>;
const SELECT = 'id,title,channel,start_date,end_date,status,discount_rate,workspace,product_discounts,category_discounts,updated_at';
const linkedId = (c: any): string | undefined => c.confirmed_payload && c.result_ref?.table === 'campaigns'
  && typeof c.result_ref.id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(c.result_ref.id) ? c.result_ref.id : undefined;

/** Only look up campaigns linked to cards already authorized for this reader. */
export async function attachCampaignEvidence(cards: any[], read: Reader = restAsServer): Promise<any[]> {
  const ids = [...new Set(cards.map(linkedId).filter((id): id is string => !!id))];
  const checkedAt = new Date().toISOString();
  const states = new Map<string, any>();
  for (let offset = 0; offset < ids.length; offset += 80) {
    const batch = ids.slice(offset, offset + 80);
    try {
      const response = await read(`campaigns?id=in.(${batch.join(',')})&select=${SELECT}&limit=${batch.length}`);
      if (!response.ok) throw new Error('campaign_read_failed');
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.some(c => !batch.includes(c?.id) || typeof c.updated_at !== 'string' || !c.updated_at)
        || new Set(rows.map(c => c.id)).size !== rows.length) throw new Error('campaign_read_invalid');
      for (const id of batch) {
        const current = rows.find(c => c.id === id);
        states.set(id, { state: current ? 'current' : 'missing', checkedAt, ...(current ? { current } : {}) });
      }
    } catch {
      for (const id of batch) states.set(id, { state: 'unavailable', checkedAt });
    }
  }
  return cards.map(c => {
    const id = linkedId(c);
    return { ...c, _campaignEvidence: c.confirmed_payload
      ? id ? states.get(id) : { state: 'unlinked', checkedAt } : undefined };
  });
}

export const CAMPAIGN_EVIDENCE_RULES = `업무 카드의 확정값은 당시 결정 기록이며, 연결된 운영캘린더의 현재 상태와 구분한다.
현재 일정·할인율·상태를 묻거나 보고할 때는 연결된 현재 캘린더 값이 우선한다. 과거 확정값을 현재 값처럼 말하지 마라.
현재 항목이 없거나 조회 불가·연결 미확인이면 최신 상태 미확인이라고 말한다. 삭제·취소·진행 여부를 추측하지 마라.
캘린더 마감/closed, 일정 확정, 팀별 준비 완료는 서로 다르다. 원천 조회시각 이후 변경까지 확인했다고 말하지 마라.`;

export function campaignEvidence(c: any): string {
  if (!c.confirmed_payload) return '';
  const e = c._campaignEvidence;
  const stamp = e?.checkedAt ? ` (조회 ${e.checkedAt})` : '';
  if (e?.state === 'current') {
    const r = e.current;
    return ` → 연결된 현재 운영캘린더${stamp}: ${JSON.stringify({ id: r.id, title: r.title,
      workspace: r.workspace, channel: r.channel, startDate: r.start_date, endDate: r.end_date,
      status: r.status, discountRate: r.discount_rate, productDiscounts: r.product_discounts,
      categoryDiscounts: r.category_discounts, updatedAt: r.updated_at })}`;
  }
  const label = e?.state === 'missing' ? '현재 캘린더 항목 없음 — 삭제·미등록 사유 미확인'
    : e?.state === 'unavailable' ? '최신 캘린더 조회 실패 — 현재 상태 미확인'
    : '연결 정보 없음 — 현재 상태 미확인';
  return ` → ${label}${stamp}`;
}
