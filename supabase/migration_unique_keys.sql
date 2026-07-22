-- AMESCOTES ERP — 중복 방지 UNIQUE 인덱스
--
-- 배경: CLAUDE.md 레드라인 "발주번호/스타일번호/거래처명 중복 생성 금지"가
--       DB 제약 없이 클라이언트 Math.max()+1 채번에만 의존하고 있었습니다.
--       두 사람이 동시에 발주하거나, 캐시가 비어 있는 새 PC에서 발주하면
--       같은 발주번호가 서로 다른 id로 두 건 생성됩니다.
--
-- ⚠️ 실행 순서: 반드시 1단계로 중복을 먼저 확인하고, 있으면 정리한 뒤 2단계를 실행하세요.
--    (중복이 남아 있으면 2단계가 실패합니다 — 데이터를 지우지 않으니 안전합니다)

-- ═══════════════════════════════════════════
-- 1단계: 기존 중복 확인 (먼저 실행해서 결과를 보세요)
-- ═══════════════════════════════════════════

-- 발주번호 중복
SELECT order_no, count(*) AS 건수, array_agg(id) AS ids
FROM production_orders
WHERE order_no IS NOT NULL AND order_no <> ''
GROUP BY order_no HAVING count(*) > 1
ORDER BY count(*) DESC;

-- 스타일번호 중복
SELECT style_no, count(*) AS 건수, array_agg(id) AS ids
FROM items
WHERE style_no IS NOT NULL AND style_no <> ''
GROUP BY style_no HAVING count(*) > 1
ORDER BY count(*) DESC;

-- 거래처명 중복
SELECT name, count(*) AS 건수, array_agg(id) AS ids
FROM vendors
WHERE name IS NOT NULL AND name <> ''
GROUP BY name HAVING count(*) > 1
ORDER BY count(*) DESC;

-- ═══════════════════════════════════════════
-- 2단계: UNIQUE 인덱스 생성
-- (위 3개 쿼리가 모두 0건일 때 실행하세요)
-- ═══════════════════════════════════════════

-- 발주번호: NULL·빈문자열은 제외한 부분 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_orders_order_no
  ON production_orders (order_no)
  WHERE order_no IS NOT NULL AND order_no <> '';

-- 스타일번호
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_style_no
  ON items (style_no)
  WHERE style_no IS NOT NULL AND style_no <> '';

-- 거래처명
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_name
  ON vendors (name)
  WHERE name IS NOT NULL AND name <> '';

-- ═══════════════════════════════════════════
-- 확인
-- ═══════════════════════════════════════════
SELECT indexname, tablename
FROM pg_indexes
WHERE indexname IN ('uq_production_orders_order_no', 'uq_items_style_no', 'uq_vendors_name');
