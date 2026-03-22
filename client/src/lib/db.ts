// AMESCOTES ERP — Supabase DB 레이어
// Supabase를 기본으로 사용하고 오프라인 시 localStorage를 폴백으로 사용합니다.

import { supabase } from './supabase'
import type { Vendor, Item, Sample, Bom } from './store'

// ─── 온라인 여부 확인 ───
function isOnline(): boolean {
  return navigator.onLine
}

// ─── localStorage 키 (store.ts와 동기화) ───
const KEYS = {
  vendors: 'ames_vendors',
  items: 'ames_items',
  samples: 'ames_samples',
  boms: 'ames_boms',
}

// ─── localStorage 헬퍼 ───
function lsGetAll<T>(key: string): T[] {
  try {
    const d = localStorage.getItem(key)
    return d ? JSON.parse(d) : []
  } catch {
    return []
  }
}

function lsSetAll<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data))
}

// ─── 타입 변환: camelCase ↔ snake_case ───

// Vendor: 앱 → DB 행
function vendorToRow(v: Vendor): Record<string, unknown> {
  return {
    id: v.id,
    code: v.code ?? v.vendorCode ?? null,
    name: v.name,
    company_name: v.companyName ?? null,
    type: v.type,
    material_types: v.materialTypes ?? null,
    custom_type: v.customType ?? null,
    contact_name: v.contactName ?? null,
    phone: v.contactPhone ?? null,
    email: v.contactEmail ?? null,
    memo: v.memo ?? null,
    bank_info: v.bankInfo ?? null,
    created_at: v.createdAt,
    updated_at: new Date().toISOString(),
  }
}

// DB 행 → Vendor (필수 필드만 매핑, 나머지는 기본값)
function rowToVendor(row: Record<string, unknown>): Vendor {
  return {
    id: row.id as string,
    code: (row.code as string | undefined) ?? undefined,
    vendorCode: (row.code as string | undefined) ?? undefined,
    name: row.name as string,
    companyName: (row.company_name as string | undefined) ?? undefined,
    type: (row.type as Vendor['type']) ?? '기타',
    materialTypes: (row.material_types as Vendor['materialTypes']) ?? undefined,
    customType: (row.custom_type as string | undefined) ?? undefined,
    contactName: (row.contact_name as string | undefined) ?? undefined,
    contactPhone: (row.phone as string | undefined) ?? undefined,
    contactEmail: (row.email as string | undefined) ?? undefined,
    memo: (row.memo as string | undefined) ?? undefined,
    bankInfo: (row.bank_info as Vendor['bankInfo']) ?? undefined,
    country: '한국',
    currency: 'KRW',
    contactHistory: [],
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
  }
}

// Item: 앱 → DB 행
function itemToRow(item: Item): Record<string, unknown> {
  return {
    id: item.id,
    style_no: item.styleNo,
    name: item.name,
    erp_category: item.erpCategory ?? null,
    sub_category: item.category ?? null,
    buyer_id: item.buyerId ?? null,
    season: item.season,
    designer: null,
    material: item.material ?? null,
    delivery_price: item.deliveryPrice ?? null,
    margin_amount: item.marginAmount ?? null,
    margin_rate: item.marginRate ?? null,
    last_order_date: null,
    memo: item.memo ?? null,
    image_url: item.imageUrl ?? null,
    created_at: item.createdAt,
    updated_at: new Date().toISOString(),
  }
}

// DB 행 → Item
function rowToItem(row: Record<string, unknown>): Item {
  return {
    id: row.id as string,
    styleNo: (row.style_no as string) ?? '',
    name: (row.name as string) ?? '',
    category: (row.sub_category as Item['category']) ?? '기타',
    erpCategory: (row.erp_category as Item['erpCategory']) ?? undefined,
    buyerId: (row.buyer_id as string | undefined) ?? undefined,
    season: (row.season as Item['season']) ?? '26SS',
    material: (row.material as string) ?? '',
    deliveryPrice: (row.delivery_price as number | undefined) ?? undefined,
    marginAmount: (row.margin_amount as number | undefined) ?? undefined,
    marginRate: (row.margin_rate as number | undefined) ?? undefined,
    memo: (row.memo as string | undefined) ?? undefined,
    imageUrl: (row.image_url as string | undefined) ?? undefined,
    hasBom: false,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
  }
}

// Sample: 앱 → DB 행
function sampleToRow(s: Sample): Record<string, unknown> {
  return {
    id: s.id,
    style_no: s.styleNo,
    style_name: s.styleName,
    buyer_id: s.buyerId ?? null,
    season: s.season,
    stage: s.stage,
    assignee: s.assignee ?? null,
    sales_person: s.salesPerson ?? null,
    request_date: s.requestDate ?? null,
    expected_date: s.expectedDate ?? null,
    approved_date: null, // Sample 타입에 approvedDate 없음
    cost_krw: s.costKrw ?? null,
    image_urls: s.imageUrls ?? null,
    material_requests: s.materialRequests ?? null,
    documents: s.documents ?? null,
    memo: s.memo ?? null,
    created_at: s.createdAt,
    updated_at: new Date().toISOString(),
  }
}

// DB 행 → Sample
function rowToSample(row: Record<string, unknown>): Sample {
  const styleNo = (row.style_no as string) ?? ''
  return {
    id: row.id as string,
    styleId: styleNo,
    styleNo,
    styleName: (row.style_name as string) ?? '',
    buyerId: (row.buyer_id as string | undefined) ?? undefined,
    season: (row.season as Sample['season']) ?? '26SS',
    stage: (row.stage as Sample['stage']) ?? '1차',
    assignee: (row.assignee as string | undefined) ?? undefined,
    salesPerson: (row.sales_person as string | undefined) ?? undefined,
    requestDate: (row.request_date as string) ?? new Date().toISOString().slice(0, 10),
    expectedDate: (row.expected_date as string | undefined) ?? undefined,
    costCny: 0,
    costKrw: (row.cost_krw as number | undefined) ?? undefined,
    imageUrls: (row.image_urls as string[] | undefined) ?? [],
    materialRequests: (row.material_requests as Sample['materialRequests']) ?? [],
    documents: (row.documents as Sample['documents']) ?? [],
    memo: (row.memo as string | undefined) ?? undefined,
    billingStatus: '미청구',
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
  }
}

// Bom: 앱 → DB 행
function bomToRow(b: Bom): Record<string, unknown> {
  return {
    id: b.id,
    style_no: b.styleNo,
    style_name: b.styleName,
    season: b.season,
    erp_category: null,
    designer: b.designer ?? null,
    line_name: b.lineName ?? null,
    manufacturing_country: b.manufacturingCountry ?? null,
    currency: b.currency ?? 'CNY',
    exchange_rate_cny: b.exchangeRateCny ?? b.snapshotCnyKrw ?? null,
    exchange_rate_usd: b.exchangeRateUsd ?? b.snapshotUsdKrw ?? null,
    pre_materials: b.lines ?? null,
    pre_processing_fee: b.processingFee ?? null,
    post_materials: b.postMaterials ?? null,
    post_processing_fee: b.postProcessingFee ?? null,
    delivery_price: b.postDeliveryPrice ?? null,
    logistics_cost_krw: b.logisticsCostKrw ?? null,
    production_margin_rate: b.productionMarginRate ?? null,
    memo: b.memo ?? null,
    created_at: b.createdAt,
    updated_at: b.updatedAt ?? new Date().toISOString(),
  }
}

// DB 행 → Bom
function rowToBom(row: Record<string, unknown>): Bom {
  return {
    id: row.id as string,
    styleId: (row.style_no as string) ?? '',
    styleNo: (row.style_no as string) ?? '',
    styleName: (row.style_name as string) ?? '',
    designer: (row.designer as string | undefined) ?? undefined,
    lineName: (row.line_name as string | undefined) ?? undefined,
    manufacturingCountry: (row.manufacturing_country as Bom['manufacturingCountry']) ?? undefined,
    currency: (row.currency as Bom['currency']) ?? 'CNY',
    exchangeRateCny: (row.exchange_rate_cny as number | undefined) ?? undefined,
    exchangeRateUsd: (row.exchange_rate_usd as number | undefined) ?? undefined,
    lines: (row.pre_materials as Bom['lines']) ?? [],
    processingFee: (row.pre_processing_fee as number) ?? 0,
    postProcessLines: [],
    postMaterials: (row.post_materials as Bom['lines']) ?? undefined,
    postProcessingFee: (row.post_processing_fee as number | undefined) ?? undefined,
    postDeliveryPrice: (row.delivery_price as number | undefined) ?? undefined,
    logisticsCostKrw: (row.logistics_cost_krw as number | undefined) ?? undefined,
    productionMarginRate: (row.production_margin_rate as number | undefined) ?? undefined,
    memo: (row.memo as string | undefined) ?? undefined,
    season: '26SS' as Bom['season'],
    version: 1,
    snapshotCnyKrw: (row.exchange_rate_cny as number) ?? 191,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────
// VENDORS
// ─────────────────────────────────────────────

export async function getVendors(): Promise<Vendor[]> {
  if (!isOnline()) {
    return lsGetAll<Vendor>(KEYS.vendors)
  }
  try {
    const { data, error } = await supabase.from('vendors').select('*').order('created_at', { ascending: false })
    if (error) throw error
    const vendors = (data as Record<string, unknown>[]).map(rowToVendor)
    // 로컬 캐시 동기화
    lsSetAll(KEYS.vendors, vendors)
    return vendors
  } catch (err) {
    console.warn('[db] Supabase getVendors 실패, localStorage 폴백:', err)
    return lsGetAll<Vendor>(KEYS.vendors)
  }
}

export async function saveVendor(vendor: Vendor): Promise<void> {
  // localStorage 즉시 업데이트
  const list = lsGetAll<Vendor>(KEYS.vendors)
  const idx = list.findIndex(v => v.id === vendor.id)
  if (idx >= 0) list[idx] = vendor
  else list.push(vendor)
  lsSetAll(KEYS.vendors, list)

  if (!isOnline()) return
  try {
    const { error } = await supabase.from('vendors').upsert(vendorToRow(vendor))
    if (error) throw error
  } catch (err) {
    console.warn('[db] Supabase saveVendor 실패 (localStorage에는 저장됨):', err)
  }
}

export async function deleteVendor(id: string): Promise<void> {
  // localStorage 즉시 삭제
  lsSetAll(KEYS.vendors, lsGetAll<Vendor>(KEYS.vendors).filter(v => v.id !== id))

  if (!isOnline()) return
  try {
    const { error } = await supabase.from('vendors').delete().eq('id', id)
    if (error) throw error
  } catch (err) {
    console.warn('[db] Supabase deleteVendor 실패 (localStorage에는 삭제됨):', err)
  }
}

// ─────────────────────────────────────────────
// ITEMS
// ─────────────────────────────────────────────

export async function getItems(): Promise<Item[]> {
  if (!isOnline()) {
    return lsGetAll<Item>(KEYS.items)
  }
  try {
    const { data, error } = await supabase.from('items').select('*').order('created_at', { ascending: false })
    if (error) throw error
    const items = (data as Record<string, unknown>[]).map(rowToItem)
    lsSetAll(KEYS.items, items)
    return items
  } catch (err) {
    console.warn('[db] Supabase getItems 실패, localStorage 폴백:', err)
    return lsGetAll<Item>(KEYS.items)
  }
}

export async function saveItem(item: Item): Promise<void> {
  const list = lsGetAll<Item>(KEYS.items)
  const idx = list.findIndex(v => v.id === item.id)
  if (idx >= 0) list[idx] = item
  else list.push(item)
  lsSetAll(KEYS.items, list)

  if (!isOnline()) return
  try {
    const { error } = await supabase.from('items').upsert(itemToRow(item))
    if (error) throw error
  } catch (err) {
    console.warn('[db] Supabase saveItem 실패 (localStorage에는 저장됨):', err)
  }
}

export async function deleteItem(id: string): Promise<void> {
  lsSetAll(KEYS.items, lsGetAll<Item>(KEYS.items).filter(v => v.id !== id))

  if (!isOnline()) return
  try {
    const { error } = await supabase.from('items').delete().eq('id', id)
    if (error) throw error
  } catch (err) {
    console.warn('[db] Supabase deleteItem 실패 (localStorage에는 삭제됨):', err)
  }
}

// ─────────────────────────────────────────────
// SAMPLES
// ─────────────────────────────────────────────

export async function getSamples(): Promise<Sample[]> {
  if (!isOnline()) {
    return lsGetAll<Sample>(KEYS.samples)
  }
  try {
    const { data, error } = await supabase.from('samples').select('*').order('created_at', { ascending: false })
    if (error) throw error
    const samples = (data as Record<string, unknown>[]).map(rowToSample)
    lsSetAll(KEYS.samples, samples)
    return samples
  } catch (err) {
    console.warn('[db] Supabase getSamples 실패, localStorage 폴백:', err)
    return lsGetAll<Sample>(KEYS.samples)
  }
}

export async function saveSample(sample: Sample): Promise<void> {
  const list = lsGetAll<Sample>(KEYS.samples)
  const idx = list.findIndex(v => v.id === sample.id)
  if (idx >= 0) list[idx] = sample
  else list.push(sample)
  lsSetAll(KEYS.samples, list)

  if (!isOnline()) return
  try {
    const { error } = await supabase.from('samples').upsert(sampleToRow(sample))
    if (error) throw error
  } catch (err) {
    console.warn('[db] Supabase saveSample 실패 (localStorage에는 저장됨):', err)
  }
}

export async function deleteSample(id: string): Promise<void> {
  lsSetAll(KEYS.samples, lsGetAll<Sample>(KEYS.samples).filter(v => v.id !== id))

  if (!isOnline()) return
  try {
    const { error } = await supabase.from('samples').delete().eq('id', id)
    if (error) throw error
  } catch (err) {
    console.warn('[db] Supabase deleteSample 실패 (localStorage에는 삭제됨):', err)
  }
}

// ─────────────────────────────────────────────
// BOMs
// ─────────────────────────────────────────────

export async function getBoms(): Promise<Bom[]> {
  if (!isOnline()) {
    return lsGetAll<Bom>(KEYS.boms)
  }
  try {
    const { data, error } = await supabase.from('boms').select('*').order('created_at', { ascending: false })
    if (error) throw error
    const boms = (data as Record<string, unknown>[]).map(rowToBom)
    lsSetAll(KEYS.boms, boms)
    return boms
  } catch (err) {
    console.warn('[db] Supabase getBoms 실패, localStorage 폴백:', err)
    return lsGetAll<Bom>(KEYS.boms)
  }
}

export async function saveBom(bom: Bom): Promise<void> {
  const list = lsGetAll<Bom>(KEYS.boms)
  const idx = list.findIndex(v => v.id === bom.id)
  if (idx >= 0) list[idx] = bom
  else list.push(bom)
  lsSetAll(KEYS.boms, list)

  if (!isOnline()) return
  try {
    const { error } = await supabase.from('boms').upsert(bomToRow(bom))
    if (error) throw error
  } catch (err) {
    console.warn('[db] Supabase saveBom 실패 (localStorage에는 저장됨):', err)
  }
}

export async function deleteBom(id: string): Promise<void> {
  lsSetAll(KEYS.boms, lsGetAll<Bom>(KEYS.boms).filter(v => v.id !== id))

  if (!isOnline()) return
  try {
    const { error } = await supabase.from('boms').delete().eq('id', id)
    if (error) throw error
  } catch (err) {
    console.warn('[db] Supabase deleteBom 실패 (localStorage에는 삭제됨):', err)
  }
}
