// Supabase ↔ localStorage 양방향 동기화
// 앱 시작 시 한 번 실행.
// - Supabase 데이터와 localStorage 데이터를 ID 기준으로 병합
// - Supabase 우선, 단 localStorage에만 있는 데이터도 보존
// - localStorage 전용 데이터는 Supabase에 업로드(백필)

import { supabase } from './supabase';

// snake_case → camelCase 변환 (최상위 키만)
function toCamelCase(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
      v,
    ])
  );
}

// camelCase → snake_case 변환 (최상위 키만)
function toSnakeCase(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()),
      v,
    ])
  );
}

const TABLE_KEY_MAP: { table: string; key: string }[] = [
  { table: 'vendors',           key: 'ames_vendors' },
  { table: 'items',             key: 'ames_items' },
  { table: 'samples',           key: 'ames_samples' },
  { table: 'boms',              key: 'ames_boms' },
  { table: 'production_orders', key: 'ames_orders' },
  { table: 'materials',         key: 'ames_materials' },
];

/**
 * ID 기준으로 두 배열을 병합합니다.
 * - Supabase에 있는 것: Supabase 데이터 우선
 * - localStorage에만 있는 것: 보존 (이후 Supabase에 업로드)
 * - Supabase에만 있는 것: 그대로 포함
 */
function mergeById(
  supabaseItems: Record<string, any>[],
  localItems: Record<string, any>[]
): Record<string, any>[] {
  const supabaseMap = new Map(supabaseItems.map(item => [item.id, item]));
  const localMap = new Map(localItems.map(item => [item.id, item]));

  // Supabase 데이터 기반으로 시작
  const merged = new Map(supabaseMap);

  // localStorage에만 있는 아이템 추가 (Supabase에 없는 것만)
  for (const [id, item] of localMap) {
    if (!supabaseMap.has(id)) {
      merged.set(id, item);
    }
  }

  return Array.from(merged.values());
}

export async function syncFromSupabase(): Promise<void> {
  for (const { table, key } of TABLE_KEY_MAP) {
    try {
      // 1. Supabase에서 데이터 가져오기
      const { data: supabaseRaw, error } = await supabase.from(table).select('*');
      if (error) {
        console.warn(`[sync] ${table} Supabase 조회 실패:`, error.message);
        // 실패해도 localStorage 데이터 그대로 유지
        continue;
      }

      const supabaseData = (supabaseRaw || []).map(row =>
        toCamelCase(row as Record<string, any>)
      );

      // 2. localStorage에서 데이터 가져오기
      let localData: Record<string, any>[] = [];
      try {
        const raw = localStorage.getItem(key);
        localData = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(localData)) localData = [];
      } catch {
        localData = [];
      }

      // 3. ID 기준 병합 (Supabase 우선, localStorage 전용 보존)
      const merged = mergeById(supabaseData, localData);

      // 4. 병합된 데이터를 localStorage에 저장
      localStorage.setItem(key, JSON.stringify(merged));
      console.log(
        `[sync] ${table} 병합 완료 ` +
        `(Supabase: ${supabaseData.length}건, 로컬: ${localData.length}건, 병합: ${merged.length}건)`
      );

      // 5. localStorage에만 있던 데이터를 Supabase에 업로드 (백필)
      const supabaseIds = new Set(supabaseData.map(item => item.id));
      const localOnly = localData.filter(item => item.id && !supabaseIds.has(item.id));

      if (localOnly.length > 0) {
        console.log(`[sync] ${table} 로컬 전용 ${localOnly.length}건 Supabase에 업로드 중...`);
        for (const item of localOnly) {
          try {
            const { error: upsertErr } = await supabase
              .from(table)
              .upsert(toSnakeCase(item));
            if (upsertErr) {
              console.warn(
                `[sync] ${table} 업로드 실패 (id: ${item.id}):`,
                upsertErr.message
              );
            }
          } catch (uploadErr) {
            console.warn(`[sync] ${table} 업로드 오류 (id: ${item.id}):`, uploadErr);
          }
        }
        console.log(`[sync] ${table} 로컬 전용 데이터 업로드 완료`);
      }
    } catch (err) {
      console.warn(`[sync] ${table} 동기화 중 오류 (localStorage 유지):`, err);
    }
  }
}
