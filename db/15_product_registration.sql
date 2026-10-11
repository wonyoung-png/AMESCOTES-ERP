-- LUMEN channel registration. PREPARE ONLY: Claude applies after backup/review.
BEGIN;
CREATE TABLE IF NOT EXISTS public.product_registration_settings (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  approver_ids text[] NOT NULL DEFAULT '{}',
  filter_mappings jsonb NOT NULL DEFAULT '{}',
  category_mappings jsonb NOT NULL DEFAULT '{}',
  daily_time text NOT NULL DEFAULT '09:00' CHECK (daily_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  weekly_time text NOT NULL DEFAULT '09:30' CHECK (weekly_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  weekly_day integer NOT NULL DEFAULT 1 CHECK (weekly_day BETWEEN 0 AND 6),
  monitor_enabled boolean NOT NULL DEFAULT true,
  updated_by text, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.product_registration_settings(id) VALUES ('default') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.product_listings (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES public.items(id),
  workspace text NOT NULL DEFAULT 'LUMEN' CHECK (workspace = 'LUMEN'),
  payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT '작성중' CHECK (status IN ('작성중','검증통과','승인대기','승인','예약됨','공개됨','오류','삭제대기','삭제됨')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by text NOT NULL,
  edited_by text,
  approval_evidence text,
  approved_by text,
  approved_revision integer,
  publish_at timestamptz,
  publish_channels text[] NOT NULL DEFAULT '{cafe24,shopify}' CHECK (publish_channels <@ ARRAY['cafe24','shopify']::text[]),
  cafe24_product_no bigint,
  shopify_product_id text,
  step_keys jsonb NOT NULL DEFAULT '{}',
  validation jsonb,
  last_sync_at timestamptz,
  last_sync_result jsonb NOT NULL DEFAULT '{}',
  item_snapshot_hash text,
  lease_owner text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK (approved_by IS NULL OR approved_by <> edited_by),
  CHECK (approved_by IS NULL OR NOT (coalesce(validation->'editor_ids','[]'::jsonb) ? approved_by)),
  CHECK (approved_revision IS NULL OR approved_revision = revision),
  CHECK (status NOT IN ('승인','예약됨','공개됨') OR (approved_by IS NOT NULL AND approved_revision = revision))
);
CREATE UNIQUE INDEX IF NOT EXISTS product_listings_sku_unique ON public.product_listings ((payload->>'sku')) WHERE status <> '삭제됨' AND coalesce(payload->>'sku','') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS product_listings_cafe24_unique ON public.product_listings(cafe24_product_no) WHERE cafe24_product_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_listings_shopify_unique ON public.product_listings(shopify_product_id) WHERE shopify_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_listings_due ON public.product_listings(publish_at) WHERE status = '예약됨';
CREATE TABLE IF NOT EXISTS public.product_listing_images (
  id text PRIMARY KEY, listing_id text NOT NULL REFERENCES public.product_listings(id),
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  role text NOT NULL CHECK (role IN ('main','list','extra','detail_view')),
  source_url text NOT NULL CHECK (source_url LIKE 'https://%'),
  width integer NOT NULL CHECK (width > 0), height integer NOT NULL CHECK (height > 0),
  alt_en text NOT NULL DEFAULT '', alt_ko text NOT NULL DEFAULT '',
  shopify_file_id text, shopify_media_id text,
  cafe24_paths jsonb NOT NULL DEFAULT '{}',
  mime_type text, byte_size integer CHECK (byte_size BETWEEN 1 AND 10485760),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_listing_images_order ON public.product_listing_images(listing_id,position,id);
CREATE TABLE IF NOT EXISTS public.product_listing_events (
  id text PRIMARY KEY, listing_id text NOT NULL REFERENCES public.product_listings(id),
  actor_id text NOT NULL, action text NOT NULL, revision integer NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_listing_events_listing ON public.product_listing_events(listing_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.channel_tokens (
  channel text PRIMARY KEY CHECK (channel = 'cafe24_erp'),
  access_token text NOT NULL, refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL, refresh_expires_at timestamptz,
  lease_owner text, lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.product_shop_monitor_runs (
  id text PRIMARY KEY, schedule_id text NOT NULL, run_date date NOT NULL,
  status text NOT NULL DEFAULT 'running', lease_owner text, lease_until timestamptz,
  results jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  UNIQUE(schedule_id,run_date)
);
CREATE TABLE IF NOT EXISTS public.product_shop_monitor_issues (
  id text PRIMARY KEY, listing_id text NOT NULL REFERENCES public.product_listings(id),
  kind text NOT NULL, message text NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, details jsonb NOT NULL DEFAULT '{}', UNIQUE(listing_id,kind)
);
-- Atomic claim prevents overlapping ticks and edits; no lock spans a network request.
CREATE OR REPLACE FUNCTION public.product_registration_claim(p_id text,p_revision integer,p_owner text,p_ttl_seconds integer DEFAULT 600)
RETURNS SETOF public.product_listings LANGUAGE sql SECURITY INVOKER SET search_path = public,pg_temp AS $$
  UPDATE public.product_listings SET lease_owner=p_owner,
    lease_until=now()+make_interval(secs=>least(greatest(p_ttl_seconds,30),1800))
  WHERE id=p_id AND revision=p_revision AND (lease_until IS NULL OR lease_until<now())
  RETURNING *;
$$;
CREATE OR REPLACE FUNCTION public.product_registration_token_claim(p_owner text,p_ttl_seconds integer DEFAULT 60)
RETURNS SETOF public.channel_tokens LANGUAGE sql SECURITY INVOKER SET search_path = public,pg_temp AS $$
  UPDATE public.channel_tokens SET lease_owner=p_owner,
    lease_until=now()+make_interval(secs=>least(greatest(p_ttl_seconds,30),120))
  WHERE channel='cafe24_erp' AND (lease_until IS NULL OR lease_until<now()) RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.product_registration_claim(text,integer,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_registration_token_claim(text,integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.product_shop_monitor_claim(p_id text,p_schedule_id text,p_run_date date,p_owner text,p_ttl_seconds integer DEFAULT 600)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE claimed text;
BEGIN
  INSERT INTO public.product_shop_monitor_runs(id,schedule_id,run_date,status,lease_owner,lease_until)
  VALUES(p_id,p_schedule_id,p_run_date,'running',p_owner,now()+make_interval(secs=>least(greatest(p_ttl_seconds,30),900)))
  ON CONFLICT(schedule_id,run_date) DO UPDATE SET status='running',lease_owner=EXCLUDED.lease_owner,
    lease_until=EXCLUDED.lease_until,finished_at=NULL
  WHERE product_shop_monitor_runs.id=p_id AND (product_shop_monitor_runs.status='failed' OR
    (product_shop_monitor_runs.status='running' AND product_shop_monitor_runs.lease_until<now()))
  RETURNING id INTO claimed;
  RETURN claimed IS NOT NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.product_shop_monitor_finish(p_id text,p_owner text,p_issues jsonb,p_checked jsonb,p_result jsonb,p_report jsonb,p_cards jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE issue jsonb; scope jsonb; locked_id text;
BEGIN
  SELECT id INTO locked_id FROM public.product_shop_monitor_runs
  WHERE id=p_id AND lease_owner=p_owner AND lease_until>now() AND status='running' FOR UPDATE;
  IF locked_id IS NULL THEN RETURN false; END IF;
  IF p_report->>'team' IS DISTINCT FROM '자사몰관리' OR p_report->>'model' IS DISTINCT FROM 'rule-based'
    OR coalesce(p_report->>'trigger','') NOT IN ('shop_daily','shop_weekly','shop_manual')
    OR jsonb_typeof(p_issues) IS DISTINCT FROM 'array' OR jsonb_typeof(p_checked) IS DISTINCT FROM 'array'
    OR p_cards IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'invalid_shop_monitor_report'; END IF;
  FOR issue IN SELECT value FROM jsonb_array_elements(p_issues) LOOP
    INSERT INTO public.product_shop_monitor_issues(id,listing_id,kind,message,details,first_seen,last_seen,resolved_at)
    VALUES(issue->>'id',issue->>'listing_id',issue->>'kind',issue->>'message',coalesce(issue->'details','{}'),now(),now(),NULL)
    ON CONFLICT(listing_id,kind) DO UPDATE SET message=EXCLUDED.message,details=EXCLUDED.details,
      first_seen=CASE WHEN product_shop_monitor_issues.resolved_at IS NULL THEN product_shop_monitor_issues.first_seen ELSE now() END,
      last_seen=now(),resolved_at=NULL;
  END LOOP;
  FOR scope IN SELECT value FROM jsonb_array_elements(p_checked) LOOP
    UPDATE public.product_shop_monitor_issues previous SET resolved_at=now()
    WHERE previous.listing_id=scope->>'listing_id' AND previous.resolved_at IS NULL
      AND previous.kind IN (SELECT jsonb_array_elements_text(scope->'kinds'))
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_issues) present
        WHERE present->>'listing_id'=previous.listing_id AND present->>'kind'=previous.kind);
  END LOOP;
  INSERT INTO public.team_agent_runs(id,team,created_at,status,headline,summary,needs,stats,model,trigger)
  VALUES(p_report->>'id','자사몰관리',now(),p_report->>'status',p_report->>'headline',p_report->>'summary',
    coalesce(p_report->'needs','[]'),coalesce(p_report->'stats','{}'),'rule-based',p_report->>'trigger');
  UPDATE public.product_shop_monitor_runs SET status='completed',finished_at=now(),results=p_result,lease_owner=NULL,lease_until=NULL
  WHERE id=p_id AND lease_owner=p_owner;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.product_shop_monitor_claim(text,text,date,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_shop_monitor_finish(text,text,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC;
DO $guard$
DECLARE target text; role_name text;
BEGIN
  FOREACH target IN ARRAY ARRAY['product_registration_settings','product_listings','product_listing_images','product_listing_events','channel_tokens','product_shop_monitor_runs','product_shop_monitor_issues'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',target);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',target,role_name); END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_server') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON TABLE public.%I TO erp_server',target); END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_server') THEN
    GRANT DELETE ON public.product_listing_images TO erp_server;
    GRANT EXECUTE ON FUNCTION public.product_registration_claim(text,integer,text,integer) TO erp_server;
    GRANT EXECUTE ON FUNCTION public.product_registration_token_claim(text,integer) TO erp_server;
    GRANT EXECUTE ON FUNCTION public.product_shop_monitor_claim(text,text,date,text,integer) TO erp_server;
    GRANT EXECUTE ON FUNCTION public.product_shop_monitor_finish(text,text,jsonb,jsonb,jsonb,jsonb,jsonb) TO erp_server;
  END IF;
END $guard$;
NOTIFY pgrst,'reload schema';
COMMIT;
