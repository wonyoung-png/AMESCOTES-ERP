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

const TABLE_KEY_MAP: { table: string; key: string }[] = [
  { table: 'vendors',           key: 'ames_vendors' },
  { table: 'items',             key: 'ames_items' },
  { table: 'samples',           key: 'ames_samples' },
  { table: 'boms',              key: 'ames_boms' },
  { table: 'production_orders', key: 'ames_orders' },
];

export async function syncFromSupabase(): Promise<void> {
  for (const { table, key } of TABLE_KEY_MAP) {
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
      const converted = data.map(row => toCamelCase(row as Record<string, any>));
      localStorage.setItem(key, JSON.stringify(converted));
      console.log(`[syncFromSupabase] ${table} 동기화 완료 (${converted.length}건)`);
    } catch (err) {
      console.warn(`[syncFromSupabase] ${table} 동기화 중 오류:`, err);
    }
  }
}
