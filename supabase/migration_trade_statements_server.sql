-- 거래명세표를 서버 정본으로
--
-- 지금까지 거래명세표는 사실상 localStorage 전용이었다.
-- 테이블은 있는데 올리는 길은 migrateLocalToSupabase() 하나뿐이고 그것도 '매출·영업이익' 화면을
-- 열어야 돌았다. 내려받는 길은 아예 없었다 (syncFromSupabase 목록에 빠져 있었다).
-- 그래서 만든 사람 브라우저에서만 보였다 — 경리도 다른 담당자도 못 본다.
--
-- TradeStatement 타입에는 있는데 테이블에 없던 칸 둘을 더한다.

alter table public.trade_statements add column if not exists tax_invoice_no text;
alter table public.trade_statements add column if not exists collected_date date;
alter table public.trade_statements add column if not exists updated_at timestamptz not null default now();

create index if not exists trade_statements_vendor_idx on public.trade_statements (vendor_id, issue_date desc);
create index if not exists trade_statements_no_idx     on public.trade_statements (statement_no);

grant all on public.trade_statements to anon;
