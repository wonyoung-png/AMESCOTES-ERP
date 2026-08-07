-- 간편등록(초안) 지원 (2026-08-07)
-- 밖에서 최소 정보만 넣고 저장 → PC 에서 나머지를 채워 확정한다.
-- Dashboard 가 '선적중'·'통관중' 을 진행 상태로 집계하므로 함께 허용한다.
alter table production_orders drop constraint if exists production_orders_status_check;
alter table production_orders
  add constraint production_orders_status_check
  check (status in ('초안','발주생성','샘플승인','생산중','생산완료','선적중','통관중','입고완료'));

notify pgrst, 'reload schema';
