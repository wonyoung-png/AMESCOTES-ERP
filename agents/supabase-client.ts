// 서버 사이드 Supabase 클라이언트 (service role key 사용)
// ⚠ lazy 초기화: import 시점에 throw하지 않음 → service key 없어도 모듈 로드는 성공
//    (OCR 등 Supabase 불필요 기능이 같은 라우터에 있어도 죽지 않도록)
//    실제 supabase.* 사용 시점에만 key 검증
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.'
    );
  }
  _client = createClient(supabaseUrl, supabaseServiceKey);
  return _client;
}

// 하위호환: 기존 `import { supabase }` 사용처를 위한 Proxy
// 실제 메서드 접근(supabase.from 등) 시점에 getSupabase() 실행 → 그때 검증
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
