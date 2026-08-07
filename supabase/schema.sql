-- AMESCOTES ERP — Supabase 스키마
-- Supabase 대시보드의 SQL 에디터에서 실행하세요.

-- ─── 거래처/바이어 ───
create table if not exists vendors (
  id text primary key,
  code text,
  name text not null,
  company_name text,
  type text,
  material_types text[],
  custom_type text,
  contact_name text,
  phone text,
  email text,
  memo text,
  bank_info jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── 품목 마스터 ───
create table if not exists items (
  id text primary key,
  style_no text,
  name text,
  erp_category text,
  sub_category text,
  buyer_id text references vendors(id),
  season text,
  designer text,
  material text,
  delivery_price numeric,
  margin_amount numeric,
  margin_rate numeric,
  last_order_date date,
  memo text,
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── 샘플 관리 ───
create table if not exists samples (
  id text primary key,
  style_no text,
  style_name text,
  buyer_id text references vendors(id),
  season text,
  stage text,
  assignee text,
  sales_person text,
  request_date date,
  expected_date date,
  approved_date date,
  cost_krw numeric,
  image_urls text[],
  material_requests jsonb,
  documents jsonb,
  memo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── BOM / 원가 ───
create table if not exists boms (
  id text primary key,
  style_no text,
  style_name text,
  season text,
  erp_category text,
  designer text,
  line_name text,
  manufacturing_country text,
  currency text default 'CNY',
  exchange_rate_cny numeric,
  exchange_rate_usd numeric,
  pre_materials jsonb,
  pre_processing_fee numeric,
  post_materials jsonb,
  post_processing_fee numeric,
  delivery_price numeric,
  logistics_cost_krw numeric,
  packaging_cost_krw numeric,
  packing_cost_krw numeric,
  production_margin_rate numeric,
  memo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── 생산 오더 ───
create table if not exists production_orders (
  id text primary key,
  style_no text,
  buyer_id text references vendors(id),
  vendor_id text references vendors(id),
  quantity integer,
  unit_price numeric,
  currency text,
  order_date date,
  expected_date date,
  status text,
  memo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── 자재 마스터 ───
create table if not exists materials (
  id text primary key,
  name text not null,
  spec text,
  unit text,
  unit_price numeric,
  currency text default 'CNY',
  vendor_id text references vendors(id),
  category text,
  stock_qty numeric,
  memo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── 판매 데이터 (W컨셉) ───
create table if not exists sales_wconcept (
  id text primary key,
  date date,
  style_no text,
  product_name text,
  quantity integer,
  revenue numeric,
  impressions integer,
  clicks integer,
  cpc numeric,
  roas numeric,
  ad_spend numeric,
  created_at timestamptz default now()
);

-- ─── 판매 데이터 (29CM) ───
create table if not exists sales_29cm (
  id text primary key,
  date date,
  style_no text,
  product_name text,
  quantity integer,
  revenue numeric,
  created_at timestamptz default now()
);

-- ─── 판매 데이터 (자사몰) ───
create table if not exists sales_atlm (
  id text primary key,
  date date,
  style_no text,
  product_name text,
  quantity integer,
  revenue numeric,
  created_at timestamptz default now()
);

-- ─── 환율 이력 ───
create table if not exists exchange_rates (
  id text primary key,
  date date,
  cny_krw numeric,
  usd_krw numeric,
  created_at timestamptz default now()
);

-- ─── updated_at 자동 갱신 트리거 함수 ───
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 각 테이블에 트리거 적용
create trigger vendors_updated_at before update on vendors for each row execute function update_updated_at_column();
create trigger items_updated_at before update on items for each row execute function update_updated_at_column();
create trigger samples_updated_at before update on samples for each row execute function update_updated_at_column();
create trigger boms_updated_at before update on boms for each row execute function update_updated_at_column();
create trigger production_orders_updated_at before update on production_orders for each row execute function update_updated_at_column();
create trigger materials_updated_at before update on materials for each row execute function update_updated_at_column();

-- ─── 마이그레이션: Missing 컬럼 추가 (2026-03-23) ───
-- items 테이블: BOM 연동 컬럼
ALTER TABLE items ADD COLUMN IF NOT EXISTS has_bom boolean DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS base_cost_krw numeric;

-- production_orders 테이블: 확장 컬럼
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS order_no text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS style_name text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS style_id text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS season text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS vendor_name text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS delivery_date date;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS factory_unit_price_cny numeric;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS factory_unit_price_krw numeric;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS factory_currency text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS bom_id text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS bom_type text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS color_qtys jsonb;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS hq_supply_items jsonb;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS received_qty integer;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS defect_qty integer;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS defect_note text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS received_date date;

-- ─── 거래처 국내/해외 분리 (2026-08-06) ───
-- 기존 vendors 테이블에 누락돼 있던 폼 입력 항목 + region 컬럼 추가
alter table vendors
  add column if not exists region text default '국내',   -- '국내' | '해외'
  add column if not exists vendor_code text,
  add column if not exists name_en text,
  add column if not exists name_cn text,
  add column if not exists biz_reg_no text,
  add column if not exists address text,
  add column if not exists billing_email text,
  add column if not exists country text,
  add column if not exists currency text,
  add column if not exists wechat_id text,
  add column if not exists lead_time_days integer,
  add column if not exists processing_unit_cost numeric,
  add column if not exists billing_type text,
  add column if not exists settlement_cycle text,
  add column if not exists commission_rate numeric,
  add column if not exists tt_condition text,
  add column if not exists custom_material_type text,
  add column if not exists contact_history jsonb;

-- ─── 브랜드 다중 등록 · 바이어 지정 품번 (2026-08-07) ───
alter table vendors add column if not exists brands text[];   -- 한 회사가 여러 브랜드 운영
alter table items   add column if not exists buyer_style_no text;  -- 바이어가 지정한 품번

-- ─── 자재/샘플 누락 컬럼 (2026-08-07) ───
alter table materials
  add column if not exists mold_cost_amount numeric,
  add column if not exists mold_cost_currency text,
  add column if not exists plating_prices jsonb;   -- 도금 컬러별 단가

alter table samples
  add column if not exists style_id text,
  add column if not exists location text,
  add column if not exists round integer,
  add column if not exists round_name text,
  add column if not exists color text,
  add column if not exists received_date date,
  add column if not exists revision_note text,
  add column if not exists revision_history jsonb,
  add column if not exists sample_unit_price numeric,
  add column if not exists cost_cny numeric,
  add column if not exists approved_by text,
  add column if not exists material_checklist jsonb,
  add column if not exists billing_status text default '미청구',
  add column if not exists billing_statement_id text,
  add column if not exists billing_date date,
  add column if not exists collected_date date;
