// Supabase → localStorage 동기화
// 앱 시작 시 한 번 실행. 실패해도 localStorage 데이터 그대로 유지.

import { supabase } from './supabase';

// snake_case → camelCase 변환 (shallow, 최상위 키만)
function toCamelCase(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
      v,
    ])
  );
}

// BOM 행(ExtBomLine) 배열 정규화 — snake_case/camelCase 혼용 처리
function normalizeBomLine(l: any): any {
  if (!l || typeof l !== 'object') return l;
  return {
    id: l.id,
    category: l.category,
    subPart: l.subPart ?? l.sub_part,
    itemName: l.itemName ?? l.item_name ?? '',
    spec: l.spec ?? '',
    unit: l.unit ?? 'EA',
    customUnit: l.customUnit ?? l.custom_unit ?? '',
    unitPriceCny: l.unitPriceCny ?? l.unit_price_cny ?? l.unitPrice ?? l.unit_price ?? 0,
    netQty: l.netQty ?? l.net_qty ?? 0,
    lossRate: l.lossRate ?? l.loss_rate ?? 0.05,
    isHqProvided: l.isHqProvided ?? l.is_hq_provided ?? false,
    isVendorProvided: l.isVendorProvided ?? l.is_vendor_provided ?? false,
    vendorName: l.vendorName ?? l.vendor_name ?? '',
    vendorId: l.vendorId ?? l.vendor_id ?? '',
    isNewVendor: l.isNewVendor ?? l.is_new_vendor ?? false,
    memo: l.memo ?? '',
    imageUrl: l.imageUrl ?? l.image_url ?? undefined,
  };
}

// PostProcessLine 정규화
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

// ColorBom 정규화
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

// BOM 데이터 특수 변환
// Supabase boms 테이블: snake_case 컬럼 + JSONB 필드
// 앱에서 사용하는 ExtBom 구조(camelCase)로 완전 변환
function convertBomRow(row: Record<string, any>): Record<string, any> {
  const base = toCamelCase(row);

  // pre_materials(JSONB) → lines (앱 필드명)
  // Supabase에서 pre_materials로 저장된 경우 lines로 매핑
  const preMats = base.preMaterials ?? base.lines ?? base.pre_materials;
  const lines = Array.isArray(preMats) ? preMats.map(normalizeBomLine) : [];

  // post_materials(JSONB) → postMaterials
  const postMats = base.postMaterials ?? base.post_materials;
  const postMaterials = Array.isArray(postMats) ? postMats.map(normalizeBomLine) : [];

  // postProcessLines 정규화
  const postProcLines = base.postProcessLines ?? base.post_process_lines;
  const postProcessLines = Array.isArray(postProcLines) ? postProcLines.map(normalizePostLine) : [];

  // colorBoms/postColorBoms 정규화
  const colorBoms = Array.isArray(base.colorBoms) ? base.colorBoms.map(normalizeColorBom)
    : Array.isArray(base.color_boms) ? base.color_boms.map(normalizeColorBom)
    : undefined;

  const postColorBoms = Array.isArray(base.postColorBoms) ? base.postColorBoms.map(normalizeColorBom)
    : Array.isArray(base.post_color_boms) ? base.post_color_boms.map(normalizeColorBom)
    : undefined;

  // pnl 필드 정규화
  const pnl = base.pnl ?? {
    discountRate: 0.05,
    platformFeeRate: 0.30,
    sgaRate: 0.10,
  };

  const result = {
    ...base,
    lines,
    postMaterials,
    postProcessLines,
    pnl,
  } as Record<string, any>;

  if (colorBoms !== undefined) result.colorBoms = colorBoms;
  if (postColorBoms !== undefined) result.postColorBoms = postColorBoms;

  return result;
}

const TABLE_KEY_MAP: { table: string; key: string; converter?: (row: Record<string, any>) => Record<string, any> }[] = [
  { table: 'vendors',           key: 'ames_vendors' },
  { table: 'items',             key: 'ames_items' },
  { table: 'samples',           key: 'ames_samples' },
  { table: 'boms',              key: 'ames_boms', converter: convertBomRow },
  { table: 'production_orders', key: 'ames_orders' },
];

export async function syncFromSupabase(): Promise<void> {
  for (const { table, key, converter } of TABLE_KEY_MAP) {
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (error) {
        console.warn(`[syncFromSupabase] ${table} 조회 실패:`, error.message);
        continue;
      }
      if (!data || data.length === 0) {
        // 원격에 데이터 없으면 localStorage 유지
        continue;
      }
      const converted = data.map(row =>
        converter ? converter(row as Record<string, any>) : toCamelCase(row as Record<string, any>)
      );

      // ─── BOM 테이블은 병합 방식으로 동기화 (localStorage 데이터 보호) ───
      // Supabase의 BOM은 기본 구조(Bom 타입)로 저장되는 반면,
      // localStorage의 BOM은 ExtBom 타입(colorBoms, postColorBoms 등 포함)으로 저장됨.
      // Supabase 데이터로 localStorage를 무조건 덮어쓰면 ExtBom 형식이 파괴될 수 있으므로
      // localStorage에 있는 BOM을 우선 유지하고, Supabase에만 있는 데이터는 병합.
      if (key === 'ames_boms') {
        try {
          const localRaw = localStorage.getItem(key);
          const localBoms: Array<Record<string, any>> = localRaw ? JSON.parse(localRaw) : [];

          // Supabase에서 온 데이터는 id 기준으로 매핑
          const remoteById = new Map<string, Record<string, any>>();
          converted.forEach(r => { if (r.id) remoteById.set(r.id, r); });

          // 로컬에 있는 BOM은 보존, Supabase에만 있는 BOM은 추가
          const localIds = new Set(localBoms.map(b => b.id));
          const onlyRemote = converted.filter(r => r.id && !localIds.has(r.id));

          if (onlyRemote.length > 0) {
            const merged = [...localBoms, ...onlyRemote];
            localStorage.setItem(key, JSON.stringify(merged));
            console.log(`[syncFromSupabase] boms 병합 완료 — 로컬 ${localBoms.length}건 유지, 원격 신규 ${onlyRemote.length}건 추가`);
          } else {
            console.log(`[syncFromSupabase] boms 로컬 데이터 유지 (${localBoms.length}건) — Supabase에 신규 없음`);
          }
        } catch (mergeErr) {
          console.warn('[syncFromSupabase] boms 병합 중 오류, 로컬 데이터 유지:', mergeErr);
        }
        continue;
      }

      localStorage.setItem(key, JSON.stringify(converted));
      console.log(`[syncFromSupabase] ${table} 동기화 완료 (${converted.length}건)`);
    } catch (err) {
      console.warn(`[syncFromSupabase] ${table} 동기화 중 오류:`, err);
    }
  }
}
