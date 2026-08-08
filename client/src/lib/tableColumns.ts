// AMESCOTES ERP — Supabase 테이블별 허용 컬럼 정본 (Single Source of Truth)
//
// ⚠️ 이 파일이 유일한 컬럼 목록입니다. store.ts / supabaseQueries.ts 등
//    어디에도 사본을 만들지 마세요.
//    (사본이 갈라지면서 입고수량·마일스톤 등이 무음 탈락하던 버그가 있었습니다)
//
// 컬럼 추가 시: supabase/ 마이그레이션 SQL 실행 → 아래 목록에 추가

export const TABLE_COLUMNS: Record<string, string[]> = {
  vendors: ['id', 'code', 'name', 'company_name', 'type', 'material_types', 'custom_type',
            'contact_name', 'phone', 'email', 'memo', 'bank_info', 'created_at', 'updated_at',
            'region', 'brands', 'vendor_code', 'name_en', 'name_cn', 'biz_reg_no', 'address',
            'billing_email', 'country', 'currency', 'wechat_id', 'lead_time_days',
            'processing_unit_cost', 'billing_type', 'settlement_cycle', 'commission_rate',
            'tt_condition', 'custom_material_type', 'contact_history'],
  items: ['id', 'style_no', 'buyer_style_no', 'name', 'erp_category', 'sub_category', 'buyer_id', 'season',
          'designer', 'material', 'delivery_price', 'margin_amount', 'margin_rate',
          'last_order_date', 'memo', 'image_url',
          'has_bom', 'base_cost_krw', 'post_cost_krw', 'confirmed_sale_price', 'colors',
          'created_at', 'updated_at'],
  samples: ['id', 'style_no', 'style_name', 'buyer_id', 'season', 'stage', 'assignee',
            'sales_person', 'request_date', 'expected_date', 'approved_date', 'cost_krw',
            'image_urls', 'material_requests', 'documents', 'memo', 'created_at', 'updated_at',
            'style_id', 'location', 'round', 'round_name', 'color', 'received_date',
            'revision_note', 'revision_history', 'sample_unit_price', 'cost_cny', 'approved_by',
            'material_checklist', 'billing_status', 'billing_statement_id', 'billing_date',
            'collected_date'],
  boms: ['id', 'style_no', 'style_id', 'style_name', 'season', 'erp_category', 'designer', 'line_name',
         'manufacturing_country', 'currency', 'exchange_rate_cny', 'exchange_rate_usd',
         'pre_materials', 'pre_processing_fee', 'post_materials', 'post_processing_fee',
         'delivery_price', 'logistics_cost_krw', 'packaging_cost_krw', 'packing_cost_krw', 'production_margin_rate', 'memo',
         'created_at', 'updated_at',
         'color_boms', 'post_color_boms', 'pre_currency', 'post_currency',
         'pre_exchange_rate_cny', 'post_exchange_rate_cny', 'customs_rate', 'post_process_lines', 'post_delivery_price', 'post_subtotal_krw', 'post_total_cost_krw',
         'pnl_data', 'product_image'],
  production_orders: ['id', 'style_no', 'style_name', 'buyer_id', 'vendor_id', 'quantity', 'unit_price',
                      'currency', 'order_date', 'expected_date', 'status', 'memo',
                      'order_no', 'vendor_name', 'factory_unit_price_krw', 'factory_unit_price_cny',
                      'factory_currency', 'color_qtys', 'delivery_date', 'style_id', 'revision',
                      'is_reorder', 'season', 'bom_id', 'bom_type', 'hq_supply_items',
                      'nego_history', 'received_qty', 'defect_qty', 'post_defects', 'defect_note', 'received_date',
                      'trade_statement_id', 'expense_id', 'project_no', 'workspace', 'production_origin',
                      'brand_batch_id', 'po_batch_no', 'sent_at', 'confirmed_at', 'confirmed_date', 'confirm_note', 'shipped_qty', 'is_employee_purchase', 'milestones',
                      'created_at', 'updated_at'],
  materials: ['id', 'item_code', 'name', 'name_en', 'spec', 'unit', 'unit_price', 'unit_price_cny', 'unit_price_krw',
              'unit_price_usd', 'price_currency', 'brand', 'image_url',
              'currency', 'vendor_id', 'category', 'sub_type', 'plating_color', 'mold_cost', 'mold_cost_amount', 'mold_cost_currency', 'plating_prices', 'season',
              'stock_qty', 'memo',
              'order_status', 'order_date', 'order_qty', 'order_vendor_name',
              'created_at', 'updated_at'],
  // 자재구매 — 운영 DB 컬럼과 1:1 (없는 컬럼을 보내면 PostgREST 가 통째로 거부한다)
  purchase_items: ['id', 'order_id', 'order_no', 'project_no', 'purchase_date', 'item_name',
                   'qty', 'unit', 'unit_price_cny', 'currency', 'applied_rate', 'amount_krw',
                   'vendor_id', 'vendor_name', 'payment_method', 'purchase_status',
                   'statement_no', 'memo', 'created_at'],
};

/** camelCase → snake_case (최상위 키만) */
export function toSnakeCase(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()),
      v,
    ])
  );
}

/** 테이블에 실제로 존재하는 컬럼만 남긴다 */
export function filterForTable(table: string, row: Record<string, any>): Record<string, any> {
  const allowed = TABLE_COLUMNS[table];
  if (!allowed) return row; // 알 수 없는 테이블은 그대로 통과
  return Object.fromEntries(Object.entries(row).filter(([k]) => allowed.includes(k)));
}
