-- 중국 발송 예정(항공/해상) 공유 알림
CREATE TABLE IF NOT EXISTS shipping_plans (
  id text PRIMARY KEY,
  ship_date date NOT NULL,
  method text NOT NULL CHECK (method IN ('air', 'sea')),
  order_no text,
  description text NOT NULL,
  qty numeric DEFAULT 0,
  memo text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_plans_ship_date
  ON shipping_plans (ship_date);


ALTER TABLE receipt_logs ADD COLUMN IF NOT EXISTS delivery_market text CHECK (delivery_market IN ('domestic','b2b','overseas'));
CREATE TABLE IF NOT EXISTS sales_records (
 id text PRIMARY KEY, sale_date date NOT NULL, channel text, buyer_name text, style_no text, style_name text, qty numeric DEFAULT 0, unit_price_krw numeric DEFAULT 0, total_krw numeric DEFAULT 0, season text, memo text, order_id text, order_no text, vendor_id text, vendor_name text, source text, workspace text, delivery_market text CHECK (delivery_market IN ('domestic','b2b','overseas')), shipping_cost_krw numeric DEFAULT 0, platform_fee_krw numeric DEFAULT 0, pg_fee_krw numeric DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS sales_records_sale_date_idx ON sales_records(sale_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON shipping_plans, sales_records TO anon;
