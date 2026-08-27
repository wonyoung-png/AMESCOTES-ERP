-- 여정 이벤트 확장 (2026-08-27): path 컬럼 + 조회 인덱스 + 첫방문 뷰
ALTER TABLE checkout_events ADD COLUMN IF NOT EXISTS path text;
CREATE INDEX IF NOT EXISTS idx_ce_client ON checkout_events (client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ce_created ON checkout_events (created_at);
CREATE OR REPLACE VIEW client_first_seen AS
  SELECT client_id, min(created_at) AS first_seen
  FROM checkout_events WHERE client_id IS NOT NULL GROUP BY client_id;
GRANT SELECT ON client_first_seen TO anon;
NOTIFY pgrst, 'reload schema';
