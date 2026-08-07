-- 생산발주 저장 실패 수정 (2026-08-07)
-- 코드(tableColumns.ts · upsertOrder)는 아래 5개 컬럼을 보내는데 운영 DB에 없어
-- PostgREST 가 insert 를 거부 → 발주가 한 건도 저장되지 않았다.
alter table production_orders
  add column if not exists revision            integer default 0,
  add column if not exists is_reorder          boolean default false,
  add column if not exists nego_history        jsonb   default '[]'::jsonb,
  add column if not exists trade_statement_id  text,
  add column if not exists expense_id          text;

notify pgrst, 'reload schema';
