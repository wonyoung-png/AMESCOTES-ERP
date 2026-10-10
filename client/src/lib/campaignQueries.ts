// 기획전 서버 저장.
//
// Local cache is optimistic; changed rows require their acknowledged server version.
import { db } from './db';
import { filterForTable } from './tableColumns';
import { createCampaignSync, sameCampaign } from './campaignSync';
import { toast } from 'sonner';

const toRow = (c: any) => filterForTable('campaigns', {
  id: c.id,
  workspace: c.workspace,
  title: c.title,
  channel: c.channel,
  start_date: c.startDate || null,
  end_date: c.endDate || null,
  status: c.status,
  discount_rate: c.discountRate ?? null,
  owner: c.owner,
  project_id: c.projectId || null,
  onboarded_at: c.onboardedAt || null,
  // 팀 업무·상품별/카테고리별 할인율은 기획전에 딸린 값이라 통째로 담는다
  tasks: c.tasks || [],
  product_discounts: c.productDiscounts || [],
  category_discounts: c.categoryDiscounts || [],
  updated_at: c.updatedAt,
});

const fromRow = (r: any) => ({
  id: r.id, workspace: r.workspace, title: r.title, channel: r.channel,
  startDate: r.start_date || '', endDate: r.end_date || '',
  status: r.status, discountRate: r.discount_rate ?? undefined,
  owner: r.owner || undefined, projectId: r.project_id || undefined,
  onboardedAt: r.onboarded_at || undefined,
  tasks: Array.isArray(r.tasks) ? r.tasks : [],
  productDiscounts: Array.isArray(r.product_discounts) ? r.product_discounts : undefined,
  categoryDiscounts: Array.isArray(r.category_discounts) ? r.category_discounts : undefined,
  createdAt: r.created_at || '', updatedAt: r.updated_at || '',
});

export async function fetchCampaignsSB(): Promise<any[]> {
  const { data, error } = await db.from('campaigns').select('*');
  if (error) throw error;
  return (data || []).map(fromRow);
}

function replaceIfCurrent(submitted: any, replacement?: any) {
  const current = JSON.parse(localStorage.getItem('ames_campaigns') || '[]') as any[];
  if (!sameCampaign(current.find(c => c.id === submitted.id), submitted)) return;
  const next = current.filter(c => c.id !== submitted.id);
  if (replacement) next.push(replacement);
  localStorage.setItem('ames_campaigns', JSON.stringify(next));
  window.dispatchEvent(new Event('campaigns:changed'));
}

export const pushCampaigns = createCampaignSync(async (next, previous) => {
  if (previous && !previous.updatedAt) throw new Error('기획전을 새로 불러온 후 다시 수정해주세요');
  const version = new Date(Math.max(Date.now(), (Date.parse(previous?.updatedAt || '') || 0) + 1)).toISOString();
  const row = toRow({ ...next, updatedAt: version });
  const query = previous
    ? db.from('campaigns').update(row).eq('id', next.id).eq('updated_at', previous.updatedAt)
    : db.from('campaigns').insert(row);
  const { data, error } = await query.select('*');
  if (error) throw error;
  if (data?.length !== 1) throw new Error('다른 담당자가 먼저 변경했습니다. 최신 내용을 확인하고 다시 수정해주세요');
  return fromRow(data[0]);
}, replaceIfCurrent, async (submitted, baseline, error) => {
  // Unknown outcomes are reconciled, never retried as a blind upsert.
  let authoritative = baseline;
  try {
    const { data, error: readError } = await db.from('campaigns').select('*').eq('id', submitted.id);
    if (readError) throw readError;
    authoritative = data?.[0] ? fromRow(data[0]) : undefined;
  } catch { /* Offline: revert to the last acknowledged baseline. */ }
  replaceIfCurrent(submitted, authoritative);
  toast.error(`기획전 저장을 확인하지 못했습니다 — ${(error as Error)?.message || '연결 상태를 확인해주세요'}`);
});

export function deleteCampaignSB(id: string): void {
  db.from('campaigns').delete().eq('id', id).then(({ error }) => {
    if (error) console.warn('[campaigns] 서버 삭제 실패:', error.message);
  });
}
