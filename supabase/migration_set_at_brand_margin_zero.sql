-- 아뜰리에드루멘(AT 브랜드) BOM 생산마진율 0으로 일괄 수정
-- Supabase 대시보드 SQL 에디터에서 실행하세요.
-- 실행 전: SELECT count(*) 로 대상 건수 확인 권장

-- 대상 확인 쿼리 (먼저 실행해서 건수 확인)
-- SELECT b.id, b.style_no, b.production_margin_rate
-- FROM boms b
-- WHERE b.style_id IN (
--   SELECT i.id FROM items i
--   WHERE i.buyer_id = (SELECT id FROM vendors WHERE name LIKE '%아뜰리에드루멘%' LIMIT 1)
-- )
-- OR b.style_no IN (
--   SELECT i.style_no FROM items i
--   WHERE i.buyer_id = (SELECT id FROM vendors WHERE name LIKE '%아뜰리에드루멘%' LIMIT 1)
-- );

-- 실제 업데이트
UPDATE boms
SET production_margin_rate = 0
WHERE style_id IN (
  SELECT i.id FROM items i
  WHERE i.buyer_id = (SELECT id FROM vendors WHERE name LIKE '%아뜰리에드루멘%' LIMIT 1)
)
OR style_no IN (
  SELECT i.style_no FROM items i
  WHERE i.buyer_id = (SELECT id FROM vendors WHERE name LIKE '%아뜰리에드루멘%' LIMIT 1)
);
