-- AMESCOTES ERP — 마이그레이션: Missing 컬럼 추가
-- Supabase 대시보드 SQL 에디터에서 실행하세요.

-- items 테이블에 has_bom, base_cost_krw 추가
ALTER TABLE items ADD COLUMN IF NOT EXISTS has_bom boolean DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS base_cost_krw numeric;

-- production_orders 테이블에 확장 컬럼 추가
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS order_no text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS style_name text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS style_id text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS season text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS vendor_name text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS delivery_date date;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS factory_unit_price_cny numeric;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS factory_unit_price_krw numeric;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS factory_currency text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS bom_id text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS bom_type text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS color_qtys jsonb;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS hq_supply_items jsonb;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS received_qty integer;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS defect_qty integer;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS defect_note text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS received_date date;
