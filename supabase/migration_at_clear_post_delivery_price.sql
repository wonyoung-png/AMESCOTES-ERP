-- 아뜰리에드루멘 품목 BOM의 post_delivery_price 초기화
-- items.delivery_price 는 이전 마이그레이션에서 이미 0으로 처리됨
-- Supabase 대시보드 SQL 에디터에서 실행하세요.

-- 1) 대상 확인 (먼저 실행)
-- SELECT b.id, b.style_no, b.post_delivery_price
-- FROM boms b
-- WHERE (
--   b.style_id IN (
--     SELECT i.id FROM items i
--     WHERE i.buyer_id = (SELECT id FROM vendors WHERE name LIKE '%아뜰리에드루멘%' LIMIT 1)
--   )
--   OR b.style_no IN (
--     SELECT i.style_no FROM items i
--     WHERE i.buyer_id = (SELECT id FROM vendors WHERE name LIKE '%아뜰리에드루멘%' LIMIT 1)
--   )
-- )
-- AND b.post_delivery_price > 0;

-- 2) 실제 업데이트
UPDATE boms
SET post_delivery_price = NULL
WHERE (
  style_id IN (
    SELECT i.id FROM items i
    WHERE i.buyer_id = (SELECT id FROM vendors WHERE name LIKE '%아뜰리에드루멘%' LIMIT 1)
  )
  OR style_no IN (
    SELECT i.style_no FROM items i
    WHERE i.buyer_id = (SELECT id FROM vendors WHERE name LIKE '%아뜰리에드루멘%' LIMIT 1)
  )
)
AND post_delivery_price > 0;
