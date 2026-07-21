-- Phase 1 제조 ERP — 신규 테이블 및 컬럼 확장
-- Supabase SQL Editor에서 실행 (DROP/DELETE 금지)

-- projects 마스터
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  project_no text UNIQUE NOT NULL,
  workspace text NOT NULL CHECK (workspace IN ('OEM', 'LUMEN', 'AETALOOP')),
  title text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 브랜드 묶음 발주
CREATE TABLE IF NOT EXISTS brand_order_batches (
  id text PRIMARY KEY,
  workspace text NOT NULL CHECK (workspace IN ('LUMEN', 'AETALOOP')),
  project_no text NOT NULL,
  title text,
  week_label text,
  status text DEFAULT 'draft',
  approval_step int DEFAULT 1,
  expected_dely date,
  dely_requested_to text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brand_order_lines (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES brand_order_batches(id) ON DELETE CASCADE,
  style_no text,
  style_name text,
  color_qtys jsonb DEFAULT '[]',
  factory_id text,
  factory_name text,
  production_origin text DEFAULT 'china',
  is_employee_purchase boolean DEFAULT false,
  qty int DEFAULT 0,
  memo text
);

CREATE TABLE IF NOT EXISTS approval_logs (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES brand_order_batches(id) ON DELETE CASCADE,
  step int NOT NULL,
  action text NOT NULL,
  actor_id text,
  actor_name text,
  comment text,
  created_at timestamptz DEFAULT now()
);

-- 입고·출고 로그
CREATE TABLE IF NOT EXISTS receipt_logs (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  order_no text,
  project_no text,
  log_type text NOT NULL DEFAULT 'inbound',
  qty int NOT NULL DEFAULT 0,
  defect_qty int DEFAULT 0,
  defect_note text,
  received_date date,
  memo text,
  created_at timestamptz DEFAULT now()
);

-- 불량 차감 이월
CREATE TABLE IF NOT EXISTS defect_carryovers (
  id text PRIMARY KEY,
  style_no text,
  order_no text,
  project_no text,
  vendor_id text,
  vendor_name text,
  amount_krw numeric DEFAULT 0,
  reason text,
  defect_date date,
  status text DEFAULT 'pending',
  applied_statement_id text,
  created_at timestamptz DEFAULT now()
);

-- 미지급
CREATE TABLE IF NOT EXISTS payables (
  id text PRIMARY KEY,
  vendor_id text,
  vendor_name text,
  project_no text,
  source_type text,
  source_id text,
  amount_krw numeric DEFAULT 0,
  paid_amount_krw numeric DEFAULT 0,
  due_date date,
  status text DEFAULT 'pending',
  memo text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 거래명세표 · 정산 · 구매 (Supabase 이전)
CREATE TABLE IF NOT EXISTS trade_statements (
  id text PRIMARY KEY,
  statement_no text,
  vendor_id text,
  vendor_name text,
  vendor_code text,
  project_no text,
  workspace text,
  issue_date date,
  lines jsonb DEFAULT '[]',
  status text,
  tax_invoice jsonb,
  memo text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  id text PRIMARY KEY,
  buyer_id text,
  buyer_name text,
  project_no text,
  workspace text,
  channel text,
  invoice_no text,
  invoice_date date,
  due_date date,
  billed_amount_krw numeric DEFAULT 0,
  collected_amount_krw numeric DEFAULT 0,
  collected_date date,
  status text,
  memo text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id text PRIMARY KEY,
  order_id text,
  order_no text,
  project_no text,
  purchase_date date,
  item_name text,
  qty numeric,
  unit text,
  unit_price_cny numeric,
  currency text,
  applied_rate numeric,
  amount_krw numeric,
  vendor_id text,
  vendor_name text,
  payment_method text,
  purchase_status text,
  statement_no text,
  memo text,
  created_at timestamptz DEFAULT now()
);

-- production_orders 확장
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS project_no text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'OEM';
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS production_origin text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS brand_batch_id text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS shipped_qty int DEFAULT 0;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS is_employee_purchase boolean DEFAULT false;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS milestones jsonb;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS hq_supply_items jsonb;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS received_qty int;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS defect_qty int;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS defect_note text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS received_date date;

CREATE INDEX IF NOT EXISTS idx_projects_no ON projects(project_no);
CREATE INDEX IF NOT EXISTS idx_orders_project ON production_orders(project_no);
CREATE INDEX IF NOT EXISTS idx_receipt_order ON receipt_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_brand_batch_ws ON brand_order_batches(workspace);
