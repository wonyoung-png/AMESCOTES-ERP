-- migration_unique_keys.sql 중 운영 데이터와 호환되는 것만 적용
-- uq_items_style_no 제외: 운영에 27SS 데모 중복 60품목 존재(HANDOVER §6, 대표 정리 결정 대기)
-- → 중복 정리 후 원본 마이그레이션 2단계를 별도 적용할 것

CREATE UNIQUE INDEX IF NOT EXISTS uq_production_orders_order_no
  ON production_orders (order_no)
  WHERE order_no IS NOT NULL AND order_no <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_name
  ON vendors (name)
  WHERE name IS NOT NULL AND name <> '';
