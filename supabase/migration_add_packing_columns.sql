-- AMESCOTES ERP — 마이그레이션: BOM 물류비/포장비/패킹재 컬럼 추가
-- Supabase 대시보드 SQL 에디터에서 실행하세요.
-- 실행 후 앱에서 물류비/포장비/패킹재가 Supabase DB에도 저장됩니다.

ALTER TABLE boms ADD COLUMN IF NOT EXISTS packaging_cost_krw numeric DEFAULT 0;
ALTER TABLE boms ADD COLUMN IF NOT EXISTS packing_cost_krw numeric DEFAULT 0;
