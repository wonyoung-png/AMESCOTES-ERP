-- 공장 보유 재고 (2026-08-07)
-- 재고를 쌓아두지 않지만 가죽·장식은 쓰고 남는다. 발주 전에 공장에 확인해서
-- 남은 만큼 덜 발주하는 방식이라, 물어본 결과를 적어둘 자리를 만든다.
alter table materials
  add column if not exists factory_stock_qty        numeric,
  add column if not exists factory_stock_checked_at date,
  add column if not exists factory_stock_note       text;

notify pgrst, 'reload schema';
