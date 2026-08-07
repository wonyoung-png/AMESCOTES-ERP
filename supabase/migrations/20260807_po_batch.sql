-- 발주 묶음 (2026-08-07)
-- 일괄 발주 1회 = 묶음 1개. 공장에 나가는 발주서는 묶음 단위 1장,
-- 작업지시서는 지금처럼 스타일(=발주번호)별로 따로 만든다.
alter table production_orders
  add column if not exists po_batch_no text;

create index if not exists production_orders_po_batch_idx on production_orders (po_batch_no);
notify pgrst, 'reload schema';
