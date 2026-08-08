-- 공장 컨펌 (2026-08-07)
-- 발주서를 보낸 뒤 공장이 "받았다 / 이 납기로 가능하다" 회신한 내용을 남긴다.
-- 나중에 납기 분쟁이 생겼을 때 근거가 되는 기록.
alter table production_orders
  add column if not exists sent_at        timestamptz,   -- 발주서 전달 시점
  add column if not exists confirmed_at   timestamptz,   -- 공장 회신 시점
  add column if not exists confirmed_date date,          -- 공장이 확정한 납기
  add column if not exists confirm_note   text;          -- 회신 내용 메모

notify pgrst, 'reload schema';
