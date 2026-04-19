-- 아뜰리에드루멘 품목: delivery_price → confirmed_sale_price 이전 후 납품가 초기화
-- Supabase 대시보드 SQL 에디터에서 실행하세요.

-- 1) 대상 확인 (실행 전 먼저 조회)
-- SELECT id, style_no, name, delivery_price, confirmed_sale_price
-- FROM items
-- WHERE buyer_id = (SELECT id FROM vendors WHERE name LIKE '%아뜰리에드루멘%' LIMIT 1)
--   AND delivery_price > 0;

-- 2) 실제 업데이트
--    confirmed_sale_price 가 이미 있으면 덮어쓰지 않고, 없는 경우에만 복사
UPDATE items
SET
  confirmed_sale_price = CASE
    WHEN confirmed_sale_price IS NULL OR confirmed_sale_price = 0
    THEN delivery_price
    ELSE confirmed_sale_price
  END,
  delivery_price = 0
WHERE
  buyer_id = (SELECT id FROM vendors WHERE name LIKE '%아뜰리에드루멘%' LIMIT 1)
  AND delivery_price > 0;
