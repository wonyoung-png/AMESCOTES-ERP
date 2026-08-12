import { supabase } from './supabase';
import type { SalesRecord } from './store';

export async function fetchSalesRecords(): Promise<SalesRecord[]> {
  const { data, error } = await supabase.from('sales_records').select('*').order('sale_date', { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id, saleDate: r.sale_date, channel: r.channel, buyerName: r.buyer_name,
    styleNo: r.style_no, styleName: r.style_name, qty: Number(r.qty || 0), unitPriceKrw: Number(r.unit_price_krw || 0),
    totalKrw: Number(r.total_krw || 0), season: r.season, memo: r.memo, createdAt: r.created_at,
    orderId: r.order_id, orderNo: r.order_no, vendorId: r.vendor_id, vendorName: r.vendor_name,
    source: r.source, workspace: r.workspace, deliveryMarket: r.delivery_market,
    shippingCostKrw: Number(r.shipping_cost_krw || 0), platformFeeKrw: Number(r.platform_fee_krw || 0), pgFeeKrw: Number(r.pg_fee_krw || 0),
  }));
}

export async function upsertSalesRecord(s: SalesRecord): Promise<void> {
  const { error } = await supabase.from('sales_records').upsert({
    id: s.id, sale_date: s.saleDate, channel: s.channel, buyer_name: s.buyerName,
    style_no: s.styleNo, style_name: s.styleName, qty: s.qty, unit_price_krw: s.unitPriceKrw, total_krw: s.totalKrw,
    season: s.season, memo: s.memo, order_id: s.orderId, order_no: s.orderNo, vendor_id: s.vendorId,
    vendor_name: s.vendorName, source: s.source, workspace: s.workspace, delivery_market: s.deliveryMarket,
    shipping_cost_krw: s.shippingCostKrw || 0, platform_fee_krw: s.platformFeeKrw || 0, pg_fee_krw: s.pgFeeKrw || 0,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}