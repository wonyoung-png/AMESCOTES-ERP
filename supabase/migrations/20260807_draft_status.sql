-- 간편등록(초안) 지원 (2026-08-07)
-- 밖에서 최소 정보만 넣고 저장 → PC 에서 나머지를 채워 확정한다.
-- 기존 status CHECK 제약이 있으면 '초안' 을 허용하도록 갈아끼운다.
alter table production_orders drop constraint if exists production_orders_status_check;
alter table production_orders
  add constraint production_orders_status_check
  check (status in ('초안','발주생성','생산중','생산완료','입고완료'));

notify pgrst, 'reload schema';
