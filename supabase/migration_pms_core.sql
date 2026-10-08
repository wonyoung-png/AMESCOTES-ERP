-- PMS → ERP 통합 1단계: PMS(SQLite) 의 공용 저장소를 PostgreSQL 로. docs/PMS_MERGE_PLAN.md
-- 브랜드는 PMS 처럼 키 접두어(aetaloof::)가 아니라 brand 칼럼. 서버(erp_server)만 읽고 쓴다.

-- 시트형 데이터 (일일점검·재고관리·상품 리스트 …). 한 시트 = 한 행, 머리글·행은 JSON 배열 그대로.
-- ponytail: PMS 와 같은 통짜 JSON. 시트가 수만 행이 되면 행 단위 테이블로.
create table if not exists public.pms_sheets (
  brand       text not null default 'lumen',
  name        text not null,
  headers     jsonb not null default '[]',
  rows        jsonb not null default '[]',
  updated_at  timestamptz not null default now(),
  primary key (brand, name)
);

create table if not exists public.pms_meta (
  brand  text not null default 'lumen',
  key    text not null,
  val    text,
  updated_at timestamptz not null default now(),
  primary key (brand, key)
);

create table if not exists public.pms_cache (
  brand  text not null default 'lumen',
  key    text not null,
  data   jsonb,
  at     timestamptz not null default now(),
  primary key (brand, key)
);

-- SKU 일별 판매 (PMS services/sales.py). 금액은 채널 통화 그대로 (쇼피파이=USD).
create table if not exists public.pms_sales (
  brand    text not null default 'lumen',
  date     date not null,
  channel  text not null,
  sku      text not null,
  title    text,
  qty      numeric not null default 0,
  amount   numeric not null default 0,
  primary key (brand, date, channel, sku)
);
create index if not exists pms_sales_sku on public.pms_sales (brand, sku, date);

-- 크론 실행 기록 — 실패를 삼키지 않고 남긴다 (PMS 는 sales·watchdog 실패를 '정상'으로 기록했다)
create table if not exists public.cron_runs (
  id          bigserial primary key,
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  error       text,
  note        text
);
create index if not exists cron_runs_job on public.cron_runs (job, started_at desc);

-- 브라우저 역할(anon·authenticated)과 기본 권한(PUBLIC) 모두 막고 서버만 (코덱스 지적)
revoke all on public.pms_sheets, public.pms_meta, public.pms_cache, public.pms_sales, public.cron_runs from public, anon, authenticated;
revoke all on sequence public.cron_runs_id_seq from public, anon, authenticated;
grant all on public.pms_sheets, public.pms_meta, public.pms_cache, public.pms_sales, public.cron_runs to erp_server;
grant usage, select on sequence public.cron_runs_id_seq to erp_server;
notify pgrst, 'reload schema';
