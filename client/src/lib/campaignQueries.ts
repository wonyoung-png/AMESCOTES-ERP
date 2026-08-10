// 기획전 서버 저장.
//
// 지금까지 localStorage에만 있어서 대표가 만든 기획전을 직원이 못 봤다.
// phase1의 쓰기가 전부 setAll(KEYS.campaigns, ...) 한 곳을 지나므로 거기서 서버에도 올린다.
import { supabase } from './supabase';
import { filterForTable } from './tableColumns';

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
  updated_at: new Date().toISOString(),
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
  const { data, error } = await supabase.from('campaigns').select('*');
  if (error) throw error;
  return (data || []).map(fromRow);
}

/** 화면을 막지 않는다 — 저장 실패는 콘솔로만 알리고 로컬 값은 그대로 둔다 */
export function pushCampaigns(list: any[]): void {
  if (!list?.length) return;
  supabase.from('campaigns').upsert(list.map(toRow)).then(({ error }) => {
    if (error) console.warn('[campaigns] 서버 저장 실패:', error.message);
  });
}

export function deleteCampaignSB(id: string): void {
  supabase.from('campaigns').delete().eq('id', id).then(({ error }) => {
    if (error) console.warn('[campaigns] 서버 삭제 실패:', error.message);
  });
}
