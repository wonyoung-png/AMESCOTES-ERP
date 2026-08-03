// Supabase 클라이언트 설정
import { createClient } from '@supabase/supabase-js'

// URL 미지정 시 같은 오리진 사용 — 셀프호스팅 PostgREST(Caddy가 /rest/v1/* 라우팅)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || window.location.origin
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
