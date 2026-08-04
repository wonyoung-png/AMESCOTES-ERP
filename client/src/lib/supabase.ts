// Supabase 클라이언트 설정
import { createClient } from '@supabase/supabase-js'

// URL 미지정 시 같은 오리진 사용 — 셀프호스팅 PostgREST(Caddy가 /rest/v1/* 라우팅)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || window.location.origin
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// accessToken: 서버(/api/login)가 발급한 세션 토큰만 사용 — 토큰 없으면 REST 접근 불가
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: async () => localStorage.getItem('erp_token'),
})
