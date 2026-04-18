-- AMESCOTES ERP — 마이그레이션: items 테이블에 사후원가/확정판매가 컬럼 추가
-- Supabase 대시보드 SQL 에디터에서 실행하세요.
-- 실행 후 BOM 관리에서 저장하면 품목마스터에 총원가액/확정판매가/실현배수가 자동 표시됩니다.

ALTER TABLE items ADD COLUMN IF NOT EXISTS post_cost_krw numeric DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS confirmed_sale_price numeric DEFAULT 0;
