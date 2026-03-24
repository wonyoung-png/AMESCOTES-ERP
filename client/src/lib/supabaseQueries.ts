// AMESCOTES ERP — Supabase 직접 쿼리 함수 모음
// localStorage 캐시 없이 Supabase에서 직접 읽기/쓰기

import { supabase } from './supabase';

// ─── camelCase → snake_case 변환 헬퍼 ───
function toSnakeCase(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()),
      v,
    ])
  );
}

// ─── BOM 행(BomLine) 배열 정규화 ───
function normalizeBomLine(l: any): any {
  if (!l || typeof l !== 'object') return l;
  const itemName = l.itemName ?? l.item_name ?? l.name ?? '';
  const unitPriceCny = l.unitPriceCny ?? l.unit_price_cny ?? l.unitPrice ?? l.unit_price ?? 0;
  const netQty = l.netQty ?? l.net_qty ?? l.qty ?? 0;
  const effectiveQty = netQty || (unitPriceCny > 0 && l.total ? parseFloat((l.total / unitPriceCny).toFixed(4)) : 0);
  return {
    id: l.id ?? Math.random().toString(36).slice(2),
    category: l.category ?? '원자재',
    subPart: l.subPart ?? l.sub_part ?? l.subpart,
    itemName,
    spec: l.spec ?? '',
    unit: l.unit ?? 'EA',
    customUnit: l.customUnit ?? l.custom_unit ?? '',
    unitPriceCny,
    netQty: effectiveQty,
    lossRate: l.lossRate ?? l.loss_rate ?? 0,
    isHqProvided: l.isHqProvided ?? l.is_hq_provided ?? (l.hq_provided === true) ?? false,
    isVendorProvided: l.isVendorProvided ?? l.is_vendor_provided ?? false,
    vendorName: l.vendorName ?? l.vendor_name ?? '',
    vendorId: l.vendorId ?? l.vendor_id ?? '',
    isNewVendor: l.isNewVendor ?? l.is_new_vendor ?? false,
    memo: l.memo ?? '',
    imageUrl: l.imageUrl ?? l.image_url ?? undefined,
  };
}

// ─── PostProcessLine 정규화 ───
function normalizePostLine(l: any): any {
  if (!l || typeof l !== 'object') return l;
  return {
    id: l.id,
    name: l.name ?? '',
    netQty: l.netQty ?? l.net_qty ?? 1,
    unitPrice: l.unitPrice ?? l.unit_price ?? 0,
    memo: l.memo ?? '',
    subPart: l.subPart ?? l.sub_part,
  };
}

// ─── ColorBom 정규화 ───
function normalizeColorBom(cb: any): any {
  if (!cb || typeof cb !== 'object') return cb;
  return {
    color: cb.color ?? '',
    lines: Array.isArray(cb.lines) ? cb.lines.map(normalizeBomLine) : [],
    postProcessLines: Array.isArray(cb.postProcessLines ?? cb.post_process_lines)
      ? (cb.postProcessLines ?? cb.post_process_lines).map(normalizePostLine)
      : [],
    processingFee: cb.processingFee ?? cb.processing_fee ?? 0,
  };
}

// ─── BOM DB 행 → 앱 구조 변환 ───
export function convertBomFromDB(row: any) {
  const preMats = row.pre_materials;
  const lines = Array.isArray(preMats) ? preMats.map(normalizeBomLine) : [];

  const postMats = row.post_materials;
  const postMaterials = Array.isArray(postMats) ? postMats.map(normalizeBomLine) : [];

  const postProcLines = row.post_process_lines;
  const postProcessLines = Array.isArray(postProcLines) ? postProcLines.map(normalizePostLine) : [];

  // colorBoms
  let colorBoms: any[];
  if (Array.isArray(row.color_boms) && row.color_boms.length > 0) {
    colorBoms = row.color_boms.map(normalizeColorBom);
  } else {
    colorBoms = [{
      color: '기본',
      lines,
      postProcessLines: [],
      processingFee: row.pre_processing_fee ?? 0,
    }];
  }

  // postColorBoms
  let postColorBoms: any[];
  if (Array.isArray(row.post_color_boms) && row.post_color_boms.length > 0) {
    postColorBoms = row.post_color_boms.map(normalizeColorBom);
  } else if (postMaterials.length > 0) {
    postColorBoms = [{
      color: '기본',
      lines: postMaterials,
      postProcessLines: [],
      processingFee: row.post_processing_fee ?? 0,
    }];
  } else {
    postColorBoms = [];
  }

  return {
    id: row.id,
    styleNo: row.style_no,
    styleName: row.style_name,
    season: row.season,
    erpCategory: row.erp_category,
    designer: row.designer,
    lineName: row.line_name,
    colorBoms,
    postColorBoms,
    lines,
    postMaterials,
    processingFee: row.pre_processing_fee ?? row.processing_fee ?? 0,
    postProcessingFee: row.post_processing_fee ?? 0,
    exchangeRateCny: row.exchange_rate_cny ?? 191,
    preExchangeRateCny: row.pre_exchange_rate_cny ?? row.exchange_rate_cny ?? 191,
    postExchangeRateCny: row.post_exchange_rate_cny ?? row.exchange_rate_cny ?? 191,
    snapshotCnyKrw: row.exchange_rate_cny ?? 191,
    customsRate: row.customs_rate ?? 0,
    productionMarginRate: row.production_margin_rate ?? 0.16,
    postProcessLines,
    manufacturingCountry: row.manufacturing_country,
    styleId: row.style_no, // styleId는 styleNo로 fallback
    version: 1,
    logisticsCostKrw: row.logistics_cost_krw ?? 0,
    packagingCostKrw: 0,
    packingCostKrw: 0,
    pnl: { discountRate: 0.05, platformFeeRate: 0.30, sgaRate: 0.10 },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memo: row.memo,
  };
}

// ─── 테이블별 허용 컬럼 목록 ───
const TABLE_COLUMNS: Record<string, string[]> = {
  vendors: ['id', 'code', 'name', 'company_name', 'type', 'material_types', 'custom_type',
            'contact_name', 'phone', 'email', 'memo', 'bank_info', 'created_at', 'updated_at'],
  items: ['id', 'style_no', 'name', 'erp_category', 'sub_category', 'buyer_id', 'season',
          'designer', 'material', 'delivery_price', 'margin_amount', 'margin_rate',
          'last_order_date', 'memo', 'image_url',
          'has_bom', 'base_cost_krw', 'colors',
          'created_at', 'updated_at'],
  samples: ['id', 'style_no', 'style_name', 'buyer_id', 'season', 'stage', 'assignee',
            'sales_person', 'request_date', 'expected_date', 'approved_date', 'cost_krw',
            'image_urls', 'material_requests', 'documents', 'memo', 'created_at', 'updated_at'],
  boms: ['id', 'style_no', 'style_name', 'season', 'erp_category', 'designer', 'line_name',
         'manufacturing_country', 'currency', 'exchange_rate_cny', 'exchange_rate_usd',
         'pre_materials', 'pre_processing_fee', 'post_materials', 'post_processing_fee',
         'delivery_price', 'logistics_cost_krw', 'production_margin_rate', 'memo',
         'created_at', 'updated_at',
         'color_boms', 'post_color_boms', 'pre_currency', 'post_currency',
         'pre_exchange_rate_cny', 'post_exchange_rate_cny', 'customs_rate', 'post_process_lines'],
  production_orders: ['id', 'style_no', 'style_name', 'buyer_id', 'vendor_id', 'quantity', 'unit_price',
                      'currency', 'order_date', 'expected_date', 'status', 'memo',
                      'order_no', 'vendor_name', 'factory_unit_price_krw', 'factory_unit_price_cny',
                      'factory_currency', 'color_qtys', 'delivery_date', 'style_id', 'revision',
                      'is_reorder', 'season', 'bom_id', 'bom_type', 'hq_supply_items',
                      'nego_history', 'received_qty', 'defect_qty', 'defect_note', 'received_date',
                      'trade_statement_id',
                      'created_at', 'updated_at'],
  materials: ['id', 'name', 'name_en', 'spec', 'unit', 'unit_price', 'unit_price_cny', 'unit_price_krw',
              'currency', 'vendor_id', 'category', 'stock_qty', 'memo',
              'order_status', 'order_date', 'order_qty', 'order_vendor_name',
              'created_at', 'updated_at'],
};

function filterForTable(table: string, row: Record<string, any>): Record<string, any> {
  const allowed = TABLE_COLUMNS[table];
  if (!allowed) return row;
  return Object.fromEntries(Object.entries(row).filter(([k]) => allowed.includes(k)));
}

// ─────────────────────────────────────────────
// VENDORS
// ─────────────────────────────────────────────

export async function fetchVendors() {
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name ?? '',
    code: row.code,
    companyName: row.company_name,
    type: row.type ?? '기타',
    materialTypes: row.material_types ?? [],
    customType: row.custom_type,
    contactName: row.contact_name,
    phone: row.phone,
    contactPhone: row.phone,
    email: row.email,
    contactEmail: row.email,
    memo: row.memo,
    bankInfo: row.bank_info,
    country: row.country ?? '한국',
    currency: row.currency ?? 'KRW',
    contactHistory: row.contact_history ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function upsertVendor(vendor: Record<string, any>) {
  const row = filterForTable('vendors', {
    id: vendor.id,
    code: vendor.code,
    name: vendor.name,
    company_name: vendor.companyName,
    type: vendor.type,
    material_types: vendor.materialTypes,
    custom_type: vendor.customType,
    contact_name: vendor.contactName,
    phone: vendor.contactPhone ?? vendor.phone,
    email: vendor.contactEmail ?? vendor.email,
    memo: vendor.memo,
    bank_info: vendor.bankInfo,
  });
  const { error } = await supabase.from('vendors').upsert(row);
  if (error) throw error;
}

export async function deleteVendor(id: string) {
  const { error } = await supabase.from('vendors').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// ITEMS
// ─────────────────────────────────────────────

export async function fetchItems() {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    styleNo: row.style_no ?? '',
    name: row.name ?? '',
    nameEn: row.name_en,
    season: row.season,
    category: row.category,
    erpCategory: row.erp_category,
    designer: row.designer,
    material: row.material ?? '',
    deliveryPrice: row.delivery_price,
    marginAmount: row.margin_amount,
    marginRate: row.margin_rate,
    imageUrl: row.image_url,
    hasBom: row.has_bom ?? false,
    baseCostKrw: row.base_cost_krw ?? 0,
    colors: Array.isArray(row.colors) ? row.colors : [],
    buyerId: row.buyer_id,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function upsertItem(item: Record<string, any>) {
  const row = filterForTable('items', {
    id: item.id,
    style_no: item.styleNo,
    name: item.name,
    erp_category: item.erpCategory,
    buyer_id: item.buyerId,
    season: item.season,
    designer: item.designer,
    material: item.material,
    delivery_price: item.deliveryPrice,
    margin_amount: item.marginAmount,
    margin_rate: item.marginRate,
    memo: item.memo,
    image_url: item.imageUrl,
    has_bom: item.hasBom,
    base_cost_krw: item.baseCostKrw,
    colors: item.colors,
  });
  const { error } = await supabase.from('items').upsert(row);
  if (error) throw error;
}

export async function deleteItem(id: string) {
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// BOMS
// ─────────────────────────────────────────────

export async function fetchBoms() {
  const { data, error } = await supabase
    .from('boms')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(convertBomFromDB);
}

export async function upsertBom(bom: any) {
  const snakeBom: Record<string, any> = {
    id: bom.id,
    style_no: bom.styleNo,
    style_name: bom.styleName,
    season: bom.season,
    erp_category: bom.erpCategory,
    designer: bom.designer,
    line_name: bom.lineName,
    manufacturing_country: bom.manufacturingCountry,
    currency: bom.currency ?? bom.preCurrency ?? 'CNY',
    exchange_rate_cny: bom.exchangeRateCny ?? bom.snapshotCnyKrw,
    exchange_rate_usd: bom.exchangeRateUsd,
    pre_materials: bom.lines ?? [],
    pre_processing_fee: bom.processingFee ?? 0,
    post_materials: bom.postMaterials ?? [],
    post_processing_fee: bom.postProcessingFee ?? 0,
    logistics_cost_krw: bom.logisticsCostKrw ?? 0,
    production_margin_rate: bom.productionMarginRate ?? 0.16,
    customs_rate: bom.customsRate ?? 0,
    color_boms: bom.colorBoms ?? [],
    post_color_boms: bom.postColorBoms ?? [],
    post_process_lines: bom.postProcessLines ?? [],
    pre_currency: bom.preCurrency ?? bom.currency ?? 'CNY',
    post_currency: bom.currency ?? 'CNY',
    pre_exchange_rate_cny: bom.preExchangeRateCny ?? bom.snapshotCnyKrw,
    post_exchange_rate_cny: bom.postExchangeRateCny ?? bom.exchangeRateCny ?? bom.snapshotCnyKrw,
    memo: bom.memo,
    updated_at: new Date().toISOString(),
  };
  // 허용 컬럼만 필터링
  const filtered = filterForTable('boms', snakeBom);
  const { error } = await supabase.from('boms').upsert(filtered);
  if (error) throw error;
}

export async function deleteBom(id: string) {
  const { error } = await supabase.from('boms').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// SAMPLES
// ─────────────────────────────────────────────

export async function fetchSamples() {
  const { data, error } = await supabase
    .from('samples')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    styleId: row.style_id ?? row.style_no,
    styleNo: row.style_no ?? '',
    styleName: row.style_name ?? '',
    buyerId: row.buyer_id,
    season: row.season,
    stage: row.stage,
    location: row.location,
    round: row.round,
    roundName: row.round_name,
    color: row.color,
    assignee: row.assignee,
    salesPerson: row.sales_person,
    requestDate: row.request_date,
    expectedDate: row.expected_date,
    receivedDate: row.received_date,
    revisionNote: row.revision_note,
    revisionHistory: row.revision_history ?? [],
    sampleUnitPrice: row.sample_unit_price,
    costCny: row.cost_cny ?? 0,
    costKrw: row.cost_krw,
    approvedBy: row.approved_by,
    imageUrls: row.image_urls ?? [],
    documents: row.documents ?? [],
    materialChecklist: row.material_checklist ?? [],
    materialRequests: row.material_requests ?? [],
    billingStatus: row.billing_status ?? '미청구',
    billingStatementId: row.billing_statement_id,
    billingDate: row.billing_date,
    collectedDate: row.collected_date,
    createdAt: row.created_at,
    memo: row.memo,
  }));
}

export async function upsertSample(sample: Record<string, any>) {
  const row = filterForTable('samples', {
    id: sample.id,
    style_no: sample.styleNo,
    style_name: sample.styleName,
    buyer_id: sample.buyerId,
    season: sample.season,
    stage: sample.stage,
    assignee: sample.assignee,
    sales_person: sample.salesPerson,
    request_date: sample.requestDate,
    expected_date: sample.expectedDate,
    approved_date: sample.approvedDate,
    cost_krw: sample.costKrw,
    image_urls: sample.imageUrls,
    material_requests: sample.materialRequests,
    documents: sample.documents,
    memo: sample.memo,
  });
  const { error } = await supabase.from('samples').upsert(row);
  if (error) throw error;
}

export async function deleteSample(id: string) {
  const { error } = await supabase.from('samples').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// PRODUCTION ORDERS
// ─────────────────────────────────────────────

export async function fetchOrders() {
  const { data, error } = await supabase
    .from('production_orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    orderNo: row.order_no ?? '',
    styleId: row.style_id ?? row.style_no,
    styleNo: row.style_no ?? '',
    styleName: row.style_name ?? '',
    season: row.season,
    revision: row.revision ?? 1,
    isReorder: row.is_reorder ?? false,
    qty: row.quantity ?? row.qty ?? 0,
    colorQtys: row.color_qtys ?? [],
    vendorId: row.vendor_id ?? '',
    vendorName: row.vendor_name ?? '',
    buyerId: row.buyer_id,
    orderDate: row.order_date,
    status: row.status ?? '발주생성',
    milestones: row.milestones ?? [],
    bomId: row.bom_id,
    hqSupplyItems: row.hq_supply_items ?? [],
    attachments: row.attachments ?? [],
    postCostId: row.post_cost_id,
    logisticsCostId: row.logistics_cost_id,
    tradeStatementId: row.trade_statement_id,
    deliveryDate: row.delivery_date,
    factoryUnitPriceCny: row.factory_unit_price_cny,
    factoryUnitPriceKrw: row.factory_unit_price_krw ?? row.unit_price,
    factoryCurrency: row.factory_currency ?? row.currency ?? 'CNY',
    bomType: row.bom_type,
    receivedQty: row.received_qty,
    defectQty: row.defect_qty,
    defectNote: row.defect_note,
    receivedDate: row.received_date,
    negoHistory: row.nego_history ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memo: row.memo,
  }));
}

export async function upsertOrder(order: Record<string, any>) {
  const row = filterForTable('production_orders', {
    id: order.id,
    style_no: order.styleNo,
    style_name: order.styleName,
    buyer_id: order.buyerId,
    vendor_id: order.vendorId,
    quantity: order.qty,
    unit_price: order.factoryUnitPriceKrw ?? order.factoryUnitPriceCny ?? 0,
    currency: order.factoryCurrency ?? 'KRW',
    order_date: order.orderDate,
    status: order.status,
    memo: order.memo,
    order_no: order.orderNo,
    vendor_name: order.vendorName,
    factory_unit_price_krw: order.factoryUnitPriceKrw,
    color_qtys: order.colorQtys,
    delivery_date: order.deliveryDate,
    style_id: order.styleId,
    revision: order.revision,
    is_reorder: order.isReorder ?? false,
    season: order.season,
    bom_id: order.bomId,
    bom_type: order.bomType,
    factory_unit_price_cny: order.factoryUnitPriceCny,
    factory_currency: order.factoryCurrency ?? 'CNY',
    hq_supply_items: order.hqSupplyItems ?? [],
    nego_history: order.negoHistory ?? [],
    updated_at: order.updatedAt ?? new Date().toISOString(),
    created_at: order.createdAt ?? new Date().toISOString(),
  });
  const { error } = await supabase.from('production_orders').upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteOrder(id: string) {
  const { error } = await supabase.from('production_orders').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// MATERIALS
// ─────────────────────────────────────────────

export async function fetchMaterials() {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name ?? '',
    nameEn: row.name_en || '',
    category: row.category || '원자재',
    spec: row.spec || '',
    unit: row.unit || 'YD',
    unitPriceCny: row.unit_price_cny,
    unitPriceKrw: row.unit_price_krw,
    stockQty: row.stock_qty || 0,
    vendorId: row.vendor_id || '',
    memo: row.memo || '',
    orderStatus: row.order_status || undefined,
    orderDate: row.order_date || undefined,
    orderQty: row.order_qty || undefined,
    orderVendorName: row.order_vendor_name || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function upsertMaterial(mat: Record<string, any>): Promise<void> {
  const row: Record<string, any> = {
    id: mat.id,
    name: mat.name,
    unit: mat.unit,
    category: mat.category || '원자재',
    updated_at: new Date().toISOString(),
  };
  if (mat.spec !== undefined) row.spec = mat.spec || null;
  if (mat.nameEn !== undefined) row.name_en = mat.nameEn || null;
  if (mat.unitPriceCny !== undefined) row.unit_price_cny = mat.unitPriceCny;
  if (mat.unitPriceKrw !== undefined) row.unit_price_krw = mat.unitPriceKrw;
  if (mat.stockQty !== undefined) row.stock_qty = mat.stockQty;
  if (mat.vendorId !== undefined) row.vendor_id = mat.vendorId || null;
  if (mat.memo !== undefined) row.memo = mat.memo || null;
  if (mat.orderStatus !== undefined) row.order_status = mat.orderStatus || null;
  if (mat.orderDate !== undefined) row.order_date = mat.orderDate || null;
  if (mat.orderQty !== undefined) row.order_qty = mat.orderQty;
  if (mat.orderVendorName !== undefined) row.order_vendor_name = mat.orderVendorName || null;
  if (!mat.id) row.created_at = mat.createdAt || new Date().toISOString();

  const { error } = await supabase.from('materials').upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

export async function updateMaterialStatus(id: string, status: '발주중' | '입고완료', extra?: Record<string, any>): Promise<void> {
  const update: Record<string, any> = { order_status: status, updated_at: new Date().toISOString(), ...extra };
  const { error } = await supabase.from('materials').update(update).eq('id', id);
  if (error) throw error;
}

export async function updateMaterial(id: string, patch: Record<string, any>) {
  const snakePatch = toSnakeCase(patch);
  const { error } = await supabase.from('materials').update(snakePatch).eq('id', id);
  if (error) throw error;
}

export async function deleteMaterial(id: string) {
  const { error } = await supabase.from('materials').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// PURCHASE ITEMS
// ─────────────────────────────────────────────

export async function fetchPurchaseItems() {
  const { data, error } = await supabase
    .from('purchase_items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    orderId: row.order_id || '',
    orderNo: row.order_no || '',
    purchaseDate: row.purchase_date || '',
    itemName: row.item_name || '',
    qty: row.qty || 0,
    unit: row.unit || '',
    unitPriceCny: row.unit_price_cny || 0,
    currency: row.currency || 'CNY',
    appliedRate: row.applied_rate || 191,
    amountKrw: row.amount_krw || 0,
    vendorId: row.vendor_id || '',
    vendorName: row.vendor_name || '',
    paymentMethod: row.payment_method || '기타',
    purchaseStatus: row.purchase_status || '미발주',
    statementNo: row.statement_no || undefined,
    memo: row.memo || '',
    createdAt: row.created_at || new Date().toISOString(),
  }));
}

export async function upsertPurchaseItem(item: Record<string, any>): Promise<void> {
  const row = {
    id: item.id,
    order_id: item.orderId || null,
    order_no: item.orderNo || null,
    purchase_date: item.purchaseDate || null,
    item_name: item.itemName,
    qty: item.qty || 0,
    unit: item.unit || null,
    unit_price_cny: item.unitPriceCny || 0,
    currency: item.currency || 'CNY',
    applied_rate: item.appliedRate || 191,
    amount_krw: item.amountKrw || 0,
    vendor_id: item.vendorId || null,
    vendor_name: item.vendorName || null,
    payment_method: item.paymentMethod || '기타',
    purchase_status: item.purchaseStatus || '미발주',
    statement_no: item.statementNo || null,
    memo: item.memo || null,
  };
  const { error } = await supabase.from('purchase_items').upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

export async function deletePurchaseItem(id: string): Promise<void> {
  const { error } = await supabase.from('purchase_items').delete().eq('id', id);
  if (error) throw error;
}

export async function updatePurchaseItemStatus(id: string, status: string, extra?: Record<string, any>): Promise<void> {
  const update: Record<string, any> = { purchase_status: status, ...extra };
  const { error } = await supabase.from('purchase_items').update(update).eq('id', id);
  if (error) throw error;
}
