// AMESCOTES ERP — Supabase 직접 쿼리 함수 모음
// Supabase 우선 · 비어있거나 실패 시 localStorage 폴백

import { supabase } from './supabase';
import { store } from './store';

async function withLocalFallback<T>(remote: () => Promise<T[]>, local: () => T[]): Promise<T[]> {
  try {
    const rows = await remote();
    if (rows.length > 0) return rows;
  } catch (e) {
    console.warn('[supabaseQueries] 원격 조회 실패 → localStorage 폴백', e);
  }
  const cached = local();
  if (cached.length > 0) console.info('[supabaseQueries] localStorage 폴백', cached.length, '건');
  return cached;
}

/** LPKG-* / PACK 로컬 전용 품목 정규화 (DB에 PACK enum 없어도 UI에 PACK으로 표시) */
function normalizePackFields<T extends Record<string, any>>(item: T): T {
  const styleNo = String(item.styleNo || '');
  const isPack =
    item.erpCategory === 'PACK' ||
    styleNo.startsWith('LPKG-') ||
    styleNo.startsWith('BOX-') ||
    styleNo.startsWith('PACKAGE-') ||
    String(item.memo || '').includes('[PACK]');
  if (!isPack) return item;
  return {
    ...item,
    erpCategory: 'PACK',
    materialType: item.materialType || '부재료',
  };
}

/** 원격 + 로컬 병합 — 로컬에만 있는 품목(PACK 등)을 목록에 포함 */
function mergeByIdStyleNo<T extends { id?: string; styleNo?: string }>(
  remote: T[],
  local: T[],
): T[] {
  if (local.length === 0) return remote.map(r => normalizePackFields(r as any));
  if (remote.length === 0) return local.map(r => normalizePackFields(r as any));

  const remoteIds = new Set(remote.map(r => r.id).filter(Boolean) as string[]);
  const remoteStyles = new Set(remote.map(r => r.styleNo).filter(Boolean) as string[]);

  const merged = remote.map(r => {
    const loc = local.find(l =>
      (l.id && r.id && l.id === r.id) ||
      (l.styleNo && r.styleNo && l.styleNo === r.styleNo),
    );
    if (!loc) return normalizePackFields(r as any);
    const L = loc as Record<string, unknown>;
    const R = r as Record<string, unknown>;
    const styleNo = String(R.styleNo || L.styleNo || '');
    const preferLocalPack =
      L.erpCategory === 'PACK' ||
      styleNo.startsWith('LPKG-') ||
      styleNo.startsWith('BOX-') ||
      styleNo.startsWith('PACKAGE-') ||
      String(L.memo || '').includes('[PACK]');
    return normalizePackFields({
      ...loc,
      ...r,
      packingSize: L.packingSize ?? R.packingSize,
      erpCategory: preferLocalPack ? 'PACK' : (R.erpCategory ?? L.erpCategory),
      category: preferLocalPack ? (L.category ?? R.category) : (R.category ?? L.category),
      baseCostKrw: R.baseCostKrw || L.baseCostKrw,
      materialType: preferLocalPack ? '부재료' : (R.materialType ?? L.materialType),
      memo: R.memo || L.memo,
      deliveryPrice: R.deliveryPrice || L.deliveryPrice,
    } as T);
  });

  for (const loc of local) {
    if (loc.id && remoteIds.has(loc.id)) continue;
    if (loc.styleNo && remoteStyles.has(loc.styleNo)) continue;
    merged.push(normalizePackFields(loc as any));
  }
  return merged;
}

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
    id: Math.random().toString(36).slice(2), // 항상 새 id 생성 (중복 방지)
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
function convertBomFromDB(row: any) {
  const preMats = row.pre_materials;
  const lines = Array.isArray(preMats) ? preMats.map(normalizeBomLine) : [];

  const postMats = row.post_materials;
  const postMaterials = Array.isArray(postMats) ? postMats.map(normalizeBomLine) : [];

  const postProcLines = row.post_process_lines;
  const postProcessLines = Array.isArray(postProcLines) ? postProcLines.map(normalizePostLine) : [];

  // colorBoms
  // null/undefined = 구버전 BOM (color_boms 미도입) → 기본탭 자동생성
  // []            = 사용자가 모든 탭 삭제 → 빈 배열 유지 (재생성 금지)
  // [...]         = 저장된 탭 복원
  let colorBoms: any[];
  if (row.color_boms === null || row.color_boms === undefined) {
    colorBoms = [{ color: '기본', lines, postProcessLines: [], processingFee: row.pre_processing_fee ?? 0 }];
  } else if (Array.isArray(row.color_boms) && row.color_boms.length > 0) {
    colorBoms = row.color_boms.map(normalizeColorBom);
  } else {
    colorBoms = [];
  }

  // postColorBoms
  let postColorBoms: any[];
  if (Array.isArray(row.post_color_boms) && row.post_color_boms.length > 0) {
    postColorBoms = row.post_color_boms.map(normalizeColorBom);
  } else if (postMaterials.length > 0) {
    postColorBoms = [{
      color: '기본',
      lines: postMaterials,
      postProcessLines: postProcessLines, // bom 레벨 후가공비 포함 (구형 BOM 호환)
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
    postDeliveryPrice: row.post_delivery_price ?? undefined,
    postTotalCostKrw: row.post_total_cost_krw ?? undefined,
    postSubtotalKrw: row.post_subtotal_krw ?? undefined,
    currency: row.currency ?? 'CNY',
    exchangeRateCny: row.exchange_rate_cny ?? 191,
    preExchangeRateCny: row.pre_exchange_rate_cny ?? row.exchange_rate_cny ?? 191,
    postExchangeRateCny: row.post_exchange_rate_cny ?? row.exchange_rate_cny ?? 191,
    exchangeRateUsd: row.exchange_rate_usd ?? undefined,
    snapshotCnyKrw: row.exchange_rate_cny ?? 191,
    customsRate: row.customs_rate ?? 0,
    productionMarginRate: row.production_margin_rate ?? 0.16,
    postProcessLines,
    manufacturingCountry: row.manufacturing_country,
    styleId: row.style_id || row.style_no, // style_id 컬럼 우선, 없으면 style_no로 fallback
    version: 1,
    logisticsCostKrw: row.logistics_cost_krw ?? 0,
    packagingCostKrw: row.packaging_cost_krw ?? 0,
    packingCostKrw: row.packing_cost_krw ?? 0,
    packingItemId: (() => {
      try {
        if (row.pnl_data) {
          const p = typeof row.pnl_data === 'string' ? JSON.parse(row.pnl_data) : row.pnl_data;
          return p.packingItemId || undefined;
        }
      } catch {}
      return undefined;
    })(),
    packingItemStyleNo: (() => {
      try {
        if (row.pnl_data) {
          const p = typeof row.pnl_data === 'string' ? JSON.parse(row.pnl_data) : row.pnl_data;
          return p.packingItemStyleNo || undefined;
        }
      } catch {}
      return undefined;
    })(),
    productImage: row.product_image ?? undefined,
    pnl: (() => {
      try {
        if (row.pnl_data) return JSON.parse(row.pnl_data);
      } catch {}
      return { discountRate: 0.05, platformFeeRate: 0.30, sgaRate: 0.10 };
    })(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memo: row.memo,
    // 간단 원가 (memo JSON에서 파싱)
    simpleCostKrw: (() => {
      try {
        if (row.memo && typeof row.memo === 'string' && row.memo.trim().startsWith('{')) {
          const md = JSON.parse(row.memo);
          if (md.isSimple) return md.preCost ?? undefined;
        }
      } catch {}
      return undefined;
    })(),
    simplePostCostKrw: (() => {
      try {
        if (row.memo && typeof row.memo === 'string' && row.memo.trim().startsWith('{')) {
          const md = JSON.parse(row.memo);
          if (md.isSimple) return md.postCost ?? undefined;
        }
      } catch {}
      return undefined;
    })(),
    isSimpleCost: (() => {
      try {
        if (row.memo && typeof row.memo === 'string' && row.memo.trim().startsWith('{')) {
          const md = JSON.parse(row.memo);
          return !!md.isSimple;
        }
      } catch {}
      return false;
    })(),
  };
}

// ─── 테이블별 허용 컬럼 목록 ───
const TABLE_COLUMNS: Record<string, string[]> = {
  vendors: ['id', 'code', 'name', 'company_name', 'type', 'material_types', 'custom_type',
            'contact_name', 'phone', 'email', 'memo', 'bank_info', 'created_at', 'updated_at'],
  items: ['id', 'style_no', 'name', 'erp_category', 'sub_category', 'buyer_id', 'season',
          'designer', 'material', 'delivery_price', 'margin_amount', 'margin_rate',
          'last_order_date', 'memo', 'image_url',
          'has_bom', 'base_cost_krw', 'post_cost_krw', 'confirmed_sale_price', 'colors',
          'created_at', 'updated_at'],
  samples: ['id', 'style_no', 'style_name', 'buyer_id', 'season', 'stage', 'assignee',
            'sales_person', 'request_date', 'expected_date', 'approved_date', 'cost_krw',
            'image_urls', 'material_requests', 'documents', 'memo', 'created_at', 'updated_at'],
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
                      'nego_history', 'received_qty', 'defect_qty', 'defect_note', 'received_date',
                      'trade_statement_id', 'expense_id', 'project_no', 'workspace', 'production_origin',
                      'brand_batch_id', 'shipped_qty', 'is_employee_purchase', 'milestones',
                      'created_at', 'updated_at'],
  materials: ['id', 'item_code', 'name', 'name_en', 'spec', 'unit', 'unit_price', 'unit_price_cny', 'unit_price_krw',
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
  return withLocalFallback(async () => {
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
  }, () => store.getVendors());
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
  const remote = await withLocalFallback(async () => {
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
    postCostKrw: row.post_cost_krw ?? 0,
    confirmedSalePrice: row.confirmed_sale_price ?? 0,
    colors: Array.isArray(row.colors) ? row.colors : [],
    buyerId: row.buyer_id,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  }, () => []);
  // Supabase에 없어도 로컬 PACK(LPKG-*) 등은 항상 목록에 표시
  return mergeByIdStyleNo(remote, store.getItems() as any[]);
}

export async function upsertItem(item: Record<string, any>) {
  // 1) 로컬 먼저 저장 — 네트워크 장애여도 품목 등록 가능
  try {
    const list = store.getItems();
    const idx = list.findIndex(x => x.id === item.id || x.styleNo === item.styleNo);
    const full = {
      ...(idx >= 0 ? list[idx] : {}),
      ...item,
      updatedAt: new Date().toISOString(),
      createdAt: item.createdAt || (idx >= 0 ? (list[idx] as any).createdAt : new Date().toISOString()),
    } as any;
    if (idx >= 0) {
      list[idx] = full;
      store.setItems([...list]);
    } else {
      store.setItems([...list, full]);
    }
  } catch (e) {
    console.warn('[upsertItem] localStorage 저장 실패', e);
  }

  // 2) Supabase 동기화 시도 (실패해도 로컬 저장은 유지)
  const row = filterForTable('items', {
    id: item.id,
    style_no: item.styleNo,
    name: item.name,
    name_en: item.nameEn,
    erp_category: item.erpCategory === 'PACK' ? 'ACC' : item.erpCategory,
    sub_category: item.category,
    buyer_id: item.buyerId || null,
    season: item.season,
    designer: item.designer,
    material: item.material,
    delivery_price: item.deliveryPrice,
    margin_amount: item.marginAmount,
    margin_rate: item.marginRate,
    memo: item.erpCategory === 'PACK' ? `[PACK] ${item.memo || ''}`.trim() : item.memo,
    image_url: item.imageUrl,
    has_bom: item.hasBom ?? false,
    base_cost_krw: item.baseCostKrw,
    confirmed_sale_price: item.confirmedSalePrice,
    colors: item.colors ?? [],
  });
  try {
    const { error } = await supabase.from('items').upsert(row);
    if (error) {
      console.warn('[upsertItem] Supabase 동기화 실패 (로컬에는 저장됨):', error.message);
    }
  } catch (e) {
    console.warn('[upsertItem] Supabase 네트워크 오류 (로컬에는 저장됨):', e);
  }
}

// 사후원가/확정판매가 전용 업데이트 (마이그레이션 실행 후 동작, 컬럼 없어도 다른 기능 안 깨짐)
export async function updateItemCostData(id: string, postCostKrw: number, confirmedSalePrice?: number) {
  const patch: Record<string, any> = { post_cost_krw: postCostKrw };
  if (confirmedSalePrice !== undefined && confirmedSalePrice > 0) {
    patch.confirmed_sale_price = confirmedSalePrice;
  }
  const { error } = await supabase.from('items').update(patch).eq('id', id);
  if (error) {
    // 컬럼 미존재(마이그레이션 미실행) 시 경고만 출력, throw 안 함
    console.warn('[updateItemCostData] 사후원가 저장 실패 (SQL 마이그레이션 필요):', error.message);
  }
}

// 확정판매가만 단독 저장 (delivery_price/post_cost_krw 건드리지 않음)
export async function saveConfirmedSalePrice(id: string, confirmedSalePrice: number) {
  const { error } = await supabase.from('items').update({ confirmed_sale_price: confirmedSalePrice }).eq('id', id);
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
  return withLocalFallback(async () => {
  const { data, error } = await supabase
    .from('boms')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(convertBomFromDB);
  }, () => store.getBoms());
}

// 목록 조회용 경량 fetch — product_image / pre_materials / color_boms 제외
// ItemMaster, PurchaseMatching 등 목록 표시에 사용 (수십 MB 절감)
const BOM_LIGHT_COLS = [
  'id', 'style_no', 'style_id', 'style_name', 'season', 'erp_category',
  'currency', 'exchange_rate_cny', 'exchange_rate_usd',
  'post_color_boms', 'post_materials', 'post_processing_fee', 'post_process_lines',
  'post_exchange_rate_cny', 'post_delivery_price',
  'post_subtotal_krw', 'post_total_cost_krw',
  'logistics_cost_krw', 'packaging_cost_krw', 'packing_cost_krw',
  'production_margin_rate', 'customs_rate',
  'pnl_data', 'memo',
  'created_at', 'updated_at',
].join(',');

export async function fetchBomsLight() {
  return withLocalFallback(async () => {
  const { data, error } = await supabase
    .from('boms')
    .select(BOM_LIGHT_COLS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(convertBomFromDB);
  }, () => store.getBoms());
}

export async function upsertBom(bom: any) {
  const snakeBom: Record<string, any> = {
    id: bom.id,
    style_no: bom.styleNo,
    style_id: bom.styleId ?? null, // items.id 참조 (BOM-아이템 연결 키)
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
    post_delivery_price: bom.postDeliveryPrice ?? null,
    post_total_cost_krw: (bom as any).postTotalCostKrw ?? null,
    post_subtotal_krw: (bom as any).postSubtotalKrw ?? null,
    logistics_cost_krw: bom.logisticsCostKrw ?? 0,
    packaging_cost_krw: bom.packagingCostKrw ?? 0,
    packing_cost_krw: bom.packingCostKrw ?? 0,
    production_margin_rate: bom.productionMarginRate ?? 0.16,
    customs_rate: bom.customsRate ?? 0,
    color_boms: bom.colorBoms ?? [],
    post_color_boms: bom.postColorBoms ?? [],
    post_process_lines: bom.postProcessLines ?? [],
    pre_currency: bom.preCurrency ?? bom.currency ?? 'CNY',
    post_currency: bom.currency ?? 'CNY',
    pre_exchange_rate_cny: bom.preExchangeRateCny ?? bom.snapshotCnyKrw,
    post_exchange_rate_cny: bom.postExchangeRateCny ?? bom.exchangeRateCny ?? bom.snapshotCnyKrw,
    pnl_data: (() => {
      const base = bom.pnl && typeof bom.pnl === 'object' ? { ...bom.pnl } : {};
      if (bom.packingItemId) {
        (base as any).packingItemId = bom.packingItemId;
        (base as any).packingItemStyleNo = bom.packingItemStyleNo || null;
      } else {
        delete (base as any).packingItemId;
        delete (base as any).packingItemStyleNo;
      }
      return Object.keys(base).length ? JSON.stringify(base) : null;
    })(),
    product_image: bom.productImage ?? null,
    // 간단 원가 BOM인 경우 memo에 JSON 저장
    memo: (() => {
      if (bom.simpleCostKrw !== undefined || bom.isSimpleCost) {
        return JSON.stringify({
          isSimple: true,
          preCost: bom.simpleCostKrw ?? null,
          postCost: bom.simplePostCostKrw ?? null,
        });
      }
      return bom.memo;
    })(),
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
  return withLocalFallback(async () => {
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
  }, () => store.getSamples());
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
  return withLocalFallback(async () => {
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
    expenseId: row.expense_id || undefined,
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
    projectNo: row.project_no,
    workspace: row.workspace ?? 'OEM',
    productionOrigin: row.production_origin,
    brandBatchId: row.brand_batch_id,
    shippedQty: row.shipped_qty ?? 0,
    isEmployeePurchase: row.is_employee_purchase ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memo: row.memo,
  }));
  }, () => store.getOrders());
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
    trade_statement_id: order.tradeStatementId || null,
    expense_id: order.expenseId || null,
    project_no: order.projectNo,
    workspace: order.workspace ?? 'OEM',
    production_origin: order.productionOrigin,
    brand_batch_id: order.brandBatchId,
    shipped_qty: order.shippedQty ?? 0,
    is_employee_purchase: order.isEmployeePurchase ?? false,
    received_qty: order.receivedQty,
    defect_qty: order.defectQty,
    defect_note: order.defectNote,
    received_date: order.receivedDate,
    milestones: order.milestones,
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
  return withLocalFallback(async () => {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    itemCode: row.item_code || undefined,
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
  }, () => store.getMaterials());
}

export async function upsertMaterial(mat: Record<string, any>): Promise<void> {
  const row: Record<string, any> = {
    id: mat.id,
    name: mat.name,
    unit: mat.unit,
    category: mat.category || '원자재',
    updated_at: new Date().toISOString(),
  };
  if (mat.itemCode !== undefined) row.item_code = mat.itemCode || null;
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
  return withLocalFallback(async () => {
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
    projectNo: row.project_no || undefined,
    styleNo: row.style_no || undefined,
  }));
  }, () => store.getPurchaseItems());
}

export async function upsertPurchaseItem(item: Record<string, any>): Promise<void> {
  const row: Record<string, unknown> = {
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
  if (item.projectNo != null) row.project_no = item.projectNo;
  // local 캐시 (프로젝트 손익 집계용)
  try {
    const key = 'ames_purchases';
    const list: any[] = JSON.parse(localStorage.getItem(key) || '[]');
    const local = {
      id: item.id,
      orderId: item.orderId || '',
      orderNo: item.orderNo || '',
      purchaseDate: item.purchaseDate || '',
      itemName: item.itemName,
      qty: item.qty || 0,
      unit: item.unit || '',
      unitPriceCny: item.unitPriceCny || 0,
      currency: item.currency || 'CNY',
      appliedRate: item.appliedRate || 191,
      amountKrw: item.amountKrw || 0,
      vendorId: item.vendorId,
      vendorName: item.vendorName,
      paymentMethod: item.paymentMethod || '기타',
      purchaseStatus: item.purchaseStatus || '미발주',
      statementNo: item.statementNo,
      memo: item.memo,
      createdAt: item.createdAt || new Date().toISOString(),
      projectNo: item.projectNo,
      styleNo: item.styleNo,
    };
    const idx = list.findIndex((p: any) => p.id === item.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...local };
    else list.push(local);
    localStorage.setItem(key, JSON.stringify(list));
  } catch { /* ignore */ }
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
