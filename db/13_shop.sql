-- 채널 구분 (2026-08-27): intl(쇼피파이) / kr(카페24)
ALTER TABLE checkout_events ADD COLUMN IF NOT EXISTS shop text NOT NULL DEFAULT 'intl';
CREATE INDEX IF NOT EXISTS idx_ce_shop ON checkout_events (shop, created_at);
NOTIFY pgrst, 'reload schema';
