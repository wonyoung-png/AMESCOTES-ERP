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

// items localStorage에서 styleNo로 item id 찾기
function findItemIdByStyleNo(styleNo: string): string | undefined {
  try {
    const raw = localStorage.getItem('ames_items');
    if (!raw) return undefined;
    const items: Array<Record<string, any>> = JSON.parse(raw);
    const found = items.find(i => i.styleNo === styleNo || i.style_no === styleNo);
    return found?.id;
  } catch {
    return undefined;
  }
}

// BOM 데이터 특수 변환
// Supabase boms 테이블: snake_case 컬럼 + JSONB 필드
// 앱에서 사용하는 ExtBom 구조(camelCase + colorBoms)로 완전 변환
function convertBomRow(row: Record<string, any>): Record<string, any> {
  const base = toCamelCase(row);

  // styleId: items localStorage에서 styleNo로 찾기
  const styleNo = base.styleNo ?? base.style_no ?? '';
  const styleId = base.styleId ?? findItemIdByStyleNo(styleNo) ?? styleNo;

  // pre_materials(JSONB) → lines
  const preMats = base.preMaterials ?? base.lines ?? base.pre_materials;
  const lines = Array.isArray(preMats) ? preMats.map(normalizeBomLine) : [];

  // post_materials(JSONB) → postMaterials
  const postMats = base.postMaterials ?? base.post_materials;
  const postMaterials = Array.isArray(postMats) ? postMats.map(normalizeBomLine) : [];

  // postProcessLines 정규화
  const postProcLines = base.postProcessLines ?? base.post_process_lines;
  const postProcessLines = Array.isArray(postProcLines) ? postProcLines.map(normalizePostLine) : [];

  // colorBoms: 이미 colorBoms 배열이 있으면 정규화, 없으면 pre_materials로 기본 탭 생성
  let colorBoms: Array<Record<string, any>>;
  if (Array.isArray(base.colorBoms) && base.colorBoms.length > 0) {
    colorBoms = base.colorBoms.map(normalizeColorBom);
  } else if (Array.isArray(base.color_boms) && base.color_boms.length > 0) {
    colorBoms = base.color_boms.map(normalizeColorBom);
  } else {
    // Supabase에서 pre_materials로만 저장된 경우 → '기본' 컬러 탭으로 변환
    colorBoms = [{
      color: '기본',
      lines,
      postProcessLines: [],
      processingFee: base.preProcessingFee ?? base.pre_processing_fee ?? 0,
    }];
  }

  // postColorBoms: 이미 있으면 정규화, 없으면 post_materials로 기본 탭 생성 (데이터 있을 때만)
  let postColorBoms: Array<Record<string, any>> | undefined;
  if (Array.isArray(base.postColorBoms) && base.postColorBoms.length > 0) {
    postColorBoms = base.postColorBoms.map(normalizeColorBom);
  } else if (Array.isArray(base.post_color_boms) && base.post_color_boms.length > 0) {
    postColorBoms = base.post_color_boms.map(normalizeColorBom);
  } else if (postMaterials.length > 0) {
    postColorBoms = [{
      color: '기본',
      lines: postMaterials,
      postProcessLines: [],
      processingFee: base.postProcessingFee ?? base.post_processing_fee ?? 0,
    }];
  } else {
    postColorBoms = [];
  }

  // pnl 필드 정규화
  const pnl = base.pnl ?? {
    discountRate: 0.05,
    platformFeeRate: 0.30,
    sgaRate: 0.10,
  };

  return {
    ...base,
    styleId,
    styleNo,
    styleName: base.styleName ?? base.style_name ?? '',
    season: base.season ?? '',
    erpCategory: base.erpCategory ?? base.erp_category ?? '',
    designer: base.designer ?? '',
    lineName: base.lineName ?? base.line_name ?? '',
    version: base.version ?? 1,
    snapshotCnyKrw: base.snapshotCnyKrw ?? base.exchangeRateCny ?? base.exchange_rate_cny ?? 191,
    processingFee: base.preProcessingFee ?? base.pre_processing_fee ?? base.processingFee ?? 0,
    productionMarginRate: base.productionMarginRate ?? 0.16,
    logisticsCostKrw: base.logisticsCostKrw ?? base.logistics_cost_krw ?? 0,
    customsRate: base.customsRate ?? 0,
    packagingCostKrw: base.packagingCostKrw ?? 0,
    packingCostKrw: base.packingCostKrw ?? 0,
    pnl,
    colorBoms,
    postColorBoms,
    lines,
    postMaterials,
    postProcessLines,
    postProcessingFee: base.postProcessingFee ?? base.post_processing_fee ?? 0,
    createdAt: base.createdAt ?? base.created_at ?? new Date().toISOString(),
    updatedAt: base.updatedAt ?? base.updated_at ?? new Date().toISOString(),
  };
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

      // ─── BOM 테이블은 스마트 병합으로 동기화 ───
      // 변환된 Supabase BOM(ExtBom 형식, colorBoms 포함)과 localStorage를 병합.
      // - 로컬에 없는 BOM → 추가
      // - 로컬에 있지만 colorBoms가 없는(구형식) BOM → Supabase 버전으로 교체
      // - 로컬에 있고 colorBoms가 이미 있는 BOM → 로컬 유지 (앱에서 수정한 데이터 보호)
      if (key === 'ames_boms') {
        try {
          const localRaw = localStorage.getItem(key);
          const localBoms: Array<Record<string, any>> = localRaw ? JSON.parse(localRaw) : [];

          const localById = new Map<string, Record<string, any>>();
          localBoms.forEach(b => { if (b.id) localById.set(b.id, b); });

          let added = 0;
          let updated = 0;
          let kept = 0;

          const merged: Array<Record<string, any>> = [...localBoms];

          for (const remote of converted) {
            if (!remote.id) continue;
            const local = localById.get(remote.id);
            if (!local) {
              // 로컬에 없음 → 추가
              merged.push(remote);
              added++;
            } else if (!Array.isArray(local.colorBoms) || local.colorBoms.length === 0) {
              // 로컬에 있지만 colorBoms 없음(구형식) → Supabase 버전으로 교체
              const idx = merged.findIndex(b => b.id === remote.id);
              if (idx >= 0) merged[idx] = remote;
              updated++;
            } else {
              // 로컬에 colorBoms 있음 → 유지
              kept++;
            }
          }

          localStorage.setItem(key, JSON.stringify(merged));
          console.log(`[syncFromSupabase] boms 병합 완료 — 신규 ${added}건 추가, 업데이트 ${updated}건(colorBoms 복원), 유지 ${kept}건`);
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
