-- 미지급·입출고가 서버에 저장되지 않던 원인 (2026-08-07)
-- 코드(phase1.ts syncPayable / syncReceiptLog)가 보내는 컬럼이 운영 DB에 없어
-- PostgREST 가 upsert 전체를 거부했고, 호출부가 .catch(()=>{}) 로 삼켜서
-- 화면에는 저장된 것처럼 보이지만 그 브라우저에만 남아 있었다.
alter table payables
  add column if not exists payee_type      text,
  add column if not exists order_id        text,
  add column if not exists receipt_log_ids jsonb default '[]'::jsonb;

alter table receipt_logs
  add column if not exists destination text,
  add column if not exists color       text,
  add column if not exists is_advance  boolean default false;

notify pgrst, 'reload schema';
