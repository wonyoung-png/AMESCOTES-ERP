-- 출고지 (2026-08-09)
-- 수기 작업지시서 우측 끝의 '한국출고 / 일본출고 / 태국출고' 칸.
-- 같은 스타일도 발주 건마다 도착지가 달라 공장이 반드시 알아야 한다.
alter table production_orders
  add column if not exists ship_to text;

notify pgrst, 'reload schema';
