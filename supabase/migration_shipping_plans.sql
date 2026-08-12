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

