BEGIN;
-- Dedicated read-only app credentials must never occupy the product-registration token row.
CREATE TABLE IF NOT EXISTS public.ads_channel_tokens (
  channel text PRIMARY KEY CHECK (channel = 'cafe24_ads'),
  access_token text NOT NULL, refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL, refresh_expires_at timestamptz,
  lease_owner text, lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.ads_commerce_token_claim(p_owner text,p_ttl_seconds integer DEFAULT 60)
RETURNS SETOF public.ads_channel_tokens LANGUAGE sql SECURITY INVOKER SET search_path = public,pg_temp AS $$
  UPDATE public.ads_channel_tokens SET lease_owner=p_owner,
    lease_until=now()+make_interval(secs=>least(greatest(p_ttl_seconds,30),120))
  WHERE channel='cafe24_ads' AND (lease_until IS NULL OR lease_until<now()) RETURNING *;
$$;
REVOKE ALL ON public.ads_channel_tokens FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ads_commerce_token_claim(text,integer) FROM PUBLIC;
DO $guard$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON public.ads_channel_tokens FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.ads_commerce_token_claim(text,integer) FROM %I',role_name);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_server') THEN
    GRANT SELECT,INSERT,UPDATE ON public.ads_channel_tokens TO erp_server;
    GRANT EXECUTE ON FUNCTION public.ads_commerce_token_claim(text,integer) TO erp_server;
  END IF;
END $guard$;
NOTIFY pgrst,'reload schema';
COMMIT;
