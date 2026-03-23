# 마이그레이션 필요 — Supabase 스키마 업데이트

## 실행 방법
Supabase 대시보드 → SQL Editor에서 아래 SQL 실행:

```sql
-- items 테이블에 BOM 연동 컬럼 추가
ALTER TABLE items ADD COLUMN IF NOT EXISTS has_bom boolean DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS base_cost_krw numeric;

-- production_orders 테이블 확장
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
```

## 영향
- BOM 저장 시 items.has_bom = true, items.base_cost_krw = 원가 자동 업데이트
- production_orders에 상세 발주 정보 저장 가능

## 현재 상태 (마이그레이션 전)
- 앱은 정상 동작함 (localStorage에 저장, Supabase 실패는 경고만)
- BOM → items 연동 업데이트가 Supabase에 반영 안 됨
- 발주 등록 시 일부 컬럼만 Supabase에 저장됨
