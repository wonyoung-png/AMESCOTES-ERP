import { supabase } from './supabase';

export type ShippingMethod = 'air' | 'sea';
export type ShippingPlanStatus = 'pending' | 'confirmed';

export interface ShippingPlan {
  id: string;
  shipDate: string;
  method: ShippingMethod;
  orderNo?: string;
  description: string;
  qty: number;
  memo?: string;
  status: ShippingPlanStatus;
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const fromRow = (row: any): ShippingPlan => ({
  id: row.id,
  shipDate: row.ship_date,
  method: row.method,
  orderNo: row.order_no || undefined,
  description: row.description,
  qty: Number(row.qty || 0),
  memo: row.memo || undefined,
  status: row.status || 'pending',
  confirmedBy: row.confirmed_by || undefined,
  confirmedAt: row.confirmed_at || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function fetchShippingPlans(date?: string): Promise<ShippingPlan[]> {
  let query = supabase.from('shipping_plans').select('*').order('ship_date').order('created_at');
  if (date) query = query.eq('ship_date', date);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(fromRow);
}

export async function upsertShippingPlan(plan: Partial<ShippingPlan> & Pick<ShippingPlan, 'id' | 'shipDate' | 'method' | 'description'>): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('shipping_plans').upsert({
    id: plan.id,
    ship_date: plan.shipDate,
    method: plan.method,
    order_no: plan.orderNo || null,
    description: plan.description,
    qty: plan.qty || 0,
    memo: plan.memo || null,
    status: plan.status || 'pending',
    confirmed_by: plan.confirmedBy || null,
    confirmed_at: plan.confirmedAt || null,
    created_at: plan.createdAt || now,
    updated_at: now,
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function confirmShippingPlan(id: string, confirmedBy: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('shipping_plans').update({
    status: 'confirmed',
    confirmed_by: confirmedBy,
    confirmed_at: now,
    updated_at: now,
  }).eq('id', id);
  if (error) throw error;
}

