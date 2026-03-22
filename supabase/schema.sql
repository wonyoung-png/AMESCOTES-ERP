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
