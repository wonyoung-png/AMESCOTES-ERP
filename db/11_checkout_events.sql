-- Shopify 체크아웃 웹픽셀 이벤트 (server/pixel.ts가 PostgREST로 insert)
CREATE TABLE IF NOT EXISTS checkout_events (
  id bigserial PRIMARY KEY,
  event text NOT NULL,
  checkout_token text,
  client_id text,
  country text,
  currency text,
  total numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT, SELECT ON checkout_events TO anon;
GRANT USAGE ON SEQUENCE checkout_events_id_seq TO anon;
NOTIFY pgrst, 'reload schema';
